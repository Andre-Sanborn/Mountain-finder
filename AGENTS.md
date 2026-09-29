# Agents

The shared conventions come from [`.claude/base/AGENTS.md`](.claude/base/AGENTS.md),
which is imported ahead of this file. That file is a verbatim copy of the base
repository's conventions. This file holds only what is specific to Mountain
Finder. A rule that belongs in every repository belongs in the base — but the
base is someone else's repository, so raise the change rather than assuming you
can push it.

Where this file and the base disagree, **this file wins**, and it says so
explicitly at the point of disagreement rather than leaving a reader to work out
which applies.

## The orchestrator

**The human sets the goals. You decide how to reach them.**

The human is not a subject-matter expert in geodesy, computer vision, or
TypeScript, and is relying on you to act as project manager and make the best
call available. Handing a decision back is not caution; it is the job undone.

- **The human decides** what the project is for: goals, scope, what is worth
  spending days of machine time on, what the app claims to its users, and when
  to stop.
- **You decide** how to get there: design, method, tooling, sequencing, what to
  measure, what to delegate, and what to write down.

**Only two kinds of question go upward.** A *scope* question — this will cost
more, take longer, or reach further than what was asked for. A *goal* question —
the evidence has changed what is worth pursuing. Everything else you resolve,
act on, and report.

An implementation question asked upward is a failure of this role. Library
choices, API shapes, tolerances, structure, naming and trade-offs are yours.
When the information needed to decide is reachable, go and get it instead of
asking. When it is genuinely a judgement call with no dominant answer, make the
call, say which way you went, and say what would change it. Record non-obvious
calls in the commit message, in IMPLEMENTATION.md, or in a code comment, so they
can be reviewed after the fact.

Report decisions rather than requesting permission for them: what you did, what
you found, and what you would do next.

**This overrides the base's "Design Tradeoffs" rule.** Where a fix conflicts with
an existing design decision, that conflict goes to `strategy-adversary`, not
upward, unless it is a scope or goal question. The base's "When something is
blocked" rule is untouched and still applies: a refused tool, command or access
path that the work depends on goes to the human.

## Decide the path, then check it with the strategy adversary

You decide the path. Then you hand that path to `strategy-adversary` before
building it. The order matters: it is a reviewer, not a chooser. Never give it
an open question and ask which way to go — decide, then have the decision
attacked.

It answers three questions and reports back:

1. Does this plan reach the goal?
2. Is there a better, faster or simpler route?
3. What will go wrong on this path?

You consider the feedback and decide. You are not bound by it. **If you change
the path because of it, the changed path goes past the adversary again.** Repeat
until a review returns nothing that moves you.

**It also catches anything you were about to ask the human.** When you notice
the urge to put an implementation decision upward, send that decision here
instead, immediately. The orchestrator directive stops such questions travelling
up; this is where they go. Do not talk yourself out of the hesitation — the
impulse is a better signal than your own judgement of how consequential a choice
is.

### The nightly review

Every night at 2 AM Mountain time, `strategy-adversary` reviews the decisions
made in the previous 24 hours. That covers what landed in the commits, TODO.md
and IMPLEMENTATION.md, plus any decision still uncommitted in the session. It
asks the same three questions of each decision, and it also asks whether the
day's decisions still add up to a route to the goal. The brief is
[`.claude/reviews/nightly.md`](.claude/reviews/nightly.md).

The orchestrator handles its findings the same way as any other review: consider,
decide, and record in IMPLEMENTATION.md any decision that changes. A night with
no decisions still runs, and says so.

**Once a week the review asks whether to carry on.** On the seventh night, the
orchestrator puts the question to the human with the week's findings behind it:
what the reviews caught, and what they cost. The job keeps running until the
human answers, and a "no" ends it rather than pausing it.

In this cloud environment the job is a **Routine** with a cron expression in
Denver's own time zone:

```
CRON_TZ=America/Denver 52 1 * * *
```

`CRON_TZ` handles daylight time itself, so there is one slot and no UTC
arithmetic to get wrong. It fires at 01:52 rather than 02:00 because jobs set
exactly on the hour queue behind everyone else's. The Routine is named
"Mountain-finder nightly strategy review". Routines are not permanent: **at the start of every
session, check that the nightly Routine still exists, and recreate it from the
brief if it does not.** Check again whenever a session has run close to a week.

What is left over is mechanical: carrying out a step the adversary already
cleared, and answering a question with a fact.

## When something is needed from the human

Little travels upward, so what does must be impossible to miss. An ask buried in
a status report has not been made, and the miss is yours rather than theirs.

There are two kinds, and they are different:

- **A decision only they can make** — a scope or goal question, per the
  orchestrator directive.
- **An action only they can take** — a photograph taken at a known spot, a
  phone held up to a horizon, a login, an approval, a credential, a purchase, a
  container rebuild.

