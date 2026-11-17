---
name: "plain-docs"
description: "Write, edit or review docs, READMEs, code comments, changelogs, PRs and commit messages so they read plainly, stay short and keep every fact. Use for any technical writing or AI-slop cleanup."
---

# Plain docs

Write so a tired engineer understands on the first read. Keep every fact. Invent nothing. Cut every word that does no work.

## Pick the job

- **Write.** Build a new doc from code, notes, or a request.
- **Edit.** Fix a draft, often an AI-written one. Make the smallest edit that fixes it and leave good sentences alone. Edit only the part you were asked to edit. Don't rewrap, renumber, or reformat lines you aren't changing. If more than about half the sentences need work, or the draft is in the wrong mode, rebuild it from the fact list (rule 1) instead of patching it. If the user wrote the draft themselves, propose the rebuild and wait for a yes.
- **Review.** When asked to audit or flag without rewriting, list each problem as the quoted line, the rule it breaks, and a fix in a few words. Order the findings: wrong or unsupported facts first, then ambiguity and missing steps, then padding, then style. Change nothing. If the text is clean, say so.

## Know what wins

1. The user's instruction for this task.
2. The project's style guide and the docs already in the repo: their terms, heading style, quote style, line wrapping, and file layout. Match them, even where they differ from the mechanics below.
3. This skill.

Product UI strings, marketing pages, and legal text follow their own guidelines. Don't restyle them with this skill.

## Rules that override the rest

