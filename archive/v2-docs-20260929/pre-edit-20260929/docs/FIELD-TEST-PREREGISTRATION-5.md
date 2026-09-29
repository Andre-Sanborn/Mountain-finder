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
  it is what F3 and F4 gate on. F3 gates on one number per summit per axis, the median over
  the captures that settled it, and F4 on how that number changed when the phone moved;
  § 1.5 says what the median does to each term.

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
which one (`dragAnchorSummitId`). **The table below charges the anchor at its own
distance**, which is a protocol input rather than an assumption: the anchor is named before
the session, so how far away it is is known before any residual exists.

**The registered anchor at this site is Deer Point, 2.0 km away** (§ 2.7). It is the summit
the session faces, and the only one in that frame carrying a registered apex rule (§ 2.0).
A near anchor carries a large angular error, and every other summit inherits it: 25 m of
horizontal geodesy is 0.716° at 2 km, 0.143° at 10 km and 0.026° at 55 km. The anchor term
in § 1.5 is therefore 0.716° horizontally and 0.327° vertically on every row, and it is the
largest term in the budget beyond 3 km.

The committed peak data puts Deer Point at 2.025 km. The table is computed at the 2.0 km
§ 2.7 registers; the 25 m between them is worth 0.009° of anchor term, which no limit's
0.05° rounding can see.

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
reader can see how much the choice is worth: at 2 km the linear sum is 2.284° horizontally
against an RSS of 1.182°, a factor of 1.93; at 10 km it is 1.711° against 0.951°, a factor
of 1.80; at 60 km it is 1.592° against 0.941°, a factor of 1.69.

### 1.5 The budget, per distance band

Per-summit 1σ, at the frame edge (u = 1.0, the worst position in the frame), anchored on the
registered 2 km summit, with the calibrated field of view, the DEM-ground observer height
and the 2 s hold:

| D | peak+obs, H | peak+obs, V | anchor H | anchor V | FOV H | FOV V | roll H | roll V | drag | **1σ H** | **1σ V** |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 km | 0.716° | 0.327° | 0.716° | 0.327° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **1.182°** | **0.783°** |
| 5 km | 0.286° | 0.131° | 0.716° | 0.327° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.983°** | **0.724°** |
| 10 km | 0.143° | 0.065° | 0.716° | 0.327° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.951°** | **0.715°** |
| 30 km | 0.048° | 0.022° | 0.716° | 0.327° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.942°** | **0.712°** |
| 60 km | 0.024° | 0.011° | 0.716° | 0.327° | 0.275° | 0.039° | 0.034° | 0.322° | 0.543° | **0.941°** | **0.712°** |

Horizontal geodesy is `sqrt(20² + 15²) = 25 m` over D; vertical is
`sqrt(5.5² + 10²) = 11.41 m` over D. When a capture reports its own fix accuracy, the 15 m
becomes that fix's per-axis 1σ by term 3a and the row is recomputed for that capture; § 2.3
gives the recomputed limits for a 10 m fix.

**The headline.** Beyond about 3 km the budget is flat, because the drag, the roll, the
field-of-view scale and the anchor's own error do not care how far away the graded summit
is, and together they are 0.94° horizontally. The graded summit's own geodesy only matters
in the near band: at 2 km it is 0.716° horizontally, the largest single term in the row;
at 10 km it is 0.143°, a seventh of the total; at 60 km it is 0.024°, invisible. **So a
60 km summit is still no harder to label than a 10 km one**, which is worth knowing before
anyone budgets a 42 MB terrain mosaic to reach one.

**What is expensive here is the anchor, not the distance.** A drag subtracts the anchor's
own error from every other summit, so the anchor's distance sets the whole table. At the
registered 2 km it contributes 0.716° horizontally and the flat floor is 0.94°; an anchor
10 km out would contribute 0.143° and put that floor at 0.61°, with every row 0.23° to
0.31° tighter. The sensitivity is worth carrying into any later site: a near anchor is the
easiest summit to drag onto and the most expensive one to inherit.

#### The unit the table is a budget for, and what k does to it

**The graded unit is one summit-axis, not one capture-axis.** The session takes three
after-drag captures (§ 2.7 step 10) and they grade the same summits, so a summit whose
position is 40 m out appears in all three at the same size. The unit's value is the
**median signed residual** over the captures that settled it, and `k` is how many those
are: after-drag captures where both annotators located the summit. § 2.3 gates on the
units.

**The median moves exactly one term.** Terms 1, 2, 3a, 3b, the anchor's own error and the
field-of-view scale are single errors carried unchanged into every capture: the median of
k copies of one number is that number. Roll is the same here, because step 10 re-drags
without re-bracing, so the three captures share one hold. The **drag** is re-made per
capture, so the median of k drags carries a fraction of one drag's spread:

