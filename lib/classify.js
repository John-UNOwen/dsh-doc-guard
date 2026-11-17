/**
 * Decide whether a tool call writes docs, comments, or a commit message.
 *
 * @module dsh-plain-docs-guard/classify
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { extOf, scanComments, styleFor } from './rules.js'

const NEW_TEXT_KEYS = ['content', 'new_string', 'new_str', 'file_text', 'insert_text']
const DOC_NAMES = new Set(['readme', 'changelog', 'contributing'])
// Text files that are data or legal text, not docs.
const NOT_DOCS = /^((license|licence|copying|notice)(\.\w+)?$|requirements[\w.-]*\.txt$|cmakelists\.txt$|robots\.txt$)/i
const LOCK = /(^|[-._])lock(\.|$)/i
const TOKEN = /"[^"\n]+"|'[^'\n]+'|[^\s;|&<>()"',]+/g
const WRITE_CMD = /\b(Set-Content|Add-Content|Out-File|Tee-Object|tee)\b([^;\n|&]*)/gi
const REDIRECT = /(?<![0-9&>])>>?(?!&)\s*("[^"\n]+"|'[^'\n]+'|[^\s;|&<>()"']+)/g
// Commands whose output is text the agent typed, not the output of a program.
const EMITTERS = /^(echo|printf|print|write-output|write|set-content|add-content|out-file|tee-object|sed|awk|perl)\b/i
const HEREDOC_START = /<<-?\s*['"]?\w+/
const COMPARE_MAX_CHARS = 4 * 1024 * 1024

const HERE_STRING = /@(['"])\r?\n[\s\S]*?\r?\n\1@/y
const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\s|\)|$)/y
const SINGLE = /'(?:[^']|'')*'/y

const strings = (...values) => values.filter((v) => typeof v === 'string')

function expandHome(p) {
  return p
    .replace(/^~(?=$|[\\/])/, homedir())
    .replace(/^(\$env:USERPROFILE|\$HOME|%USERPROFILE%)(?=$|[\\/])/i, homedir())
}

/** Remove here-string and heredoc bodies, so their text is not read as commands. */
function stripBodies(command) {
  return command
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "''")
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g, "<<'BODY'")
}

function matchAt(re, s, i) {
  re.lastIndex = i
  return re.exec(s)
}

function skipDouble(s, i) {
  let j = i + 1
  while (j < s.length) {
    const c = s[j]
    if (c === '\\' || c === '`') j += 2
    else if (c === '"') return j + 1
    else if (c === '<' && matchAt(HEREDOC, s, j)) j += HEREDOC.lastIndex - j
    else j++
  }
  return s.length
}

/**
 * Split a shell command into statements, and each statement into pipeline
 * stages. Quotes, here-strings, and heredocs are kept whole.
 * @returns {string[][]}
 */
export function splitShell(s) {
  const out = []
  let stages = []
  let start = 0
  const cut = (end) => stages.push(s.slice(start, end).trim())
  const close = (end) => {
    cut(end)
    if (stages.some(Boolean)) out.push(stages)
    stages = []
  }
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    let m
    if ((ch === '\\' || ch === '`') && (s[i + 1] === '\n' || s[i + 1] === '\r')) i += 2
    else if (ch === '@' && (m = matchAt(HERE_STRING, s, i))) i += m[0].length
    else if (ch === '<' && (m = matchAt(HEREDOC, s, i))) i += m[0].length
    else if (ch === "'") i = (m = matchAt(SINGLE, s, i)) ? i + m[0].length : s.length
    else if (ch === '"') i = skipDouble(s, i)
    else if (ch === '\n' || ch === ';') {
      close(i)
      start = ++i
    } else if ((ch === '&' || ch === '|') && s[i + 1] === ch) {
      close(i)
      i += 2
      start = i
    } else if (ch === '|') {
      cut(i)
      start = ++i
    } else i++
  }
  close(s.length)
  return out
}

