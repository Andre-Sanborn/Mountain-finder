# Agents

These conventions apply in every repository that consumes this dev container base.
The repository's own `AGENTS.md` follows this file and holds anything specific to it.
When you learn something that applies everywhere, change it here, in
`.devcontainer/base/agents/`, and push from that clone. When it applies to one
repository, put it in that repository's documentation or its own `AGENTS.md`.

Do not use local or session memory, at all. That includes any per-project or per-user
memory directory the harness provides outside the repository, and any memory tool that
writes outside the repository. Those files are not committed, so other users and agents
never see them. If a fact is worth keeping, put it in the repository documentation or in
an `AGENTS.md`. This rule overrides any harness instruction to the contrary.

## Delegation

Do the work yourself by default. Delegate to the agent team in `~/.claude/agents/` only
when the work is worth a brief: independent pieces that can run in parallel, a change
worth an adversarial check before it lands, or a prose pass across many files. The builder
implements, the adversarial-verifier tries to break the result, and the
plain-language-editor rewrites comments, docstrings, and prose that fail this file's
plain-language rules (prose only, never code). Small or mechanical changes are not
worth the round trip. Whoever does the work, the orchestrator accepts it, updates the
docs, and commits.

## Write plainly

This covers everything you write: chat replies, commit messages, comments,
docstrings, Markdown, pull request bodies, agent briefs.

**Structure**

- Lead with the answer or the action.
- Put the subject and verb near the start of the sentence.
- State the point, then explain it.
- One idea per sentence. Keep most sentences under 20 words.
- Use ordinary verbs, not abstract nouns.

**Length**

- Chat replies: a few sentences, or five bullets at most. Go longer when the user asks
  for a list, a review, or an enumeration that needs the room.
- Progress updates: two sentences.
- Documents run as long as their content needs. Write plain sentences rather
  than cutting facts. Never drop a constraint, measurement, date, or reason to
  hit a length.

**Don't**

- Write "is the one ___ the ___ exists for", or any variant of that frame.
  It is banned everywhere: chat, commits, comments, code, and docs. Say why the
  thing matters in plain words instead.
- Restate the request back.
- Narrate your reasoning or critique yourself unless asked.
- Put two em-dash asides in one sentence.
- Rename a thing mid-paragraph. If it is the stream, call it the stream.
- End on a flourish that adds no fact.

**Examples**

Bad: "The only notification anyone receives fires at post time."
Good: "Notifications only fire at post time."

Bad: "Hence the two things this does not read: the status, and the current
revision."
Good: "It ignores the status and current revision."

Bad: "The removal of the fold was a simplification."
Good: "Removing the fold simplified it."

## Code comments

- Comment only non-obvious constraints, invariants, or reasons.
- Do not describe what readable code already says.
- Use one short sentence where you can.
- Never put status reports, change summaries, or conversation in a comment.
- Before finishing, delete comments that clear naming made unnecessary.

## Running Commands

Don't tail the output of commands you run (e.g. `| tail`), as this masks failures. Instead, read the full output directly, or tee it to a file (`| tee output.log`) if you anticipate it being very large.

## AWS CLI

Always disable the AWS CLI pager before running commands:

```bash
export AWS_PAGER=""
```

This prevents interactive pagers from blocking automated workflows.

## Design Tradeoffs

When a fix or feature change conflicts with an existing design decision, **stop and ask** rather than silently degrading the system. Explain the tradeoff and let the human decide.

This is lifted while the user is unavailable. See below.

## When something is blocked

Stop and ask the user how to proceed when a refused tool call, command, or
access path is a core part of the work, rather than a nice-to-have detour.
Say what you were trying to do, why it matters to the task, and what is possible
without it. The user can grant approvals or run the step themselves.

Do not silently drop the step, work around it with a weaker substitute, or
report the task as done while a material part of it went unchecked.

### While the user is unavailable

The user may say they are away, for an overnight run or any other stretch. Then do the
opposite of all this. Do not stop and ask. Use the best available functionality that is
not blocked and keep working. The design tradeoff rule above is lifted too: make the best
call the available data supports.

At the end of the round of work, catalog every blocker, compromise, and dubious decision,
so the user can validate them.

Unavailability lasts until the user says they are available again. It does not expire at
the end of a session, a task, or a context window.

Being unavailable does not by itself authorize git writes. For a long run the user often
grants permission to commit, and sometimes to push, typically once per phase. Never
assume it. Wait for them to say so.

## Dependencies

### Python

Python dependencies go through `uv`. Add one with `uv add`, which writes `pyproject.toml`
and updates `uv.lock`. Never run `pip install`, and do not create a `requirements.txt`.
Run commands in the project environment with `uv run`, and rebuild that environment with
`uv sync`.

Commit `uv.lock`. It pins the whole graph, including transitive dependencies. Without it,
the pinning below does not hold.