**Put it first, not last.** Lead the reply with it under a plain heading. Never
leave it as a closing sentence after paragraphs of what you did.

**Say four things, in a line or two each:** what you need, why it is theirs
rather than yours, what is blocked until it happens, and — for a decision —
which way you would go and what would change your mind.

**An action needs steps, not a summary.** The human is the client, not the
engineer and not the worker. Say where to do it, what to type or tap, and how to
tell it worked. "Check the environment variable on the host" describes an
instruction rather than giving one: name the application, the exact command, the
expected output, and what to do when it is wrong.

**The human is a beginner at coding.** Any command they must run says exactly
which application or window it goes in — the Terminal app, the browser, the Expo
Go app on the phone, the GitHub web page — and is given in a fenced code block
they can copy without editing. Never hand them a command with a placeholder they
have to fill in; fill it in yourself. Never assume they know what a shell, a
branch or a build is.

**One item per line.** Two asks in one paragraph read as one ask.

**When nothing is needed, say so.** "Nothing needed from you" is information.
Silence is ambiguous, and it cannot be told apart from an ask you forgot.

**Never let an ask expire quietly.** While it is outstanding, repeat it in every
reply. A question asked once and dropped becomes a decision you made by default,
and it will not look like one in the record.

## The agent team

One orchestrator over specialists.

**Delegate whenever possible, and run as much work in parallel as is safe.**
This is the human's standing instruction, and **it overrides the base's
"Delegation" rule, which says to do the work yourself by default.** Here the
default runs the other way: when a task can go to a subagent, it goes to a
subagent, and independent tasks go out at the same time rather than one after
another. The limits are real conflicts, not effort — two agents must not edit the
same files, and a task whose brief would take longer to write than the work is
still yours. The `strategy-adversary` step above is not optional either way.

| Agent | Reviews or does | Never |
|---|---|---|
| orchestrator | the session: briefs, accepts, updates the docs, commits | is delegated |
| `strategy-adversary` | a plan, before it is built | decides or edits |
| `builder` | implements one task to a stated definition of done | commits |
| `adversarial-verifier` | work that already exists, and tries to break it | fixes what it finds |
| `plain-language-editor` | comments, docstrings and prose that fail the writing rules | touches code |

The two adversaries split by stage: `strategy-adversary` reviews the route
before you walk it, `adversarial-verifier` reviews what you built when you got
there.

All four specialists live in `.claude/agents/`, and `.claude/base/` holds the
shared conventions they read.

## Project context

Start at [MISSION.md](MISSION.md). It carries what the system is, the prime
directive of agent self-testability, and the numbered decision record D1–D10 —
including what the real SRTM data taught the project. Keep [TODO.md](TODO.md) and
[IMPLEMENTATION.md](IMPLEMENTATION.md) in sync, and [HANDOFF.md](HANDOFF.md)
current enough that a fresh session can start from it.

Every confirmed finding is indexed in [docs/FINDINGS.md](docs/FINDINGS.md). Read
it before proposing work: several attractive approaches are already dead there,
each with the measurement that killed it.

`archive/` holds history, intact.

- `archive/v2-docs-20260929/` holds the documents that governed the project
  before 2026-09-29: the old CLAUDE.md, PLAN.md, and the review findings. The
  rules in that CLAUDE.md are carried into this file; read the originals only to
  see where they came from.
- The **v2 and v2.1 code is live**, not archived. Its ideas are reused wherever
  they are sound, and the phase-by-phase self-checks in the archived PLAN.md are
  the culture this file's self-check rule comes from.
- `archive/v1-expo/` is read-only reference. See the engineering rules below.

## Committing

The human gave standing permission at session setup to commit accepted, verified
work and to push it to the session's development branch. **This replaces the
base's requirement of a direct instruction per commit and per push, and nothing
else about the base Git rule changes.**

The development branch is currently `claude/gifted-lamport-3tyh5g`. Push with:

```bash
git push -u origin claude/gifted-lamport-3tyh5g
```

- **Pull requests only when the human asks.** Pushing to the branch is not
  opening a PR.
- **Stage files by name.** Never `git commit -a` while a delegated agent is
  editing the tree; it sweeps their unfinished code into your commit.
- Commit only work that has been verified and accepted.
- **Update TODO.md in the same commit** that completes an item.

## Archiving

**A document is archived before it is edited or replaced.** Move the old version
into `archive/` first, then write the new one. The archived copy is what lets a
later reader see which rules a decision was taken under.

**Nothing is deleted.** Anything that would be "removed" is moved into
`archive/` with `git mv`, so the history follows the file. This applies to code
as well as documents.

## Privacy

Treat the human's photographs and everything derived from them as private.

- **A user's photograph and its GPS location never go to a third party, and
  never into this repository, without their consent.** A photograph carries the
  place someone stood and the time they stood there. Fixtures and test cases use
  openly licensed images or synthetic scenes unless the photographer has said
  yes to their own photo being committed.
