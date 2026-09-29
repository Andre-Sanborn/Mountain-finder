# fixtures/

Recorded API responses, synthetic scenes, and ground-truth photo cases.

This directory is the project's **yardstick**. Everything in `scenes/` exists to
measure `src/core` against answers that were worked out independently of it. The
one rule that makes it worth anything:

> **No expectation in this directory was ever produced by running pipeline
> code.** Every number is either derived in closed form with the arithmetic
> written out in the module, or taken from a cited external source.

If that rule is ever broken, the tests still pass and stop meaning anything.

## Layout

| Path | Owner | Contents |
|---|---|---|
| `scenes/` | group F | Synthetic analytic terrains with closed-form expected skylines ([archive PLAN.md](../archive/v2-docs-20260929/PLAN.md) P6.1) |
| `api/` | group B | Recorded OpenTopoData / Overpass responses, replayed by `FixtureTransport` |
| `photos/` | groups C / F | Small EXIF fixture images. Large binaries are **not** committed |
| `../tests/acceptance/cases/` | group F | Real-world ground-truth viewpoints ([archive PLAN.md](../archive/v2-docs-20260929/PLAN.md) P6.2) — text only |

The real-world cases live under `tests/acceptance/cases/` rather than here
because they are consumed exclusively by the acceptance suite and are pure
TypeScript data with no binary payload.

## `scenes/` — synthetic analytic terrain

Four scenes, each a module exporting **(a)** a generator that produces
`ElevationSample[]` and **(b)** the analytically-derived expected results, with
the derivation written out as actual mathematics in the module header.

| Scene | What it pins down | Headline expectation |
|---|---|---|
| `flat-plane.ts` | Curvature + refraction, in isolation | Horizon dip **−0.299427°** at **38.27 km**, identical at every bearing |
| `twin-ridges.ts` (variant A) | A far, higher ridge that *wins* the skyline | Far ridge **+5.349°** beats near ridge **+4.554°** |
| `twin-ridges.ts` (variant B) | A far, higher ridge that is *occluded* | Far crest is **1 100 m higher** yet falls **0.34° short** and is hidden |
| `conical-peak.ts` | The canonical analytic mountain | Apex **+8.481°** at 10 km; bare plain **−0.042°** in the same scene |

`scene-geometry.ts` holds the independent geometry kit — haversine, spherical
destination point, initial bearing, and two different apparent-altitude
formulations. It deliberately duplicates part of `src/core`; see the file header
for why that duplication is the point rather than an oversight.

### The Earth model these expectations assume

Every scene states this explicitly in its own header, and the constant is
**derived symbolically, never pasted in as a decimal**:

```
R      = 6 371 008.8 m      IUGG mean radius R₁
k      = 0.13               refraction coefficient, fixed by the archived PLAN.md P1.2
R_eff  = R / (1 − k)  =  6 371 008.8 / 0.87  =  7 322 998.6207 m
```

If `src/core` ever adopts a different `R` or `k`, these numbers move, and the
headers are where a reviewer finds that out instead of guessing.

### Why every expectation is computed twice

Each scene reports its skyline angle under two derivations that share no
algebra:

* **exact spherical** — `atan2(r₂cos γ − r₁, r₂ sin γ)`, no small-angle step;
* **curvature drop** — `atan((E − H_o − d²/2R_eff)/d)`, the surveying form.

Across all four scenes they agree to better than **0.002°**, five times inside
the archived PLAN.md's 0.01° tolerance. So no expectation here is an artefact of one
modelling choice, and `src/core` is free to pick either convention.

Separately, the acceptance suite checks the module's closed forms against
literals typed out from **longhand arithmetic** in the module headers (atan
series expansions, done by hand), and against **brute-force scans** of the
generated terrain. Three routes, one answer.

### A limitation this directory refuses to paper over

