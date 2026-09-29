/**
 * The terrain index the BROWSER reads (archive/v2-docs-20260929/TODO.md Q1).
 *
 * Every expectation here is derived by hand from the SRTM format and from the
 * committed sidecar `fixtures/tiles/cases/gornergrat-window.json`, never from
 * this module's own output:
 *
 *   SRTM1 tile   3601 × 3601 samples × 2 bytes            = 25 934 402 bytes
 *                spacing 1/3600°, tile named after its SW corner, so N45E007
 *                has northLat 46, westLon 7 and covers 45…46 N, 7…8 E.
 *   SRTM3 tile   1201 × 1201 × 2                          =  2 884 802 bytes
 *                spacing 1/1200°.
 *   gornergrat   361 × 1009 samples at 1/3600° from northLat 46, westLon 7.62
 *   window       → south 46 − 360/3600 = 45.9, east 7.62 + 1008/3600 = 7.9,
 *                  and 361 × 1009 × 2 = 728 498 bytes, which is exactly the
 *                  size of the committed .i16be file.
 */

import { describe, expect, it } from 'vitest';

import { isProviderError } from './errors';
import {
  expectedGridByteLength,
  gridContains,
  parseTerrainManifest,
  selectTerrainGrid,
  terrainGridBounds,
  terrainGridForTileFile,
  type TerrainGrid,
  type TerrainManifest,
} from './terrain-manifest';

const SRTM1_BYTES = 3601 * 3601 * 2;
const SRTM3_BYTES = 1201 * 1201 * 2;

const WINDOW: TerrainGrid = {
  name: 'gornergrat-window',
  url: 'windows/gornergrat-window.i16be',
  dataset: 'srtm1',
  geometry: {
    northLat: 46,
    westLon: 7.62,
    rows: 361,
    cols: 1009,
    latStepDeg: 1 / 3600,
    lonStepDeg: 1 / 3600,
  },
};

const TILE = terrainGridForTileFile('N45E007', SRTM1_BYTES, 'tiles/N45E007.hgt');

describe('terrainGridForTileFile', () => {
  it('derives an SRTM1 tile grid from its name and byte length', () => {
    expect(TILE.name).toBe('N45E007');
    expect(TILE.dataset).toBe('srtm1');
    expect(TILE.geometry.rows).toBe(3601);
    expect(TILE.geometry.cols).toBe(3601);
    expect(TILE.geometry.northLat).toBe(46);
    expect(TILE.geometry.westLon).toBe(7);
    expect(TILE.geometry.latStepDeg).toBeCloseTo(1 / 3600, 15);
    expect(TILE.geometry.lonStepDeg).toBeCloseTo(1 / 3600, 15);
  });

  it('names the south-west corner with floor semantics in both hemispheres', () => {
    const southern = terrainGridForTileFile('S34W071', SRTM3_BYTES, 'tiles/S34W071.hgt');
    expect(southern.dataset).toBe('srtm3');
    expect(southern.geometry.rows).toBe(1201);
    // S34 covers −34…−33, so row 0 (the NORTH edge) is at −33.
    expect(southern.geometry.northLat).toBe(-33);
    expect(southern.geometry.westLon).toBe(-71);
    expect(southern.geometry.latStepDeg).toBeCloseTo(1 / 1200, 15);
  });

  it('refuses a byte length that is not a square grid', () => {
    try {
      terrainGridForTileFile('N45E007', SRTM1_BYTES - 2, 'tiles/N45E007.hgt');
      expect.unreachable('a truncated tile must not produce a grid');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
    }
  });
});

describe('expectedGridByteLength', () => {
  it('matches the committed window file size', () => {
    expect(expectedGridByteLength(WINDOW.geometry)).toBe(728_498);
  });

  it('matches a whole SRTM1 tile', () => {
    expect(expectedGridByteLength(TILE.geometry)).toBe(SRTM1_BYTES);
  });
});

