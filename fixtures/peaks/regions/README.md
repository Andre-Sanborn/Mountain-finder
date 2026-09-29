# Imported peak regions

Peak datasets imported from Overture Maps by `npm run fetch:peaks`, cut into
1°×1° cells and queried by `TiledPeakStore`
(`src/providers/peak-tile-store.ts`).

This is Q5's answer to the coverage problem: `../ground-truth-peaks.json` holds
15 hand-cited summits assembled for four viewpoints, which is why v2.0 only
works at those four. A region here holds every named summit Overture carries in
its area.

## Layout

```
<region>/index.json         manifest: citations, bounds, release, cell list
<region>/cells/N45E007.json { "cell": "N45E007", "peaks": [ … ] }
```

Cells are named with the **same 1° naming as the SRTM terrain tiles**
(`tileNameFor`), so a query resolves to the same cell names on the peak side and
the elevation side, and there is no second cell-naming rule to disagree with the
first at 0° or 180°.

A query loads only the cells its radius touches, and caches them. `index.json`
is enough to answer "how many peaks are in this dataset" and "which cells exist"
without opening one.

## `zermatt/`

| | |
|---|---|
| Source | Overture Maps release `2026-06-17.0`, `theme=base/type=land` |
| Area | 45.6…46.4 N, 7.2…8.2 E — Upper Valais |
| Summits | 1 786 across 4 cells (`N45E007`, `N45E008`, `N46E007`, `N46E008`), 61 of them above 4 000 m |
| Cost | 42.17 MB fetched of a 29.47 GB release = **0.1431 %** |
| Regenerate | `npm run fetch:peaks -- --region zermatt` |
| Licence | © OpenStreetMap contributors, ODbL-1.0, via Overture |

It covers the Gornergrat acceptance viewpoint and the two SRTM tiles the
repository already holds terrain for.

## `california/`

| | |
|---|---|
| Area | 36.4…41.0 N, −123.6…−119.0 W — Bay Area, Diablo Range, Yosemite high country, Lassen |
| Summits | 3 341 across 24 cells; 266 above 3 000 m |
| Cost | 16.72 MB fetched of the 29.47 GB release = **0.0567 %** (30 row groups of 5 056, in 2 of 32 parts) |
| Regenerate | `npm run fetch:peaks -- --bbox 36.4,-123.6,41.0,-119.0 --name california` |

Cut for the `mount-diablo-summit` case, whose must-see summits run from
Mount Tamalpais at 60 km to Lassen Peak at 292 km. Highest imported: Mount
Ritter 4 007 m, Mount Lyell 3 993 m, Mount Dana 3 976 m — the Yosemite crest,
which is what this box's eastern edge (−119.0) cuts through. Mount Whitney and
Mount Shasta are deliberately **outside** it; a region is sized to its case, not
to a state.

## `cascades/`

| | |
|---|---|
| Area | 45.0…49.2 N, −123.6…−120.4 W — Oregon border to the Canadian border |
| Summits | 2 717 across 19 cells; 17 above 3 000 m |
| Cost | 17.67 MB fetched of the 29.47 GB release = **0.0600 %** (54 row groups of 5 056, in 1 of 32 parts) |
| Regenerate | `npm run fetch:peaks -- --bbox 45.0,-123.6,49.2,-120.4 --name cascades` |

Cut for `kerry-park-seattle` (Rainier 98 km, Baker 160 km, Hood 250 km).

**`class = volcano` is load-bearing here and was verified, not assumed.** The
big Cascade summits are `natural=volcano` in OSM, and re-running the same
importer over Rainier's own degree-tenth with `--classes peak` returns 14
summits — Liberty Cap, Point Success, Columbia Crest, Little Tahoma … and **no
Mount Rainier**. The volcanoes are in this dataset only because
`DEFAULT_SUMMIT_CLASSES` carries both classes: Rainier 4 392 m, Adams 3 743 m,
Hood 3 429 m, Baker 3 287 m, Glacier Peak 3 214 m, Saint Helens 2 549 m
(post-1980 height, correctly). Lassen Peak 3 187 m is in `california/` for the
same reason.

