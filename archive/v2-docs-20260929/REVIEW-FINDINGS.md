# Adversarial review — Wave 1 gate (2026-08-16)

The review gate `PLAN.md` specifies between waves. Scope: `src/core`, `src/providers`
(minus `peak-store.ts`), `src/exif`, `fixtures/scenes`. `src/render` and `src/pipeline`
were mid-build and excluded.

Every finding below was **reproduced with a failing test against real code** before being
reported. Undemonstrated suspicions are listed separately and explicitly labelled.

## Confirmed findings

### 1. HIGH — a zero-distance ray sample turns a whole bearing into a +90° wall
`src/core/sightline.ts` · `altitudeAngleDeg` is `atan2(rise, distanceM)`. At `distanceM === 0`
that returns **+90°** for any sample above the eye. `sweepRay` has no guard, so it becomes the
running maximum and `buildHorizonProfile` writes it as both the skyline and the innermost
`skylineStep`. **Every peak on that bearing is then occluded by the ground under the
observer's own feet** — silently, with no error.

The trigger is mundane, not exotic: eye elevation is `groundElevationM + eyeHeightM`, where
`groundElevationM` comes from EXIF GPS altitude, which `src/exif/resolve.ts` itself documents
as "routinely tens of metres wrong". A 10 m disagreement suffices. And
`fixtures/scenes/scene.ts:generateRadialSamples` emits a range-0 sample as `samples[0]`, so a
pipeline built from the fixtures is *likely* to feed one.

| | skyline | Matterhorn clearance | verdict |
|---|---|---|---|
| with the range-0 self-sample | `+90°` | `−81.9°` | **hidden** ✗ |
| without it | `8.0839°` | `+9.3799°` | visible ✓ |

`sweepRay` already validates that samples are ordered near→far and *throws* if not, so it is
in the business of rejecting bad input — it just accepts `distanceM === 0` silently.

### 2. MEDIUM-HIGH — `conical-peak.ts` ground truth still encodes the superseded occlusion rule
`fixtures/scenes/conical-peak.ts` states an occluding angle of `8.479576` with
`clearanceDeg = 0` — the apex measured against *itself*, which is the pre-P1.5 "compare against
the skyline" rule. `twin-ridges.ts` was migrated when P1.5 was fixed; the cone was missed.
(At review time the field was named `skylineAltitudeDeg`; see "Decision taken".)

Under the corrected nearer-terrain rule the apex's occluder is the cone's own flank at 9750 m:

```
fixture                  8.479576   clearance 0.000000
pipeline                 7.978309   clearance 0.502983
independent closed form  7.976826
```

**Off by 0.503° — 50× the scene's own declared `toleranceDeg` of 0.01.** The pipeline agrees
with the independent closed form; the fixture is wrong. It passes today only because the
self-consistency check is `visible === (clearance >= 0)` and `0 >= 0` holds.

`MISSION.md` names this cone as the flagship yardstick, so this is the assertion Wave 2 hits
first — and the danger is that it gets "fixed" in `src/core`, re-introducing the P1.5 bug.

### 3. MEDIUM-LOW — profile merge discards a real occluder
`src/core/horizon.ts` · `normaliseHorizonProfile` keeps the higher-`altitudeDeg` point when two
share a bearing and discards the other **including its `skylineSteps`**. Correct for drawing a
skyline; unsound for occlusion, which needs the union of the staircases. Demonstrated: a peak
behind a near wall reads occluder `−1°` instead of `+4°` and gets **labelled** when it should be
hidden by 3°.

*Honest caveat from the reviewer:* not reachable through `buildHorizonProfile` alone — it bites
a caller that hand-merges or stitches profiles. `normaliseHorizonProfile` is exported.

### 4. LOW-MEDIUM — an out-of-range user override is silently replaced by EXIF
`src/exif/resolve.ts` · `inRange` returns `undefined` for an out-of-range value and `merge`
falls through to the EXIF layer, recording nothing. A user typing `475` for latitude (a
plausible fat-finger for `47.5`) gets a `complete: true` pose at the EXIF coordinate **165 km
away**, marked `source: 'exif'`.

This one matters disproportionately because *not inventing values* is the app's entire premise.

