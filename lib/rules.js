/**
 * Text rules for plain-docs-guard: find comments in code, find prose in
 * markdown, and flag the patterns the plain-docs skill names.
 *
 * @module dsh-plain-docs-guard/rules
 */

import { execFile } from 'node:child_process'
import { homedir, userInfo } from 'node:os'
import path from 'node:path'

/**
 * Look up the 8.3 short form of the home folder, such as C:\Users\ABCDEF~1,
 * the way dsh-okf-guard does. Runs off the event loop.
 * @returns {Promise<string | null>} the short path, or null when there is none or the lookup fails.
 */
export function detectShortHome(home = homedir()) {
  // The path reaches cmd.exe through the environment and delayed expansion, so none of it is
  // read as command syntax. A path with a quote, a % or a ! is refused rather than passed.
  if (process.platform !== 'win32' || /["\r\n%!]/.test(home)) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      execFile(
        'cmd.exe',
        ['/d', '/v:on', '/c', 'for %I in ("!PDG_HOME!") do @echo %~sI'],
        { encoding: 'utf8', windowsHide: true, timeout: 5000, windowsVerbatimArguments: true, env: { ...process.env, PDG_HOME: home } },
        (error, stdout) => resolve(error ? null : String(stdout).trim() || null),
      )
    } catch {
      resolve(null)
    }
  })
}

const SLASH = 'js mjs cjs jsx ts mts cts tsx c h cc cpp hpp cs java go rs swift kt kts scala php dart css scss less'
const HASH = 'py pyi rb sh bash zsh fish ps1 psm1 psd1 yml yaml toml r pl pm ex exs tf nim cmake dockerfile makefile'
const DASH = 'sql lua hs elm ada'
const SEMI = 'lisp lsp cl clj cljs cljc edn el scm ss rkt ini asm'
const MARKUP = 'html htm xml svg vue svelte'

const STYLES = new Map()
for (const e of SLASH.split(' ')) STYLES.set(e, { line: ['//'], block: [['/*', '*/']], quotes: '"\'`' })
for (const e of HASH.split(' ')) STYLES.set(e, { line: ['#'], block: [], quotes: '"\'' })
for (const e of DASH.split(' ')) STYLES.set(e, { line: ['--'], block: [], quotes: '"\'' })
for (const e of SEMI.split(' ')) STYLES.set(e, { line: [';'], block: [], quotes: '"' })
for (const e of MARKUP.split(' ')) STYLES.set(e, { line: [], block: [['<!--', '-->']], quotes: '' })
for (const e of ['py', 'pyi']) STYLES.get(e).triple = true
for (const e of ['ps1', 'psm1', 'psd1']) STYLES.get(e).block = [['<#', '#>']]
STYLES.get('sql').block = [['/*', '*/']]
STYLES.set('css', { line: [], block: [['/*', '*/']], quotes: '"\'' })
STYLES.set('abap', { abap: true, line: [], block: [], quotes: '' })

/** Lowercase extension without the dot, or the lowercase file name when there is none. */
export function extOf(file) {
  const base = path.basename(String(file)).toLowerCase()
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot + 1) : base
}

/** Comment syntax for an extension, or undefined when the file type is not a known code type. */
export function styleFor(ext) {
  return STYLES.get(String(ext || '').toLowerCase())
}

function abapComment(s) {
  if (s[0] === '*') return { pos: 0, text: s.slice(1), own: true }
  let quote = null
  for (let p = 0; p < s.length; p++) {
    const ch = s[p]
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === "'" || ch === '`' || ch === '|') quote = ch
    else if (ch === '"') return { pos: p, text: s.slice(p + 1), own: s.slice(0, p).trim() === '' }
  }
  return null
}

/**
 * Find comment and docstring lines.
 * @param {string} text - file text, or a fragment of it.
 * @param {string} ext - extension without the dot.
 * @returns {{i: number, text: string, block: number, doc: boolean, own: boolean}[] | null}
 *   One entry per comment line with its 0-based line index, or null for an unknown file type.
 */
