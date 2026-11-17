/**
 * plain-docs-guard: make DSH agents load the plain-docs skill before they
 * write docs, comments, or commit messages, then check the text they added.
 *
 * - The load gate is a prepended `tools/pre-execute` listener. It denies a
 *   writing call until the agent session has loaded the skill.
 * - The text check runs in `tools/post-execute`. It never blocks. It attaches
 *   a note with the new findings to the result.
 *
 * @module dsh-plain-docs-guard
 */

import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'
import { createClassifier } from './classify.js'
import { WORD_RULES, analyze, buildLists, detectShortHome, privatePattern } from './rules.js'
import { addedLines, byteSize, createState, fingerprint, pathKey } from './state.js'

export const name = 'plain-docs-guard'
export const inject = ['tools']

const CHECK_MAX_BYTES = 4 * 1024 * 1024
const PENDING_MAX_AGE_MS = 10 * 60 * 1000
const DENIALS_BEFORE_REMIND = 2

export const Config = Schema.object({
  gate: Schema.union(['deny', 'remind', 'off'])
    .default('deny')
    .description('deny blocks writing calls until the skill is loaded. remind lets them through with a reminder. off disables the gate.'),
  check: Schema.boolean().default(true).description('Check the text an agent added after each writing call.'),
  maxNotesPerTurn: Schema.natural().default(2).description('Notes per agent per turn.'),
  maxFindingsPerNote: Schema.natural().default(10).description('Findings listed in one note before the rest become a count.'),
  skillName: Schema.string().default('plain-docs').description('Skill to require.'),
  skillFile: Schema.string()
    .default('')
    .description('Path to the SKILL.md that holds the word lists. Empty means ~/.dsh/skills/<skillName>/SKILL.md.'),
  docExtensions: Schema.array(Schema.string().min(1))
    .default(['.md', '.mdx', '.rst', '.txt'])
    .description('File extensions the gate treats as docs. README, CHANGELOG, and CONTRIBUTING files always count.'),
  fileTools: Schema.array(Schema.string().min(1))
    .default(['write', 'edit', 'str_replace_editor'])
    .description('File tools to watch.'),
  shellTools: Schema.array(Schema.string().min(1)).default(['pwsh', 'bash']).description('Shell tools to watch.'),
  ignorePaths: Schema.array(Schema.string().min(1))
    .default(['node_modules', 'vendor', 'dist', '.git'])
    .description('Folder names never gated or checked. Lock files are always ignored.'),
  extraWords: Schema.array(Schema.string().min(1)).default([]).description("Words to flag on top of the skill's lists."),
  allowPhrases: Schema.array(Schema.string().min(1))
    .default(['DeepSeek Harness'])
    .description('Phrases the word lists never flag, such as product names.'),
  stateFile: Schema.string()
    .default('')
    .description('Where baselines and fingerprints are kept. Empty means ~/.dsh/plugins/dsh-plain-docs-guard/state.json.'),
})

const expand = (p) => p.replace(/^~(?=$|[\\/])/, homedir()).replace(/%USERPROFILE%/gi, homedir())

/**
 * Build the note text for one target.
 * @param {string} target - display name, such as a relative path.
 * @param {object} r - counts and the new findings.
 * @param {number} max - findings to list before the rest become a count.
 */
export function buildNote(target, r, max) {
  const lines = [
    `<plain_docs_check target=${JSON.stringify(target)}>`,
    "Control text from plain-docs-guard. Don't copy any of it into the file.",
    `new=${r.fresh.length}; resolved=${r.resolved}; open=${r.open}`,
  ]
  if (r.noBaseline) lines.push('baseline=none. This file had no earlier snapshot, so all of its text was checked.')
  const sorted = [...r.fresh].sort((a, b) => (a.low ? 1 : 0) - (b.low ? 1 : 0) || a.line - b.line)
  for (const f of sorted.slice(0, max)) {
    const word = WORD_RULES.has(f.rule) && f.word ? `; word=${f.word}` : ''
    lines.push(`finding rule=${f.rule}; line=${f.line}${word}${f.quoted ? ' (quoted)' : ''}`)
  }
  if (sorted.length > max) lines.push(`more=${sorted.length - max}`)
  lines.push('Fix with the smallest edit. Prefer cutting to rewording.', '</plain_docs_check>')
  return lines.join('\n')
}

