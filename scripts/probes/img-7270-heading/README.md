# IMG_7270 heading probes

Three scripts that print the numbers in [`docs/IMG-7270-HEADING.md`](../../../docs/IMG-7270-HEADING.md).
The document is meant to be checked rather than trusted, and these are how.

```bash
npx tsx scripts/probes/img-7270-heading/exif-units.ts   # GPSSpeed and its reference, all frames
npx tsx scripts/probes/img-7270-heading/geometry.ts     # bearing, range, altitude, heading, pitch, budget
npx tsx scripts/probes/img-7270-heading/sun.ts          # solar azimuth and elevation, and which side
```

`sun.ts` takes an optional heading in degrees; without one it uses the heading
`geometry.ts` solves.

## Inputs

Two of the three inputs are in the repository:

- `fixtures/photos/real/hdr-gainmap-7270.heic` — position, instant, lens, frame.
- `fixtures/peaks/regions/idaho-bogus-basin/cells/` — Deer Point's summit id,
  coordinate and height.

The third is terrain, and it is not. SRTM tiles are 25 MB each and `.gitignore`
keeps them out, so fetch them once:

```bash
npm run fetch:tiles -- --bbox 43.2,-116.9,44.4,-115.3
```

That writes `data/tiles/N43W116.hgt` and its neighbours. `npm run site:package`
builds a Bogus Basin site package from the same tiles; the probes read the tiles
directly and do not need it. Without a tile the scripts print the fetch command
and exit non-zero.

## House rules these follow

- They write nothing, anywhere, and report to the terminal.
- No coordinate is written in their source. The viewpoint is read out of the
  photograph at run time and the summits out of the peak cells.
- They reuse `src/core` for the geodesy, the projection and the solar position,
  so the arithmetic that produced the document is the arithmetic the app runs.
