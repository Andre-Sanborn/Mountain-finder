# Build Plan

Every product below lists its **self-check**: the exact command an agent runs to prove the product works, and what passing means. A product without a passing self-check is not done. Global gates are at the bottom.

## Phase status

Phases are listed below in the order they were executed, not in numerical order — 9 and 10
were pulled forward ahead of 7 and 8 because peak coverage, not code, was what limited the
product after v2.0 shipped.

| Phase | Status | Where it stands |
|---|---|---|
| 0 — Scaffold | ✅ **done** | `check` / `test:e2e` / `test:acceptance` / `demo` all wired and green |
| 1 — Geometry core | ✅ **done** | 178 tests; the analytic cone matches closed form to 1e-12 against a 0.01° spec |
| 2 — Data providers | ⚠️ **done but for P2.4** | P2.4's self-check is **unmet** — live egress 403s OpenTopoData and Overpass, so no live recording was ever made. Marked `[~]`, never ticked |
| 2b — SRTM tiles (D7) | ✅ **done** | Real 25 MB tiles verified; shared tile edge matches on all 3601 columns |
| 2c — Peak store + pipeline | ✅ **done** | `annotateScene` / `annotatePhoto`; refuses rather than guesses |
| 3 — Photo ingestion | ✅ **done** | Includes the portrait/`Orientation` fix, [W2-3](docs/FINDINGS.md) |
| 4 — Renderer | ✅ **done** | Flag lands within 0.01 px of the hand-derived position against a ±0.5 % gate |
| 4b — D8 obscured summits | ✅ **done** | Split by *what* hides the summit; crest fix [W2-1](docs/FINDINGS.md) |
| 5 — Web app | ✅ **done** | Real overlay in Chromium; Matterhorn within 12 px of hand-derived pixels |
| 6 — Ground truth | ✅ **done** | 153 acceptance assertions, 0 todo. Open case-file notes: [X-4](docs/FINDINGS.md) |
| 9 — Peak coverage | ✅ **done** | 9 237 Overture summits in 5 regions (read by the app since Q8); P9.4's open question answered — elevations exist |
| 10 — Deployment | ✅ **done** | `npm run test:deploy`, 5 assertions, every request same-origin |
| **7 — CV alignment (v2.1)** | 🔨 **in progress** | P7.1–P7.4 built and proved; **P7.4 wired into the app 2026-08-17** (auto-align proposal + Apply, refusals shown). Under the CV-10 policies the aligner recovers heading to **0.21°** — better than the phone's compass — and pitch to **0.82°** on the real frame with a solved pose. P7.5 remains: the sky/snow cue for wide frames ([CV-2, CV-8, CV-10](docs/FINDINGS.md)) |
| **8 — Live view (v3)** | 🔨 **engine started** | P8.2's engine and P8.3's loop exist (`src/live/`, 19 tests, 2026-08-17): gravity → pitch/roll, circular heading smoothing, declination discipline, five named refusals; one scene re-projected per sensor tick with sector-exit refusals, proven equal to the still pipeline over a pose sweep. **2026-08-18 — the shell exists** (`mobile/`, P8.1): an Expo Go app needing no Mac or Apple account, typechecked against the real SDK together with the 39 shared files it imports unchanged, and **built for real** through Metro and Hermes (`npm run check:mobile`, 750 modules) — which caught [X-8](docs/FINDINGS.md) at once: it typechecked, linted and passed 1 218 tests while being impossible to build. It carries the instrument that closes P8.2's bar rather than the AR view, deliberately: a four-hold check that confirms the frame conventions against hardware or names the exact signed axis map that is wrong. Peaks wait on that verdict and on how a phone carries DEM offline (D7) |

Open work is tracked in [TODO.md](TODO.md); every confirmed finding is indexed in
[docs/FINDINGS.md](docs/FINDINGS.md).

## Repository layout (target)