| k | factor | where it comes from | drag term |
|---|---|---|---|
| 1 | 1 | one drag | 0.543° |
| 2 | 0.70711 | the median of two is their mean, so 1/√2 | 0.384° |
| 3 | 0.66983 | the standard deviation of the median of three | 0.364° |

The k = 3 figure is derived rather than looked up. The median of three iid standard
normals has density `6·Φ(x)(1−Φ(x))·φ(x)`, so

```
Var = 6∫x²φΦ dx − 6∫x²φΦ² dx
    = 6·(1/2) − 6·(1/3 + √3/6π)        [∫x²φΦ = 1/2 by symmetry; ∫x²φΦ² = 1/3 + √3/6π]
    = 1 − √3/π
    = 0.448671
```

and the standard deviation is `√0.448671 = 0.669829`. A test integrates the density
numerically and gets the same figure, which is a second instrument on the closed form.

**The truth read is not in this table, at any k.** § 1.3 charges no term for how precisely
an annotator locates an apex; the instrument is controlled by the § 2.0 disagreement limit
of 0.3°, which refuses a grade rather than budgeting one. That is a deliberate omission,
and it is defensible here because a truth read of about 0.1° is under 1 % of a 0.95°
budget's variance. It re-draws per capture — each capture is a separately annotated frame
— so if it were charged it would shrink with the median exactly as the drag does, and the
table would not widen. § 2.4 is where the omission stops being safe, and that section
charges it.

**Per k, beyond 7 km**, where the budget is flat and the session's summits mostly sit:

| k | 1σ H | 1σ V | drag as a share of the horizontal variance |
|---|---|---|---|
| 1 | 0.951° | 0.715° | 33 % |
| 2 | 0.870° | 0.603° | 19 % |
| 3 | 0.862° | 0.590° | 18 % |

Most of what a repeated drag buys arrives with the second capture. Beyond that the anchor's
own 0.716° dominates and nothing the session can do at the viewpoint moves it.

### 1.6 The two terms that are measured before the session

Two of the terms above are judgements rather than measurements, and beyond 3 km they are the
two largest that are not geodesy: only the anchor's own position error, at 0.716°
horizontally, is larger. **Both are measured in the home session, and the limits are re-derived from
those measurements before the field session** — not from a second judgement.

- **Drag precision (term 9), assumed 0.543°.** The home session records three repeated drags
  onto the same reference, in the normal drag mode and again in the 4× fine mode the screen
  now offers. The measurement is the spread of the trims those drags produce, per axis, in
  degrees. Two figures come out of it: the spread in normal mode, which replaces the 1 mm
  finger-placement assumption, and the spread in fine mode, which says what the fine mode is
  worth. Whether the field session drags in fine mode is decided by that second figure.
  **This one measurement moves all three rows of the per-k table**, because the k = 2 and
  k = 3 rows are that same term times a factor that is arithmetic rather than assumption.
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
   as `truth-disputed` with its disagreement. 0.30° is under a quarter of the tightest F3
   threshold, which is 1.45°: truth at least four times finer than the tolerance is the
   least that makes a verdict mean anything.
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
   followed in a `rule` field on the apex, **quoted verbatim from the list below** — the
   parser refuses any other text, so the two annotators of a rule-bound summit agree on which
   rule was in force by construction. A summit counts as rule-bound only when both quoted it.
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

**F3.near is site-limited, and is expected `no-sample` by construction; so is every near
summit F4 could pair.**
Within 3 km of the viewpoint the package holds four summits besides Shafer Butte itself:
Doe Point 1.9 km at 198°, Deer Point 2.0 km at 204°, Bob's Knob 2.1 km at 123° and Mores
Mountain 2.2 km at 356°. At the registered 73.74° hFOV a frame holds no more than two of
them at once — Doe Point and Deer Point, 6.6° apart; the next nearest pair, Doe Point and
Bob's Knob, is 75.0° apart — and one of those two is the drag anchor, which § 2.3 excludes.
The near band's whole possible graded sample is therefore Doe Point, one summit against a
stop rule that asks for three.

A frame wider than the registration would hold three: § 1.2 reports rather than refuses a
viewport up to 10 % off, so a capture drawn at up to 81.1° could reach Bob's Knob as well.
That does not change the outcome. Three drawn summits are two graded ones once the anchor is
excluded, and the stop rule asks for three graded. **The site limits this, not the app**, and
it is written here for the same reason the other pre-declared limits are.

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
`far`, `distant` and `horizon` bands are all reached by the north-east direction § 2.7
registers, which F3 and F4 do not grade at all (§ 2.2).

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
Grand Mountain — 25 to 55 km out, at apparent altitudes from about −0.7° (Charters Mountain)
to +0.1° (Freeman Peak), computed at a 1.6 m eye height with refraction at k = 0.13. That is
a skyline at or just below level rather than ground. They are taken after the south drag,
under the gross heading offset the Deer Point re-anchor set and carried across the turn, with
**no new anchor**: a second re-anchor would throw away the first direction's compass reading,
and outside May to August the Sun is never in a north-east frame at an altitude this protocol
would use.