## `fort-william/`

| | |
|---|---|
| Area | 56.3…57.2 N, −5.7…−4.5 W — Lochaber |
| Summits | 684 across 4 cells; 95 above 1 000 m |
| Cost | 5.14 MB fetched of the 29.47 GB release = **0.0175 %** (7 row groups of 5 056, in 1 of 32 parts) |
| Regenerate | `npm run fetch:peaks -- --region fort-william` |

Highest: Ben Nevis 1 345 m, Aonach Beag 1 234 m, Aonach Mòr 1 221 m, Càrn Mòr
Dearg 1 220 m — the Ben Nevis massif in the right order, which is the cheapest
possible check that the box landed where it was aimed.

## `idaho-central/`

| | |
|---|---|
| Area | 43.4…45.2 N, −116.6…−113.8 W — Boise Mountains to the White Clouds and the Salmon River Mountains |
| Summits | 709 across 12 cells |
| Cost | 2.09 MB fetched of the 29.47 GB release = **0.0071 %** (6 row groups of 5 056) |
| Regenerate | `npm run fetch:peaks -- --bbox 43.4,-116.6,45.2,-113.8 --name idaho-central --classes peak,volcano,ridge` |

Cut for the two supplied photographs — the **photo cases** in
`tests/acceptance/cases/` — and it covers both of them with room to spare:
`TiledPeakStore.coverageFor` reports the Sunset Mountain lookout covered to
**55.4 km** and the Railroad Ridge camera to **63.5 km**, against the 25 km
radius each case queries. Both numbers are asserted in
`tests/acceptance/photo-cases.test.ts`, from the index alone, before a cell is
read.

Within 25 km it holds 15 named summits around the lookout and 32 around the
Railroad Ridge camera, including the authentic numbered White Cloud summits
(`WCP-1` … `WCP-10`) and Castle Peak 3 603 m, the range high point.

`--classes` carries `ridge` here and it changed nothing that matters: **Railroad
Ridge itself is not in this dataset**, because ridges carry no `ele` tag and the
importer drops elevation-less records rather than invent a height (290 dropped
in this box). That is the correct behaviour and it is why the `railroad-ridge`
photo case takes its ground elevation from SRTM and cross-checks it against a
published figure, instead of citing a summit record that does not exist.

## `idaho-bogus-basin/`

| | |
|---|---|
| Area | 43.2…44.4 N, −116.9…−115.3 W — the 60 km disc around the Bogus Basin viewpoint |
| Summits | 174 across 4 cells (`N43W116`, `N43W117`, `N44W116`, `N44W117`) |
| Release | `2026-09-23.1`, retrieved 2026-09-29 |
| Cost | 2.27 MB of column reads (3 row groups of 5 296, in 1 of 128 parts); 51.9 MB of footers on top, because only 29 of the 128 were cached |
| Regenerate | `npm run fetch:peaks -- --bbox 43.2,-116.9,44.4,-115.3 --name idaho-bogus-basin --classes peak,volcano,ridge --release 2026-09-23.1` |

Cut for `sites/bogus-basin.json`, and it is the region that site now names. The
bounds enclose the **60.5 km** disc the site package cuts terrain for — the
sweep's 60 km plus 0.5 km of margin — whose hand-derived extent is
43.22739…44.31557 N, −116.84211…−115.33513. `TiledPeakStore.coverageFor` reports
the viewpoint covered to **63.3 km**, so the 60 km query is complete, and the
package reports **104 named summits inside 60 km**. `idaho-central` answered the
same query to 41.1 km and 96 summits: it was cut for 43.4 N / −116.6 W and its
south-west corner clips the disc.