```
/src/core/        Pure pipeline: geodesy, sightline, horizon, projection, visibility.
                  No network, no DOM, no device APIs. 100% unit-testable.
/src/providers/   Elevation (OpenTopoData) + peaks (Overpass) clients behind interfaces,
                  with an injectable transport so tests replay recorded fixtures.
/src/exif/        Photo metadata extraction → camera pose + FOV, with manual-override model.
/src/render/      Pure overlay builder: (photo size, horizon, peaks, camera) → SVG string.
/src/app/         React web UI: drop photo, autofill, override panel, sliders, PNG export.
/fixtures/        Synthetic scenes, recorded API responses, ground-truth photos + expectations.
/scripts/         Fixture recorder (the only code allowed to hit live APIs).
/tests/           unit / integration / e2e (Playwright).
/archive/v1-expo/ The retired v1 React Native attempt (reference only).
```

## Phases and products

### Phase 0 — Scaffold ✅ *(agent group S)*

| Product | Description | Self-check |
|---|---|---|
| P0.1 Toolchain | Vite + React + TypeScript (strict) + vitest + ESLint + Playwright, single npm package | `npm run check` (typecheck + lint + unit tests) exits 0; `npm run build` exits 0 |
| P0.2 CI-shaped scripts | `check`, `test:e2e`, `test:acceptance`, `demo` npm scripts exist (later phases fill them) | `npm run` lists all four; each runs (even if trivially) without error |

### Phase 1 — Geometry core ✅ *(agent group A — parallel with B, C, F)*

| Product | Description | Self-check |
|---|---|---|
| P1.1 Geodesy | haversine, bearing, destination point, wrap-safe angle math | Unit tests vs published reference values (< 0.1% error); destination→haversine round-trip; antimeridian + pole edge cases |
| P1.2 Sightline | Elevation angle with Earth curvature + refraction (k=0.13); line-of-sight sweep near→far per ray | **Analytic cone test:** synthetic cone mountain → horizon angle matches closed-form atan within 0.01°; two-ridge occlusion test: far-but-lower ridge provably hidden |
| P1.3 Horizon profile | 360° profile build from samples; interpolation at arbitrary bearing with 0°/360° wrap | Interpolation exactness at sample points; midpoint linearity; wrap continuity at 359.5° |
| P1.4 Camera projection | (bearing, altitude angle) → normalized image x/y given heading, pitch, roll, hFOV/vFOV; FOV from focal length (35mm-equiv) | Identity tests: peak dead-ahead → x=0.5; peak at heading+hFOV/2 → x=1.0; focal 24mm/50mm → known FOV values |
| P1.5 Visibility filter | Peak visible iff its angle clears interpolated horizon at its bearing (tolerance param) | Synthetic scene with one exposed and one ridge-hidden peak → exactly the right one survives |
| P1.6 `marginal` state *(added 2026-08-17)* | A verdict that flips within the near field's own elevation uncertainty is `marginal` — labelled "may be hidden" — instead of decided; opt-in via `nearFieldRadiusM`, default 0 ([docs/NEAR-FIELD.md](docs/NEAR-FIELD.md), decision D10) | Phantom-wall scene with closed-form angles: clearances of +0.09°/−0.01° inside a ±0.95° band both come out `marginal`, +1.39° stays `visible`; radius 0 reproduces the pre-P1.6 verdicts bit-for-bit; ring-ridge scene (occluder at 5 km) is untouched with the radius ON |

### Phase 2 — Data providers ⚠️ *(agent group B — P2.4's self-check is unmet)*

**Revised per decision D7 (offline-first).** Local SRTM tiles are the primary elevation
source; the HTTP clients below demote from a runtime dependency to an acquisition path.

