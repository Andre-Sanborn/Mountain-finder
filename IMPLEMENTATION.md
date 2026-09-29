# Implementation

Decisions and why they were taken, the design they produced, every product's self-check, the
measurements, the rejected alternatives and the known limits. The goal is in
[MISSION.md](MISSION.md); the current operational state is in [HANDOFF.md](HANDOFF.md); every
confirmed finding is indexed in [docs/FINDINGS.md](docs/FINDINGS.md).

## The pipeline

```
photo (JPEG or HEIC)
  │
  ├─ EXIF ──► lat/lon, altitude, GPSImgDirection (+ True/Magnetic ref), focal → FOV
  │            missing or wrong values are an explicit "needs manual" state,
  │            never a silent default; magnetic is never treated as true
  │
  ├─ local SRTM .hgt tiles ──► ray sweep per bearing ──► skyline staircase
  │            (offline; no network at runtime)         (angle as a function of distance)
  │
  ├─ local peak database ──► named summits with tagged elevations
  │
  └─ visibility: a peak is occluded only by terrain NEARER than itself
        └─► camera projection ──► SVG overlay: horizon line + flags + names
```

## Repository layout

```
src/core/       Pure geometry: geodesy, sightline, horizon, projection, visibility.
                No network, no DOM, no device APIs, no Date.now. Deterministic throughout.
src/providers/  Elevation from local .hgt tiles; HTTP clients demoted to acquisition.
src/exif/       Photo metadata → camera pose, with an explicit manual-override model.
src/cv/         Skyline extraction and alignment (v2.1).
src/render/     Pure overlay builder: scene in, SVG string out.
src/pipeline/   Orchestration, fully injectable so tests run offline.
src/live/       Pose from sensors, the per-tick projection loop, calibration and drag policy.
src/app/        React web UI: drop photo, autofill, override panel, sliders, PNG export.
mobile/         Expo shell importing the pure modules unchanged.
fixtures/       Analytic scenes with closed-form answers, real SRTM windows, cited cases.
scripts/        Acquisition and demo tooling; the only code allowed to reach the network.
tests/          Unit, integration, e2e (Playwright) and acceptance.
archive/        History, read-only: the v2 governance documents and the retired v1 attempt.
```

## How the browser gets terrain

The app reads elevation from static grids on its own origin: an index at
`/terrain/manifest.json` plus the raw sample files it names (`src/providers/terrain-manifest.ts`,
`src/providers/http-terrain-store.ts`). No live elevation API is called at runtime;
`npm run fetch:tiles` is the only thing that talks to the outside world. In dev and preview
`scripts/terrain-server.ts` publishes that directory from what the repository already holds. A
production build ships no terrain, because which square degrees a deployment carries is a
deployment decision, and `npm run package:deploy` assembles the one it wants.

Two rules here are load-bearing rather than incidental.

- **Synthetic test tiles are never served.** Invented mountains at real coordinates is the
  failure this project exists to avoid.
- **Missing terrain is a named absence**, not a blank overlay. The app says which tile is
  missing, what it holds instead, and how to fix it, and draws nothing. An empty overlay would
  read as "no peaks are visible from here", which is a different claim and a fabricated one.

One code path serves whole tiles and committed windows alike, and the largest grid covering a
point wins, because a window can produce a false `visible` and only the tile can prove an
occlusion.

## Decision record

