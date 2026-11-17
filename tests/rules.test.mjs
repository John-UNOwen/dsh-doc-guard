import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { analyze, buildLists, detectShortHome, privatePattern, scanComments, scanProse } from '../lib/rules.js'

const skillFile = process.env.PLAIN_DOCS_SKILL || path.join(homedir(), '.dsh', 'skills', 'plain-docs', 'SKILL.md')
const skill = existsSync(skillFile) ? readFileSync(skillFile, 'utf8') : ''
const lists = buildLists(skill, { allowPhrases: ['DeepSeek Harness'] })
const rules = (text, target = { kind: 'doc' }) => analyze(text, target, lists).map((f) => f.rule)
const needsSkill = (t) => (skill ? false : (t.skip('plain-docs skill is not installed'), true))

describe('word lists from SKILL.md', () => {
  it('reads every list', (t) => {
    if (needsSkill(t)) return
    const found = new Set(lists.groups.map((g) => g.rule))
    for (const rule of ['hype-word', 'intensifier', 'ai-word', 'metaphor-noun', 'filler', 'chat-leftover', 'hedge', 'plain-word', 'procedure-word', 'comment-filler', 'zh-filler', 'zh-hype']) {
      assert.ok(found.has(rule), rule)
    }
    assert.ok(lists.count > 100)
  })

  it('an empty skill text gives no word rules', () => {
    const empty = buildLists('')
    assert.equal(empty.groups.length, 0)
    assert.deepEqual(analyze('A seamless tool.', { kind: 'doc' }, empty), [])
  })

  it('flags inflected words and names the word', (t) => {
    if (needsSkill(t)) return
    const f = analyze('It seamlessly leverages the cache.', { kind: 'doc' }, lists)
    assert.deepEqual(f.map((x) => x.word).sort(), ['leverages', 'seamlessly'])
  })

  it('skips qualified entries, terms of art, and allowed phrases', (t) => {
    if (needsSkill(t)) return
    assert.deepEqual(rules('Navigate to the settings page and read the API surface.'), [])
    assert.deepEqual(rules('The test harness uses robust standard errors.'), [])
    assert.deepEqual(rules('DeepSeek Harness loads the plugin.'), [])
    assert.deepEqual(rules('We harness the cache.'), ['ai-word'])
  })

  it('flags sentence-opening filler only at a sentence start', (t) => {
    if (needsSkill(t)) return
    assert.deepEqual(rules('Overall, it works. Additionally, it caches.'), ['filler', 'filler'])
    assert.deepEqual(rules('The overall count is 3.'), [])
  })

  it('flags procedure words in numbered steps only', (t) => {
    if (needsSkill(t)) return
    assert.deepEqual(rules('1. Simply run the script.'), ['procedure-word'])
    assert.deepEqual(rules('It is just a cache.'), [])
  })

  it('marks quoted matches as low priority', (t) => {
    if (needsSkill(t)) return
    const [f] = analyze('The page said "a seamless experience" twice.', { kind: 'doc' }, lists)
    assert.equal(f.quoted, true)
    assert.equal(f.low, true)
  })

  it('extraWords adds to the lists', () => {
    const extra = buildLists('', { extraWords: ['synergy'] })
    assert.deepEqual(analyze('Pure synergy.', { kind: 'doc' }, extra).map((f) => f.rule), ['extra-word'])
  })
})

