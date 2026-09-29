# fixtures/field/

Synthetic field capture bundles and apex truth documents for
`src/live/field-analysis.ts`. Nothing here was recorded from a phone, and
nothing here came from a field session.

## What is here

Two pairs, each a bundle and the truth document that grades it:

| pair | what it exercises |
|---|---|
| `aligned-bundle.json` + `aligned-truth.json` | a run where every criterion the data reaches passes or reports `no-sample`, except the one paired movement, which the fixture's own noise model fails |
| `stray-bundle.json` + `stray-truth.json` | a run with three errors injected, failing exactly `F3.far`, `F5a` and `F5c` |

Both are read by `src/live/field-analysis.test.ts`, and either can be run through
the script a real bundle goes through:

```
npm run analyze:field -- fixtures/field/stray-bundle.json fixtures/field/stray-truth.json
```

The verdict tables the two produce:

```
criterion   outcome    n            criterion                outcome    n
──────────  ─────────  ─            ───────────────────────  ─────────  ─
F2          pass       4            F2                       no-sample  0
F2.pose     pass       1            F2.pose                  no-sample  0
F3.near     no-sample  2            F3.near                  no-sample  2
F3.mid      no-sample  0            F3.mid                   no-sample  0
F3.far      pass       6            F3.far                   fail       2
F3.distant  no-sample  0            F3.distant               no-sample  0
F3.horizon  no-sample  0            F3.horizon               no-sample  0
F3.anchor   no-sample  1            F3.anchor                no-sample  1
F4.c3       fail       6            F3.truth-unidentifiable  no-sample  1
F4.c4       no-sample  4            F5a                      fail       4
F4.anchor   no-sample  2            F5b                      pass       1
F5a         pass       16           F5c                      fail       1
F5b         pass       4
F5c         pass       4

aligned: 6 passed, 1 failed,        stray: 1 passed, 3 failed,
7 without a sample; failing:        8 without a sample; failing:
F4.c3                               F3.far, F5a, F5c
```

An `F3` band's `n` is its summit-axis units, which is twice the summits it graded:
the unit is one summit per axis, and its value is the median of that summit's
residuals over the after-drag captures that settled it. `F4` names one criterion
per movement, after the moved capture.

`analyze:field` exits 1 on both pairs, because both hold a failing criterion.

## How the numbers were made

`synthesiseFieldBundle` in `src/live/field-analysis.ts` built them. It does no
angle arithmetic at all: an apex is placed at a pixel, the drawn marker is that
pixel plus a stated pixel offset, and the two annotators' picks straddle the
placed pixel so their midpoint is it exactly. What those pixels are worth in
degrees is written out in the test file from the pinhole relation
`θ = atan(offset / f)` with `f = (1920/2) / tan(73.74°/2) = 1279.995 px`, and
never taken from a run of the grader.

`src/core/projection.ts`'s own `projectToImage` is used as a second instrument on
the conversion: it places two known bearings in the frame, and the grader must
recover the angle between them.

Both registered geometries are carried, because the grader checks each against its
own registration. The overlay is drawn in the 956 × 440 viewport at hFOV 73.74°
that `docs/FIELD-TEST-PREREGISTRATION.md` § 1.2 computed the error budget on, so
the committed thresholds apply to these fixtures unchanged. The frame is stored at
1920 × 884 px, over § 2.0's 1920 px floor and at the camera track's own aspect.

A drawn marker is placed in the viewport through the crop `object-fit: cover`
makes, which is the mapping the grader inverts. Here that crop is almost
nothing: 1920/884 = 2.17195 against the viewport's 956/440 = 2.17273, so 99.96 %
of the frame's height is on screen and the strip cut off each end is 0.16 px.
The injected errors below are pixel offsets on the STORED FRAME, and they come
back off the grader as those offsets whatever the crop.

The errors injected into `stray-bundle.json`, and the criterion each one breaks:

| injected | criterion |
|---|---|
| Shafer Butte drawn 70 px off its apex, which is 3.130° where the `far` band's 3σ limit is 2.85° | `F3.far` |
| Mores Mountain drawn `visible` while both annotators report clear sky where it would sit | `F5a` |
| Trinity Mountain drawn with a verdict from 55 km, beyond the capture's 30 km sweep | `F5c` |

Jackson Peak is drawn `visible` in the same capture and neither annotator can
identify it. That breaks nothing: an answer of "I cannot tell" is not evidence
that the mountain is missing, so the summit is excluded from `F3` and `F5a` and
counted in `F3.truth-unidentifiable`. Turning that exclusion into an agreed
absence would make the fixture fail `F5a` twice, which is the mistake the
three-state truth schema exists to prevent.

The 70 px is a **3σ** excursion on purpose. A band tolerates one summit-axis past 2σ, so a
single 2σ exceedance would pass and the fixture would assert nothing. The two-exceedance half
of the gate is exercised in `src/live/field-analysis.test.ts`, where a capture can hold two
summits in one band.

