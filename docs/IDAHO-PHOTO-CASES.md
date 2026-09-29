# The two supplied photographs — what is established so far

Two real photographs, supplied 2026-08-17, committed as `fixtures/photos/real/`.
EXIF did **not** survive the upload path: `Orientation` and dimensions only — no GPS, no
`GPSImgDirection`, no focal length.

## 1. `lookout-snow-haze.jpeg` — Sunset Mountain Lookout, Idaho

**Location established, not guessed.** `Sunset Mountain` was found by importing central Idaho
from Overture (2.09 MB fetched, **0.0071%** of the 29.47 GB release, 6 row groups of 5056):

```
Sunset Mountain   43.89851, -115.64677   2393 m   (OSM ele tag, via Overture)
SRTM N43W116 reads the same coordinate at   2392.296 m
```

**A 0.7 m agreement between an OSM summit tag and the SRTM grid**, independently sourced. That
is a real cross-check of both the coordinate and the terrain layer at the actual viewpoint.

Extractor result: **coverage 1.4%**, mean confidence 0.140 — it cannot read this photo, and
says so. Diagnosed in `CV-REAL-PHOTO-FINDING.md`: bright→dark→bright vertical profile (snow
below brighter than sky above), desaturated white haze, contrast collapsing to −9/255 at the
right edge, plus a lookout frame over the left quarter.

## 2. `tundra-blue-sky.jpeg` — Railroad Ridge Road, White Cloud Mountains, Idaho

**Location NOT yet established.** "Railroad Ridge" did not come through the import: ridges
carry no `ele` tag and the importer drops elevation-less records by design (290 dropped in this
box), which is correct behaviour — it must not invent a height.

What the import *does* confirm about that area: **Castle Peak, 44.0398, −114.5870, 3603 m** —
the White Clouds high point, and the obvious anchor for the range in this photo.

Extractor result: **coverage 98.8%**, mean confidence 0.575, 506 of 512 columns resolved, the
skyline placed 29–36% down the frame. Confidence climbs 0.407 → 0.712 left to right, matching
the scene: smooth snowfield against bright cloud on the left, dark rock against blue sky on the
right. **The extractor reads this photograph correctly.**

## What is still needed, and why it matters more for photo 2

Neither photo has a view bearing. That is *not* fatal — recovering the heading is precisely what
`src/cv`'s aligner is for, and it does so to 0.013° against synthetic terrain. Photo 2 is the
one that can actually exercise that, because its skyline is readable.

The missing piece for photo 2 is a **position on Railroad Ridge Road**. A rough one is enough:
the aligner searches heading, so only the coordinate must be right. Terrain is already fetched
(`N44W115`, `N44W116`).

Once that lands, the full loop can run for the first time on a real photograph: extract the
skyline → align against SRTM-derived terrain → recover the heading → label the summits → and
check the names against what is actually in the picture.

## Update: the map screenshot narrows photo 2, but does not pin it

A supplied map screenshot shows the photo pinned with three named features around it:
**Crater Lake** (west), **The Gunsight** (south-west), **Tin Cup Lake** (far south-west).

Searched against the imported Idaho data:

- **"Gunsight Peak" exists at 43.69767, −115.07147, 2893 m — but that is ~45 km south-west of
  the White Clouds.** It is a *different feature* from the "The Gunsight" on the map, which is
  unlabelled in the peak data (likely a named gap or notch rather than a summit). Recorded as a
  negative so nobody later matches on the name and lands 45 km away. This is the same hazard the
  Overture import already flagged: *"Cow Hill" is 287 m in Lochaber and 989 m in Santa Clara;
  only ids are safe.*
- The White Clouds summit set around the pin **is** confirmed in real data, and it is the range
  in the photograph:

```
Castle Peak          44.03980, −114.58698   3603 m
Lee Peak             44.10281, −114.62862   3458 m
Lonesome Lake Peak   44.07531, −114.61207   3445 m
Mount Andrus         44.09107, −114.60921   3438 m
White Cloud Peaks    44.09734, −114.62788   3438 m
Patterson Peak       44.04868, −114.61867   3317 m
Merriam Peak         44.05244, −114.58086   3334 m
```

**Still not established: the camera position.** A screenshot places the pin relative to lakes,
but reading a coordinate off it by eye would be exactly the kind of invented number this project
refuses elsewhere. The mapping app showing that pin can give the number directly.

## Photo 2 — position established, 2026-08-17

Supplied by the photographer: **44°08'20.4"N 114°35'44.5"W** → **44.13900, −114.59569**.

```
SRTM N44W115 at that coordinate:  3166.0 m  =  10,387 ft
```

Railroad Ridge Road is known to run at roughly 10,400 ft, so the DEM and the stated location
agree independently — the same kind of cross-check that validated Sunset Mountain to 0.7 m.

**32 named summits within 25 km.** The nearest, by bearing from the camera:

```
WCP-10                205°    2.6 km   3378 m
Calkens Peak          225°    3.2 km   3509 m
WCP-9                 219°    3.9 km   3433 m
Lee Peak              213°    4.8 km   3458 m
White Cloud Peaks     209°    5.3 km   3438 m
Mount Andrus          191°    5.4 km   3438 m
Lonesome Lake Peak    190°    7.2 km   3445 m
Castle Peak           176°   11.1 km   3603 m
```

The "WCP-*n*" names are the White Cloud Peaks' authentic numbered summits, which is a good sign
the Overture/OSM data for this range is real rather than approximate.

The photograph looks across a broad tundra foreground at a jagged skyline, consistent with the
southward arc (roughly 170–230°) where Castle Peak, Lee Peak, Mount Andrus and the WCP summits
all sit. **The heading is still unmeasured** — and recovering it from terrain alone is precisely
what `src/cv`'s aligner exists to do, on the one photograph the extractor reads well (98.8%
coverage).

### What is now established for this case
- position — from the photographer, cross-checked against SRTM to the foot
- terrain — `N44W115`, `N44W116` fetched, 0 voids
- summits — 32 within 25 km, from Overture/OSM with tagged elevations
- readable skyline — 506 of 512 columns, mean confidence 0.575

### What remains
- the heading, to be **recovered** rather than supplied
- which specific summits appear in the frame, to become the must-see assertion

---

## Both photographs are acceptance cases now (2026-08-17)

Everything above is committed as executable ground truth. It is **not** a
`GroundTruthCase`: those require `view.bearingDeg: number` and a non-empty
must-see list, and neither photograph has either. So they are a second type,
`PhotoCase` (`tests/acceptance/cases/photo-case-types.ts`), asserting everything
*except the frame*:

| | |
|---|---|
| Cases | `tests/acceptance/cases/sunset-mountain-lookout.ts`, `railroad-ridge.ts` |
| Suite | `tests/acceptance/photo-cases.test.ts` — 20 new tests, `npm run test:acceptance` 153 → 173 |
| Terrain | `fixtures/tiles/cases/sunset-mountain-lookout-window.*` (406 × 559, 443 KiB), `railroad-ridge-window.*` (505 × 703, 693 KiB) |
| Peaks | `fixtures/peaks/regions/idaho-central/` — wired by `loadPeakCellIndex`, coverage checked by `TiledPeakStore.coverageFor` |

### What is ASSERTED (a failure fails the build)

* **The photographs carry no bearing.** `extractPhotoExif` over the committed
  bytes must report the stated dimensions and orientation and `undefined` for
  GPS latitude, longitude, altitude, `GPSImgDirection`, its ref, and both focal
  lengths. This is the load-bearing one: *“the view bearing is unmeasured”* is
  now a measured property of the files, not a sentence in a comment.
  `view.bearingDeg` is typed `null` — not `number | null` — so filling it in
  requires changing the type, which a reviewer sees.