describe('plain-docs examples', () => {
  const cases = [
    [
      'sentence',
      { kind: 'doc' },
      "Configuration of the proto import ratchet budget script parameters is performed via budget.json. Note that it's important to remember that running with --write, which updates the committed budget to reflect the current count, should only be done when lowering it. If exceeded, CI fails.",
      '`budget.mjs` reads the committed budget from `budget.json` and counts the files that import protos. If the count exceeds the budget, CI fails. Run `budget.mjs --write` only to lower the budget.',
    ],
    [
      'README opening',
      { kind: 'doc' },
      "## \u{1F680} Overview\nSyncKit is a powerful, lightweight library that seamlessly synchronizes your local files with S3 \u2014 ensuring your data is always safe. It's not just a backup tool, it's a complete sync solution. The retry logic was recently refactored to use exponential backoff instead of fixed delays, significantly improving reliability.",
      '## What SyncKit does\nSyncKit is a library that syncs local files with S3. Retries use exponential backoff.',
    ],
    [
      'comments',
      { kind: 'code', ext: 'js' },
      '// Updated to use the new caching approach as discussed\n// Loop through the users and check each one\nrun()',
      '// Cache for 60 seconds. The upstream API allows 100 requests per minute.\nrun()',
    ],
  ]
  for (const [label, target, before, after] of cases) {
    it(`${label}: the before text has findings and the after text has none`, (t) => {
      if (needsSkill(t)) return
      assert.ok(rules(before, target).length > 0)
      assert.deepEqual(rules(after, target), [])
    })
  }

  it('the README before text hits each expected rule', (t) => {
    if (needsSkill(t)) return
    const found = new Set(rules(cases[1][2]))
    for (const rule of ['emoji', 'em-dash', 'hype-word', 'intensifier']) assert.ok(found.has(rule), rule)
  })
})

describe('markdown', () => {
  const md = ['Intro \u2014 one.', '', '```js', 'const a = 1; // dash \u2014 here', '```', '', 'Use `a; b \u2014 c` here.', '> Quoted \u2014 text; more', 'Done; finished.'].join('\n')

  it('skips fenced code, inline code, and blockquotes', () => {
    const f = analyze(md, { kind: 'doc' }, lists)
    assert.deepEqual(f.map((x) => [x.rule, x.line]), [['em-dash', 1], ['semicolon', 9]])
  })

  it('skips front matter, URLs, and table rules', () => {
    const text = '---\ntitle: a \u2014 b\n---\nSee https://example.com/a;b\u2014c for more.\n\n| a | b |\n|---|---|\n'
    assert.deepEqual(scanProse(text).map((p) => p.i), [3, 5])
    assert.deepEqual(rules(text), [])
  })

  it('flags spaced en dashes but not ranges', () => {
    assert.deepEqual(rules('Fast \u2013 and small.'), ['en-dash'])
    assert.deepEqual(rules('Pages 5\u201310.'), [])
  })

  it('treats a Chinese dash as low priority', () => {
    const [f] = analyze('\u8fd9\u662f\u4e00\u4e2a\u6d4b\u8bd5\u2014\u2014\u7ed3\u679c', { kind: 'doc' }, lists)
    assert.equal(f.rule, 'cjk-dash')
    assert.equal(f.low, true)
  })

  it('flags emoji in headings and bullets, not in body text', () => {
    assert.deepEqual(rules('# \u{1F389} Release'), ['emoji'])
    assert.deepEqual(rules('It shipped \u{1F389} today.'), [])
  })
})

describe('comment detection', () => {
  const texts = (src, ext) => scanComments(src, ext).map((c) => c.text)

  it('.js: line, trailing, block, and JSDoc comments', () => {
    const src = ['// one', 'const u = "http://x//y" // two', '/* three */', '/**', ' * four', ' */', "const s = '// no'"].join('\n')
    assert.deepEqual(texts(src, 'js').filter(Boolean), ['one', 'two', 'three', 'four'])
    assert.equal(scanComments(src, 'js').find((c) => c.text === 'four').doc, true)
  })

  it('.py: hash comments and docstrings', () => {
    const src = ['#!/usr/bin/env python', '# one', 'def f():', '    """Two.', '', '    Three.', '    """', "    x = '# no'  # four", '    y = a#b'].join('\n')
    assert.deepEqual(texts(src, 'py').filter(Boolean), ['one', 'Two.', 'Three.', 'four'])
  })

  it('.ps1: hash comments and block comments', () => {
    const src = ['# one', '<#', 'two', '#>', '$x = "a # no" # three', '$n = $args.Count'].join('\n')
    assert.deepEqual(texts(src, 'ps1').filter(Boolean), ['one', 'two', 'three'])
  })

  it('.abap: star in column 1 and double quote', () => {
    const src = ['* one', "DATA x TYPE string. \" two", "  x = 'a \" no'.", '  y = a * b.'].join('\n')
    assert.deepEqual(texts(src, 'abap'), ['one', 'two'])
  })

  it('.py: a triple-quoted string that is not a docstring stays code', () => {
    const src = [
      '"""Module docstring."""',
      'def f():',
      '    # c',
      '    """Doc."""',
      '    query = (',
      '        """',
      '        SELECT a; DELETE b # not a comment',
      '        """',
      '    )',
      '    sql = """x; y""" # real',
      "    t = '''",
      "    # not a comment either",
      "    '''  # after",
      '    run("""',
      '    a; b',
      '    """)',
    ].join('\n')
    const found = scanComments(src, 'py')
    assert.deepEqual(found.map((c) => c.text), ['Module docstring.', 'c', 'Doc.', 'real', 'after'])
    assert.deepEqual(rules(src, { kind: 'code', ext: 'py' }), [])
  })

  it('returns null for a file type without known comments', () => {
    assert.equal(scanComments('{"a": 1}', 'json'), null)
  })
})