`aligned-bundle.json` exercises the rest of the protocol. Every summit is inside F3's 2σ; its pan
capture carries the drag anchor to 0.84 of the half-frame (the registered pan target is 0.8);
every capture reports a fix accuracy of 8.4 m under the bundle's declared convention, so the
bands are graded against the limits that accuracy derives rather than the registered ones.
Three summits sit in the `far` band, which is § 2.0's stop-rule floor, so that band returns a
verdict; the `near` band holds one graded summit and is reported `no-sample` with the stop
rule named. Deer Point is annotated from a landmark — the crest
under the tallest mast — and the report lists it apart from the rest. Its two annotators
worked under different methods, `bare-frame` and `frame-and-map`, and the report says which.

## Why the aligned pair fails `F4.c3`

`aligned-bundle.json` draws every summit with an error of its own in every capture, about
±10 px, drawn independently for the reference capture `c2` and the moved capture `c3`. Every
one of them is inside `F3`'s 1.90° `far` band, so `F3` passes.

`F4` grades the **paired change**: the moved capture's residual minus the reference
capture's, per axis. A real summit carries one position error into both frames of a pair, so
that error cancels and what is left is what the movement did. An independently redrawn error
does not cancel: Shafer Butte moves from −7 px to +10 px and Mores Mountain from +11 px to
−8 px, which are changes of 0.73° and 0.81° against the movement budget's 0.60° 2σ. Two
units past 2σ where one is tolerated fails the movement.

What that measures is the fixture's noise model, not the criterion. The fixture was written
against a per-capture gate, where independent draws were the right thing to inject, and it
is left as it is: adjusting it to pass would be moving the fixture to fit the verdict. A
later regeneration should give each summit one error carried into both frames of a pair,
plus whatever the movement is meant to add.

`c4` pairs only Mores Mountain and Jackson Peak, because it anchors on Shafer Butte, so it
falls under the stop rule's floor of three summits and reports `no-sample`.

Every pose in both files carries `grossHeadingOffsetDeg: 0` from `sensors`: nobody
re-anchored, so the heading the compass alone gave is the heading the overlay was drawn
with. `F2.pose` therefore grades that reading against the heading the located summits
solve for. On the aligned pair the two sit 4.077° apart, inside the 8.700° band the
capture displayed, which is the marker errors injected into `c1` read as a pose. The
stray pair's one capture is `after-drag`, so the criterion has no before-drag capture to
read and returns `no-sample`.

To regenerate either pair, build a `SynthSpec` and write
`synthesiseFieldBundle(spec).bundle` and `.truth` as JSON. The synthesiser is
deterministic and takes no seed, so the files are byte-identical on any machine.

## The drag anchor

Neither F3 nor F4 grades the summit the drag was anchored on (§ 1.1). The drag aligned the
overlay onto that summit, so its residual measures the drag's own precision rather than the
budget the other summits are held to. The grader reports it under `F3.anchor` and
`F4.anchor` with its residual, and counts it there.

Both fixtures carry the anchor rule:

- `aligned-bundle.json` anchors `c2` and `c3` on Trinity Mountain, the one `horizon` summit
  either capture draws, so the `horizon` band reports that the only observations drawn in it
  were the anchor. `c4` anchors on Shafer Butte, which leaves its movement two paired
  summits, under the stop rule's floor.
- `stray-bundle.json` anchors its single capture on Trinity Mountain and draws that marker
  exactly on its apex. Its anchor line reads 0.000° on both axes, which is what grading an
  anchor against itself measures.

## What the truth documents say

Per summit per annotator, exactly one of three answers, in
`mountain-finder/field-apex-truth@2`:

```json
{ "summitId": "…", "apexPx": { "xPx": 1040, "yPx": 370 } }
{ "summitId": "…", "apexPx": { "xPx": 1540, "yPx": 470 }, "landmark": "the crest under the tallest mast, not its tip" }
{ "summitId": "…", "absent": true, "reason": "clear-sky" }
{ "summitId": "…", "cannotIdentify": true }
```

Each reading also names the method it was made under, `bare-frame` or
`frame-and-map`. `apexPx: null` and the `@1` format are refused by the parser
with a message saying what to write instead.

## Privacy rules these files follow

`AGENTS.md` § "Captures from the phone" governs anything recorded from a real
device, and this directory follows the same rules even though its contents are
synthetic:

- No geolocation field, no latitude, no longitude, and **no bearings**. The one thing a
  capture says about its fix is `horizontalAccuracyM`, a single number under the bundle's
  declared convention: how well the phone knew where it was, never where that was. It is
  named so that `npm run check:privacy` reads it for what it is — that gate convicts a file
  holding the `latitude`/`longitude`/`accuracy` key set of a raw position fix, and these
  files hold none of those keys and are cleared by the rule rather than by the allow-list.
  A bearing and a distance to a named summit is a position fix, so the schema has nowhere to
  put one.
- Timestamps are milliseconds from the start of the session. A wall-clock stamp
  dates a session as precisely as a coordinate places it.
- The camera frame is referenced by file name. The bytes never enter the bundle,
  and the parser refuses a string long enough to hide an encoded one.
- **A real bundle is never committed.** It travels only by the human's own action
  to their own account, and `npm run analyze:field` reads it from wherever they
  put it and writes nothing.

A real bundle does still locate the session, because it holds distances to named
summits. That is why the rule above is absolute rather than a matter of review,
and why the analyzer reports a summit's tolerance band instead of its distance.
