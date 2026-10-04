# Review log

Every nightly strategy review lands here, newest first, and nothing in an earlier entry is
edited afterwards. The review is `strategy-adversary` reading the previous 24 hours of
decisions — what landed in the commits, in TODO.md and in IMPLEMENTATION.md, plus anything
decided in a session and not yet committed — and asking whether each decision reaches the
goal, whether a better route exists, and what will go wrong on this one. Its brief is
[`.claude/reviews/nightly.md`](../.claude/reviews/nightly.md). An entry records the date, the
commit range reviewed, what the review raised, and what the orchestrator did about each item;
a night with no decisions to review still gets an entry saying so. A decision that changed
because of a review is written up in [IMPLEMENTATION.md](../IMPLEMENTATION.md), and a
confirmed defect gets an id in [FINDINGS.md](FINDINGS.md) — this log holds the review itself,
not the record of the code.

---

## 2026-10-03, night 5 (reviewed fcaecaa..f2f7a98, 2 commits)

The reviewer ran as a `general-purpose` agent reading `.claude/agents/strategy-adversary.md`, on
`claude-opus-5-5` (transcript record).

**Adversary findings, ranked:**
1. During step 14 a real finger cannot reach the re-anchor tap layer. The home-session tap layer
   sits inside `.live__chrome--top` (z-index 3, its own stacking context) and wins hit-testing over
   the root-level re-anchor layer (z-index 1). Confirmed with `elementFromPoint` on a skeleton of
   the same DOM and the real `live.css`. The e2e passes only because its helpers dispatch events
   on a node chosen by test id, skipping hit-testing.
2. "Use this measurement" stays available while the gross warning shows, and a re-anchor does not
   withdraw a saved fit: two taps under a 25° compass error store a bent field of view.
3. Taps spanning a "Use this measurement" are fitted against marks drawn under different trims.
4. In the field session an unclaimed landmark tap is read as a Sun tap.

**Checked and found sound:** night 4's four fixes as decided; the clearing effect under a
re-anchor before any tap, strict mode, and same-render taps; the `readsAsSunTap` simplification is
equivalent in the field sweep; the freeze held.

**Direction:** every night since night 2 has found a real defect in the same few hundred lines
(the Sun re-anchor and step-14 calibration). The node-dispatch e2e sees the logic, not the
gesture. Fix 1 and 2, switch the tap helpers to hit-testing, then stop refining step 14; the home
session is the only test of what the phone does. The binding constraint is GitHub Pages.

**Orchestrator decisions:** 1, 2 and 4 accepted, with the e2e tap helpers switched to
coordinate taps through hit-testing, in one fix. 3 deferred to the existing TODO on clearing taps
across trim changes. After this fix, no further step-14 or re-anchor UI work before the home
session. The week's evidence goes into night 7's continue-question.

---

## 2026-10-02, night 4 (reviewed 188cb57..fcaecaa, 2 commits)

The reviewer ran as a `general-purpose` agent reading `.claude/agents/strategy-adversary.md`, on
`claude-opus-5-5` (transcript record).

**Adversary findings, ranked:**
1. A step-14 tap made before the direction is fixed stays in the field-of-view fit. The gross
   compass warning fires only after a tap that was already appended, and taps are never cleared.
   With the guide's "fix the direction, then go back to step 14", a stale tap plus two good taps
   fits 61.8°, 65.2° and 69.6° against a true 60° at compass errors of 22°, 25° and 28°, with no
   refusal. Night 3's failure by a different route.
2. A daytime Moon can still claim a Sun tap in step 14 and hide the warning.
3. Comments in `LiveScreen.tsx` and `readsAsSunTap` still argue the removed summit case.
4. The gross-warning e2e still uses the wall clock and skips much of the day.

**Checked and found sound:** night 3's four fixes as decided; the step-14 e2e rewrite stays
independent (injected scale 1.1 and shift (10, −6) px) and has teeth; the `tilt-out-of-range`
boundary and NaN handling; the freeze held. The step-14 e2e passed in the orchestrator's run
before commit `fcaecaa` (live and field-session specs, 31 passed).

**Orchestrator decisions:** all four accepted, in one fix before the home session: clear step-14
taps when a re-anchor is applied; step 14 measures against the Sun only; the comments rewritten
and `readsAsSunTap` simplified if no caller needs its distance branch; the warning e2e on a fixed
clock with no skips.

---

## 2026-10-01, night 3 (reviewed ee65a8f..188cb57, 3 commits)

The reviewer ran as a `general-purpose` agent reading `.claude/agents/strategy-adversary.md`, on
`claude-opus-5-5` (transcript record).

**Adversary findings, ranked:**
1. Home step 14 gives a calibration tap to the nearest mark, summit dots included. Under a gross
   compass error the Sun mark is off the side or far away, a summit dot claims the tap, and the
   field-of-view fit stores a scale bent by the compass error under the track key the field
   session reads. The tilt bias already refuses summit taps; the FOV fit does not. The new
   home-guide section ("finish step 14 first, then fix the direction") leads straight into it.
2. The ±20° pitch-clamp case is past the 15° credibility bound; refuse it rather than re-solve.
3. A comment beside the tap-spread floor implies the floor covers an error every tap shares; it
   does not.
4. Both calibrations now hang on the track key; if `deviceId` changes between sessions they drop
   (fail-safe), but the field guide never tells the person to check for "(uncalibrated)".

**Checked and found sound:** the closed-form inverse against `projectToImage` over 200 000 random
poses (worst 3.4e-13°); its only wrong-branch region (camera pitch above about 65° with the Sun
above about 70°) is unreachable; `no-pose` fires only on a tap error; the roll sign; the
independent round-trip test; night 2's findings 1, 3 and 5 as decided; the freeze held.

