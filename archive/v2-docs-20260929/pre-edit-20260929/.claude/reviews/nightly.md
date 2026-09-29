# Nightly review — 2 AM Mountain time (America/Denver)

This file is the brief. The schedule that fires it is a Routine, and Routines do
not survive forever, so **if the nightly job is missing, recreate it from this
file.** Check at the start of every session.

```
CRON_TZ=America/Denver 52 1 * * *
```

`CRON_TZ` handles daylight time, so there is one slot and no UTC arithmetic.

## What runs

One reviewer: `strategy-adversary`, read-only. It reviews **the decisions of the
last 24 hours**, not the whole repository. Its material is:

- the commits of the last 24 hours, with their diffs,
- what changed in `TODO.md` and `IMPLEMENTATION.md`,
- any decision still uncommitted in the session, which the orchestrator writes
  into the brief because the reviewer cannot see the conversation.

The orchestrator names the material in the prompt. Never leave the reviewer to
guess what the day's decisions were.

A night with no decisions still runs, and reports that there were none. That is a
real result, and it is how a stalled week becomes visible.

## The three questions, asked of each decision

1. **Does this decision reach the goal?** Name the goal first. If every step
   after it succeeds, is the goal met?
2. **Is there a better, faster or simpler route?** Cheaper counts. So does "this
   is already settled in `docs/FINDINGS.md` and needed no run".
3. **What goes wrong on this path?** Concrete failures. Say which would show up
   as plausible output that passes every structural check, because that is this
   project's characteristic failure.

Then, over the day as a whole: **do these decisions still add up to a route to
the goal?** A day of individually sound decisions can walk sideways.

## Also comment on direction, not only correctness

Ask "is this worth doing", not only "is this right". A correct answer to a
question nobody should be spending on is the more expensive mistake.

- **Is the top of the work queue the shortest path to the final field test?**
  Say plainly if something nearer the front should be dropped.
- **What would change the answer?** For each open question, say what evidence
  would settle it and roughly what it costs — machine hours, a data fetch, a
  photograph the human must take, or nothing but a decision.
- **What should be abandoned?** Name one line kept alive by sunk cost, with the
  reason it is still here.
- **What human effort could be removed?** A plan needing more human steps than
  necessary before the field test is a worse plan. Count them.
- **Is anything being avoided because it is uncomfortable rather than because it
  is unimportant?**

A direction finding is worth more than three defect findings and leads the report
when there is one.

## How the reviewer reports

- Rank findings, worst first. A flat list makes the orchestrator do the work.
- Name the file and the line. Give a concrete input that would expose each
  defect.
- State confidence per finding. **Confirmed** if reproduced, **Suspected** if
  not. A finding without a reproduction is a suspicion and must say so.
- Say what you checked and found sound. A review that only lists defects cannot
  be calibrated.
- Say whether anything truly needs the human, and name which kind it is — scope
  or goal. A method choice is not one; recommend the call instead.
- Change nothing. No edits, no commits, no runs that write.

## What the orchestrator does with it

Consider, decide, act. Then **record in `IMPLEMENTATION.md` every decision the
review changed, and every finding it accepted and deferred**, with the reason.
A review whose outcome is not written down did not happen.

Where the review moves the path, the changed path goes back past
`strategy-adversary` before it is built.

## Weekly: ask the human whether to carry on

**On the seventh night**, the orchestrator puts the question to the human, with
the week's findings behind it: what the reviews caught, what they cost, and
whether the nightly cadence is earning its keep.

Put the question first in the reply, per `AGENTS.md`. The job keeps running until
the human answers. A "no" ends it rather than pausing it.

## Standing strategic questions — at least one per night, rotating

- **Is the phone hardware check the shortest path to the final test?** The
  mobile shell carries the four-hold frame-convention check and nobody has run
  it. Say whether the sign conventions in `src/live/sensors.ts` can be settled
  headlessly instead, and if not, exactly which part genuinely needs hardware.
- **Is offline DEM on the phone solved?** D7 chose local SRTM tiles because
  mountains have no signal. A 25 MB tile per degree square is a plan for the
  desktop. Say what the phone actually ships, or that nobody has decided yet.
- **Is CV recall worth more effort than a manual drag?** D9 says a label claims a
  direction, not an identification, and the user drags the overlay. Hazy distant
  crests still report nothing and the wide frames decline. Say whether closing
  that recall gap beats improving the drag.
- **Is anything n = 1 being treated as settled?** Heading to 0.109° and pitch to
  0.690° come from one photograph with one solved pose. Name every claim now
  resting on a single frame or a single viewpoint, and say which one a second
  viewpoint would settle most cheaply.
- **What is the honest status?** MISSION.md tags three levels and README.md
  states the status once. Say whether the tags still match what runs, and name
  anything ticked that has not been re-run since it was.
