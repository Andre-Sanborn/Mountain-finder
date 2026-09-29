# Mountain Finder

Point it at a photo of mountains — it works out which peaks you're looking at and plants
labeled flags on their summits. Offline: terrain comes from local SRTM tiles, summits from a
local peak database, and nothing talks to an API at runtime.

## Status, honestly

- **v2.0 ships and works.** The whole chain runs end to end: drop a photo into the web app and,
  where terrain is available, it renders a real overlay and exports it. It is proven on four
  ground-truth viewpoints and a packaged static deployment, and since Q8 the app reads the
  **9 237-summit Overture dataset** over `/peaks/` rather than 15 bundled summits. Last gate run
  (2026-08-17): `check` **1 168 tests**, `test:acceptance` **178**, Playwright **22**,
  `test:deploy` **5**.
- **v2.1 (CV alignment) works on real photographs, with its limits measured.** Auto-align is
  wired into the app and into `npm run annotate -- --auto-trim`: it proposes trims for the
  *visible* sliders and never corrects anything behind them. On the one photograph with an
  independently solved pose it recovers **heading to 0.11°** — better than the phone's own
  compass (0.6°) — and pitch to 0.69° against an unrecorded truth of −3.52°, moving a summit
  flag from 332 px off its apex to 66 px. Two findings shaped it, both kept: a wide heading
  search returns a **confident impostor** 10.4° off ([CV-10](docs/FINDINGS.md)), so the search
  is clamped to a compass budget; and the extractor's old habit of locking onto snowfields and
  foreground tundra is **fixed** by a sky-roughness cue ([CV-2](docs/FINDINGS.md)) — wide frames
  now refuse rather than answer wrongly. **What is open is recall, not correctness**: hazy
  distant crests report unreadable, so the 24 mm and 14 mm frames decline.
- **v3 (live view): the pure layers are proven, and the shell now exists — unrun.**
  `src/live/sensors.ts` derives pose from gravity and compass traces with the EXIF path's
  discipline (magnetic is never silently true; five named refusals), `src/live/device-samples.ts`
  converts Expo's payloads into those traces (X-7 — no `gravity` field exists, units are m/s²,
  the sign is CoreMotion's and *not* the W3C spec's, and the compass `accuracy` is a 0–3 bucket
  rather than degrees; all four verified against the native Swift and Kotlin, not the docs), and
  `src/live/loop.ts` re-projects one computed scene per sensor tick — proven marker-for-marker,
  pixel-for-pixel equal to re-running the still pipeline, and refusing when the camera turns past
  the swept terrain. **[`mobile/`](mobile/README.md) is the Expo shell**, running under Expo Go so
  it needs no Mac, no Xcode and no Apple Developer account. It carries the instrument that closes
  P8.2's bar rather than the AR view: four holds whose gravity vector is known from geometry,
  which either confirm the frame conventions against hardware or name the exact signed axis map
  that is wrong. Its Horizon screen draws the computed horizon over the camera and **lets you
  drag it into place** — D9's interaction, writing the same visible trim the web app's sliders
  write, and drawing on a *labelled* magnetic bearing rather than refusing when true north is
  unavailable. `npm run check:mobile` typechecks it against the real SDK together with the 39
  shared files it imports **unchanged**, lints it, and **actually builds it** — Metro plus
  Hermes, 750 modules, exported clean. That last step is not ceremony: the first version
  typechecked, linted, passed every test and **could not be built**, because a barrel import
  dragged `exifr`'s dynamic `import()` into a bundle Hermes rejects ([X-8](docs/FINDINGS.md)).
  Nobody has *run* it, though, so it stays `[~]`, not ticked. Peaks wait on the hardware
  verdict, and on how a phone carries DEM offline (D7).
