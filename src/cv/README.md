# `src/cv` — skyline extraction and alignment (Phase 7, v2.1)

Pure like `src/core`: pixels in, numbers out. No network, no DOM, no filesystem,
no `Date.now`, no `Math.random`. Decoding a JPEG is the caller's job — the entry
points take an `RgbaImage`, which is exactly what `jpeg-js` and
`CanvasRenderingContext2D.getImageData` both hand you, so the same call runs in
Node and in the browser with no branch and no image codec in the graph.

## Why

`GPSImgDirection` is typically 5–15° wrong (MISSION.md, decision D3). Everything
downstream of it is exact — the projection is verified against closed forms to
1e-12 — and none of that matters if the heading is ten degrees off, because then
every label is on a different mountain. The manual trim sliders (P5.1) are the
interim answer. This measures the error from the photograph instead.

## The three pieces

| Module | Question it answers |
|---|---|
| `skyline.ts` | For each image column, which row is the sky/terrain boundary — and how much should anyone believe it? |
| `rays.ts` | What world direction does a pixel look along, and what does a pose error do to it? |
| `align.ts` | Which heading and pitch offset make the terrain profile lie on that extracted skyline — or why can't any? |

## The extractor is a path, not 512 independent answers

A photograph taken while standing on a broad ridge contains at least two ordered
sky-over-terrain steps in most columns: the distant skyline against the sky, and
a nearer edge inside the terrain — a snowfield ending on a cliff band, the lip of
the foreground. **Both are excellent steps.** Fitting each column on its own,
some columns lock onto one and some onto the other, each with full confidence,
and the returned curve is two surfaces stitched together.

That is measured, not hypothetical. On `fixtures/photos/real/tundra-blue-sky.jpeg`
the per-column extractor returned a boundary spanning **15.96° of altitude**,
against a terrain horizon that spans 10.97° over the whole compass from that
viewpoint and at most 8.8° inside any one 69° frame. Span is the right thing to
measure because it survives not knowing the pose: pitch shifts the range without
changing its width and focal length scales it roughly uniformly, so neither can
turn 8.8° into 15.96°. The full story is in
[`docs/CV-REAL-PHOTO-FINDING.md`](../../docs/CV-REAL-PHOTO-FINDING.md).

So `skyline.ts` scores **every row of every column** — the same contrast × SNR ×
local-edge product the confidence is built from — and takes the path through
those scores that maximises total evidence minus a penalty for how fast the
boundary moves. The dynamic program is exact and runs in `O(rows × columns)`: the
penalty is flat-then-linear, which factors into a sliding-window maximum followed
by the two-pass L1 transform, so no candidate shortlist and no approximation.

The penalty is written in **degrees of altitude per degree of bearing**, which is
`tan θ / sin φ` for a crest of ground slope `θ` seen at `φ` to the line of sight —
distance cancels, so it is a property of terrain and not of the photograph. It is
free below 5 (ordinary terrain at 40° seen within 10° of end-on) and **linear**
above, one column of perfect evidence per unit of excess. Linear rather than
quadratic on purpose: a quadratic penalty is a soft slope cap, and a real skyline
is locally near-vertical at a cliff edge. Where the price is genuinely too high
the extractor reports a **gap**, never a smoothed compromise curve.

The tundra span is 8.44° after this, and 15.96° with the penalty set to zero and
nothing else changed. It is 8.44° for every penalty from 0.03 to 10 and every
free slope from 3 to 12 — the constants are not what decides it.

`agreement01` stayed a **diagnostic** and did not become the constraint, which was
a deliberate choice: a number that drives the path cannot also certify it. It
still measures deviation from the robust local median, over a wider window and a
different statistic than the slope penalty, so it can still report that the path
was dragged through a column it should not have been.

## The one result the search is built on

Write `A(h, p)` for the camera axis triple at heading `h`, pitch `p`. Then

```
A(h₀ + Δh, p₀ + Δp) = R_up(Δh) · R_r(Δp) · A(h₀, p₀)
```

with `R_up` about the world vertical and `R_r` about `levelRight(h₀)`. The proof
is in `rays.ts`; the two consequences are what shape the algorithm:

- **Heading is a rigid translation in bearing.** At `Δp = 0` every ray's bearing
  moves by exactly `Δh` and its altitude does not move at all. So matching over
  heading is a genuine 1-D cross-correlation, exact at every offset.
- **Pitch is very nearly a constant offset in altitude** — `Δp·cos β` at
  off-axis bearing `β`, so it shrinks 16 % across a 65° frame and no more.

This is also why the obvious implementation is wrong. Sliding the computed
skyline sideways across the photograph a pixel at a time assumes rotation is
translation, which a rectilinear lens does not do: on the 65.5° Gornergrat
framing a 10° heading error moves the frame centre by 0.305 of the width and the
frame edge by 0.416 — a 3.7° discrepancy at the edge, seven times the accuracy
this phase is held to, and *growing with the error being measured*.

## Heading first, then pitch, then both

Decided this way rather than as one 2-D grid, and the reasoning is the identity
above:

