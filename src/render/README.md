# `src/render` — overlay builder and PNG compositor

Phase 4 of the archived [PLAN.md](../../archive/v2-docs-20260929/PLAN.md).

## P4.1 — pure overlay builder

`buildOverlaySvg(scene, options?, theme?) → string`

A scene (image pixel size, `CameraPose`, `HorizonProfile`, `VisiblePeak[]`) in;
an SVG document out. No DOM, no filesystem, no network, no `Date.now`, no
`Math.random` — the same scene always produces the same bytes.

| Module | Role |
|---|---|
| `types.ts` | Scene, options and layout shapes. Data only. |
| `xml.ts` | Escaping and coordinate formatting. |
| `text-metrics.ts` | DOM-free text width estimation. |
| `geometry.ts` | Behind-the-camera test, Liang–Barsky frame clipping. |
| `layout.ts` | Scene → pixel geometry, including label collision avoidance. |
| `crowding.ts` | What to say when the frame held more summits than names. |
| `svg.ts` | Pixel geometry → SVG string. |

The layout/serialisation split is what makes the geometry assertable as
numbers instead of as substrings.

### What the overlay contains

- the terrain skyline as one or more polylines, sampled in bearing across 1.5×
  the horizontal field of view and clipped to the frame — several polylines
  when the line leaves and re-enters, never a false chord across the gap;
- per visible peak: a dot on the projected summit, a vertical flag pole, and a
  two-line label (name, then `elevation · distance`);
- per **self-occluded** peak (`OverlayPeak.visibility`, decision D8): the same
  marker de-emphasised — dashed pole, hollow summit ring, `· summit obscured`
  appended to the detail line, and reduced opacity on the bright marks only.
  The dark halo keeps full strength, so a greyed label stays as readable over
  blown-out haze as a solid one; three of the four cues survive with no colour
  at all;
- **foreground-occluded** peaks are refused outright and returned in
  `foregroundOccludedPeaks`. The pipeline already withholds them; the renderer
  refuses again, because naming a mountain that is behind a different hill is
  the one mistake worth guarding twice;
- peaks that project outside the frame or behind the camera are not drawn, and
  are returned in `offFramePeaks` rather than silently dropped;
- summits the frame had no room to name: a smaller dot, no pole and no text,
  returned in `crowdedOutSummits` and counted in one line at the bottom-right
  of the SVG. See below.

### Label collision avoidance

Peaks cluster on a real skyline, so overlapping labels are the default outcome.
The rule, in full, is documented at the top of [`layout.ts`](layout.ts). In
brief: markers are placed in **priority order** — apparent height, highest
first, ties broken by elevation then by peak id, never by input order — each
taking the first free placement from a fixed candidate list of pole lengths
increasing one `stackStepPx` at a time, upward first and then downward. A level
can be *skipped*, because poles are measured from their own summits and summits
differ in height; the search tests the real boxes rather than trusting the
arithmetic. What is guaranteed is disjoint boxes, never a particular level. The
returned `markers` are sorted left to right, which is the reading order of the
picture — placement order allocates space, report order presents it.

If nothing is free the label is **withheld**, not drawn overlapping: see below.

### Real peak density (Phase 9)

Those rules were designed against three summits. Measured against the imported
Overture database — Gornergrat platform, heading 355°, hFOV 65°, 1600 × 1200 —
**74 named summits landed inside one frame**, and the overlay drew all of them:
21 flagged `overlapped`, 24 label boxes genuinely intersecting, poles up to
467 px in a 1200 px image. Nothing failed; the export was simply unreadable.

Two rules were added. Neither changes a frame that already fitted.

- **A pole may not exceed `maxPoleLengthPx`** (default `0.3 × heightPx`). The
  candidate list stops at the last level inside it. Past that distance a label
  is not readable as a label *for that dot* — with twenty poles in the frame
  you cannot tell which one it belongs to.
