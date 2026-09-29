# IMG_7270 — deriving the camera heading and pitch

`fixtures/photos/real/hdr-gainmap-7270.heic` records a compass heading of
**280.336° true**. The camera faced **187.9° ± 0.9°**. This document derives
that number so it can be cited instead of retyped, and so the next reader can
disagree with the arithmetic rather than with the conclusion.

Every figure below comes out of three scripts in
[`scripts/probes/img-7270-heading/`](../scripts/probes/img-7270-heading/). They
read the committed photograph and the committed peak cells, print what this
document cites, and write nothing.

```bash
npm run fetch:tiles -- --bbox 43.2,-116.9,44.4,-115.3   # once; tiles are gitignored
npx tsx scripts/probes/img-7270-heading/exif-units.ts
npx tsx scripts/probes/img-7270-heading/geometry.ts
npx tsx scripts/probes/img-7270-heading/sun.ts
```

---

## 1. Inputs

### The photograph

| | |
|---|---|
| position | 43.77148 N, 116.08862 W (`GPSLatitude`/`GPSLongitude`, converted from DMS) |
| horizontal error | `GPSHPositioningError` 5.3 m |
| GPS altitude | 2313.1 m |
| instant | `DateTimeOriginal` 2026:05:31 15:41:43, `OffsetTimeOriginal` −06:00 → 2026-05-31T21:41:43Z |
| `GPSTimeStamp` | 2026:05:31 21:41:42.37 UTC — agrees with the local time and its offset to within a second |
| `GPSImgDirection` | 280.336°, `GPSImgDirectionRef` `T` |
| `Orientation` | 1 (upright as stored) |
| stored frame | 8064 × 6048 px |
| lens | `FocalLengthIn35mmFormat` 24 mm, iPhone 17 Pro Max, iOS 26.5 |

exifr refuses this container outright, so the tags are read the way the app
reads them: `src/exif/heif.ts` walks the HEIF boxes for the `Exif` item and
hands the TIFF block to exifr. The 52-byte `ftyp` box that causes the refusal is
documented in [REAL-PHOTO-POSE.md](REAL-PHOTO-POSE.md) § part 2.

### The ground

SRTM reads **2308.3 m** at the phone's own coordinate, bilinearly interpolated
from `data/tiles/N43W116.hgt`. GPS altitude is 4.8 m above that, which is well
inside one DEM posting and is the reason the position is treated as sound.

Eye elevation is ground + **1.6 m** = 2309.9 m. The 1.6 m is the project's
standing default for a hand-held frame, not a measurement; § 5 reports what it
costs.

### The summit

Deer Point, from the committed peak cell
`fixtures/peaks/regions/idaho-bogus-basin/cells/N43W117.json`:

| | |
|---|---|
| id | `overture/bb7147e9-f16f-3d21-a0cb-a60a47cc8873` |
| position | 43.75489 N, 116.09900 W |
| height | 2150 m, from the OpenStreetMap `ele` tag carried through Overture — not a DEM sample |

### The pixel

Two annotators independently put Deer Point's summit at **x ≈ 1335, y ≈ 535** in
a 1920 × 1080 working frame. What they marked is the ground crest directly under
the mast cluster on Deer Point, not a mast top; the masts stand roughly 30 px
higher in the frame.

The record carries one agreed pixel. The two readings were never written down
separately, so the ±5 px used in the error budget is a read precision rather
than a measured spread between annotators. A repeat of this derivation should
record both readings.

### The frame

The working frame is the 4:3 original centre-cropped to 16:9 and scaled to
1920 × 1080. The crop takes rows off the top and bottom and keeps the full
width, so the horizontal field of view is the original's:

```
hFOV = 2 · atan(18 / 24) = 73.740°        long side of a 24 mm-equivalent frame
vFOV = 2 · atan(tan(hFOV/2) · 1080/1920)
     = 2 · atan(0.750000 · 0.5625) = 45.747°
```

The original's own vertical angle is 58.716°, and it is not the one to use: the
annotators read a 16:9 frame.

---

## 2. Bearing, range and apparent altitude

Initial bearing and great-circle range from the viewpoint to Deer Point, on a
sphere of radius 6 371 008.8 m:

```
bearing   204.32°  true
range       2.025  km
```

Apparent altitude, with the standard refraction coefficient k = 0.13 folded into
an effective Earth radius R/(1 − k) = 7 323 km:

```
drop      = d² / (2 · R_eff) = 2025² / (2 · 7 323 000) = 0.3 m
altitude  = atan( (2150 − 2309.9 − 0.3) / 2025 ) = −4.524°
```

Deer Point is 160 m below the eye at 2 km, so the summit sits four and a half
degrees below the horizontal. Refraction is worth 0.3 m at this range and
changes the angle by under 0.01°; it matters at 30 km, not here.

---

## 3. Pixel to angle, and the heading

For a rectilinear frame, the angle off the optical axis at pixel x is

```
offset = atan( (x − W/2) / (W/2) · tan(hFOV/2) )
       = atan( (1335 − 960) / 960 · 0.750000 )
       = 16.329°   right of centre
```

so

```
heading = bearing − offset = 204.32 − 16.329 = 187.990°
```

That is the flat, one-axis answer. The probe does better and solves the full
projection for heading and pitch together, because a target 16° off-axis and 4.5°
below the horizon does not separate cleanly into two independent angles. Newton
on `projectToImage` from `src/core/projection.ts`, with roll held at zero:

```
solved heading   187.938°  true
solved pitch      −4.939°
re-projected     x 1335.00 px, y 535.00 px
```

The two-axis solve moves the heading 0.05° from the flat answer. Call it
**187.9°**, and **188° ± 1°** once § 5 is applied.

