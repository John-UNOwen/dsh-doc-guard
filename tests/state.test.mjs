import assert from 'node:assert/strict'
import nodeFs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  BASELINE_MAX_BYTES_PER_FILE,
  BASELINE_MAX_FILES,
  FINGERPRINT_VERSION,
  addedLines,
  createState,
  fingerprint,
  pathKey,
} from '../lib/state.js'

const tempFile = async () => path.join(await nodeFs.mkdtemp(path.join(tmpdir(), 'pdg-state-')), 'state.json')

describe('addedLines', () => {
  it('reports only the added line', () => {
    assert.deepEqual([...addedLines('a\nb\nc', 'a\nb\nnew\nc')], [2])
  })

  it('reports a changed line and ignores moved context', () => {
    assert.deepEqual([...addedLines('a\nb\nc\nd', 'a\nB\nc\nd\ne')], [1, 4])
  })

  it('treats every line of a new file as added', () => {
    assert.deepEqual([...addedLines('', 'a\nb')], [0, 1])
  })

  it('reports nothing for equal text or a deletion', () => {
    assert.equal(addedLines('a\nb', 'a\nb').size, 0)
    assert.equal(addedLines('a\nb\nc', 'a\nc').size, 0)
  })

  it('falls back to a line count for very large changes', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => (i === 1500 ? 'fresh' : `old ${i}`)).reverse().join('\n')
    assert.deepEqual([...addedLines(before, after)], [1499])
  })
})

describe('fingerprints', () => {
  it('do not depend on the line number', () => {
    const a = fingerprint('k', { rule: 'em-dash', line: 3, key: 'a line' })
    assert.equal(a, fingerprint('k', { rule: 'em-dash', line: 30, key: 'a line' }))
    assert.notEqual(a, fingerprint('k', { rule: 'semicolon', line: 3, key: 'a line' }))
    assert.notEqual(a, fingerprint('other', { rule: 'em-dash', line: 3, key: 'a line' }))
  })
})

describe('state store', () => {
  it('keeps tracked findings across a reload, and baselines in memory only', async () => {
    const file = await tempFile()
    const a = createState({ file })
    await a.ready
    a.setBaseline('k1', 'baseline text')
    a.setTracked('k1', new Set(['f1']), new Set(['f2']))
    await a.save()
    assert.equal((await nodeFs.readFile(file, 'utf8')).includes('baseline text'), false)
    const b = createState({ file })
    await b.ready
    assert.equal(b.baseline('k1'), undefined)
    assert.deepEqual([...b.tracked('k1').open], ['f1'])
    assert.deepEqual([...b.tracked('k1').pending], ['f2'])
  })

  it('does not cache a file over 512 KB and never truncates one', async () => {
    const s = createState({ file: await tempFile() })
    await s.ready
    s.setBaseline('big', 'x'.repeat(BASELINE_MAX_BYTES_PER_FILE + 1))
    assert.equal(s.baseline('big'), undefined)
    s.setBaseline('fits', 'x'.repeat(BASELINE_MAX_BYTES_PER_FILE))
    assert.equal(s.baseline('fits').length, BASELINE_MAX_BYTES_PER_FILE)
  })

  it('drops the oldest baselines past 20 files or 4 MB', async () => {
    const s = createState({ file: await tempFile() })
    await s.ready
    for (let i = 0; i < BASELINE_MAX_FILES + 2; i++) s.setBaseline(`k${i}`, `text ${i}`)
    assert.equal(s.baseline('k0'), undefined)
    assert.equal(s.baseline('k1'), undefined)
    assert.equal(s.baseline('k2'), 'text 2')
    const t = createState({ file: await tempFile() })
    await t.ready
    for (let i = 0; i < 9; i++) t.setBaseline(`m${i}`, 'x'.repeat(500 * 1024))
    assert.equal(t.baseline('m0'), undefined)
    assert.equal(t.baseline('m1').length, 500 * 1024)
  })

  it('a crash during a write leaves the old file intact', async () => {
    const file = await tempFile()
    const good = createState({ file })
    await good.ready
    good.setTracked('k', new Set(['first']), new Set())
    await good.save()
    const old = await nodeFs.readFile(file, 'utf8')
    for (const broken of ['writeFile', 'rename']) {
      const errors = []
      const fs = { ...nodeFs }
      fs[broken] = async (target, data) => {
        if (broken === 'writeFile') await nodeFs.writeFile(target, String(data).slice(0, 10))
        throw new Error('disk gone')
      }
      const s = createState({ file, fs, onError: (e) => errors.push(e) })
      await s.ready
      s.setTracked('k', new Set(['second']), new Set())
      await s.save()
      assert.equal(errors.length, 1, broken)
      assert.equal(await nodeFs.readFile(file, 'utf8'), old, broken)
    }
  })

  it('a changed FINGERPRINT_VERSION clears stored sets', async () => {
    const file = await tempFile()
    await nodeFs.writeFile(file, JSON.stringify({
      schemaVersion: 2,
      fingerprintVersion: FINGERPRINT_VERSION + 1,
      files: { k: { open: ['f1'], pending: ['f2'], ts: 1 } },
    }))
    const s = createState({ file })
    await s.ready
    assert.equal(s.tracked('k').open.size, 0)
    assert.equal(s.tracked('k').pending.size, 0)
  })

  it('keeps file text and folder names off disk', async () => {
    const file = await tempFile()
    const s = createState({ file })
    await s.ready
    const key = pathKey('C:\\Users\\secret-name\\README.md')
    s.setBaseline(key, 'path C:\\Users\\secret-name\\x')
    s.setTracked(key, new Set(['f1']), new Set())
    await s.save()
    const raw = await nodeFs.readFile(file, 'utf8')
    assert.equal(raw.includes('secret-name'), false)
    assert.ok(raw.includes(key))
  })
})
