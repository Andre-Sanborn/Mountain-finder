# fixtures/field/

Synthetic field capture bundles and apex truth documents for
`src/live/field-analysis.ts`. Nothing here was recorded from a phone, and
nothing here came from a field session.

## What is here

Two pairs, each a bundle and the truth document that grades it:

| pair | what it exercises |
|---|---|
| `aligned-bundle.json` + `aligned-truth.json` | an app inside the registered error budget: every criterion the data reaches passes, and the rest report `no-sample` |
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
F4.c3       pass       6            F3.truth-unidentifiable  no-sample  1
F4.c4       no-sample  4            F5a                      fail       4
F4.anchor   no-sample  2            F5b                      pass       1
F5a         pass       16           F5c                      fail       1
F5b         pass       4
F5c         pass       4

aligned: 7 passed, 0 failed,        stray: 1 passed, 3 failed,
7 without a sample                  8 without a sample; failing:
                                    F3.far, F5a, F5c
```

An `F3` band's `n` is its summit-axis units, which is twice the summits it graded:
the unit is one summit per axis, and its value is the median of that summit's
residuals over the after-drag captures that settled it. `F4` names one criterion
per movement, after the moved capture.

`analyze:field` exits 0 on the aligned pair and 1 on the stray pair, which holds
three failing criteria.

## How the numbers were made

`npm run field:fixtures` writes all four files, from
`scripts/make-field-fixtures.ts`. It reads no file, opens no socket and takes no
argument, and its randomness is one generator started from a seed written into
the script, so a run on any machine writes the same four files. Regenerate them
that way rather than editing the JSON.

The script builds a `SynthSpec` and hands it to `synthesiseFieldBundle` in
`src/live/field-analysis.ts`, which does no angle arithmetic at all: an apex is
placed at a pixel, the drawn marker is that pixel plus a stated pixel offset, and
the two annotators' picks straddle the placed pixel so their midpoint is it
exactly. What those pixels are worth in degrees is computed from the pinhole
relation `θ = atan(offset / f)` with `f = (1920/2) / tan(73.74°/2) = 1279.995 px`,
in the script and again in the test file, and never taken from a run of the
grader.

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
The injected errors are pixel offsets on the STORED FRAME, and they come back off
the grader as those offsets whatever the crop.

## The noise model

The magnitudes are the per-term 1σ figures of § 1.5, and the model is that
section's own decomposition.

**Each summit is drawn one error for the whole session** — its own position and
height error, the field-of-view scale error at its offset, and the roll of the
hold. Call it `a_i`. It is carried unchanged into every capture the summit
appears in, which is what makes it cancel where the budget says it cancels. A
capture's injected residual is then:

| role | injected | what the extra term is |
|---|---|---|
| before-drag | `a_i + r` | `r` is one raw pointing offset of 55 px across and 12 px down, common to every summit, standing for the compass bias the drag has not yet removed |
| after-drag | `(a_i − a_anchor) + d` | `d` is that drag's own precision, one draw shared by every summit in the capture |
| moved | `(a_i − a_anchor) + d + m_i` | `d` is the reference capture's draw, because a moved capture carries the trim round the movement without re-dragging; `m_i` is what the movement itself adds, from § 2.4's 0.304° across and 0.472° up/down |

So `F3` reads `(a_i − a_anchor) + d`, and `F4`'s paired change is `m_i` plus a
small second-order term from reading the same pixel error at a different frame
offset. The summit's own error and the drag both cancel in the difference, as
§ 2.4 says they do. The anchor summit's own residual is `d` alone, which is the
drag precision § 1.6 asks the field session to measure.

**Every draw is Gaussian, truncated at 0.8 of its own term's 1σ.** A residual is
a sum of such terms, and `atan(Σ f·tan θ_j) ≤ Σ θ_j` because the tangent is
convex, so a residual's angle is at most 0.8 times the linear sum of its row. The
limits are 2σ of the RSS of the same terms, and § 1.4 puts the linear sum at 1.69
to 1.93 times the RSS beyond 3 km, so 0.8 × linear sits under 2 × RSS with
margin. That argument covers `F2` and `F3`; it does not cover `F4`, whose
statistic is a difference of two angles read at two different frame offsets. So
the script computes every graded unit's residual and every paired change itself,
from the pixels it injected, and refuses to write a file whose unit sits outside
its pre-registered limit. **The fixture represents an app inside budget, and the
arithmetic that says so runs before the files are written.**

The errors injected into `stray-bundle.json` on top of that model, and the
criterion each one breaks:

| injected | criterion |
|---|---|
| Shafer Butte drawn 70 px off its apex, which is 3.130° where the `far` band's 3σ limit is 2.85° | `F3.far` |
| Mores Mountain drawn `visible` while both annotators report clear sky where it would sit | `F5a` |
| Trinity Mountain drawn with a verdict from 55 km, beyond the capture's 30 km sweep | `F5c` |

The 70 px is Shafer Butte's **total** offset rather than an error added to the
noise: the script subtracts that summit's own draw from the injected error, so
the offset the grader reads is 70 px whatever the draws were. It is a **3σ**
excursion on purpose. A band tolerates one summit-axis past 2σ, so a single 2σ
exceedance would pass and the fixture would assert nothing. The two-exceedance
half of the gate is exercised in `src/live/field-analysis.test.ts`, where a
capture can hold two summits in one band.

Jackson Peak is drawn `visible` in the same capture and neither annotator can
identify it. That breaks nothing: an answer of "I cannot tell" is not evidence
that the mountain is missing, so the summit is excluded from `F3` and `F5a` and
counted in `F3.truth-unidentifiable`. Turning that exclusion into an agreed
absence would make the fixture fail `F5a` twice, which is the mistake the
three-state truth schema exists to prevent.

## What the aligned pair reaches

`aligned-bundle.json` exercises the rest of the protocol. Every summit is inside
F3's 2σ; its pan capture carries the drag anchor to 0.84 of the half-frame (the
registered pan target is 0.8); every capture reports a fix accuracy of 8.4 m
under the bundle's declared convention, so the bands are graded against the
limits that accuracy derives rather than the registered ones. Three summits sit
in the `far` band, which is § 2.0's stop-rule floor, so that band returns a
verdict; the `near` band holds one graded summit and is reported `no-sample` with
the stop rule named. Deer Point is annotated from a landmark — the crest under
the tallest mast — and the report lists it apart from the rest. Its two
annotators worked under different methods, `bare-frame` and `frame-and-map`, and
the report says which.

`F4.c3` is the graded movement, and it passes on three paired summits. `c4` pairs
only Mores Mountain and Jackson Peak, because it names Shafer Butte as its
anchor, so it falls under the stop rule's floor of three summits and reports
`no-sample`. That naming is the one place the fixture departs from its own model:
the trim `c4` carries came from `c2`'s drag onto Trinity Mountain, and Shafer
Butte is named so that the anchor rule has a movement to thin out.

Every pose in both files carries `grossHeadingOffsetDeg: 0` from `sensors`: nobody
re-anchored, so the heading the compass alone gave is the heading the overlay was
drawn with. `F2.pose` therefore grades that reading against the heading the
located summits solve for. On the aligned pair the two sit 2.183° apart, inside
the 8.700° band the capture displayed. That figure is the raw pointing offset the
model injects, read back through four markers that each carry their own error as
well; the test bounds it at 3.174° from the injected values rather than pinning
what the grader printed. The stray pair's one capture is `after-drag`, so the
criterion has no before-drag capture to read and returns `no-sample`.

## The drag anchor

Neither F3 nor F4 grades the summit the drag was anchored on (§ 1.1). The drag aligned the
overlay onto that summit, so its residual measures the drag's own precision rather than the
budget the other summits are held to. The grader reports it under `F3.anchor` and
`F4.anchor` with its residual, and counts it there.

Both fixtures carry the anchor rule:

- `aligned-bundle.json` anchors `c2` and `c3` on Trinity Mountain, the one `horizon` summit
  either capture draws, so the `horizon` band reports that the only observations drawn in it
  were the anchor. `c4` names Shafer Butte, which leaves its movement two paired summits,
  under the stop rule's floor.
- `stray-bundle.json` anchors its single capture on Trinity Mountain. Its anchor
  line is the drag draw alone, 0.037° across and 0.163° up/down, which is what
  the model says an anchor residual measures.

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