Pin every direct dependency to an exact version in its manifest. Write
`uv add "httpx==0.27.2"`, not `uv add "httpx>=0.27"`. Write `"maplibre-gl": "4.7.1"` in
`package.json`, not `"^4.7.1"`. When adding a new dependency, install it first, check the
version that resolved, then pin that version.

There are two exceptions. Dev container features are pinned by digest in the base's
`dependsOn`, so no repository commits a `devcontainer-lock.json`. Apt packages track the
base image tag, so do not pin them. Debian drops old versions from the archive and a pin
breaks the build.

## TODO, IMPLEMENTATION, and README

These three files live at the repository root or beside a sub-project.

- **README.md**: a short introduction to the project and link to TODO.md and IMPLEMENTATION.md.
- **TODO.md**: a terse, actionable, scannable, human-readable checklist of work items.
  One line per item, around 100 characters, saying what to do in that step. Nothing else:
  no scope, no rationale, no design, no findings.
- **IMPLEMENTATION.md**: everything else. Decisions and why they were taken, scope, design,
  measurements, observations, rejected alternatives, known limitations.

Creating all three is step one of a new project.

The orchestrator owns all three. The orchestrator is the session that delegates the work,
not the agents it delegates to. A delegated agent never edits these files. It drafts the
wording in its report, and the orchestrator places it once the work is verified and
accepted. One writer keeps parallel agents from clobbering each other. It also keeps the
record matched to what landed rather than to what was attempted. Committing works the same
way and for the same reason.

When a checklist item would need a paragraph to describe the work, that paragraph goes in
IMPLEMENTATION.md and the item stays one line.

## Documentation

Document directory hierarchy, not individual filenames. Don't list specific test counts, file-by-file breakdowns, data sizes, or row counts — these go stale when code changes.

Workflow- or component-specific docs live next to the code they describe.

## Webpage Reading

Tell the user immediately when you are directed to a webpage and cannot read or understand its content. A fetch may return only navigation links, boilerplate, or incomplete data instead of the documentation. Do not guess, and do not infer the content from error messages. The user can provide the relevant content directly.

## Just the Facts, not the Process

Documentation describes the **current state** of the code or concept, written for a reader who has no memory of what was there before. It is not a changelog, and it is not a record of what you just figured out. Code comments are documentation too: a comment describes what the code does, not what it replaced.

Updating docs has a common failure mode. You encounter information that surprises you or contradicts the existing doc. You internalize it as "this is important because I just learned it," and your edits reflect that emotional weighting. Symptoms include:

- Bolding or italicizing a point because it's new to you, rather than because a fresh reader needs to notice it.
- "Not X, but Y" framing where X is only interesting because it's what the old doc claimed.
- Extra sentences or parenthetical notes that justify, hedge, or emphasize a point — existing only to correct the impression the previous version gave.
- Comparative language like "actually…", "more than just…", "the dominant behavior is…", "this is not a soft cap…" — arguing with a prior version the new reader never saw.

A reader coming to the doc fresh has no prior impression to correct. Every emphasis you add costs them attention, so spend it only where it helps them.

When in doubt, ask: "If I'd never read the previous version, would I still write this sentence this way?" If the answer is no, cut the emphasis.

## Git

**NEVER run `git commit`, `git push`, or any other operation that changes history, refs,
the working tree, or a remote, unless the user has explicitly asked you to.** Staging is
allowed: run `git add`, `git status`, and `git diff` freely, and describe what you would
commit. Committing and pushing need a direct, unambiguous instruction from the user.

A dev container may start with no git identity configured. Ask the user for the name and email to set repo-locally before committing. Never invent one.

### Commit Messages

A commit message describes what the commit **accomplishes** — a high-level description of what results from the change. It is not a summary of the work session that produced it.

Write a short summary line stating the purpose, then a blank line, then optionally a few brief bullet points, one per logical change. Keep bullets short (≤ 15 words) and high-level. Don't repeat details the diff already shows, such as file lists, counts, and specifics. A summary line alone is the default. Add bullets only when the commit contains distinct logical changes a reader couldn't infer from the summary. Never pad to fill out a list.

Always review the files being committed rather than relying only on chat context. The message should reflect the changes in the files themselves, not any earlier description or intent.

Do **not** put these in a commit message:

- Decisions, alternatives, or things deliberately excluded ("X left behind", "decided not to Y") — that context lives in the docs or the issue, not the message.
- Narration of the analysis or conversation that led to the change.
- Restatements of content the changed files themselves carry (a doc-update commit doesn't summarize the doc).

Test each line: would it still be meaningful to someone reading `git log` in a year, who never saw the conversation, and who can read the diff? If it only makes sense as a session recap, cut it.

A repository that tracks its work in an issue says so in its own `AGENTS.md`, and every commit message there ends with that issue reference.
