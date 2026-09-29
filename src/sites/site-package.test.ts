/**
 * The site package: the cut, the tile set, and the seams.
 *
 * Every expectation here is derived from arithmetic written out beside it, or
 * from a position function the test itself defines. Nothing is a recorded output
 * of `planSiteMosaic` (AGENTS.md, "Independent expectations"), because the whole
 * risk in this file is an off-by-one that produces a plausible mosaic of the
 * wrong ground.
 *
 * The seam tests run on tiles of 13 × 13 samples — 12 postings per degree — so
 * every index can be checked by hand. The production posting (3600) is exercised
 * against the real committed definition, and end to end by
 * `npm run site:package`.
 */

import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { destinationPoint } from '../core/geodesy.js';
import { BYTES_PER_SAMPLE } from '../providers/hgt-tile.js';
import { gridContains } from '../providers/terrain-manifest.js';
import {
  SRTM1_SAMPLES_PER_DEG,
  parseSiteDefinition,
  planSiteMosaic,
  type SiteDefinition,
} from './site-package.js';

/* ══════════════════════════════════════════════════════════════════════════
 * Bogus Basin — the committed definition, and the cut it implies
 * ══════════════════════════════════════════════════════════════════════════
 *
 * THE ARITHMETIC, done here and not in the code under test.
 *
 * The observer is 43.77148 N, 116.08862 W. The cut radius is the 60 km sweep
 * plus the definition's 0.5 km margin, so R = 60.5 km. On the sphere the
 * pipeline uses (R⊕ = 6371.0088 km) one degree of meridian is
 *
 *     6371.0088 × π / 180 = 111.195080 km,
 *
 * so the cut reaches ±60.5 / 111.195080 = ±0.5440888° of latitude:
 *
 *     43.2273912 N … 44.3155688 N      → latitude bands N43 and N44.
 *
 * The extreme longitude of a circle on a sphere is where the circle runs due
 * north, which puts a right angle there in the triangle pole–centre–point:
 *
 *     sin Δλ = sin δ / cos φ,   δ = 60.5 / 6371.0088 = 0.00949614 rad
 *     sin δ = 0.009495999,  cos 43.77148° = 0.7221047
 *     Δλ = asin(0.013150446) = 0.7534868°
 *
 *     116.8421068 W … 115.3351332 W    → longitude bands W117 and W116.
 *
 * Four tiles, therefore: N43W116, N43W117, N44W116, N44W117.
 *
 * Snapped outward onto whole arc-second lines (3600 per degree):
 *
 *     north = ceil( 44.3155688 × 3600) = ceil(159536.048)  =  159537
 *     south = floor(43.2273912 × 3600) = floor(155618.608) =  155618
 *     west  = floor(-116.8421068 × 3600) = floor(-420631.58) = -420632
 *     east  = ceil( -115.3351332 × 3600) = ceil(-415206.48)  = -415206
 *
 *     rows = 159537 − 155618 + 1 = 3920
 *     cols = −415206 + 420632 + 1 = 5427
 *     bytes = 3920 × 5427 × 2 = 42 547 680
 */

const BOGUS_BASIN_PATH = 'sites/bogus-basin.json';

async function bogusBasin(): Promise<SiteDefinition> {
  return parseSiteDefinition(
    JSON.parse(await readFile(BOGUS_BASIN_PATH, 'utf8')) as unknown,
    BOGUS_BASIN_PATH,
  );
}

/** Degrees of latitude per kilometre on the sphere `destinationPoint` uses. */
const DEG_PER_KM_LAT = 1 / 111.195080;

