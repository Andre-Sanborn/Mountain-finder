# Handoff

The operational state a fresh session needs. Goals are in [MISSION.md](MISSION.md), decisions
and self-checks in [IMPLEMENTATION.md](IMPLEMENTATION.md), open work in [TODO.md](TODO.md).

## Needed from the human

- **An action only they can take: turn on GitHub Pages (about 2 minutes). It is the only blocker on the route: the home session, the field session and every phone check wait on it.** The
  Pages workflow builds and passes its gates, but the deploy step fails with 404 "Ensure GitHub
  Pages has been enabled" (run 36514664919). The repository's default branch is the retired
  `claude/topographic-peak-identifier-EV4ZN`, and a Pages environment normally deploys only from
  the default branch. The steps given: make `claude/gifted-lamport-3tyh5g` the default branch,
  then set Pages Source to GitHub Actions. Agents re-run the workflow afterwards. Blocked until
  then: the public HTTPS address the phone will open. Nothing else.
- **Recorded, not asked: how "archive all of our work" was read.** Snapshot the state, archive
  the governance documents, keep the code and build on it. The human can say if they meant a
  whole-tree archive and rebuild.
- **Settled 2026-09-29.** The nine photographs stay public. The Bogus Basin field session happens
  only after local testing, meaning the home session first. The usage-budget rule stays in this
  repository only.
- **Told, not asked (2026-09-29): what the Bogus Basin session can grade.** Agent annotators,
  with or without a top-down map, agreed on no summit beyond the drag anchor (Deer Point) in the
  rehearsal frame, and the near band is site-limited. Expect the session to test sensors, pose,
  visibility and the tilt zero point (F2, F5, F6), and probably not label placement beyond the
  anchor. The orchestrator is going ahead; the human can say the drive is not worth it. A second
  site is not proposed until this session's data exists.
- **Coming later: the home session (~15 min) and the field session (~30 min).** The steps are
  written in [docs/HOME-SESSION-GUIDE.md](docs/HOME-SESSION-GUIDE.md) and
  [docs/FIELD-SESSION-GUIDE.md](docs/FIELD-SESSION-GUIDE.md). Both are blocked on GitHub Pages
  being on. The home session comes first, because it measures the drag and roll terms.

## Where the work lives

- **Development branch:** `claude/gifted-lamport-3tyh5g`. Push with
  `git push -u origin claude/gifted-lamport-3tyh5g`.
- **Remote:** `https://github.com/Andre-Sanborn/Mountain-finder`.
- **Pre-restructure snapshot:** commit `622e084`. A local tag `v2-snapshot-20260929` points at
  it; the tag could not be pushed, so on the remote the snapshot is that commit id.
- **Retired branch:** `claude/topographic-peak-identifier-EV4ZN`. Left in place on the remote
  and not used. Its fate is an open TODO item.

## Running the gates

Run these from the repository root.

| Gate | Command |
|---|---|
| Typecheck, lint, full unit suite | `npm run check` |
| End-to-end in real Chromium | `npm run test:e2e` |
| Ground-truth acceptance cases | `npm run test:acceptance` |
| Packaged deployment behind a plain static server | `npm run build && npm run fetch:tiles -- N45E007 && npm run package:deploy -- --gzip && npm run test:deploy` |
| The fallback shell: typecheck, lint and a real Metro/Hermes build | `npm run check:mobile` |
| A human-viewable annotated PNG | `npm run demo -- gornergrat` (needs `data/tiles/N45E007.hgt`) |

### Last recorded counts

All six gates were re-run from a clean `npm ci` on 2026-09-29 and passed. `test:deploy` is the
one gate that needs data a fresh clone lacks: the gitignored tile `N45E007`, fetched first.

| Gate | Count, 2026-08-17 | Count, 2026-09-29 |
|---|---|---|
| `npm run check` | 1 168 tests | 1 218 tests over 63 files; typecheck and lint clean |
| `npm run test:acceptance` | 178 assertions | 178 passed |
| `npx playwright test` | 22 | 22 passed (`CI=1`) |
| `npm run test:deploy` | 5 | 5 passed, after `npm run build && npm run fetch:tiles -- N45E007 && npm run package:deploy -- --gzip` |
| `npm run check:mobile` | 750 modules bundled (2026-08-18) | passed, 750-module iOS Hermes bundle |

## Status per level

Each line says when it was last verified. The goal each level is aiming at is in MISSION.md.

1. **Base (v2.0) — met, last verified 2026-08-17.** The whole chain runs end to end: a photo
   dropped into the web app renders a real overlay where terrain is available, and exports it.
   It is proven on four ground-truth viewpoints and on a packaged static deployment. Since Q8
   the app reads the 9 237-summit Overture dataset over `/peaks/` rather than 15 bundled
   summits.