### 5. LOW — antimeridian read hole at longitude exactly 180
`tile-store.ts:normaliseLon` folds onto `[−180, 180)` and correctly names `W180`, but
`HgtTile.contains` compares raw `+180` against `westLon = −180 … eastLon = −179` and reports
`outside`. The provider names the right tile, has it loaded, and returns no data.
`src/core/geodesy.ts` folds onto `(−180, +180]` — **the two modules use opposite seam
conventions**, and `destinationPoint` can emit exactly `+180`. Ranked low because the result is
an honest `null`, not a wrong number.

## Clean bills of health (checked, found sound)

Recorded because "we looked hard and it holds" is real information:

- **Angle wrap** — 20 000 fuzzed inputs; `interpolateHorizonAltitudeDeg` matched an
  independently written wrap-aware brute-force bracketer on 400 profiles × 50 bearings to
  < 1e-9, exact at sample points to 1e-12.
- **Hemisphere / antimeridian / pole tile naming** — 16-case truth table, name→corner→name
  round-trips across all quadrants, 21 tiles across the antimeridian. `floor` vs `trunc`
  correct everywhere; `Math.floor(-0)` yields `N00`, not `S00`. (Except finding 5.)
- **Grid indexing / bilinear** — closed form reproduced to < 1e-6 m at 1681 interior points
  plus corners and edge midpoints. Row 0 = north confirmed against stored bytes.
- **No-data handling** — `−32768` never coerced to a number anywhere; **no** place defaults to
  `0` where 0 is a meaningful elevation; `toElevationSamples` forces an explicit policy.
- **Sign and unit confusion** — `elevationM`/`altitudeDeg` never cross; every producer and
  consumer traced. `vFov` divides *tangents*, not angles, in both implementations.
- **Projection** — 5000 random poses round-tripped through an independently written inverse,
  recovering bearing and altitude to < 1e-8°.
- **Geodesy** — round-trips < 1e-3 m and < 1e-6° including ±89.5° latitude and the antimeridian.
- **End-to-end vs ground truth** — `src/core` reproduces all four analytic scenes: 10/10 skyline
  expectations inside 0.01°, 5/5 peak verdicts correct, including the twin-ridges variant-A case
  the P1.5 fix exists for.
- **Tests are not circular** — spot-checked for expectations produced by the code under test;
  found none.

## Unverified suspicions (hypotheses, not findings)

1. ~~Partial-coverage profiles may bridge a data gap linearly~~ — **CONFIRMED and fixed,
   2026-08-16. Promoted to finding 6 below.**
2. ~~`method: 'nearest-valid'` is reported for readings that are exactly bilinear but merely
   have a void *neighbour*~~ — **CONFIRMED and fixed, 2026-08-16. Promoted to finding 7 below,
   where it turned out to be a value error as well as a reporting one.**
3. ~~`resolvePose` accepts a negative `eyeHeightM`~~ — **found real and fixed** (Q2 item 4:
   `eyeHeightM ≥ 0` is now a range check, and an out-of-range override surfaces as
   `needs-manual` / `'out-of-range'` rather than being replaced by EXIF).

**All three suspicions from the first review are now closed.**

## Confirmed findings, part 2 (after the pipeline existed)

### 6. HIGH — a bearing with no terrain data got a confident, fabricated verdict
*Suspicion 1, promoted. The reviewer could not demonstrate it because the pipeline did not yet
exist to say what happened to a dropped ray. It does now, and it is real.*

`buildTerrainRays` drops a ray that returned no elevation at all, `buildHorizonProfile` emits no
point for it, and `bracketAtBearing` then treats the two lips of the hole as **neighbouring
samples** and interpolates straight across. Nothing downstream could tell that apart from
ordinary interpolation between two adjacent rays.

Demonstrated end to end on the ring-ridge pipeline scene with the tiles between bearings 100°
and 140° never fetched — 39 of 360 rays dropped, a 40°-wide hole — and one peak at bearing 120°,
20 km out, 1500 m up, dead centre of it. The wedge contains **not one terrain sample**:

| terrain outside the wedge | horizon "at" 120° | verdict on the peak |
|---|---|---|
| 900 m ring ridge at 5 km | `+9.0712°` | **foreground-occluded**, clearance −5.14°, "behind 900 m at 5 km" — read off the ray at bearing **100°** |
| flat sea level | `−0.3083°` | **visible**, clearance +4.30°, **labelled** |