1. **Keep every fact at its strength.** Before editing, list for yourself every number, name, command, flag, default, limit, condition, caveat, and link, each with its qualifier ("typically", "about", "can", "only on Linux"). The list must survive. "Can reduce" never becomes "reduces", and a plan never becomes a promise. If the draft disagrees with the code, or with itself, report the conflict. Don't pick a side silently.
2. **Invent nothing.** Add no example, number, benchmark, reason, or behavior the source doesn't support. When writing from code, read the code and state only what it does. Check every command, flag, option, path, and link against the code, the `--help` output, or the file tree before you write it. Don't guess at behavior with "appears to" or "likely". When a sentence needs a detail you don't have, write `[NEEDS: what's missing]` in its place. If the gaps would leave the doc hollow and the user can answer, ask up to five short questions in one round before writing. If nobody is there to answer, use the flags.
3. **Protect exact text.** Code, commands, paths, flags, identifiers, config keys, error messages, and quotations stay character for character. Report a problem inside them instead of rewriting them. Comments and docstrings inside code are prose, not protected text, so every rule here applies to them. The one exception: the computer's real user name never appears in docs or commit messages. Replace it with a placeholder such as `C:\Users\<username>\` or `/home/<user>/`.
4. **The codebase is the word list.** Write the real symbol, file, flag, or command name, not a synonym or a description of it.
5. **When a rule makes a sentence worse, fix the sentence another way or leave it.** A sentence that obeys every rule and still sounds machine-made has failed. Clean text gets no edits.

## Pick the mode first

Name the reader first: who they are, what they already know, and what they came to do.

One doc has one mode (Diátaxis). Pick it by asking whether the reader needs to act or to understand, and whether they are learning or working.

- **Tutorial** (act, learning). Say what the reader will build. Every step gives a visible result, so show the expected output. Explanation shrinks to a clause and a link. Use "we" for the work you and the reader do together ("Now we add a route"), and give each step as a command: "First, run x. Now, open y."
- **How-to** (act, working). Solve one problem the reader has and assume competence. Give steps only, with forks where needed ("If you use Docker, skip to step 4"). Title it by the task: "Rotate the API key".
- **Reference** (understand, working). Describe facts, options, defaults, limits, and errors. Leave out instruction, persuasion, and hedging. Mirror the structure of the thing described, and generate it from code where you can.
- **Explanation** (understand, learning). Cover one bounded topic and its why: design decisions, constraints, alternatives. This is the only mode where a view belongs, and only a view the source or the user holds.

Don't mix modes. Split the doc and link the parts.

Other doc types follow the nearest mode:

- **README.** The one page that mixes modes, so keep each part short: what the project is in one or two sentences, what it requires, how to install and run it, one minimal working example, then links to the rest. Drop sections with nothing specific to this project in them, such as boilerplate contributing text or a feature list that repeats the intro.
- **Runbook or troubleshooting page.** A how-to. For troubleshooting, give the symptom as the reader sees it (the exact error text), then the cause, then the fix.
- **API, CLI, or config reference, and docstrings.** Reference.
- **Design doc, RFC, or decision record.** Explanation. State the decision or proposal first, then the context, the alternatives, and what each one costs.
- **Changelog or release note.** Say what changed, who it affects, and what they must do. Put breaking changes and migration steps first. Write from the user's side ("PDF exports now show currency symbols"), not the implementation's.
- **Bug report or issue.** Steps to reproduce, what you expected, what happened, and the versions and environment.

## Lay out the page for the reader

- Headings carry the point, in sentence case: "Rotate keys before they expire", not "Key Rotation" or "Overview". A task heading is a verb phrase. A reference heading can name the thing: `--write`, "Exit codes". Use one h1 and don't skip levels.
- Don't put a heading over a section of one or two sentences, except in reference, where each entry gets its own heading. Don't put a warm-up sentence under a heading that repeats it.
- Before you rename a heading, search for links to its anchor and update them.
- Lead with what the reader came for: the answer, the command, the decision. Background goes after it or behind a link.
- Put prerequisites before step 1: versions, operating system, permissions, and tools.
- Use numbered lists for sequences and bullets for things to scan or compare. Introduce each list with a full sentence and keep the items parallel. Keep lists for steps, options, parameters, and changelogs. Use prose when the items build one argument.
- Drop bold labels that repeat their line ("**Performance:** Performance improved..."). A bold lead-in is fine when it names the item and new detail follows. Don't bold phrases for emphasis.
- Use the real number of items. Don't pad a list to three, and don't announce the count ("Three things changed:").
- Describe the code as it is, not the change that produced it. "This function was added to replace the old loop" is history. Say what the function does. History belongs in changelogs, release notes, migration guides, decision records, and commit messages.
- Don't write "new", "recently", "currently", "soon", or "latest" outside release notes. They go stale. Give the version or the date (2026-11-16).
- Give exact values with units: "30 seconds", not "a short timeout".
- Define a project-specific term or acronym once, where it first appears.
- Use a warning callout only for data loss, security, or a step that can't be undone. Put it before the step.
- A count, list, or file tree you state about the repo must be true at the commit that lands it. Give the command that regenerates it, when there is one.
- Use tables for items compared on the same attributes. Put code in code font. Use bold for UI labels.
- Don't put emoji in headings or bullets. Don't end with a section that restates the doc or with a cheerful sign-off ("Happy coding!"). End on the last step, fact, or link.

## Make examples work

- Every code block runs as written, or says what to replace. Mark a placeholder as `<bucket-name>` and say what goes there.
- Give each fenced block a language tag. Keep a command and its output in separate blocks. Leave the `$` prompt off commands so the reader can paste them.
- Show the expected output for any step the reader can check.
- Prefer one minimal example to three variations. Use realistic values, not `foo` and `bar`.
- If you couldn't run an example, say so in your reply, not in the doc.

## Write sentences that read once

- Talk to the reader as "you", in the present tense. Tutorials are the one exception: they can use "we", as described under the tutorial mode. Use "will" only for what happens later.
- Write instructions as commands: "Run `make test`." Not "You should run" or "Tests should be run". Put the condition first ("To clear the cache, run `x`"), a warning before the step it guards, and the common case before the exceptions.
- Name who does what: "the compiler rejects the query", not "the query is rejected". Passive is fine when the actor is unknown or doesn't matter.
- Give each sentence one instruction, or one idea outside procedures. Split instructions over about 20 words and other sentences over about 25. Keep a long sentence that carries one idea with its condition.
- Write whole sentences with their articles and verbs. "Parser rejects bad date → exit 2, no write" becomes "The parser rejects a bad date, exits with code 2, and writes nothing." Spell out arrows and shorthand in prose.
- Let length follow the content. Don't chop sentences into fragments for rhythm, and merge short sentences when the text turns choppy. Don't start several sentences in a row with the same words. Steps and parallel list items are exempt.
- Make every "it", "this", and "they" point at one obvious noun, and repeat the noun when in doubt. Never use "this" or "which" to point at a whole clause.
- Keep "only" and "not" next to the word they change. Break up noun stacks: "the proto import budget check script" becomes "the script that checks the proto import budget".
- Call each thing by one name everywhere, and use one verb per action. Don't rotate synonyms for variety.
- Use the plain word: use, help, start, show, so, can. Not utilize, leverage, facilitate, initiate, demonstrate, thus, has the ability to. Use the verb, not a noun made from it: "configure", not "perform the configuration of". Say "is" and "has", not "serves as", "acts as", "boasts", or "features".
- Never write "simply", "easy", "just", or "quickly" in a procedure. If it were simple, the reader wouldn't be here. Leave "please" out of instructions.
- Contractions like "don't" and "it's" are fine. Don't use slashes for "or", "(s)" plurals, or "etc." (say up front that a list is partial). Avoid idioms and Latin abbreviations.
- Sound like a colleague who knows the system: plain and direct. Don't add personality the source lacks, such as jokes, "Honestly,", or first-person stories.
- Make link text name where the link goes. Never write "click here".

## Cut what adds words but no information

Test a suspect sentence by deleting it. If the reader loses nothing, leave it deleted.

**Staged emphasis.**
- Contrast with a claim nobody made: "It's not X, it's Y", "not just X but Y", "No setup. No config. Just results." State Y.
- Colon reveals and pause-and-point lines: "The best part: it caches.", "Here's the thing:", "Let's dive in." The point should be the next sentence.
- Slogans and kicker lines: "Less config. More shipping.", "it just works", "batteries included", "zero config". Say the behavior or cut the line.
- Rhetorical questions answered in the next sentence.

**Doing the reader's work.**
- Telling the reader what to notice or how much it matters: "Note that", "It's important to note", "As you can see", "This is the key part", "Notably", "Importantly", "Interestingly".
- Spelling out what the facts already say: "This means that...", "In other words...", and trailing -ing clauses such as ", ensuring reliability" or ", highlighting the flexibility of the API".
- Announcing what the doc is about to do: "In this guide, we will explore...", "Now let's look at...". A one-line scope statement at the top of a long doc is fine, and so is one signpost per major section.
- Recaps: "In summary", "Overall", "To sum up".
- Filler transitions at the start of a sentence: Additionally, Furthermore, Moreover, That said. Use "and", "but", "so", "also", or nothing.
- Defining words the reader already knows.

**Inflation.**
- Adjectives with nothing behind them: powerful, seamless, robust, comprehensive, flexible, efficient, scalable, lightweight. Attach the number, limit, or mechanism the source gives, or cut the adjective.
- Intensifiers: very, really, extremely, highly, significantly, greatly, easily. Give the measured number or cut the word.
- Adjectives in threes by reflex: "fast, simple, and reliable". Keep the ones the source supports.
- Significance claims: pivotal, crucial, game-changing, a testament to, plays a vital role.
- AI vocabulary: delve, tapestry, landscape, realm, intricate, multifaceted, underscore, showcase, foster, garner, enhance, elevate, empower, unlock, streamline, supercharge, harness, navigate (figurative), ever-evolving, cutting-edge, paramount, myriad, plethora.
- Metaphor nouns that pose as technical terms: substrate, surface (as in "API surface"), primitive (as a noun), vector (meaning "way"), wedge, locus, nexus, bedrock, scaffolding, north star, flywheel, paradigm, modality, endgame, ratchet. Pick the concrete word.
- False ranges: "everything from logging to deployment", where the two ends aren't on one scale. List the things.
- Vague authority: "experts recommend", "best practice is", "many teams find". Name the source or cut the claim.
- Feelings where a mechanism belongs: "the database stays close at hand", "types that follow your schema". Say what happens: "a column rename fails the build". If a sentence could appear unchanged in another project's docs, it says nothing about this one.

Terms of art stay: robust standard errors, test harness, primary key, high-leverage point. So do quotations and product names.

**Misplaced hedges.**
- State facts flat. Hedge real uncertainty once. Keep a qualifier the source chose.
- Cut stacked and filler hedges: "could potentially", "it may be possible that", "arguably", "generally speaking".
- When a claim has exceptions, name the case instead of softening it: "On Windows, run it as administrator."
- Never add an absolute (always, never, every, all) the source can't back.

**Leftovers from chat tools.**
- Chat phrases: "Great question", "Certainly!", "I hope this helps", "Let me know if...", "Here's the updated version", "As of my last update", "Let me think step by step".
- Unfilled placeholders: `[Your Name]`, `[INSERT LINK]`, `2025-XX-XX`, `TODO: add example`. Fill them from the source or turn them into `[NEEDS: ...]` flags.
- Citation tokens and tracking parameters pasted from chat tools, such as `contentReference[oaicite:0]` and `utm_source=chatgpt.com`. Strip them and keep the rest of the URL.

**Filler phrases.** "In order to" (to), "due to the fact that" (because), "at this point in time" (now), "in the event that" (if), "it should be noted that" (delete).

## Fix punctuation and formatting

- Don't use em dashes or spaced en dashes in prose. Replace each by what it was doing: a period between two complete thoughts, a comma for a light pause, a colon for a label and its description ("Exports: CSV and PDF"), or parentheses for a real aside. A number range takes "to" or a hyphen: "5 to 10 MB".
- Use a period instead of a semicolon in prose.
- Use colons before lists, examples, and descriptions, never to set up a reveal.
- In English, use sentence case for headings, straight quotes, and serial commas. Don't use exclamation marks.

## Write comments and docstrings that say why

- Write fewer comments. Most lines need none. Before adding one, ask whether a better name or a smaller function would say it instead.
- A comment says why the code is the way it is: the constraint, the workaround, the consequence a reader wouldn't guess. Don't restate what the next line does, and don't label blocks with what they plainly are ("// Constants", "// Helper functions", "// Initialize variables").
- Keep a comment to one line where you can, and to three at most. If the reason needs more, put it in the commit message or a doc and link it.
- Comments follow the punctuation and word rules above: no em dashes, no semicolons joining two thoughts, no arrows or shorthand, no emoji, no filler ("Note that", "This function", "Basically", "Simply"), and no AI vocabulary. Start with the fact: "Retry three times. The API drops the first call after a deploy."
- Don't decorate. No banner lines of `=====` or `-----`, no boxed section headers, no numbered step comments ("// Step 1:") over code that already reads in order.
- Don't comment to reassure or to describe your work: "This is safe because we checked above", "Handle edge cases", "Improved version", "Fixed the bug here".
- Keep history, author notes, and conversation out of comments: "added for the fix", "as requested", "changed from the old approach", "new improved version". Version control holds that.
- A docstring is reference. Give what the function does in one sentence, each parameter with its unit and allowed values, what it returns, and what it raises. Skip a parameter line that only repeats the name and type ("user_id: the ID of the user"). A small private function with a clear name needs no docstring. Follow the docstring convention the file already uses.
- A TODO names what is left and why it waits.
- When you change code, update the comment above it. Clean up the comments in code you write or are asked to clean. Leave other people's comments elsewhere in the file alone.

## Apply the same rules to Chinese

Everything above applies to Chinese docs. Also watch for these:

- 填充和强调：值得注意的是、需要指出的是、总而言之、综上所述、随着……的不断发展、在……的背景下。删掉，直接写事实。
- 空洞大词：赋能、助力、打造、全方位、一站式、深度融合、无缝、高效便捷、强大。改成具体行为或数字。
- 名词化和绕弯：“进行配置”改成“配置”，“对……进行优化”改成“优化……”，“旨在”“致力于”改成直接说它做什么。
- 套路句式：没人提过的“不是……而是……”、“不仅……更……”，每段都套“首先、其次、最后”，四字词堆砌。
- 翻译腔：滥用“被”字句、“的”字连串、长定语。把长定语拆成短句。
- 术语：代码标识符、命令和产品名不翻译。同一个术语全文只用一种译法。
- 排版：中文和英文、数字之间加一个空格。中文用全角标点和中文引号，代码和命令保持原样。简体或繁体跟随原文。少用破折号和用冒号制造悬念。

If the project keeps one doc in two languages (for example `README.md` and `README.zh-CN.md`), change both, or say which one you left stale. For other languages, apply the fact, structure, and sentence rules. The word lists cover English and Chinese only.

## Keep PR descriptions and commits short

- A PR title names the change in the imperative, like a commit subject.
- A PR description is a briefing a reviewer reads in under a minute: what changed, why, how you tested it, and where to look first. Put breaking changes and migration steps at the top. Link the issue. Link logs and benchmark tables instead of pasting them.
- A commit subject is imperative, under about 60 characters, with no trailing period. It names the change: "Fix retry count on timeout", not "Update code" or "Fix bug". Add a body only when the diff doesn't show why.
- Keep any trailer lines the project or the tool requires.
- Don't narrate your process ("I first tried X, then...") unless the reviewer needs it. Don't open with "This PR" or "This commit". Don't use emoji.

## Check before returning

1. **Fact audit.** Compare against the source sentence by sentence. Every item on the fact list is present with the same value and certainty. Then check the other direction: nothing was added that the source doesn't support. Watch the strength words. "Can" must not become "will", "might" must not become "does", and nothing gains "only", "always", or "every".
2. **Reality check.** Every command, flag, path, file name, and link in the doc exists. Code fences close, numbered steps run in order, and each table row has the same columns. No link points at a heading you renamed.
3. **Mechanical sweep.** Search the prose, including comments and docstrings but not the code itself, for em dashes (U+2014), en dashes (U+2013), semicolons, arrows, and the word lists above. Use a search tool, because eyes miss them.
4. **Ambiguity pass.** Check every "it", "this", "they", "only", and "not".
5. **Cold read.** Read it as someone who has never seen the project. Split or rewrite anything they would read twice. Put anything you wouldn't say out loud to a colleague in plainer words.
6. **Shorter option.** Cover each paragraph and read the rest. If the reader would miss no fact, step, warning, or decision, the paragraph is a cut candidate. When writing, cut it. When editing someone's text, make cuts that only remove padding. Offer bigger cuts, such as a whole section or a second topic that could be its own doc, with a word count instead of making them. Never cut steps, warnings, examples, or numbers to get shorter.

## Return the text, then the gaps

- **Write.** Return the doc, then any `[NEEDS: ...]` items, one line each.
- **Edit.** Return the edited text. Then add up to five bullets on what changed and any `[NEEDS: ...]` items. For text over about 150 words, end with one line starting "Shorter option:". It lists the offered cuts with their word counts, or says "none, it's already tight". When editing a file in place, return the list of changes, not the whole file.
- **Review.** Return the findings list only.

In every job, name anything you couldn't verify. List every `[NEEDS: ...]` flag you left in a file, so none ships unnoticed.

## Examples

A sentence, before:

> Configuration of the proto import ratchet budget script parameters is performed via budget.json. Note that it's important to remember that running with --write, which updates the committed budget to reflect the current count, should only be done when lowering it. If exceeded, CI fails.

After, with the script's name and what it counts taken from the repo:

> `budget.mjs` reads the committed budget from `budget.json` and counts the files that import protos. If the count exceeds the budget, CI fails. Run `budget.mjs --write` only to lower the budget.

A README opening, before:

> ## 🚀 Overview
> SyncKit is a powerful, lightweight library that seamlessly synchronizes your local files with S3 — ensuring your data is always safe. It's not just a backup tool, it's a complete sync solution. The retry logic was recently refactored to use exponential backoff instead of fixed delays, significantly improving reliability.

After:

> ## What SyncKit does
> SyncKit is a library that syncs local files with S3. Retries use exponential backoff.

The emoji, "Overview", the adjectives, the em dash, and the contrast are gone. The refactor story belongs in the changelog. "Significantly improving reliability" had no number behind it, so it was cut. "Always safe" was a promise the source couldn't back. Nothing was added: the after says "S3", not "an S3 bucket", because the source says only "S3".

Two comments, before:

```js
// Updated to use the new caching approach as discussed
// Loop through the users and check each one
```

After:

```js
// Cache for 60 seconds. The upstream API allows 100 requests per minute.
```

The first comment was history. It became a reason, using figures found in the code and its config. Without those figures it would be deleted. The second comment restated the loop, so it was deleted.

## Credits

Merged from MIT-licensed skills: `unslop` and `technical-writing` from cursor/plugins pstack (Lauren Tan), `work-humanizer` (Pawel Huryn), `avoid-ai-writing` (Conor Bronsdon), and `no-ai-slop` (Peter Yang). The `[NEEDS: ...]` flag comes from the humanize-writing skill.