`--classes` carries `ridge` to match `idaho-central`, so the two are comparable
row for row. It changes nothing: ridges carry no `ele` tag and the importer drops
elevation-less records (272 dropped in this box, alongside 672 unnamed).

**Why a new region and not a re-import of `idaho-central`.** The Idaho photo
acceptance cases assert `idaho-central`'s summit ids, coordinates and heights,
and the release it was cut from — `2026-06-17.0` — has been deleted from the
bucket, so those exact bytes cannot be produced again. `idaho-central` is
therefore frozen, and `tests/unit/peak-regions.test.ts` holds a sha256 over its
index and every cell to keep it that way.

### Finding: two Overture releases three months apart barely move a summit

`idaho-central` (`2026-06-17.0`) and `idaho-bogus-basin` (`2026-09-23.1`) overlap
on 43.4…44.4 N, −116.6…−115.3 — the intersection of their stated bounds. Each
holds **122** summits there, and **120** carry the same GERS id in both.

| quantity | result |
|---|---|
| names differing among the 120 | **0** |
| elevations differing | **0**, max change **0 m** |
| positions differing by more than 1 m | **4**, max displacement **198.3 m** |

The four that moved: Lightning Creek Rocks 198.3 m, Cougar Mountain 48.1 m,
Shafer Butte 6.2 m, Jackson Peak 4.0 m. Every one keeps its name and its height,
so these are mapper edits to node placement, not a datum or a pipeline change.
Shafer Butte's 6.2 m is why the site definition now says the import lands it
**30.2 m** from the viewpoint rather than 32.7 m.

**The GERS id is not quite stable, and the id is what a cross-release comparison
keys on.** Of the two unmatched ids in each direction, one pair is the same
mountain: `Homer's Nipple`, 1 113 m, 8.3 m apart, with a different UUID in each
release. The other two are a genuine change in content — `Trail Creek Summit`
1 539 m is gone from `2026-09-23.1`, and `Lightning Ridge` 2 481 m is new, with
no counterpart within 5 km in either direction. So a release-to-release diff by
id alone overstates the churn: it reports 2 dropped and 2 added where the honest
reading is 1 re-identified, 1 removed and 1 added.

## Total committed size

`fixtures/peaks/` is **3.57 MB** for all six regions (9 411 summits in 67
cells): california 1.3 MB, cascades 1.1 MB, zermatt 672 kB, idaho-central
300 kB, fort-william 268 kB, idaho-bogus-basin 67 kB. Six regions, not a
continent — and every one of them cost a couple of megabytes of column reads.

## Where the numbers come from

* **Position** is the midpoint of Overture's `bbox`, which is the point geometry
  rounded outward to float32 — sub-metre for a summit. See
  `src/providers/overture-peaks.ts` for why `geometry` (96 % of the bytes) is not
  read for a 0.3 m gain.
* **Height** is Overture's `elevation` column, which carries the OpenStreetMap
  `ele` tag through unchanged — verified row by row against the same rows'
  `source_tags.ele` on the live data (Matterhorn `"4478"` → 4478, Weisshorn
  `"4505"` → 4505). Records therefore declare `elevationSourceKind: "osm"`,
  which is the honest label in the frozen contract.
* **A summit with no `ele` tag is dropped, not filled in.** MISSION.md forbids
  taking peak heights from the DEM: SRTM under-reads sharp summits by 250–350 m
  and displaces them ~320 m. The import counts and prints those drops: 285 in
  the Zermatt area, 871 in Lochaber, 349 in California, 221 in the Cascades.
  Unnamed summits are dropped and counted the same way (628 / 2 598 / 3 869).

## These do NOT replace the cited dataset

`../ground-truth-peaks.json` remains the authority for the acceptance suite. Its
values carry individual citations; these carry one dataset-level citation to an
OSM-derived aggregate. **Where the two disagree, the cited value wins** — see
the disagreement table in `../README.md`.