Same hole, same peak, same absence of evidence; the verdict flips with terrain 20° away on the
far side of the hole. Both answers are inventions, and the second one puts a label on a mountain
that a 3000 m wall in the unmeasured wedge could be hiding entirely. The pipeline's own warning
said the quiet part out loud — *"the profile is interpolated across them"* — and then went ahead
and judged peaks against it.

**Fix.** A profile is a list of successes and cannot tell a hole from its own edge, so the
missing fact is supplied by the caller: `horizonCoverage(profile, sweptBearingsDeg)` records
which bearings the sweep asked about and lost, and `hasTerrainAtBearing` refuses any bearing
whose bracketing pair has a lost ray between them (`src/core/horizon.ts`, still pure).
`annotateScene` consults it before judging, and a peak on such a bearing is **not judged at
all**: it goes to `AnnotatedScene.unmeasured` — sighted (bearing, range and angle are geometry,
and still true) but with no visible/hidden claim attached — plus a warning that names it. That
is the same refusal `classifyOcclusion` already makes along a ray when the record has a hole in
it wide enough to hide a col, applied across bearings instead of along one.

**A hole is not an edge.** The un-swept remainder of a bounded sweep is untouched: a 60° sector
that walked all sixty of its rays lost nothing, bearing 200° was never asked about, and its
peaks keep the verdicts they had. The two cases are separated exactly rather than
heuristically — a hole contains a bearing the sweep asked about and lost; an edge does not — so
no threshold, gap-width factor or "largest gap" guess is involved, and a sector sweep can still
have a hole found inside it. All 148 acceptance assertions and every ground-truth verdict are
unchanged: none of the four real cases loses a ray.

*Residual, out of scope here and worth a decision:* a peak OUTSIDE a bounded sweep still gets a
verdict interpolated across the un-swept complement, which is a different fabrication with a
different answer (sweep it, or refuse it, or rely on it being off-frame). And `src/cv/rays.ts`
grew its own `profileCoverage` for the aligner — a largest-gap-vs-median heuristic over the
profile alone, which cannot see a hole and a sector edge at the same time. The two notions of
coverage should be reconciled on the exact one.

### 7. MEDIUM — a void that carried no weight was reported as if it had, and cost 50 m
*Suspicion 2, promoted. Real, and one step worse than recorded: it is not only a false report
about data quality, it is a needless 50 m value error on the same readings.*

`HgtTile.bilinear` (`src/providers/hgt-tile.ts`) tracked `voidSeen` as a boolean over the four
corners of the cell, without looking at the **weight** each corner carried. A query that lands
on a grid line gives the corners off that line a weight of exactly zero, so their contents
cannot reach the answer — but a void among them still flipped `voidSeen`, and the whole reading
was demoted.

Demonstrated on a hand-built 3 × 3 tile at 0.5° spacing with a single void at its centre:

```
         lon 0   lon 0.5   lon 1
 lat 1    100      200      300
 lat 0.5  400     VOID      600
 lat 0    700      800      900
```

| query | void's bilinear weight | true value | was, `nearest-valid` | was, `no-data` | now |
|---|---|---|---|---|---|
| lat 1, lon 0.5 — **exactly on** the 200 m sample, void due south | 0 | 200 | 200 m, `nearest-valid` | **`void`, null** | 200 m, `bilinear` |
| lat 1, lon 0.75 — mid the north edge, void off the edge | 0 | **250** | **200 m**, `nearest-valid` | **`void`, null** | 250 m, `bilinear` |
| `N10W010` fixture (7,9), the valid row just north of the 3 × 3 void block | 2.8e-14 | 500 | 500 m, `nearest-valid` | **`void`, null** | 499.9999999999858 m, `bilinear` |
| lat 0.99995, lon 0.5 — a hair *off* the line | 1e-4 | 200 ± 0.3 | 200 m, `nearest-valid` | `void`, null | **unchanged** |

