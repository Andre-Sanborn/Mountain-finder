# The field test: error budget and pre-registered pass criteria

**Written and revised 2026-09-29, before any field number exists.** The revision history at
the end says what each revision changed. Nothing in this document was
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
error enters every row of the table. **The protocol names the anchor rather than leaving it
to the person**: the drag is anchored on the summit § 2.7 registers, and the bundle records
which one (`dragAnchorSummitId`). The table below charges the anchor at the 7–20 km band.

**The registered anchor at this site is Deer Point, 2.0 km away** (§ 2.7). It is the summit
the session faces, and the only one in that frame carrying a registered apex rule (§ 2.0).
A farther anchor would carry a smaller angular error — 25 m of horizontal geodesy is 0.143°
at 10 km, 0.026° at 55 km, and 0.716° at 2 km — so the 7–20 km charge in the table below is
**not** conservative for this anchor. Carrying the 2 km figure through § 1.5 instead would
raise the horizontal 1σ from 0.951° to 1.182° at 2 km and from 0.642° to 0.951° at 10 km.
**The table is left as written, and the limits with it.** A limit re-derived to fit the
anchor would be a limit widened before a run, which this document permits only with the
measurement behind it (§ 1.6), and no such measurement exists. What it means for a run is
stated rather than hidden: a band that fails by less than that gap is a candidate for the
anchor's own error rather than for the app's, and the decomposition § 2.3 already requires
starts there.

### 1.2 The viewport the budget is computed on

A session works in two frames of different sizes, and this section registers the first of
them. The **viewport** is where the overlay is drawn and where a finger drags a label. The
**stored frame** is the recording the camera track delivers, and truth is read off it; it is
registered in § 2.0.

Every term below belongs to the viewport. The roll and field-of-view scale terms (terms 6
and 7) grow with a marker's drawn offset from the optical axis, and the drag term (term 9) is
a finger against this frame's px-per-degree. The stored frame carries none of them, because
nothing is aimed or dragged in it.

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

#### Term 3a — Observer horizontal position: the fix's own accuracy, or 15 m

