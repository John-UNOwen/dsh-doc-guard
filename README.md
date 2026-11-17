# dsh-plain-docs-guard

A DeepSeek Harness (DSH) plugin that makes agents load the `plain-docs` skill
before they write docs, code comments, or commit messages. After each write it
checks the text the agent added and sends the agent a note with the findings.
The skill ships with the plugin, so one install brings both.

## Requirements

- DSH 0.2 (`@deepseek-ai/dsh-tools` 0.2.0-rc.2 or later, below 0.3).
- Node.js 22.19 or later.

## Install

From a local checkout:

```powershell
dsh plugin --profile web add <path-to-this-folder>
```

Replace `<path-to-this-folder>` with the folder that holds this README. Then
add `dsh-plain-docs-guard` to `dsh.profile.bundles` in the profile's
`package.json` and restart DSH.

### The bundled skill

The skill is in [skills/plain-docs/SKILL.md](skills/plain-docs/SKILL.md). At
startup the plugin looks for an installed copy in this order:

1. The `skillFile` setting, when it is set.
2. `~/.dsh/skills/plain-docs/SKILL.md` (or `$DSH_HOME/skills`).
3. `~/.agents/skills/plain-docs/SKILL.md` (or `$DSH_AGENTS_HOME/skills`).

If it finds one, it uses that copy and registers nothing, so your own edits
stay in charge. If it finds none, it registers the bundled copy with DSH, and
agents load it with the `skill` tool as usual. A project's own
`.dsh/skills/plain-docs` still wins over both.

To use the skill without the plugin, or in another agent, copy the
`skills/plain-docs` folder into that agent's skills folder.

## What it does

### Load gate

Before a writing call runs, the plugin checks whether the agent session has
loaded the skill. If not, it denies the call with this reason:

```text
plain-docs-guard: Load the plain-docs skill first: call `skill` with {"name":"plain-docs"}, then run this call again.
```

A call counts as writing when it is one of these:

- A file tool call on a doc file: `.md`, `.mdx`, `.rst`, `.txt`, or a file
  named `README`, `CHANGELOG`, or `CONTRIBUTING`.
- A file tool call on a code file whose new text adds or changes a comment or
  docstring.
- A shell call that runs `git commit` with `-m` or `-F`, `gh pr create`, or
  `gh pr edit`.
- A shell call that writes text the agent typed to a doc file with
  `Set-Content`, `Add-Content`, `Out-File`, `Tee-Object`, `tee`, `>`, or `>>`.
  The text counts as typed when it comes from a string, a here-string, a
  heredoc, a variable, `echo`, `printf`, `Write-Output`, `sed`, `awk`, `perl`,
  or a `-replace`. Output of other programs, as in `npm test > results.txt`, is
  not gated or checked.

For an edit to a code file, the plugin compares the comments in the whole file
before and after the edit, so an edit inside an existing block comment or
docstring counts.

The skill counts as loaded after a successful `skill` call for it, or after the
user invokes it with `/plain-docs`. Each agent session loads it once, and so
does each subagent.

The gate steps aside in these cases:

- After two model steps with denials in one session and no load, that session
  gets a reminder note instead of a denial. Parallel calls in one step count as
  one denial.
- An agent that has no `skill` tool gets the reminder from the start.
- A deny or ask from another plugin still wins over this plugin's allow.

### Text check

The plugin reads each target file before the call and again after it, and
checks only the lines the agent added or changed. In markdown it skips fenced
code, inline code, blockquotes, front matter, and URLs. In code files it checks
comment and docstring lines only.

| Rule | Flags |
|---|---|
| `em-dash`, `en-dash`, `semicolon` | Em dashes, spaced en dashes, and semicolons that join two thoughts |
| `cjk-dash` | `——` in Chinese text, at low priority |
| `emoji` | Emoji in headings, bullets, comments, and commit messages |
| `hype-word`, `intensifier`, `ai-word`, `metaphor-noun`, `filler`, `hedge`, `plain-word`, `chat-leftover` | The word and phrase lists in `SKILL.md` |
| `procedure-word` | "simply", "just", and similar words in numbered steps |
| `zh-filler`, `zh-hype` | The Chinese lists in `SKILL.md` |
| `comment-filler`, `history`, `block-label`, `step-comment`, `banner`, `long-comment` | Comment patterns: filler openers, change history, labels such as `// Constants`, numbered steps, banner lines, and comments over three lines |
| `user-name` | The account name or the home folder path, including its 8.3 short form, in any added line |
| `extra-word` | Words from the `extraWords` setting |

