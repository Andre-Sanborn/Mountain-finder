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