export function scanComments(text, ext) {
  const style = styleFor(ext)
  if (!style) return null
  const lines = String(text).split(/\r?\n/)
  const out = []
  let open = null
  // An open Python triple-quoted string that is not a docstring. Its lines are code.
  let str = null
  // The code part of the last line that had code, to tell a docstring from a string.
  let prevCode = null
  let block = 0
  let last = null
  const push = (i, t, doc, own, fresh) => {
    const joins = !fresh && own && last && last.own && last.i === i - 1 && last.doc === doc
    if (!joins) block++
    last = { i, text: t.replace(/^ /, '').trimEnd(), block, doc, own }
    out.push(last)
  }
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]
    if (open) {
      const end = s.indexOf(open.end)
      let t = end < 0 ? s : s.slice(0, end)
      if (open.star) t = t.replace(/^\s*\*+/, '')
      else t = t.replace(/^\s+/, ' ')
      push(i, t, open.doc, true, false)
      if (end >= 0) {
        open = null
        last = null
      }
      continue
    }
    if (i === 0 && s.startsWith('#!')) continue
    if (style.abap) {
      const c = abapComment(s)
      if (c) push(i, c.text, false, c.own, false)
      continue
    }
    let start = 0
    if (str) {
      const end = s.indexOf(str)
      if (end < 0) continue
      start = end + 3
      str = null
    }
    if (style.triple && start === 0) {
      const m = /^(\s*[rRuUbB]{0,2})("""|''')/.exec(s)
      // A docstring opens a module or follows a line ending in a colon, such as def or class.
      if (m && (prevCode === null || prevCode.endsWith(':'))) {
        const rest = s.slice(m[0].length)
        const end = rest.indexOf(m[2])
        push(i, end < 0 ? rest : rest.slice(0, end), true, true, true)
        if (end < 0) open = { end: m[2], doc: true, star: false }
        else last = null
        prevCode = m[2]
        continue
      }
    }
    let quote = null
    let commentAt = s.length
    for (let p = start; p < s.length; p++) {
      const ch = s[p]
      if (quote) {
        if (ch === '\\') p++
        else if (ch === quote) quote = null
        continue
      }
      if (style.triple && (s.startsWith('"""', p) || s.startsWith("'''", p))) {
        const q = s.slice(p, p + 3)
        const end = s.indexOf(q, p + 3)
        if (end < 0) {
          str = q
          break
        }
        p = end + 2
        continue
      }
      if (style.quotes.includes(ch)) {
        quote = ch
        continue
      }
      const own = s.slice(0, p).trim() === ''
      const blk = style.block.find((b) => s.startsWith(b[0], p))
      if (blk) {
        const doc = blk[0] === '<#' || (blk[0] === '/*' && s[p + 2] === '*' && s[p + 3] !== '/')
        const rest = s.slice(p + blk[0].length).replace(/^\*+/, '')
        const end = rest.indexOf(blk[1])
        push(i, end < 0 ? rest : rest.slice(0, end), doc, own, true)
        if (end < 0) open = { end: blk[1], doc, star: blk[0] === '/*' }
        else last = null
        commentAt = p
        break
      }
      const mark = style.line.find((m) => s.startsWith(m, p))
      if (!mark) continue
      if (mark === '#' && p > 0 && !/\s/.test(s[p - 1])) continue
      if (mark === '//' && s[p - 1] === ':') continue
      let rest = s.slice(p + mark.length)
      let doc = false
      if (mark === '//' && /^[/!]/.test(rest)) {
        doc = true
        rest = rest.replace(/^[/!]+/, '')
      }
      push(i, rest.replace(/^[#;]+/, ''), doc, own, false)
      commentAt = p
      break
    }
    const code = s.slice(start, commentAt).trim()
    if (code) prevCode = code
  }
  return out
}

/**
 * Find prose lines in markdown-like text. Fenced code, front matter, and
 * blockquotes are left out. Inline code, URLs, and HTML tags are blanked.
 * @returns {{i: number, text: string, heading: boolean, bullet: boolean, numbered: boolean}[]}
 */
export function scanProse(text) {
  const lines = String(text).split(/\r?\n/)
  const out = []
  let fence = null
  let front = lines[0] === '---'
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i]
    if (front) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(s)) front = false
      continue
    }
    const f = /^\s*(```+|~~~+)/.exec(s)
    if (f) {
      if (!fence) fence = f[1][0]
      else if (fence === f[1][0]) fence = null
      continue
    }
    if (fence || /^\s*>/.test(s) || /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(s)) continue
    const t = s
      .replace(/(`+)[^`]*?\1/g, ' ')
      .replace(/\]\([^)]*\)/g, ']')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>\s][^>]*>/g, ' ')
      .replace(/&#?\w+;/g, ' ')
    if (!t.trim()) continue
    out.push({
      i,
      text: t,
      heading: /^\s{0,3}#{1,6}\s/.test(s),
      bullet: /^\s*[-*+]\s/.test(s),
      numbered: /^\s*\d+[.)]\s/.test(s),
    })
  }
  return out
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function wordPattern(word) {
  const w = word.trim()
  if (/^[a-z]+$/i.test(w)) {
    if (/e$/i.test(w)) return `${esc(w.slice(0, -1))}(?:e|es|ed|ing|ely)`
    if (/y$/i.test(w)) return esc(w)
    return `${esc(w)}(?:s|es|ed|ing|ly)?`
  }
  return w.split(/\s+/).map((p) => esc(p).replace(/'/g, "['’]")).join('\\s+')
}

function compile(words, cjk) {
  const list = [...new Set(words.map((w) => w.trim()).filter(Boolean))]
  if (!list.length) return null
  list.sort((a, b) => b.length - a.length)
  if (cjk) return new RegExp(list.map(esc).join('|'), 'g')
  return new RegExp(`(?<![\\w-])(?:${list.map(wordPattern).join('|')})(?![\\w-])`, 'gi')
}

const colonList = (line) => {
  const at = line.indexOf(': ')
  if (at < 0) return []
  const body = line.slice(at + 2).split(/\.(?:\s|$)/)[0]
  return body.split(',').map((s) => s.trim()).filter((s) => s && !s.includes('(') && !s.includes('"'))
}

const quotedList = (line) =>
  [...line.matchAll(/"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => !/^[,\s]/.test(s) && !/[.!?]\s/.test(s) && !/\b[XY]\b/.test(s))
    .map((s) => s.replace(/(\.\.\.|[.!:,])+$/, '').trim())
    .filter((s) => s.length > 2)

const SKILL_LINES = [
  ['- Adjectives with nothing behind them:', 'hype-word', colonList],
  ['- Intensifiers:', 'intensifier', colonList],
  ['- Significance claims:', 'hype-word', colonList],
  ['- AI vocabulary:', 'ai-word', colonList],
  ['- Metaphor nouns', 'metaphor-noun', colonList],
  ['- Filler transitions', 'filler', colonList, 'start'],
  ['- Telling the reader', 'filler', quotedList],
  ['- Spelling out', 'filler', quotedList],
  ['- Announcing', 'filler', quotedList],
  ['- Recaps:', 'filler', quotedList],
  ['- Colon reveals', 'filler', quotedList],
  ['- Slogans', 'hype-word', quotedList],
  ['- Chat phrases:', 'chat-leftover', quotedList],
  ['- Cut stacked and filler hedges:', 'hedge', quotedList],
  ['**Filler phrases.**', 'filler', quotedList],
  ['- Use the plain word:', 'plain-word', (l) => colonList(`: ${(/\bNot ([^.]+)\./.exec(l) || [])[1] || ''}`)],
  ['- Never write', 'procedure-word', quotedList, 'numbered'],
  ['- Comments follow the punctuation', 'comment-filler', quotedList, 'comment'],
]

/** Rules whose notes may name the matched word. */
export const WORD_RULES = new Set([
  'hype-word', 'intensifier', 'ai-word', 'metaphor-noun', 'filler', 'chat-leftover', 'hedge',
  'plain-word', 'procedure-word', 'comment-filler', 'extra-word', 'zh-filler', 'zh-hype',
])

/**
 * Build the word lists from the text of the plain-docs SKILL.md.
 * @param {string} skillText - SKILL.md contents. An empty string gives empty lists.
 * @param {{extraWords?: string[], allowPhrases?: string[]}} [opts]
 * @returns {{groups: {rule: string, where: string, re: RegExp}[], allow: RegExp | null, count: number}}
 */
export function buildLists(skillText, opts = {}) {
  const bucket = new Map()
  const add = (rule, where, words, cjk = false) => {
    const k = `${rule}|${where}|${cjk}`
    if (!bucket.has(k)) bucket.set(k, { rule, where, cjk, words: [] })
    bucket.get(k).words.push(...words)
  }
  const allow = [...(opts.allowPhrases || [])]
  for (const raw of String(skillText || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('Terms of art stay:')) allow.push(...colonList(line))
    const zh = /^- (填充和强调|空洞大词)：([^。]+)/.exec(line)
    if (zh) add(zh[1] === '空洞大词' ? 'zh-hype' : 'zh-filler', 'any', zh[2].split('、').filter((w) => !w.includes('…')), true)
    for (const [prefix, rule, pick, where = 'any'] of SKILL_LINES) {
      if (!line.startsWith(prefix)) continue
      for (const w of pick(line)) {
        // A lone capitalized word, like "Overall", is filler only when it opens a sentence.
        const lone = /^[A-Z][a-z]+$/.test(w)
        add(rule, where === 'any' && lone ? 'start' : where, [w])
      }
    }
  }
  if (opts.extraWords && opts.extraWords.length) add('extra-word', 'any', opts.extraWords)
  const groups = []
  let count = 0
  for (const b of bucket.values()) {
    const re = compile(b.words, b.cjk)
    if (!re) continue
    count += new Set(b.words).size
    groups.push({ rule: b.rule, where: b.where, re })
  }
  return { groups, allow: allow.length ? compile(allow, false) : null, count }
}

const COMMON_NAMES = new Set(['user', 'users', 'admin', 'administrator', 'root', 'dev', 'test', 'home', 'public', 'default', 'guest', 'owner'])

/**
 * A pattern for the account name and the home folder. It is built at run time
 * and must never be written to disk or to a note.
 * @returns {RegExp | null}
 */
export function privatePattern(env = {}) {
  const home = env.home || homedir()
  const short = env.shortHome && env.shortHome.toLowerCase() !== home.toLowerCase() ? env.shortHome : null
  const names = env.names || [process.env.USERNAME, process.env.USER, (() => {
    try {
      return userInfo().username
    } catch {
      return ''
    }
  })(), path.basename(home)]
  if (short) names.push(path.win32.basename(short))
  const parts = []
  for (const n of new Set(names.filter(Boolean).map((s) => String(s).trim()))) {
    if (n.length < 3 || COMMON_NAMES.has(n.toLowerCase())) continue
    parts.push(`(?<![A-Za-z0-9])${n.split(/[\s._-]+/).map(esc).join('[\\s._-]*')}(?![A-Za-z0-9])`)
  }
  for (const h of [home, short]) if (h && h.length > 3) parts.push(home.split(/[\\/]+/).map(esc).join('[\\\\/]+'))
  return parts.length ? new RegExp(parts.join('|'), 'i') : null
}

const CJK = /[㐀-鿿　-〿＀-￯]/
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}]/u
const BANNER = /^\s*([=\-*#~_])\1{3,}|([=\-*#~_])\2{3,}\s*$/
const LABEL = /^(constants?|helpers?|helper functions?|imports?|variables?|types?|utils?|utilities|main|initiali[sz]e variables|setup|config(uration)?|exports?|functions?|classes|globals?)[.:]?$/i
const HISTORY = /\b(changed (?:to|from)|added (?:for|to fix)|updated to|as requested|as discussed|new improved|improved version|fixed the bug|was (?:added|changed|removed|refactored)|refactored (?:to|from))\b/i
const DIRECTIVE = /^\s*(eslint|prettier|@ts-|ts-|noqa|type:|pylint|pragma|istanbul|c8 |v8 ignore|#?region|#?endregion|spdx|copyright|nolint|go:|requires |shellcheck)/i
const LICENSE = /copyright|license|spdx/i
const SENTENCE_START = /(^\s*(?:[-*+]\s+|\d+[.)]\s+|#+\s+)?|[.!?]["')\]]?\s+)$/

const normalize = (s) => String(s).trim().replace(/\s+/g, ' ').toLowerCase()

function ranges(re, text) {
  const out = []
  if (!re) return out
  re.lastIndex = 0
  for (const m of text.matchAll(re)) out.push([m.index, m.index + m[0].length])
  return out
}

const inside = (rs, at) => rs.some(([a, b]) => at >= a && at < b)

/**
 * Check text against the rules.
 * @param {string} text - the whole file, or a commit or PR message.
 * @param {{kind: 'doc' | 'code' | 'message', ext?: string}} target
 * @param {ReturnType<typeof buildLists>} lists
 * @param {RegExp | null} [priv] - pattern from privatePattern.
 * @returns {{rule: string, line: number, key: string, word?: string, low?: boolean, quoted?: boolean, span?: number[]}[]}
 *   Findings with 1-based line numbers. `span` lists every 0-based line a block finding covers.
 */
export function analyze(text, target, lists, priv = null) {
  const raw = String(text).split(/\r?\n/)
  const found = []
  const seen = new Set()
  const add = (rule, i, extra = {}) => {
    const id = `${rule}|${i}|${extra.word || ''}`
    if (seen.has(id)) return
    seen.add(id)
    found.push({ rule, line: i + 1, key: normalize(raw[i] ?? ''), ...extra })
  }
  if (priv) raw.forEach((l, i) => priv.test(l) && add('user-name', i))

  const lineRules = (t, i, ctx) => {
    const quotes = ranges(/"[^"]{2,}"|“[^”]+”/g, t)
    const flag = (rule, at, extra = {}) => add(rule, i, inside(quotes, at) ? { ...extra, quoted: true, low: true } : extra)
    const dash = t.indexOf('—')
    if (dash >= 0) {
      if (CJK.test(t)) flag('cjk-dash', dash, { low: true })
      else flag('em-dash', dash)
    }
    const en = /\s–\s/.exec(t)
    if (en) flag('en-dash', en.index)
    const semi = /;\s+\S/.exec(t)
    if (semi && !(ctx.comment && (/[;{}]\s*$/.test(t) || /\bfor\s*\(/.test(t)))) flag('semicolon', semi.index)
    if (ctx.comment || ctx.message || ctx.heading || ctx.bullet) {
      const e = EMOJI.exec(t)
      if (e) flag('emoji', e.index)
    }
    const allowed = ranges(lists.allow, t)
    for (const g of lists.groups) {
      if (g.where === 'comment' && !ctx.comment) continue
      if (g.where === 'numbered' && !ctx.numbered) continue
      g.re.lastIndex = 0
      for (const m of t.matchAll(g.re)) {
        if (inside(allowed, m.index)) continue
        if (g.where === 'start' && !SENTENCE_START.test(t.slice(0, m.index))) continue
        flag(g.rule, m.index, { word: m[0].toLowerCase().replace(/\s+/g, ' ') })
      }
    }
  }

  if (target.kind === 'code') {
    const comments = scanComments(text, target.ext)
    if (!comments) return found
    const blocks = new Map()
    for (const c of comments) {
      if (!blocks.has(c.block)) blocks.set(c.block, [])
      blocks.get(c.block).push(c)
    }
    for (const group of blocks.values()) {
      const filled = group.filter((c) => c.text.trim())
      for (const c of filled) {
        const t = c.text
        if (BANNER.test(t)) {
          add('banner', c.i)
          continue
        }
        if (DIRECTIVE.test(t)) continue
        if (c.own && filled.length === 1 && !c.doc && LABEL.test(t.trim())) add('block-label', c.i)
        if (/^\s*step \d+\b/i.test(t)) add('step-comment', c.i)
        if (HISTORY.test(t)) add('history', c.i)
        lineRules(t, c.i, { comment: true })
      }
      const license = group[0].i < 3 && filled.some((c) => LICENSE.test(c.text))
      if (!group[0].doc && !license && filled.length > 3) add('long-comment', filled[0].i, { span: filled.map((c) => c.i) })
    }
    return found
  }

  for (const p of scanProse(text)) {
    if (target.kind === 'message' && /^(#|[A-Za-z-]+-by:|Change-Id:|Refs?:|Fixes:|Closes:)/i.test(p.text.trim())) continue
    lineRules(p.text, p.i, { ...p, message: target.kind === 'message' })
  }
  return found
}