The pitch is the second half of the same solve. The summit's apparent altitude
is −4.524° and it sits 5 px above the frame's centre row, so the optical axis
points **4.939° below horizontal**. EXIF carries no pitch, and this is the
second real photograph in the project to be solved downward: Railroad Ridge
solves at −3.520°.

---

## 4. The Sun, as a second instrument

The photograph carries a flare entering from the top-right corner, so the Sun
must be off the right-hand side of the frame. Solar position at the recorded
instant, topocentric and airless, from `src/core/celestial.ts`:

```
azimuth     238.3°  true
elevation    57.1°
```

The frame's half-width is 36.870°.

| heading | Sun, relative to the axis | side | in frame? |
|---|---|---|---|
| 187.938° (solved) | +50.4° | right | no |
| 280.336° (`GPSImgDirection`) | −42.0° | left | no |

The Sun is outside the frame under either heading, which is what a flare rather
than a visible disc already implies. **The side is the discriminator.** A camera
facing 280.336° has the Sun 42° to its left, and no flare could enter from the
right.

This is an independent instrument in the sense the project means: it shares no
input with § 3 except the viewpoint. It uses the clock and an ephemeris; § 3 uses
a summit and a DEM.

---

## 5. Error budget

| term | effect on heading | effect on pitch |
|---|---|---|
| ±5 px read precision on the annotated pixel | ∓0.207° | ±0.219° |
| summit node vs the ground high point, ±30 m at 2.025 km | ±0.849° | small |
| eye height anywhere in 0–2 m | — | 0.056° across the whole span |
| eye from GPS altitude (2313.1 m) instead of the DEM | 0.004° | 0.139° |

The summit-node term dominates. Overture carries the OpenStreetMap node, which
on a summit covered in masts and buildings is placed by eye; 30 m at 2.025 km is
0.849° of bearing and it goes into the heading one for one.

Adding the two independent terms in quadrature gives ±0.87°, so the heading is
**187.9° ± 0.9°** and the pitch **−4.94° ± 0.26°**. Nothing in the budget comes
within 90° of closing the gap to 280.336°.

---

## 6. Cross-checks

**Doe Point.** The next committed summit along the same skyline, 1.937 km away
at bearing 197.71°, projects under the solved pose to x 1180, y 536 — 155 px
left of Deer Point and level with it. The frame's crest at x 1180 sits within
about 10 px of that, read by eye off a gridded crop rather than by an annotator,
so this confirms the pose rather than measuring it. Little Deer Point lands in
frame too, at x 1446, y 551.

**The 280° sector is empty of the picture.** Eleven committed summits fall inside
a 73.74° frame centred on 280.336° — Shafer Butte at 295.06°, Prospect Peak at
295.95°, Crown Point at 301.84°, and eight more, all between 250° and 316°. That
whole sector is outside a frame centred on 188°, and none of the summits the
picture does contain is in it. An annotation run at the EXIF heading labels
summits the frame does not hold.

**Shafer Butte is where the camera is, not in front of it.** Its committed node
is 30 m from the fix.

---

## 7. What is wrong with the tag

`GPSImgDirection` is 280.336° and the camera faced 187.938°: an error of
**+92.398°**.

Two ordinary explanations are ruled out by the file itself.
`GPSImgDirectionRef` is `T`, so the tag is already true-referenced, and Idaho's
declination is about +11.7° in any case — an eighth of the error.
`Orientation` is 1, so the frame is not rotated in storage.

**Two explanations remain, and this photograph does not separate them.**

**A heading referenced to the phone's top edge.** Held in landscape with its top
edge to the right, the phone's top edge points 90° clockwise of the lens axis:
187.938 + 90 = **277.938°**, against a recorded 280.336°, a residual of 2.398°.
A Mapillary iOS 6.11.1 release note reports exactly this — compass angles a
quarter-turn out on iOS 26 because landscape compensation is not applied. The
note is known here only through a search-result summary; the forum page that
carries it refuses anonymous scripted access and has not been read, so its exact
wording and its scope are unconfirmed.

**A compass that is wrong while the device moves.** `GPSSpeed` is 1.5907 with
`GPSSpeedRef` `K`, so the phone was moving at 1.59 km/h, about 0.44 m/s — a slow
walk. Every other real photograph in the repository was taken between a standstill
and 0.143 km/h.

**The two are confounded at n = 1.** IMG_7270 is the only frame in the repository
taken while moving, and it is also the only frame taken on iOS 26.5; the other
iPhone 17 Pro Max frames are on iOS 26.0. Motion and OS point release cannot be
told apart from one photograph. Separating them needs two more frames from the
same phone: one standing still on iOS 26.5, and one walking on the earlier build.

A steel railing at the viewpoint was the third candidate and is the weakest of
the three. A local magnetic disturbance has no reason to land within 2.4° of a
right angle.

---

## 8. What this photograph does and does not establish

**It establishes that `GPSImgDirection` can be a quarter-turn wrong**, on a
current iPhone, with the tag's own reference field saying nothing is amiss. The
rule that follows is in [FINDINGS.md](FINDINGS.md) X-10: treat the tag as a hint
to be checked against the picture, never as a documented pose.

**n = 1 on everything else.** One frame, one phone, one moment, one viewpoint.
Six other real photographs were checked the same way and each agrees with its
own Sun or its own solved pose — the Railroad Ridge 48 mm frame records 174.089°
against a solved 174.686°. So nothing here says how often an iPhone heading is
wrong, only that this one is, and by how much.

This viewpoint is not an acceptance case. It has one position source, no summit
identified by anyone who knows the ground, and its annotator pixel was read by
agents rather than by a person who has stood there.