describe('comment rules', () => {
  const js = (src) => rules(src, { kind: 'code', ext: 'js' })

  it('ignores code, including semicolons and string contents', () => {
    assert.deepEqual(js('const a = "x \u2014 y"; const b = 2; run(a);'), [])
  })

  it('flags dashes, semicolons, and emoji in comments', () => {
    assert.deepEqual(js('// Retry \u2014 the API drops calls'), ['em-dash'])
    assert.deepEqual(js('// Retry twice; the API drops calls'), ['semicolon'])
    assert.deepEqual(js('// Done \u2705'), ['emoji'])
    assert.deepEqual(js('// run(a); run(b);'), [])
  })

  it('flags banners, block labels, step comments, and history', () => {
    assert.deepEqual(js('// ====== Section ======'), ['banner'])
    assert.deepEqual(js('// Constants\nconst A = 1'), ['block-label'])
    assert.deepEqual(js('// Step 1: read the file'), ['step-comment'])
    assert.deepEqual(js('// Changed to a map for speed'), ['history'])
  })

  it('flags a comment over three lines, but not a docstring or a license header', () => {
    const four = '// a\n// b\n// c\n// d\nrun()'
    assert.deepEqual(js(`run()\nrun()\nrun()\n${four}`), ['long-comment'])
    assert.deepEqual(js('// a\n// b\n// c\nrun()'), [])
    assert.deepEqual(js('/**\n * a\n * b\n * c\n * d\n */\nrun()'), [])
    assert.deepEqual(js('// Copyright 2026 Example\n// b\n// c\n// d\nrun()'), [])
  })
})

describe('account name', () => {
  const priv = privatePattern({ home: 'C:\\Users\\Jo Example', names: ['Jo Example'] })

  it('flags the name and the home folder in any line, code included', () => {
    const f = analyze('const p = "C:\\\\Users\\\\Jo Example\\\\x"\nconst q = "jo-example"\nconst r = 1', { kind: 'code', ext: 'js' }, lists, priv)
    assert.deepEqual(f.map((x) => [x.rule, x.line]), [['user-name', 1], ['user-name', 2]])
    assert.equal(f[0].word, undefined)
  })

  it('flags the 8.3 short home path and its short name', () => {
    const p = privatePattern({ home: 'C:\\Users\\Jo Example', names: ['Jo Example'], shortHome: 'C:\\Users\\JOEXAM~1' })
    assert.equal(p.test('C:\\Users\\JOEXAM~1\\AppData\\Local\\Temp'), true)
    assert.equal(p.test('see JOEXAM~1 here'), true)
    assert.equal(p.test('C:\\Users\\Other\\x'), false)
  })

  it('detectShortHome finds the short path on this PC, or null', async () => {
    const found = await detectShortHome()
    assert.ok(found === null || /~\d/.test(found) || found.toLowerCase() === homedir().toLowerCase())
  })

  it('skips short and common names', () => {
    const p = privatePattern({ home: 'C:\\Users\\dev', names: ['dev', 'al'] })
    assert.equal(p.test('the dev build'), false)
    assert.equal(p.test('C:/Users/dev/x'), true)
  })
})