Row 2 is the sharp one. Along that edge two valid corners carry the entire weight and the exact
answer is `0.5·200 + 0.5·300 = 250`; the code computed 250 into `sum`, then **threw it away**
and returned the nearest corner's 200 instead. 50 m of avoidable elevation error, on a reading
whose value never depended on the void at all. Row 1 is the suspicion as written, and row 3
shows it reaching a committed fixture through real grid geometry.

Under `'no-data'` every one of the first three rows was a correct measurement reported as no
data — the worse failure, because a caller who chose the strict policy chose it to be told the
truth about coverage, and was instead told the terrain was unmeasured where it was measured.

**Fix.** Sum the weights of the void corners instead of setting a flag. If that total is
negligible the reading is exactly the interpolation over the corners that do carry the weight,
and is reported as `'bilinear'` under **both** policies; above it, the existing `'nearest-valid'`
fallback and the existing strict refusal are untouched (row 4). Void policy semantics are
unchanged: voids are still `null`, still never averaged in, and the fallback still fires the
moment a void can move the answer.

**Why a bound and not `weight === 0`.** Sample lines sit at multiples of 1/3600°, which is not
representable in binary — the module already says so, which is why there is no `'exact'` method
— so a query aimed at row 2 of an SRTM1 grid divides back to `2.0000000000067` and the "zero"
weights come out near 1e-12, as row 3 shows. The test is therefore on the reading's **error**,
not on the weight: omitting a corner of weight `w` moves the answer by `w × (its true
elevation)`, unknown but bounded by the format's own extreme ±32767 m. `NEGLIGIBLE_VOID_WEIGHT`
= 1 mm / 32767 m ≈ 3.05e-8 makes the claim "this is bilinear" mean "within a millimetre of full
bilinear, whatever the radar failed to see there" — six orders of magnitude inside SRTM's own
±10 m. Everything above it still degrades, including weights far too small to matter physically.

**Blast radius today is the defensive path only.** The AWS mirror this project fetches from has
0 voids in 51 868 804 samples (MISSION.md), so no shipped reading changes; `check` and
`test:acceptance` are unchanged. It matters for USGS SRTMGL1 v2 and any other void-carrying
distribution, and it is exactly the kind of over-report that a downstream coverage filter — the
one finding 6 just built — would act on.

*Residual, deliberately not changed here:* the fallback is discontinuous at a grid line. On the
north edge above, the reading is 250 m ON the line and 200 m a hair off it, because
`'nearest-valid'` returns a corner rather than re-normalising the valid weights. That is the
documented policy ("displaced by at most one sample spacing"), it is flagged to the caller, and
changing it would mean inventing a value for the void — a change of policy, not of reporting.
Worth a decision on its own.

## Decision taken

The reviewer asked whether to rename `skylineAltitudeDeg` → `occludingAltitudeDeg` before Wave 2
wires the hooks, or merely correct the cone's numbers.

**Decision: rename.** Findings 2 and 3 both stem from one field carrying two meanings across two
files after the P1.5 migration. A rename converts that silent semantic drift into a compile
error at every use site, which is exactly what we want and is cheap now and expensive later.

**Carried out, 2026-08-16.** The numbers were corrected first (TODO.md Q2); the rename followed
once it no longer collided with a live agent's surface:

- `ExpectedPeakVerdict.skylineAltitudeDeg` → **`occludingAltitudeDeg`** (`fixtures/scenes/`).
- `VisiblePeak.horizonAltitudeDeg` → **`occludingAltitudeDeg`** (`src/core/types.ts`). Included
  deliberately, though it widened the diff: it is the same field one layer down, and its doc
  comment already spent a paragraph insisting it was *not* the skyline angle. A name that has to
  be defended in prose is the exact condition that let finding 2 happen. The paragraph is gone.
- Nothing that genuinely means *skyline* was touched: `HorizonPoint.altitudeDeg`,
  `HorizonPoint.skylineSteps`, `ExpectedSkylinePoint`, `interpolateHorizonAltitudeDeg` and
  twin-ridges.ts's local `skylineAltitudeDeg` (which feeds `expectedSkyline`) are all maxima
  over *all* distances and keep their names. Renaming those would be the mirror image of the
  bug being fixed.

`tsc` located all 39 call sites; no expected value changed anywhere, and `check` (38 files /
746 tests), `test:acceptance` (148) and Playwright (13) are unchanged and green.
