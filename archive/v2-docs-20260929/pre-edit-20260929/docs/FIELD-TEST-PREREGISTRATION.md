# The field test: error budget and pre-registered pass criteria

**Written 2026-09-29, before any field number exists.** Nothing in this document was
derived from a field measurement, because there are none. Every figure is either
arithmetic from a term this repository has already measured, or a stated assumption with
its sensitivity attached.

Its purpose is narrow. `AGENTS.md` § Evidence requires the claim, the tolerance and the
reference to be fixed before the number exists, and
[IMPLEMENTATION.md](../IMPLEMENTATION.md) § "The route to the field test" promises pass
criteria that are "measurements with a budget, not guessed thresholds". This is that
budget, and the six criteria it settles.

**A threshold in this document is never widened to make a run pass.** If a criterion
fails, what changes is the budget: the residuals are decomposed against the terms below,
the term that was wrong is corrected with its evidence, and the next run is graded against
the corrected figure. A run graded against a threshold loosened after the fact is a failed
run with a revised budget, and this paragraph is here so that nobody can later present it
as a pass.

---

## Part 1 — The error budget

### 1.1 What the budget is a budget for

The product claims a **direction**, not an identification (decision D9,
`src/app/uncertainty.ts`). The user drags the overlay until it lines up with what they can
see, and the drag applies one global heading trim and one global pitch trim
(`dragToTrimDeg`). So there are two quantities, and they need separate budgets:

- **Raw error** — how far the labels sit from the summits before the drag. This is
  dominated by the compass, and this repository has no distribution for it. It is recorded
  as a measurement and gated only on falling inside the band the app displays (F2).
- **Residual after one drag** — how far the labels still sit from the summits once the
  user has aligned the overlay on one summit. This is what the budget below computes, and
  it is what F3 and F4 gate on.

The distinction is the whole reason a drag is worth having. A drag removes every
**common-mode** term exactly: a compass bias, a declination error, an assumed pitch, a
heading-filter lag. It removes none of the **differential** terms: a per-summit position
error, a per-summit height error, a field-of-view scale error, a roll error. The budget
below is a budget of the differential terms, plus the precision of the drag itself.

One structural consequence, stated before the numbers because it decides how they combine.
The drag is anchored on one summit — the one the user is most confident of — so the error
that summit carries is subtracted from every other summit. The residual for summit *i*
anchored on summit *a* is therefore `(e_i − e_a) + (drag precision)`, and the anchor's own
error enters every row of the table. **The protocol fixes the anchor rule**: the drag is
anchored on the most prominent summit the user can positively identify, and the bundle
records which one (`dragAnchorSummitId`). The table below charges the anchor at the 7–20 km
band, because that is where a prominent, positively identifiable summit sits at the
proposed site.

### 1.2 The frame the budget is computed on

| Quantity | Value | Where it comes from |
|---|---|---|
| Phone | iPhone 17 Pro Max | the EXIF of six of the nine real fixtures, per IMPLEMENTATION.md |
| Landscape CSS viewport | 956 × 440 px | 440 × 956 pt at the 6.9 in size, landscape, Safari chrome deducted |
| Device pixel ratio | 3 | so one CSS px is three device px, and touch precision is in CSS px |
| Screen density | 460 ppi | 1 mm of glass = 6.037 CSS px |
| Lens | 24 mm-equivalent (main) | the field default; `chooseRearCamera` opens the single-lens "Back Camera" |
| hFOV | 73.74° | `fovDegFromFocalLength35mm`, 36 mm gate to the long displayed axis |
| vFOV | 38.088° | `otherAxisFovDeg` at 956 × 440 |
| Focal length in pixels | 637.33 CSS px | (956/2) / tan(73.74°/2) |
| Scale at frame centre | **11.1235 CSS px per degree** | `pixelsPerDegreeAtCentre`; 1 px = 0.0899° |

The hFOV is the **uncalibrated spec-sheet figure**, used here because it is what the
geometry of the budget needs. A browser video stream is a crop at a resolution Safari
picks, so the real figure is measured in the field before anything else
(IMPLEMENTATION.md § "The field of view the overlay uses is measured, not looked up"). See
term 6: the calibration is a precondition of F3, not an input to it.