**In May, June, July and early August the north-east captures are taken in the afternoon.**
From the site coordinate the morning Sun sits at azimuth 72° to 82° and 15° to 26° above the
horizon between about 07:30 and 08:45 MDT, which is inside the 8.1° to 81.9° span of a 73.74°
frame centred on 45°, and usually inside its vertical span too. Shooting into it washes the
skyline out and would make the direction unusable for both annotators. From September to
April the Sun never reaches that corner of the sky at a working altitude, and the hour is
free.

- **What they feed**: F2 on the drawn markers; `F2.pose`, which has two located summits more
  than 20° apart to solve with; and all three parts of F5. F5a counts every summit they draw
  `visible`, F5b ranks each frame's three most prominent, and F5c reads each capture's sweep
  radius: the grader applies those three to every capture whatever its role.
- **Which F2 bands they reach.** Not only `distant` and `horizon`. The same frame holds
  Sugarloaf Rock at 7.6 km, Harris Creek Summit at 14.6 km and Warm Springs Point at 13.1 km,
  which are `far`, so a turned capture can report F2 observations in three bands.
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

**The exact measurement.** For each graded summit, the **median signed frame-angle residual
per axis** across the after-drag captures that settled it — the marker as drawn against the
truth apex, per capture, medianed. Frame angles are the tangent-plane angles about the
optical axis, which is exactly what the drag trims.

**The unit is one summit-axis, not one capture-axis.** The three after-drag captures grade
the same summits, so a summit whose peak position is 40 m out contributes the same error
three times. Counting each capture separately counts that one error three times, and it
also lets three captures of a single summit clear a stop rule written for three summits.
The median leaves every common term at its own size (§ 1.5) and shrinks only the drag,
which is the one term step 10 re-makes.

`k` is how many after-drag captures settled the summit: both annotators located it, and the
capture was graded. A unit's limits come from its own k.

**The anchor is excluded from the graded set.** The capture names the summit the drag was
anchored on (`dragAnchorSummitId`), and that summit is not graded in the capture it anchored.
The drag aligned the overlay onto it, so its residual is the drag's own precision and the
annotators' reading of one apex: `(e_a − e_a) + (drag precision)` by § 1.1, near zero by
construction. Grading it would report the anchor against itself. The anchor is
**reported, with its residual, as "anchor, not graded", and counted** — the count is what says
how many observations the rule removed, and the residual is the field measurement of the drag
that § 1.6 asks for. It is not part of any band's verdict.

**A slipped drag is reported, and gated by nothing.** An after-drag capture whose anchor
residual exceeds **three drag terms — 3 × 0.543° = 1.63°** — on either axis is a drag that
did not land where the person meant it to, because the anchor's residual is that one term
and nothing else. The report names the capture, its anchor residual, and **how many units'
medians include that capture**, so a reader can see what the bad drag reached. Nothing is
failed on it: a median over three captures survives one bad draw, and a rule that discarded
the capture would let the grader choose which observations to keep.

**Sample.** Every graded summit in the after-drag captures except the anchor, binned by
distance, one unit per summit per axis.

**Limits — 2σ of the budget in § 1.5 rounded to the nearest 0.05°, and 3σ at 1.5 × that,
rounded up. One table per k:**

**k = 1** — the summit was settled in one after-drag capture:

| band | distance | 2σ H | 2σ V | 3σ H | 3σ V | 2σ at a 1920 px frame |
|---|---|---|---|---|---|---|
| `near` | 0 to under 3 km | **2.35°** | **1.55°** | 3.55° | 2.35° | 52.5 px / 34.6 px |
| `mid` | 3 to under 7 km | **1.95°** | **1.45°** | 2.95° | 2.20° | 43.6 px / 32.4 px |
| `far` | 7 to under 20 km | **1.90°** | **1.45°** | 2.85° | 2.20° | 42.5 px / 32.4 px |
| `distant` | 20 to under 45 km | **1.90°** | **1.45°** | 2.85° | 2.20° | 42.5 px / 32.4 px |
| `horizon` | 45 km and beyond | **1.90°** | **1.45°** | 2.85° | 2.20° | 42.5 px / 32.4 px |

**k = 2** — the median of two captures, drag term 0.384°:

| band | 2σ H | 2σ V | 3σ H | 3σ V |
|---|---|---|---|---|
| `near` | **2.25°** | **1.35°** | 3.40° | 2.05° |
| `mid` | **1.80°** | **1.25°** | 2.70° | 1.90° |
| `far` | **1.75°** | **1.20°** | 2.65° | 1.80° |
| `distant` | **1.75°** | **1.20°** | 2.65° | 1.80° |
| `horizon` | **1.75°** | **1.20°** | 2.65° | 1.80° |

