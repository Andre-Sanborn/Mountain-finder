# Adversarial review — Wave 2 gate (2026-08-16)

Covers what the first review could not: `src/pipeline`, `src/app`, `src/core/visibility.ts`
(the D8 classifier), `src/exif`, and `tests/acceptance`. Excluded: `src/providers`,
`src/core/horizon.ts`, `src/render`, `src/cv` — all moving under live agents.

Every finding was reproduced with a failing test against real code and re-run against the
end-of-session tree.

## 1. HIGH — D8 uses the *first* blocker as the crest, so a peak across a 400 m col is labelled

`src/core/visibility.ts` (crest search, col measurement). The crest is the **first** nearer
sample beating the summit's angle; `colDepthM` is measured from *that*. When something taller
stands behind it, the col that actually separates the two mountains is measured against the
wrong, lower reference and comes out **0**.

Ordinary terrain triggers it — a low bank, then a foreslope that never dips:

| distance | elevation | role |
|---|---|---|
| 0.95–1.15 km | 150 m | low bank — the *first* blocker, 2.887° |
| 1.15–14.5 km | 150→749 m | foreslope, never dips |
| 14.5–15.5 km | **900 m** | **a different mountain — the actual skyline, 3.084°** |
| 15.5–19.8 km | 500 m | **a 400 m col** |
| 20 km | 1000 m | the target summit, 2.499° |

```
classifyOcclusion -> self-occluded / unbroken-rise-to-summit
  crest 150 m at 0.99 km, colDepthM 0
scene.labelled -> [Mount Ghost]      warnings -> []
```

The greyed label is planted **below the skyline**, on the face of the 900 m mountain, 5 km
short of the summit it names — precisely the outcome D8 exists to prevent.

The docstring defends first-blocker selection as "a stronger test over a longer span". That is
backwards for the failure mode that matters: **the lower the crest, the lower the bar the
intervening ground must clear to count as "no col"**, so first-blocker selection *maximises*
false self-occlusion, which is the labelling direction. Measuring from the highest nearer
sample — the one that actually forms the skyline — gives `colDepthM = 400` and the correct
`foreground-occluded`.

## 2. HIGH — peaks beyond the swept range are declared visible on no evidence

`DEFAULT_PEAK_RADIUS_KM = 200` against `DEFAULT_SWEEP.maxRangeKm = 30`; same asymmetry in the
app (`APP_SWEEP` 30 km / `APP_PEAK_RADIUS_KM` 200). Terrain past the sweep is never sampled, so
nothing nearer blocks and the peak clears comfortably. **No warning, no note.**

```
sweep reached 30 km, peak radius 200 km
1500 m wall at 45 km, 2000 m summit at 60 km
  -> Mount Behind: VISIBLE, clearance 1.8494 deg
  hand-computed: the wall hides it by 0.0268 deg
scene.warnings: []
```

