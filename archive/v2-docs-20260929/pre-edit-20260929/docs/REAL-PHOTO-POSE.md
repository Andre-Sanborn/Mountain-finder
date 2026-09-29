# The first real annotated photograph — and what it says about the aligner

**2026-08-17.** The photographer supplied the camera originals of the Railroad Ridge frames.
The committed JPEG was a transcode; the originals' EXIF is intact. That single fact unblocked
everything below, and the result is the first photograph this repository has ever annotated
end to end with a flag on a named summit.

It also overturns two things I had recorded earlier the same day, and both corrections are here
rather than edited away.

## What the originals carry

Three frames, one position, one minute, three focal lengths — a controlled set nobody designed
and this repository could not previously have asked for.

| file | lens | hFOV | frame | `GPSImgDirection` |
|---|---|---|---|---|
| `railroad-ridge-48mm.heic` | 48 mm-eq (2× tele) | 41.11° | 4032 × 3024 | **174.089° T** |
| `railroad-ridge-24mm.heic` | 24 mm-eq (main) | 73.74° | 5712 × 4284 | 173.151° T |
| `railroad-ridge-14mm.heic` | 14 mm-eq (ultrawide) | 104.25° | 4032 × 3024 | 203.611° T |

All three: 44.139125 N, 114.595650 W, GPS altitude 3165.7 m, iPhone 15 Pro Max,
2024‑11‑09 15:10 −07:00. The 48 mm frame is the one committed as `tundra-blue-sky.jpeg`
— verified, not assumed: identical 4032 × 3024 and mean |ΔRGB| 1.03/255 over 36.6 M channel
samples.

**What the transcode dropped is exactly the GPS IFD.** The APP1 segment survives at 9 564 bytes
and the ICC Display‑P3 profile survives; position, altitude, heading and focal length are gone
together. A phone share sheet with "Include Location" off does precisely this, which is why
three of the six files supplied that day carry a lens and no position at all.

## The lens was the blocker, not the aligner

Every alignment run before this date assumed 26 mm-equivalent, hFOV 69.4°, because a stripped
JPEG names no focal length. The frame is 41.1°. That is a **1.69× error in image scale**, which
no amount of heading search can absorb.

Swept over the whole compass in 24 independent windows against the same 30 km SRTM profile:

```
                        windows producing an answer     lowest residual
wrong lens (26 mm-eq)          0 of 24                  2.03 deg
true  lens (48 mm-eq)          3 of 24                  1.11 deg  <- the window holding the truth
```

Under the true lens the window containing the heading is the only one that both survives its
gates and holds the lowest residual of all 24. Three windows score higher on raw NCC and every
one of them is rejected as `featureless-terrain-profile` — flat terrain, where the correlation
coefficient is meaningless.

## The photograph, annotated

```
npm run annotate -- fixtures/photos/real/tundra-blue-sky.jpeg \
  --exif fixtures/photos/real/railroad-ridge-48mm.heic \
  --peaks idaho-central --heading 174.686 --pitch -3.520
```

Nine summits are labelled by the pipeline; eight are outside the 41° frame; **Castle Peak,
3603 m at 11.07 km, bearing 176.411°, is in it** and its flag lands on the pyramid.

Two things on that image are worth separating:

- **The horizon line is SRTM.** It has never seen the photograph.
- **The marker is the peak database plus the projection.** Its height is OpenStreetMap's `ele`
  tag, never a DEM sample, so its position on the image is two unrelated data sources agreeing.

## Correction 1 — pitch, not roll, and EXIF has neither

At the EXIF pose the drawn horizon sits below the true skyline on the left of the frame and on
it at the right. My first reading of that was **roll** — one side high, the other low is the
classic signature. Measured, roll is worth almost nothing here:

```
heading x pitch, roll held at 0 (what align.ts does)   RMS residual  1.133 deg
heading x pitch x roll, roll searched -10..+10 deg     RMS residual  1.037 deg
```

An 8 % improvement is not a missing degree of freedom. The real term is **pitch**, which EXIF
does not record at all and which every run so far has silently assumed to be zero. The
photograph has a great deal of foreground tundra in it because the camera was pointed down.

## The pose, solved from the picture itself

Independent of both EXIF and the pipeline: Castle Peak's apex read off the full-resolution
image at **x ≈ 2178, y ≈ 973 px**. That is my reading of the picture — an agent looking at a
magnified crop with a labelled 50 px grid — and it is a judgement, not an instrument. It is
nonetheless the only measurement here that neither the magnetometer nor the aligner can have
influenced.

```
                       apex, from the image      pipeline at EXIF pose
horizontal from centre       +1.726 deg                +2.322 deg
vertical   from centre       +5.725 deg                +2.205 deg
```

Solving those two offsets:

```
true heading   174.686 deg
camera pitch    -3.520 deg   (pointed DOWN — hence all the tundra)
```

