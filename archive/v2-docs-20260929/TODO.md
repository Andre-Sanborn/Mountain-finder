# TODO

Live checklist. Check an item only after its self-check has been run and passed —
[PLAN.md](PLAN.md) defines every check and carries the phase-by-phase status.
Every confirmed finding is indexed in [docs/FINDINGS.md](docs/FINDINGS.md); the detailed
write-ups are in the three `REVIEW-FINDINGS*.md` files and are not repeated here.

**Where the project stands** is stated once, in [README.md](README.md#status-honestly).

---

## Open

| # | Item | What it needs |
|---|---|---|
| **P7.5** | The extractor on real photographs — **precision solved, recall open** | The sky-roughness cue (CV-2, 2026-08-17) ended the confidently-wrong era: no frame now reports a boundary whose "sky" contains terrain — the 24 mm foreground lock is gone, the 14 mm frame refuses outright, the 48 mm snow-band columns snapped to the crest, and with the comb the 48 mm suggestion reached heading err −0.109° / pitch err +0.690°. What remains is RECALL: hazy distant crests report unreadable (24 mm coverage 38 %, 14 mm 0 %), so wide frames decline for want of columns rather than align. That needs a cue for soft crest steps under haze — a different problem from the one just solved, and one where "unreadable" is at least never "wrong" ([docs/CV-REAL-PHOTO-FINDING.md](docs/CV-REAL-PHOTO-FINDING.md)) |
| **P7.7** | Pitch is unrecorded and always wrong at zero | EXIF carries no pitch, `--pitch` defaults to 0, and in all four annotated photographs the drawn horizon sits wrong because of it — Railroad Ridge −3.52°, and the Bogus Basin 480 mm frame needed a hand-supplied +4.3° before any marker landed on-image at all. **The recovery path now ships**: the app's auto-align panel and `npm run annotate -- --auto-trim` both recover pitch to within 0.82° on the one frame with solved truth (CV-10). On iOS this term largely solves itself — the phone knows its pitch at capture time — worth remembering before over-investing in photo-only recovery |
| **P7.6** | ~~The two wide frames refuse~~ — **tested, refuted, folded into P7.5** | The hypothesis was near-field foreground the sweep never sampled. Measured, the error is largest at frame CENTRE and smallest at the edges, and the extractor puts its boundary at `rowNorm` **0.999** — the bottom row of the picture. It is tracking foreground tundra, not sky. No near-field term is needed: this is CV-2 again, a sky/land cue that a snowfield or sunlit tundra edge can also satisfy. One fix, two symptoms — see [docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md) |
| **R-2, R-3** | Residuals the reviews left open by decision | `src/cv/rays.ts:profileCoverage` duplicates the coverage notion with a largest-gap heuristic; `'nearest-valid'` is discontinuous at a grid line (a policy decision, not a bug). **R-1 fixed 2026-08-17**: a peak whose bearing lies outside a bounded sweep's span now gets NO verdict (`unmeasured`, with a warning) instead of one interpolated across the entire un-swept arc; full-circle sweeps are untouched, and the app's overlay note now names the sector case. **R-4 fixed 2026-08-17**: `scripts/terrain-server.ts` windows label through `datasetLabelForStepDeg`. Detail in [docs/FINDINGS.md](docs/FINDINGS.md#residuals-left-open-by-the-reviews) |
| **Phase 8** | Live view (v3) — **P8.2's engine built; the shell needs a toolchain this environment lacks** | `src/live/sensors.ts` (2026-08-17): pose-from-sensors as a pure module under core's rules — gravity → pitch/roll, circular heading smoothing, declination discipline, five named refusals, 16 hand-derived tests. This is what BOTH iOS paths need first: in-app capture records the pitch EXIF never carries (killing P7.7 at the source), and live view consumes the same `SensorPose`. Deliberately NOT scaffolded here: the Expo shell (P8.1) — its self-check is the core suite under the mobile toolchain, which cannot run in this environment, and this repository does not ship code whose check has not passed. **P8.3's loop is built too** (`src/live/loop.ts`): verdicts are pose-free, so one scene re-projects per sensor tick, and a pose whose drawn span leaves the swept sector is refused with the overshoot measured — proven marker-for-marker equal to the still pipeline over a 9-pose sweep. **2026-08-18 — the device-facing half is now pure and tested too**: `src/live/device-samples.ts` converts Expo's payloads into the documented sample types (X-7: no `gravity` field exists, units are m/s², the sign is CoreMotion's and *not* W3C's, the compass `accuracy` is a 0–3 bucket, and the two channels run on different clocks — every one of those a plausible wrong number), and `src/live/calibration.ts` turns "the frame convention is unproven against hardware" into a four-hold check that names the specific signed axis map when it disagrees, verified over all 48. What still needs a phone is now bounded: run the holds, read the verdict. **And the shell to run them in exists** (`mobile/`, P8.1): Expo SDK 57 under Expo Go — no Mac, no Xcode, no Apple Developer account — with a Calibrate screen and a Horizon screen (camera + the real `projectToImage`). `npm run check:mobile` is green over the app **and** the 39 shared files it imports unchanged across the repo root — typecheck, lint, and a real Metro+Hermes build (750 modules). That build step caught X-8 on its first run: the app typechecked, linted and passed every test while being unbuildable, because `src/app/trim.ts` imported the `../exif` barrel and dragged `exifr`'s dynamic `import()` into a bundle Hermes rejects. Unrun on hardware, so `[~]` not ticked. Peak labelling is deliberately absent until the holds pass and D7 says how a phone carries DEM offline. **Corrected same day after review**: the Horizon screen originally refused to draw without true north, which inverts D9 — it withheld the drag precisely when the heading was worst. Now `src/live/heading-policy.ts` draws a *labelled* magnetic bearing (amber, dashed, `MAG`) and `src/live/drag-trim.ts` lets a finger push the overlay into place, writing the same visible `TrimState` the web sliders write. The drag inverts the projection properly — the naive `fov ÷ px` scale lags the finger by 46% on a portrait frame's 108° vertical field, caught by a round-trip test through the real `projectToImage` |

## Blocked on the environment, not on code

| # | Item | Blocker |
|---|---|---|
| **P2.4** | Re-record `fixtures/api/**` from live OpenTopoData + Overpass | Egress 403s both at the proxy. The recorder and its offline `--verify` work; the fixtures are **hand-authored against documented schemas and labelled as such**. The elevation fixtures are superseded anyway (real SRTM bytes from AWS are better evidence than recorded JSON) — but the Overpass recording genuinely never happened. Recorded `[~]`, never ticked |
| **P6.2** | Real-viewpoint research against reachable reference sources | Wikipedia, parks.ca.gov and seattle.gov all 403. The four case files' coordinates carry resolvable source ids and an `access` field, and must be re-verified against live pages before they gate a release |
| **X-6** | Turn the real photographs into acceptance cases | **Done for every photograph that has an original; closed for the one that does not.** The upload path stripped the GPS IFD from the JPEGs; the CAMERA ORIGINALS still had everything, and asking for them was all it took. Railroad Ridge has a measured heading (174.089° T), a GPS fix, an altitude and a lens, re-read from committed HEIC bytes by the suite; four Idaho frames are annotated end to end. **Sunset Mountain (IMG_0592) is closed as unavailable, 2026-08-17** — the photographer tried repeatedly to supply the original and the transcoded copy is all that survives. It was never geotagged on that phone either (see the companion-photo evidence in [docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md)), so this is a fact about the file, not a pending request. Do not re-ask |

---

## Done

### X-4 — the Kerry Park height-sensitivity note, written into the case file, 2026-08-17

The Mount Baker must-NOT-see gate now carries, in its own rationale, the measured fact that
the geometric verdict flips inside the file's stated ground-height uncertainty (DEM 103.8 m
→ hidden by −1.67°; cited 113 ± 15 m → visible by +0.31° at the band's top), that the
published-claim evidence is what actually carries the verdict, and that the DEM reading — a
smooth urban hillside, the terrain SRTM is best at — is the defensible height to judge from.
178 acceptance assertions unchanged.

### Q9 — the DEPLOY.md cost table, re-measured post-Q8, 2026-08-17

*(The row above should have left Open in the commit that updated the table — caught one
commit late, recorded rather than hidden.)* The table now carries: 16 tiles + windows =
417.57 MB / 189.24 MB on the wire; a `/peaks/` row (3.48 MB, 63 cells + 5 indexes, with the
per-region split); the per-session statement a deployer budgets with — one terrain grid
(16.35 MB gzipped alpine worst case) plus at most the largest region's cells (1.26 MB,
usually a few hundred KB, other regions pruned by their bundled indexes before any request);
bundle 340.21 kB / 110.63 kB gzipped. The `--no-peaks` demo paragraph was corrected: since
Q8 that trim is an error by design, enforced by `verifyPeaksAreServed`.

### P7.4 — CV integration, wired end to end, 2026-08-17

Both halves shipped the same day the CV-10 measurements redesigned them. The decision layer:
`suggestPoseTrim` (src/pipeline/cv-alignment.ts) — near-field-free profile REQUIRED and
checked from the profile's own distances, heading search clamped to a compass budget
(default ±6°; the ±25° window returned a confident impostor 10.4° off on real terrain),
suggestion-not-correction per D9. The app wiring: `AnnotatedScene.alignmentHorizon` (same
sweep, near samples dropped — no second terrain pass), `OverlayResult.alignment` carries it
with the pose across the seam, `createTrimSuggester` (src/app/auto-trim.ts) reads RGBA off a
≤1600 px canvas copy and projects the result into sentences, and `AutoTrimPanel` shows the
proposal with an Apply button that writes THE SAME trim state the sliders and the drag
write — nothing is ever corrected behind the controls, and a refusal renders as a visible
sentence, never an empty region. Proven: on the real Railroad frame the suggested trims beat
the phone's compass on heading (−0.208° vs 0.596°) and assumed-zero pitch by 4× (+0.817° vs
3.52°); in Chromium the grey Gornergrat fixture is declined out loud with no Apply button
(new e2e). The annotate script gained `--auto-trim` in the same push: it prints the
suggestion with its diagnostics, applies it VISIBLY, and re-runs the scene at the corrected
pose — on the Railroad frame Castle Peak's flag moves from (+56, +332) px off its true apex
at the raw EXIF pose to (+20, +78) px, the vertical error cut 4.3×, which is P7.4's "label
error strictly improves" bar measured in pixels on a real photograph. Gates: check 1 147,
acceptance 178, playwright 22, deploy 5.

