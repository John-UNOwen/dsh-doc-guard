// Loads the plugin into the Cordis runtime that ships with DSH (see
// dsh-runtime.mjs) and drives it through the same calls DSH's tool runtime makes.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import fs from 'node:fs/promises'
import { homedir, tmpdir, userInfo } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import { createClassifier } from '../lib/classify.js'
import * as plugin from '../lib/index.js'

const DASH = '—'

async function setup(config = {}, tools = {}) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'pdg-'))
  const skillFile = path.join(dir, 'SKILL.md')
  await fs.writeFile(skillFile, '- Adjectives with nothing behind them: powerful, seamless. Cut them.\n')
  const ctx = new Context()
  ctx.provide('tools')
  ctx.set('tools', { guard: () => () => {}, get: () => ({}), ...tools })
  const stateFile = path.join(dir, 'state', 'state.json')
  await ctx.plugin(plugin, { skillFile, stateFile, ...config })
  const cwd = path.join(dir, 'repo')
  await fs.mkdir(cwd)
  return { ctx, dir, cwd, stateFile, agent: newAgent('agent-1', cwd) }
}

const newAgent = (id, cwd) => ({ id, session: { header: { cwd } } })
let seq = 0
const call = (agent, name, args) => ({ name, arguments: args, agent, callId: `call-${++seq}`, token: `token-${seq}` })
const pre = (ctx, exec) => ctx.waterfall(ctx, 'tools/pre-execute', exec, () => Promise.resolve({ kind: 'allow' }))
const post = (ctx, exec, result = { isError: false }) =>
  ctx.waterfall(ctx, 'tools/post-execute', exec, result, () => Promise.resolve({ kind: 'accept' }))
const notes = (decision) => (decision.additionalContexts || []).map((m) => m.content[0].text)
/** Start a model step, the way the agent loop does before each request. */
const step = (ctx, agent, turn = 1) =>
  ctx.waterfall(ctx, 'agent/pre-step', { agent, messages: [], turn, step: 0 }, () => Promise.resolve({ kind: 'enter', messages: [] }))