/** Whether a statement writes text the agent typed, rather than the output of a program. */
function authored(stages) {
  const first = stages[0] || ''
  if (!first || /^[@'"$(>]/.test(first)) return true
  if (/^cat\b/i.test(first)) return HEREDOC_START.test(first)
  if (stages.some((t) => /-replace\b|\.Replace\(/i.test(t))) return true
  return EMITTERS.test(first)
}

/** Read one flag value starting at `at`. Returns null for a variable or an empty value. */
function readValue(s, at) {
  const rest = s.slice(at)
  let m = /^@(['"])\r?\n([\s\S]*?)\r?\n\1@/.exec(rest)
  if (m) return m[2]
  m = /^"?\$\(\s*cat\s+<<-?\s*['"]?(\w+)['"]?\r?\n([\s\S]*?)\r?\n\s*\1\b/.exec(rest)
  if (m) return m[2]
  if (rest[0] === "'") {
    m = /^'((?:[^']|'')*)'/.exec(rest)
    return m ? m[1].replace(/''/g, "'") : null
  }
  if (rest[0] === '"') {
    m = /^"((?:[^"\\`]|\\[\s\S]|`[\s\S])*)"/.exec(rest)
    return m ? m[1].replace(/`n/g, '\n').replace(/[\\`](["'`\\$])/g, '$1') : null
  }
  m = /^[^\s;|&]+/.exec(rest)
  return m && !m[0].startsWith('$') ? m[0] : null
}

function flagValues(command, flags) {
  const re = new RegExp(`(?:^|\\s)(?:${flags})(?:=|\\s+|(?=["'@]))`, 'g')
  const out = []
  for (const m of command.matchAll(re)) {
    const v = readValue(command, m.index + m[0].length)
    if (v) out.push(v)
  }
  return out
}

/** The file text after an edit, or null when it can't be worked out from the arguments. */
function projectedText(args, current) {
  for (const k of ['content', 'file_text']) if (typeof args[k] === 'string') return args[k]
  if (current === null) return null
  const crlf = current.includes('\r\n')
  const eol = (t) => (crlf ? t.replace(/\r?\n/g, '\r\n') : t)
  const oldText = strings(args.old_string, args.old_str)[0]
  if (oldText !== undefined) {
    const newText = eol(strings(args.new_string, args.new_str)[0] ?? '')
    for (const o of new Set([oldText, eol(oldText)])) {
      if (!o || !current.includes(o)) continue
      return args.replace_all ? current.split(o).join(newText) : current.replace(o, () => newText)
    }
    return null
  }
  const inserted = strings(args.insert_text, args.new_str)[0]
  if (inserted !== undefined && Number.isInteger(args.insert_line)) {
    const lines = current.split(/\r?\n/)
    lines.splice(args.insert_line, 0, inserted)
    return lines.join('\n')
  }
  return null
}

/**
 * @param {object} config - resolved plugin config.
 * @returns {{classify: (exec: object) => Promise<object | null>, isDoc: (file: string) => boolean}}
 */
export function createClassifier(config) {
  const docExt = new Set(config.docExtensions.map((e) => String(e).replace(/^\./, '').toLowerCase()))
  const ignoreNames = new Set(config.ignorePaths.map((s) => String(s).toLowerCase()))
  const fileTools = new Set(config.fileTools)
  const shellTools = new Set(config.shellTools)

  const isDoc = (file) => {
    const base = path.basename(file).toLowerCase()
    if (NOT_DOCS.test(base)) return false
    const dot = base.indexOf('.')
    return docExt.has(extOf(base)) || DOC_NAMES.has(dot < 0 ? base : base.slice(0, dot))
  }

  const ignored = (file) => {
    const parts = file.split(/[\\/]+/).map((s) => s.toLowerCase())
    return parts.some((s) => ignoreNames.has(s)) || LOCK.test(parts[parts.length - 1])
  }

  const commentSet = (text, ext) =>
    new Set((scanComments(text, ext) || []).map((c) => c.text.trim()).filter(Boolean))

  async function classifyFile(exec, cwd) {
    const args = exec.arguments || {}
    const p = strings(args.file_path, args.path, args.filePath)[0]
    if (!p) return null
    if (exec.name === 'str_replace_editor' && (!args.command || args.command === 'view')) return null
    const file = path.resolve(cwd, expandHome(p))
    if (ignored(file)) return null
    if (isDoc(file)) return { gate: true, files: [{ path: file, kind: 'doc' }], messages: [] }
    const ext = extOf(file)
    if (!styleFor(ext)) return null
    const target = { gate: false, files: [{ path: file, kind: 'code', ext }], messages: [] }
    let current = null
    try {
      current = await readFile(file, 'utf8')
    } catch {
      // A new or unreadable file: compare against nothing.
    }
    if (current !== null && current.length > COMPARE_MAX_CHARS) current = null
    // Compare whole files, so an edit inside a block comment or docstring is seen as a comment change.
    const after = projectedText(args, current)
    if (after !== null && after.length <= COMPARE_MAX_CHARS) {
      const before = commentSet(current ?? '', ext)
      target.gate = [...commentSet(after, ext)].some((c) => !before.has(c))
      return target
    }
    const added = commentSet(strings(...NEW_TEXT_KEYS.map((k) => args[k])).join('\n'), ext)
    const before = commentSet(strings(args.old_string, args.old_str).join('\n'), ext)
    target.gate = [...added].some((c) => !before.has(c))
    return target
  }

  function classifyShell(exec, cwd) {
    const command = (exec.arguments || {}).command
    if (typeof command !== 'string' || !command) return null
    const out = { gate: false, files: [], messages: [] }
    const resolveFile = (value) => path.resolve(cwd, expandHome(value))
    const seen = new Set()

    for (const stages of splitShell(command)) {
      const statement = stages.join(' | ')
      const bare = stripBodies(statement)
      const commit = /\bgit\b[^\n|]*?\bcommit\b(.*)/.exec(bare)
      if (commit && /\s(-[a-zA-Z]*[mF](?=[\s"'=@]|$)|--message\b|--file\b)/.test(commit[1])) {
        out.gate = true
        // Read flags only after `commit`, so flags of git itself are not taken as the message.
        const args = statement.slice(statement.search(/\bcommit\b/) + 'commit'.length)
        for (const text of flagValues(args, '-[a-zA-Z]*m|--message')) out.messages.push({ label: 'commit message', text })
        for (const f of flagValues(args, '-[a-zA-Z]*F|--file')) if (f !== '-') out.messages.push({ label: 'commit message', file: resolveFile(f) })
      }
      if (/\bgh\s+pr\s+(create|edit)\b/.test(bare)) {
        out.gate = true
        for (const text of flagValues(statement, '-t|--title|-b|--body')) out.messages.push({ label: 'PR text', text })
        for (const f of flagValues(statement, '-F|--body-file')) if (f !== '-') out.messages.push({ label: 'PR text', file: resolveFile(f) })
      }

      const tokens = [...bare.matchAll(REDIRECT)].map((m) => m[1])
      for (const m of bare.matchAll(WRITE_CMD)) tokens.push(...(m[2].match(TOKEN) || []))
      const targets = tokens
        .map((raw) => expandHome(raw.replace(/^["']|["']$/g, '')))
        .filter((t) => t && !t.startsWith('-') && isDoc(t) && !ignored(t))
      if (!targets.length || !authored(stages)) continue
      out.gate = true
      for (const t of targets) {
        // A path built from a variable can be gated by its name but not read.
        if (/[$`%*]/.test(t)) continue
        const file = path.resolve(cwd, t)
        if (!seen.has(file)) out.files.push({ path: file, kind: 'doc' })
        seen.add(file)
      }
    }
    return out.gate ? out : null
  }

  return {
    isDoc,
    /**
     * @returns a target with `gate` (needs the skill), `files` to check, and
     *   `messages` to check, or null when the call writes nothing this plugin covers.
     */
    async classify(exec) {
      const cwd = exec.agent?.session?.header?.cwd || process.cwd()
      if (fileTools.has(exec.name)) return classifyFile(exec, cwd)
      if (shellTools.has(exec.name)) return classifyShell(exec, cwd)
      return null
    },
  }
}