**k = 3** — the median of three captures, drag term 0.364°, which is what the protocol
produces for a summit visible throughout:

| band | 2σ H | 2σ V | 3σ H | 3σ V |
|---|---|---|---|---|
| `near` | **2.20°** | **1.35°** | 3.30° | 2.05° |
| `mid` | **1.80°** | **1.20°** | 2.70° | 1.80° |
| `far` | **1.70°** | **1.20°** | 2.55° | 1.80° |
| `distant` | **1.70°** | **1.20°** | 2.55° | 1.80° |
| `horizon` | **1.70°** | **1.20°** | 2.55° | 1.80° |

The raw 2σ figures the k = 3 far row rounds from are 1.7234° and 1.1810°. **A median over
more than three captures is charged at the k = 3 row**, because the table registers no
figure beyond three; that is the permissive direction, and the report says so on any unit
it applies to rather than letting it pass quietly.

**Why `near` is the loosest row by so much.** Its graded summit and the drag anchor are both
2 km away, so the geodesy is charged twice at its largest: 0.716° horizontally in each of two
terms. It is also the row this site cannot fill. § 2.0 pre-declares `F3.near` `no-sample`,
because the only graded near summit available is Doe Point and the stop rule asks for
three.

A band's lower bound is inclusive and its upper bound exclusive, so a summit exactly 3 km
away is graded against `mid`. A boundary goes to the tighter of the two bands. The last
three bands are identical because the budget is flat beyond 7 km: their raw 2σ figures
differ by under 0.01°, and only a rounding boundary separates the vertical ones, so all
three take the `far` row. Collapsing them would hide the flatness, so they are listed
separately and the result reports n per band.

**Every unit is reported against the 2σ band, and every capture behind it is printed.** The
unit's median, its axis, its limits and its truth disagreement appear whether it is inside
or outside, and under it one line per contributing capture with that capture's own signed
residual and frame offset. A median that hides a wild draw is a median a reader can still
see through.

**The band's verdict counts exceedances, on a schedule:**

- **More than the allowance of summit-axis units past 2σ in a band fails it.** The
  allowance is **one up to twelve units, two from thirteen to twenty-four**, and one more
  per further twelve. The two axes of one summit count separately, because they are two
  draws of two different terms.
- **Any summit-axis unit past 3σ fails the band on its own**, whatever else is in it.
- **A band with fewer than three graded summits may not pass.** It is reported `no-sample`
  under § 2.0's stop rule, with the truth instrument named. A band that fails the count
  above still fails at any n. A band whose only observations were the anchor says so, rather
  than naming the truth instrument: nothing was withheld there, and nothing was graded.

**What a correct app scores against that gate, with the arithmetic.** The budget's terms are
1σ and each unit is one draw, so a *correct* budget puts units outside 2σ at the normal rate:

```
P(|z| > 2) = 0.04550        P(|z| > 3) = 0.00270
p0 = P(inside 2σ)      = 0.95450
p1 = P(between 2σ, 3σ) = 0.04550 − 0.00270 = 0.04280
```

A gate tolerating `a` exceedances and refusing any 3σ excursion passes with
`Σ_{j≤a} C(n,j)·p1^j·p0^(n−j)`. A band here holds three to five summits, so it is **six to
ten units**:

```
n = 6  (3 summits, a = 1):  0.960
n = 8  (4 summits, a = 1):  0.936
n = 10 (5 summits, a = 1):  0.909
n = 12 (6 summits, a = 1):  0.880
n = 14 (7 summits, a = 2):  0.943
n = 24 (12 summits, a = 2): 0.861
```

So a correct budget passes a band with probability 0.96 at the smallest size this session
produces and 0.88 at the largest the first step reaches. A fixed allowance of one falls away
as n grows — it is 0.68 at n = 24 — which is why the schedule adds a second at thirteen
units rather than holding at one.

The gate still catches a budget wrong by a factor: two units past 2σ, or one past 3σ, is
what a 1.5× understated term looks like at these sizes. It remains short of an instrument
that could confirm a correct budget, which is why § 2.0 lets this session refute the budget
and not confirm it. One thing the arithmetic does not model is stated rather than buried:
the budget's terms are charged at the frame edge while a summit near the axis carries less,
which makes a band easier to fail than `Σ C(n,j)p1^j p0^(n−j)` says. 2σ stays the band the
app displays and the figure every unit is reported against; 3σ is a limit no single unit
should reach.

**When the capture reports a fix accuracy, the limits are recomputed from it** (term 3a), and
the tighter of the registered and the recomputed figure applies. A unit is recomputed at the
**worst** accuracy any of its captures reported, and a unit any of whose captures reported
none is graded against the registered row. For a 10 m accuracy, which is 4.09 m of 1σ per
axis, at k = 1:

| band | 2σ H | 2σ V | 3σ H | 3σ V |
|---|---|---|---|---|
| `near` | 2.10° | 1.55° | 3.15° | 2.35° |
| `mid` | 1.80° | 1.45° | 2.70° | 2.20° |
| `far` | 1.75° | 1.45° | 2.65° | 2.20° |
| `distant` | 1.70° | 1.45° | 2.55° | 2.20° |
| `horizon` | 1.70° | 1.45° | 2.55° | 2.20° |

The vertical column does not move, because the observer's height comes from the DEM rather
than from the fix. Every horizontal row moves, because the fix enters twice: once for the
graded summit and once for the 2 km anchor, whose term is the larger of the two beyond
3 km.

**Failure.** A band that fails the count above. **What happens then:** the residual is
decomposed against §1.3 — is it one summit (check the cross-release diff and the truth
disagreement), one axis (roll, or the observer-height choice), or a scale (field-of-view
calibration, which is distance-independent and grows with frame offset)? The per-capture
lines say whether the median hid a spread or the whole unit moved together. The budget is
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

**The movement.** From an after-drag capture, **pan until the anchor summit sits at the frame
edge** — left, then right — and tilt by ±10°. Hold 2 s each time and capture again
without re-dragging. Four movements per anchor capture: anchor to the left edge, anchor to
the right edge, +10° tilt, −10° tilt.

**The exact measurement: the paired change.** For each summit settled in both a moved
capture and the after-drag capture it moved from, the statistic is

```
change = (residual in the moved capture) − (residual in the reference capture)
```

per axis, signed. Not the moved capture's residual. A summit whose position is 40 m out is
40 m out in both frames, and a criterion whose subject is the movement should not be graded
on an error the movement did not cause. The difference cancels everything the two frames
share and leaves what the movement did.

**Unit: one summit-axis per movement.** The gated group is the movement, not the band,
because each moved capture is one pan or one tilt and a residual that appears after one of
them is the thing this criterion is looking for.

**The budget for the change.** Four terms survive the difference; every other term of § 1.5
cancels.

| term | 1σ H | 1σ V | why it survives |
|---|---|---|---|
| field-of-view scale | 0.275° | 0.039° | one calibration error, displacing a marker in proportion to its offset from the axis; the pair keeps `ε·(u_moved − u_reference)`, charged at the frame edge as § 1.5 charges everything |
| roll | 0.048° | 0.455° | two braced holds, two draws from term 7's 0.5°, so the change carries √2 of one term's edge displacement |
| sensor hold | 0.054° | 0.054° | term 8's residual 2 s after a 20 °/s pan stops; § 1.5 drops it, and F4 carries it because the movement is what F4 is about |
| truth read | 0.106° | 0.106° | two frames, annotated apart, so it does not cancel |
| **RSS** | **0.304°** | **0.472°** | |

What cancels, and why: the summit's own position and height (the same error in both
frames), the observer's position and height (the person did not move), the anchor's own
error (one drag, subtracted from both frames alike), and the drag's own precision (the same
trim, carried round the movement). **So the paired budget does not depend on distance at
all**, and the fix accuracy does not enter it. One row grades every band.

The truth read is the term § 1.5 leaves out. It is charged here because the paired budget is
a third of § 1.5's and a term that was under 1 % of the variance there is 12 % of it here.
The figure comes from the instrument's own registered limit: § 2.0 refuses a grade when the
two annotators sit more than 0.3° apart, and reading that as a 2σ bound on the difference of
two independent reads puts one annotator at `0.3/2√2 = 0.106°`, the midpoint that truth
uses at `0.106/√2 = 0.075°`, and two frames' difference back at `0.106°`. **That reading is
an assumption and it is the loosest link here.** If the 0.3° were one annotator's 1σ instead,
the term would be 0.212° and the limits below would be 0.70° and 1.00° rather than 0.60° and
0.95°. It is registered at the tighter figure, before any field number exists, and it moves
only with a measurement of the instrument.

**Limits — 2σ rounded to the nearest 0.05°, 3σ at 1.5 × that, rounded up:**

| axis | 2σ | 3σ | 2σ at a 1920 px frame |
|---|---|---|---|
| across | **0.60°** | 0.90° | 13.4 px |
| up/down | **0.95°** | 1.45° | 21.2 px |

This is three times tighter than F3's `far` row, and that is the point: F4 asks a much
narrower question than F3 and can afford a much narrower tolerance.

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

**Sample.** Four movement captures per after-drag capture; the summits settled in both
frames of the pair, minus the anchor. A moved capture carries no drag of its own, so its
anchor is the one the after-drag capture it moved from (`movedFromCaptureId`) was dragged
onto, and the exclusion and the reporting of § 2.3 apply to it unchanged. A moved capture
that names its own `dragAnchorSummitId` is read by that. A capture whose anchor did not
reach u = 0.8, or whose anchor the overlay did not draw at all, is reported off-protocol and
not graded. A tilt must still be within 5–15°, read from the pose.