1. **Heading scan** at `Δp = 0`, scored by weighted normalised cross-correlation.
   NCC subtracts both means before correlating, so it is nearly blind to a
   constant vertical offset — which is what a pitch error almost is. An unknown
   pitch therefore does not bias the heading peak; it only leaks in through the
   16 % cosine modulation, second order in `Δp`. (`align.test.ts` asserts this
   directly: with pitch search switched off and a 1° pitch error, the heading
   still comes back within 0.2°.)
2. **Pitch scan** with the heading fixed, on the actual geometric residual.
3. **Joint local refinement** on `(Δh, Δp)` with the exact rotation, which mops
   up the coupling the first two stages approximated away.

Cost: ~0.4 M profile lookups against ~26 M for a single joint grid at the same
final resolution, and step 3 *is* a joint search over the only region where the
coupling matters — so the decoupling is an approximation about where to look,
not about the answer.

Roll is deliberately not searched: photographs are near level, roll is not what
EXIF gets wrong, and a third free parameter against one 1-D observation is how a
fitter starts explaining terrain with whichever knob is cheapest.

## The refusals, which are the point

Every stage produces a number for any input whatsoever. Fog produces a number. A
sea horizon produces a number. Returning one of them would be worse than not
running: the labels would move somewhere new and wrong while the system claimed
to have checked the photograph. So the result type has **no offsets at all in
its failure variant** — a caller must narrow the union before it can read a
heading, and there is no field that could be mistaken for one.

| Gate | Diagnosis |
|---|---|
| coverage | too little readable skyline — fog, night, blown-out sky |
| relief | the terrain profile, or the photograph's skyline, is a straight line |
| score | nothing in the search window correlates at all |
| margin | several offsets fit equally well; the peak is not a lock |
| residual | an offset was found, but the terrain does not lie on the skyline there |
| search edge | the winner sat at the rim of the window, so the real peak may be outside |

`margin` is the subtle one. It is *not* "best score minus the best score N
degrees away": a real alpine skyline is smooth, so at Gornergrat the NCC is still
0.94 a full 2° off the truth, and scoring that shoulder as a rival would flag
every correct alignment as ambiguous. The winner's own **basin** — the run of
offsets over which the score falls away monotonically — is excluded instead, and
the rival is the best genuinely *different* explanation of the same skyline.

## What is proven, and what is not

**Proven.** Synthetic round trips recover an injected offset to well inside the
0.5° the plan demands (see the numbers in `align.test.ts`, and the same thing in
a real browser in `tests/e2e/cv.spec.ts`). It works over the real Gornergrat SRTM
profile, through cloud, sun flare and noise, with 60 % of the frame fogged out,
and on a sector profile rather than a full 360° sweep. Every failure case above
is exercised and refuses.

**Measured on two real photographs, and neither aligns.** `fixtures/photos/real/`
holds two supplied photographs with real positions and no EXIF bearing.
`tundra-blue-sky.jpeg` is read at 98 % coverage and its extracted skyline now
spans an altitude range a real horizon could have — but `alignSkyline` refuses it
in all twelve heading windows, and the best correlation anywhere on the compass
(0.573 at 345°) is tied to within 0.014 with the best inside the arc where the
range actually is (0.559 at 168.5°), with the terrain sitting ~2° RMS off the
skyline at both. `lookout-snow-haze.jpeg` is read at 2.9 % and refused on
coverage. **The end-to-end chain has never yet succeeded on a real photograph**,
and that is the honest headline; what has been proven is that it does not invent
an answer instead.

The remaining `fixtures/photos/*.jpg` are uniform grey frames generated for the
EXIF suite, and the ground-truth cases deliberately cite images on Wikimedia
Commons rather than vendoring them. The `skyAffinity` model — sky is brighter and
bluer — is a heuristic with known enemies:

- **sunlit snow is brighter than a hazy sky.** `align.test.ts` runs exactly this
  case: the extractor locks onto the *snowline*, a flat horizontal edge, and the
  aligner refuses with `featureless-photo-skyline`. Wrong, and honest about it —
  which is the required behaviour, but it is a miss, not a save.
- backlit rock, dark storm cloud on the ridge, thick haze.

The four confidence factors are what keep a miss from becoming a confidently
wrong label, and they are the part of this module that would survive a better
extractor being dropped in behind them.

## Integrating it (not done, on purpose)

The seam is `src/pipeline/cv-alignment.ts` — one pure function, not exported
from `src/pipeline/index.ts`, imported by nothing. It is left that way because
an automatic correction that cannot be seen or undone is strictly worse than a
manual one: when it is wrong, the user has no way to know anything moved. So the
integration is: pre-set the existing trim sliders to the recovered offsets and
label them auto-detected on `'aligned'`; offer them on `'low-confidence'`; leave
the sliders exactly as they are today and show the reason on `'failed'`.

Before switching it on, the thing to get is real photographs with known
viewpoints — which is the same gap the archived [PLAN.md](../../archive/v2-docs-20260929/PLAN.md) P6.2 already names.