The plugin reads the word lists from the same `SKILL.md` the agents load, at
startup, so the skill is the only place they are kept. Restart DSH after you
change them.

A match inside quotation marks is listed last and marked `(quoted)`.

### The note

Findings never block a call. They reach the agent as extra context on the tool
result:

```text
<plain_docs_check target="README.md">
Control text from plain-docs-guard. Don't copy any of it into the file.
new=2; resolved=1; open=3
finding rule=em-dash; line=12
finding rule=hype-word; line=30; word=seamless
Fix with the smallest edit. Prefer cutting to rewording.
</plain_docs_check>
```

- A note lists only findings that are new since the last check of that file. A
  write that only fixes findings sends no note.
- A note lists at most `maxFindingsPerNote` findings, then `more=<count>`.
- An agent gets at most `maxNotesPerTurn` notes per turn. Findings over the cap
  are reported at the next check of that file. The count resets when the next
  turn starts, also after a cancelled turn.
- A commit message or PR text is checked once, when its command runs.

## Settings

Override any of these in the profile's `cordis.patch.yml`, in an entry with
`id: plain-docs-guard`.

| Setting | Default | Meaning |
|---|---|---|
| `gate` | `deny` | `deny` blocks until the skill is loaded. `remind` lets the call through and attaches a reminder. `off` disables the gate. |
| `check` | `true` | Run the text check after writing calls. |
| `maxNotesPerTurn` | `2` | Notes per agent per turn. |
| `maxFindingsPerNote` | `10` | Findings listed in one note before the rest become a count. |
| `skillName` | `plain-docs` | Skill to require. |
| `skillFile` | empty | Path to the `SKILL.md` with the word lists. Empty means the installed copy, or the bundled one. |
| `bundleSkill` | `true` | Register the bundled skill when no installed copy is found. With `false` and no installed copy, the gate turns off. |
| `docExtensions` | `.md`, `.mdx`, `.rst`, `.txt` | Extensions the gate treats as docs. |
| `fileTools` | `write`, `edit`, `str_replace_editor` | File tools to watch. |
| `shellTools` | `pwsh`, `bash` | Shell tools to watch. |
| `ignorePaths` | `node_modules`, `vendor`, `dist`, `.git` | Folder names never gated or checked. Lock files, license files, `requirements*.txt`, `CMakeLists.txt`, and `robots.txt` are always skipped. |
| `extraWords` | empty | Words to flag on top of the skill's lists. |
| `allowPhrases` | `DeepSeek Harness` | Phrases the word lists never flag, such as product names. |
| `stateFile` | empty | Where baselines and fingerprints are kept. Empty means `~/.dsh/plugins/dsh-plain-docs-guard/state.json`. |

## State file

The state file holds the fingerprints of open findings, keyed by a hash of each
file's path. It holds no file text and no paths. Delete it to reset it.

The plugin also keeps the last text seen for up to 20 files (512 KB each, 4 MB
in total) in memory. It uses that text only when it can't read a file before a
call. A DSH restart clears it.

## Limits

- The plugin can't see the agent's final reply, so it doesn't check it.
- A session that resumes after a DSH restart must load the skill again.
- A shell write to a path built from a variable is gated by its file name but
  not checked.
- Comment detection reads one line at a time. It misses a comment marker that
  follows an unclosed quote on the same line.
- In Python, a triple-quoted string counts as a docstring only at the top of a
  module or right after a line that ends in a colon, such as `def` or `class`.

## Tests

The tests load the Cordis runtime from the installed DSH, so they need no
`npm install`:

```powershell
npm test
```

## Credits

The snapshot, baseline cache, fingerprint, and note design follows
`dsh-plugin-writing-guard`. See [THIRD_PARTY.md](THIRD_PARTY.md).