/** Run `fn` with DSH_HOME and DSH_AGENTS_HOME pointing at empty temp folders. */
async function withHomes(fn) {
  const saved = [process.env.DSH_HOME, process.env.DSH_AGENTS_HOME]
  const dsh = await fs.mkdtemp(path.join(tmpdir(), 'pdg-dsh-'))
  process.env.DSH_HOME = dsh
  process.env.DSH_AGENTS_HOME = await fs.mkdtemp(path.join(tmpdir(), 'pdg-agents-'))
  try {
    return await fn(dsh)
  } finally {
    for (const [k, v] of [['DSH_HOME', saved[0]], ['DSH_AGENTS_HOME', saved[1]]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

/** Load the plugin next to DSH's own skill registry, with the skill file left to discovery. */
async function withRegistry(config = {}) {
  const ctx = new Context()
  ctx.provide('tools')
  ctx.set('tools', { guard: () => () => {}, get: () => ({}) })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(plugin, { skillFile: '', stateFile: path.join(process.env.DSH_HOME, 'state.json'), ...config })
  await sleep(0)
  return { ctx, registry: ctx.get('skills') }
}

const classifier = createClassifier(plugin.Config({}))
const classify = (agent, name, args) => classifier.classify({ name, arguments: args, agent })

async function loadSkill(ctx, agent, name = 'plain-docs') {
  const exec = call(agent, 'skill', { name })
  assert.equal((await pre(ctx, exec)).kind, 'allow')
  await post(ctx, exec)
}

/** Run a `write` call that replaces the file, the way the tool runtime does. */
async function write(ctx, agent, file, content) {
  const exec = call(agent, 'write', { file_path: file, content })
  const gate = await pre(ctx, exec)
  if (gate.kind !== 'allow') return { gate, notes: [] }
  await fs.writeFile(path.resolve(agent.session.header.cwd, file), content)
  return { gate, notes: notes(await post(ctx, exec)) }
}

async function shell(ctx, agent, command, effect = async () => {}) {
  const exec = call(agent, 'pwsh', { command })
  const gate = await pre(ctx, exec)
  if (gate.kind !== 'allow') return { gate, notes: [] }
  await effect()
  return { gate, notes: notes(await post(ctx, exec)) }
}

async function readState(stateFile, expected) {
  for (let i = 0; i < 100; i++) {
    const raw = existsSync(stateFile) ? await fs.readFile(stateFile, 'utf8') : ''
    if (expected(raw)) return raw
    await sleep(20)
  }
  throw new Error('the state file never held the expected text')
}

describe('load gate', () => {
  it('denies a README edit before the skill call and allows it after', async () => {
    const { ctx, agent } = await setup()
    const edit = () => call(agent, 'edit', { file_path: 'README.md', old_string: 'teh', new_string: 'the' })
    const denied = await pre(ctx, edit())
    assert.equal(denied.kind, 'deny')
    assert.match(denied.reason, /Load the plain-docs skill first: call `skill` with \{"name":"plain-docs"\}, then run this call again\./)
    await loadSkill(ctx, agent)
    assert.equal((await pre(ctx, edit())).kind, 'allow')
  })

  it('denies a second agent session again', async () => {
    const { ctx, agent, cwd } = await setup()
    await loadSkill(ctx, agent)
    const other = newAgent('agent-2', cwd)
    assert.equal((await pre(ctx, call(other, 'write', { file_path: 'docs/a.md', content: 'x' }))).kind, 'deny')
    assert.equal((await pre(ctx, call(agent, 'write', { file_path: 'docs/a.md', content: 'x' }))).kind, 'allow')
  })

  it('never denies a code edit with no comment change', async () => {
    const { ctx, agent, cwd } = await setup()
    await fs.writeFile(path.join(cwd, 'a.js'), '// Keep the cache warm.\nrun()\n')
    const calls = [
      call(agent, 'edit', { file_path: 'a.js', old_string: 'run()', new_string: 'run(1)' }),
      call(agent, 'edit', { file_path: 'a.js', old_string: '// Keep the cache warm.\nrun()', new_string: '// Keep the cache warm.\nrun(2)' }),
      call(agent, 'write', { file_path: 'a.js', content: '// Keep the cache warm.\nrun(3)\n' }),
      call(agent, 'write', { file_path: 'data.json', content: '{"a": "// not a comment"}' }),
    ]
    for (const exec of calls) assert.equal((await pre(ctx, exec)).kind, 'allow')
  })

  it('denies a code edit that adds or changes a comment', async () => {
    for (const [file, text] of [['a.js', 'run() // retry once'], ['a.py', '"""Return the count."""'], ['a.ps1', '# Retry once.'], ['a.abap', '* Retry once.']]) {
      const { ctx, agent } = await setup()
      assert.equal((await pre(ctx, call(agent, 'edit', { file_path: file, old_string: 'x', new_string: text }))).kind, 'deny', file)
    }
  })

  it('gates commits, PR text, and shell writes to doc paths', async () => {
    const { ctx, agent } = await setup()
    const gated = [
      'git commit -m "Fix retry count"',
      'git add -A; git commit -am "Fix retry count"',
      'git commit -F msg.txt',
      'gh pr create --title "Fix retry" --body "x"',
      'gh pr edit 12 --body "x"',
      'Set-Content -Path README.md -Value "x"',
      '"x" | Out-File docs/guide.md',
      'Add-Content CHANGELOG -Value "x"',
      'echo x >> notes.txt',
      'echo "a; b" > notes.md',
      "cat > notes.md <<'EOF'\nA line.\nEOF",
      "(Get-Content a.md) -replace 'old','new' | Set-Content a.md",
      '$text | Set-Content README.md',
      'npm test; Set-Content -Path README.md -Value "x"',
    ]
    const free = [
      'git status',
      'git commit --amend --no-edit',
      'git log -m',
      'Get-Content README.md',
      'Set-Content -Path out.json -Value "x"',
      'node build.js 2>&1 > build.log',
      'Set-Content node_modules/pkg/README.md -Value "x"',
      'npm test > results.txt',
      'git diff > changes.md',
      'Get-Process | Out-File procs.txt',
      'cat a.md b.md > c.md',
      'node gen.js | Tee-Object -FilePath out.md',
    ]
    for (const command of gated) {
      const fresh = await setup()
      assert.equal((await pre(fresh.ctx, call(fresh.agent, 'pwsh', { command }))).kind, 'deny', command)
    }
    for (const command of free) assert.equal((await pre(ctx, call(agent, 'pwsh', { command }))).kind, 'allow', command)
  })

  it('skips reads, ignored paths, lock files, and legal text', async () => {
    const { ctx, agent } = await setup()
    const free = [
      call(agent, 'str_replace_editor', { command: 'view', path: 'README.md' }),
      call(agent, 'str_replace_editor', { path: 'README.md' }),
      call(agent, 'write', { file_path: 'node_modules/x/README.md', content: 'x' }),
      call(agent, 'write', { file_path: 'pnpm-lock.yaml', content: '# x' }),
      call(agent, 'write', { file_path: 'LICENSE.md', content: 'x' }),
      call(agent, 'write', { file_path: 'requirements.txt', content: 'x' }),
      call(agent, 'read', { file_path: 'README.md' }),
    ]
    for (const exec of free) assert.equal((await pre(ctx, exec)).kind, 'allow', JSON.stringify(exec.arguments))
    const gated = call(agent, 'str_replace_editor', { command: 'create', path: 'CONTRIBUTING', file_text: 'x' })
    assert.equal((await pre(ctx, gated)).kind, 'deny')
  })

  it('denies a comment edit inside an existing block comment or docstring', async () => {
    const { ctx, agent, cwd } = await setup()
    await fs.writeFile(path.join(cwd, 'a.js'), '/**\n * Returns the count.\n */\nfunction count() {\n  return 1\n}\n')
    await fs.writeFile(path.join(cwd, 'a.py'), 'def f():\n    """Return the count.\n\n    Counts every row.\n    """\n    return 1\n')
    await fs.writeFile(path.join(cwd, 'crlf.js'), '/**\r\n * Returns the count.\r\n */\r\nrun()\r\n')
    const gated = [
      ['a.js', ' * Returns the count.', ' * Returns the count, seamlessly.'],
      ['a.py', '    Counts every row.', '    Counts every row; always.'],
      ['crlf.js', ' * Returns the count.\n */', ' * Returns the total.\n */'],
    ]
    for (const [file, old_string, new_string] of gated) {
      assert.equal((await classify(agent, 'edit', { file_path: file, old_string, new_string })).gate, true, file)
    }
    const free = await classify(agent, 'edit', { file_path: 'a.js', old_string: '  return 1', new_string: '  return 2' })
    assert.equal(free.gate, false)
    const insert = await classify(agent, 'str_replace_editor', { command: 'insert', path: 'a.py', insert_line: 2, new_str: '    More text.' })
    assert.equal(insert.gate, true)
    assert.equal((await pre(ctx, call(agent, 'edit', { file_path: 'a.js', old_string: gated[0][1], new_string: gated[0][2] }))).kind, 'deny')
  })

  it('reads commit flags only from the git commit statement', async () => {
    const { agent } = await setup()
    const texts = async (command) => (await classify(agent, 'pwsh', { command })).messages.map((m) => m.text)
    assert.deepEqual(await texts('python -m pytest; git commit -m "Fix x"'), ['Fix x'])
    assert.deepEqual(await texts('Invoke-Thing -Param "a"; git -C repo commit -m "Fix y"'), ['Fix y'])
    assert.deepEqual(await texts('git commit -m "a; b && c" && git push'), ['a; b && c'])
    assert.deepEqual(await texts("git commit -m @'\nLine one; two.\n'@"), ['Line one; two.'])
  })

  it('counts denials per step, so parallel calls in one step are all denied', async () => {
    const { ctx, agent } = await setup()
    await step(ctx, agent)
    const batch = await Promise.all(['README.md', 'CHANGELOG.md', 'docs/a.md'].map((f) => write(ctx, agent, f, 'One.\n')))
    assert.deepEqual(batch.map((r) => r.gate.kind), ['deny', 'deny', 'deny'])
    await step(ctx, agent)
    assert.equal((await write(ctx, agent, 'README.md', 'One.\n')).gate.kind, 'deny', 'the second denied step')
  })

  it('switches a session to reminders after two denied steps', async () => {
    const { ctx, agent } = await setup()
    await step(ctx, agent)
    const first = await write(ctx, agent, 'README.md', 'One.\n')
    await step(ctx, agent)
    const second = await write(ctx, agent, 'README.md', 'One.\n')
    assert.deepEqual([first.gate.kind, second.gate.kind], ['deny', 'deny'])
    await step(ctx, agent)
    const third = await write(ctx, agent, 'README.md', 'One.\n')
    assert.equal(third.gate.kind, 'allow')
    assert.equal(third.notes.length, 1)
    assert.match(third.notes[0], /skill is not loaded/)
    const fourth = await write(ctx, agent, 'README.md', 'Two.\n')
    assert.deepEqual(fourth.notes, [], 'one reminder per turn')
  })

  it('remind mode lets the call through with a reminder, and off does nothing', async () => {
    const remind = await setup({ gate: 'remind' })
    const r = await write(remind.ctx, remind.agent, 'README.md', 'One.\n')
    assert.equal(r.gate.kind, 'allow')
    assert.match(r.notes[0], /^<plain_docs_check>\nControl text from plain-docs-guard\./)
    const off = await setup({ gate: 'off' })
    const o = await write(off.ctx, off.agent, 'README.md', 'One.\n')
    assert.equal(o.gate.kind, 'allow')
    assert.deepEqual(o.notes, [])
  })

  it('logs a missing skill without the home path', async () => {
    const ctx = new Context()
    const logs = []
    ctx.provide('tools')
    ctx.set('tools', { guard: () => () => {}, get: () => ({}) })
    Object.defineProperty(ctx, 'logger', { configurable: true, get: () => ({ warn: (m) => logs.push(m) }) })
    const dir = await fs.mkdtemp(path.join(tmpdir(), 'pdg-log-'))
    await ctx.plugin(plugin, { skillFile: path.join(dir, 'none', 'SKILL.md'), stateFile: path.join(dir, 'state.json') })
    await ctx.plugin(plugin, { skillName: 'no-such-skill-pdg', stateFile: path.join(dir, 'state.json') })
    assert.equal(logs.length, 2)
    assert.match(logs[0], /plain-docs skill was not found at the configured skillFile/)
    assert.match(logs[1], /no-such-skill-pdg skill was not found in ~\/\.dsh\/skills, ~\/\.agents\/skills, or this plugin/)
    for (const line of logs) {
      assert.equal(line.toLowerCase().includes(homedir().toLowerCase()), false)
      assert.equal(line.includes(dir), false)
    }
  })

  it('registers the bundled skill when no copy is installed', async () => {
    await withHomes(async () => {
      const { ctx, registry } = await withRegistry()
      const skills = await registry.list()
      const entry = skills.find((s) => s.name === 'plain-docs')
      assert.ok(entry, 'listed')
      assert.equal(entry.source, 'bundled')
      assert.equal(entry.invocation.modelInvocable, true)
      const loaded = await registry.get('plain-docs')
      assert.match(loaded.content, /^# Plain docs/)
      assert.equal(loaded.content.includes('description:'), false, 'the frontmatter is stripped')
      // The bundled copy also feeds the gate and the word lists.
      const agent = newAgent('agent-1', tmpdir())
      assert.equal((await pre(ctx, call(agent, 'write', { file_path: 'README.md', content: 'x' }))).kind, 'deny')
    })
  })

  it('leaves an installed copy in charge and does not register the bundled one', async () => {
    await withHomes(async (dsh) => {
      await fs.mkdir(path.join(dsh, 'skills', 'plain-docs'), { recursive: true })
      await fs.writeFile(path.join(dsh, 'skills', 'plain-docs', 'SKILL.md'), '---\nname: plain-docs\ndescription: local\n---\n- AI vocabulary: zorbify. Cut it.\n')
      const { ctx, registry } = await withRegistry()
      assert.equal((await registry.list()).some((s) => s.name === 'plain-docs'), false)
      const agent = newAgent('agent-1', await fs.mkdtemp(path.join(tmpdir(), 'pdg-cwd-')))
      await loadSkill(ctx, agent)
      const r = await write(ctx, agent, 'a.md', 'We zorbify it. We delve in.\n')
      assert.match(r.notes[0], /word=zorbify/)
      assert.doesNotMatch(r.notes[0], /delve/, 'the word lists come from the installed copy')
    })
  })

  it('bundleSkill false turns the bundled copy off', async () => {
    await withHomes(async () => {
      const { ctx, registry } = await withRegistry({ bundleSkill: false })
      assert.equal((await registry.list()).some((s) => s.name === 'plain-docs'), false)
      const agent = newAgent('agent-1', tmpdir())
      assert.equal((await pre(ctx, call(agent, 'write', { file_path: 'README.md', content: 'x' }))).kind, 'allow')
    })
  })

  it('the bundled skill matches the parsed frontmatter', () => {
    const text = readFileSync(new URL('../skills/plain-docs/SKILL.md', import.meta.url), 'utf8')
    const { fields, body } = plugin.parseSkill(text)
    assert.equal(fields.name, 'plain-docs')
    assert.match(fields.description, /^Write, edit or review docs/)
    assert.ok(body.startsWith('# Plain docs\n'))
  })

  it('turns the gate off when the skill file is missing', async () => {
    const { ctx, agent, dir } = await setup({ skillFile: path.join(tmpdir(), 'pdg-no-such-skill', 'SKILL.md') })
    assert.ok(dir)
    assert.equal((await write(ctx, agent, 'README.md', 'One.\n')).gate.kind, 'allow')
  })

  it('reminds instead of denying when the agent has no skill tool', async () => {
    const { ctx, agent } = await setup({}, { get: () => undefined })
    const r = await write(ctx, agent, 'README.md', 'One.\n')
    assert.equal(r.gate.kind, 'allow')
    assert.match(r.notes[0], /skill is not loaded/)
  })

  it('counts a skill the user invoked with a slash command', async () => {
    const { ctx, agent } = await setup()
    const injected = { source: { kind: 'skill-invocation', name: 'plain-docs', form: 'instructions' } }
    const decision = await ctx.waterfall(ctx, 'agent/pre-step', { agent, messages: [] }, () => Promise.resolve({ kind: 'enter', messages: [injected] }))
    assert.deepEqual(decision.messages, [injected])
    assert.equal((await write(ctx, agent, 'README.md', 'One.\n')).gate.kind, 'allow')
  })

  it('a failed skill call does not open the gate', async () => {
    const { ctx, agent } = await setup()
    await post(ctx, call(agent, 'skill', { name: 'plain-docs' }), { isError: true })
    await post(ctx, call(agent, 'skill', { name: 'tdd' }))
    assert.equal((await write(ctx, agent, 'README.md', 'One.\n')).gate.kind, 'deny')
  })

  it('a deny does not wait for later listeners, and their deny wins over an allow', async () => {
    const { ctx, agent } = await setup()
    let reached = 0
    ctx.on('tools/pre-execute', async () => (reached++, { kind: 'deny', reason: 'hook says no' }))
    assert.match((await pre(ctx, call(agent, 'write', { file_path: 'README.md', content: 'x' }))).reason, /plain-docs/)
    assert.equal(reached, 0)
    await post(ctx, call(agent, 'skill', { name: 'plain-docs' }))
    reached = 0
    assert.equal((await pre(ctx, call(agent, 'write', { file_path: 'README.md', content: 'x' }))).reason, 'hook says no')
    assert.equal(reached, 1)
  })
})

describe('text check', () => {
  it('reports only the line the agent added', async () => {
    const { ctx, agent, cwd } = await setup()
    await loadSkill(ctx, agent)
    await fs.writeFile(path.join(cwd, 'README.md'), `# Tool\n\nOld line ${DASH} already here.\n`)
    const r = await write(ctx, agent, 'README.md', `# Tool\n\nOld line ${DASH} already here.\nA seamless tool; it works.\n`)
    assert.equal(r.notes.length, 1)
    assert.equal(r.notes[0], [
      '<plain_docs_check target="README.md">',
      "Control text from plain-docs-guard. Don't copy any of it into the file.",
      'new=2; resolved=0; open=2',
      'finding rule=semicolon; line=4',
      'finding rule=hype-word; line=4; word=seamless',
      'Fix with the smallest edit. Prefer cutting to rewording.',
      '</plain_docs_check>',
    ].join('\n'))
  })

  it('does not report the same finding twice, and counts a fixed one as resolved', async () => {
    const { ctx, agent } = await setup()
    await loadSkill(ctx, agent)
    const first = await write(ctx, agent, 'a.md', `One ${DASH} two.\nThree; four.\n`)
    assert.match(first.notes[0], /new=2; resolved=0; open=2/)
    const moved = await write(ctx, agent, 'a.md', `Intro.\n\nOne ${DASH} two.\nThree; four.\n`)
    assert.deepEqual(moved.notes, [], 'the findings moved down two lines and are not new')
    const fixed = await write(ctx, agent, 'a.md', 'Intro.\n\nOne and two.\nThree; four.\nA powerful tool.\n')
    assert.match(fixed.notes[0], /new=1; resolved=1; open=2\nfinding rule=hype-word; line=5; word=powerful/)
    const clean = await write(ctx, agent, 'a.md', 'Intro.\n\nOne and two.\nThree and four.\n')
    assert.deepEqual(clean.notes, [], 'a write that only resolves findings sends no note')
  })

  it('checks comments in code and leaves the code alone', async () => {
    const { ctx, agent, cwd } = await setup()
    await loadSkill(ctx, agent)
    await fs.writeFile(path.join(cwd, 'a.js'), 'const a = 1; const b = 2;\n')
    const r = await write(ctx, agent, 'a.js', `const a = 1; const b = 2;\n// Retry ${DASH} the API drops calls\nrun(a); run(b);\n`)
    assert.match(r.notes[0], /target="a\.js"/)
    assert.match(r.notes[0], /new=1; resolved=0; open=1\nfinding rule=em-dash; line=2\nFix/)
    const fixedComment = await write(ctx, agent, 'a.js', 'const a = 1; const b = 2;\n// Retry. The API drops calls.\nrun(a); run(b);\n')
    assert.deepEqual(fixedComment.notes, [])
  })

  it('uses the baseline when a call has no snapshot', async () => {
    const { ctx, agent, cwd } = await setup()
    await loadSkill(ctx, agent)
    const file = path.join(cwd, 'b.md')
    await write(ctx, agent, 'b.md', `Old ${DASH} line.\nAlso; old.\n`)
    await ctx.serial(ctx, 'agent/turn-stopping', { agent, turn: 1 })
    // Make the snapshot read fail: the file is a folder while pre-execute runs.
    await fs.rm(file)
    await fs.mkdir(file)
    const exec = call(agent, 'edit', { file_path: 'b.md', old_string: 'x', new_string: 'y' })
    assert.equal((await pre(ctx, exec)).kind, 'allow')
    await fs.rmdir(file)
    await fs.writeFile(file, `Old ${DASH} line.\nAlso; old.\nNew; line.\n`)
    const text = notes(await post(ctx, exec))[0]
    assert.match(text, /new=1; resolved=0; open=3\nfinding rule=semicolon; line=3\nFix/)
    assert.doesNotMatch(text, /baseline=none/)
  })

  it('skips shell writes it cannot read, such as a path built from a variable', async () => {
    const { ctx, agent } = await setup()
    await loadSkill(ctx, agent)
    const r = await shell(ctx, agent, 'Set-Content -Path "$dir\\b.md" -Value $text')
    assert.equal(r.gate.kind, 'allow')
    assert.deepEqual(r.notes, [])
  })

  it('resets the note cap when a new turn starts, even without turn-stopping', async () => {
    const { ctx, agent } = await setup()
    await loadSkill(ctx, agent)
    await step(ctx, agent, 1)
    await write(ctx, agent, 'a.md', `One ${DASH} a.\n`)
    await write(ctx, agent, 'b.md', `Two ${DASH} b.\n`)
    assert.deepEqual((await write(ctx, agent, 'c.md', `Three ${DASH} c.\n`)).notes, [])
    await step(ctx, agent, 1)
    assert.deepEqual((await write(ctx, agent, 'd.md', `Four ${DASH} d.\n`)).notes, [], 'a later step of the same turn')
    // The turn was cancelled, so turn-stopping never ran. The next turn still gets notes.
    await step(ctx, agent, 2)
    assert.equal((await write(ctx, agent, 'd.md', `Four ${DASH} d.\nMore.\n`)).notes.length, 1)
  })

  it('checks the whole file and says so when an existing file has no baseline', async () => {
    const { ctx, agent, cwd } = await setup({ maxFindingsPerNote: 2 })
    await loadSkill(ctx, agent)
    const file = path.join(cwd, 'c.md')
    await fs.writeFile(file, 'x')
    const exec = call(agent, 'write', { file_path: 'c.md', content: 'x' })
    await pre(ctx, exec)
    exec.token = `${exec.token}-other`
    exec.callId = `${exec.callId}-other`
    const again = call(agent, 'write', { file_path: file, content: 'x' })
    // Make the read in pre-execute fail by pointing the call at a folder.
    await fs.rm(file)
    await fs.mkdir(file)
    await pre(ctx, again)
    await fs.rmdir(file)
    await fs.writeFile(file, `A ${DASH} b.\nC ${DASH} d.\nE ${DASH} f.\n`)
    const text = notes(await post(ctx, again))[0]
    assert.match(text, /new=3; resolved=0; open=3\nbaseline=none\./)
    assert.match(text, /finding rule=em-dash; line=1\nfinding rule=em-dash; line=2\nmore=1\n/)
  })

  it('holds back a third note in one turn and reports it after the turn ends', async () => {
    const { ctx, agent } = await setup()
    await loadSkill(ctx, agent)
    assert.equal((await write(ctx, agent, 'a.md', `One ${DASH} a.\n`)).notes.length, 1)
    assert.equal((await write(ctx, agent, 'b.md', `Two ${DASH} b.\n`)).notes.length, 1)
    assert.deepEqual((await write(ctx, agent, 'c.md', `Three ${DASH} c.\n`)).notes, [])
    const other = newAgent('agent-2', agent.session.header.cwd)
    await loadSkill(ctx, other)
    assert.equal((await write(ctx, other, 'd.md', `Four ${DASH} d.\n`)).notes.length, 1, 'the cap is per agent')
    await ctx.serial(ctx, 'agent/turn-stopping', { agent, turn: 1 })
    const next = await write(ctx, agent, 'c.md', `Three ${DASH} c.\nPlain line.\n`)
    assert.match(next.notes[0], /target="c\.md"[\s\S]*new=1; resolved=0; open=1\nfinding rule=em-dash; line=1\n/)
  })

  it('checks commit messages and PR text', async () => {
    const { ctx, agent } = await setup()
    await loadSkill(ctx, agent)
    const commit = await shell(ctx, agent, `git commit -m "Fix retry ${DASH} now seamless" -m "Body; more."`)
    assert.match(commit.notes[0], /target="commit message"[\s\S]*rule=em-dash; line=1[\s\S]*rule=hype-word; line=1; word=seamless/)
    assert.match(commit.notes[0], /target="commit message"[\s\S]*target="commit message"[\s\S]*rule=semicolon; line=1/)
    const here = await shell(ctx, agent, `git commit -m @'\nFix retry count\n\nA powerful change.\n\nCo-Authored-By: A powerful bot <a@example.com>\n'@`)
    assert.match(here.notes[0], /new=1; resolved=0; open=1\nfinding rule=hype-word; line=3; word=powerful\n/)
    await ctx.serial(ctx, 'agent/turn-stopping', { agent, turn: 1 })
    const pr = await shell(ctx, agent, `gh pr create --title "Fix retry" --body "Seamless ${DASH} done."`)
    assert.match(pr.notes[0], /target="PR text"[\s\S]*rule=em-dash/)
    const clean = await shell(ctx, agent, 'git commit -m "Fix retry count on timeout"')
    assert.deepEqual(clean.notes, [])
  })

  it('keeps contexts other listeners added and skips failed calls', async () => {
    const { ctx, agent, cwd } = await setup()
    await loadSkill(ctx, agent)
    ctx.on('tools/post-execute', async () => ({ kind: 'accept', additionalContexts: [{ content: [{ type: 'text', text: 'other' }] }] }))
    const exec = call(agent, 'write', { file_path: 'a.md', content: 'x' })
    await pre(ctx, exec)
    await fs.writeFile(path.join(cwd, 'a.md'), `One ${DASH} a.\n`)
    const texts = notes(await post(ctx, exec))
    assert.equal(texts[0], 'other')
    assert.match(texts[1], /rule=em-dash/)
    const failed = call(agent, 'write', { file_path: 'e.md', content: 'x' })
    await pre(ctx, failed)
    await fs.writeFile(path.join(cwd, 'e.md'), `One ${DASH} a.\n`)
    assert.deepEqual(notes(await post(ctx, failed, { isError: true })), ['other'])
  })

  it('check false sends no notes', async () => {
    const { ctx, agent } = await setup({ check: false })
    await loadSkill(ctx, agent)
    assert.deepEqual((await write(ctx, agent, 'a.md', `One ${DASH} a.\n`)).notes, [])
  })

  it('flags the account name without naming it, and keeps it out of the state file', async () => {
    const { ctx, agent, stateFile } = await setup()
    await loadSkill(ctx, agent)
    const names = [...new Set([userInfo().username, path.basename(homedir())])].filter((n) => n.length >= 3)
    const r = await write(ctx, agent, 'a.md', `Install into ${homedir()} first.\nPlain line.\n`)
    assert.match(r.notes[0], /finding rule=user-name; line=1\n/)
    await write(ctx, agent, 'b.md', `One ${DASH} a.\n`)
    const raw = (await readState(stateFile, (text) => (text.match(/"open"/g) || []).length >= 2)).toLowerCase()
    assert.equal(raw.includes('one'), false, 'no file text in the state file')
    for (const n of names) {
      assert.equal(raw.includes(n.toLowerCase()), false)
      assert.equal(r.notes[0].toLowerCase().includes(n.toLowerCase()), false)
    }
  })

  it('reads the word lists from the installed or bundled skill', async () => {
    const { ctx, agent } = await setup({ skillFile: '' })
    await loadSkill(ctx, agent)
    const r = await write(ctx, agent, 'a.md', 'We delve into the flywheel.\n')
    assert.match(r.notes[0], /rule=ai-word; line=1; word=delve\nfinding rule=metaphor-noun; line=1; word=flywheel/)
  })
})