describe('terrainGridBounds', () => {
  it('closes the window on its last sample line, not one step beyond', () => {
    const bounds = terrainGridBounds(WINDOW.geometry);
    expect(bounds.north).toBeCloseTo(46, 12);
    expect(bounds.south).toBeCloseTo(45.9, 12);
    expect(bounds.west).toBeCloseTo(7.62, 12);
    expect(bounds.east).toBeCloseTo(7.9, 12);
  });

  it('gives a whole tile its full degree', () => {
    const bounds = terrainGridBounds(TILE.geometry);
    expect(bounds.south).toBeCloseTo(45, 12);
    expect(bounds.east).toBeCloseTo(8, 12);
  });
});

describe('gridContains', () => {
  it('accepts the Gornergrat platform and both window edges', () => {
    expect(gridContains(WINDOW.geometry, 45.983333, 7.782222)).toBe(true);
    expect(gridContains(WINDOW.geometry, 46, 7.62)).toBe(true);
    expect(gridContains(WINDOW.geometry, 45.9, 7.9)).toBe(true);
  });

  it('rejects a point past the window, even by one sample', () => {
    // One sample line north of the cut is outside it — that is the N45E007
    // tile edge the case file warns about.
    expect(gridContains(WINDOW.geometry, 46 + 1 / 3600, 7.782222)).toBe(false);
    expect(gridContains(WINDOW.geometry, 45.983333, 7.9 + 1 / 3600)).toBe(false);
    // Chamonix: inside the same latitude band, a whole degree west.
    expect(gridContains(WINDOW.geometry, 45.9237, 6.8694)).toBe(false);
  });

  it('compares longitude modulo 360 so both antimeridian conventions land', () => {
    const w180 = terrainGridForTileFile('S01W180', SRTM1_BYTES, 'tiles/S01W180.hgt');
    expect(gridContains(w180.geometry, -0.5, -180)).toBe(true);
    expect(gridContains(w180.geometry, -0.5, 180)).toBe(true);
  });
});

describe('selectTerrainGrid', () => {
  const manifest: TerrainManifest = { version: 1, grids: [WINDOW, TILE] };

  it('prefers the grid with the most coverage where both hold the point', () => {
    // The window is listed first on purpose: selection must go by coverage,
    // not by manifest order. A 1°×1° tile can prove an occlusion that a
    // 0.1°×0.28° window physically cannot see.
    const grid = selectTerrainGrid(manifest, 45.983333, 7.782222);
    expect(grid?.name).toBe('N45E007');
  });

  it('falls back to the window where the whole tile is absent', () => {
    const windowsOnly: TerrainManifest = { version: 1, grids: [WINDOW] };
    expect(selectTerrainGrid(windowsOnly, 45.983333, 7.782222)?.name).toBe('gornergrat-window');
  });

  it('returns nothing at all rather than the nearest grid', () => {
    // Chamonix needs N45E006. Handing back N45E007 would put the horizon of
    // one valley on a photograph taken in another.
    expect(selectTerrainGrid(manifest, 45.9237, 6.8694)).toBeUndefined();
  });
});

describe('parseTerrainManifest', () => {
  it('accepts a well-formed index', () => {
    const parsed = parseTerrainManifest(
      { version: 1, grids: [{ ...WINDOW }] },
      '/terrain/manifest.json',
    );
    expect(parsed.grids).toHaveLength(1);
    expect(parsed.grids[0]?.geometry.rows).toBe(361);
  });

  it('refuses an index whose version it does not understand', () => {
    expect(() => parseTerrainManifest({ version: 2, grids: [] }, 'x')).toThrow(/version/i);
  });

  it('refuses a grid with no geometry rather than guessing one', () => {
    expect(() =>
      parseTerrainManifest({ version: 1, grids: [{ name: 'x', url: 'x', dataset: 'srtm1' }] }, 'x'),
    ).toThrow(/geometry/i);
  });

  it('refuses a grid whose geometry is degenerate', () => {
    expect(() =>
      parseTerrainManifest(
        {
          version: 1,
          grids: [
            { ...WINDOW, geometry: { ...WINDOW.geometry, rows: 1 } },
          ],
        },
        'x',
      ),
    ).toThrow(/rows/i);
  });

  it('refuses anything that is not an object', () => {
    expect(() => parseTerrainManifest('nope', 'x')).toThrow();
    expect(() => parseTerrainManifest(null, 'x')).toThrow();
  });
});