In twin-ridges variant A the near crest sits *below* the skyline but is still
physically in plain sight — it is in front of the far ridge. The archived PLAN.md P1.5's
simplified rule ("visible iff it clears the skyline at its bearing") would call
it hidden. That case is therefore recorded as an acknowledged limitation and
**no verdict is asserted for it**. Ground truth must not quietly bless a known
simplification. See the header of `scenes/twin-ridges.ts`.

## Real-world ground-truth cases

Four viewpoints, in `tests/acceptance/cases/`, chosen so that between them they
stress different parts of the pipeline:

| Case | Stresses | Must see | Must NOT see |
|---|---|---|---|
| `gornergrat` | Geodesy and sign conventions (5–10 km, +8…+11°) | Matterhorn, Dufourspitze, Breithorn | — (none claimed; see below) |
| `mount-diablo-summit` | Curvature and `k` — every angle is **negative** | Mount Hamilton, Mount Saint Helena, Mount Tamalpais, Lassen Peak | — (Half Dome is *disputed*) |
| `kerry-park-seattle` | Near-field occlusion, ~6° margin | Mount Rainier | **Mount Baker** (behind Queen Anne Hill) |
| `fort-william` | Near-field occlusion, ~1° margin | Cow Hill | **Ben Nevis** (behind Cow Hill's shoulder) |

Every coordinate, elevation and visibility claim carries a `Source` with a URL
and a retrieval date. The schema in `cases/case-types.ts` enforces this: the
acceptance suite fails if any `positionSourceId` does not resolve.

### Confidence, and things left out on purpose

Each expectation carries `confidence: 'high' | 'medium'`.

* **high** — intended as a hard gate.
* **medium** — worth testing, but a failure means *investigate the ground
  truth*, not *the code is wrong*. Lassen Peak (292 km, refraction-sensitive)
  and Ben Nevis (blocker height unsourced) are the two.

Claims that could not be settled go in `disputed[]` and are **never asserted**.
The best example is Half Dome from Mount Diablo: Wikipedia says an 8 000 ft
ridge hides it, California State Parks invites you to look for it with
binoculars, and the arithmetic shows why both can be written in good faith — the
margin is **0.0043°**, about 8 m of ridge height at 200 km. No honest assertion
is available at that margin, so none is made.

Likewise, Gornergrat claims **no** must-not-see peak. The panorama is famous for
being unobstructed; nominating a hidden peak there would have been a guess, and
a guess in the must-not-see list teaches the pipeline to be wrong.

### Research limitations in this environment

The build sandbox's egress proxy returns 403 for `en.wikipedia.org`,
`commons.wikimedia.org`, `parks.ca.gov`, `seattle.gov` and most other reference
hosts, and for the live data APIs (`api.opentopodata.org`, `overpass-api.de`).
Sources were therefore read through the **web-search index** rather than fetched
directly. Each `Source` records which, via its `access` field
(`'fetched' | 'via-search-index'`), and every case repeats it in `caveats`.

Practical consequences, stated plainly:

* No coordinate here was invented. Anything that could not be sourced was left
  out — the Liskamm is missing from Gornergrat for exactly this reason, despite
  certainly being visible.
* Photograph licences could not be confirmed on their file pages. Only the
  Gornergrat 360° panorama has a licence recorded (CC BY-SA 3.0, H. Zell), and
  even that is marked for re-confirmation. Every other photo entry says so.
* **No images are committed.** URLs and licences are the deliverable.
* Coordinates should be re-verified against the live pages before any of these
  cases gates a release.

## Running the checks

```
npm run test:acceptance     # everything in this directory, plus the case files
```

The suite exits green today **without pretending to test the pipeline**. It
prints a summary separating what was genuinely asserted from what is waiting on
Waves 2–3, and the pipeline assertions themselves are `it.todo` entries in
`tests/acceptance/pipeline-hooks.test.ts` — visible in the run output, counted
apart from passes, and impossible to mistake for coverage. That file also
documents how to switch each hook on.