describe('the committed Bogus Basin site definition', () => {
  it('states the viewpoint and radius the strategy review chose', async () => {
    const site = await bogusBasin();
    expect(site.id).toBe('bogus-basin');
    expect(site.observer.lat).toBeCloseTo(43.77148, 5);
    expect(site.observer.lon).toBeCloseTo(-116.08862, 5);
    expect(site.sweepRadiusKm).toBe(60);
    expect(site.peakRegion).toBe('idaho-bogus-basin');
  });

  it('draws on exactly the four tiles the hand arithmetic names', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    expect([...plan.tileNames]).toEqual(['N43W116', 'N43W117', 'N44W116', 'N44W117']);
  });

  it('cuts the box the hand arithmetic gives, snapped outward by under a posting', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    expect(plan.cutRadiusKm).toBe(60.5);

    // The unsnapped box, from the arithmetic above.
    const north = 44.3155688;
    const south = 43.2273912;
    const west = -116.8421068;
    const east = -115.3351332;

    expect(plan.cut).toEqual({
      northAs: 159537,
      southAs: 155618,
      westAs: -420632,
      eastAs: -415206,
    });

    // Snapping only ever moves an edge OUTWARD, and never by a whole posting.
    const step = 1 / SRTM1_SAMPLES_PER_DEG;
    const bounds = {
      north: plan.cut.northAs * step,
      south: plan.cut.southAs * step,
      west: plan.cut.westAs * step,
      east: plan.cut.eastAs * step,
    };
    expect(bounds.north).toBeGreaterThanOrEqual(north);
    expect(bounds.north - north).toBeLessThan(step);
    expect(bounds.south).toBeLessThanOrEqual(south);
    expect(south - bounds.south).toBeLessThan(step);
    expect(bounds.west).toBeLessThanOrEqual(west);
    expect(west - bounds.west).toBeLessThan(step);
    expect(bounds.east).toBeGreaterThanOrEqual(east);
    expect(bounds.east - east).toBeLessThan(step);
  });

  it('is 3920 x 5427 samples, 42 547 680 bytes', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    expect(plan.geometry.rows).toBe(3920);
    expect(plan.geometry.cols).toBe(5427);
    expect(plan.byteLength).toBe(3920 * 5427 * BYTES_PER_SAMPLE);
    expect(plan.byteLength).toBe(42_547_680);
  });

  it('publishes one grid, at the source posting, that the index accepts', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    const manifest = plan.manifest('windows/bogus-basin-60km.i16be');
    expect(manifest.grids).toHaveLength(1);
    const grid = manifest.grids[0];
    expect(grid).toBeDefined();
    if (grid === undefined) return;
    expect(grid.name).toBe('bogus-basin-60km');
    expect(grid.dataset).toBe('srtm1');
    expect(grid.geometry.latStepDeg).toBeCloseTo(1 / 3600, 12);
    expect(grid.geometry.lonStepDeg).toBeCloseTo(1 / 3600, 12);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The sweep fits inside the package
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the declared 360 degree sweep fits inside the cut', () => {
  it('covers every one of 72 ray ends at the declared 60 km', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    const ring = plan.ringCoverage(60, 72);
    expect(ring).toHaveLength(72);
    const missed = ring.filter((entry) => !entry.covered);
    expect(
      missed.map((entry) => entry.bearingDeg),
      'bearings whose 60 km ray end falls outside the cut',
    ).toEqual([]);
  });

  it('covers the cut radius itself at every one of 360 bearings', async () => {
    const plan = planSiteMosaic(await bogusBasin());
    const missed = plan.ringCoverage(60.5, 360).filter((entry) => !entry.covered);
    expect(missed.map((entry) => entry.bearingDeg)).toEqual([]);
  });

  it('does not cover a ring beyond the cut', async () => {
    const site = await bogusBasin();
    const plan = planSiteMosaic(site);

    // 60.6 km is 100 m past the 60.5 km cut, and outward snapping adds at most
    // one arc-second (1/3600 deg = 30.9 m of latitude). So a ray end due north
    // or due south at 60.6 km is outside the cut by 40 m or more:
    //   0.6 km + 0.1 km = 0.6 km past the sweep, 0.1 km past the cut
    //   0.1 km x (1 deg / 111.195080 km) = 0.000899 deg = 3.24 arc-seconds
    const beyondKm = 60.6;
    expect(beyondKm * DEG_PER_KM_LAT - plan.cutRadiusKm * DEG_PER_KM_LAT).toBeGreaterThan(
      2 / SRTM1_SAMPLES_PER_DEG,
    );

    for (const bearingDeg of [0, 180]) {
      const point = destinationPoint(site.observer, bearingDeg, beyondKm * 1000);
      expect(
        gridContains(plan.geometry, point.lat, point.lon),
        `${beyondKm} km on bearing ${bearingDeg} should be outside the cut`,
      ).toBe(false);
    }
    expect(plan.ringCoverage(beyondKm, 72).every((entry) => entry.covered)).toBe(false);
  });

  it('fails that coverage check when the cut is shrunk off one of its tiles', async () => {
    // The mutation this suite is checked with: a site whose sweep radius is 20 km
    // touches two tiles instead of four, so the 60 km ring must then come back
    // uncovered. If this passed, the coverage test above would be proving
    // nothing.
    const site = await bogusBasin();
    const shrunk: SiteDefinition = { ...site, sweepRadiusKm: 20 };
    const plan = planSiteMosaic(shrunk);

    expect([...plan.tileNames]).toEqual(['N43W116', 'N43W117']);
    expect(plan.tileNames.length).toBeLessThan(planSiteMosaic(site).tileNames.length);

    const missed = plan.ringCoverage(60, 72).filter((entry) => !entry.covered);
    expect(missed.length).toBeGreaterThan(0);
    // Its own 20 km sweep still fits, so the failure is the radius and not a bug.
    expect(plan.ringCoverage(20, 72).every((entry) => entry.covered)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Seams — synthetic tiles at 12 postings per degree
 * ══════════════════════════════════════════════════════════════════════════
 *
 * A synthetic tile's samples are a function of ABSOLUTE position, so neighbouring
 * tiles agree exactly on the edge line they share. A mosaic that reads one column
 * or row out of place therefore produces a value that is wrong rather than merely
 * differently indexed, and the seam can be checked against BOTH tiles.
 *
 * Real tiles are within 1 m of each other on a shared line rather than identical
 * (4 of 14 404 boundary samples around Bogus Basin differ). So the real-data check
 * lives in `scripts/make-site-package.ts`, where the mosaic is compared byte for
 * byte against the tile it was cut from and the neighbour's disagreements are
 * counted. Asserting exact agreement between neighbours here is a statement about
 * these synthetic tiles, not about SRTM.
 */

const TEST_SAMPLES_PER_DEG = 12;
const TEST_TILE_SIZE = TEST_SAMPLES_PER_DEG + 1;

/** Elevation at a posting, from its position alone. Never the void marker. */
function syntheticElevation(latAs: number, lonAs: number): number {
  return (((latAs * 31 + lonAs * 7) % 1999) + 1999) % 1999 - 999;
}

function syntheticTile(southLat: number, westLon: number): Uint8Array {
  const bytes = new Uint8Array(TEST_TILE_SIZE * TEST_TILE_SIZE * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  for (let row = 0; row < TEST_TILE_SIZE; row += 1) {
    const latAs = (southLat + 1) * TEST_SAMPLES_PER_DEG - row;
    for (let col = 0; col < TEST_TILE_SIZE; col += 1) {
      const lonAs = westLon * TEST_SAMPLES_PER_DEG + col;
      view.setInt16((row * TEST_TILE_SIZE + col) * BYTES_PER_SAMPLE, syntheticElevation(latAs, lonAs));
    }
  }
  return bytes;
}

function sampleAt(bytes: Uint8Array, cols: number, row: number, col: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(
    (row * cols + col) * BYTES_PER_SAMPLE,
  );
}

/**
 * A synthetic site centred on the corner where four tiles meet, so the cut
 * crosses one latitude boundary and one longitude boundary.
 */
const SEAM_SITE: SiteDefinition = {
  id: 'seam-site',
  name: 'Four-tile corner',
  observer: { lat: 44, lon: -116 },
  sweepRadiusKm: 30,
  terrainMarginKm: 0,
  peakRegion: 'idaho-central',
};

function seamPlan(): ReturnType<typeof planSiteMosaic> {
  return planSiteMosaic(SEAM_SITE, { samplesPerDeg: TEST_SAMPLES_PER_DEG });
}

function seamTiles(): Map<string, Uint8Array> {
  return new Map([
    ['N43W117', syntheticTile(43, -117)],
    ['N43W116', syntheticTile(43, -116)],
    ['N44W117', syntheticTile(44, -117)],
    ['N44W116', syntheticTile(44, -116)],
  ]);
}

describe('mosaicking across tile boundaries', () => {
  it('draws on the four tiles around the corner', () => {
    expect([...seamPlan().tileNames]).toEqual(['N43W116', 'N43W117', 'N44W116', 'N44W117']);
  });

  it('crosses one boundary in each axis', () => {
    const { cut } = seamPlan();
    // 44 N is 44 x 12 = 528 postings; 116 W is -116 x 12 = -1392.
    expect(cut.northAs).toBeGreaterThan(528);
    expect(cut.southAs).toBeLessThan(528);
    expect(cut.eastAs).toBeGreaterThan(-1392);
    expect(cut.westAs).toBeLessThan(-1392);
  });

  it('places every sample at the position it belongs to', () => {
    const plan = seamPlan();
    const mosaic = plan.assemble(seamTiles());
    expect(mosaic.length).toBe(plan.byteLength);

    const { rows, cols } = plan.geometry;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const expected = syntheticElevation(plan.cut.northAs - row, plan.cut.westAs + col);
        expect(
          sampleAt(mosaic, cols, row, col),
          `mosaic (${row}, ${col}) should be the posting at ` +
            `${(plan.cut.northAs - row) / TEST_SAMPLES_PER_DEG} N, ` +
            `${(plan.cut.westAs + col) / TEST_SAMPLES_PER_DEG} E`,
        ).toBe(expected);
      }
    }
  });

  it('matches both tiles that share the latitude seam, sample for sample', () => {
    const plan = seamPlan();
    const tiles = seamTiles();
    const mosaic = plan.assemble(tiles);
    const { cols } = plan.geometry;

    // 44 N is row 0 of the N43 tiles and row 12 of the N44 tiles.
    const seamLatAs = 44 * TEST_SAMPLES_PER_DEG;
    const seamRow = plan.cut.northAs - seamLatAs;
    expect(seamRow).toBeGreaterThan(0);

    for (let col = 0; col < cols; col += 1) {
      const lonAs = plan.cut.westAs + col;
      const lonBand = Math.floor(lonAs / TEST_SAMPLES_PER_DEG);
      const colInEast = lonAs - lonBand * TEST_SAMPLES_PER_DEG;

      const north = tiles.get(lonBand === -117 ? 'N44W117' : 'N44W116');
      const south = tiles.get(lonBand === -117 ? 'N43W117' : 'N43W116');
      expect(north).toBeDefined();
      expect(south).toBeDefined();
      if (north === undefined || south === undefined) return;

      const value = sampleAt(mosaic, cols, seamRow, col);
      expect(value, `seam row against the northern tile at column ${col}`).toBe(
        sampleAt(north, TEST_TILE_SIZE, TEST_SAMPLES_PER_DEG, colInEast),
      );
      expect(value, `seam row against the southern tile at column ${col}`).toBe(
        sampleAt(south, TEST_TILE_SIZE, 0, colInEast),
      );
    }
  });

  it('matches both tiles that share the longitude seam, sample for sample', () => {
    const plan = seamPlan();
    const tiles = seamTiles();
    const mosaic = plan.assemble(tiles);
    const { rows, cols } = plan.geometry;

    // 116 W is column 12 of the W117 tiles and column 0 of the W116 tiles.
    const seamLonAs = -116 * TEST_SAMPLES_PER_DEG;
    const seamCol = seamLonAs - plan.cut.westAs;
    expect(seamCol).toBeGreaterThan(0);

    for (let row = 0; row < rows; row += 1) {
      const latAs = plan.cut.northAs - row;
      const latBand = Math.floor(latAs / TEST_SAMPLES_PER_DEG);
      const rowInTile = (latBand + 1) * TEST_SAMPLES_PER_DEG - latAs;

      const west = tiles.get(latBand === 44 ? 'N44W117' : 'N43W117');
      const east = tiles.get(latBand === 44 ? 'N44W116' : 'N43W116');
      expect(west).toBeDefined();
      expect(east).toBeDefined();
      if (west === undefined || east === undefined) return;

      const value = sampleAt(mosaic, cols, row, seamCol);
      expect(value, `seam column against the western tile at row ${row}`).toBe(
        sampleAt(west, TEST_TILE_SIZE, rowInTile, TEST_SAMPLES_PER_DEG),
      );
      expect(value, `seam column against the eastern tile at row ${row}`).toBe(
        sampleAt(east, TEST_TILE_SIZE, rowInTile, 0),
      );
    }
  });

  it('reports the source of a sample on each side of a seam', () => {
    const plan = seamPlan();
    const seamRow = plan.cut.northAs - 44 * TEST_SAMPLES_PER_DEG;
    const seamCol = -116 * TEST_SAMPLES_PER_DEG - plan.cut.westAs;

    // On the seam: the northern tile's last row, the eastern tile's first column.
    expect(plan.sampleSource(seamRow, seamCol)).toEqual({
      tileName: 'N44W116',
      rowInTile: TEST_SAMPLES_PER_DEG,
      colInTile: 0,
    });
    // One sample south and west of it: inside the south-west tile.
    expect(plan.sampleSource(seamRow + 1, seamCol - 1)).toEqual({
      tileName: 'N43W117',
      rowInTile: 1,
      colInTile: TEST_SAMPLES_PER_DEG - 1,
    });
  });

  it('refuses to assemble a mosaic with a tile missing, and names it', () => {
    const plan = seamPlan();
    const tiles = seamTiles();
    tiles.delete('N43W117');
    expect(() => plan.assemble(tiles)).toThrow(/N43W117/);
  });

  it('refuses a tile of the wrong size rather than resampling it', () => {
    const plan = seamPlan();
    const tiles = seamTiles();
    tiles.set('N43W117', new Uint8Array(8));
    expect(() => plan.assemble(tiles)).toThrow(/N43W117 is 8 bytes/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A definition is data, so it is checked
 * ══════════════════════════════════════════════════════════════════════════ */

describe('parseSiteDefinition', () => {
  const valid = {
    id: 'somewhere',
    name: 'Somewhere',
    observer: { lat: 44, lon: -116 },
    sweepRadiusKm: 30,
    terrainMarginKm: 0.5,
    peakRegion: 'idaho-central',
  };

  it('accepts a complete definition and keeps the optional fields it finds', () => {
    const site = parseSiteDefinition({ ...valid, note: 'why', photo: 'a.heic' }, 'test');
    expect(site.note).toBe('why');
    expect(site.photo).toBe('a.heic');
  });

  it('leaves optional fields off when they are absent', () => {
    const site = parseSiteDefinition(valid, 'test');
    expect(site.note).toBeUndefined();
    expect(site.photo).toBeUndefined();
  });

  it('refuses a latitude outside the globe', () => {
    expect(() => parseSiteDefinition({ ...valid, observer: { lat: 95, lon: 0 } }, 'test')).toThrow(
      /outside \[-90, 90\]/,
    );
  });

  it('refuses a radius of zero, which would cut no terrain', () => {
    expect(() => parseSiteDefinition({ ...valid, sweepRadiusKm: 0 }, 'test')).toThrow(
      /must be positive/,
    );
  });

  it('refuses an id that would not be a directory name', () => {
    expect(() => parseSiteDefinition({ ...valid, id: '../etc' }, 'test')).toThrow(/"id" must be/);
  });
});