- **The honest gaps, recorded rather than worked around.** Live API egress is 403 at the proxy,
  so `fixtures/api/**` was never recorded from OpenTopoData or Overpass (P2.4's self-check is
  unmet and marked `[~]`, not ticked). The sensor module's frame conventions are proven as
  *mathematics* but not against physical hardware — a sign error would pass every synthetic
  test — so P8.2's recorded-trace bar stays open. And the photographs' EXIF problem turned out
  not to be a blocker at all: the upload path stripped the GPS IFD, the **camera originals** had
  everything, and asking for them was the whole fix.

The v1 Expo/React Native attempt is retired to
[`archive/v1-expo/`](archive/v1-expo/ARCHIVE-NOTE.md), read-only.

## Where to read further

| Document | Purpose |
|---|---|
| [MISSION.md](MISSION.md) | What we're building, the prime directive, the decision record (D1–D10), what real SRTM data taught us |
| [PLAN.md](PLAN.md) | Every product paired with the executable check that proves it, and each phase's status |
| [TODO.md](TODO.md) | Live checklist: what's done, what's open, what's blocked |
| [docs/FINDINGS.md](docs/FINDINGS.md) | **Index of every confirmed finding**, with stable ids, severity and whether it's fixed |
| [docs/DEPLOY.md](docs/DEPLOY.md) | What a deployment serves, what it costs on the wire, missing-terrain behaviour, licensing |
| [docs/CV-REAL-PHOTO-FINDING.md](docs/CV-REAL-PHOTO-FINDING.md) | The skyline extractor against real photographs: first contact, the confident impostor (CV-10), the sky-roughness cue |
| [docs/NEAR-FIELD.md](docs/NEAR-FIELD.md) | Why a summit can read "may be hidden": terrain a DEM cannot resolve, and the `marginal` verdict (D10) |
| [docs/REAL-PHOTO-POSE.md](docs/REAL-PHOTO-POSE.md) | Solving a photograph's true pose from the picture itself — the yardstick every CV number is measured against |
| [docs/IDAHO-PHOTO-CASES.md](docs/IDAHO-PHOTO-CASES.md) | The two supplied photographs and what is established about each |
| [REVIEW-FINDINGS.md](REVIEW-FINDINGS.md) · [-2](REVIEW-FINDINGS-2.md) · [-3](REVIEW-FINDINGS-3.md) | The three adversarial review gates, in full — indexed by docs/FINDINGS.md |
| [CLAUDE.md](CLAUDE.md) | Working rules for agent sessions |

## Commands

| Command | What it proves |
|---|---|
| `npm run check` | typecheck + lint + full unit suite, offline and deterministic |
| `npm run test:e2e` | Playwright against real Chromium |
| `npm run test:acceptance` | ground-truth cases; a pass means the *yardstick* is sound |
| `npm run demo -- <case>` | runs a real case end to end and writes `out/annotated.png` — the human-viewable proof |
| `npm run build` | typecheck + production bundle |
| `npm run package:deploy` | assembles `dist/terrain/` + `dist/peaks/` — a deployable static directory |
| `npm run test:deploy` | the built bundle behind a plain static server, no Vite: [docs/DEPLOY.md](docs/DEPLOY.md) |
| `npm run fetch:tiles` | acquisition only: pulls SRTM tiles from AWS Open Data |

## The prime directive

**Nothing is done until the agent that built it ran its check and watched it pass.**

v1 died of the opposite: ~2,500 lines of plausible, never-executed code that needed a phone's
camera, GPS, and compass to do anything. v2 is still-photo-first precisely because a photo is a
file, a location is a number, and an annotated image is an artifact you can assert against.

This is not ceremony. Running things has repeatedly overturned what we believed — five times,
in the order they happened:

- The plan's own **occlusion rule was wrong** — it compared peaks against the skyline at all
  distances, but terrain *behind* a peak cannot hide it. Found by the group whose only job was
  independent ground truth.
- **SRTM doesn't just underestimate sharp summits, it displaces them.** The Matterhorn's highest
  posting reads 4230 m (true: 4478 m) and sits ~320 m from the surveyed summit. So peak heights
  come from the peak database; terrain comes from SRTM.