### Q8b — the density policy, decided by measurement, 2026-08-17

Q8 put 26 markers in the frame that used to hold one, so the filed question — merge summit
clusters? disambiguate repeated names? — was answered by measuring the imported data rather
than by choosing among the filed options:

- **Same-name node splits are rare and shallow:** 11 same-name pairs within 300 m across all
  9 237 summits (e.g. `Pointe Gorret` twice, 201 m apart, equal heights). Not worth a merge
  pass; the collision layout stacks them honestly.
- **The famous "clusters" are real, differently-named summits.** Matterhorn's 4 points within
  447 m are Matterhorn, Épaule de Furggen, Picco Muzio and Pic Tyndall — each a genuinely
  named feature, Pic Tyndall a recognised subsidiary summit. Rainier's pair is Mount
  Rainier + Columbia Crest, and Columbia Crest is the TRUE summit name. **A merge would
  delete real names to fix a layout problem the renderer already solves.** In the Alps this
  is the norm, not the exception: 275 of Zermatt's 1 786 summits have a different-named
  neighbour within 300 m.
- **The policy therefore IS the existing crowding system** (`src/render/layout.ts` rules 1–7,
  `src/render/crowding.ts`): deterministic apparent-height priority — the dominant summit
  wins the space — dots for everything, withheld names counted on the image and named in the
  notes. No data is touched, no name invented, no summit dropped.
