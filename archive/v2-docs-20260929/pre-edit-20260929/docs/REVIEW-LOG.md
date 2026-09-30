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

