# Adversarial review — Wave 3 gate: `src/providers` (2026-08-16)

The layer two prior reviews excluded, and the most byte-level-dangerous in the codebase.

**Headline: the byte-level work is right.** Grid arithmetic, tile naming, the Parquet
footer/pruning path and Overture extraction all survived direct attack with real data. Every
finding lives one layer up, in the *area* logic — which cells and tiles a query decides it
needs. **All four are a missing peak or a missing tile. None is a wrong number.**

## 1. MEDIUM-HIGH — a 360°-wide box collapses to a single 1° meridian strip

`tile-store.ts` — `west`/`east` are normalised into `[−180, 180)` first, so a box spanning
exactly 360° has `east === west`, `width` becomes 0, and `lonCount` becomes **1**.

Two live callers produce exactly that box: `boundingBoxAround` whenever a circle reaches a pole,
and `fetch-tiles.ts` capping `dLon` at 180.

```
npm run fetch:tiles -- --around 89,10 --radius-km 200
  downloads N87W170, N88W170, N89W170   — three tiles on a meridian 180° away
  does NOT download N89E010             — the tile the observer is standing on
  reports "3 downloaded", exits 0
```

Silent in both directions: no error, no short list, just fewer cells. Narrow trigger (within
~`radiusKm/111`° of a pole, or any whole-world box), one-line fix.

## 2. MEDIUM — a bbox query loads the right cells, then filters every peak out

`cellsForBox` goes through `tileNamesForBounds`, which **normalises** longitude. `withinBox`
then compares **raw** longitudes, and `boundingBoxAround` emits unnormalised west/east. Near the
antimeridian the box is `179.33 … 180.47` while every stored peak is in `[−180, 180]`.

```
cells loaded  = [ 'S18E179', 'S18W180' ]     ← both, correctly
recordsInBox  = [ 'east-of-seam' ]           ← half discarded
```

The radius path is correct; only the bbox path is affected, and the pipeline uses the radius
path today. But `fetchPeaks({bbox})` is public surface, and with `allowEmpty` unset it raises
*"the local peak dataset holds no named peaks in this area"* — **a confident false claim about
cells it is holding in memory.** Two notions of "in this box" in one class: the same shape as
Wave 1 finding 2.

## 3. MEDIUM — a query wider than the dataset returns a silently truncated list

`PeakCellIndex.bounds` exists, is populated, and is documented as *"peaks outside it are absent
by design, not by loss"* — and is **never consulted by any query method**.

```
dataset bounds   45.6–46.4 N,  7.2–8.2 E
query box        44.2–47.8 N,  5.2–10.4 E   (200 km, the pipeline default)
cells spanned    24        cells held   4
peaks returned   1786      farthest     64.0 km
Mont Blanc: 4808 m, 73 km away, unmissable from the Gornergrat — ABSENT, no note
```

This is the peak-database mirror of Wave 2 finding 2. There, peaks beyond the swept range were
declared **visible** on no evidence; here, peaks beyond the dataset bounds are declared
**absent** on no evidence. The store holds every fact needed to refuse honestly.

## 4. LOW — resolution label read off the column count, not the sample spacing

`datasetLabelForGridSize(tile.geometry.cols)` — but resolution is `lonStepDeg`. A 1201-column
*window* of 1-arc-second data is labelled `srtm3`: a claim of 90 m posting over 30 m data.
`terrain-server.ts` gets this right (derives from the step), so the manifest and the provider
disagree for exactly the grids the browser serves. Latent — no committed window is 1201 wide.

## Mutation testing — 39 mutations, two real gate gaps

29 of 32 meaningful mutations were caught, several hard (little-endian decode → 39 failures;
row index from the south → 23; `1/n` vs `1/(n−1)` spacing → 22; `trunc` for `floor` → 16).

**Gap 1 — the one invariant that would cost every peak is ungated.** A row group with incomplete
bbox statistics is given the **whole world** as its extent, so it is fetched and filtered rather
than skipped unseen. Inverting that to an empty box — every group pruned, an import silently
returning **zero peaks** — **passes all 293 tests.** This is exactly the "a missing mountain is
invisible" case, and one test over a synthetic `FileMetaData` with statistics stripped closes it.

**Gap 2 — the Range header string is never asserted.** `bytes=${from}-${to-1}`: HTTP ranges are
inclusive, Parquet's are half-open, and this is the classic off-by-one. Self-detecting in
production (the next line's length check throws), so the cost is a loud failure — but the check
and the header are three lines apart and only one is gated.

## Clean bills of health — the part that matters most

- **Bilinear against an independently written reader on the real 25 MB `N45E007`** — second
  implementation written from the SRTM spec, not from this code. **400,000 random interior
  points, worst |Δ| = 5.3e-11 m.** Edges, corners, tile corners: Δ = 0. A row-flipped variant of
  the reference diverges by thousands of metres, proving the reference is genuinely independent.
- **Shared tile edge** — `N45E007` row 0 vs `N46E007` row 3600: **0 mismatches in 3601 columns**.
  Bilinear continuous across lat 46.
- **Tile naming** — 200,000 fuzzed coordinates, all 181×361 exact integer degrees, and 24 seam,
  pole and unnormalised cases (`±180`, `±180±1e-7`, `±360`, `540`, `±0`): **0 problems.**
  Wave 1 finding 5 is genuinely closed.
- **Committed windows are byte-exact** — all six re-extracted from source tiles: 0 mismatches,
  sidecar corners exact to Δ = 0.
- **Parquet against the real slice** — per-group rows sum to `num_rows` exactly; 0 groups with
  missing statistics; a box degenerate to a group's exact NE corner *is* selected, one ulp
  outside *is not*.
- **Overture cross-checked against a source predating the importer** — Δelevation **0 m for all
  five** cited peaks; rejection tallies sum exactly (584 + 0 + 20,045 = 20,629); 0 real summits
  rejected as `not-a-point`; the 11 named null-elevation records dropped exactly as MISSION.md
  requires.
- **Peak binning** — 1,600 random centre/radius pairs against a brute-force haversine scan of
  every cell: **0 mismatches.**
- **Caches** — no path found returning data for the wrong key or a stale grid.
- **Tests are not circular** — structural claims from the recorded sidecar, content claims from
  the cited dataset.

## Suspicions (not demonstrated)

Window sidecar steps not checked positive · `resolveTerrainUrl` passes protocol-relative URLs
(`//host`) · `missingTilesFor` asks for SRTM names an `HttpTerrainStore` serving windows can
never satisfy · `recordsWithin` ties are order-unstable where `TiledPeakStore` adds an id
tiebreak.

## Fix order

1. **Finding 3** — give the peak store the refusal the terrain axis has. Cheapest, and it bites
   the moment `TiledPeakStore` reaches the app.
2. **Gap 1** — one test pinning the whole-world fallback. The only invisible Parquet invariant.
3. **Finding 1** — special-case the 360° box.
4. **Finding 2** — make `recordsInBox` and `cellsForBox` mean the same thing.
5. **Finding 4** — label resolution from `lonStepDeg`.