export function apply(ctx, config = {}) {
  let cfg
  try {
    cfg = Config(config)
  } catch {
    cfg = Config({})
  }
  const warn = (message) => {
    try {
      ctx.logger?.warn?.(`plain-docs-guard: ${message}`)
    } catch {
      // No logger in this context.
    }
  }

  const skillFile = cfg.skillFile ? expand(cfg.skillFile) : path.join(homedir(), '.dsh', 'skills', cfg.skillName, 'SKILL.md')
  let skillText = ''
  let gate = cfg.gate
  if (existsSync(skillFile)) {
    skillText = readFileSync(skillFile, 'utf8')
  } else {
    // Name the skill, not its path: the path holds the account name, and logs are kept.
    const where = cfg.skillFile ? 'at the configured skillFile' : `in ~/.dsh/skills/${cfg.skillName}`
    if (gate !== 'off') warn(`the ${cfg.skillName} skill was not found ${where}. The gate is off and the word lists are empty.`)
    gate = 'off'
  }
  const lists = buildLists(skillText, cfg)
  let priv = privatePattern()
  // The 8.3 short home path needs a child process, so add it when the lookup returns.
  detectShortHome().then(
    (shortHome) => {
      if (shortHome) priv = privatePattern({ shortHome })
    },
    () => {},
  )
  const classifier = createClassifier(cfg)
  const state = createState({
    file: cfg.stateFile ? expand(cfg.stateFile) : path.join(homedir(), '.dsh', 'plugins', 'dsh-plain-docs-guard', 'state.json'),
    // An error message can hold the state file path, so leave it out.
    onError: (e) => warn(`could not write the state file (${e && e.code ? e.code : 'error'}).`),
  })

  const sessions = new WeakMap()
  const turns = new Map()
  const pending = new Map()

  const sessionState = (agent) => {
    const key = agent && (agent.session || agent)
    if (!key || typeof key !== 'object') return null
    // `denials` counts steps with a denial, not calls, so parallel calls in one step count once.
    if (!sessions.has(key)) sessions.set(key, { loaded: false, denials: 0, deniedThisStep: false, remind: false })
    return sessions.get(key)
  }
  const turnState = (agent, turn) => {
    const id = agent?.id ?? 'none'
    const t = turns.get(id)
    // A new turn number resets the cap, even when the last turn was cut short before turn-stopping.
    if (!t || (turn !== undefined && t.turn !== undefined && t.turn !== turn)) {
      turns.set(id, { notes: 0, reminded: false, turn })
    } else if (t.turn === undefined && turn !== undefined) t.turn = turn
    return turns.get(id)
  }
  const callKey = (exec) => exec.token ?? exec.callId ?? exec
  const isSkill = (value) => value === cfg.skillName || (typeof value === 'string' && value.endsWith(`:${cfg.skillName}`))
  const skillToolHidden = (exec) => {
    try {
      return typeof ctx.tools.get === 'function' && ctx.tools.get('skill', exec.agent) === undefined
    } catch {
      return false
    }
  }
  const message = (text) => createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: name } })

  const denial = `plain-docs-guard: Load the ${cfg.skillName} skill first: call \`skill\` with {"name":"${cfg.skillName}"}, then run this call again.`
  const reminder = [
    '<plain_docs_check>',
    "Control text from plain-docs-guard. Don't copy any of it into the file.",
    `The ${cfg.skillName} skill is not loaded. Call \`skill\` with {"name":"${cfg.skillName}"} before the next doc, comment, or commit message.`,
    '</plain_docs_check>',
  ].join('\n')

  /** Read each target before the call runs, so the check can tell added text from old text. */
  async function snapshot(work) {
    for (const f of work.files) {
      try {
        const text = await readFile(f.path, 'utf8')
        if (byteSize(text) <= CHECK_MAX_BYTES) f.before = text
      } catch (e) {
        if (e && e.code === 'ENOENT') f.before = ''
      }
    }
  }

  function displayName(file, cwd) {
    const rel = cwd ? path.relative(cwd, file) : ''
    const shown = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel.split(path.sep).join('/') : path.basename(file)
    return priv && priv.test(shown) ? path.basename(file) : shown
  }

  /** Check one file. Returns the note text and what to store, or null when nothing is new. */
  async function checkFile(f, cwd) {
    let after
    try {
      after = await readFile(f.path, 'utf8')
    } catch {
      return null
    }
    if (byteSize(after) > CHECK_MAX_BYTES) return null
    await state.ready
    const key = pathKey(f.path)
    const prev = state.tracked(key)
    const before = f.before ?? state.baseline(key)
    state.setBaseline(key, after)
    if (before === after && !prev.pending.size) return null
    const noBaseline = before === undefined
    const added = noBaseline ? null : addedLines(before, after)
    const all = analyze(after, f, lists, priv).map((x) => ({ ...x, fp: fingerprint(key, x) }))
    const present = new Set(all.map((x) => x.fp))
    const isAdded = (x) => !added || (x.span || [x.line - 1]).some((i) => added.has(i))
    const open = new Set([...prev.open].filter((fp) => present.has(fp)))
    const fresh = []
    const freshSeen = new Set()
    for (const x of all) {
      const isNew = prev.pending.has(x.fp) || (isAdded(x) && !prev.open.has(x.fp))
      if (isAdded(x) || prev.pending.has(x.fp)) open.add(x.fp)
      if (isNew && !freshSeen.has(x.fp)) {
        freshSeen.add(x.fp)
        fresh.push(x)
      }
    }
    const resolved = [...prev.open].filter((fp) => !present.has(fp)).length
    const result = { fresh, resolved, open: open.size, noBaseline }
    return {
      fresh,
      note: () => buildNote(displayName(f.path, cwd), result, cfg.maxFindingsPerNote),
      report: () => state.setTracked(key, open, new Set()),
      // Over the cap: hold the new findings back, so the next check reports them.
      hold: () => state.setTracked(key, new Set([...open].filter((fp) => !freshSeen.has(fp))), freshSeen),
    }
  }

  async function checkMessage(m) {
    let text = m.text
    if (text === undefined) {
      try {
        text = await readFile(m.file, 'utf8')
      } catch {
        return null
      }
    }
    const fresh = analyze(text, { kind: 'message' }, lists, priv)
    const result = { fresh, resolved: 0, open: fresh.length, noBaseline: false }
    return { fresh, note: () => buildNote(m.label, result, cfg.maxFindingsPerNote), report() {}, hold() {} }
  }

  ctx.on(
    'tools/pre-execute',
    async (exec, next) => {
      let work = null
      try {
        work = await classifier.classify(exec)
      } catch (e) {
        warn(`could not classify a ${exec.name} call: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!work) return next()
      const session = sessionState(exec.agent)
      if (work.gate && gate !== 'off' && session && !session.loaded) {
        if (gate === 'deny' && !session.remind && skillToolHidden(exec)) session.remind = true
        if (gate === 'deny' && !session.remind) {
          if (session.deniedThisStep || session.denials < DENIALS_BEFORE_REMIND) {
            if (!session.deniedThisStep) session.denials++
            session.deniedThisStep = true
            return { kind: 'deny', reason: denial }
          }
          session.remind = true
          warn(`a session was denied ${DENIALS_BEFORE_REMIND} times without loading ${cfg.skillName}. It now gets reminders instead.`)
        }
        work.remind = true
      }
      if (cfg.check) await snapshot(work)
      if (cfg.check || work.remind) {
        const now = Date.now()
        if (pending.size > 50) for (const [k, w] of pending) if (now - w.ts > PENDING_MAX_AGE_MS) pending.delete(k)
        work.ts = now
        pending.set(callKey(exec), work)
      }
      return next()
    },
    { prepend: true },
  )

  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    try {
      const session = sessionState(exec.agent)
      if (exec.name === 'skill' && session && !result?.isError && isSkill(exec.arguments?.name)) session.loaded = true
      const work = pending.get(callKey(exec))
      if (!work) return decision
      pending.delete(callKey(exec))
      if (result?.isError || !decision) return decision
      const turn = turnState(exec.agent)
      const blocks = []
      if (work.remind && session && !session.loaded && !turn.reminded) {
        turn.reminded = true
        blocks.push(reminder)
      }
      if (cfg.check) {
        const cwd = exec.agent?.session?.header?.cwd
        const checks = []
        for (const f of work.files) checks.push(await checkFile(f, cwd))
        for (const m of work.messages) checks.push(await checkMessage(m))
        const withNew = checks.filter((c) => c && c.fresh.length)
        const capped = turn.notes >= cfg.maxNotesPerTurn
        for (const c of checks) if (c) (capped && c.fresh.length ? c.hold : c.report)()
        if (work.files.length) state.save()
        if (withNew.length && !capped) {
          turn.notes++
          blocks.push(...withNew.map((c) => c.note()))
        }
      }
      if (!blocks.length) return decision
      return { ...decision, additionalContexts: [...(decision.additionalContexts ?? []), message(blocks.join('\n\n'))] }
    } catch (e) {
      warn(`check failed: ${e instanceof Error ? e.message : String(e)}`)
      return decision
    }
  })

  // Each step starts a new denial count, and a new turn resets the note cap.
  // A user can also load the skill by typing /plain-docs. tool-skill then adds its text to the step.
  ctx.on(
    'agent/pre-step',
    async (payload, next) => {
      const current = sessionState(payload?.agent)
      if (current) current.deniedThisStep = false
      if (payload?.agent) turnState(payload.agent, payload.turn)
      const decision = await next()
      try {
        const loaded = (decision?.messages || []).some((m) => m?.source?.kind === 'skill-invocation' && isSkill(m.source.name))
        const session = loaded && sessionState(payload?.agent)
        if (session) session.loaded = true
      } catch {
        // The payload had an unexpected shape. The gate stays as it was.
      }
      return decision
    },
    { prepend: true },
  )

  ctx.on('agent/turn-stopping', (payload) => {
    if (payload?.agent) turns.delete(payload.agent.id ?? 'none')
  })
  ctx.on('agent/disposed', (payload) => {
    if (payload?.agent) turns.delete(payload.agent.id ?? 'none')
  })
}