- A **"discovery" of SRTM voids turned out to be a bug in the sampling code** — reading a
  coordinate from the tile one degree south of the one containing it. The correction is recorded
  inline in `MISSION.md` rather than quietly edited away.
- I published **"the extractor scores 0 of 512 columns"** and diagnosed it at length. It was my
  own probe bug: I filtered on `column.confidence` and `column.row` when the fields are
  `confidence01` and `rowNorm`, and `undefined > 0` is `false`, so every column was discarded
  and the extractor was blamed for it. **The second time a confident conclusion came from a
  broken read** — which is the whole reason the retraction stays at the top of
  [that document](docs/CV-REAL-PHOTO-FINDING.md) instead of being edited away.
- **The extracted skyline spans 17.56° where no real skyline from that viewpoint can exceed
  8.63°** (the entire 360° horizon spans 10.97°). That single measurement proved the extractor
  stitches a near foreground ridge to a distant horizon — and it was decisive precisely because
  **span is invariant to the two things we did not know**: an unmodelled pitch shifts the range
  without changing its span, and a wrong focal length scales it near-uniformly. Neither can turn
  8.63° into 17.56°. Sweeping parameters would have taken days and taught nothing.

Every confirmed finding is indexed, with severity and fix status, in
[docs/FINDINGS.md](docs/FINDINGS.md).

## Pipeline

```
photo (JPEG)
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

## Layout

```
src/core/       Pure geometry: geodesy, sightline, horizon, projection, visibility.
                No network, no DOM, no device APIs, no Date.now. Deterministic throughout.
src/providers/  Elevation from local .hgt tiles; HTTP clients demoted to acquisition.
src/exif/       Photo metadata → camera pose, with an explicit manual-override model.
src/cv/         Skyline extraction and alignment (v2.1, built and not wired in).
src/render/     Pure overlay builder: scene in, SVG string out.
src/pipeline/   Orchestration, fully injectable so tests run offline.
fixtures/       Analytic scenes with closed-form answers, real SRTM windows, cited cases.
archive/        Retired v1. Read-only reference.
```

## How the browser gets terrain

The app reads elevation from **static grids on its own origin** — an index at
`/terrain/manifest.json` plus the raw sample files it names
(`src/providers/terrain-manifest.ts`, `src/providers/http-terrain-store.ts`). No live elevation
API is ever called at runtime; `npm run fetch:tiles` remains the only thing that talks to the
outside world. In dev and preview `scripts/terrain-server.ts` publishes that directory out of
what the repository already holds; a production build ships no terrain, because which square
degrees a deployment carries is a deployment decision, and `npm run package:deploy` assembles
the one it does want.

Two rules are load-bearing rather than incidental:

- **Synthetic test tiles are never served.** Invented mountains at real coordinates is the exact
  failure mode this project exists to avoid.
- **Missing terrain is a named absence**, not a blank overlay: the app says which tile is
  missing, what it holds instead, and how to fix it, and draws nothing. An empty overlay would
  read as "no peaks are visible from here", which is a different claim and would be a fabricated
  one.

Sizes, gzip ratios, the per-session cost, the server settings and the attribution obligations
are all in [docs/DEPLOY.md](docs/DEPLOY.md) — measured, not estimated.

## Testing rules

1. **Tests never touch the network.** Only `record:fixtures` and `fetch:tiles` may, and only when run deliberately.
2. **Expectations are derived independently** — from closed-form mathematics or cited references, never by running the code and pasting its output back. This is what caught the effective-Earth-radius error and the occlusion bug.
3. **Ground truth is built by people who don't implement the pipeline**, so the yardstick can't quietly bend to fit it.
4. **Uncertainty is recorded, not resolved by guessing.** Half Dome from Mount Diablo clears its ridge by 0.0043° — about 8 m at 200 km — so it's marked *disputed* and asserted in neither direction.