| Product | Description | Self-check |
|---|---|---|
| P2.1 Transport layer | `Transport` interface; `FetchTransport` (retry ×3, backoff, 429 handling, AbortSignal) + `FixtureTransport` (replays recorded JSON) | Fake-transport tests: fails twice → succeeds on 3rd; 429 → longer delay; abort → immediate typed error |
| P2.2 Elevation provider *(acquisition)* | OpenTopoData SRTM client, 100-point batching, typed errors | Offline test against recorded fixture: request grid → correct parsed elevations, correct batch count |
| P2.3 Peaks provider | Overpass client (nodes + way centroids, ele/ele:ft parsing), typed errors | Offline test against recorded fixture: known area → expected peak list with correct elevations |
| P2.4 Fixture recorder | `npm run record:fixtures -- --site <name>` captures live responses into `/fixtures/api/` | Recorded files validate against provider schemas. **Currently unmet** — egress 403. |
| **P2.5 HGT tile reader** | Parse `.hgt`/`.hgt.gz` (SRTM1 3601², SRTM3 1201², int16 BE, row 0 = north). Bilinear + nearest lookup. **Voids (`−32768`) are an explicit no-data state, never coerced to a number.** | Synthetic tiles with closed-form terrain → exact values; grid-edge cases (first/last sample, north/south edge, shared tile overlap); void policy tested directly |
| **P2.6 Tile store** | lat/lon → tile name with correct floor semantics across **both hemispheres** (`S01W001`, `N10W010`); directory load; in-memory cache | Hemisphere and negative-coordinate naming tested explicitly — this is where an off-by-one silently returns the wrong continent |
| **P2.7 Tile fetcher** | `npm run fetch:tiles` pulls from AWS Open Data (`elevation-tiles-prod/skadi/…`), gunzips, skips existing | Acquisition tool; may hit network. Tiles land in gitignored `data/tiles/` |
| **P2.8 Real-data fixture** | A small window of genuine Zermatt SRTM committed as raw bytes + provenance sidecar, reproducible via a generator script | Tests parse **real bytes in the real format**, not hand-authored JSON — strictly stronger than P2.2's fixtures |

### Phase 3 — Photo ingestion ✅ *(agent group C)*

| Product | Description | Self-check |
|---|---|---|
| P3.1 EXIF extraction | exifr-based: GPS lat/lng/alt, GPSImgDirection (+true/magnetic ref), focal length + 35mm-equiv → hFOV | Fixture JPEGs with authored EXIF → exact expected values |
| P3.2 Fallback model | Missing-field detection → `needs-manual` states; merged pose = EXIF ⊕ user overrides | EXIF-stripped fixture → all fields flagged; override merge precedence tested |

### Phase 4 — Renderer ✅ *(agent group D — needs A's types)*

| Product | Description | Self-check |
|---|---|---|
| P4.1 Overlay builder | Pure: scene → SVG string (horizon polyline, flag poles, name labels, leader lines, label collision avoidance) | SVG snapshot tests on synthetic scenes; geometric assertion: flag x/y within ±0.5% of hand-computed position |
| P4.2 PNG compositor | Photo + SVG overlay → exported PNG (canvas) | Playwright: render fixture scene, export, assert PNG dimensions + non-empty; screenshot saved as reviewable artifact |

### Phase 5 — Web app ✅ *(agent group E — needs A–D)*

| Product | Description | Self-check |
|---|---|---|
| P5.1 App shell | Drop-zone → EXIF autofill → override panel → overlay view; heading/pitch/FOV trim sliders; fixture-transport test mode | Playwright e2e: load fixture photo offline → expected labels render; slider changes move labels the mathematically expected number of pixels |
| P5.2 Export | Annotated PNG download | Playwright: click export → file received with expected dimensions |

### Phase 6 — Ground truth ✅ *(agent group F — starts in parallel with Phase 1)*

| Product | Description | Self-check |
|---|---|---|
| P6.1 Synthetic scenes | 3+ analytic terrains (cone, twin ridges, plateau) with closed-form expected horizons | Expectations computed independently from the pipeline code (separate derivation in the fixture file) |
| P6.2 Real photo set | 3–5 openly licensed mountain photos with documented shooting coordinates + expected visible peak names | Each case file lists source URL, license, coordinates, and must-see peaks — reviewed for correctness |
| P6.3 Acceptance suite | `npm run test:acceptance` — full pipeline per case | Every must-see peak labeled; no peak labeled that the horizon proves hidden; where pixel positions are annotated, error within tolerance |

### Phase 9 — Peak coverage ✅ *(Q5 — the binding constraint after v2.0)*