**When the capture reports an accuracy, the budget uses it.** The W3C Geolocation API
defines `GeolocationCoordinates.accuracy` as the horizontal radius of the fix at a **95 %
confidence level** ([W3C Geolocation API, `accuracy`](https://www.w3.org/TR/geolocation/)),
and the phone reports it at every fix. For a circular bivariate normal the radius holding
95 % of draws is `σ·sqrt(−2·ln 0.05) = 2.4477σ`, so the **per-axis 1σ is the reported radius
over 2.4477**. A 10 m accuracy is 4.09 m of 1σ per axis; a 30 m accuracy is 12.26 m.

**Apple states no confidence level for `CLLocation.horizontalAccuracy`.** iOS Safari serves
the W3C API, so a capture from it is read under the W3C convention, and the bundle records
which convention it was read under (`accuracyConvention`) beside the raw number
(`horizontalAccuracyM`) rather than leaving it to be inferred. The sensitivity is small and
one-sided: reading a 10 m figure as 1σ instead of a 95 % radius would raise the near band's
horizontal 1σ from 0.853° to 0.894°, which moves its limit from 1.75° to 1.80°. Every other
band moves less, because the observer term is smaller than the drag beyond 3 km.

**When the capture reports no accuracy, the term is 15 m.** The repository's one direct
comparison: at the Railroad Ridge viewpoint the photographer's hand-read coordinate and the
phone's GPS fix differ by **14.3 m** ([docs/NEAR-FIELD.md](NEAR-FIELD.md)), n = 1. Rounded
to 15 m. It is the weakest-sourced term in the budget, which is why the measured figure
replaces it wherever there is one.

**A reported accuracy worse than 30 m fails the fix.** The session re-acquires before
capturing, and a capture that carries a worse figure anyway is refused rather than graded.

The recomputation can only **tighten** a limit. The effective limit is the tighter of the
registered figure in § 2.3 and the figure the reported accuracy derives, so a good fix
narrows the tolerance and a poor one never widens it. § 2.3 gives the derived table for a
10 m fix.

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

| ε | u = 0.3 | u = 0.7 | u = 0.8 (the F4 pan target) | u = 1.0 (edge) |
|---|---|---|---|---|
| 1 % | 0.123° | 0.236° | 0.253° | 0.275° |
| 10 % | 1.227° | 2.358° | 2.528° | 2.750° |

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

**So F2, F3 and F4 are conditional on the field-of-view calibration passing first.** An
uncalibrated capture is not graded, by any of the three. The analyzer refuses it rather than
scoring it, because scoring it would report the calibration's failure as a geometry failure —
and for F2 it would report a scale error as the app understating its own band.

#### Term 7 — Roll: 0.5°, and it lands in the vertical

Roll comes from the gravity vector, the same source as pitch. Rolling the frame by φ moves
a label at angular offset ρ from the optical axis by `ρ · φ` (in radians), perpendicular to
the radius. Summit labels sit near the vertical centre of the frame and spread out
horizontally, so **the displacement is almost entirely vertical**:

| u | ρ (horizontal) | φ = 0.5° | φ = 1.0° |
|---|---|---|---|
| 0.485 | 19.99° | 0.174° | 0.349° |
| 0.7 | 27.70° | 0.242° | 0.483° |
| 0.8 | 30.96° | 0.270° | 0.540° |
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
unmeasurable: a capture taken mid-pan at 20 °/s carries 8° of lag.

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
| 5 km | 0.286° | 0.131° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.689°** | **0.649°** |
| 10 km | 0.143° | 0.065° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.642°** | **0.639°** |
| 30 km | 0.048° | 0.022° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.628°** | **0.636°** |
| 60 km | 0.024° | 0.011° | 0.143° | 0.065° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.627°** | **0.636°** |

Horizontal geodesy is `sqrt(20² + 15²) = 25 m` over D; vertical is
`sqrt(5.5² + 10²) = 11.41 m` over D. When a capture reports its own fix accuracy, the 15 m
becomes that fix's per-axis 1σ by term 3a and the row is recomputed for that capture; § 2.3
gives the recomputed limits for a 10 m fix.

**The headline.** Beyond about 3 km the budget is flat, because the drag, the roll and the
field-of-view scale do not care how far away a summit is, and together they are 0.62°.
The geodesy only matters in the near band: at 2 km it is 0.716° horizontally, larger than
everything else combined; at 10 km it is 0.143°, a fifth of the total; at 60 km it is
0.024°, invisible. **So a 60 km summit is no harder to label than a 10 km one**, which is
worth knowing before anyone budgets a 42 MB terrain mosaic to reach one.

### 1.6 The two terms that are measured before the session

Two of the terms above are judgements rather than measurements, and they are the two largest
beyond 3 km. **Both are measured in the home session, and the limits are re-derived from
those measurements before the field session** — not from a second judgement.

- **Drag precision (term 9), assumed 0.543°.** The home session records three repeated drags
  onto the same reference, in the normal drag mode and again in the 4× fine mode the screen
  now offers. The measurement is the spread of the trims those drags produce, per axis, in
  degrees. Two figures come out of it: the spread in normal mode, which replaces the 1 mm
  finger-placement assumption, and the spread in fine mode, which says what the fine mode is
  worth. Whether the field session drags in fine mode is decided by that second figure.
- **Roll (term 7), assumed 0.5°.** The home session records the gravity-vector roll spread
  over a braced still hold, which is the assumption term 7 makes. The field captures record
  their own roll spread too, so the assumption is checked twice: once before the session at
  leisure, once per capture.

**The numbers in § 1.3 and § 2.3 are not changed by this document.** They stand as written
until the home session produces the measurements, and the re-derivation is then recorded in
the revision history at the end of this document, with the measurements, the recomputed 1σ
column and the limits that follow. A limit that the measurement *widens* is a limit that was
too tight, and it is widened before the field data exists or not at all — the rule at the top
of this document is about a threshold moved after a run, and that rule is not relaxed.

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

   **The stored frame is registered on two counts, and neither is the § 1.2 viewport.** Its
   width is at least 1920 px, and its aspect ratio equals the camera track's own, to within
   2 %. The aspect is checked against the track because that is what says the frame was
   stored whole: a crop or a stretch moves every apex pixel away from where the camera put
   it, and a phone letterboxes its 16:9 stream into whatever viewport Safari leaves, so a
   stored frame that matched the viewport's shape would be the broken one. The 2 % allows a
   stored height rounded to whole pixels, which at 1920 px wide is under 0.05 %, and refuses
   any real crop: 4:3 against 16:9 is 25 %. A capture that reports no track size is reported
   as unchecked rather than passed.
2. **Neither annotator ever sees the app's projection, the overlay as drawn, the pose, or
   the other's picks.** What they are given beyond that is one of two registered methods,
   and each reading records which:
   - `bare-frame`: the frame, the candidate summits by id, name and published height, and a
     labelled pixel grid.
   - `frame-and-map`: the same, plus the viewpoint and a topographic map.

   Both are allowed and the result reports which was used. A map tells an annotator what
   ought to be on the skyline and in what order, which is the knowledge a person standing
   there would have; it says nothing about where the app put a label.
3. **Each annotator gives one of three answers per summit, and each is a positive claim.**
   - **an apex pixel** — the point they judge to be the top of that summit;
   - **`absent`, with a reason** — they looked at the region where the summit would sit and
     it holds no summit. The reason is `clear-sky` or `foreground-blocked`, and the
     annotator must say which;
   - **`cannotIdentify`** — they could not decide either way.

   **Only an agreed `absent` can convict the app of a false `visible`.** Separating the two
   is what stops a hazy unidentifiable foothill being graded as a mountain that is not there.
4. Truth for a summit is the midpoint of the two picks. The **disagreement** is the distance
   between them, recorded in pixels and degrees for every graded summit.
5. **A summit whose annotators disagree by more than 0.30° is not graded.** It is reported
   as `truth-disputed` with its disagreement. 0.30° is a quarter of the tightest F3
   threshold: truth four times finer than the tolerance is the least that makes a verdict
   mean anything.
6. **The disagreement rules, in order.** Either annotator answering `cannotIdentify`
   **excludes** the summit from F3, F4 and F5a, whatever the other said, and the count of
   exclusions is reported. Two `absent` answers make the summit absent, and the two reasons
   are both reported even when they differ. An `absent` against an apex is `truth-disputed`:
   the two claims are not reconcilable by averaging. Two apexes go to the 0.30° rule above.
7. **Landmark truth.** A summit whose committed position carries a sharp, unambiguous point
   feature — a radio mast, a lookout tower, a notch — may be annotated from that feature.
   The brief names the target point in words ("the crest under the tallest mast, not its
   tip"), and the annotator records what they used in a `landmark` field. **The grader
   treats a landmark apex as any other apex** and reports the landmark observations apart,
   because a mast is a sharper target than a rounded skyline and a truth read off one is
   finer than the rest. It is not a licence to claim the app did better.

8. **Where a registered apex rule exists, it decides which point both annotators take.** A
   rule is written once, before any field data exists, by an agent who sees only a rehearsal
   frame and the annotator maps — never the app's projection, never the pose, and never an
   annotator's answers. **A rule names a physical feature and nothing else.** It never names
   a pixel, a position in the frame, a direction, a neighbouring summit, or an appearance
   that changes with the light or the season. The one thing the writer may add is that the
   feature stands on the crest the summit node marks, between the same contours; the maps
   show no buildings, so that is as far as the terrain can tie a feature to a node. **The
   distance from the feature to the node is an unquantified truth term** on every rule-bound
   summit, and this document does not estimate it. Each annotator records the rule they
   followed in a `rule` field on the apex, and a summit counts as rule-bound only when both
   quoted one.
9. **A bearing-and-lens prediction may direct an annotator's attention. It may never place a
   pixel.** Both map annotators of the rehearsal frame fitted a focal length on one summit
   and predicted the rest from map bearings. That is a model of the same pinhole camera the
   app projects with, so an apex placed by it would check the app against itself. A
   prediction says where to look; the picture says where the apex is.
10. **The report separates the two kinds of summit.** It states how many graded summits
    were rule-bound, and it reports the annotator disagreement for the rule-bound summits
    apart from the free ones. A rule removes the choice of which point on a flat crest to
    take, so the two spreads measure different things and one pooled figure would hide both.

#### Registered apex rules

Written before any field data existed. Nothing is added to this list once a field frame
exists.

- **Deer Point** — *the crest under the tallest mast, not its tip.*

**That is the whole list, and it is one rule.** No rule was written for any other summit,
including Doe Point: on the 10 km annotator map the Doe Point and Deer Point nodes sit about
250 m apart inside one closed summit contour, so the terrain cannot tie Doe Point's small
mast to the Doe Point node rather than to its neighbour. A feature that cannot be tied to a
node gets no rule.

Two consequences, both pre-declared:

- **Deer Point is the drag anchor, and an anchor is never graded (§ 2.3).** So the rule-bound
  count is expected to be **zero in every graded band**. The machinery still runs and still
  prints the split; a table of zeroes there is the protocol working.
- **At the south direction, `F2.pose` rests on free agreement about Doe Point.** The two map
  annotators of the rehearsal frame placed Doe Point 0.656° apart, over the 0.30° limit, so
  it was `truth-disputed`. **South `F2.pose` is therefore expected `no-sample`** unless the
  field frame resolves what the rehearsal frame did not.

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

**The session faces south, and the near band cannot carry a graded sample there.** The site
package holds 5 summits inside 3 km of the viewpoint, 4 more between 3 and 7 km and 15
between 7 and 20 km. From the viewpoint on Shafer Butte every one of them sits **below**
horizontal: 2.8 to 7.6° down in the near band, 3.0 to 5.7° in the mid band, 1.7 to 5.0° in
the far band, computed with a 1.6 m eye height and the k = 0.13 sightline. Below horizontal
does not mean out of frame: the rehearsal frame puts Deer Point 2 km away at −4.5° with the
skyline still in shot, and a 38.1° vertical field of view reaches 19° below the optical
axis. So § 2.7 points the session south, toward Deer Point and Doe Point, and anchors the
drag on Deer Point.

**F3.near and F4.near are site-limited, and are expected `no-sample` by construction.**
Within 3 km of the viewpoint the package holds four summits besides Shafer Butte itself:
Doe Point 1.9 km at 198°, Deer Point 2.0 km at 204°, Bob's Knob 2.1 km at 123° and Mores
Mountain 2.2 km at 356°. A 73.74° frame holds no more than two of them at once — Doe Point
and Deer Point, 6° apart; the next nearest pair is 75° apart — and one of those two is the
drag anchor, which § 2.3 excludes. The near band's whole possible graded sample is therefore
Doe Point, one summit against a stop rule that asks for three. **The site limits this, not
the app**, and it is written here for the same reason the other pre-declared limits are.

**Which bands the south direction can sample.** Beyond the near band, the summits the
registered direction can reach are:

- `mid` (3 to under 7 km): **Little Deer Point, Lower Point and Gardiner Peak**. All three
  must be placed by both annotators for the band to clear the stop rule, so one
  `cannotIdentify` or one disputed pick leaves `mid` at `no-sample`.
- `far` (7 to under 20 km): **Boise Peak, Eagleson Summit, Aldape Peak, Lucky Peak and
  Cervidae Peak** are the candidates, of which three must be settled.

**A hazy day is predicted to give `no-sample` in `far` and `distant`.** The rehearsal
annotation left every valley butte 20 km and beyond `cannotIdentify` in midday haze, and a
summit the annotators cannot identify is one the truth instrument did not settle. The
`distant` and `horizon` bands are reached by the north-east direction § 2.7 registers, which
F3 and F4 do not grade at all (§ 2.2).

**Rule-bound counts are expected to read zero in every graded band.** Deer Point's rule is
the only one registered below, and Deer Point is the drag anchor, which is never graded. So
the split the report prints will show every graded summit as free, and that zero is the
protocol working rather than the machinery failing.

**The stop rule: a band needs three graded summits before it may pass.** A band whose truth
yields fewer than three graded summits is reported `no-sample`, and the report says the
**truth instrument** rather than the app limited it, naming how many summits were drawn in
that band and how many the annotators settled. Three is the smallest count at which the
exceedance gate of § 2.3 distinguishes one unlucky draw from a wrong band: at n = 1 or 2 the
gate tolerates every outcome short of a 3σ excursion, so a pass would report the sample
rather than the app.

**A band that fails the gate still fails, whatever its n.** One summit-axis past 3σ refutes
the budget on its own. This document already says this session can refute the budget and
cannot confirm it, so the stop rule withholds the confirmation and never the refutation.

**That is where the observer terms live.** The geodesy and the observer height only matter
inside 3 km (§ 1.5), so a session that grades only the `far`, `distant` and `horizon` bands
tests the drag, the roll and the field-of-view scale, and barely tests the geodesy at all.
A run that passes every graded band has said nothing about term 3a or term 3b.

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
storage quota. Cutting the site package to a smaller radius would remove both risks at once:
20 km is 4.90 MB and 40 km is 19.07 MB.

**The session carries the 60 km terrain, and the live sweep takes its range from the served
site rather than from the app's 30 km default.** At the proposed site, 63 of the 104 summits
within 60 km lie beyond 30 km, and the ten highest by apparent height are all 34–58 km out
(Trinity 56.4 km, Freeman 36.5 km, Pilot 38.4 km). A 30 km sweep would report every one of
them `unmeasured`, so F5b would be graded on whatever was left and the answer would be about
the sweep radius rather than about the labels. A 40 km cut drops the most prominent summit
and half of that top ten, which is why the 19.07 MB is not the saving it looks like. The
bytes are spent instead, and the two risks above become checks to run before the drive: the
fetched size on the phone, and whether the sweep finishes at 60 km on its throttled CPU.

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

**Precondition.** F2 is conditional on the field-of-view calibration, exactly as F3 and F4
are (term 6). An uncalibrated capture is refused rather than graded: with an unquantified
scale error, a raw error outside the band says nothing about whether the band was honest.

**The gate.** `|raw error| ≤ band half-width` on each axis, for every graded summit, **on
any axis whose band carries no unquantified term**. An axis whose band carries an
unquantified term is a *floor*, not a bound — `summarise` says so on screen — and a floor
cannot be exceeded. Such an axis is reported `recorded-not-gated`.

**The vertical axis is `recorded-not-gated` unless the home session measured the tilt zero
point.** The live band's vertical terms are the tilt scatter over the last second and, once
the field of view is calibrated, nothing else. Scatter is not bias: a braced phone scatters a
few thousandths of a degree while its gravity zero can sit whole degrees off, so a band built
from scatter alone would claim a bound no phone holds. `live-uncertainty.ts` therefore carries
an explicit unquantified term, "Tilt zero point never checked", until a measurement exists, and
the rule above then puts the vertical axis in `recorded-not-gated` by construction. The home
session supplies the measurement by pointing the camera at the Sun during the three aiming
steps: the Sun centred in the frame puts the camera axis at the Sun's altitude, which
`knownBearing.altitudeDeg` already carries, and `estimatePitchBias` reads the sensed tilt
against it. The band then charges the bias and the re-aim spread together, and the vertical
axis is gated like the horizontal one.

**The same claim at the pose, where a gross compass error is visible.** F2 on the drawn
markers cannot see one. A quarter-turn error puts every summit somewhere the annotators
find nothing, so the criterion has no located summit and reports `no-sample`; and once the
person re-anchors on the Sun or on a summit, the markers land where they belong and it
passes with the 92° nowhere in the verdict. `F2.pose` grades the same claim on the pose
itself, and it is graded whenever a before-drag capture holds **two or more located
summits**.

- **Sensed.** The heading the compass alone gave: the pose's heading minus the fine trim
  minus the gross re-anchor offset. Every capture records the offset and what set it,
  `sensors`, `sun` or `summit`, so the reading is recoverable from the bundle.
- **Solved.** The heading the picture implies. Each located summit's direction is read off
  the marker the app drew, at the pose it drew with, which cancels the compass out and
  leaves the geometry the peak data and the observer's fix give. Heading and pitch are then
  solved together by least squares, in stored-frame pixels through the same `object-fit:
  cover` mapping the marker residuals use, until those directions sit on the truth apexes.
  Roll comes from the pose: one capture's summits sit within a few degrees of the horizon,
  where roll and pitch are nearly degenerate.
- **The gate.** `|sensed − solved| ≤ the displayed band's horizontal half-width`, under the
  per-axis rule above: `recorded-not-gated` when the horizontal axis carries an unquantified
  term. The vertical axis is not gated here. The solve reports the pitch it found, and the
  tilt zero point is what the home session measures.
- **Reported.** Sensed, solved, the difference, how many summits the solve used, and the
  gross offset in force with its source.

A capture with fewer than two located summits reports `no-sample`: one summit fixes a
heading only against an assumed pitch.

**At the south direction, `F2.pose` rests on exactly two summits, and there is no
redundancy.** The frame holds Deer Point and Doe Point and no other summit inside 3 km
(§ 2.0), so the solve has the two it needs and not one more. Deer Point carries the only
registered apex rule; Doe Point carries none, and the two map annotators of the rehearsal
frame put it 0.656° apart, which is `truth-disputed`. **A disputed Doe Point therefore takes
south `F2.pose` to `no-sample`**, and that is the expected outcome rather than a surprise.
What this session can confirm accordingly rests on `F2.pose` at the north-east direction and
on F5, not on the south frame alone.

**The north-east direction is registered, and F3 and F4 do not grade it.** § 2.7 adds two
captures centred about 45° true, toward Hawley Mountain, Charters Mountain, Scott Mountain,
Jackson Peak, Wilson Peak, Freeman Peak, Pilot Peak, Sunset Mountain, Granite Mountain and
Grand Mountain — 20 to 60 km out, at apparent altitudes of about −1.3° to +0.4°, which is a
skyline rather than ground. They are taken after the south drag, under the gross heading
offset the Deer Point re-anchor set and carried across the turn, with **no new anchor**: the
Sun is not in a north-east frame at any hour this protocol allows, and a second re-anchor
would throw away the first direction's compass reading.

- **What they feed**: F2 on the drawn markers, in the `distant` and `horizon` bands;
  `F2.pose`, which has two located summits more than 20° apart to solve with; and F5b.
- **What they do not feed**: **F3 and F4**. Those two criteria are about a drag, and these
  captures carry a trim set on a summit about 100° away. The grader gives them their own
  capture role so that neither criterion reads them and neither reports them off-protocol
  (§ 3). Their F2 observations carry that trim as part of the error, which is what F2's claim
  — the band holds the error the app is making — is about.
- **Pre-declared, before the drive**: the north-east direction has **n = 0 frames behind
  it**. No photograph in this repository was taken facing that way from this viewpoint, so
  clear air there is a bet rather than a measurement. **A hazy north-east gives `no-sample`,
  as predicted here**, exactly as a hazy south does for `far` and `distant`.
- **Freeman Peak and Pilot Peak are pre-declared one unresolvable pair.** Computed from the
  committed peak data at the site coordinate, their bearings differ by **0.10°** (56.68° and
  56.78°) at 36.5 km and 38.4 km. That is a tenth of one annotator pick at this frame's
  scale, so an annotator who places one places both: the pair contributes one observation at
  most, and a swap between the two is not counted as an error.
- **Names repeat in this region and ids do not.** Inside 60 km it holds two Bald Mountain and
  two Sheep Mountain. Annotators work from summit ids and published heights, as § 1.3 term 1
  already requires, and a brief that named a summit by name alone would be ambiguous here.

**Failure.** A raw error outside a band that carried only measured terms, on a marker or at
the pose. That is the app claiming a bound it does not hold, and it is the most serious failure available here:
**it is fixed before the field data is used for anything else**, because every other
criterion is read through a band the app would then be known to understate.

### 2.3 F3 — After one drag

**Claim.** After one drag anchored on one summit, every other labelled summit sits within
the budget.

**The exact measurement.** For each graded summit in each after-drag capture, the absolute
frame-angle residual between the marker as drawn and the truth apex, per axis. Frame angles
are the tangent-plane angles about the optical axis, which is exactly what the drag trims.

**The anchor is excluded from the graded set.** The capture names the summit the drag was
anchored on (`dragAnchorSummitId`), and that summit is not graded in the capture it anchored.
The drag aligned the overlay onto it, so its residual is the drag's own precision and the
annotators' reading of one apex: `(e_a − e_a) + (drag precision)` by § 1.1, near zero by
construction. Grading it would report the anchor against itself, and three captures anchored
on the same summit would clear the stop rule on three copies of that one number. The anchor is
**reported, with its residual, as "anchor, not graded", and counted** — the count is what says
how many observations the rule removed, and the residual is the field measurement of the drag
that § 1.6 asks for. It is not part of any band's verdict.

**Sample.** Every graded summit in every after-drag capture except that capture's anchor,
binned by distance.

**Limits — 2σ of the budget in §1.5 rounded to 0.05°, and 3σ at 1.5 × that, rounded up:**

| band | distance | 2σ H | 2σ V | 3σ H | 3σ V | 2σ at a 1920 px frame |
|---|---|---|---|---|---|---|
| `near` | 0 to under 3 km | **1.90°** | **1.45°** | 2.85° | 2.20° | 42.4 px / 32.4 px |
| `mid` | 3 to under 7 km | **1.40°** | **1.30°** | 2.10° | 1.95° | 31.3 px / 29.0 px |
| `far` | 7 to under 20 km | **1.30°** | **1.30°** | 1.95° | 1.95° | 29.0 px / 29.0 px |
| `distant` | 20 to under 45 km | **1.30°** | **1.30°** | 1.95° | 1.95° | 29.0 px / 29.0 px |
| `horizon` | 45 km and beyond | **1.30°** | **1.30°** | 1.95° | 1.95° | 29.0 px / 29.0 px |

A band's lower bound is inclusive and its upper bound exclusive, so a summit exactly 3 km
away is graded against `mid`. A boundary goes to the tighter of the two bands. The last
three bands are identical because the budget is flat beyond 7 km, and collapsing them would
hide that; they are listed separately so the result reports n per band.

**Every summit is reported against the 2σ band.** Its residual, its axis, its frame offset
and its truth disagreement are printed whether it is inside or outside.

**The band's verdict counts exceedances:**

- **More than one summit-axis past 2σ in a band fails it.** The two axes of one summit count
  separately, because they are two draws.
- **Any summit-axis past 3σ fails the band on its own**, whatever else is in it.
- **A band with fewer than three graded summits may not pass.** It is reported `no-sample`
  under § 2.0's stop rule, with the truth instrument named. A band that fails the count
  above still fails at any n. A band whose only observations were the anchor says so, rather
  than naming the truth instrument: nothing was withheld there, and nothing was graded.

**Why one exceedance is tolerated, with the arithmetic.** The budget's terms are 1σ and each
summit-axis is one draw, so a *correct* budget puts draws outside 2σ at the normal rate:

```
P(|z| > 2) = 0.04550        P(|z| > 3) = 0.00270
p0 = P(inside 2σ)     = 0.95450
p1 = P(between 2σ, 3σ) = 0.04550 − 0.00270 = 0.04280
```

A gate of "every axis inside 2σ" passes a correct budget with probability `p0^n`:

```
n = 8 :  0.95450^8  = 0.689
n = 16:  0.95450^16 = 0.475
n = 32:  0.95450^32 = 0.225
```

At the 16 to 32 axis draws two or three captures produce, a correct budget would fail such a
gate between half and three quarters of the time. That gate measures the sample size rather
than the app. **Tolerating one 2σ exceedance and refusing any 3σ excursion** passes with
`p0^n + n·p1·p0^(n−1)`:

```
n = 8 :  0.689 + 8 × 0.04280 × 0.95450^7  = 0.689 + 0.247 = 0.936
n = 16:  0.475 + 16 × 0.04280 × 0.95450^15 = 0.475 + 0.341 = 0.815
```

So a correct budget passes a band at n = 8 with probability 0.936 and at n = 16 with 0.815,
and the gate still catches a budget that is wrong by a factor: two axes past 2σ, or one past
3σ, is what a 1.5× understated term looks like at this n. 2σ stays the band the app displays
and the figure every summit is reported against; 3σ is a limit no single draw should reach.

**When the capture reports a fix accuracy, the limits are recomputed from it** (term 3a), and
the tighter of the registered and the recomputed figure applies. For a 10 m accuracy, which
is 4.09 m of 1σ per axis:

| band | 2σ H | 2σ V | 3σ H | 3σ V |
|---|---|---|---|---|
| `near` | 1.75° | 1.45° | 2.65° | 2.20° |
| `mid` | 1.35° | 1.30° | 2.05° | 1.95° |
| `far` | 1.30° | 1.30° | 1.95° | 1.95° |
| `distant` | 1.25° | 1.30° | 1.90° | 1.95° |
| `horizon` | 1.25° | 1.30° | 1.90° | 1.95° |

The vertical column does not move, because the observer's height comes from the DEM rather
than from the fix. The near band moves most, which is where the observer term lives.

**Failure.** A band that fails the count above. **What happens then:** the residual is
decomposed against §1.3 — is it one summit (check the cross-release diff and the truth
disagreement), one axis (roll, or the observer-height choice), or a scale (field-of-view
calibration, which is distance-independent and grows with frame offset)? The budget is
corrected with evidence and the criterion is re-graded against the corrected figure in a
later session. The limit is not moved.

**Preconditions.** A capture whose field of view is the spec-sheet guess is not graded
(term 6). Two geometry checks are reported beside the verdicts rather than refusing the
capture, and each is made against the frame it belongs to:

- **The overlay's viewport**, read from `overlayPx` and the pose. More than 10 % off § 1.2's
  hFOV or aspect is reported as a deviation, because the roll and field-of-view terms were
  computed on that viewport.
- **The stored frame**, read from `framePx` and the camera track. Under 1920 px wide, or
  more than 2 % off the track's aspect, is reported as a deviation, because truth's
  precision and its placement depend on § 2.0's frame.

### 2.4 F4 — The same, after a pan and a tilt

**Claim.** The drag holds when the phone moves. A trim that only works at the pose it was
set at is a coincidence.

**The exact measurement.** From an after-drag capture, **pan until the anchor summit sits at
the frame edge** — left, then right — and tilt by ±10°. Hold 2 s each time and capture again
without re-dragging. Grade exactly as F3, against the same limits. Four movements per anchor
capture: anchor to the left edge, anchor to the right edge, +10° tilt, −10° tilt.

**"At the frame edge" is a number, read from the overlay as drawn.** The anchor summit's
marker must sit at a normalised horizontal offset **u ≥ 0.8** of the half-frame, where u = 0
is the frame centre and u = 1 the edge. On the 956 px landscape viewport that is 382 px or
more from the centre; on a 1920 px stored frame, 768 px. The offset is read from the drawn
overlay in the bundle, which is the same marker the person was looking at while panning. **How
far the phone turned is recorded and not gated**, because the turn needed depends on where
the anchor started: from the frame centre it is about 30°, from u = 0.5 about 10°.

The target is a pan the person can see themselves reach, rather than an angle they have to
estimate. Gating on the pan angle in the pose would gate the sensor's account of the motion
as well, inside a criterion whose subject is the drag.

**Sample.** Four movement captures per after-drag capture; the same graded summits, minus
any the movement pushed out of frame, and minus the anchor. A moved capture carries no drag
of its own, so its anchor is the one the after-drag capture it moved from
(`movedFromCaptureId`) was dragged onto, and the exclusion and the reporting of § 2.3 apply to
it unchanged. A moved capture that names its own `dragAnchorSummitId` is read by that. A capture whose anchor did not reach u = 0.8, or whose
anchor the overlay did not draw at all, is reported off-protocol and not graded. A tilt must
still be within 5–15°, read from the pose.

**Failure.** A band that fails F3's count, on the moved captures. Distinguishing F4 from F3
is the point: a residual that appears only after the movement implicates the sensors or the
roll, while one present in both is geometry.

**What the pan exercises.** At hFOV 73.74°, u = 0.8 puts the field-of-view scale term at
0.253° of the 0.275° available at the edge, so the pan probes 92 % of that term. It also
carries the anchor itself to 31° off the optical axis,
where a 0.5° roll displaces it by 0.270° vertically. The result reports each graded summit's
frame offset u, so an edge effect can be told from a whole-frame one.

### 2.5 F5 — What the labels claim

Three separate claims, each gated, each reported separately.

**F5a — No false `visible`.** A summit drawn `visible` that both annotators independently
report as **`absent`** — the region where it would sit is clear sky, or blocked by a
foreground object — is a false `visible`. **Threshold: zero.** One is a failure.
`marginal` is excluded: it is the honest output of a ±1.8° near-field band (term 4) and
carries "may be hidden" on screen. A summit the annotators disagree about is
`truth-disputed`, reported, and not counted in either direction. **A summit either annotator
answered `cannotIdentify` on is excluded and counted**, because "I cannot tell" is not
evidence that the mountain is missing; the count of exclusions is reported beside the
verdict, and a criterion that excluded most of its sample says so.
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

### 2.7 The steps on site

The order the session is run in, because several criteria depend on it.

1. **Stand within a few hundred metres of the site coordinate.** The terrain package is cut
   for that disc with 0.5 km of margin (`terrainMarginKm`), so a viewpoint inside a few
   hundred metres of it is still covered to the full sweep radius in every direction. A walk
   further than that reaches ground the cut does not hold, and the sweep then reports a
   summit as visible that a wider cut would show hidden.
2. Open the page in airplane mode and time three cold starts (F1).
3. Calibrate the field of view from two taps (term 6). Nothing after this is graded without
   it.
4. Let the fix settle, and check the accuracy the screen reports. Above 30 m, wait and
   re-acquire (term 3a).
5. Brace: two hands, elbows on a rail or a knee (term 7).
6. **Face south, toward Deer Point and Doe Point**, and frame it so the near ridge and the
   sky above it are both in the picture: hold the phone level and let the ridge sit in the
   lower half rather than tilting down onto it. Doe Point is in the picture and is not the
   anchor.
7. Capture before the drag (F2), hold still for 2 s first (term 8).
8. **Drag onto Deer Point**, and capture again (F3). Deer Point is the registered anchor:
   it is the one summit in this frame that carries an apex rule (§ 2.0), and the anchor is
   excluded from grading, so anchoring on the one rule-bound summit leaves the graded set
   free of the feature-to-node term that rule carries.
9. Without re-dragging: pan until Deer Point sits at the frame edge, left and then right,
   and tilt ±10°. Hold 2 s and capture each time (F4).
10. Repeat the drag onto Deer Point three times, so its spread is recorded (§ 1.6).
11. **Turn to face north-east, about 45° true, and capture twice.** Do not drag anything and
    do not re-anchor: the trim and the gross heading offset travel round the turn with you.
    These two captures feed F2, `F2.pose` and F5b, and F3 and F4 do not read them (§ 2.2).
12. Note the minutes each step took (F6).

---

## Part 3 — How a run is graded

`src/live/field-analysis.ts` holds the schema, the parser, the limits above as data, the
budget terms § 2.3's recomputation needs, and the F2–F5 arithmetic. `npm run analyze:field -- <bundle> <truth>` prints the verdicts.
F1 and F6 are stopwatch numbers recorded by the person on site and are not computed from a
bundle.

**The thresholds live in code as `PREREGISTERED_THRESHOLDS`**, and the analyzer takes no
threshold argument. A run cannot be graded against anything but this document, and changing
a number there changes it here, in the same commit, with the reason.

**The anchor of each after-drag and moved capture is printed apart from the graded table**,
with its residual and its band, under `F3.anchor` and `F4.anchor`. A capture's anchor is its
own `dragAnchorSummitId`, or, for a moved capture that carries none, the anchor of the capture
its `movedFromCaptureId` names.

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

**What it does carry about the fix is one number per capture**: `horizontalAccuracyM`, the
platform's own horizontal accuracy, under a bundle-level `accuracyConvention` that names what
the number means. A radius is not a position: it says how well the phone knew where it was,
not where that was. A bare `accuracy` key, which is the shape a whole fix arrives in, is
refused.

**Each capture's pose says what was done to its heading**: the fine trim, the gross
re-anchor offset in [−180°, 180°], and what set that offset — `sensors` when nobody
re-anchored, otherwise `sun` or `summit`. Subtracting the two leaves the reading the
compass alone gave, which is what § 2.2's pose-level check grades. The parser requires
both keys.

**The truth document is `mountain-finder/field-apex-truth@2`**, and the parser refuses the
`@1` format outright rather than reading it. `@1` wrote `apexPx: null` for everything an
annotator did not locate, which conflated "the summit is not in this frame" with "I cannot
identify it"; the two grade in opposite directions under § 2.0, so a document that cannot
tell them apart is re-annotated rather than reinterpreted. Each annotation is exactly one of
an apex pixel, `absent` with its reason, or `cannotIdentify`, and each reading names the
method it was made under.

**An apex may carry a `rule`**, the registered apex rule the annotator followed, quoted. It
is optional, so a truth document written without one is read unchanged, and a summit counts
as rule-bound only when both annotators quoted a rule. The report prints how many graded
summits were rule-bound and the truth disagreement of the rule-bound and the free summits
apart (§ 2.0). A rule on an answer that locates nothing is refused, as a landmark already is.

**A capture of the north-east direction carries the role `turned`.** F3 and F4 read only the
`after-drag` and `moved` roles, so a turned capture reaches neither, and the movement
envelope check reads only `moved`, so neither is it reported off-protocol. F2 and `F2.pose`
read `before-drag` and `turned` together. A turned capture names no `dragAnchorSummitId` and
no `movedFromCaptureId`, and the parser refuses one that does: nothing was dragged in that
direction and nothing was moved from a reference frame.

`fixtures/field/` holds synthetic bundles with known injected errors, and nothing recorded
from a phone.

---

## Revision history

Every revision of this document is dated, and says what changed and why. A revision after
the field data exists must also say what it would have done to the run already graded.

### 2026-09-29 — written

The budget and criteria F1–F6, before any field number existed.

### 2026-09-29 — the error-budget review

Six changes, all still before any field number exists, from a review of the budget against
the site package and the app as built.

- **The F3/F4 gate counts exceedances (§ 2.3).** "Every summit inside 2σ" passes a correct
  budget with probability 0.225 at 32 axis draws, so it measured the sample size. A band now
  fails on more than one summit-axis past 2σ, or on any axis past 3σ. 2σ stays the band every
  summit is reported against, and a 3σ column is added at 1.5 × the 2σ figure.
- **F4's pan becomes "until the anchor summit sits at the frame edge" (§ 2.4)**, defined as
  the anchor's drawn offset reaching u = 0.8 of the half-frame, replacing a ±20° envelope read
  from the pose. The target is one the person can see, and it exercises 92 % of the
  field-of-view scale term instead of 67 %.
- **The observer's position term is measured, not assumed (§ 1.3 term 3a, § 2.3).** Each
  capture records the platform's horizontal accuracy and the convention it is read under; the
  budget converts it to a per-axis 1σ at r/2.4477 and recomputes the band's limits, but only
  where that tightens them. The 30 m refusal stands, and the 15 m n = 1 figure remains the
  fallback when no accuracy was reported.
- **The drag and roll terms are scheduled for measurement (§ 1.6).** The home session measures
  the drag spread in normal and 4× fine mode and the braced roll spread; the limits are
  re-derived from those measurements before the field session, and the re-derivation is
  recorded here.
- **The site radius is decided (§ 2.1).** The session carries the 60 km terrain and the live
  sweep takes its range from the served site, because 63 of the 104 summits within 60 km lie
  beyond the app's 30 km default and the ten highest by apparent height are all 34–58 km out.
- **Text corrections.** The anchor at the proposed site is 35–57 km away, not 7–20 km, and the
  7–20 km charge is now labelled as the conservative choice it is (§ 1.1). The `near` and `mid`
  bands are pre-declared as likely `no-sample` (§ 2.0). F2 is conditional on the field-of-view
  calibration, as F3 and F4 already were (§ 2.2). The steps on site are written down, starting
  with standing within a few hundred metres of the site coordinate (§ 2.7). Three cells of
  § 1.5 were rounded the wrong way and now read 0.286°, 0.689° and 0.627°.

### 2026-09-29 — the vertical band gets a tilt-bias term

Still before any field number exists. F2's vertical axis would have failed by construction on a
phone, because the band it is graded against had no term for the one error that dominates it.

- **§ 2.2 states when F2's vertical axis is gated and when it is only recorded.** The live
  band's vertical terms were the tilt scatter over the last second and, once the field of view
  was calibrated, nothing else — so a braced phone's band claimed the pitch was known to a few
  thousandths of a degree while an unchecked gravity zero can sit whole degrees off. The band
  now carries an explicit unquantified term, "Tilt zero point never checked", until a
  measurement exists, which puts the vertical axis in `recorded-not-gated` under the rule
  § 2.2 already had. Nothing about the thresholds moved; what changed is that the band no
  longer claims a bound it does not hold.
- **The home session measures the term.** The three aiming steps ask for the Sun in the middle
  of the frame, so the camera axis sits at the Sun's altitude, a figure the recording already
  carries. The analyzer reads the sensed tilt against it, reports the bias and how far two
  re-aims land apart, and the band charges both. Once a measurement is stored, F2's vertical
  axis is gated like the horizontal one.
- **The compass's own accuracy figure is checked at the same steps.** The analyzer reports the
  reading's bias against the Sun's magnetic azimuth beside the `webkitCompassAccuracy` the phone
  claimed, which says whether that claim covers the error. Term 3's horizontal figures are
  unchanged until the session produces a number.

### 2026-09-29 — the viewport and the stored frame registered apart

Still before any field number exists. The registration named one frame where the session
works in two, and the grader checked the wrong one against it.

- **§ 1.2 registers the overlay's viewport**, and says which terms belong to it: the roll and
  field-of-view scale terms, which grow with the drawn offset from the optical axis, and the
  drag term, which is a finger against the viewport's px-per-degree.
- **§ 2.0 registers the stored frame separately**: at least 1920 px wide, with an aspect ratio
  equal to the camera track's to within 2 %. Truth's precision depends on the width and
  truth's placement on the frame being stored whole. The 2 % passes a stored height rounded
  to whole pixels, under 0.05 % at 1920 px wide, and refuses a crop, which is 25 % for 4:3
  against 16:9.
- **§ 2.3 grades each frame against its own registration.** Before this, a 1920 × 1080 stored
  frame was reported as 18.2 % off the 956 × 440 viewport on every capture the app produced,
  which is the two frames being different sizes rather than anything wrong with either.

Nothing about the thresholds, the bands or the criteria moved.

### 2026-09-29 — the overlay is drawn over a crop of the stored frame

Still before any field number exists. § 2.0 registered the two frames apart and the grader
checked each against its own registration, but it still converted between them by a plain
ratio of widths and of heights. That is right only when the two share an aspect ratio, and
on a phone they do not.

- **The mapping goes through the crop the screen makes (§ 2.0, § 3).** The AR screen draws
  the camera at `object-fit: cover`: the frame is scaled by `max(viewW/trackW, viewH/trackH)`
  and the overflow is cut evenly off the two ends of whichever axis overflows. A 16:9 stream
  in the registered 956 × 440 viewport puts 81.8 % of the frame's height on screen, and a
  4:3 stream puts 75 % of it there. A drawn marker is placed on the stored frame through
  that same geometry, and the angles are taken with the whole frame's field of view rather
  than the visible box's, which is what the pose carries.
- **What the plain ratio was doing.** For the 1920 × 1080 stream this session expects, it
  scaled a vertical offset by 1080/440 = 2.45 where the truth is 1920/956 = 2.01, about a
  centre 98 px from the one the overlay was drawn about. A vertical residual came out
  roughly 22 % too large, and grew with distance from the frame centre. Nothing in the
  output said so.
- **A capture that records no camera track size is refused (§ 2.0).** The crop cannot be
  recovered from anything else the bundle carries, and a guess that nothing was cropped is
  the error above.
- **A capture graded with a caveat is reported apart from one not graded at all (§ 3).** A
  frame deviation or a summit whose height disagrees with the committed peak data leaves the
  geometry measurable; it says what the measurement is worth. Both were printed under "not
  graded", so a run reported captures as lost that it had in fact graded.

Nothing about the thresholds, the bands or the criteria moved. `analyze:field` on the two
committed fixture pairs is unchanged except for one vertical residual, 0.849° to 0.850°:
those fixtures' viewport and stored frame are 0.036 % apart in aspect, so the whole frame's
vertical field of view is 0.03 % wider than the visible box's.

### 2026-09-29 — truth gets three answers, a stop rule, and a near-band capture

Still before any field number exists. The rehearsal annotation was the truth instrument's
first run: two independent agents, given a bare Bogus Basin frame and 17 summit names,
returned nothing for all 17 — correctly, because the rehearsal pose was 92° off and none of
them were in the picture — and both independently placed the Deer Point radio-tower summit
within about 10 px of each other. The instrument works. Its schema did not: it had one
answer, `apexPx: null`, for both "the summit is not there" and "I cannot identify it", and
F5a read the second as the first. A hazy foothill nobody could name would have been graded
as a mountain the app fabricated.

- **Truth has three answers per summit per annotator (§ 2.0).** An apex pixel; `absent` with
  the reason the region holds no summit, `clear-sky` or `foreground-blocked`, which the
  annotator must choose; or `cannotIdentify`. Only an agreed `absent` counts toward F5a's
  false-`visible` claim (§ 2.5). `cannotIdentify` from either annotator excludes the summit
  from F3, F4 and F5a, and the count is reported. Two apexes go to the existing 0.30° rule;
  an `absent` against an apex is `truth-disputed`.
- **The `@1` truth format is refused, not reinterpreted (§ 3).** No field data exists, so
  nothing depends on reading it. The parser names the format, says why it is not read, and
  says what to write instead. The committed fixtures are regenerated in the new format.
- **Landmark truth is registered (§ 2.0).** A summit whose committed position carries a
  sharp point feature may be annotated from it, with the target point named in the brief and
  the feature recorded in a `landmark` field. The grader treats it as any other apex and
  reports those observations apart, because a mast is a finer target than a skyline.
- **Each reading records what its annotator was given (§ 2.0).** Either the bare frame and
  the summit names, or those plus the viewpoint and a topographic map. Both are allowed and
  the report says which. Neither ever includes the app's projection or the pose.
- **A stop rule (§ 2.0, § 2.3).** A band whose truth yields fewer than three graded summits
  is reported `no-sample` and the report says the truth instrument, not the app, limited it,
  naming how many summits were drawn in that band and how many were settled. Three is the
  smallest count at which the exceedance gate tells one unlucky draw from a wrong band. **A
  band that fails the gate still fails at any n**: one axis past 3σ refutes the budget on its
  own, and this document already holds that the session can refute the budget and cannot
  confirm it.
- **The near band is no longer pre-declared `no-sample` (§ 2.0, § 2.7).** The earlier
  pre-declaration read "below horizontal" as "out of frame". The rehearsal frame puts Deer
  Point 2 km away at −4.5° with the skyline still in shot, and the 38.1° vertical field of
  view reaches 19° below the optical axis. § 2.7 now registers one capture facing south
  toward Deer Point and Doe Point, framed so the near ridge and the sky sit in the same
  picture. The mid band's pre-declaration stands.

Nothing about the thresholds, the bands or the error budget moved. What moved is which
observations reach them.

### 2026-09-29 — the bundle carries the gross heading offset, and F2 is graded at the pose

Still before any field number exists. F2 would have reported `no-sample` on the one error
the field session was arranged around, a 92° compass reading, and `pass` on the same error
once the person corrected it on site.

- **A capture's pose carries `grossHeadingOffsetDeg` and `grossHeadingSource` (§ 2.2, § 3).**
  The re-anchor correction is unclamped and can be a quarter turn, so a pose that omits it
  is one where a corrected compass cannot be told from a compass that was right. Both keys
  are required by the parser rather than optional, and the offset is bounded to ±180°.
- **§ 2.2 registers `F2.pose`.** The heading the compass alone reported is compared with the
  heading the located summits solve for, gated on the displayed band's horizontal
  half-width under the per-axis rule § 2.2 already had. It is graded whenever a before-drag
  capture holds two or more located summits, and reports `no-sample` below that.
- **The solve takes the summits' directions from the markers the app drew, at the pose it
  drew with.** That cancels the compass out: what is left is the geometry the peak data and
  the observer's fix give, which is what the truth apexes are then fitted against. Heading
  and pitch are solved together and roll is taken from the pose.

Nothing about the thresholds, the bands or the error budget moved. `analyze:field` on the
two committed fixture pairs is unchanged except for the new criterion line: the aligned
pair's compass sits 4.077° from the heading its four located summits solve for, inside the
8.700° band that capture displayed, and the stray pair's single capture is `after-drag`, so
the criterion has nothing to read.

### 2026-09-29 — the drag anchor is excluded from F3 and F4

Still before any field number exists. F3 and F4 graded the summit the drag was anchored on,
which measures the drag against itself.

- **§ 2.3 excludes each capture's `dragAnchorSummitId` from the graded set**, and § 2.4 does
  the same for the moved captures, which inherit the anchor of the capture they moved from.
  The residual of an anchored summit is `(e_a − e_a) + (drag precision)` under § 1.1, near
  zero by construction, so a band holding it reports the drag's precision as evidence about
  the peak data, the field of view and the roll.
- **The anchor is reported and counted, not dropped.** The grader prints its residual, its
  frame offset and its band as "anchor, not graded" and counts the observations under
  `F3.anchor` and `F4.anchor`, so a reader can see how many the rule removed. Those residuals
  are the field measurement of the drag precision § 1.6 schedules.
- **What it would have done to the headless rehearsal.** Grading `out/rehearsal/bundle.json`
  reported `F3.near pass n = 3`. All three observations were Deer Point, the anchor, on the
  three after-drag captures, with residuals of 0.215° across and 0.049–0.064° up/down. The
  band now reports `no-sample` and names the anchor as the reason. `F4.near` reported `fail`
  on four observations that were the same anchor on the four moved captures, and now reports
  `no-sample` as well.
- **§ 2.3's stop rule distinguishes two empty bands.** A band the truth instrument could not
  settle names the instrument; a band whose only observations were the anchor says that
  instead.

Nothing about the thresholds, the bands or the error budget moved. What moved is which
observations reach them.

### 2026-09-29 — the site's own limits, the apex rules, and a second direction

Still before any field number exists. The criteria were registered against a site that
cannot supply some of them, and the truth instrument had no written rule for the one
ambiguity it had already hit.

- **F3.near and F4.near are pre-declared `no-sample` by construction (§ 2.0).** Four summits
  sit within 3 km of the viewpoint besides Shafer Butte, no 73.74° frame holds more than two
  of them, and one of those two is the drag anchor. One possible graded summit is under a
  stop rule that asks for three.
- **The south direction's reachable bands are named (§ 2.0).** `mid` needs Little Deer Point,
  Lower Point and Gardiner Peak all placed; `far` has five candidates of which three must be
  settled; a hazy day is predicted to give `no-sample` in `far` and `distant`.
- **Apex rules are registered, and there is one (§ 2.0).** A rule is written before any field
  data by an agent who sees only a rehearsal frame and the annotator maps, names a physical
  feature and nothing else, and carries an unquantified feature-to-node term. Deer Point's
  rule is "the crest under the tallest mast". Doe Point got none: the 10 km map puts the Doe
  and Deer Point nodes about 250 m apart inside one closed contour, so terrain cannot tie
  Doe Point's small mast to its node. Deer Point is the anchor, so the rule-bound count is
  expected to read zero in every graded band.
- **A prediction may direct attention and never place a pixel (§ 2.0).** Both map annotators
  of the rehearsal frame fitted a focal length and predicted bearings, which is the app's own
  pinhole model.
- **`F2.pose` at the south direction rests on two summits with no redundancy (§ 2.2)**, and a
  disputed Doe Point — 0.656° on the rehearsal frame — takes it to `no-sample`. What the
  session can confirm rests on `F2.pose` at the north-east direction and on F5.
- **Two north-east captures are registered (§ 2.2, § 2.7)**, about 45° true, taken after the
  south drag under the carried gross offset with no new anchor. They feed F2, `F2.pose` and
  F5b, and F3 and F4 do not read them. The direction has n = 0 frames behind it; Freeman and
  Pilot Peak are one unresolvable pair at 0.10° of bearing; the region repeats two summit
  names inside 60 km, and annotators work from ids.
- **The anchor is Deer Point at 2.0 km (§ 1.1, § 2.7).** The § 1.5 table charges the anchor at
  7–20 km, which is not conservative for a 2 km anchor: carrying 2 km through would raise
  the horizontal 1σ to 1.182° at 2 km and 0.951° at 10 km. The table and the limits are left
  as written, and the gap is stated so a marginal failure is decomposed against it first.
- **The grader carries both (§ 3).** An apex may quote the rule it followed, and the report
  splits the graded summits and their disagreement by it. A north-east capture carries the
  role `turned`, which F2 and `F2.pose` read and F3, F4 and the movement-envelope check do
  not.

Nothing about the thresholds, the bands or the error budget moved.