The decision record D1–D10 lives in [MISSION.md](MISSION.md#decision-record), which is
canonical. Decisions taken from 2026-09-29 onward are recorded in this file.

## Self-checks, by phase

Carried forward from the archived [PLAN.md](archive/v2-docs-20260929/PLAN.md). A product
without a passing self-check is not done.

### Phase 0 — Scaffold

| Product | Self-check |
|---|---|
| P0.1 Toolchain — Vite + React + TypeScript (strict) + vitest + ESLint + Playwright, one npm package | `npm run check` exits 0; `npm run build` exits 0 |
| P0.2 CI-shaped scripts — `check`, `test:e2e`, `test:acceptance`, `demo` | `npm run` lists all four; each runs without error |

### Phase 1 — Geometry core

| Product | Self-check |
|---|---|
| P1.1 Geodesy — haversine, bearing, destination point, wrap-safe angle maths | Unit tests against published reference values (< 0.1 % error); destination→haversine round trip; antimeridian and pole edge cases |
| P1.2 Sightline — elevation angle with Earth curvature and refraction (k = 0.13), near→far sweep per ray | Analytic cone test: the synthetic cone's horizon angle matches the closed-form atan within 0.01°; a far-but-lower ridge is provably hidden |
| P1.3 Horizon profile — 360° build from samples, interpolation at arbitrary bearing with 0°/360° wrap | Exactness at sample points; midpoint linearity; wrap continuity at 359.5° |
| P1.4 Camera projection — (bearing, altitude) → normalised image x/y given heading, pitch, roll, hFOV/vFOV; FOV from 35 mm-equivalent focal length | Identity tests: peak dead ahead → x = 0.5; peak at heading + hFOV/2 → x = 1.0; 24 mm and 50 mm give known FOVs |
| P1.5 Visibility filter — a peak is visible iff its angle clears the interpolated horizon at its bearing | A synthetic scene with one exposed and one ridge-hidden peak leaves exactly the right one |
| P1.6 `marginal` state (added 2026-08-17, decision D10) | Phantom-wall scene with closed-form angles: clearances of +0.09° and −0.01° inside a ±0.95° band both come out `marginal`, +1.39° stays `visible`; radius 0 reproduces the pre-P1.6 verdicts bit for bit; the ring-ridge scene (occluder at 5 km) is untouched with the radius on |

### Phase 2 — Data providers

Revised per D7: local SRTM tiles are the primary elevation source and the HTTP clients demote
to an acquisition path.

| Product | Self-check |
|---|---|
| P2.1 Transport layer — `Transport`, `FetchTransport` (retry ×3, backoff, 429, AbortSignal), `FixtureTransport` | Fake-transport tests: fails twice then succeeds on the third; 429 gives a longer delay; abort gives an immediate typed error |
| P2.2 Elevation provider (acquisition) — OpenTopoData SRTM client, 100-point batching, typed errors | Offline test against a recorded fixture: correct parsed elevations and batch count |
| P2.3 Peaks provider — Overpass client (nodes and way centroids, `ele`/`ele:ft`), typed errors | Offline test against a recorded fixture: expected peak list with correct elevations |
| P2.4 Fixture recorder — `npm run record:fixtures -- --site <name>` | Recorded files validate against the provider schemas. **Unmet — egress 403.** |
| P2.5 HGT tile reader — `.hgt`/`.hgt.gz` (SRTM1 3601², SRTM3 1201², int16 BE, row 0 = north), bilinear and nearest; voids (`−32768`) are an explicit no-data state | Synthetic tiles with closed-form terrain give exact values; grid-edge cases (first/last sample, north/south edge, shared tile overlap); void policy tested directly |
| P2.6 Tile store — lat/lon → tile name with correct floor semantics in both hemispheres, directory load, in-memory cache | Hemisphere and negative-coordinate naming tested explicitly |
| P2.7 Tile fetcher — `npm run fetch:tiles` from AWS Open Data (`elevation-tiles-prod/skadi/…`) | Acquisition tool; may hit the network. Tiles land in gitignored `data/tiles/` |
| P2.8 Real-data fixture — a window of genuine Zermatt SRTM committed as raw bytes plus a provenance sidecar | Tests parse real bytes in the real format, which is strictly stronger than P2.2's fixtures |

### Phase 3 — Photo ingestion

| Product | Self-check |
|---|---|
| P3.1 EXIF extraction — exifr-based: GPS lat/lng/alt, `GPSImgDirection` (+ true/magnetic ref), focal length and 35 mm equivalent → hFOV | Fixture JPEGs with authored EXIF give exact expected values |
| P3.2 Fallback model — missing-field detection → `needs-manual`; merged pose = EXIF ⊕ user overrides | An EXIF-stripped fixture flags every field; override merge precedence tested |

### Phase 4 — Renderer

| Product | Self-check |
|---|---|
| P4.1 Overlay builder — pure scene → SVG string (horizon polyline, flag poles, labels, leader lines, collision avoidance) | SVG snapshot tests on synthetic scenes; the flag's x/y within ±0.5 % of the hand-computed position |
| P4.2 PNG compositor — photo + SVG overlay → exported PNG (canvas) | Playwright: render a fixture scene, export, assert the PNG's dimensions and that it is non-empty; the screenshot is saved as a reviewable artifact |

### Phase 5 — Web app

| Product | Self-check |
|---|---|
| P5.1 App shell — drop zone → EXIF autofill → override panel → overlay; heading/pitch/FOV trim sliders; fixture-transport test mode | Playwright e2e: a fixture photo offline renders the expected labels; a slider change moves labels the mathematically expected number of pixels |
| P5.2 Export — annotated PNG download | Playwright: click export, receive a file with the expected dimensions |

### Phase 6 — Ground truth

| Product | Self-check |
|---|---|
| P6.1 Synthetic scenes — three or more analytic terrains (cone, twin ridges, plateau) with closed-form horizons | Expectations derived independently of the pipeline code, in the fixture file |
| P6.2 Real photo set — three to five openly licensed photos with documented coordinates and expected visible peaks | Each case file lists source URL, licence, coordinates and must-see peaks, reviewed for correctness |
| P6.3 Acceptance suite — `npm run test:acceptance`, full pipeline per case | Every must-see peak labelled; no peak labelled that the horizon proves hidden; annotated pixel positions within tolerance |

### Phase 9 — Peak coverage

| Product | Self-check |
|---|---|
| P9.1 Parquet range reader — read a remote Parquet footer over HTTP Range, expose row groups with `bbox` statistics | Against a committed real parquet slice, offline: the footer parses and the row-group count and bbox stats match values stated independently in the sidecar |
| P9.2 Spatial pruning — keep only row groups whose bbox intersects the wanted area | A bbox covering one row group fetches exactly that group, and the bytes fetched against the part size are printed |
| P9.3 Peak extraction — what marks a summit in Overture, where `names.primary` lives, whether elevations exist | Extracted peaks match values readable in the committed fixture and stated as literals |
| P9.4 Elevation provenance — an open question that must not be papered over | Every imported peak's `elevationSource` is honest; a peak with no trustworthy height is reported, never given a DEM value |
| P9.5 Scalable peak store — "peaks within radius of a point" without loading a region per query, `PeaksProvider` seam unchanged | The pipeline is untouched, the cited `ground-truth-peaks.json` summits still resolve, and the acceptance assertions still pass |
| P9.6 Conflict reporting — where Overture disagrees with a cited height or position | The disagreement is reported, not silently resolved; the cited value wins by default because it has a source |

### Phase 10 — Deployment

A deployment is one static directory served by anything: no server code, no API key, no
third-party runtime call (D7). `npm run build` alone is not deployable, because it ships no
terrain and, before this phase, displayed no attribution for data that legally requires it.
Details are in [docs/DEPLOY.md](docs/DEPLOY.md).

| Product | Self-check |
|---|---|
| P10.1 Static packaging — `npm run package:deploy` stages `dist/terrain/` and `dist/peaks/<region>/` through the same index builder the dev server uses, and refuses a grid whose byte length disagrees with its geometry | `npm run test:deploy` |
| P10.2 Deployment proof — the built `dist/` behind a plain static server in real Chromium | `npm run test:deploy`: manifest byte-identical to the packaged file, no `/@vite/client`, the Gornergrat photo drawing the Matterhorn within 12 px of the closed-form projection, a 25.93 MB tile arriving gzipped, every request same-origin, a missing tile named rather than silently blank |
| P10.3 Visible attribution — the running app displays the credit its data's licences require (ODbL-1.0 / © OpenStreetMap contributors for the Overture summits, NASA/USGS SRTM as courtesy), derived from the datasets' own `sources[]` records | `npm run test:deploy`, plus `npx vitest run src/app/attribution.test.ts` and `npx playwright test tests/e2e/attribution.spec.ts` for legibility (on screen unscrolled, ≥ 4.5:1 in both colour schemes) |

**A generated `ATTRIBUTION.txt` does not satisfy P10.3.** The obligation is on the running app,
and a file nobody links to is not attribution. That is why the self-check is a browser
assertion on a visible element rather than a `grep` of the deployment directory.

### Phase 7 — CV silhouette alignment (v2.1)

| Product | Self-check |
|---|---|
| P7.1 Skyline extraction (`src/cv/skyline.ts`) — per-column ordered step fit (Otsu with the classes forced contiguous) on a sky-affinity signal, four independent confidence factors per column | `npx vitest run src/cv` — a confidently wrong skyline must be impossible: a low-confidence column yields no row at all |
| P7.2 Alignment (`src/cv/align.ts`) — weighted 1-D NCC over heading, then pitch on the geometric residual, then joint refinement on the exact rotation | An injected offset spanning ±20° is recovered within 0.5°: worst heading 0.022°, pitch 0.091° through the full render→extract→align round trip, and 0.013° / 0.075° over the real SRTM Gornergrat horizon. Also `npx playwright test tests/e2e/cv.spec.ts` (artifact `out/cv-skyline.png`) |
| P7.3 Honest reporting — the failure variant of `SkylineAlignment` carries no offsets at all; six gates: coverage, relief, score, margin, residual, search edge | `npx vitest run src/cv/align.test.ts` — flat horizon, total fog, 80 % of columns lost, periodic ridgeline, an offset outside the search window, an offset exactly at its rim, a snow-capped skyline: all refuse, none returns an offset |
| P7.4 Integration (`suggestPoseTrim` in `src/pipeline/cv-alignment.ts`) — near-field-free profile required and checked from the profile's own distances, heading search clamped to a compass budget (default ±6°), the result a suggestion for the visible sliders | `npx vitest run src/pipeline/cv-alignment.test.ts src/app/auto-trim.test.ts` (18 tests, including the impostor-policy refusal); `npx playwright test tests/e2e/app.spec.ts` (the grey fixture is declined out loud, no Apply rendered) |
| P7.5 Extraction on real photographs (open) | The extracted skyline's altitude span must not exceed the greatest relief the frame could contain from that viewpoint, and the Railroad Ridge photograph must align rather than refuse in all 12 windows. Span is met: 8.44° against an 8.80° ceiling. The remaining check is that recovered pitch reaches the photogrammetrically solved −3.520° |

### Phase 8 — Live view (v3)

Self-testing here is limited to core reuse and the unit level by design: everything risky was
proven in v2, on still photos, where the output is a file an agent can assert against.

| Product | Self-check |
|---|---|
| P8.1 Core reuse — `src/core` imported by the Expo app unchanged, no fork and no shim | `npm run check:mobile`: typecheck against the real Expo 57 / RN 0.86 / React 19 types together with the 39 shared files the app imports across the repository root, lint, and a real Metro + Hermes build. **Not met:** nobody has run the app. A build proves it starts, not that the overlay lands right, so it ships `[~]` |
| P8.2 Sensor fusion (`src/live/sensors.ts`) — pose from compass, accelerometer and GPS feeding the same `CameraPose` the still pipeline takes | Unit tests over recorded sensor traces, replayed and never live (`npx vitest run src/live`). **Partially met:** the hand-derived tests pass; the bar stays open until a real device records a trace, because a frame-convention sign error would pass every synthetic test and flip on hardware |
| P8.3 Live overlay loop (`src/live/loop.ts`) — continuous projection of an already-computed horizon profile as the pose changes | Met at the unit level: nine poses through the loop produce marker-for-marker, pixel-for-pixel (1e-9) the layouts the still pipeline produces re-run at each pose; sector refusals measured exactly (15° overshoot at the case boundary, 90° opposite); full circles never refuse |

### Global gates

| Command | Meaning |
|---|---|
| `npm run check` | Typecheck + lint + all unit and integration tests, offline and deterministic |
| `npm run test:e2e` | Playwright against the built app with the fixture transport |
| `npm run test:acceptance` | Ground-truth photo cases end to end |
| `npm run test:deploy` | The packaged `dist/` behind a plain static server (run after `npm run build && npm run package:deploy -- --gzip`) |
| `npm run check:mobile` | Mobile typecheck + lint + a real Metro/Hermes build |
| `npm run demo -- <case>` | Writes `out/annotated.png` for a case — the human-viewable proof |

## What the real SRTM data measured (verified 2026-08-16)

| Location | Tile | SRTM reads | Known | Δ |
|---|---|---|---|---|
| Grand Combin (broad summit) | `N45E007` | 4287 m | 4314 m | −27 m |
| Matterhorn (sharp pyramid) | `N45E007` | 4230 m | 4478 m | −248 m |
| Dent d'Hérens | `N45E007` | 3835 m | 4171 m | −336 m |
| Zermatt village | `N46E007` | 1608 m | 1608 m | 0 m |

1. **This source is void-filled.** The AWS `elevation-tiles-prod/skadi` mirror contains no
   voids: 0 in 25 934 402 samples across `N45E007` and `N46E007`, and 0 in 51 868 804 across
   four tiles including the Everest region. Void handling is still implemented and tested,
   because other SRTM distributions (USGS SRTMGL1 v2) do carry voids and a `−32768` silently
   treated as an elevation would corrupt the skyline. That code is defensive and exercised only
   by synthetic fixtures, not a response to observed data.
2. **SRTM underestimates sharp summits** by 250–350 m, because a 30 m grid cannot resolve a
   pyramid, **and it displaces them**: the Matterhorn's highest posting sits ~320 m WSW of the
   surveyed summit, which itself reads only 3567 m. So SRTM gives the terrain horizon and the
   peak database gives summit heights. Sampling peak heights from the DEM would place every
   alpine label hundreds of metres too low and sideways.
3. **Broad terrain and valley floors are trustworthy** (−27 m at Grand Combin, exact at
   Zermatt), so the horizon profile itself is sound.

Other measurements worth keeping:

- The analytic cone matches the closed form to 1e-12 against a 0.01° specification. Two
  independent sightline formulations (exact spherical and the surveying curvature-drop form)
  agree to better than 0.002° across all four scenes, five times inside the 0.01° tolerance, so
  no expectation is an artefact of one modelling choice.
- The renderer's flag lands at the hand-derived 1600·(√3−1) = 1171.281 px / 524.820 px to
  better than 0.01 px, against a ±0.5 % gate.
- `N45E007` row 0 equals `N46E007` row 3600 on all 3601 shared-edge samples.
- Bilinear interpolation was checked against a second reader written from the SRTM
  specification rather than from this code, over the real 25 MB `N45E007`: 400 000 random
  interior points, worst |Δ| = 5.3e-11 m, edges and corners exact. A row-flipped variant of
  that reference diverges by thousands of metres, which is what proves the reference is
  genuinely independent.
- Overture import: 1 786 named summits for Zermatt (61 above 4 000 m) for 42.17 MB of a
  29.47 GB release — 0.1431 %, or 10.77 MB with the footer cache warm. Nine regions' worth of
  work settled at 9 237 summits across five regions. Overture does carry summit heights: the
  `elevation` INT32 column is OSM's `ele` carried through unchanged, so records declare
  `elevationSourceKind: 'osm'` and nothing is sampled from the DEM. A summit with no `ele` is
  dropped and counted (285 in the Zermatt area).
- Conflicts are reported, not resolved: 13 of 15 cited heights agree exactly or within 2 m,
  Mount Hamilton is −21 m, **Mount Tamalpais East Peak's two coordinates are 1 754 m apart** and
  must be re-checked before that summit backs any assertion, and `Breithorn` is ambiguous — OSM
  calls the cited 4 164 m summit `Breithorn Occidentale / Westgipfel` and the Valais holds three
  others.
- Half Dome from Mount Diablo clears its ridge by 0.0043°, about 8 m at 200 km, so it is marked
  *disputed* and asserted in neither direction.
- Deployment cost, re-measured after the region peak store: 16 tiles plus windows =
  417.57 MB / 189.24 MB on the wire, `/peaks/` 3.48 MB over 63 cells and 5 indexes, bundle
  340.21 kB / 110.63 kB gzipped. A session budgets one terrain grid (16.35 MB gzipped, alpine
  worst case) plus at most the largest region's cells (1.26 MB).
- Peak density: 11 same-name pairs within 300 m across all 9 237 summits, and 275 of Zermatt's
  1 786 summits have a differently-named neighbour within 300 m. So the "clusters" are real,
  distinct summits and a merge pass would delete real names to fix a layout problem the
  renderer already solves.

## Retractions, and the lesson they share

**The lesson: a plausible number from a broken read is more dangerous than a crash.** Every
retraction below is a confident conclusion drawn from a read that never happened, and each one
passed whatever structural checks surrounded it.

- **X-1 is void.** An earlier revision of the SRTM section claimed voids are common in this
  source, citing a Zermatt sample reading `−32768`. That was wrong. Zermatt sits at 46.0207°N,
  north of tile `N45E007` (which covers 45–46°N). The sample was taken from the wrong tile; the
  negative row index read out of bounds and the scan returned the sentinel. Read from
  `N46E007`, Zermatt reports 1608 m, its true elevation, and the tiles hold 0 voids in
  25 934 402 samples.
- **CV-1 is void.** "The extractor scores 0 of 512 columns" was a probe bug, not an extractor
  defect. The probe filtered on `column.confidence` and `column.row`; the fields are
  `confidence01` and `rowNorm`, and `undefined > 0` is `false`, so every column was discarded
  and the extractor was blamed. The retraction stays at the head of
  [docs/CV-REAL-PHOTO-FINDING.md](docs/CV-REAL-PHOTO-FINDING.md) rather than being edited away.
- Two more results in the same family are recorded as findings rather than retractions: X-7
  (three of seven HEICs reported as carrying no metadata carried all of it, because `exifr`
  refuses any file whose `ftyp` box exceeds 50 bytes) and X-8 (the mobile app typechecked,
  linted, passed 1 218 tests and could not be built).

Two other beliefs were overturned by running things, and are worth the same weight. The plan's
own occlusion rule was wrong: it compared a peak against the skyline at all distances, but
terrain behind a peak cannot hide it (X-2). And the extracted skyline spanned 17.56° where no
real skyline from that viewpoint can exceed 8.63° — decisive because span is invariant to the
two unknowns, since an unmodelled pitch shifts the range without changing its span and a wrong
focal length scales it near-uniformly (CV-4).

## Blocked on network egress, not on code

Neither of these is a code problem, and neither should be re-attempted without a new route out.

- **P2.4** — recording `fixtures/api/**` from live OpenTopoData and Overpass. Both 403 at the
  egress proxy. The recorder and its offline `--verify` work; the fixtures are hand-authored
  against documented schemas and labelled as such. The elevation fixtures are superseded anyway,
  since real SRTM bytes from AWS are better evidence than recorded JSON, but the Overpass
  recording genuinely never happened. Marked `[~]`, never ticked.
- **P6.2** — re-verifying the ground-truth case coordinates against live reference pages.
  Wikipedia, parks.ca.gov and seattle.gov all 403. The four case files' coordinates carry
  resolvable source ids and an `access` field, and must be re-verified against live pages before
  they gate a release.

Every other peak source is blocked from here too: `download.geonames.org`, geofabrik,
naturalearthdata, `planet.openstreetmap.org` and taginfo all fail at the proxy. `s3.amazonaws.com`
is reachable, which is why the Overture parquet range read is the shape the peak importer took.

## Closed, and not to be re-asked

**X-6: the Sunset Mountain original does not exist.** The photographer tried repeatedly to
supply the camera original for IMG_0592; the transcoded copy is all that survives, and the file
was never geotagged on that phone either (the companion-photo evidence is in
[docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md)). This is a fact about the file, not a
pending request. **Do not re-ask the human.** Every other supplied photograph does have its
original, and asking for them was the whole fix for the rest of X-6: Railroad Ridge has a
measured heading (174.089° T), a GPS fix, an altitude and a lens, all re-read from committed
HEIC bytes by the suite, and four Idaho frames are annotated end to end.

## Open residuals and unverified suspicions

Residuals the reviews left open by decision:

- **R-2** (from W1-6) — `src/cv/rays.ts:profileCoverage` grew its own coverage notion, a
  largest-gap-against-median heuristic over the profile alone, which cannot see a hole and a
  sector edge at the same time. The two notions should be reconciled onto the exact one.
- **R-3** (from W1-7) — `'nearest-valid'` is discontinuous at a grid line: 250 m on the line,
  200 m a hair off it, because it returns a corner rather than re-normalising the valid weights.
  That is the documented policy and is flagged to the caller. Changing it would mean inventing a
  value for the void, so it is a policy decision rather than a bug fix.
- R-1 and R-4 were fixed on 2026-08-17.

**X-4** — the Kerry Park Mount Baker gate is not insensitive to observer height, contrary to
that case file's original header. SRTM reads Kerry Park at 103.8 m, so Baker is correctly hidden
by −1.67°; at the cited 113 ± 15 m it is visible by +0.31° and the gate fails. The verdict flips
inside the case's own stated uncertainty band. The note was written into the case file's own
rationale on 2026-08-17, with the published-claim evidence identified as what actually carries
the verdict and the DEM reading — a smooth urban hillside, the terrain SRTM is best at — as the
defensible height to judge from; 178 acceptance assertions were unchanged. FINDINGS.md still
lists the row as open, so the two records disagree and one of them is stale.

Unverified Wave-2 suspicions. These are hypotheses, not findings, and must not be cited as
results:

- `groundElevationM` is not finiteness-checked; a NaN would give a silently empty overlay rather
  than a crash. No caller has been found that can produce one. Latent, not live.
- `buildNotes` counts foreground-occluded peaks over all peaks, including those behind the
  camera. Wrong prose, not a wrong label.
- Export can race the pose: clicking Export while a rebuild is in flight writes a PNG whose
  labels belong to the previous pose. Millisecond-wide, and not demonstrated.

One Wave-3 suspicion is also open: `missingTilesFor` asks for SRTM names that an
`HttpTerrainStore` serving windows can never satisfy. Wave 1's three suspicions are all closed
(two became W1-6 and W1-7; the third is covered by W1-4's range checks), and three of Wave 3's
four are closed.

## The 2026-09-29 restructure

The governance documents were archived and the documentation was restructured into the
convention this repository now follows: README, TODO, IMPLEMENTATION, HANDOFF, plus MISSION as
the goal document.

- **What moved.** `CLAUDE.md`, `PLAN.md`, `TODO.md` and the three `REVIEW-FINDINGS*.md` files
  were `git mv`'d into `archive/v2-docs-20260929/`. `MISSION.md` and `README.md` were copied
  there as snapshots and remain live at the root. The three review documents stay read-only and
  remain the authoritative record of the W1, W2 and W3 findings.
- **The snapshot is commit 622e084.** A local tag `v2-snapshot-20260929` points at it. The tag
  could not be pushed, so on the remote the snapshot is identified by that commit id alone.
- **How the instruction was read.** "Archive all of our work" was read as: snapshot the state,
  archive the governance documents, keep the code and build on it. The alternative reading was a
  v1-style whole-tree archive and a rebuild from scratch. The human can say if they meant the
  rebuild. The human has said that the v2.1 ideas may be reused wherever they are sound, which
  is what the chosen reading assumes.
- **Governance adopted.** `AGENTS.md` follows the structure used in the `trading-templated`
  repository, with the shared conventions imported from `.claude/base/AGENTS.md` ahead of it and
  the repository-specific rules after. The rules from the archived `CLAUDE.md` are carried into
  it rather than left in the archive. A nightly strategy review runs as a Routine at 01:52
  America/Denver, and its output is appended to [docs/REVIEW-LOG.md](docs/REVIEW-LOG.md), newest
  first.
- **Link handling.** References in live files that pointed at a moved document now point at
  `archive/v2-docs-20260929/<file>`, so a phase or item id in a code comment still resolves.
  References to the old `CLAUDE.md` rules point at the live AGENTS.md section that carries the
  rule instead, because those rules did not move — they were rewritten into AGENTS.md.

## The route to the field test, decided 2026-09-29

The goal is one field test of live peak labels on the human's phone, reached with the fewest
human sessions and with accuracy proven headlessly before anyone drives anywhere. A planner
mapped the route, and the strategy adversary reviewed it twice before any building started.

**The phone browser is the primary field vehicle. The Expo shell is the fallback.** This
reverses the v2.1 choice. The web app can run its whole AR loop in headless Chromium: a real
photo stands in for the camera through a fake video capture, and CDP sensor overrides stand in
for the phone. It can be redeployed without the human, and its offline behaviour can be tested
in Playwright. Expo Go has no Linux path at all, and `exp.host` and `api.expo.dev` return 403
from this container. No further effort goes into `mobile/` until the web route fails on the
phone.

**What headless Chromium cannot prove.** Safari exposes `webkitCompassHeading`, which is
magnetic and referenced to the device's top edge, and a relative `alpha`. Chromium exposes
neither. So the web sensor adapter is a pure function of raw event objects, and its fixture is
recorded from the real phone at the home session. iOS 18 switches rear lenses inside a
`getUserMedia` stream without firing an event, a change of about 2x in field of view. So the app
opens the single-lens "Back Camera" device and logs `track.getSettings()` every second.

**The field of view the overlay uses is measured, not looked up.** A browser stream is a video
crop at a resolution Safari picks, not the still-photo field Apple publishes. Apple's figures
are a labelled initial guess. The value used is calibrated against the sun or a landmark sweep,
stored against the track settings, and re-checked as the first step in the field.

**Hosting is GitHub Pages, deployed from Actions.** The repository is already public, so the
free plan serves it. The deploy runs `test:deploy` before publishing and refuses an artifact
that contains a personal photograph or GPS.

**Declination comes from WMM2025, shown and labelled, never silent.** NOAA's host is blocked
from here. The coefficients and NOAA's test values come from a GitHub mirror, and are
cross-checked against an independent package before being called verified.

**Human sessions: one home session and one field session.** The home session (about 15
minutes) opens the URL, grants permissions, reopens in airplane mode, runs the four calibration
holds, records 10 s of raw sensor events, captures the sun, sweeps the field of view and tests
lens switching. The field session (about 25 minutes, Bogus Basin proposed) runs in a Safari
tab, not from the home screen. Capture bundles travel only by the human's own action to their
own email, and are never committed.

**Pass criteria are pre-registered as measurements with a budget, not guessed thresholds.** Raw
heading and pitch errors are recorded, and gated only on falling inside the band the app
displays. The after-drag tolerance is derived from a written error budget: peak position error,
elevation error, field-of-view scale at the frame edge, and drag precision. No false `visible`
label, the three most prominent predicted summits labelled, and summits beyond the terrain
reported `unmeasured`.

**What stays from v2.1.** The pure core, offline-first D7, D8, D9's drag and uncertainty band,
D10 `marginal`, labelled magnetic headings, refusals over guesses, summit heights from the peak
database, and the four-hold calibration instrument. The CV aligner stays out of the live path.
Its one real-photo result (heading 0.109°, pitch 0.690° on `railroad-ridge-48mm`, n = 1, truth
an eyeball apex pick, constants tuned on the evaluation frames) is locked later as a regression
test, not claimed as a capability.

## The portrait field-of-view bug on the phone, confirmed 2026-09-29

`cameraPoseFromFocalLength` in `src/core/projection.ts` gives the 36 mm gate angle to the image
width unconditionally. `src/exif/fov.ts` gives it to the longer displayed axis, which was the
W2-3 fix. The phone shell passes its portrait layout to the core function. On a 393×852 screen
with a 26 mm preset, that yields hFOV 69.39° and vFOV 112.65°, where the visible field is
35.42° × 69.39°. That is a 2.168x tangent-scale error on both axes: a 100 px vertical drag
records 19.4° of pitch trim instead of 9.2°. The horizon's slope under roll is unaffected, so
the four-hold sign check stays valid. `scripts/annotate-photo.ts` repeats the error on portrait
photographs (`portrait-orientation-6.jpg`: 69.4° × 85.4° instead of 54.9° × 69.4°). Every
committed real photograph is landscape, which is why no gate caught it. A test in
`src/live/drag-trim.test.ts` passes only because of the bug.
Probes: `scratchpad/verify-fov/probe-fov.ts`, `probe-still.ts`, reproduced by the adversarial
verifier.

The human's current phone, per the EXIF of six of the nine real fixtures, is an iPhone 17 Pro
Max: 13, 24, 48 (2x), 100 (4x) and 200 (8x) mm-equivalent. `docs/REAL-PHOTO-POSE.md` names the
15 Pro Max, whose lenses are 13, 24, 48 and 120 mm. The phone shell's presets, 13, 26 and 77
mm, match neither.

Declination at Bogus Basin (43.77 N, 116.09 W) on 2026-09-29 is +12.8° E. That figure comes
from IGRF-14 coefficients, checked against three published anchors to 0.3°, and is pending the
WMM2025 module. `heading-policy.ts` said declination is "under 5° across most of the contiguous
US", which is false for the Mountain West.

## WMM2025 magnetic declination, `src/core/declination.ts`

The module computes declination, inclination and field intensity from the World Magnetic
Model 2025. It is a pure function of position and date, and the date is an argument. It follows
NOAA's `geomag70` reference implementation:
- the Gauss coefficients advance linearly from epoch 2025.0
- geodetic position converts to geocentric spherical
- Schmidt semi-normalised Legendre functions come from the factorial-free Gauss recursion and
  are then rescaled
- the result rotates back through ψ = φ′ − φ into the local geodetic frame
- at the geographic poles, where Y′ carries a singular 1/cos φ′, the eastward component is
  evaluated as its limit

**The coefficients are generated, not typed.** `npm run fixtures:wmm` writes
`src/core/wmm2025-coefficients.ts` from the committed `fixtures/wmm2025/WMM.COF` (SHA-256
`dfa85978…582f`). The parser throws on a short or mis-ordered table, and regenerating the
module leaves it byte-identical.

**Two sources, because NOAA's host is blocked here.** Both files came from the GitHub mirror
`AbdeldjalilChougui/qibla_math`. They were confirmed against npm `geomagnetism@0.2.0`, an
independent conversion of NOAA's file:
- all 360 coefficients match to the last printed digit
- 1 440 computed points agree with that package's own implementation to 7.2 × 10⁻⁹ ° in
  declination, both poles included

**Accuracy.** All 100 of NOAA's published test values reproduce within 0.005° in declination
and inclination, which is the rounding floor of NOAA's printing, and within 4.3 × 10⁻⁴ nT in
total field. The test gate is 0.01°. Six single mutations each fail between 1 and 104 of the
126 tests. The polar branch is held by one continuity test, because NOAA's file stops at 89°.
The model itself is good to about 0.5° RMS in declination. It does not see local crustal
anomalies, which can reach several degrees, so a user-facing label says "about a degree".

At Bogus Basin (43.7715 N, 116.0886 W, 2000 m, 2026-10-15) the module gives +12.605° E. That
agrees with the IGRF-14 cross-check of +12.8° for 2026-09-29.

**Limitations.**
- Secular-variation rates are not computed.
- A date outside 2025.0–2030.0 returns a field flagged `withinModelValidity: false`.
- `heightM` is treated as ellipsoidal height. Using an SRTM orthometric height instead changes
  declination far less than the model's own error.
- The heading policy uses it; see "WMM2025 in the live heading policy" below.

## The web app publishes itself to GitHub Pages

The phone can use its camera, orientation and location only on a secure origin. So
`.github/workflows/pages.yml` publishes the app to `https://andre-sanborn.github.io/Mountain-finder/`
on every push to the development branch, and on manual dispatch. The workflow:
1. Builds with `--base=/Mountain-finder/`.
2. Fetches `N45E007` from the S3 SRTM mirror at build time, because tiles stay out of git.
3. Runs `package:deploy -- --gzip`.
4. Runs two gates before uploading the artifact, so a failed gate leaves the last good build
   live:
   - `npm run check:deploy-privacy` refuses a file named like, or byte-identical to, anything
     in `fixtures/photos/real/`, and any image carrying GPS EXIF.
   - `test:deploy` runs against the subpath layout the site is published at.

**The subpath was a real bug.** Vite's `base` rewrites only URLs Vite generated. Two strings in
`main.tsx`, the terrain manifest URL and `/peaks`, asked the root of the domain and got 404.
They now resolve against `import.meta.env.BASE_URL` through `src/app/base-path.ts`, and a root
deployment is unchanged. Reverting the fix fails the subpath deploy check 2 of 5, with
`No terrain index at /terrain/manifest.json (HTTP 404)`. The privacy gate fired on all three
planted cases: a private photo by name, the same photo renamed, and an unrelated JPEG with GPS.

**Actions are pinned to commit SHAs** because the workflow holds `id-token: write`.
`configure-pages` with `enablement: true` needs `administration:write`, which the workflow token
may lack. So that step continues on error and prints the manual steps in the job summary.

**Limit: Pages has no `gzip_static`.** The `.gz` siblings may never be served, and a phone may
download the full 25.93 MB tile. Measure what reaches the phone before budgeting on the
gzipped size.

### The fix: one rule for focal length to field of view

`fovDegFromFocalLength35mm` in `src/core/projection.ts` is now the only implementation of
"35 mm-equivalent focal length plus displayed width and height gives hFOV and vFOV". It gives the
36 mm gate angle to the longer displayed axis and derives the other through `otherAxisFovDeg`.
`src/exif/fov.ts` re-exports it, and a test asserts the two exports are the same function object,
so a second copy cannot reappear silently. `scripts/annotate-photo.ts` builds its pose through
the new `cameraPoseFromPhotoExif`, which prefers the extractor's field of view and refuses rather
than defaults. The phone's lens presets are per-model spec-sheet guesses: 17 Pro Max 13/24/48/100
mm, 15 Pro Max 13/24/48/120 mm.

The merged code keeps the EXIF module's arithmetic spelling, so the recorded acceptance figures
stay bit-identical. They are asserted with `Object.is`: 58.71550708558255 at 24 mm and
31.417275658031485 at 48 mm. Reverting the long-axis rule fails 11 tests across 5 files. Giving
the EXIF module back a private copy fails 5. The re-derived drag test expects 106.1312 px for a
120 px drag under the naive rule, 11.6 % short.

**Still open: which 35 mm convention Apple uses.** Apple quotes "13 mm, 120°" for the ultrawide.
That matches the CIPA diagonal convention (118.0°), not the long side (108.3°). On a 4:3 frame the
two conventions differ by about 2°, or 3 % of scale. This is to be settled against the solved
Railroad Ridge pose, and the convention is unchanged until then.

## Sun and moon position, `src/core/celestial.ts`

This is the bench-test instrument. The app draws the Sun or Moon where this module says it is,
and any heading, pitch or field-of-view error shows up as a gap between the drawn disc and the
real one.
- **Sun:** Meeus, *Astronomical Algorithms*, chapter 25, the low-accuracy method NOAA's
  calculator uses. The stated accuracy is 0.01°.
- **Moon:** Meeus chapter 47, the truncated ELP-2000/82 series. The stated accuracy is 10″ in
  longitude and 4″ in latitude.
- **Nutation:** the abridged series from chapter 22.
- **Parallax:** vector subtraction from the WGS-84 observer. This also gives the topocentric
  distance that the disc size needs.
- **Refraction:** Sæmundsson, off by default. Bennett is exported as an independent check.
- **ΔT:** the Espenak–Meeus polynomials, with an override.

**Measured against the book.** The worst residual across Meeus Examples 12.a, 12.b, 13.b,
22.a, 25.a and 47.a is 0.115″ (0.00003°), on the Moon's right ascension, from the abridged
nutation. Other expectations are closed-form identities: transit azimuths, rise azimuths, polar
day and night bounds, and the WGS-84 meridian-ellipse identities.

All 18 single mutations fail. Three survived the first round, and each exposed a hole in the
tests rather than a fault in the code:
- feeding TT to sidereal time, a 0.29° azimuth error
- refraction with its sign flipped, where the test had used an instant below −1°
- dropping the flattening, where the test had used only an equatorial observer

The general lesson: an identity that relates a module's outputs to each other cannot catch an
error that shifts them all together.

**Not covered.** NOAA, USNO and JPL Horizons are blocked here, so there is no third ephemeris
in the suite. Each transcribed book value was re-derived from its own example's inputs instead.
UTC is treated as UT1 (up to 0.5″ of lunar motion). Lunar light-time is ignored (about 0.7″).
The horizon is taken as normal to the ellipsoid, not the plumb line.

## WMM2025 in the live heading policy

`resolveHeadingForDrawing` resolves a drawable heading in three steps, each a weaker claim than
the one before, and labels which one answered:
1. `true`: the platform's own true heading, or a declination the caller supplied.
2. `true-model`: a magnetic bearing converted with WMM2025 from the observer's position and a
   date.
3. `magnetic`: labelled MAG, amber and dashed, per D9.

`true-model` is its own basis rather than a second kind of `true`, so the screen names the
source. It carries the declination added, the model name and `withinModelValidity`, and its
caveat quotes 0.5° RMS. The platform's true heading still wins, because swapping it for a
heading whose error is merely known would be a downgrade. Two conditions fall back to MAG: no
position, or a date outside 2025.0–2030.0.

The phone shell watches position at `Accuracy.Balanced`, refreshed every 1 km or 60 s, and
passes position and fix time to `HorizonScreen`, whose readout prints `true`, `true (WMM)` or
`MAG`. The iOS bundle is now 752 modules and 1.8 MB.

The test expectation at Bogus Basin (100.00° magnetic becomes 112.605° true) is cited from the
NOAA-verified module. The sign is asserted separately. Negating the applied declination fails 2
tests; negating only the application, leaving the reported figure intact, also fails 2.

**Limits.** Nothing in `mobile/` has tests: the wiring is held by typecheck, lint and the bundle
only. The first fix flips the readout by the local declination, about 12° at Bogus Basin, and
the trim is not carried across the flip.

## The web sensor adapter, `src/live/web-sensors.ts`

The adapter is a pure function of raw browser event objects. It produces the same
`GravitySample` and `HeadingSample` types as the Expo path, so the loop, `fuseSensorPose` and
the four-hold calibration are shared. The primary sources were read through reachable mirrors:
the W3C Device Orientation Editor's Draft of 2025-02-12, the W3C Orientation Sensor spec,
WebKit's `WebCoreMotionManager.mm` and `DeviceOrientationEvent.idl`, Chromium's
device-orientation pumps, and Apple's DocC JSON.

**`accelerationIncludingGravity` has opposite signs in the two browsers.** The W3C spec, and
Chromium with it, points it UP for a resting phone: z = +9.8 flat and face up. WebKit publishes
`(userAcceleration + CMDeviceMotion.gravity) × 9.80665`, which points DOWN. So the convention is
a required argument, and `detectMotionGravityConvention` decides it from a simultaneous
orientation event, never from the user-agent string. Gravity itself is read from the orientation
event, `ĝ = (cos β·sin γ, −sin β, −cos β·cos γ)`. alpha cancels out of that, so it works with
iOS's relative alpha, and it reproduces `calibration.ts`'s four hold vectors exactly.

**Facts about iOS, taken from WebKit's source:**
- `webkitCompassHeading` is `CLHeading.magneticHeading`, and `webkitCompassAccuracy` is
  `headingAccuracy`. With no compass they are a literal 0 and −1, so accuracy is checked first.
- alpha is relative, because no reference frame is requested.
- `headingOrientation` is never set, so the heading's reference is the portrait top edge.
- Safari does not implement `deviceorientationabsolute`.
- `screen.orientation.angle` does not move the device frame. It is carried for the UI, not
  applied.

**Open question for an upright phone.** Held up to a horizon, the documented reference edge
points at the sky, and no reachable source says what CoreLocation reports then. Both readings
are implemented as `CompassReferenceHypothesis`:
- `device-top-edge`: the documented reading. It inflates the reported accuracy by `1/|cos β|`
  and refuses past 90°.
- `rear-camera-axis`: undocumented. It treats the reading as the camera's own bearing.

A test asserts the two disagree on the same event. The route that works upright regardless is a
stored alpha offset (`rearCameraHeadingFromRelativeAlpha`). It is sampled while the phone is
tilted and held as it is raised, which is stateful work for the live loop. Until the home
recording settles the question, an upright iOS phone with no stored offset draws no heading.

The adapter has 53 tests. Six single sign or ordering mutations each fail between 2 and 10 of
them. Every expectation comes from the specs, WebKit's or Chromium's own arithmetic, or the
calibration vectors, so the suite proves the reading of the specs, not the hardware.

**What the home session's 10-second Safari recording must settle**, in order:
1. What `webkitCompassHeading` bears when the phone is upright, with the rear camera on a known
   bearing or the sun. This decides between the two hypotheses and the whole iOS heading path.
2. Whether `webkitCompassAccuracy` widens as the phone rises from flat to upright. If it does,
   the `1/|cos β|` inflation double-counts.
3. Whether the heading moves when the phone rolls about the camera axis. This is an
   independent discriminator for item 1.
4. Whether rotating to landscape changes the heading, `beta` or `gamma`. If it does, the
   "carried, not applied" handling of the screen angle is wrong.
5. The sign of the mapping from device roll to screen roll in landscape.
6. Whether `event.absolute` exists on iOS. If it does, and is true, relative alpha would be
   mistaken for absolute.
7. The sign of `accelerationIncludingGravity` flat and face up. WebKit's source says −9.8.
8. Whether `acceleration` is ever exactly (0, 0, 0), which marks the no-gyroscope fallback.
9. The four calibration holds as raw events. The verdict must be `matches-convention`.
10. The event rate and timestamp jitter, and whether the motion-permission grant survives a
    reload and airplane mode.

## Repository privacy gate, `npm run check:privacy`

The gate is the first step of `npm run check`, and takes about 2 s. It scans tracked files,
newly staged files, and unignored untracked files, so a capture fails before it is committed. It
fails on four things:
- GPS EXIF in an image
- a `.heic`, `.heif` or `.dng` whose EXIF `exifr` cannot read. Several committed HEICs are
  unreadable to it, and a refusal is no evidence of a clean file.
- a decimal-degree pair in `.json`, `.ts`, `.tsx`, `.csv` or `.txt` that also takes a capture
  shape: `coords` or `geolocation` nearby, a wall-clock timestamp nearby, the
  latitude/longitude/accuracy key set, or a capture-shaped path
- any file under `captures/` or `bundles/`

**Why the capture shape.** 164 of 339 tracked text files hold a coordinate pair, legitimately:
peak data, viewpoints, WMM values, synthetic scenes. Bare `latitude`/`longitude` keys flagged
30 files, and bare 10-digit integers flagged 15, including GERS ids and an LCG multiplier. The
shaped rule flags 4. Those 4 files, plus 14 images, are cleared by path and sha256 in
`scripts/privacy-allowlist.json`:
- 5 synthetic JPEGs with authored EXIF
- 9 files in `fixtures/photos/real/`
- 4 test or fixture files holding published coordinates and test dates

An agent reviewed all of these on 2026-09-29, not the human. `--approve` refuses to run in CI.
Detection is shared with the deploy gate through `scripts/lib/privacy-detect.ts`.

Ten mutations, one per rule, each fail exactly that rule's test. The test file carries no
coordinate literals, so it cannot trip the gate it tests.

**Limits.**
- An untracked and gitignored file is invisible to the gate, so `.gitignore` is the defence
  there.
- Markdown is out of scope.
- Editing a cleared file breaks its hash, so it needs one `--approve` per edit.
- If `src/exif/testing/generate.ts` is not byte-deterministic, regenerating the synthetic
  JPEGs needs re-approval.

## The field pose is landscape, decided 2026-09-29

Held upright in portrait, the iPhone's compass reference edge, the portrait top edge, points at
the sky, and no public source measures what `webkitCompassHeading` reports then. Held upright in
landscape, that edge is horizontal. Under the documented hypothesis, the camera bearing is the
reading ±90°, with the sign to be settled by the recording. Under the undocumented one, it is
the reading itself. Either way, landscape needs no stored alpha offset, so the web AR screen is
built for landscape. The offset hold is built only if the recording shows the compass route
unusable in landscape.

**Why this is safe to drop from the critical path.** The offset hold has four known failure
modes, all found in the strategy review, and so is not built unless needed:
- relative alpha drifts with handling. Full-Tilt issue #3 records this, and Apple's DocC says
  the plain reference frame drifts.
- `CLHeading` is filtered and lags attitude, so sampling during a raise biases the offset
- the offset silently outlives an alpha re-base on tab suspend or reload
- a user who opens the app already upright never gets a sample

**The home-session protocol gains two discriminating poses.** For pure pitch the top edge and
the camera axis share an azimuth, so a portrait-upright recording cannot tell the hypotheses
apart. Two poses can:
- landscape-upright on a known bearing, where the hypotheses differ by exactly 90°
- tipping past vertical, where the documented hypothesis flips 180° and the other stays
  continuous

The session also adds a 3 to 5 minute still capture followed by 1 minute of handling, to put a
number on alpha drift.

**Native fallback.** `expo-location` also reads a bare `CLHeading` with no `headingOrientation`
(`DeviceHeadingStreamer.swift`), so switching to Expo would not remove the question. But
`expo-sensors` starts device motion in `.xMagneticNorthZVertical` (`SensorsUtils.swift`), an
earth-referenced yaw at any pose. If the web compass fails in the field, that is the fallback.

## Field-site packages: `sites/`, `src/sites/`, `scripts/make-site-package.ts`

A site is a committed JSON definition: viewpoint, 360° sweep radius, margin and peak region.
Its package is built into the gitignored `data/sites/<id>/` by
`npx tsx scripts/make-site-package.ts <id> [--gzip]`.

**One mosaicked window, not whole tiles.** At Bogus Basin (43.77148 N, 116.08862 W) the
60 km disc touches four tiles: N43W116, N43W117, N44W116 and N44W117. `selectTerrainGrid` gives
a viewpoint one grid, so whole tiles (103.74 MB, 25.93 MB per session) would show a quarter
of the sweep. One mosaic in the existing manifest format needs no runtime change. It is
3920 × 5427 samples, 42 547 680 bytes raw and 20 782 728 gzipped, with a 60.5 km cut snapped
outward to arc-second lines. Cost at other radii: 20 km 4.90 MB, 40 km 19.07 MB, 70 km 57.75
MB raw. The raw figure is also the decoded array held in memory.

**The cut is exact.** North and south come from `destinationPoint`. East and west come from the
closed form `sin Δλ = sin δ / cos φ`, because sampling bearings only approaches that extreme
from below. Assembly copies bytes, so a seam is checked as byte identity: 9 347 boundary samples
are identical to their source tile.

**Finding: adjacent SRTM tiles disagree on their shared edge.** Four of 14 404 shared-edge
samples around Bogus Basin differ by exactly 1 m. The mosaic takes the northern tile's south
row and the eastern tile's west column, and refuses a disagreement over 5 m.

**Read back the way the app reads it.** Through `HttpTerrainStore`, all 72 ray ends at 60 km
read real terrain. A 360° `annotateScene` at 0.5° and 90 m with `nearFieldRadiusM` 150 took
0.98–1.87 s over four runs on a 4-core Xeon at 2.10 GHz with node v22. It read all 479 520
samples and labelled 70 summits, none marginal. The DEM reads 2308.3 m at the viewpoint.
Overture tags Shafer Butte, 32.7 m away, at 2308 m.

**Peaks cover the whole 60 km disc, from a second region.** `idaho-central` answers this
viewpoint only to 41.1 km. So `idaho-bogus-basin` was imported for the disc from Overture
`2026-09-23.1`, the newest surviving release: 174 summits in four cells, 67 kB, with bounds
43.2…44.4 N, −116.9…−115.3. The import read 2.27 MB of columns out of 30.15 GB.

`idaho-central` is frozen by a sha256 in `tests/unit/peak-regions.test.ts`, for two reasons:
- the Idaho acceptance cases assert its summit ids, coordinates and heights
- its release, `2026-06-17.0`, has been deleted upstream, so those bytes cannot be produced
  again

The package now reports 104 named summits inside 60 km, 78 labelled, coverage complete to
63.3 km, and a 1.34 s sweep. Shafer Butte now lands 30.2 m from the viewpoint.

**Finding: release stability from 2026-06-17.0 to 2026-09-23.1.** In the overlap, 43.4…44.4 N
and −116.6…−115.3, each release holds 122 summits, and 120 of them share a GERS id. Among those
120, no name and no elevation changed. Four positions moved by more than a metre: Lightning
Creek Rocks 198.3 m, Cougar Mountain 48.1 m, Shafer Butte 6.2 m and Jackson Peak 4.0 m. The four
unmatched ids are three real events, not four:
- Homer's Nipple was re-identified 8.3 m away
- Trail Creek Summit was removed
- Lightning Ridge was added

So a diff by id alone overstates the churn. The test pins names exact, elevations exact and
positions within 250 m.

`fetch-peaks.ts`'s `DEFAULT_RELEASE` is still the deleted `2026-06-17.0`, so a run with no
`--release` fails loudly. That is deliberate: a silent bump would re-cut the older regions from
a different release.

The site-package tests number 22, and every expectation is hand arithmetic. Four mutations were
run: shrinking the tile set, shrinking the radius, a column off by one, and rounding the band
with ceil. Each is caught. The off-by-one mutation first exposed an infinite loop, which now
raises instead.

**`testTimeout` is 15 s** in the root vitest config. The CV aligner's real-SRTM cases took
4.1–4.9 s each against the 5 s default when the suite shares four cores. The acceptance config
already allows 30 s.

## The home-session recording and its analyzer, `src/live/recording.ts`

A recording is a list of labelled pose segments. Each holds raw orientation and motion fields,
`webkitCompassHeading` and its accuracy, whether the event carried an `absolute` key,
`screen.orientation.angle`, and camera track settings. Timestamps are milliseconds from the
start of the capture. There are thirteen pose labels, and four of them are `calibration.ts`'s
holds under their own names. `npx tsx scripts/analyze-recording.ts <file> [--brief]` prints
fourteen verdicts, each with a confidence and its evidence. It writes nothing.

**The known bearing stores the answer, not the inputs.** The device computes the sun's
azimuth and declination, stores the resulting bearing, and discards position and time. The
optional true azimuth and declination exist only to check the sign of the declination to
0.05°. A stored declination narrows the observer to an isogonic band, and that residual leak
is stated here.

**The parser is strict.** It uses exact key whitelists and a forbidden-key scan over the raw
document. It refuses any number of 1e9 or more as epoch-shaped, and any ISO date as a wall
clock. Every problem is collected rather than stopping at the first.

**One relation discriminates the compass hypotheses.** The top-edge azimuth minus the camera
azimuth is an angle Δ that depends only on beta and gamma. `device-top-edge` predicts
`reading = camera + Δ`, and `rear-camera-axis` predicts `reading = camera`. Δ is 0 in portrait,
which is the blind spot, ±90 in landscape, steps from 0 to 180 past vertical, and sweeps under a
roll. A pose that fits neither hypothesis convicts the whole recording. That rule was added after
a mutation showed the tip pose alone cannot tell +Δ from −Δ.

Two synthetic recordings differ only in what the compass reports, and the analyzer names each
correctly. It recovers an injected drift of 2.4 °/min across a 77° re-base as +2.31 °/min. The
forward model uses hand-reduced closed forms, and a test checks it against the adapter's full
matrix at more than 100 attitudes. The suite has 62 tests, and six mutations each fail between
1 and 12 of them.

**Limits.** A portrait-only recording cannot separate the hypotheses, and returns inconclusive
by design. The drift figure while handling is an upper bound, because of compass lag. The
screen-angle values in the fixtures are synthetic.

## The web AR screen, `live.html` and `src/app/live/`

This is the page the phone opens in Safari. It draws the still app's overlay, with the same
`layoutOverlay`, D8 styling and D10's "may be hidden", over a live rear-camera preview, at a
pose read from the phone's sensors. It is a second Vite entry in `rollupOptions.input`, not a
route: the still app's EXIF, CV and compositor code never reaches the phone.

**Landscape only.** A portrait viewport draws nothing and says "Turn the phone sideways".

**The `object-fit: cover` crop.** `video-box.ts` computes the crop with the tangent relation,
and places the principal point at the element box's centre. The notch is a label keep-out
margin, not an inset of the overlay box, because an inset box would move the optical axis off
centre. Dropping the crop fails 4 e2e tests.

**One 360° sweep at the fix.** The sweep is 720 rays to 30 km at 90 m steps, with
`nearFieldRadiusM` 150, and it is re-projected per tick with no re-sweep. At Gornergrat it took
811 ms in Node and 1.3–2.4 s in headless Chromium, with all 720 rays carrying terrain.

**One lens.** `chooseRearCamera` refuses dual, triple, virtual and composite devices, prefers
"Back Camera", and reopens the stream on `deviceId: { exact }`. `getSettings()` is read every
second, and a change of `deviceId`, `width` or `height` is reported as a lens change.

**Field of view.** The screen uses either a calibration stored against the track settings, or
a spec-sheet guess labelled "uncalibrated FOV". The phone model is a picker, defaulting to the
iPhone 17 Pro Max, because iOS Safari's user-agent carries no model.

**The live uncertainty band** uses the terms a sensor stream actually has: WMM2025's 0.5°, the
compass's reported accuracy, the trace's own scatter, and an unquantified term while the field
of view is uncalibrated. The photo band's fixed pitch term is left out, because live pitch is
sensed. The Sun and Moon are drawn at their true angular size, with refraction on.

**What the headless suite proves.** `tests/e2e/live.spec.ts` has 11 tests. They run against a
fake camera made from a landscape photo, dispatched sensor events and the Gornergrat tile:
- The Matterhorn lands within 8 px (1 % of the frame width) of a position derived twice from
  the coordinates: 265.4227°, 9.5827 km, +8.20145°.
- A 10° turn moves the labels by the tangent answer, and nothing is re-swept.
- Portrait refuses.
- A silent `applyConstraints` lens change is flagged.

Sensor injection was measured in Chromium 141. The CDP orientation and sensor overrides deliver
null or relative angles, so they are unusable. Dispatching real `DeviceOrientationEvent` and
`DeviceMotionEvent` objects in the page works, including the webkit fields, and that is what
the suite uses. Three mutations fail 4, 1 and 4 tests. `test:deploy` adds a test that
`live.html` works under the Pages subpath.

**Only the phone can prove:**
- the values real sensors emit
- the device-roll to screen-roll sign. The screen has a flip button, and a wrong choice shows as
  plainly upside down.
- `webkitCompassHeading`'s reference in landscape. The default is `device-top-edge`.
- real lens labels and switching
- the real field of view of a Safari stream
- whether permissions survive a reload and airplane mode

**Limits.**
- The offline status and download button are on screen; see "Live sweep range, fine drag, offline strip".
- Eye height is 1.6 m.
- The observer stands 1.6 m above the DEM's ground at the fix. GPS altitude is only a fallback,
  and the screen shows which was used; see "The home session" below.

## The real-photo CV result is locked on its own terrain window

`tests/acceptance/cv-alignment-lock.test.ts` pins what `suggestPoseTrim` recovers on the 48 mm
Railroad Ridge frame: heading error −0.1148° and pitch error +0.6892° against the solved pose,
gated at 0.25° and 0.85°. The gates are about 1.3 and 1.6 steps of the comb's 0.1° search. The
test also requires `low-confidence` status with named concerns, and the 24 mm and 14 mm frames
to decline. It is a regression lock, not a capability claim: n = 1, the truth is an eyeball apex
pick, and the constants were tuned on these frames.

**The recorded figure depended on gitignored data.** On the committed 7.5 km disc the 48 mm
frame declines. The docs' −0.109° / +0.690° came from a 30 km profile off `data/tiles/`, and
that reproduces to 0.0006°. Sweeping the maximum range shows why the window matters:
- declined at 7.5 km
- −0.66° at 8–10 km
- converged from 12 km, stable to 25 km

Castle Peak, at 11.07 km, anchors the fit. So the lock uses a committed sector,
`railroad-ridge-cv-window`: bearings 140–210°, out to 12.5 km, 579 KiB. It gives trims
bit-identical to a full 360° profile, because the aligner reads nothing outside its searched
span.

Flipping the heading sign and the pitch sign in `align.ts` were each caught.

**Known brittleness.** The 14 mm frame declines at 24.2 % usable columns against a 25 % floor,
0.8 points from flipping. CV-10's row in `docs/FINDINGS.md` now carries these figures.

## Field sites in the deployment, and offline after one visit

**One terrain manifest.** `package:deploy` stages each built site mosaic into
`dist/terrain/sites/<id>/`, listed beside the tiles. `selectTerrainGrid` then gives a Bogus
Basin viewpoint the 1.64 deg² mosaic and gives Gornergrat N45E007, so the Matterhorn proof is
unchanged. A defined site with no built package fails packaging. Otherwise one viewpoint would
silently get a quarter of its sweep. Packaging also refuses duplicate grid names and a missing
`sw.js`. `pages.yml` fetches N43W116, N43W117, N44W116, N44W117 and N45E007, and builds the site
package.

**No `--gzip` on Pages, measured.**

| Published set | Files | Artifact |
|---|---|---|
| without `--gzip` | 97 | 179 430 202 B |
| with `--gzip` | 110 | 268 298 144 B |

The difference is 88.87 MB of `.gz` siblings that Pages cannot serve. Both sizes are inside
the 1 GB Pages limit, which the workflow now checks. That limit was cited from search
summaries, because docs.github.com is blocked here. A phone pays 42.55 MB for the Bogus Basin
mosaic, unless the Pages CDN compresses in flight.

**The service worker.** `src/offline/live-service-worker.ts` is emitted as `dist/sw.js`
(4 861 B) at the deployment root by a build-only Vite plugin. Pages cannot set
`Service-Worker-Allowed`, so the worker has to live where its scope is. It keeps two caches:
- the shell: navigations are network-first with a cache fallback. Asset URLs are read off the
  live DOM.
- the data under `terrain/` and `peaks/`: cache-first, ignoring `Vary`

A whole site package is cached only on an explicit `downloadTerrainGrid`. iOS deletes all
script-written storage after seven days without interaction (WebKit's storage-policy post),
so tens of megabytes on a guess is a button, not a default. The dev server registers no worker.

**Proved** by the deploy check, now 8 tests, at both the site root and `/Mountain-finder/`:
- the Bogus Basin viewpoint gets the mosaic, and all 72 ray ends at 60 km fall inside it
- `live.html` reloads with the context offline, and reads a cached grid back at its exact byte
  length. The test first confirms an uncached file fails, so it cannot pass against a server
  that is still answering.

Three mutations are caught: `--no-sites`, a missing `sw.js`, and a stubbed cache lookup.

**Limits.** The status line and download button are not rendered yet; `useOfflineCache()` is
ready for them. `CACHE_VERSION` is bumped by hand. The seven-day eviction cannot be prevented
from script.

## The field-test error budget and pre-registered criteria

[docs/FIELD-TEST-PREREGISTRATION.md](docs/FIELD-TEST-PREREGISTRATION.md) fixes F1–F6 and the
budget they come from. It was written before any field number existed. `src/live/field-analysis.ts`
holds the bundle schema, a strict parser, `PREREGISTERED_THRESHOLDS` as data and the F2–F5
graders. `npm run analyze:field -- <bundle> <truth>` prints the verdicts, and the grader takes no
threshold argument.

**A drag removes common-mode error, and the tolerance is what remains.** The budget frame is an
iPhone 17 Pro Max in landscape: 956 × 440 CSS px, hFOV 73.74°, 11.12 px/deg. The error terms,
taken 1σ at the frame edge:
- drag precision 0.543°, which is 1 mm of finger
- roll 0.322° vertical
- calibrated FOV scale 0.275° horizontal
- geodesy 0.716° horizontal at 2 km, 0.143° at 10 km, 0.024° at 60 km

The combined (RSS) 1σ is 0.95° / 0.72° at 2 km and about 0.63° beyond 10 km. So the 2σ
thresholds are 1.90° / 1.45° inside 3 km and 1.30° / 1.30° beyond 7 km. Term sources:
- peak position 20 m, from the Overture cross-release RMS of 18.6 m
- summit height 5.5 m RMS
- observer horizontal 15 m, n = 1
- observer height 10 m, with DEM ground
- refraction, dropped at 0.0135°
- heading lag, excluded by a 2 s hold

**Preconditions the budget cannot absorb:**
- Observer height must come from DEM ground. A 50 m geoid error is 1.441° at 2 km.
- The field of view must be calibrated. A 10 % scale error is 2.75° at the edge, so the grader
  refuses uncalibrated captures.

**Truth** is two agents picking apexes independently on a frame at least 1920 px wide. Picks
more than 0.30° apart are `truth-disputed` and excluded, never averaged. One site and one
session give 8 to 16 graded observations. So the session can refute the budget but not confirm
it, and a band with no sample is reported as such.

**Privacy.** A bundle carries no bearings, because a bearing plus a distance fixes a position.
The report prints band labels, never distances, and the parser refuses geolocation, epoch and
ISO timestamps, bearings and camera ids.

The suite has 57 tests. Seven mutations are caught, and three of them first survived and forced
fixes. For example, the threshold comparison is now a single `withinThreshold`.

## The home session, `live.html?session=home`

This is the AR screen with a guided sequence over it: one step per `POSE_LABELS` entry, each with
one plain instruction, a countdown and "Move on now". It takes about five minutes, three of
them a still hold. What the file contains is stated before recording starts. The file holds
sensor readings and camera frame sizes, and never the location, the time or any picture.

`HomeSessionRecorder` is a second raw-event sink. It stamps its own relative clock and drops
device ids and labels. The Sun's magnetic azimuth is computed once, at the first aiming step,
and position and time are then discarded. Over the 20 s of aiming the Sun moves about 0.08°.
The device parses and analyses the file itself, then offers Web Share with the file, falling
back to a download. `home-session-share.ts` contains no `fetch` and no URL, and a test checks
that.

**Field of view from taps, `fov-calibration.ts`.** The fit is `b = s·a + d` in pixels, where
`s = f_true/f_assumed`. Then:
- `tan(hFov_true/2) = tan(hFov_assumed/2)/s`
- heading moves by −d_x/f
- pitch moves by +d_y/f

Two taps near opposite edges are required, and references closer than a tenth of the frame are
refused. The field of view is stored through `fov-choice.ts`, and the offsets go into the
visible nudge.

**Observer height from the DEM.** The fix's altitude is passed as `fallbackGroundElevationM`. At
Gornergrat the DEM reads 3087.98 m, against a published 3089 m.

Six new e2e tests drive all 13 poses with dispatched events. They check that:
- the shared file passes `parseRecording`
- it holds no coordinates, epochs or fix digits
- no request carries it
- an injected ×1.1 scale and a (10, −6) px offset are recovered from taps

The sun disc itself is not exercised, because the Sun is near the horizon at Gornergrat during
CI. Summit dots take the same arithmetic path. Nine mutations each fail between 1 and 4 tests.

**The human's steps**, as the screen presents them:
1. flat face up
2. upright portrait
3. face down
4. upright, turned right edge down
5. rear camera at the sun, portrait
6. landscape, camera end left
7. landscape, camera end right
8. tip past vertical
9. a steering-wheel roll
10. rotate to landscape and back
11. still for 3 minutes
12. 1 minute of normal handling
13. two taps on the sun near the left and right edges

## Route corrections from the error-budget review, 2026-09-29

The strategy adversary reviewed the changes the budget suggested. It is still pre-data, so
every change below is legitimate, and each lands in code and doc together.

- **The live sweep reaches the site radius, not 30 km.** `liveSweepConfig()` spread `APP_SWEEP`
  (`maxRangeKm` 30), so on the phone every summit beyond 30 km was `unmeasured`. The site
  package's "78 labelled" came from a 60 km script path the phone never runs. At Bogus Basin,
  63 of 104 summits within 60 km lie beyond 30 km. The ten highest by apparent height are all
  34–58 km away (Trinity 56.4 km, Freeman 36.5 km, Pilot 38.4 km). For every heading, the
  in-frame top three include a summit beyond 30 km. The fix: keep the 60 km terrain and take the
  sweep range from the served site. The throttled-CPU sweep timing becomes a precondition of the
  field session. Cutting to 40 km was rejected, because it drops the most prominent summit and
  half the top ten.
- **The F3/F4 gate tolerates one 2σ exceedance and no 3σ exceedance.** "Every summit inside
  2σ" passes a correct budget with probability 0.95^32 ≈ 0.19 at n = 16, which is
  self-defeating. 2σ stays the reported band.
- **The drag term is measured before thresholds move.** Fine drag, a 4× slow mode, ships now.
  0.05° nudges are below the 0.0899°/px quantisation, so there are none. The home session
  gains three repeated drags on a reference, with and without fine mode, plus a roll-spread
  record. The thresholds are re-derived from those measurements, not from a second judgement.
- **F4's pan becomes "until the anchor summit sits at the frame edge"**, a target visible on
  screen, instead of ±20° or ±30°.
- **`coords.accuracy` is recorded per fix, with its confidence stated.** W3C defines it as a
  95 % radius, about 2.45σ per axis. Apple does not state one. It lives only in the bundle, and
  the committed fixtures must not trip the privacy gate.
- **Prereg text corrections.** At Bogus Basin the anchor is in practice 35–57 km out, not
  7–20 km; the thresholds stay conservative. Near and mid bands will likely report
  `no-sample`, and the doc says so now. F2 is conditional on calibration. The field steps say
  to stand within a few hundred metres of the site coordinate, because the cut has 0.5 km of
  margin.

## The live sweep's cost in a browser, throttled

Measured in Playwright Chromium against the Bogus Basin package, through `HttpTerrainStore` and
the live screen's own `annotateScene` call. There were 5 runs per cell, in two passes that agree
within 4 %, and the load average stayed between 0.56 and 1.43. Figures are the median, with the
range in brackets.

| CPU throttle | 30 km sweep | 60 km sweep | compute start, 60 km |
|---|---|---|---|
| 1× | 0.32 s | 0.64 s (0.62–0.66) | 0.81 s |
| 4× | 1.49 s | 3.00 s (2.92–3.19) | 3.63 s |
| 6× | 2.28 s | 4.52 s (4.38–4.68) | 5.53 s (worst 5.65 s) |

The compute start counts the manifest, the 42.55 MB mosaic read and decode (0.91 s at 6×), the
peak cells, and one full sweep. **F1 keeps 9.5 s of its 15 s at 6×.** Chrome names 4× "mid-tier"
and 6× "low-tier" mobile, both relative to the host. By published Geekbench 6 single-core scores,
read from search summaries, an A19 Pro is about 4.5× faster than this Xeon vCPU. So 6× is very
pessimistic for the field phone.

Still unmeasured: the Cache Storage read on iOS, the permissions, the fix and the first paint.
After a forced collection the retained heap is 44 MB, which is the decoded grid plus about 1.5 MB
of scene. The peak is 96–106 MB, while the fetched buffer and the decoded copy coexist.

The scene matched the site package's own figures exactly: 720/720 rays, 78 labelled, 0 marginal.
At 30 km the same call labels 32 summits and leaves 132 unmeasured.

The harness lives outside the repository, in the session scratch directory.

## The pre-registration, revised before any field data

The revision history is in docs/FIELD-TEST-PREREGISTRATION.md, and the pre-edit copy is
archived.

**The F3/F4 gate counts exceedances.** A band fails on more than one summit-axis past 2σ, or on
any axis past 3σ. The 3σ limit is 1.5 × 2σ, rounded up to 0.05°. A correct budget passes with
probability p0^n + n·p1·p0^(n−1), where p0 = 0.9545 and p1 = 0.0428. That is 0.936 at n = 8 and
0.815 at n = 16. The old rule passed with 0.9545^n: 0.475 at 16 and 0.225 at 32.

**F4's pan target is the anchor at u ≥ 0.8** of the half-frame, read from the drawn overlay.
The pan angle is recorded but not gated.

**Observer accuracy is measured.** A capture may carry `horizontalAccuracyM` under a declared
`accuracyConvention`. W3C defines it as a 95 % radius, so σ = r/2.4477. Apple states no
convention, and the W3C one is assumed because Safari serves the W3C API. The recomputed limit
can only tighten the registered one. Accuracy worse than 30 m refuses the capture.

**Text corrections:**
- the anchor is 35–57 km out
- near and mid bands are pre-declared as likely `no-sample`
- F2 is conditional on calibration
- the radius decision is stated
- the site steps are stated

The drag and roll terms are unchanged until the home session measures them.

The suite has 79 tests. Ten mutations are caught. The stray fixture now carries a 3σ
excursion, 2.223° against 1.95°.

## Live sweep range, fine drag, offline strip

**The sweep range comes from the served grid's geometry.** `sweep-range.ts` finds the largest
radius whose full ring lies inside the grid `TerrainCoverage` already chose, using a closed
form: meridian arcs north and south, and `sin Δλ = sin δ / cos φ` east and west. It then
subtracts 0.25 km, caps the result at 60 km and floors it at 30 km. So Gornergrat stays at
30 km, and inside the Bogus Basin mosaic the sweep reaches 60 km. That sweep took 3.0–6.4 s in
headless Chromium, unthrottled, with 720/720 rays. The range is not read from the grid's name,
which would move the sweep if the grid were renamed. The range only ever raises the sweep:
`rangeIsMeasured` refuses honestly on short rays.

The e2e serves the real built package and asserts `data-max-range-km` = 60. It also asserts
that Trinity, Freeman or Pilot Peak is drawn at a heading facing it. Forcing 30 km fails both
assertions independently.

**Fine drag** is a labelled 4× toggle. The gain multiplies degrees, not pixels, because the
projection is linear in the tangent. A test pins gain 1 as identical to `trimFromDrag`. Nudges
of 0.05° were rejected, because one pixel is 0.0899°.

**The drag trials.** The home session ends with 3 normal and 3 fine attempts at putting a label
on its feature. Each attempt records its offset and its roll spread, and the scatter (sample sd)
is the measurement. They are written into the shared file under `dragTrials`; see below.

**The offline strip** shows cached page and terrain files and the storage estimate. It also
shows "Download <grid> for offline use (NN MB)", naming the grid `selectTerrainGrid` would pick
and its exact byte count. The status read is raced against 4 s, because `serviceWorker.ready`
never settles when no worker is registered.

There are 50 new unit tests and 5 new e2e tests. Three mutations of the range derivation were
run. Dropping the margin survived at first, until a test was added that searches for a
viewpoint where the margin matters.

## The human guides, and the privacy gate's fix-key message

`docs/HOME-SESSION-GUIDE.md` and `docs/FIELD-SESSION-GUIDE.md` are written for the human:
where each step happens, exact URLs in copyable blocks, and nothing to fill in. The home guide
copies `home-session.ts`'s 13 steps word for word. When those steps change, the guide changes
too. The sun window is 15–50°, measured with fists at arm's length. The order is Start and
permissions, then the offline download, which appears only once there is a fix, then airplane
mode and a reload. The field guide's steps come from prereg §2.7 and carry a banner until
field mode lands.

**iOS settings paths:**
- verified: Settings → Apps → Safari → Camera, and Privacy & Security → Location Services →
  Safari Websites
- not verified: any Motion & Orientation Access setting on current iOS. Reports say it went
  after iOS 13. The guide labels this as unverified.

`refusals.ts` still names the older paths.

**The privacy gate's position-fix finding now names each key and its line**, and says that prose
counts. That rule is the only one judged over the whole file. Replacing the line number with a
constant fails 2 tests.

## Drag trials in the recording, and the field session

**`dragTrials`.** `HomeSessionRecording` gains an optional, exact-key-whitelisted array beside
`segments`. Each trial holds its index, mode, pixel offset, degree offset, roll spread, sample
count, duration and gain. It is relative to its own gesture, so it carries no position. The
analyzer's `drag-scatter` verdict reports the sample sd per mode against the budget's 0.543°,
which it imports from `BUDGET_TERMS`. Four mutations are caught.

**The field session, `live.html?session=field`,** is prereg §2.7 on the AR screen. The run is:
stand near the site, check the FOV with two taps, wait for a fix under 30 m, brace, capture raw,
drag one named summit in fine mode and capture, then four movements: the anchor to the left
edge, the anchor to the right edge, +10° and −10°. Two more drag captures follow, eight captures
in all. The pan target is u ≥ 0.8, and the screen shows the progress toward it.

Frames are stored at the video track's own width, at least 1920 px, and never drawn over. Every
field in the bundle is named explicitly, so no bearing and no `deviceId` can slip in. The bundle
and its frames are shared in one Web Share call. A partial save counts as a failure, because
truth lives in the frames. The privacy statement leads with the fact that photographs show
where they were taken.

The e2e runs the whole sequence against a 1920 × 1080 fake camera, and checks that:
- the bundle parses
- it holds no coordinate near the fix
- the frames correlate 0.923 with the video. That is a correlation, because Chromium
  colour-manages video and JPEG differently.

`analyze:field` on that bundle, with truth from the injected pose, passes F2, F3.far and F4.far,
with the residual 0.134° from the test's own 4 px drag. The other bands are `no-sample`, as
pre-declared. Four mutations are caught, two of them on privacy.

**Found:** the bundle is 2.4 MB for 8 captures, because `overlay.withheld` repeats about 940
unmeasured summits per capture.

The Playwright harness moved to `tests/e2e/support/gornergrat.ts`.

## The viewport and the stored frame are registered apart

The budget's roll, FOV-scale and drag terms belong to the viewport the overlay is drawn in:
956 × 440 at hFOV 73.74°, checked against `overlayPx` within 10 %. The stored frame carries no
budget term. It sets annotation precision only, so it is registered as at least 1920 px wide,
with its aspect within 2 % of the camera track's, not the viewport's. A capture with no track
size is reported as unchecked. Before this change every 16:9 capture was flagged as 18.2 % off.
`analyze:field` output on both fixture pairs is byte-identical. Five mutations are caught, and
the change is in the prereg's revision history.

## iOS settings paths in the refusals

These are for iOS 26:
- **Camera:** Settings → Apps → Safari → Camera.
- **Location:** both Privacy & Security → Location Services → Safari Websites, and Apps → Safari
  → Location.
- **Motion:** there is no setting of its own. The remedy is clearing the site's Website Data
  (Apps → Safari → Advanced), and the screen says plainly that this, or closing the tab, has not
  been confirmed on this iOS.

`support.apple.com` is blocked here, so the sources are search summaries: two independent ones
each for camera and location, and forum and how-to sources for motion. The home session will
settle motion. `docs/FIELD-SESSION-GUIDE.md` now quotes `field-session.ts` verbatim, checked by
a script.

## The headless dress rehearsal at Bogus Basin

`tests/e2e/rehearsal.spec.ts` runs the whole `?session=field` sequence against:
- the packaged 60 km mosaic
- the `idaho-bogus-basin` peaks
- IMG_7270's EXIF position and its EXIF heading, 280.336°
- IMG_7270 itself as the camera, centre-cropped to 16:9

The sensors carry +8° compass and −2° pitch. The test is skipped when the site package is not
built, and its outputs stay in gitignored `out/rehearsal/`.

**The injected heading is 92.3° from the one the photograph was taken at.** The camera faced
188° ± 1° (X-10, `docs/REAL-PHOTO-POSE.md`), so every result that depends on which summits are
in view is void: the anchor (Crown Point), the 8 labels, and the annotation list. The two
annotators correctly returned all 17 listed summits as not in the picture.

What holds is measured in screen space:
- three drags closed to under 1 px
- a 60 km sweep in 2 562 ms, with 720/720 rays
- the pans reached u = 0.850

The run also exposed the grader's plain-ratio mapping, which is now fixed; see "The overlay is
drawn over a crop of the stored frame". The fake camera is a still image, so F4 tests overlay
arithmetic only. The rehearsal is to be re-run at the solved pose, 188° and about −4.9° pitch,
with Deer Point as the drag anchor and other features graded.

## The overlay is drawn over a crop of the stored frame

The AR screen draws the camera at `object-fit: cover`. The frame is scaled by
`max(viewW/trackW, viewH/trackH)`, and the overflow is cut evenly off the axis that
overflows. On screen that leaves 81.8 % of a 16:9 stream's height in the 956 × 440 viewport,
and 75 % of a 4:3 stream's. The grader now maps a drawn marker onto the stored frame through
the same crop, and takes angles with the whole frame's FOV, which is the pose's visible-box
FOV read back through the crop.

The crop is computed from the aspect ratios, so the uncropped axis is exactly 1 and the
equal-aspect case is unchanged bit for bit. A grid test holds it to `videoBoxGeometry`. A
capture with no track size is refused.

The old plain ratio scaled vertical residuals by 1080/440 = 2.45, where the truth is
1920/956 = 2.01, and about a centre 98 px away. So residuals were 22 % too large, silently.
The rehearsal never saw it, because its camera and viewport were both 16:9.

The fixtures were re-placed through the mapping. `analyze:field` output is unchanged except for
one 0.849° → 0.850° line, which is a real 0.03 % FOV effect. Ten mutations are caught. The
report now prints "not graded" separately from "graded, with a caveat".