Rendered at that pose the marker lands at x = 2179, y = 974, one pixel from the apex, and the
horizon line follows the left crest, the notch and the right ridge.

## Correction 2 — the aligner's heading was BETTER than EXIF's

I recorded in `tests/acceptance/cases/railroad-ridge.ts` that the aligner "independently returns
174.893°, 0.804° away" from the EXIF heading, framing EXIF as the truth the aligner was
approaching. Against the photograph itself, that framing was wrong:

| source | heading | error vs the image |
|---|---|---|
| EXIF `GPSImgDirection` | 174.089° | **+0.596°** |
| `alignSkyline` recovered | 174.893° | **−0.207°** |

**The aligner was three times closer than the phone's magnetometer.** It reported
`low-confidence` while being right, which is the correct behaviour for an estimate whose margin
(0.031 against a 0.03 floor) genuinely was that thin — but the number it produced was good.

Its pitch was not: −1.552° recovered against −3.520° measured, an error of 1.97°. And that
error has a known cause pointing the right way. The extractor's documented remaining defect is
that ~40 columns near x ≈ 0.35–0.42 sit on the **snow/rock boundary part-way down the massif**
rather than on the crest above it. A skyline pulled *downward* in the image asks the fit for a
model horizon that is also lower, which is a pitch closer to zero — exactly the direction and
roughly the magnitude of the miss.

So the two halves of the CV stack fail differently and the distinction matters: the correlator
recovers heading well, and the extractor's residual bias lands almost entirely in pitch.

## What this changes

1. **The heading in the case file stays EXIF's**, not the aligner's and not the apex reading —
   a case may only assert what committed bytes carry, and the aligner's output can never become
   the ground truth it is graded against (AGENTS.md, "Independent expectations"). The apex measurement is recorded as
   an independent cross-check.
2. **Pitch is now a first-class unknown.** Nothing in EXIF supplies it, `--pitch` defaults to
   zero, and zero was the largest single error in the first render — 3.5° of it.
3. **The extractor's snow/rock columns are no longer a cosmetic residual.** They are the
   mechanism by which a good heading comes with a bad pitch.
4. **`npm run annotate` exists** and is the self-check for all of the above: it refuses without
   a position, a heading and a focal length, and it will not annotate a photograph whose frame
   disagrees with the `--exif` file it was handed.

## A real bug this shook out

`src/render/composite-page.html` built its backdrop data URL with
`String.fromCharCode(...new TextEncoder().encode(svg))` — one argument per byte. Every backdrop
until now was a small synthetic silhouette; the first real photograph blew the call stack at
4 MB. `composite.ts` had always done it with a loop, and the page carried a second copy that
did not. Fixed by deleting the copy, and the compositor now takes a photograph directly rather
than wrapping it in an SVG and base64-encoding it twice.


---

# Part 2 — two more viewpoints, and the library bug that was hiding them

**2026-08-17, later.** Five more camera originals arrived. Three of them reported **no metadata at
all**, and that turned out to be a defect in this repository's reading of them rather than
anything about the files.

## The bug: an arbitrary 50-byte limit

`exifr`'s HEIF detection is two lines:

```js
let size = file.getUint16(2);   // low half of the ftyp box size
if (size > 50) return false;
```

Every iPhone photograph carrying an HDR **gain map** — compatible brands `mif1 MiHB MiHA heix …`
— has a 52-byte `ftyp` box. Across the seven HEICs supplied to this project:

```
ftyp 44 bytes    IMG_3761 / 3762 / 3763     read correctly
ftyp 32 bytes    IMG_5603                   read correctly
ftyp 52 bytes    IMG_7270 / 6559 / 6594     REFUSED — "Unknown file format"
```

Nothing about the refused three is unusual. They are ordinary photographs from a recent iPhone
with HDR on, which is the default setting.

**This is the worst shape of bug this project recognises**, and it is worth being precise about
why. A photograph whose GPS a share sheet stripped and a photograph whose GPS is sitting in the
file unread were *indistinguishable*: both arrived as `{}`. The app would have told someone to
type in a position it was holding in memory, with exactly the same confidence either way. It is
the same failure as CV‑1 and X‑1 — a confident answer from a read that did not happen.

`src/exif/heif.ts` now walks the container itself (ftyp → meta → iinf/infe → iloc), finds the
item whose type is `Exif`, and hands the TIFF block to exifr. **The tag decoding was never the
problem.** Every point where the container says something the reader does not understand yields
a named failure, and `PhotoExif.unreadable` carries it up to a distinct `container-unreadable`
prompt — never conflated with "this photo records no location".

Also worth recording: `IMG_1371.HEIC` is a **JPEG with a `.HEIC` extension**. The reader says
`not-heif`, correctly — the extension is not evidence, the `ftyp` box is. Its GPS IFD survives
carrying only `GPSVersionID`, `GPSAltitudeRef` and `GPSHPositioningError`: a third distinct
stripping mode, alongside "everything gone" and "everything intact".