2. **CV upgrade (v2.1) — wired in, limits measured, last verified 2026-08-17.** Auto-align is
   in the app and in `npm run annotate -- --auto-trim`: it proposes trims for the visible
   sliders and never corrects anything behind them. Against the one photograph with an
   independently solved pose it recovers **heading to 0.109°** — better than the phone's
   magnetometer at 0.596° — and **pitch to 0.690°** against a truth of −3.520° that EXIF never
   records, moving a summit flag from 332 px off its apex to 66 px. Two measurements shaped what
   shipped: a wide heading search returns a confident impostor 10.4° off (CV-10), so the search
   is clamped to a compass budget and refuses rather than hunting wider; and the extractor's
   snowfield and tundra locks are fixed by a sky-roughness cue (CV-2), which turned wide frames
   from confidently wrong into honestly unreadable. **Open: recall, not correctness.** Hazy
   distant crests report nothing, so the 24 mm and 14 mm frames decline (24 mm coverage 38 %,
   14 mm 0 %).
   **A photograph has been annotated end to end.** `npm run annotate` puts a flag on Castle
   Peak's summit in the Railroad Ridge frame, one pixel from where the summit is in the picture.
   What made that possible was not a code change: the photographer supplied the camera
   originals, whose EXIF the transcode had stripped. Every earlier run had assumed a
   26 mm-equivalent lens against a 48 mm frame, a 1.69× scale error no search can absorb, and
   the reason the aligner had refused everything.
3. **Live view (v3) — pure layers proven, no phone has run either vehicle; last verified
   2026-08-18.** `src/live/sensors.ts` (pose from gravity and compass, with the EXIF path's
   refusals), `src/live/device-samples.ts` (device payloads into those traces, four sign, unit
   and sentinel traps recorded as X-11) and `src/live/loop.ts` (one scene re-projected per tick,
   proven identical to re-running the still pipeline, refusing when the camera turns past swept
   terrain) all exist and are tested. **`live.html` in the phone's own browser is the vehicle**
   (IMPLEMENTATION.md, "The route to the field test"): it is served from GitHub Pages and its
   AR loop is driven headlessly in Chromium. `mobile/` is the fallback: an Expo Go app needing
   no Mac, no Xcode and no Apple Developer account, typechecked against the real SDK together
   with the 39 shared files it imports unchanged, which is P8.1's no-fork bar. No further effort
   goes into it until the browser route fails on the phone. Either vehicle's first job on the
   phone is the four-hold frame-convention check rather than the AR view, deliberately:
   `sensors.ts`'s conventions are proven as mathematics and not against hardware, and building
   peak labelling on an unverified sign is the ordering mistake this project keeps declining to
   make. **Nobody has run either on a phone**, so it is `[~]`, not ticked.

**The honest gaps.** Live API egress is 403 at the proxy, so `fixtures/api/**` was never
recorded from OpenTopoData or Overpass (P2.4 unmet, marked `[~]`). The sensor module's frame
conventions are proven as mathematics but not against hardware, so P8.2's recorded-trace bar
stays open.

## Where the data lives

Both directories are gitignored and are rebuilt by running the fetch scripts.

- `data/tiles/` — SRTM `.hgt` / `.hgt.gz` tiles, fetched by `npm run fetch:tiles` from AWS Open
  Data (`elevation-tiles-prod/skadi/…`). A full tile is about 25 MB.
- `data/overture/` — Overture parquet footers cached by `npm run fetch:peaks`.

The acceptance suite does not read `data/tiles/`: its terrain windows are cut byte-for-byte from
real tiles and committed under `fixtures/`. `npm run demo` and `npm run annotate` do need the
full tiles, and stop with instructions when one is missing.

## Network egress from this environment

| Host | State |
|---|---|
| `s3.amazonaws.com` | reachable — SRTM tiles (`elevation-tiles-prod`), `osm-pds`, the Overture distribution |
| `api.opentopodata.org` | 403 at the proxy |
| `overpass-api.de` | 403 at the proxy |
| Wikipedia, `parks.ca.gov`, `seattle.gov` | 403 at the proxy |
| `download.geonames.org`, geofabrik, naturalearthdata, `planet.openstreetmap.org`, taginfo | fail at the proxy |

## Nightly strategy review

- Routine "Mountain-finder nightly strategy review", `CRON_TZ=America/Denver 52 1 * * *`, firing
  into the orchestrator session. Brief and verbatim prompt:
  [`.claude/reviews/nightly.md`](.claude/reviews/nightly.md).
- Entries are appended to [docs/REVIEW-LOG.md](docs/REVIEW-LOG.md), newest first.
- Last reviewed commit: `fcaecaa` (night 4, 2026-10-02). Weekly continue-question due on night 7, 2026-10-05.
- Nightly reviews started: 2026-09-29. Last weekly continue-question: `<none yet>`; the first is
  due on the seventh night.
- At session start, check the Routine exists (`list_triggers`) and recreate it if not.