- **A frame has a label budget** (`maxLabels`, default derived by
  `labelSlotCapacity`: how many boxes fit across the usable width, times the
  rungs the pole budget allows, times `LABEL_PACKING_RATIO`). Over budget, the
  summits are ranked by `compareLabelPriority` — **apparent height**, the
  altitude angle, which is the one quantity that combines elevation and
  distance the way an eye does — and the losers keep a dot, are returned in
  `crowdedOutSummits`, and are counted on the image.

Ranking ignores `visibility` **deliberately**: a self-occluded summit competes
on its height like any other, because ranking greyed labels down whenever a
frame is busy would repeal decision D8 by the back door, invisibly, exactly
where nobody would notice one more missing name. Foreground-occluded peaks are
refused *before* ranking, so no priority rule can promote one into the picture.

A marker that finds no free candidate is **withheld**, not drawn overlapping,
and the rule is unconditional. Rule 5 used to draw it anyway and flag
`overlapped`; that was right when there was no channel through which a withheld
name could be reported, because a name that silently disappears is a lie about
what is in the photograph. `crowdedOutSummits` plus the count on the image *are*
that channel, so the reason has gone. `overlapped` now means one thing only, and
it is not crowding: a frame with no room for the label anywhere (a label taller
than the photograph), where withholding would empty an overlay that has peaks in
it.

Making the rule conditional on the budget was measurably worse than either
alternative — a 30-summit frame came out with 9 colliding labels while a fuller
43-summit frame came out clean, because only the fuller one crossed the
threshold. A slightly emptier view must not render worse than a fuller one.

Measured over the same 72 headings, genuine old code vs new, same scene:

| | old | new |
|---|---|---|
| headings with ≥1 colliding label | **15 / 72** | **0 / 72** |
| worst frame's colliding labels | 10 | 0 |
| worst frame's `overlapped` flags | 7 | 0 |
| longest pole anywhere | 467 px | 309 px |
| densest frame (heading 355°, 50 in frame) | 50 labelled, 8 colliding | 22 labelled, 28 dotted, 0 colliding |

Collision search cost, 5000 in-frame peaks: **329.5 ms → 6.8 ms**. The old search
was quadratic in the peaks placed; the budget bounds how many ever enter it.

### Legibility

Every mark is drawn twice: a dark translucent halo, then the bright mark.
Labels get the same via `paint-order="stroke"`, so the outline sits behind the
glyphs instead of eating into them. This is what keeps the overlay readable
over blown-out haze, sunlit snow and near-black rock in the same frame.

## P4.2 — PNG compositor

`composite.ts` — photo + overlay SVG → a single PNG, in the browser. It is not
re-exported from `index.ts`, so the purity of P4.1 is visible in the import
graph.

No `node-canvas`, and no new dependency of any kind: Chromium is already
installed and already driven by Playwright, so the raster the tests check comes
from exactly the engine that will produce the user's export. The overlay is
handed to the browser as a `data:` URL image and drawn with `drawImage` —
one SVG, one rendering engine, no second implementation of the overlay to drift
out of step.

`harness.html` is the test page the Playwright suite drives. It is not part of
the app and nothing links to it. `testing/synthetic-photo.ts` draws the
deliberately hostile background (bright haze at the skyline, near-black rock,
bright sky) that the exported artifact is reviewed against.

## Self-checks

```
npx vitest run src/render                              # P4.1 — 143 unit tests
npx playwright test tests/e2e/render.spec.ts           # P4.2 — export + raster probes
npx playwright test tests/e2e/render-density.spec.ts   # 77 summits in one frame
```

The e2e runs write `out/render-composite.png`, `out/render-overlay.svg`,
`out/render-density.png` and `out/render-density.svg` for human review. The
density artifact is the one to look at first: it is the case that used to be
unreadable, and an image is the only honest test of legibility.

Test expectations here are derived from the projection model, not from the
renderer's own output: the closed forms and the arithmetic are written out at
the top of `layout.test.ts`. The single snapshot test is an overall-shape guard
only.