* **Position and elevation.** The committed window reads
  **2392.296 m** at the lookout against the OSM tag's 2393 m (± 5 m), and
  **3166.122 m** at the Railroad Ridge camera against the documented 3166 m
  (± 2 m). Each case's cross-checks are asserted separately, with their own
  tolerances and an explicit statement of which are independent:

  | case | figure | source | independent? | Δ from DEM |
  |---|---|---|---|---|
  | sunset | 2393 m | OSM `ele`, via Overture | yes | −0.70 m |
  | sunset | 2392.296 m | SRTM, as recorded above | **no** — same data, fixture integrity | 0.000 m |
  | sunset | 7 869 ft = 2398.5 m | National Historic Lookout Register | yes | −6.20 m |
  | railroad | 3166 m | SRTM, as recorded above | **no** — same data, fixture integrity | +0.12 m |
  | railroad | 10 433 ft = 3180 m | published Railroad Ridge crest | yes | −13.88 m |

* **The windows cover their sweeps.** Not just the viewpoint: 72 bearings at
  the sweep's outer radius (6 km and 7.5 km) must each read real terrain, so a
  square cut around a circular sweep is checked at its corners.
* **The committed bytes match the registered window.** Geometry read back from
  the sidecar must reproduce `CASE_TERRAIN`'s bounds — a window regenerated
  after the bounds moved but never re-committed reads real elevations from the
  wrong place, and that is a failure with no symptoms.
* **The peak region covers the query.** `coverageFor` reports the lookout
  covered to 55.4 km and Railroad Ridge to 63.5 km against a 25 km query, all
  cells held, 15 and 32 named summits inside the radius.
* **The named summits are in the dataset**, by id, within 2 m of the recorded
  coordinate, at exactly the tagged height, and with recorded bearing/range
  reproduced by the fixtures' own geometry kit.

### What is RECORDED, and asserted in NEITHER direction

Which summits are in either frame. Eight are recorded for Railroad Ridge and
four for Sunset Mountain, each with the reason it is unresolved; the suite
prints them and gates only on the reason existing. This is the treatment
`disputed` gets in `case-types.ts` — the difference being that `disputed`
records a conflict *between* sources and this records the absence of any.

Deriving a must-see list from the geometry would make the pipeline its own
ground truth, which AGENTS.md, "Independent expectations", forbids. Two independent reasons apply to
the most tempting candidate, Castle Peak: no bearing, **and** it stands 11.1 km
out, outside a 7.5 km window that can therefore produce a false *visible* and
never a false *hidden*.

### Two DEM readings worth carrying forward

* The Sunset window's highest sample is **2471 m at 43.95222 N, 115.7075 W** —
  78 m *above* the lookout, to the north-west. The viewpoint is not a local
  maximum in every direction.
* The Railroad window's highest sample is **3503 m at 44.11833 N,
  114.62083 W**, 268 m east of the Calkens Peak node tagged at 3509 m. SRTM
  under-reads that summit by 6 m *and* displaces its maximum by a quarter of a
  kilometre — the behaviour MISSION.md documents, on this range, in this data.

### One disagreement left open

Railroad Ridge is published as **3 180 m** (dangerousroads) and **2 941 m**
(PeakVisor). Neither page could be fetched from this sandbox; both were read
through the web-search index. The DEM sides with the former (3166 m at a point
on the road). Recorded in the case file as a disagreeing source rather than
resolved, so nobody later finds the second number and thinks it was missed.

### What still remains

Unchanged by all of this: **the heading**, and **which summits are in the
frame**. When the aligner recovers a bearing from `tundra-blue-sky.jpeg` and the
summits in it are identified, that case graduates from `PhotoCase` to a
`GroundTruthCase` with must-see and must-not-see lists — and its terrain window
has to grow first, because a claim about Castle Peak needs the terrain out to
Castle Peak.