**Orchestrator decisions:** all four accepted and in one fix before the home session: step-14
candidates limited to the Sun and Moon with a mutation-checked test; the guide reordered to fix
the direction first; a refusal at the pitch clamp; the comment corrected; one field-guide line to
check for "(uncalibrated)". The domain limit gets one sentence in the re-anchor header.

---

## 2026-09-30, night 2 (reviewed 90ddd8e..ee65a8f, 34 commits)

The reviewer ran on `claude-fable-5-1`, not the pinned Opus 5.5 (transcript record); see finding 0.

**Adversary findings, ranked:**
0. The Opus 5.5 pin is not in force: this review ran on Fable 5.1.
1. The sun re-anchor solves heading as azimuth − atan((x − cx)/f), ignoring pitch
   foreshortening. Reproduced through `projectToImage`: 1.35° at a 30° Sun 10° off-axis, 4.29°
   at 30°/30°, 11.21° at 50°/30°; the pitch trim is wrong similarly. The e2e taps the centre and
   the rehearsal used a −4.5° summit, so nothing caught it.
2. Direction: the critical path is the 2-minute Pages action. Much of the day refined F3/F4 for
   bands the pre-registration predicts empty. Freeze the pre-registration and grader until field
   data; no CV runs before the field session. Pages was mislabelled "not urgent".
3. F2 vertical: the field pose is uncorrected, so a pass tests bias stability between sessions.
   The one-degree-of-freedom tap spread is noisy and blind to a shared tap error; floor it at
   0.543°/√taps. The bias is keyed by user agent while the FOV is keyed by camera track.
4. Archiving every edit of the pre-registration costs about 14 000 committed lines a day;
   AGENTS.md's two archiving sentences disagree.
5. A calibration tap fails with a misleading message when the app's own Sun is off the picture.
6. Fixture c4 encodes a state the app cannot produce; the grader would let such a bundle hide
   an anchor.
7. The aligned fixture's 0.8σ truncation makes "aligned passes" circular as budget evidence.

**Orchestrator decisions:**
0. Confirmed from transcripts: `builder` ran `claude-opus-5`, `strategy-adversary`
   `claude-fable-5-1`, `general-purpose` `claude-opus-5-5`. The session keeps the definitions it
   loaded at start. Roles now launch as `general-purpose` agents reading their role file
   (AGENTS.md); told to the human.
1. Accepted. Being fixed with an independent projection round-trip test; both guides now say to
   put the Sun near the middle before tapping.
2. Accepted. TODO records the freeze and moves three F3/F4 items below the field test; HANDOFF
   relabels Pages as the only blocker.
3. Accepted: the floor, the prereg sentence, and a check of track keying are in the same fix.
4. Rejected. Archiving before editing is the human's explicit standing preference. The two
   AGENTS.md sentences are consistent as applied: text edits are allowed, and the pre-edit copy
   is kept because the human asked for it.
5. Accepted, in the same fix.
6. Deferred below the field test (TODO); the app cannot produce the shape.
7. Accepted as a note: the aligned fixture is a parser fixture, not budget evidence. The
   allowance schedule has its own injected-exceedance tests (`src/live/field-analysis.test.ts`).

---

## 2026-09-29, night 1 (reviewed 622e084..90ddd8e, 30 commits)

**Adversary findings, ranked:**
1. The truth instrument was untested. The rehearsal annotation is its test: pre-register a
   stop rule. Two copies of one model are not two independent instruments.
2. F2's vertical gate fails on a phone by construction. No pitch-bias term exists once the FOV
   is calibrated, so the band claims about 0.003°.
3. GitHub Pages has been blocked about 5 h, all of it overnight in Denver. No human-free route
   was found: the static CDNs are 403 here, and other hosts need an account.
4. The grader scales overlay to frame by plain ratios. On the phone (956×440 over 1920×1080
   with cover), vertical residuals would be mis-scaled. Deviations were also printed as
   refusals.
5. Several TODO lines were stale or mis-ticked.
6. There was no defined path for getting the home-session file to the agent.
7. The photo count is nine, not seven. MISSION.md and README.md still named Expo as the vehicle.

**Found sound:** the error budget and exceedance gate; the split viewport and stored-frame
registration; the 60 km sweep range; fine drag before thresholds move; the privacy design; both
guides; keeping Bogus Basin and not asking for a date yet.

**Decisions:**
1. Ran the annotation. Both annotators returned null for all 17 summits and independently found
   the Deer Point towers. A follow-up review found the rehearsal pose about 92° off: EXIF says
   280°, and the towers put the camera at about 188°. So the 17 were never in frame, the nulls
   were correct, and the instrument caught a whole-frame false `visible`. Truth redesign adopted:
   three-state truth (apex, absent, cannot-identify); landmark truth from committed summit
   coordinates; annotators given the viewpoint and a map but no pose. Re-run the rehearsal at
   the true heading. The IMG_7270 heading is under investigation.
2. Accepted. Pitch-bias term measured from the sun at the home session; until then F2 vertical
   is not gated.
3. Accepted. The ask stands. The GitHub tools here have no Pages endpoint.
4. Accepted. The cover-crop mapping fix is in progress, refusals and notes are split, and the
   rehearsal will re-run at the phone's geometry.
5. Done in TODO.md.
6. The human emails the file to themselves and says so, and the agent reads that one message
   through the session's Gmail connector. Added to the home guide.
7. Being corrected.

