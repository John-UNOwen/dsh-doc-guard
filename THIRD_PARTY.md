# Third-party notices

## plain-docs skill sources

`skills/plain-docs/SKILL.md` merges text and rules from these MIT-licensed
skills:

| Skill | Source | Copyright |
|---|---|---|
| `unslop`, `technical-writing` | https://github.com/cursor/plugins (`pstack/skills`) | Copyright (c) 2026 Lauren Tan |
| `work-humanizer` | https://github.com/phuryn/product-engineering (`work-humanizer`) | Copyright (c) 2026 Pawel Huryn |
| `avoid-ai-writing` | https://github.com/conorbronsdon/avoid-ai-writing | Copyright (c) 2026 Conor Bronsdon |
| `no-ai-slop` | https://github.com/petergyang/no-ai-slop | Copyright (c) 2026 Peter Yang |

The `[NEEDS: ...]` flag is an idea taken from the humanize-writing skill. No
text of that skill is included.

Each of the skills above is released under this license, with its own
copyright line from the table:

```text
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## dsh-plugin-writing-guard

Source: https://github.com/xmutfyh/dsh-plugin-writing-guard (v2.0.2, MIT), file `src/index.ts`.

No code was copied. These parts of `dsh-plain-docs-guard` follow its design:

| Part here | writing-guard source |
|---|---|
| Before-snapshot keyed by `exec.token` (`lib/index.js`, `snapshot` and the `pending` map) | `tools/pre-execute` listener, `preimages` map |
| Baseline cache and its limits of 20 files, 512 KB each, 4 MB total, kept in memory here (`lib/state.js`, `createState`, `pruneBaselines`) | `loadState`, `pruneBaselines`, `BASELINE_MAX_*` |
| Finding fingerprints and the new and resolved counts (`lib/state.js`, `fingerprint`, and `lib/index.js`, `checkFile`) | `hitFingerprint`, `diffAudit`, `FINGERPRINT_VERSION` |
| Per-turn note cap, reset at turn end (`lib/index.js`, `turns` map) | `maxAutoInjectPerTurn`, `agent/turn-stopping`, `agent/disposed` |
| Note as control text the agent must not copy (`lib/index.js`, `buildNote`) | `buildAutoAuditControl` |
| State file written to a temp file, then renamed (`lib/state.js`, `save`) | `queueSave` |

Its license:

```text
MIT License

Copyright (c) 2026 dsh-plugin-writing-guard contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

```
