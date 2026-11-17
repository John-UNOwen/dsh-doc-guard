/**
 * Line diff, baseline cache, and finding fingerprints for plain-docs-guard.
 * The cache limits and the state file write follow dsh-plugin-writing-guard
 * (see THIRD_PARTY.md).
 *
 * @module dsh-plain-docs-guard/state
 */

import { createHash } from 'node:crypto'
import nodeFs from 'node:fs/promises'
import path from 'node:path'

/** Raise this when the fingerprint inputs change. Stored sets from another version are dropped. */
export const FINGERPRINT_VERSION = 1

export const BASELINE_MAX_FILES = 20
export const BASELINE_MAX_BYTES_PER_FILE = 512 * 1024
export const BASELINE_MAX_TOTAL_BYTES = 4 * 1024 * 1024
const TRACKED_MAX_FILES = 500
const LCS_MAX_CELLS = 4_000_000

export const byteSize = (text) => Buffer.byteLength(text, 'utf8')

const hash = (s, n) => createHash('sha256').update(s).digest('hex').slice(0, n)

/** State key for a path. A hash, so the state file holds no folder names. */
export function pathKey(file) {
  const p = path.resolve(file)
  return hash(process.platform === 'win32' ? p.toLowerCase() : p, 32)
}

/** Fingerprint of a finding: rule, file, line text, and matched word. The line number is left out. */
export function fingerprint(key, finding) {
  return hash(`${FINGERPRINT_VERSION}|${finding.rule}|${key}|${finding.key}|${finding.word || ''}`, 16)
}

/**
 * Lines of `after` that are not in `before`.
 * @returns {Set<number>} 0-based line indexes in `after`.
 */
export function addedLines(before, after) {
  const a = String(before).split(/\r?\n/)
  const b = String(after).split(/\r?\n/)
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length
  let eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--
    eb--
  }
  const added = new Set()
  const n = ea - s
  const m = eb - s
  if (m === 0) return added
  if (n === 0 || n * m > LCS_MAX_CELLS) {
    // Too large for the table: a line counts as added when the old middle has no copy left.
    const left = new Map()
    for (let i = s; i < ea; i++) left.set(a[i], (left.get(a[i]) || 0) + 1)
    for (let j = s; j < eb; j++) {
      const c = left.get(b[j]) || 0
      if (c > 0) left.set(b[j], c - 1)
      else added.add(j)
    }
    return added
  }
  const w = m + 1
  const dp = new Uint32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * w + j] = a[s + i] === b[s + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1])
    }
  }
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[s + i] === b[s + j]) {
      i++
      j++
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++
    else added.add(s + j++)
  }
  while (j < m) added.add(s + j++)
  return added
}

/** Drop the oldest baselines until the cache is within its file and byte limits. */
export function pruneBaselines(baselines) {
  let total = 0
  for (const b of baselines.values()) total += byteSize(b.content)
  while (baselines.size > BASELINE_MAX_FILES || total > BASELINE_MAX_TOTAL_BYTES) {
    let oldest = null
    for (const [k, b] of baselines) if (!oldest || b.ts < baselines.get(oldest).ts) oldest = k
    if (!oldest) break
    total -= byteSize(baselines.get(oldest).content)
    baselines.delete(oldest)
  }
}

/**
 * Open the state store. Finding fingerprints are saved to the state file.
 * Baselines stay in memory: the pre-call snapshot covers almost every call, so
 * writing up to 4 MB of file text on each save would cost more than it saves.
 * @param {object} opts
 * @param {string} opts.file - state file path.
 * @param {(error: unknown) => void} [opts.onError] - called when a save fails.
 * @param {typeof nodeFs} [opts.fs] - file system, replaceable in tests.
 */
export function createState({ file, onError = () => {}, fs = nodeFs }) {
  const files = new Map()
  const baselines = new Map()
  let clock = 0
  const tick = () => Math.max(Date.now(), ++clock)

  const ready = (async () => {
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf8'))
      if (data.fingerprintVersion === FINGERPRINT_VERSION) {
        for (const [k, f] of Object.entries(data.files || {})) {
          files.set(k, { open: new Set(f.open || []), pending: new Set(f.pending || []), ts: f.ts || 0 })
        }
      }
    } catch {
      // No state file yet, or an unreadable one: start empty.
    }
  })()

  let queue = Promise.resolve()

  function save() {
    queue = queue.then(async () => {
      const data = { schemaVersion: 2, fingerprintVersion: FINGERPRINT_VERSION, files: {} }
      for (const [k, f] of files) data.files[k] = { open: [...f.open], pending: [...f.pending], ts: f.ts }
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await fs.writeFile(tmp, JSON.stringify(data), 'utf8')
      await fs.rename(tmp, file)
    }).catch(onError)
    return queue
  }

  return {
    ready,
    save,
    /** Finish queued saves. */
    flush: () => queue,
    baseline: (key) => baselines.get(key)?.content,
    /** Store a baseline. A file over the size limit is dropped, never truncated. */
    setBaseline(key, content) {
      if (byteSize(content) > BASELINE_MAX_BYTES_PER_FILE) baselines.delete(key)
      else baselines.set(key, { content, ts: tick() })
      pruneBaselines(baselines)
    },
    tracked: (key) => files.get(key) || { open: new Set(), pending: new Set() },
    setTracked(key, open, pending) {
      if (!open.size && !pending.size) files.delete(key)
      else files.set(key, { open, pending, ts: tick() })
      while (files.size > TRACKED_MAX_FILES) {
        let oldest = null
        for (const [k, f] of files) if (!oldest || f.ts < files.get(oldest).ts) oldest = k
        files.delete(oldest)
      }
    },
  }
}
