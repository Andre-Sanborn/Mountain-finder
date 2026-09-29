# fixtures/field/

Synthetic field capture bundles and apex truth documents for
`src/live/field-analysis.ts`. Nothing here was recorded from a phone, and
nothing here came from a field session.

## What is here

Two pairs, each a bundle and the truth document that grades it:

| pair | what it exercises |
|---|---|
| `aligned-bundle.json` + `aligned-truth.json` | a run where every criterion the data reaches either passes or reports `no-sample` |
| `stray-bundle.json` + `stray-truth.json` | a run with three errors injected, failing exactly `F3.far`, `F5a` and `F5c` |

Both are read by `src/live/field-analysis.test.ts`, and either can be run through
the script a real bundle goes through:

```
npm run analyze:field -- fixtures/field/stray-bundle.json fixtures/field/stray-truth.json
```

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
| Shafer Butte drawn 50 px off its apex, which is 2.223° where the `far` band's 3σ limit is 1.95° | `F3.far` |
| Mores Mountain drawn `visible` while both annotators report it absent | `F5a` |
| Trinity Mountain drawn with a verdict from 55 km, beyond the capture's 30 km sweep | `F5c` |

The 50 px is a **3σ** excursion on purpose. A band tolerates one summit-axis past 2σ, so a
single 2σ exceedance would pass and the fixture would assert nothing. The two-exceedance half
of the gate is exercised in `src/live/field-analysis.test.ts`, where a capture can hold two
summits in one band.

`aligned-bundle.json` exercises the rest of the protocol: every summit is inside 2σ, its pan
capture carries the drag anchor to 0.84 of the half-frame (the registered pan target is 0.8),
and every capture reports a fix accuracy of 8.4 m under the bundle's declared convention, so
the bands are graded against the limits that accuracy derives rather than the registered ones.

To regenerate either pair, build a `SynthSpec` and write
`synthesiseFieldBundle(spec).bundle` and `.truth` as JSON. The synthesiser is
deterministic and takes no seed, so the files are byte-identical on any machine.

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