- Repeated names across a region (California's 305) need no code: every label already carries
  its distance, and D9 makes a label a direction, not an identification.

Decision recorded here rather than in a new mechanism, because the mechanism already existed
and the measurements say it is the right one.

### X-5 — the exact-tie contradiction, resolved by reading the gates, 2026-08-17

The trigger for resolving it now: **P1.6 made `clearanceDeg` load-bearing** (marginality
thresholds on it), which is exactly the dependency X-5 said to settle first. Settled by
evidence, not by picking a record: `tests/acceptance/analytic-scenes.test.ts` asserts today
that the cone apex's occluding angle is its own FLANK (7.976826°, clearance **0.50275°**) and
the near crest's is the terrain in front of it (3.590565°) — the mis-reported tie values the
finding quoted (8.481293°, 4.554485°) appear in the suite only as the *skyline* figures they
really are. So **Q2's record was right**: `COINCIDENT_DISTANCE_TOLERANCE` fixed it, the
open-findings carry-over was stale, and 178 acceptance assertions gate the fixed behaviour.
FINDINGS.md X-5 updated to say so.

### Q8 — the app reads the 9 237-summit Overture regions, 2026-08-17

`src/app/main.tsx` now hands the pipeline `createRegionPeakSource` (new
`src/providers/http-peak-store.ts`): region INDEXES compiled into the bundle — the same
import the attribution footer reads, so the queried regions and the credited regions cannot
drift — and summit CELLS fetched same-origin from `/peaks/<region>/cells/…`, pruned to the
cells a query's box touches (a Gornergrat query fetches nothing of California's 3 341
summits). Five regions, 9 237 summits (the count grew past the "8 528" this item was filed
under when idaho-central was imported). In dev the layout is served by the new
`scripts/peaks-server.ts` plugin; in production `package:deploy` stages it as before, and
`verifyPeaksAreBundled` became `verifyPeaksAreServed` — packaging now FAILS if the bundle's
regions are not all staged, the exact inverse of the old assertion, for the same reason in
the new architecture. `peakDataReadByThisBuild` flipped to `'regions'` in the same commit.
The 15 cited summits stay bundled for the footer's count and the acceptance suite. The
predicted density finding arrived on cue: the Gornergrat e2e frame draws **26 summit
markers** where the bundled dataset drew one, so the e2e and deploy specs now pin what the
geometry owns — several markers, one within ±12 px of the Matterhorn's closed-form position —
rather than a count the dataset owns (see Q8b, above). Self-checks: `npm run check` 1 135,
`npm run test:acceptance` 178, `npx playwright test` 21, `npm run test:deploy` 5 — all green.

### P1.6 — the `marginal` visibility state, built 2026-08-17