## Two new viewpoints — and the chain works cold

Both refused files carry a full pose, both sit on SRTM tiles already in `data/tiles/`, and both
are inside the committed `idaho-central` peak region. Neither had ever been seen by any part of
this system.

| | IMG_7270 | IMG_6594 |
|---|---|---|
| position | 43.77148 N, 116.08862 W | 44.08528 N, 115.90669 W |
| heading | **280.336° T** | **253.046° T** |
| lens | 24 mm-eq, hFOV 73.74° | 24 mm-eq, hFOV 73.74° |
| frame | 8064 × 6048 | 8064 × 6048 |
| GPS altitude vs SRTM | 2313.1 m vs 2308.3 m (**+4.8 m**) | 1444.1 m vs 1453.1 m (**−9.0 m**) |
| summits within 30 km | 41 | 28 |
| labelled in frame | **7** | **1** |

The GPS-altitude agreement is the useful number: a phone's altitude is the weakest thing it
records, and landing within 5 and 9 m of what the DEM reads at the phone's own stated coordinate
means the position is right to well inside a DEM posting. Neither figure was tuned; both are the
first run.

**IMG_7270** (Bogus Basin, looking WNW over the Boise front) is the strongest single image this
project has produced. Seven labelled summits across a 74° frame, the horizon line tracking the
distant hazy skyline rather than the near foreground ridge, and **Prospect Peak drawn greyed and
captioned `summit obscured`** — decision D8's self-occlusion rule firing on a real photograph for
the first time, on a summit that genuinely stands behind its own shoulder.

**IMG_6594** looks WSW across a valley. One summit in frame, Charters Mountain at 10.2 km, and
the horizon line follows the crest along the whole ridge and then drops correctly into the
saddle where the valley fog sits.

## What three viewpoints agree about

In all three photographs the drawn horizon sits **slightly below** the true skyline. Only
Railroad Ridge has been measured (−3.52°, Part 1); the other two are eyeball readings and are
recorded as such. But the direction is the same every time, and the reason is structural rather
than a bug: **EXIF carries no pitch**, `--pitch` defaults to zero, and a hand-held photograph of
mountains is nearly always tilted slightly down — that is how the foreground gets into the
frame. Anyone reading these images should read the vertical offset as the missing pitch, not as
a terrain error.

Neither new viewpoint is an acceptance case. They have one position source each and no
independent cross-check beyond the DEM, no summit has been identified by anyone who knows the
ground, and building a case on that would repeat the circularity the Railroad Ridge case was
carefully built to avoid. They are demonstrations, and this document is where they are recorded.


## P7.6 tested and refuted — the wide frames fail in the MIDDLE, not at the edges

The recorded hypothesis was that a wide frame's sky boundary near its edges is foreground tens
of metres away, which a sweep starting at 90 m never samples. Measured, that is not what
happens. Residual by distance from frame centre, in disjoint rings:

```
                          |x-0.5| ring:  0-0.1   0.1-0.2  0.2-0.3  0.3-0.4  0.4-0.5
48 mm  mean photo-minus-terrain, deg     -0.94    -2.14    -0.30    -0.55    -1.68
24 mm                                   -32.31    -9.93   -11.29   -13.48    +2.15
14 mm                                    +3.78    -6.03   -10.85    +5.87    +3.81
```

The error is **largest at the centre and smallest at the edges** — the opposite of an edge
effect. And the pose-independent measurement says plainly what is going on. Where does the
extractor put the boundary in the frame?

```
                     boundary rowNorm range      mean at frame centre
48 mm-eq             0.269 .. 0.446              0.360
24 mm-eq             0.260 .. 0.999              0.951
14 mm-eq             0.354 .. 0.991              0.553
```

`rowNorm` 0.999 is **the bottom row of the photograph**. In the wide frames the extractor is
tracking an edge in the foreground tundra, not the sky. The continuity constraint from P7.5 is
doing its job — the path is smooth and self-consistent — it is simply following the wrong
boundary, and a wide frame offers far more foreground for it to follow.

So **P7.6 is not a separate problem and there is no near-field term to add.** It is CV‑2 again:
the extractor separates sky from land on a luminance step, and a snowfield or a sunlit tundra
edge is also a luminance step. What is needed is a cue that distinguishes sky from bright ground
— colour, saturation, texture, gradient — which is exactly what the snow-dominant lookout
photograph already demanded. One fix, two symptoms.

That also explains why coverage tracks field of view (97.9 % at 48 mm, 62.5 % at 24 mm, 70.3 %
at 14 mm) while confidence barely moves: the extractor is not less sure in wide frames, it is
confidently wrong over more of them.