v2.0 ships working. It works at four viewpoints, because the peak database holds three
summits. Everything downstream of that database is finished and tested; the database is the
product's limit. Every peak source is blocked from this environment except AWS S3, where
Overture Maps is both listable and range-readable.

| Product | Description | Self-check |
|---|---|---|
| P9.1 Parquet range reader | Read a remote Parquet footer over HTTP Range; expose row groups with their `bbox` statistics. Verified feasible: 524 KB read from an 850 MB part = **0.062%** | Against a committed real parquet slice, offline: footer parses, row-group count and bbox stats match values stated independently in the fixture sidecar |
| P9.2 Spatial pruning | Keep only row groups whose bbox intersects the wanted area; never fetch a whole part | A bbox covering one row group fetches exactly that group; **bytes fetched vs part size is printed**, because that ratio is the whole design |
| P9.3 Peak extraction | Establish what marks a summit in Overture (subtype/class), where `names.primary` lives, and **whether elevations exist at all** | Extracted peaks match values readable in the committed fixture and stated as literals |
| P9.4 Elevation provenance | **Open question, must not be papered over.** If Overture carries no summit heights, that is a design problem, not a detail — SRTM under-reads sharp summits by 250–350 m and displaces them ~320 m (see MISSION.md), so sampling the DEM for peak heights is forbidden | Every imported peak's `elevationSource` is honest; a peak with no trustworthy height is reported, never given a DEM value |
| P9.5 Scalable peak store | Serve "peaks within radius of a point" without loading a region into memory per query; keep the `PeaksProvider` seam unchanged | Pipeline is untouched; the cited `ground-truth-peaks.json` summits still resolve and all 148 acceptance assertions still pass |
| P9.6 Conflict reporting | Where Overture disagrees with a cited ground-truth height or position | Disagreement is **reported, not silently resolved**; the cited value wins by default because it is the one with a source |

### Phase 10 — Deployment ✅ *(what turns a passing build into a published site)*