`PeakVisibility` gained `'marginal'`: a peak whose visible/occluded verdict FLIPS within the
uncertainty of the near-field ground it was measured against is labelled, de-emphasised, and
says **"may be hidden"** — in either direction, because a summit 0.05° short of a phantom is
exactly as undecided as one 0.05° over it. All opt-in behind `PipelineConfig.nearFieldRadiusM`
(default 0): with it unset every verdict is bit-identical to before, proven by the 1 128-test
suite passing unchanged before the new tests were added. Each peak's band is measured over the
ground in ITS direction only (±15° of its bearing) — the first real run showed why: an
all-directions band on a ridge crest reached ±17° and flagged summits under kilometres of rock.
Measured on Railroad Ridge (`npm run annotate`): **9 visible, 4 marginal, 29 occluded** — the
four marginal peaks (clearances −0.98° to −1.55° against bands ±1.5–2.1°) were previously
foreground-occluded, i.e. silently dropped, on the strength of a 90 m phantom; Castle Peak
stays confidently visible because its occluder is its own ridge at 11 km. Self-check:
`npx vitest run src/pipeline/annotate.test.ts src/core/visibility.test.ts src/core/horizon.test.ts`
(the P1.6 blocks), plus the unchanged 178-assertion acceptance suite. Full write-up appended to
[docs/NEAR-FIELD.md](docs/NEAR-FIELD.md). **P7.7 note:** the aligner-pitch option now has its
prerequisite: the near-field phantom this state carries is the same one that made the aligner's
pitch wrong.

### v2.0 ship gate — MET 2026-08-16

Every gate verified at the coordinator, not taken from an agent's report.

| Gate | Result |
|---|---|
| `npm run check` | 38 files, **746 tests** ✅ |
| `npm run test:acceptance` | **148 passed, 0 todo, 0 failing** ✅ |
| `npx playwright test` | **13 e2e** ✅ |
| `npm run build` | production bundle ✅ |
| Demo artifact | produced, **opened and inspected**, committed to `docs/artifacts/` ✅ |
| High-confidence ground truth | all passing, incl. Cow Hill now passing *honestly* ✅ |

**Two things v2.0 shipped with, stated rather than buried:** P2.4's self-check is unmet (above),
and **peak coverage was the binding constraint, not the code** — the bundled database held three
alpine summits, which is why the first demo showed one label rather than a skyline of them.
Everything downstream of the database was finished and tested. Q5 fixed the database.

After Q6 (attribution) the gates read: `check` **50 files / 1 025 tests**,
`test:acceptance` **153**, Playwright **21**, `test:deploy` **5**.

### Review gates

| Gate | Evidence |
|---|---|
| Wave 1 review | [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) — `src/core`, `src/providers`, `src/exif`, `fixtures/scenes` |
| Wave 2 review | [REVIEW-FINDINGS-2.md](REVIEW-FINDINGS-2.md) — `src/pipeline`, `src/app`, `src/core/visibility.ts`, `tests/acceptance`, plus 12 mutations |
| Wave 3 review | [REVIEW-FINDINGS-3.md](REVIEW-FINDINGS-3.md) — `src/providers`, plus 39 mutations |

The three review documents do not map one-to-one onto the original A/D/E wave labels — the
scopes were re-cut as the code moved. Recorded rather than renumbered.

### Findings fixed

Full write-ups and ids in [docs/FINDINGS.md](docs/FINDINGS.md). What landed, with the figure
that proves it:

- **Q2 — Wave 1 findings.** W1-1 `sweepRay` skips `d = 0` and throws on negative/NaN · W1-2 the
  cone fixture states the nearer-terrain occluder (7.976826°, clearance 0.502750°) instead of
  the apex against itself · W1-3 `normaliseHorizonProfile` merges the **union** of both
  staircases · W1-4 an out-of-range override surfaces as `needs-manual` / `'out-of-range'` and
  is never replaced by EXIF (lat, lon, `eyeHeightM ≥ 0`, hFov/vFov in (0,180)) · W1-5 `HgtTile`
  compares longitude mod 360, so lon +180 reads from `W180` · a peak coinciding with a terrain
  sample is no longer its own occluder (`COINCIDENT_DISTANCE_TOLERANCE` — but see X-5 above,
  which the same file also carried as open) · W1-6 `horizonCoverage` + `hasTerrainAtBearing`
  (pure) refuse a bearing whose bracketing pair has a lost ray between them, and such a peak
  reaches **no verdict**: it goes to `AnnotatedScene.unmeasured`. A bounded sweep is not a hole,
  and the distinction is exact rather than a gap-width heuristic. All four ground-truth cases
  lose no rays, so 148/148 verdicts were unchanged · W1-7 `HgtTile.bilinear` sums the void
  corners' **weights** instead of setting a flag; below `NEGLIGIBLE_VOID_WEIGHT` ≈ 3.05e-8 the
  reading is `'bilinear'` under both policies. Void semantics untouched — voids stay `null` and
  are never averaged in.