Every peak between 30 km and 200 km — Rainier, Baker, Hood, Lassen, the entire long-range case
for the product — is judged on **≤15 % of its sightline** with no note. The pipeline is
inconsistent with itself: `classifyOcclusion` refuses on an unsampled gap, `hasTerrainAtBearing`
now refuses across a bearing hole, but a sightline examined for 30 of 60 km yields a confident
`visible`. The acceptance suite *knows* this and prints it ("a 'visible' verdict here means
nothing within 3 km hides it"); the product code has no equivalent.

## 3. MEDIUM-HIGH — portrait photos apply the 35 mm FOV to the wrong axis; `Orientation` is never read

`hFov = 2·atan(36/(2·f35))` is the angle across the **long** side of the 35 mm gate. The code
attributes it to image *width* unconditionally — correct only in landscape.

```
dead-sea fixture 600x800, f35 = 50
  extracted  hFov 39.5978   correct  hFov 30.2192
  a summit 15 deg off-axis: drawn at x=0.8722, belongs at x=0.9962 — 12.4% of frame width

iPhone case, Orientation 6, displayed 3024x4032, f35 = 26
  app hFov 69.3903 (badged EXIF)   correct 54.8795
```

Both wrong values carry the **`EXIF` provenance badge** — a number derived from a wrong model
presented as read from the photo, which is the app's one promise. `grep -rn "rientation" src/`
finds nothing: EXIF Orientation is read nowhere and every authored fixture pins `Orientation=1`,
so no test can see it. Worse, `extract.test.ts` **pins the bug** with a hand-derived expectation
that encodes the wrong model — rigorous-looking and wrong, the exact class the brief asked for.

## Mutation testing — are the gates real?

Twelve mutations in a sandboxed copy. **This is the most valuable part of the review.**

| mutation | unit | acceptance |
|---|---|---|
| M2 revert P1.5 (occlude against full skyline) | 7 failed | 2 failed ✅ |
| M3 `isPeakVisible` always true | 15 failed | 5 failed ✅ |
| M6 curvature + refraction removed | 34 failed | 13 failed ✅ |
| M12 sweeps truncated to 1/10 range | 8 failed | 12 failed ✅ |
| **M1 `classifyOcclusion` always self-occluded** | pass ✗ | **1 failed** |
| **M5 no-data coerced to 0 m** | 4 failed | **0 failed ✗** |
| **M8 projection made angle-linear in x** | 10 failed | **0 failed ✗** |
| M9/M10/M11 app rules (switch, precedence, trim) | 1–7 failed | 0 failed |

- **Core visibility gates are strong** — M2, M3, M6, M12 all caught hard by ground-truth cases.
- **D8 rests on a single assertion.** M1 survives every high-confidence must-NOT-see gate and is
  caught by exactly one test (`Ben Nevis is foreground-occluded`). Delete that one test and D8
  has no gate at all.
- **There is one `confidence: high` must-NOT-see claim in the entire suite** (Mount Baker), and
  it passes via the classifier's *coverage refusal* — the fixture window stopping at 3 km — not
  via a measurement. Ben Nevis, the case with a fully-covered blocking ridge, is only `medium`.
- **Zero horizontal-placement coverage.** M8 breaks the x projection entirely and all 148 pass.
  The only pixel assertion points the camera *at* the peak (Δ=0), invariant to hFOV and to the
  whole x formula. **Finding 3 is an hFOV error no acceptance gate could ever see.**

## Clean bills of health

`resolveObserver` precedence and its honest throw · Wave-1 finding 4 genuinely fixed (re-attacked
lat=475, hFov=200, negative eye height) · the magnetic/true rule holds, no path found where a
magnetic bearing reaches `CameraPose` as true · invalid override text surfaced with `aria-invalid`,
European comma handled · trim wraps/clamps and re-derives vFov through the tangent ratio · state
reset on photo load, `draft-reverted` deletes rather than blanks · `selectOverlayPeaks` cannot leak
a foreground-occluded peak by any flag · `peakNames` read off `layout.markers` so a dropped peak is
never announced as labelled · `sweepForPose` sector width bounds the worst-case in-frame bearing ·
bearing wrap seam-correct including a sector wrapping north · `no-terrain` refusal fires before
anything is judged.

## Unverified suspicions

1. `groundElevationM` is not finiteness-checked; NaN would give a silently empty overlay rather
   than a crash. No caller found that can produce it — latent, not live.
2. `buildNotes` counts foreground-occluded over *all* peaks including those behind the camera —
   wrong prose, not a wrong label.
3. Export can race the pose: clicking Export while a rebuild is in flight writes a PNG whose
   labels belong to the previous pose. Millisecond-wide, not demonstrated.

## Fix order

1. **Finding 1** — measure col continuity from the skyline-forming nearer sample. A few lines,
   and the difference between D8 being a rule and a coin flip on ordinary terrain.
2. **Finding 2** — give the range axis the refusal the bearing axis just got.
3. **Finding 3** — read `Orientation`, attribute the 36 mm angle to the longer displayed axis,
   add a portrait fixture with `Orientation=6`, and fix the test that pins the bug.
4. **Gates** — promote Ben Nevis to `high` (its blocking ridge is inside the committed window),
   and add one acceptance assertion at Δ≠0 so horizontal placement is gated at all.