**A moved capture whose trim is not its reference's is not a pair.** Step 9 registers the
movement as made *without re-dragging*, and the pose records the trim, so a trim that
changed says the overlay was dragged again. The drag then does not cancel in the difference.
Such a capture is reported under `F4.unpaired` and graded by nothing.

**The verdict, per movement.** F3's fail rule: more than the allowance past 2σ, or any past
3σ. A movement pairs three to five summits, so it is six to ten units, and a correct app
passes one movement with probability 0.96 at n = 6 and 0.91 at n = 10 — 0.85 over all four
movements at the smallest size. A movement pairing fewer than three summits is reported
`no-sample` under § 2.0's stop rule, exactly as a thin band is.

**Failure.** A movement that fails that count. Distinguishing F4 from F3 is the point: a
change that appears only after the movement implicates the sensors or the roll, while an
error present in both frames is geometry and F3 is where it is graded.

**What the pan exercises.** At hFOV 73.74°, u = 0.8 puts the field-of-view scale term at
0.253° of the 0.275° available at the edge, so the pan probes 92 % of that term. It also
carries the anchor itself to 31° off the optical axis,
where a 0.5° roll displaces it by 0.270° vertically. The result reports each unit's frame
offset in both frames, so an edge effect can be told from a whole-frame one.


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

**Claim.** The field session fits the half hour IMPLEMENTATION.md budgets for it, at 19
steps and 10 captures.

**The exact measurement.** Elapsed minutes from the tab opening to the last capture,
recorded by the person on site, split into: permissions and start, field-of-view
calibration, the F3 captures, the F4 movements, and anything repeated. Recorded as
relative durations only.

**Sample.** n = 1. It is one session. This is stated rather than dressed up.

**Threshold.** ≤ 40 minutes total, and the field-of-view calibration ≤ 10 minutes.
40 rather than 30 because the estimate is 30 and a criterion set at the estimate measures
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
    These two captures feed F2, `F2.pose` and all of F5, and F3 and F4 do not read them
    (§ 2.2). **From May to early August this step is done in the afternoon**, because the
    morning Sun sits inside a north-east frame from about 07:30 to 08:45 MDT (§ 2.2). From
    September to April any daylight hour will do.
12. Note the minutes each step took (F6).

---

## Part 3 — How a run is graded

`src/live/field-analysis.ts` holds the schema, the parser, the limits above as data, the
budget terms § 2.3's recomputation needs, and the F2–F5 arithmetic. `npm run analyze:field -- <bundle> <truth>` prints the verdicts.
F1 and F6 are stopwatch numbers recorded by the person on site and are not computed from a
bundle.

**The thresholds live in code as `PREREGISTERED_THRESHOLDS`**, the per-k rows beside it and
`PREREGISTERED_MOVEMENT_LIMITS` for § 2.4, and the analyzer takes no threshold argument. A
run cannot be graded against anything but this document, and changing a number there changes
it here, in the same commit, with the reason.

**F3 prints one criterion per band and F4 one per movement**, named for the moved capture:
`F3.far`, `F4.c3`. F3's `n` is the number of summit-axis units in the band — twice the
summits — and each unit's line is followed by one line per capture whose residual went into
its median. `F3.slipped-drag` names the after-drag captures whose anchor residual passed
three drag terms, and `F4.unpaired` the moved captures there was no reference to difference
against.

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

**An apex may carry a `rule`**, the registered apex rule the annotator followed, quoted
verbatim. The rules live in the grader as `REGISTERED_APEX_RULES`, keyed by summit, and the
parser refuses any other text: a paraphrase, an empty string, and a rule quoted against a
summit § 2.0 registers none for. So the two annotators of a rule-bound summit necessarily
quoted the same text. It is optional, so a truth document written without one is read
unchanged, and a summit counts as rule-bound only when both annotators quoted the rule. The report prints how many graded
summits were rule-bound and the truth disagreement of the rule-bound and the free summits
apart (§ 2.0). A rule on an answer that locates nothing is refused, as a landmark already is.

**A capture of the north-east direction carries the role `turned`.** F3 and F4 read only the
`after-drag` and `moved` roles, so a turned capture reaches neither, and the movement
envelope check reads only `moved`, so neither is it reported off-protocol. F2 and `F2.pose`
read `before-drag` and `turned` together, and F5 reads every role. A turned capture names no
`dragAnchorSummitId`, no `movedFromCaptureId` and neither `panFromReferenceDeg` nor
`tiltFromReferenceDeg`, and the parser refuses one that does: nothing was dragged in that
direction and nothing was moved from a reference frame. A `before-drag` capture is refused
the same two drag keys, because it was taken before the drag existed.

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

### 2026-09-29 — the budget charges the anchor at the registered anchor's distance

Still before any field number exists. The budget charged the drag anchor at 7–20 km while
the protocol registers a 2.0 km anchor, so every row was computed on a summit the session
will not use.