- **The deferred rename, no behaviour change.** `ExpectedPeakVerdict.skylineAltitudeDeg` and
  `VisiblePeak.horizonAltitudeDeg` → **`.occludingAltitudeDeg`**, both meaning "highest angle
  reached by terrain NEARER than the peak". The second carried the identical misnomer one layer
  down and its doc comment had to spend a paragraph insisting it was not the skyline — a name
  that has to be defended in prose is the exact condition that let W1-2 happen. Genuine skylines
  keep their names (`HorizonPoint.altitudeDeg`, `.skylineSteps`, `ExpectedSkylinePoint`,
  `interpolateHorizonAltitudeDeg`, twin-ridges' local `skylineAltitudeDeg`). `tsc` located all
  39 call sites; every expected value is byte-identical.
- **Q2b — Wave 2 findings**, in the review's own order, each with a test watched failing first.
  W2-1 the crest is now the highest-angle nearer sample; the review's terrain reads
  `colDepthM 400` and `foreground-occluded`, and **no ground-truth verdict moved** — Cow Hill is
  still self-occluded with col 0, Ben Nevis still foreground-occluded, its col now 216.1 m below
  a 232 m crest instead of 128.5 m below a 144 m one. One unit fixture had to be rebuilt: the
  `colToleranceM` test put its 6 m dip *behind* the skyline-forming sample · W2-2
  `rangeIsMeasured` keys on terrain **measured**, not on the configured range, so a ray
  truncated by missing tiles is refused on the same footing as one truncated by `maxRangeKm`;
  `judgeBeyondMeasuredTerrain` (default false) is how a caller with a deliberately truncated
  sweep declares it, and the two acceptance cases whose windows are 3–5 km against 60–292 km
  sightlines set it, while Gornergrat and Fort William leave it off — so the refusing default is
  gated end to end by real viewpoints · W2-3 `extract.ts` reads `Orientation` (nothing in `src/`
  did), reports **displayed** dimensions, and gives the 36 mm angle to the longer displayed
  axis; new fixture `fixtures/photos/portrait-orientation-6.jpg`, and the test that **pinned the
  bug** now states 30.219150 instead of 39.597753 and says in the test why it changed. The
  long-side vs diagonal reading of `FocalLengthIn35mmFormat` is a convention — they agree
  exactly at 3:2 and differ by ~1° at 4:3 — and `fov.ts` states the choice, the alternative and
  the cost · W2-G1 Ben Nevis promoted `medium` → `high` · W2-G2 the first horizontal-placement
  assertions in the suite, at Δ = ±20° off the optical axis from the rectilinear closed form.
  Acceptance **153** (was 148; none weakened, 5 added).
- **Wave 3 findings.** W3-3 `TiledPeakStore.coverageFor` answers from the index alone — bounds,
  cells spanned vs held, and `coveredRadiusKm` from `R·|Δφ|` and `R·asin(sin Δλ · cos φ)`;
  Zermatt + 200 km reports complete=false, 24 spanned / 4 held, covered to 32.2 km, which is the
  radius at which Mont Blanc's absence stops being evidence · W3-G1 the whole-world bbox
  fallback is pinned, verified to fail against the inverted implementation that all 293 previous
  tests passed · W3-G2 `slice(100, 200)` must send `bytes=100-199` · W3-1 `lonWidthDeg` measures
  from the raw bounds, and `fetch:tiles --around 89,10 --radius-km 200` went from 3 tiles on
  W170 (not including the one underfoot) to 1080 = 3 bands × 360 · W3-2 `withinBox` and
  `tileNamesForBounds` now share `lonWithinBounds` · W3-4 `datasetLabelForStepDeg`.
  Suspicions closed: sidecar steps must be positive and rows/cols integers ≥ 2;
  `resolveTerrainUrl` refuses `//host/x`; `recordsWithin` breaks distance ties on the peak id.

### Phases

- **Phase 0 — Scaffold.** Vite 6 + React 18 + TS (strict, `noUncheckedIndexedAccess`) + vitest 3
  + ESLint 9 + Playwright; all five commands verified green. `src/core/types.ts` is the frozen
  shared contract, separating `elevationM` from `altitudeDeg`.
- **Phase 1 — Geometry core, 178 tests.** Geodesy (a meridian-convergence test rejects a
  rhumb-line impostor) · sightline (the analytic cone matches closed form to 1e-12 against a
  0.01° spec) · horizon profile (exact at samples, seam-continuous across 359°→0°) · projection
  (guards the tangent-vs-angle-linear mistake) · visibility (occlusion by **nearer** terrain
  only — see X-2 below).
- **Phase 2 — Data providers, 64 tests.** Transport with injected sleep, so backoff is asserted
  with zero wall-clock wait · elevation provider batching 100 with request order verified and
  `null` no-data preserved · Overpass peaks with `ele`/`ele:ft` parsing. **P2.4 unmet**, above.
- **Phase 2b — SRTM tiles (D7), 108 tests.** `.hgt`/`.hgt.gz`, grid size from file length,
  bilinear + nearest; voids are `null`, never a number. `floor` naming verified across all four
  hemispheres, the antimeridian, the poles and exact integer degrees. `fetch:tiles` validates
  grid size before the file lands under its final name, so a truncated download cannot pass.
  Real-bytes fixtures for N45E007 and N46E007, reproducible via `npm run fixtures:tiles`.
  Verified against the real 25 MB tiles: Grand Combin 4287 m, Matterhorn 4230 m, and
  **N45E007 row 0 == N46E007 row 3600 on all 3601 shared-edge samples**.
- **Phase 2c — Peak store + pipeline, 62 tests.** `peak-store.ts` implements the same
  `PeaksProvider` seam as the Overpass client, which is **kept** as the importer for when egress
  opens; every coordinate and height is copied from the cited case files and the parser refuses
  a dataset whose citations do not resolve. Summit heights come from there and **never** from
  SRTM (Matterhorn 4478 m, not the tile's 4230 m, 320 m out of position). `annotateScene` and
  `annotatePhoto` return data, never pixels, and refuse rather than guess
  (`observer-elevation-unknown`, `no-terrain`). Case terrain windows are cut byte-for-byte from
  real tiles, so the acceptance suite is offline and does not read `data/tiles/`.
- **Phase 3 — Photo ingestion, 69 tests.** Real JPEGs authored byte-wise; `GPSImgDirectionRef`
  honoured; nine pose fields each resolved or explicitly `needs-manual`.
- **Phase 4 — Renderer, 97 tests + 2 e2e.** Pure `scene → string`. Horizon polyline sampled in
  bearing across 1.5× hFOV and Liang–Barsky-clipped; off-frame and behind-camera peaks reported,
  never drawn. Collision avoidance places left-to-right (ties by peak id, never input order) and
  can *skip* levels, because poles are measured from their own summits; an overlap is **flagged,
  not dropped**. Geometric self-check met: the flag lands at 1600·(√3−1) = 1171.281 px /
  524.820 px, hand-derived, to better than 0.01 px against a ±0.5 % gate. PNG export composites
  in Chromium via Playwright with **zero new dependencies**, and probes the raster — the pixel
  at the hand-computed summit is marker-coloured, control pixels are not.
- **Phase 4b — D8, obscured summits labelled and greyed, +24 tests.** `classifyOcclusion` splits
  an occluded summit by **what** hides it: walk the peak's own ray from the crest to the peak's
  range, and if no sampled ground falls below that crest there is **no col**, so the blocker is a
  shoulder of the peak itself → `self-occluded`, labelled greyed. A col → `foreground-occluded`,
  never drawn. Deliberately not a distance ratio (unitless, and wrong for two ridges 15 km apart
  at 85 and 100 km) and not an angular deficit (scales with how close the observer stands).
  `colToleranceM` defaults to **0** — a col is a col. Two refusals err the same way: a gap in the
  record wide enough to hide a col, and a bearing whose nearest ray has no blocker at all.
  Threaded through the pipeline, drawn with a dashed pole and hollow ring, and surfaced in the
  app as a switch that is ON by default per the user's decision. There is deliberately **no**
  switch for foreground-occluded peaks.
- **Phase 5 — Web app.** Drop-zone → EXIF autofill → honest provenance panel → trim sliders →
  real overlay: the Gornergrat fixture photo is driven through the whole chain in Chromium and
  the Matterhorn flag lands within 12 px of the hand-derived 600.37, 315.48 px. A photo with no
  terrain (Chamonix, needs N45E006) shows the **named absence** instead. Export asserted from
  the PNG's own IHDR bytes at the photo's 1200×900.
- **Phase 6 — Ground truth, 153 assertions, 0 todo.** Four analytic scenes with independently
  derived expectations (`R_eff` derived symbolically = 7 322 998.62 m; each scene states its R
  and k) and four real cases (Gornergrat, Mount Diablo, Kerry Park, Fort William) with
  resolvable source ids. The harness banner states that a pass proves the **yardstick** is
  sound, not that the pipeline is correct. A 0.35° heading error fails the overlay assertion,
  which was checked rather than assumed. Confidence policy respected exactly: `high` gates,
  `medium` reports, `disputed` informs.
- **Phase 9 — Peak coverage from Overture Maps, +63 tests.** `npm run fetch:peaks -- --region
  zermatt` imported **1 786 named summits** (61 above 4 000 m) for **42.17 MB of a 29.47 GB
  release — 0.1431 %**; 10.77 MB with the footer cache warm. Six of thirteen columns are read,
  because `geometry` is ~96 % of the bytes. **P9.4's open question is answered: Overture does
  carry summit heights** — the `elevation` INT32 column is OSM's `ele` carried through unchanged,
  checked row-by-row against the same rows' `source_tags.ele` (Matterhorn `"4478"` → 4478,
  Weisshorn `"4505"` → 4505) — so records declare `elevationSourceKind: 'osm'` and **nothing is
  ever sampled from the DEM**: a summit with no `ele` is dropped and counted (285 in the Zermatt
  area). A box over the Southern Alps of New Zealand prunes all 128 groups of the European part
  to zero. Conflicts are **reported, not resolved**: 13 of 15 cited heights agree exactly or
  within 2 m, Mount Hamilton is −21 m, **Mount Tamalpais East Peak's two coordinates are 1 754 m
  apart** and must be re-checked before that summit backs any assertion, and `Breithorn` is
  ambiguous — OSM calls the cited 4 164 m summit `Breithorn Occidentale / Westgipfel` and the
  Valais holds three others. Table in `fixtures/peaks/README.md`.
  *Why Parquet-over-Range and not a bulk download:* every other peak source is blocked from here
  — `download.geonames.org`, geofabrik, naturalearthdata, `planet.openstreetmap.org` and taginfo
  all fail at the proxy, Overpass 403s — **but `s3.amazonaws.com` is reachable**, and both
  `osm-pds` and the Overture distribution list from it. Parts are ~800 MB each, so range-reading
  only the row groups a bounding box touches is both feasible and the correct shape: an
  acquisition step that writes a local dataset, never a runtime dependency, exactly like
  `fetch:tiles`.
- **Phase 10 — Deployment, self-check `npm run test:deploy`, 5 assertions.**
  `npm run package:deploy [-- --gzip]` stages `dist/terrain/` and `dist/peaks/<region>/` through
  the **same index builder the dev server uses**, and refuses a grid whose byte length disagrees
  with the geometry the index claims. The proof runs the built `dist/` behind a plain static
  server with **no Vite in the process**: manifest byte-identical to the packaged file, no
  `/@vite/client`, the Matterhorn within 12 px of the closed-form projection, a 25 934 402-byte
  tile arriving as 16 345 818 bytes and still passing the store's length check, **every request
  same-origin** (D7 enforced), and a viewpoint with no tile producing the named absence rather
  than a blank overlay. Visible ODbL attribution is derived from each dataset's own `sources[]`
  citation, not typed in, so a region under another licence changes the footer by itself; a bare
  `ODbL` stays `ODbL` and the version is never invented. Mutation-checked: `display:none` on the
  footer fails all five e2e assertions, and removing `position: sticky` fails exactly the one
  that says a loaded photo must not bury it. `grep -o OpenStreetMap dist/assets/*.js | wc -l`
  → **13** (was 0). See [docs/DEPLOY.md](docs/DEPLOY.md).
- **Phase 7 — CV skyline alignment, +78 tests + 1 e2e — built and proved, NOT wired in.**
  Injected offsets spanning ±20° recovered to **heading 0.022°, pitch 0.091°** through the full
  round trip and **0.013° / 0.075°** over the real SRTM Gornergrat horizon, against a 0.5° spec.
  Alignment is **not a pixel shift** — a rectilinear lens makes that wrong by 3.7° at the frame
  edge for a 10° error. The failure variant of `SkylineAlignment` carries **no offsets at all**,
  so a caller cannot read a confident zero out of a refusal; flat horizon, total fog, 80 % of
  columns lost, periodic ridgeline, an offset outside the search window, an offset exactly at
  its rim and a snow-capped skyline all refuse. P7.4 and P7.5 are open, above.
  *Still true of the repository's own fixtures:* `fixtures/photos/*.jpg` are uniform grey frames
  generated for the EXIF suite, and `gornergrat-matterhorn.jpg` yields **zero readable columns**
  (asserted in `src/cv/real-photo.test.ts` — refusing is the correct answer for that file). The
  known enemy is sunlit snow, which is brighter than a hazy sky: `align.test.ts` shows the
  extractor locking onto the *snowline* and the aligner refusing. The two real photographs in
  `fixtures/photos/real/` are what finally measured it.
- **Q1 — Integration.** `src/app/overlay-builder.ts` and `src/app/composite-export.ts` wired
  into `<App>`; the `?seam-probe=1` branch and its test are **deleted** and replaced by one that
  drives the real pipeline over real SRTM bytes. Browser terrain is static grids on the app's
  own origin, one code path for whole tiles and committed windows alike, the largest grid
  covering a point winning because a window can produce a false `visible` and only the tile can
  prove an occlusion. Synthetic test tiles are never served. Missing terrain is a **named
  absence** in the same family as `needs-manual`, checked *before* the pipeline runs. See
  [README.md](README.md#how-the-browser-gets-terrain) and [docs/DEPLOY.md](docs/DEPLOY.md).
- **Q3 — The demo PNG.** `npm run demo -- gornergrat` writes `out/annotated.png` from the real
  pipeline over the full `data/tiles/N45E007.hgt`, composited in Chromium with no second
  rasteriser and no new dependency. Full tiles are the **default** and a missing tile stops the
  run with instructions. The overlay is composited onto **this run's own terrain silhouette,
  hatched and captioned "not a photograph" on the image itself**; the horizon line lying on that
  silhouette is tautological and the report says so, while the peak markers are not, because
  they come from the peak database and the projection with no reference to the terrain sweep.
  **What the image shows:** the Matterhorn flag lands 1.92° above the drawn ridge — 1.92° at
  9.58 km is ~327 m, so the picture reproduces the documented DEM error (−248 m, displaced
  ~320 m) rather than a labelling bug. Broad summits do not show it: in the wide framing the
  Breithorn flag sits 0.27° above its own ridge, on it.
- **Q7 — `noTerrainMessage` made honest for a stranger.** It told every visitor to run
  `npm run fetch:tiles`, which is right for a developer and useless to the public. It now leads
  with what is true of the deployment, keeps the position, the missing tile and the grids
  served, says outright that photographs over shipped terrain are unaffected, and keeps the
  command **last and explicitly scoped** to someone running a source checkout. No assertion was
  dropped; two were added.
- v1 Expo attempt archived to `archive/v1-expo/` (2026-08-16).
- Mission docs written (MISSION.md, PLAN.md, TODO.md, CLAUDE.md).

---

## Kept for the record

Corrections and superseded findings are kept, not edited away. A project that advertises only
its successes teaches the next reader nothing.

### X-2 — the occlusion rule was wrong, and running the code found it

The fix: a peak is occluded only by terrain with distance strictly `<` the peak's own.
`HorizonPoint.skylineSteps` (additive, optional) carries the per-bearing running-maximum
staircase, and `interpolateNearerTerrainAltitudeDeg` answers "how high does terrain reach nearer
than this?" using the *same* bearing bracket and weight as the skyline query, seam included.
Core tests 151 → 178, acceptance 112 → 116. **No existing test needed changing** — none had
encoded the old rule, because every hand-built fixture peak already sat behind its occluder.
Two judgment calls recorded: strict `<` at the boundary (a summit *is* the sample at its own
distance, so `<=` would make every peak hide itself and leave the verdict to floating-point
luck), and a mixed bracket returns the real occluder rather than interpolating toward an
invented floor.

**Gate verification, independent of the fixing agent.** A throwaway suite was written against a
hand-built two-step profile (+2° at 5 km, taller +8° at 20 km), run, and discarded. It confirmed
all four directions, which matters because the danger in fixing over-occlusion is over-correcting
into a filter that shows everything: near peak +4° @10 km in front of the far ridge → **visible**
(the original bug); far peak +4° @30 km behind it → **hidden** (not permissive); peak nearer than
all terrain → −90° nadir, nothing can occlude it; terrain at exactly the peak's range → does not
occlude.

<details><summary>Original bug description (kept for the record)</summary>

- **P1.5 over-occludes near peaks.** The rule compares a peak against the max terrain
      angle at its bearing across *all* distances. But terrain BEHIND a peak cannot hide it.
      A nearer, lower summit standing in front of a taller far ridge is genuinely visible,
      and the current rule calls it hidden.
      Correct rule: a peak is occluded only by terrain NEARER than the peak itself.
      Fix: retain the per-bearing skyline staircase (distance → running max altitude) so the
      test can ask "max altitude among samples closer than this peak".
      `HorizonPoint` already carries `distanceKm`, but only for the single winning sample.
      Group F asserts *no verdict* on this case so the simplification cannot be silently
      blessed; promote that assertion once fixed.

</details>

### X-3 — Fort William's Cow Hill, resolved honestly

The HIGH-confidence must-see "Cow Hill" came out HIDDEN and was **not** weakened or skipped.
Resolved without touching the visibility rule: the summit point is still hidden (clearance
−0.356°) and is now labelled **greyed** because the DEM shows the ground rising unbroken from
the blocking crest (248 m at 0.84 km) to the summit — deepest col 0.0 m — while the hill
dominates the skyline at +17.02°. The case file records the measured figures. The alternatives
the finding offered were not needed and were not taken.

<details><summary>Original finding (kept for the record)</summary>

- [ ] **fort-william: HIGH-confidence must-see "Cow Hill" comes out HIDDEN.** Not weakened,
      not skipped. Diagnosis: the quoted coordinate (56.813052, −5.094644, from a walking-route
      aggregator — the case file already calls it the least authoritative position in the set)
      reads **261 m** in SRTM against the quoted 287 m, and the DEM's local maximum is
      **293.6 m some 476 m SSE of it**. Along bearing 139.45° the ground crests at 840–900 m
      range and subtends **15.81°**, while the quoted summit point subtends 15.60° at 990 m —
      so the marked point sits just BEHIND the crest of its own hill. That is also true of the
      DEM's own local max from this viewpoint: standing at the foot of a smooth convex hill,
      the shoulder hides the summit. The case's claim ("the hill immediately behind the town")
      is about seeing the HILL — which dominates the computed skyline at +17.0° — not about
      its summit point clearing the foreground. Decide one of: replace the coordinate with the
      Ordnance Survey grid reference, or restate the expectation as "Cow Hill's mass forms the
      skyline at this bearing". Do NOT relax the visibility rule to fix it.

</details>

### X-1 — the correction to the briefing about voids

This mirror is **void-filled**. Zermatt (46.0207, 7.7491) reads **1608 m, not −32768**, and
N45E007 / N46E007 / N27E086 / N28E086 contain **0 voids in 51 868 804 samples**. The void code
path is real and tested, but on **synthetic** tiles — no honest real fixture from this source
can contain a void. The full correction, including how the wrong tile was sampled, is in
[MISSION.md](MISSION.md).