`npm run build` alone is not deployable: it ships no terrain (which square degrees a
deployment carries is not the bundler's decision) and, until this phase, it displayed no
attribution for data that legally requires it. A deployment is one static directory served
by anything — no server code, no API key, no third-party runtime call (decision D7).
Everything here is documented in [docs/DEPLOY.md](docs/DEPLOY.md).

| Product | Description | Self-check |
|---|---|---|
| P10.1 Static packaging | `npm run package:deploy` stages `dist/terrain/` (manifest + grids, `--gzip` siblings) and `dist/peaks/<region>/` from whatever is on disk, using the same index builder the dev server uses; refuses a grid whose byte length disagrees with its geometry | `npm run test:deploy` |
| P10.2 Deployment proof | A plain static server over `dist/` in real Chromium: manifest byte-identical to the packaged file, no `/@vite/client`, the Gornergrat photo drawing the Matterhorn within 12 px of the closed-form projection, a 25.93 MB tile arriving gzipped, **every request same-origin**, a missing tile named rather than silently blank | `npm run test:deploy` |
| P10.3 Visible attribution | The app displays the credit its data's licences require — ODbL-1.0 / © OpenStreetMap contributors for the Overture summits, NASA/USGS SRTM as courtesy — derived from the datasets' own `sources[]` records, not typed in, so a region under another licence changes the footer by itself | `npm run test:deploy`; also `npx vitest run src/app/attribution.test.ts` and `npx playwright test tests/e2e/attribution.spec.ts` for legibility (on screen unscrolled, ≥ 4.5:1 in both colour schemes) |

**A generated `ATTRIBUTION.txt` does not satisfy P10.3.** The obligation is on the running
app; a file nobody links to is not attribution. That distinction is why the self-check is a
browser assertion on a visible element and not a `grep` of the deployment directory.

### Phase 7 — CV silhouette alignment 🔨 *(v2.1 — in progress)*

Skyline extraction from the photo, 1-D cross-correlation against the computed profile solving
heading/pitch offset, auto-trim replacing manual sliders. **P7.1–P7.3 are built and their
self-checks pass. P7.4 is not done, and P7.5 is the work the real photographs exposed.**

| Product | Description | Self-check |
|---|---|---|
| P7.1 Skyline extraction | `src/cv/skyline.ts`. Per-column ordered step fit (Otsu with the classes forced contiguous) on a sky-affinity signal; four independent confidence factors per column; a column below the floor reports **no row at all** | `npx vitest run src/cv` — a wrong skyline confidently reported must be impossible: a low-confidence column yields no row |
| P7.2 Alignment | `src/cv/align.ts`. Stage 1 a weighted 1-D NCC over heading (heading is an *exact* rigid translation in bearing, proved in `src/cv/rays.ts`), stage 2 pitch on the geometric residual, stage 3 joint refinement on the exact rotation | **PLAN's original check, met:** an injected offset spanning ±20° is recovered within 0.5° — worst **heading 0.022°, pitch 0.091°** through the full render→extract→align round trip, and **0.013° / 0.075°** over the real SRTM Gornergrat horizon. Also `npx playwright test tests/e2e/cv.spec.ts` (artifact `out/cv-skyline.png`) |
| P7.3 Honest reporting | The failure variant of `SkylineAlignment` carries **no offsets at all**, so a caller cannot read a confident zero out of a refusal. Six gates: coverage, relief, score, margin, residual, search-edge | `npx vitest run src/cv/align.test.ts` — flat horizon, total fog, 80 % of columns lost, periodic ridgeline, offset outside the search window, offset exactly at its rim, snow-capped skyline: **all refuse, none returns an offset** |
| **P7.4 Integration** *(done 2026-08-17)* | `suggestPoseTrim` in `src/pipeline/cv-alignment.ts`: near-field-free profile REQUIRED (checked from the profile's own distances), heading search clamped to a compass budget (default ±6° — a wider search was measured returning a confident impostor 10.4° off, CV-10), result is a suggestion for the **visible** P5.1 sliders, never a hidden correction. Wired into the app the same day: `AnnotatedScene.alignmentHorizon` → `OverlayResult.alignment` → `AutoTrimPanel`, whose Apply writes the same trim state the sliders write | `npx vitest run src/pipeline/cv-alignment.test.ts src/app/auto-trim.test.ts` (18, incl. the impostor-policy refusal); `npx playwright test tests/e2e/app.spec.ts` (the grey fixture is declined out loud, no Apply rendered); on the real frame: heading err −0.208° (beats the compass's 0.596°), pitch err +0.817° (beats assumed zero's 3.52°) — label error strictly improves |
| **P7.5 Extraction on real photographs** *(open — narrowed to pitch bias)* | `fitStep` chooses per column independently, with no notion that the boundary should be continuous with its neighbours, so it stitches a near foreground ridge to the distant skyline ([CV-4](docs/FINDINGS.md)). Needs a continuity or segmentation constraint across columns, plus a cue that works on snow-dominant scenes ([CV-2](docs/FINDINGS.md)) | **The measurement that failed is the check:** the extracted skyline's altitude span must not exceed the greatest relief the frame could contain from that viewpoint — 17.56° against a ceiling of 8.63° today. Span is invariant to pitch and focal length, so it holds without knowing either. Then: the Railroad Ridge photograph aligns instead of refusing in all 12 windows ([CV-3](docs/FINDINGS.md)). **Span met: 8.44° against an 8.80° ceiling.** The remaining check is now specific — recovered pitch must reach the photogrammetrically solved −3.520°, against −1.552° today ([CV-6](docs/FINDINGS.md)) |

### Phase 8 — Live view ⛔ *(v3 — not started, no code exists)*

Expo app reusing `/src/core` unchanged; camera feed + sensor fusion; the archived v1 serves as
UI reference. Deferred by decision D5 until v2.1. Self-testing is limited to core reuse and
unit level **by design** — everything risky was proven in v2, on still photos, where the output
is a file an agent can assert against.

| Product | Description | Self-check |
|---|---|---|
| P8.1 Core reuse | `/src/core` imported by the Expo app **unchanged** — no fork, no shim. **Built 2026-08-18** — `mobile/`, an Expo SDK 57 app that runs in **Expo Go**, so it needs no Mac, no Xcode and no Apple Developer account. Two screens: `Calibrate` (the four-hold frame-convention check) and `Horizon` (camera preview with the horizon drawn by the real `projectToImage`). `mobile/src/useDeviceSensors.ts` is the entire impure surface; everything else is the pure modules. Metro reaches the repository root through `watchFolders`, and its resolver retries TypeScript-ESM `./x.js` imports extension-stripped rather than rewriting `/src` to suit one consumer | **Partially met**: `npm run check:mobile` is green — it typechecks the app against the real Expo 57 / RN 0.86 / React 19 types **together with the 39 shared files it imports** across the root (`src/core`, `src/live`, `src/pipeline`, `src/render`, unchanged, no copy to diff against), lints it, and **builds it for real** through Metro and Hermes: 750 modules, exported clean. The build step earned its place immediately — the first version typechecked, linted and passed 1 218 tests while being impossible to build ([X-8](docs/FINDINGS.md)). **Not met**: nobody has *run* it. A build proves it starts, not that the overlay lands right, so it ships `[~]`, not ticked |
| P8.2 Sensor fusion | Camera pose from compass + accelerometer + GPS, feeding the same `CameraPose` the still pipeline takes. **Engine built 2026-08-17** — `src/live/sensors.ts`, pure: gravity → pitch/roll (closed form, conventions stated and tested at the axis holds), circular heading smoothing with exponential age weights, measured spreads, and the full refusal set (`no-samples`/`stale`/`needs-declination`/`not-gravity`/`gimbal-degenerate`). Magnetic is never silently true, same as EXIF | Unit tests over recorded sensor traces (replayed, not live) → expected pose. **Partially met**: 16 tests over hand-derived geometry pass (`npx vitest run src/live`); the bar stays open until a REAL device records a trace, because a frame-convention sign error would pass every synthetic test and flip on hardware — said in the module header |
| P8.3 Live overlay loop | Continuous projection of an already-computed horizon profile as the pose changes. **Built 2026-08-17** — `src/live/loop.ts`, pure: verdicts are pose-free, so one `AnnotatedScene` re-projects per sensor tick; a pose whose DRAWN span (1.5× hFOV) leaves the swept sector is refused with `resweep-needed` and the measured overshoot, because labels over never-swept terrain would be invented (the live-view face of R-1) | **Met at the unit level**: 9 poses through the loop produce marker-for-marker, pixel-for-pixel (1e-9) the layouts the still pipeline produces re-run at each pose; sector refusals measured exactly (15° overshoot at the case boundary, 90° opposite); full circles never refuse. `npx vitest run src/live` |

## Agent orchestration

Groups are sized so one agent holds one coherent context; waves maximize parallelism:

```
Wave 1 (after P0):   A (geometry)   B (providers)   C (exif)   F (fixtures)   ← run in parallel
Wave 2:              D (renderer — consumes A's types)
Wave 3:              E (web app — consumes A+B+C+D)
Gate after each wave: npm run check green + adversarial review agent on the wave's diff
Final gate:          npm run test:e2e && npm run test:acceptance green
```

Rules for every agent task hand-off:
- The task prompt names the products and pastes their self-checks verbatim.
- The agent must run the self-check and report the actual command output — "should pass" is a failed hand-off.
- A separate reviewer agent verifies each wave before the next begins.

## Global gates

| Command | Meaning |
|---|---|
| `npm run check` | Typecheck + lint + all unit/integration tests (offline, deterministic) |
| `npm run test:e2e` | Playwright against the built app with fixture transport |
| `npm run test:acceptance` | Ground-truth photo cases end-to-end |
| `npm run demo -- <case>` | Writes `out/annotated.png` for a case — the human-viewable proof |
| `npm run test:deploy` | The packaged `dist/` behind a plain static server: real overlay, same-origin only, visible ODbL notice (run after `npm run build && npm run package:deploy -- --gzip`) |