- **§ 1.5 charges the anchor at 2 km, the distance § 2.7 registers.** The anchor term goes
  from 0.143° to 0.716° horizontally and from 0.065° to 0.327° vertically, on every row. The
  1σ column follows: 1.182° / 0.783° at 2 km, 0.951° / 0.715° at 10 km, 0.941° / 0.712° at
  60 km.
- **§ 2.3's limits follow the budget, in both tables.** `near` is 2.35° / 1.55°, `mid` is
  1.95° / 1.45°, and the three bands beyond 7 km are 1.90° / 1.45°. The 10 m-fix table is
  recomputed with them, and every figure is generated from `BUDGET_TERMS` rather than typed.
- **Why this is not a threshold widened to fit a run.** The anchor's distance is a protocol
  input, registered in § 2.7 before the session and known without any field data. The rule
  at the top of this document forbids moving a limit after a run and § 1.6 forbids replacing
  a judgement with a second judgement; recomputing a term from a registered input is neither.
  No field number exists to have motivated it.
- **§ 1.1 no longer offers the gap as an excuse.** The previous revision left the table on
  the 7–20 km charge and told a reader to decompose a marginal failure against the anchor
  first. A band that fails now fails against the budget the anchor actually implies.
- **What it would have done to the headless rehearsal.** Nothing. `out/rehearsal/bundle.json`
  reports `no-sample` in every F3 and F4 band under the anchor-exclusion rule, whatever the
  limits are.
- **What moved in the fixtures.** `fixtures/field/stray-bundle.json` injects its `F3.far`
  failure as a 3σ excursion, so the injected offset goes from 50 px to 70 px on the stored
  frame — 3.130° against the band's 2.85°. The verdict table it produces is unchanged.
- **§ 2.3's exceedance arithmetic is stated at the sample sizes a band here reaches**, 6 to
  30 axis draws rather than a worked n = 8, and the two effects the binomial does not model
  — repeated grading of the same summits, and terms charged at the frame edge — are named.
  The gate itself did not move.

The bands, the criteria and the terms of § 1.3 are unchanged. What moved is the distance one
of those terms is charged at.

### 2026-09-29 — the north-east direction's hour, and what reads a turned capture

Still before any field number exists. A verification pass against the solar geometry, the
committed peak data and the grader found six statements this document made that its own
inputs do not support.

- **The Sun claim is now seasonal (§ 2.2, § 2.7).** "The Sun is not in a north-east frame at
  any hour this protocol allows" holds from September to April and fails from May to early
  August, when the Sun sits at azimuth 72° to 82° and 15° to 26° up between about 07:30 and
  08:45 MDT — inside the 8.1° to 81.9° span of the registered frame. In those months the
  north-east captures are taken in the afternoon, and
  [FIELD-SESSION-GUIDE.md](FIELD-SESSION-GUIDE.md) says so in plain words. The no-new-anchor
  rule is unchanged and now rests on the reason that always held: a second re-anchor throws
  away the first direction's compass reading.
- **The north-east apparent altitudes are corrected (§ 2.2)**, from "about −1.3° to +0.4°" to
  about −0.7° (Charters Mountain) to +0.1° (Freeman Peak), computed from the committed peak
  data at a 1.6 m eye height with refraction at k = 0.13. The ten named summits are 25 to
  55 km out, not 20 to 60.
- **The north-east captures feed all of F5, not F5b alone (§ 2.2, § 3).** F5a counts every
  summit any capture draws `visible`, and F5c reads every capture's sweep radius. A test now
  grades a turned capture through all three, so a role filter added to any of them fails.
- **The north-east frame reaches the `far` band too (§ 2.2, § 2.0).** Sugarloaf Rock at
  7.6 km, Warm Springs Point at 13.1 km and Harris Creek Summit at 14.6 km sit in it, so its
  F2 observations are not confined to `distant` and `horizon`.
- **An apex rule is quoted verbatim (§ 2.0, § 3).** The grader holds the registered rules as
  `REGISTERED_APEX_RULES`, keyed by summit, and the parser refuses a rule that is not that
  summit's registered text, including a paraphrase, an empty string and a rule quoted against
  a summit with none. The two annotators of a rule-bound summit therefore quote the same
  text by construction.
- **The parser refuses two more impossible captures (§ 3).** A `turned` capture carrying
  `panFromReferenceDeg` or `tiltFromReferenceDeg` — there is no reference frame to have moved
  from — and a `before-drag` capture carrying `dragAnchorSummitId` or `movedFromCaptureId`.
- **§ 2.0's near-band claim is stated at the registered field of view.** Two near summits in
  one frame is a fact about 73.74°; a viewport up to 10 % wider, which § 1.2 reports rather
  than refuses, would reach Bob's Knob 75.0° from Doe Point. F3.near is `no-sample` either
  way, because three drawn summits are two graded ones once the anchor is excluded.