### 1.3 The terms

Angles from metres use the small-angle relation `Δθ = (Δ / D) × 57.2958°`, exact to better
than 0.01 % at every distance in the table. All figures are 1σ unless stated.

#### Term 1 — Peak horizontal position: 20 m

Two measured sources, both in this repository:

- **Overture cross-release drift** (IMPLEMENTATION.md § "Field-site packages"). Between
  releases `2026-06-17.0` and `2026-09-23.1`, 120 summits share a GERS id in the overlap
  around the proposed site. Four moved by more than a metre: Lightning Creek Rocks 198.3 m,
  Cougar Mountain 48.1 m, Shafer Butte 6.2 m, Jackson Peak 4.0 m. The remaining 116 moved
  under a metre. RMS over all 120, charging the unmoved ones 0.5 m:
  `sqrt((198.3² + 48.1² + 6.2² + 4.0² + 116 × 0.5²) / 120) = 18.6 m`. Median under 1 m.
- **OSM node placement against a surveyed summit.** The repository holds one pathological
  case: Mount Tamalpais East Peak's two coordinates are **1 754 m apart**. That summit is
  excluded from every assertion by name, and the exclusion is a rule rather than a
  rounding: a summit with two irreconcilable positions is not graded. Eleven same-name
  pairs within 300 m exist across all 9 237 imported summits, and 275 of Zermatt's 1 786
  summits have a differently-named neighbour within 300 m, so a **name** can be ambiguous
  where a position is not. Truth annotation resolves a summit by id, never by name.

**20 m is the figure used**, the cross-release RMS rounded up. It measures *repeatability*
between two OSM snapshots, which is a lower bound on accuracy against a survey, and the
budget says so rather than pretending otherwise. The 198 m outlier is one summit in 120;
a summit whose after-drag residual exceeds its band is checked against the cross-release
diff before the budget is blamed.

#### Term 2 — Summit elevation: 5.5 m