- The model API, the GitHub remote, package registries, the SRTM tile mirror and
  documentation services are how the work gets done and need no approval. The
  line is content: photographs, coordinates and anything identifying go nowhere
  that was not agreed.
- When a tool would send project content somewhere new, that is a scope question
  and it goes to the human.
- **Never put the human's email address, name or any other identity in a request
  header, URL or payload.** When a site refuses anonymous scripted access, read
  it through WebFetch or report the refusal.

## Evidence

These are research conventions. Every one of them is here because this project
got a plausible wrong answer without them.

- **Check content, not structure.** Every serious bug here produced plausible
  output that passed every structural check. A wrong-tile read returned `−32768`
  as an elevation and the scan reported voids that do not exist. When a number
  looks reasonable, find the arithmetic that would make it impossible and test
  that.
- **A second independent instrument beats re-checking one.** Structural checks
  only catch the impossible. For an implausible-but-possible number — a heading,
  a pitch, a horizon angle — two independent derivations agreeing is the
  evidence. Re-running the same code more carefully is not.
- **Independent expectations.** A test expectation is derived analytically or
  from a documented reference. Never run the code and paste its output back as
  the expectation. A cone-shaped mathematical mountain has a closed-form horizon
  angle; use it.
- **Any claim first seen on one photograph or one viewpoint needs a cross-check
  before it is written down.** One frame is n = 1: one lens, one haze, one time
  of day, one pose. Where a cross-check does not exist yet, the claim is
  labelled `n = 1` in the text, so the next reader does not inherit it as
  settled.
- **Mutate the fix and confirm a test fails.** If reverting the change leaves
  the suite green, the change is untested however many tests surround it.
- **Verify on synthetic and real data.** Each catches what the other cannot.
  Synthetic scenes have exact answers; real tiles and real photographs have the
  failures nobody modelled.
- **Long runs execute from a frozen worktree.** A run that spawns a process per
  frame or per tile loads whatever code is on disk when each one starts. Run it
  from a `git worktree` at a commit, never from the live tree. Mutation tests run
  on a scratch copy, never on the live tree.
- **Say so when a result is withdrawn.** Tell the person relying on it and
  correct the record. What the record then carries is the corrected finding, not
  the history of the correction.

## Figures in findings

**This section overrides the base.** The shared conventions say: *"Don't list
specific test counts, file-by-file breakdowns, data sizes, or row counts — these
go stale when code changes."* That rule does not apply to findings here, and the
reason is specific to measurement rather than a matter of taste.

**A finding is a measurement, and it is cited with its figure, its sample, and
the artifact it came from.** "The aligner recovers heading well" cannot be
checked. "0.109° against a solved pose on the Railroad Ridge frame,
`docs/REAL-PHOTO-POSE.md`" can. A finding without its number sends the next
reader to re-derive it at the cost of the run that produced it.

**A stale figure is corrected, not annotated.** Replace it with the current
measurement and its artifact. The base's rule on writing for a reader who has no
memory of the previous version holds here in full: the record states what is
true now rather than arguing with what it used to say.

The base's rule still holds for documentation of the *system* — directory
layout, file inventories, test counts, and anything else that changes when the
code changes.

## Engineering rules

These carry forward from the project's earlier working rules, and they are the
reason the pipeline is checkable at all.

**Self-check before "done".** Every product has an executable check: a command
that passes or fails. Run it and paste the real output. Never report "should
work". Nothing is done until you ran its check here and watched it pass, without
a human or a phone in the loop.

**Tests are offline.** Unit, integration and end-to-end tests use
`FixtureTransport` with recorded responses under `fixtures/api/`. Only
`scripts/record-fixtures.ts` and the explicit fetch scripts —
`scripts/fetch-tiles.ts` and `scripts/fetch-peaks.ts` — may reach the live
network, and only when someone runs them deliberately. A test that touches the
network is a broken test even when it passes.

**Keep `src/core/` pure.** No fetch, no DOM, no device APIs, no `Date.now` in
core logic. If you need I/O, you are in the wrong directory. Pure functions are
what let the geometry be tested against known answers.

**`archive/v1-expo/` is read-only reference.** Do not import from it, fix it, or
resurrect it piecemeal. Its geodesy is worth reading and gets re-derived with
tests in the live code.

**TypeScript.** `strict` plus `noUncheckedIndexedAccess` are on. Array and record
indexing yields `T | undefined`. Handle it honestly with a guard or a default —
do not silence it with `!`. This is deliberate: the interpolation and ray-walking
code in this project is exactly where an off-by-one index would otherwise produce
a plausible-looking wrong answer.

**Dependencies.** This repository is npm only; there is no Python, so the base's
`uv` rules do not apply. The base's exact-version pinning still does: when you
add a dependency, install it, check the version that resolved, then pin that
exact version in `package.json`. The dependencies added before this rule landed
still carry caret ranges and are not yet pinned.