- **§ 2.6 cites the half-hour estimate** the session is now sized at, and its 40-minute
  threshold is justified against that rather than against a superseded 25.

No threshold moved, and no criterion changed what it grades.

### 2026-09-29 — the graded unit becomes a summit, and F4 grades the change

Still before any field number exists. The per-draw gate F3 and F4 shared had two faults, and
both were found by computing what it does to an app that is exactly right.

**It failed a correct app 42 % of the time at n = 30.** The gate tolerated one 2σ exceedance
whatever the sample size, so its pass rate fell away as n grew: 0.96 at n = 6, 0.58 at
n = 30. A gate that a correct budget fails more often than not measures the sample rather
than the app.

**It counted one bad summit three times.** The unit was one summit-axis in one capture, and
the three after-drag captures grade the same summits. A summit whose peak position is 40 m
out is 40 m out in all three, so one error produced three exceedances and two summits could
fail a band the budget says should pass. The same arithmetic let three captures of a single
summit clear a stop rule written for three summits.

What changed:

- **F3's unit is one summit-axis per band (§ 1.5, § 2.3)**, and its value is the median
  signed residual over the after-drag captures that settled the summit. Every common term
  keeps its full size under the median; only the drag shrinks, because only the drag is
  re-made per capture.
- **The drag term is charged at a factor keyed on k (§ 1.5, § 2.3)**: 1 at k = 1, 1/√2 at
  k = 2, and `√(1 − √3/π) = 0.66983` at k = 3, the standard deviation of the median of three
  standard normals, derived in § 1.5 from that median's density. § 2.3 publishes a limit
  table per k; at k = 3 beyond 7 km the 1σ is 0.862° horizontally and 0.590° vertically, and
  the limits are 1.70° and 1.20°.
- **The 2σ allowance is a schedule (§ 2.3)**: one up to twelve units, two from thirteen to
  twenty-four, one more per further twelve. A correct app now passes a band with probability
  0.96 at n = 6, 0.91 at n = 10 and 0.88 at n = 12, instead of falling away.
- **A slipped drag is reported (§ 2.3).** An after-drag capture whose anchor residual passes
  three drag terms — 1.63° — is named with how many units' medians include it. Reported,
  never gated: a median over three captures survives one bad draw, and discarding the
  capture would let the grader choose its own observations.
- **F4 grades the paired change (§ 2.4).** The statistic is the moved capture's residual
  minus the reference after-drag capture's, per axis, for a summit settled in both. The
  geometry, the anchor and the drag cancel; the field-of-view scale at the new offset, the
  roll of the new hold, the sensors' settle over the move and the truth read of a second
  frame do not. Its budget is 0.304° horizontally and 0.472° vertically, so its limits are
  0.60° and 0.95° at 2σ — one row for every band, because nothing left in it depends on
  distance. The unit is a summit-axis per movement and each movement is gated on its own.
- **§ 2.4 charges a truth-read term, which § 1.5 does not.** At 0.106°, derived from § 2.0's
  0.3° disagreement limit read as a 2σ bound, it is under 1 % of F3's variance and 12 % of
  F4's. The reading is an assumption and § 2.4 states what it would cost if it were wrong.
- **A moved capture whose trim is not its reference's is reported unpaired (§ 2.4)**, because
  step 9 registers the movement as made without re-dragging and the drag does not otherwise
  cancel.

No F3 limit was widened. Every k = 2 and k = 3 row is tighter than the k = 1 row it replaces,
and F4's limits are about a third of the F3 limits it used to borrow. The `u ≥ 0.8` pan
target, the tilt envelope, the off-protocol rules, the stop rule, the anchor exclusion and
the bands themselves are unchanged.

**The committed `aligned` fixture now fails `F4.c3`, and the fixture was not adjusted to
prevent it.** That fixture draws every summit with an error of its own in every capture,
about ±10 px, independent between the reference and the moved capture. Each one is inside
F3's 1.90° far band, so F3 still passes. The paired change differences them, where a
summit's own position error would cancel and an independent redraw does not, and two units
land past the 0.60° movement budget. A real summit carries one position error into both
frames of a pair, so what failed is the fixture's noise model rather than the criterion. The
fixture stays as it is, and `fixtures/field/README.md` records the verdict.

### 2026-09-29 — the committed fixtures are generated

`scripts/make-field-fixtures.ts` (`npm run field:fixtures`) writes the four field fixtures,
offline and seeded. Each summit carries one position error into every capture it appears in; an
after-drag capture adds one drag draw, inherited by the captures moved from it; a movement adds
a term drawn from § 2.4's budget. So the paired change reads the movement, and the `aligned`
pair now passes `F4.c3` on three summits and fails nothing. The previous entry's statement that
it fails `F4.c3` described the hand-built fixture this replaces. No criterion or limit changed.