Heights are OpenStreetMap `ele` tags carried through Overture unchanged, never DEM samples.
Measured against 15 independently cited heights (IMPLEMENTATION.md § "Conflicts are
reported, not resolved"): 13 agree exactly or within 2 m, Mount Hamilton is −21 m out, and
one is ambiguous. RMS charging the 13 at 1 m:
`sqrt((21² + 13 × 1² + 2²) / 15) = 5.5 m`, n = 15.

#### Term 3a — Observer horizontal position: 15 m

The repository's one direct comparison: at the Railroad Ridge viewpoint the photographer's
hand-read coordinate and the phone's GPS fix differ by **14.3 m**
([docs/NEAR-FIELD.md](NEAR-FIELD.md)), n = 1. Rounded to 15 m.

This is the weakest-sourced term in the budget, and there is a better instrument available
for free: the W3C Geolocation API's `GeolocationCoordinates.accuracy` is the fix's own 95 %
horizontal radius, and the phone reports it at every fix. **The protocol records it**, as a
number only, so the next revision of this budget replaces 15 m with the session's own
figure. A reported accuracy worse than 30 m fails the fix and the session re-acquires
before capturing.

#### Term 3b — Observer height: 10 m, or 50 m under the wrong choice

Two choices, and they differ by a factor of five:

- **The DEM-ground choice**: take the ground elevation from the terrain grid at the fix and
  add an eye height of 1.6 m. The DEM's error on the broad ground a person stands on is
  measured: 0 m at Zermatt village, −27 m at the broad Grand Combin summit, and against
  GPS altitude at two Idaho viewpoints **+4.8 m and −9.0 m**. Take **10 m**.
- **The raw-GPS-altitude choice**, which is what the live screen does today: CoreLocation
  reports altitude above the geoid and the screen treats it as ellipsoidal. The gap reaches
  about **50 m**, which IMPLEMENTATION.md § "The web AR screen" already records as 0.29° on
  a summit 10 km away.

**The budget assumes the DEM-ground choice**, because the vertical column of the F3 table
is not achievable without it: at 2 km the geoid confusion alone is 1.441°, which exceeds
the whole vertical tolerance. **This is a precondition, not an assumption**: the fix
described as "planned" in IMPLEMENTATION.md § "The web AR screen" must land before the
field session, or F3's vertical criterion is graded against a budget of
`sqrt(5.5² + 50²) = 50.3 m` instead of 11.4 m and the near bands cannot pass.

#### Term 4 — DEM resolution and the near field: a term on visibility, not on position

A summit's drawn position does not depend on the DEM at all: its height comes from the peak
database and the observer's ground is term 3b. So the near field contributes **nothing** to
the F3 and F4 tolerances, and everything to F5.

[docs/NEAR-FIELD.md](NEAR-FIELD.md) measures what it does contribute. At a ridge-crest
viewpoint, 154 of 169 in-frame bearings had their horizon on DEM cells 90 m away, reaching
6.42°, and the directional clearance bands that P1.6 derives from it are **±1.537° to
±2.112°** at a 150 m radius. A clearance smaller than its band is `marginal`, and marginal
summits are labelled, de-emphasised and captioned "may be hidden".

Two consequences for the criteria:

- **F5 gates on no false `visible`, not on marginal.** A `marginal` verdict is the honest
  output of a ±1.8° band and cannot be scored against a truth apex that is either present
  or absent.
- **A summit closer than about 1 km is not graded for visibility at all.** At 1 km a ±1.8°
  band is ±31 m of terrain height, which is the DEM's own resolution limit. The near band
  of the F3 table grades *label position*, and reading it as a visibility claim is
  the mistake this paragraph exists to prevent.

#### Term 5 — Refraction variation: negligible, and that is a finding

The sightline uses k = 0.13. A variation Δk changes an apparent altitude by
`Δk × D / (2R)` radians, R = 6 371 km:

| D | Δk = 0.05 | Δk = 0.13 |
|---|---|---|
| 2 km | 0.00045° | 0.0012° |
| 5 km | 0.0011° | 0.0029° |
| 10 km | 0.0023° | 0.0059° |
| 30 km | 0.0067° | 0.0175° |
| 60 km | 0.0135° | 0.0351° |

Even a swing from a hot afternoon (k ≈ 0.07) to a cold morning inversion (k ≈ 0.26) moves a
60 km summit by 0.035°, which is 0.4 px. **Refraction is dropped from the RSS.** It is not
dropped from the visibility question: a 0.035° change flips a summit whose clearance is
smaller than that, and Half Dome from Mount Diablo clears its ridge by 0.0043°. Such
summits are `marginal` by the P1.6 rule and are not graded.

#### Term 6 — Field-of-view scale error at the frame edge

A label at fractional frame offset `u` (1 = the frame edge) sits at
`x = (W/2) · u`, with `tan θ = u · tan(F/2)`. A fractional error ε in `tan(F/2)` moves it by

```
Δθ = ε · u·tan(F/2) / (1 + u²tan²(F/2))   radians
```

which is 0 at the centre and `(ε/2)·sin F` at the edge. At hFOV 73.74°:

| ε | u = 0.3 | u = 0.485 (a ±20° pan) | u = 0.7 | u = 1.0 (edge) |
|---|---|---|---|---|
| 1 % | 0.123° | 0.184° | 0.236° | 0.275° |
| 10 % | 1.227° | 1.841° | 2.358° | 2.750° |

Vertically, summit labels sit near the horizon, so the vertical offset is small: at 20 % of
the half-height, ε = 1 % gives 0.039°.

**Calibrated: ε = 1 %.** The calibration puts a known bearing — the sun, or a landmark
sweep — at two frame positions and solves the scale. With the apex or disc centre located
to about 10 px on a 1920 px frame, the fractional precision is 10/960 ≈ 1 %.

**Uncalibrated: unquantified, and large.** `live-uncertainty.ts` reports this term as
unquantified on purpose, and the two scale errors this repository has actually measured are
**1.69×** (a wrong lens assumption) and **2.168×** (the portrait FOV bug). Those are
blunders rather than calibration residuals, but they set the scale of what an unchecked
assumption costs. At ε = 10 % the edge term alone is 2.75°, which exceeds every tolerance
in the table.

**So F3 and F4 are conditional on the field-of-view calibration passing first.** An
uncalibrated capture is not graded. The analyzer refuses it rather than scoring it, because
scoring it would report the calibration's failure as a geometry failure.

#### Term 7 — Roll: 0.5°, and it lands in the vertical

Roll comes from the gravity vector, the same source as pitch. Rolling the frame by φ moves
a label at angular offset ρ from the optical axis by `ρ · φ` (in radians), perpendicular to
the radius. Summit labels sit near the vertical centre of the frame and spread out
horizontally, so **the displacement is almost entirely vertical**:

| u | ρ (horizontal) | φ = 0.5° | φ = 1.0° |
|---|---|---|---|
| 0.485 | 19.99° | 0.174° | 0.349° |
| 0.7 | 27.70° | 0.242° | 0.483° |
| 1.0 | 36.87° | 0.322° | 0.644° |

The horizontal counterpart uses the vertical offset, which for a near-horizon label is
about 2°, giving 0.017° — negligible.

**0.5° is the figure used, and it is an assumption.** It is the gravity-vector scatter of a
*braced* hold: two hands, elbows against a rail or a knee. The protocol requires the brace,
and the bundle records the trace's own roll spread per capture, so the assumption is
checked rather than trusted. An unbraced 1.0° would add 0.32° to 0.64° of vertical error at
the frame edge, which is half the budget. A roll *sign* error is 180° and is caught by eye;
the screen has a flip button for it.

#### Term 8 — Heading smoothing lag: excluded, with a protocol rule that earns the exclusion

`smoothedHeading` weights samples exponentially with a 400 ms time constant
(`DEFAULT_TIME_CONSTANT_MS`, `src/live/sensors.ts`), so a steady pan at ω degrees per
second sits `ω × 0.4` degrees behind: 4° at 10 °/s, 8° at 20 °/s. That is far larger than
any tolerance here, and it is entirely removed by holding still. After motion stops the lag
decays as `exp(−Δt/τ)`:

| pan rate | lag while panning | residual 2 s after stopping |
|---|---|---|
| 10 °/s | 4.00° | 0.027° |
| 20 °/s | 8.00° | 0.054° |
| 40 °/s | 16.00° | 0.108° |

**Protocol: every graded capture is taken at least 2 s after the phone stops moving**, and
the trace's own heading spread over the capture second is recorded as the evidence that the
hold happened. CLHeading is itself filtered and lags attitude by an unmeasured amount
(IMPLEMENTATION.md § "The field pose is landscape"), which the same 2 s hold covers. With
the hold, heading lag enters the RSS at under 0.06° and is dropped. Without it, F4 is
unmeasurable: a pan of ±20° taken mid-motion carries 8° of lag.

#### Term 9 — Drag precision: 0.543°

The drag maps pixels to degrees through the exact inverse of the projection
(`dragToTrimDeg`), so there is no linearisation error. What limits it is where the finger
lands and how well a person can judge that a pole meets an apex on a hand-held screen.

- **Quantisation floor**: 1 CSS px = **0.0899°**. Not the limit.
- **Finger placement**: 1 mm of glass at 460 ppi and a device pixel ratio of 3 is
  **6.037 CSS px = 0.5427°**. One millimetre is a fair bound on a deliberate slow drag with
  the finger already down; it is not a bound on a tap-and-flick.

**0.543° is the figure used, on both axes.** It is the largest single term in the budget
beyond 3 km, and it is a judgement rather than a measurement — it is labelled as such, and
the field session measures it directly as the spread of three repeated drags on the same
summit (recorded, not gated).

### 1.4 Combining them

**Independence assumptions, stated so they can be attacked:**

- Peak position (1) and summit height (2) come from different OpenStreetMap edits by
  different contributors. Independent.
- Observer horizontal (3a) and observer height (3b) are independent *under the DEM-ground
  choice*, because the height then comes from the terrain grid rather than from the GPS
  fix. Under the raw-GPS choice they share the fix and are correlated, which is a second
  reason that choice is a precondition.
- Field-of-view scale (6) and roll (7) are instrument terms, independent of the geodesy.
- Drag precision (9) is human motor noise. Independent of everything.
- **The one correlation left in**: an observer horizontal offset changes both the bearing
  and the range to a summit, so it touches both axes. The range change alters the altitude
  by `Δz·ΔD/D²`, which at 15 m and 10 km is under 0.0001°. Ignored, and the arithmetic for
  ignoring it is here.
- **What is not independent across summits**: a single observer offset shifts every
  summit's bearing coherently, by `e·sin(Δbearing)/D`. Charging it per summit at its full
  magnitude `e/D` is conservative, and the budget does that rather than modelling the
  geometry of a particular viewpoint.

**RSS, not worst case.** Nine terms of comparable size do not all reach their maxima with
the same sign, and a worst-case sum would set a tolerance nothing could fail — which is the
opposite of a test. The worst-case sum is computed alongside, and the ratio is stated, so a
reader can see how much the choice is worth: at 2 km the linear sum is 1.712° horizontally
against an RSS of 0.951°, a factor of 1.80; beyond 10 km the factor is about 1.6.

### 1.5 The budget, per distance band

Per-summit 1σ, at the frame edge (u = 1.0, the worst position in the frame), anchored on a
7–20 km summit, with the calibrated field of view, the DEM-ground observer height and the
2 s hold:

| D | peak+obs, H | peak+obs, V | anchor H | anchor V | FOV H | FOV V | roll H | roll V | drag | **1σ H** | **1σ V** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 km | 0.716° | 0.327° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.951°** | **0.715°** |
| 5 km | 0.287° | 0.131° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.688°** | **0.649°** |
| 10 km | 0.143° | 0.065° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.642°** | **0.639°** |
| 30 km | 0.048° | 0.022° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.628°** | **0.636°** |
| 60 km | 0.024° | 0.011° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.626°** | **0.636°** |

Horizontal geodesy is `sqrt(20² + 15²) = 25 m` over D; vertical is
`sqrt(5.5² + 10²) = 11.41 m` over D.

**The headline.** Beyond about 3 km the budget is flat, because the drag, the roll and the
field-of-view scale do not care how far away a summit is, and together they are 0.62°.
The geodesy only matters in the near band: at 2 km it is 0.716° horizontally, larger than
everything else combined; at 10 km it is 0.143°, a fifth of the total; at 60 km it is
0.024°, invisible. **So a 60 km summit is no harder to label than a 10 km one**, which is
worth knowing before anyone budgets a 42 MB terrain mosaic to reach one.

---

## Part 2 — The pre-registered criteria

### 2.0 What truth is

**Truth is a pixel, located by two independent agents from the captured frame, and their
disagreement is part of the result.**

The protocol:

1. The bundle stores each capture's camera frame at the video track's full width, at least
   1920 px. At 1920 px the scale is 22.35 px/degree, so a 5 px annotation disagreement is
   0.22°; at the 956 px CSS viewport it would be 0.45°, a third of the tolerance. **The
   frame resolution is a registered parameter because the truth's precision depends on it.**
2. Two annotators work from the **bare frame**. Neither sees the overlay as drawn, the
   other's picks, the pose, or the predicted positions. Each is given the frame, the list of
   candidate summits by id, name and published height, and a labelled pixel grid.
3. Each annotator reports, per summit, either an apex pixel or **`null`, meaning "I cannot
   identify this summit in this frame"**. `null` is a positive answer and is what makes F5's
   false-`visible` check possible.
4. Truth for a summit is the midpoint of the two picks. The **disagreement** is the distance
   between them, recorded in pixels and degrees for every graded summit.
5. **A summit whose annotators disagree by more than 0.30° is not graded.** It is reported
   as `truth-disputed` with its disagreement. 0.30° is a quarter of the tightest F3
   threshold: truth four times finer than the tolerance is the least that makes a verdict
   mean anything.
6. A summit one annotator locates and the other calls `null` is `truth-disputed` too. The
   two claims are not reconcilable by averaging.

This is the same instrument the Railroad Ridge pose was solved with, and its own record
says what it is: "my reading of the picture — an agent looking at a magnified crop with a
labelled 50 px grid — and it is a judgement, not an instrument"
([docs/REAL-PHOTO-POSE.md](REAL-PHOTO-POSE.md)). Two agents instead of one is what turns a
judgement into a measurement with an error bar. It is still not a survey.

**On n, honestly.** One site, one session, one phone, one lens, one atmosphere, one hour of
day. A 73.74° frame at the proposed site labelled 7 summits in the one real photograph
taken there, and two or three captures give perhaps 8 to 16 graded summit-observations in
total. Per distance band that is 0 to 4. **A band with no graded summit is reported
`no-sample` and is neither passed nor failed.** A band with one is n = 1 and is labelled
n = 1 in the result, per `AGENTS.md`. **This session can refute the budget. It cannot
confirm it.** A pass means "nothing here contradicts the budget at this n", and any
sentence that upgrades that is wrong.

### 2.1 F1 — Offline start and frame rate

**Claim.** The app starts and draws labels with no network, within 15 s, and sustains a
usable frame rate.

**The exact measurement.**
- *Start*: from the tap that activates the Safari tab, in airplane mode, to the first
  overlay drawn with at least one summit marker on screen. Timed with a stopwatch by the
  person on site, to the nearest second, and cross-checked against the page's own
  relative-millisecond marks in the bundle. Three cold starts, the tab closed between each.
- *Frame rate*: the overlay's own re-projection tick rate, recorded per capture as the
  count of ticks in the capture second and the longest gap between ticks, over a 30 s hold
  and a 30 s slow pan.

**Sample.** 3 cold starts; 2 × 30 s rate windows.

**Thresholds.** Median of 3 starts ≤ 15 s, and no single start over 20 s. Frame rate:
median ≥ **15 tick/s** sustained, no gap longer than **250 ms**.

**Why 15/s.** A label must not visibly trail the terrain while the user pans. At a
hand-held pan of 20 °/s and 11.1235 px/deg, one frame of lag at 15/s is
`20/15 × 11.1235 = 14.8 px`, which is about one F3 tolerance — the smallest lag that would
not itself register as a labelling error. At 10/s it is 22 px, visibly wrong. The 250 ms gap
bound is the same figure allowing one dropped frame.

**Failure.** Any threshold missed. **What happens then:** the run continues — F2 to F5 are
measurable on a slow app — and the shortfall is reported with the sweep timing behind it.
The sweep at the proposed site took 1.34 s for 360° and the loop re-projects without
re-sweeping, so a frame-rate failure points at the browser or the overlay, not the geometry.

**What F1 depends on, stated before the session.** An offline start is a designed
mechanism rather than a reliance on Safari's incidental HTTP cache: `src/offline/` holds a
service worker and the "download this site" action a person performs before leaving signal.
F1 measures whether that mechanism works on the phone, which nothing headless can settle.

Two sizing risks remain, and they are the ones to check before the session rather than
after it. The 60 km mosaic is 20.78 MB gzipped and 42.55 MB raw, and GitHub Pages serves no
`gzip_static`, so the phone may fetch the full 42.55 MB and must then keep it inside its own
storage quota. Cutting the site package to a smaller radius removes both risks at once —
20 km is 4.90 MB and 40 km is 19.07 MB — and costs only the summits between that radius and
60 km, which the budget says are no harder to label than the near ones. **Which radius the
field session carries is a decision to take before the drive, not at the trailhead.**

### 2.2 F2 — Raw error is recorded, and gated only on the displayed band

**Claim.** The band the app displays contains the error the app is actually making.

This criterion is deliberately not a threshold on the error. The raw horizontal error is
dominated by the magnetometer: WMM2025 contributes 0.5° RMS, local crustal anomalies reach
several degrees, and the phone's own reported compass accuracy is routinely 10° or worse and
is published by nobody. There is no distribution here to gate against, and inventing one
would be exactly the failure `src/app/uncertainty.ts` refuses in its header. So the raw
error is **a measurement this session produces**, and the only claim tested is the app's
honesty about it.

**The exact measurement.** For each graded summit in each before-drag capture, the signed
frame-angle offset between the marker as drawn and the truth apex, on both axes, in degrees
and pixels. The band is the app's own `measuredDeg`, as drawn, carried in the bundle.

**Sample.** Every graded summit in every before-drag capture: 8 to 16 summit-observations.

**The gate.** `|raw error| ≤ band half-width` on each axis, for every graded summit, **on
any axis whose band carries no unquantified term**. An axis whose band carries an
unquantified term is a *floor*, not a bound — `summarise` says so on screen — and a floor
cannot be exceeded. Such an axis is reported `recorded-not-gated`.

**Failure.** A raw error outside a band that carried only measured terms. That is the app
claiming a bound it does not hold, and it is the most serious failure available here:
**it is fixed before the field data is used for anything else**, because every other
criterion is read through a band the app would then be known to understate.

### 2.3 F3 — After one drag

**Claim.** After one drag anchored on one summit, every other labelled summit sits within
the budget.

**The exact measurement.** For each graded summit in each after-drag capture, the absolute
frame-angle residual between the marker as drawn and the truth apex, per axis. Frame angles
are the tangent-plane angles about the optical axis, which is exactly what the drag trims.

**Sample.** Every graded summit in every after-drag capture, binned by distance.

**Thresholds — 2σ of the budget in §1.5, rounded up to 0.05°:**

| band | distance | horizontal | vertical | at 1920 px frame |
|---|---|---|---|---|
| `near` | 0 to under 3 km | **1.90°** | **1.45°** | 42.4 px / 32.4 px |
| `mid` | 3 to under 7 km | **1.40°** | **1.30°** | 31.3 px / 29.0 px |
| `far` | 7 to under 20 km | **1.30°** | **1.30°** | 29.0 px / 29.0 px |
| `distant` | 20 to under 45 km | **1.30°** | **1.30°** | 29.0 px / 29.0 px |
| `horizon` | 45 km and beyond | **1.30°** | **1.30°** | 29.0 px / 29.0 px |

A band's lower bound is inclusive and its upper bound exclusive, so a summit exactly 3 km
away is graded against `mid`. A boundary goes to the tighter of the two bands.

2σ is the tolerance because the budget's terms are 1σ and a single summit is one draw; at
2σ a correct budget puts about 5 % of summits outside, which at n ≤ 16 is under one summit.
The last three bands are identical because the budget is flat beyond 7 km, and collapsing
them would hide that; they are listed separately so the result reports n per band.

**Failure.** Any graded summit outside its band's threshold. **What happens then:** the
residual is decomposed against §1.3 — is it one summit (check the cross-release diff and
the truth disagreement), one axis (roll, or the observer-height choice), or a scale
(field-of-view calibration, which is distance-independent and grows with frame offset)? The
budget is corrected with evidence and the criterion is re-graded against the corrected
figure in a later session. The threshold is not moved.

**Preconditions, both refusals rather than adjustments.** A capture whose field of view is
the spec-sheet guess is not graded (term 6). A capture whose frame geometry differs from
§1.2 by more than 10 % in hFOV or aspect is reported as a geometry deviation, because the
roll and field-of-view terms were computed on §1.2's frame.

### 2.4 F4 — The same, after a pan and a tilt

**Claim.** The drag holds when the phone moves. A trim that only works at the pose it was
set at is a coincidence.

**The exact measurement.** From an after-drag capture, pan by ±20° and tilt by ±10°,
hold 2 s, capture again without re-dragging. Grade exactly as F3, against the same
thresholds. Four movements per anchor capture: +20°, −20° pan; +10°, −10° tilt.

**Sample.** Four movement captures per after-drag capture; the same graded summits, minus
any the movement pushed out of frame.

**Thresholds.** F3's table, unchanged. Plus: the movement actually performed must be within
15–25° of pan or 5–15° of tilt, read from the pose recorded in the bundle, or the capture is
reported as off-protocol and not graded.

**Failure.** Any graded summit outside its band. Distinguishing F4 from F3 is the point: a
residual that appears only after the movement implicates the sensors or the roll, while one
present in both is geometry.

**What ±20° does and does not exercise.** At hFOV 73.74°, a ±20° pan moves a centre summit
to u = 0.485, where the field-of-view scale term is 0.184° of the 0.275° available at the
edge. So F4 probes two thirds of that term. The edge itself is exercised by grading the
summits that already sit near the frame edge in the F3 captures, and the result reports each
graded summit's frame offset u so the two can be told apart.

### 2.5 F5 — What the labels claim

Three separate claims, each gated, each reported separately.

**F5a — No false `visible`.** A summit drawn `visible` that both annotators independently
report as `null` is a false `visible`. **Threshold: zero.** One is a failure.
`marginal` is excluded: it is the honest output of a ±1.8° near-field band (term 4) and
carries "may be hidden" on screen. A summit the annotators disagree about is
`truth-disputed`, reported, and not counted in either direction.
**On failure:** the summit's clearance, its occluder distance and its near-field band are
reported. A false `visible` from an occluder inside the near-field radius is a
near-field-band failure; one from a resolvable occluder kilometres away is a geometry or
data failure, and those are different bugs.

**F5b — The three most prominent predicted summits are labelled.** "Prominent" means
**apparent height** — the ranking `compareLabelPriority` in `src/render/layout.ts` already
uses, which is `altitudeDeg` descending, then elevation, then id. Topographic prominence is
not in the data and is not substituted for silently. The top three in-frame predicted
summits must each carry a **name**, not merely a dot: none of them may appear in the
overlay's `crowdedOutSummits`. **Threshold: all three.** Fewer is a failure, and the count
of unnamed dots and the label budget are reported with it.

**F5c — Beyond the terrain is `unmeasured`.** Every predicted summit farther than the
capture's sweep radius must appear in the overlay's `unmeasured` list and must carry no
marker. **Threshold: all of them, and no marker for any of them.** A summit drawn with a
verdict from beyond the measured terrain is a fabricated claim and fails outright.

### 2.6 F6 — Human time on site

**Claim.** The field session fits the 25 minutes IMPLEMENTATION.md budgets for it.

**The exact measurement.** Elapsed minutes from the tab opening to the last capture,
recorded by the person on site, split into: permissions and start, field-of-view
calibration, the F3 captures, the F4 movements, and anything repeated. Recorded as
relative durations only.

**Sample.** n = 1. It is one session. This is stated rather than dressed up.

**Threshold.** ≤ 40 minutes total, and the field-of-view calibration ≤ 10 minutes.
40 rather than 25 because the estimate is 25 and a criterion set at the estimate measures
the estimate rather than the protocol.

**Failure.** Over 40 minutes, or the session abandoned incomplete. **What happens then:**
the step that consumed the time is named, and the protocol is cut before a second session
rather than the human being asked to be quicker. A second field session is a scope question
for the human, not a decision for the agents.

---

## Part 3 — How a run is graded

`src/live/field-analysis.ts` holds the schema, the parser, the thresholds above as data,
and the F2–F5 arithmetic. `npm run analyze:field -- <bundle> <truth>` prints the verdicts.
F1 and F6 are stopwatch numbers recorded by the person on site and are not computed from a
bundle.

**The thresholds live in code as `PREREGISTERED_THRESHOLDS`**, and the analyzer takes no
threshold argument. A run cannot be graded against anything but this document, and changing
a number there changes it here, in the same commit, with the reason.

**The analyzer prints no coordinates, and no distances or bearings either.** A distance and
a bearing to a named summit *is* a position fix. So the bundle carries no bearings at all,
and the analyzer reports a summit's **band label** rather than its distance. The bundle
itself unavoidably locates the session — distances to named summits do that — which is why
it travels only by the human's own action to their own account and is never committed
(`AGENTS.md` § "Captures from the phone").

**What the bundle may not carry**, enforced by the parser rather than by convention: any
geolocation field, latitude, longitude, bearing, epoch or ISO timestamp, camera device
identifier, or embedded image bytes. Timestamps are milliseconds from the start of the
capture session. The camera frame is referenced by file name; the bytes stay beside the
bundle and never inside it.

`fixtures/field/` holds synthetic bundles with known injected errors, and nothing recorded
from a phone.
