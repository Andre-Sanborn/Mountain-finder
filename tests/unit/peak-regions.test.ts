/**
 * The committed peak regions, checked as data rather than as code.
 *
 * Two different jobs, and they are here rather than beside a module because
 * what they assert about is the bytes under `fixtures/peaks/regions/`:
 *
 *   • `idaho-bogus-basin` must contain the whole disc the Bogus Basin site
 *     declares. `TiledPeakStore.coverageFor` reports a shortfall at runtime, but
 *     a shortfall found at runtime is a package that was already built wrong.
 *   • `idaho-central` must not change at all. The Idaho acceptance cases assert
 *     its summit ids, coordinates and heights, so a re-import over it would move
 *     ground truth. It was cut from Overture release `2026-06-17.0`, which has
 *     since been deleted from the bucket, so those bytes cannot be regenerated
 *     and a hash is the only thing that keeps them.
 *
 * Offline: every byte read here is committed in this repository.
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { haversineDistanceM } from '../../src/core/geodesy.js';
import { loadPeakCellIndex } from '../../src/providers/peak-directory.js';
import type { PeakRecord } from '../../src/providers/peak-store.js';

const REGION_DIR = 'fixtures/peaks/regions';

/**
 * The Bogus Basin disc, derived by hand — NOT by calling `boundingBoxAround`,
 * which is the code a coverage bug would live in.
 *
 * Centre φ = 43.77148 N, λ = −116.08862, cut radius r = 60.5 km, datum sphere
 * R = 6 371 008.8 m (`EARTH_RADIUS_M`). The cut radius is the sweep's 60 km plus
 * the site's 0.5 km of margin.
 *
 *   δ = r / R = 60 500 / 6 371 008.8 = 9.496603×10⁻³ rad = 0.54408882°
 *     south = 43.77148 − 0.54408882 = 43.22739118
 *     north = 43.77148 + 0.54408882 = 44.31556882
 *
 *   The extreme longitudes are where the circle is tangent to a meridian, so
 *   sin Δλ = sin δ / cos φ:
 *     sin δ  = 9.4964604×10⁻³,  cos φ = 0.72228144
 *     sin Δλ = 1.3147986×10⁻²  →  Δλ = 0.75348679°
 *     west = −116.08862 − 0.75348679 = −116.84210679
 *     east = −116.08862 + 0.75348679 = −115.33513321
 */
const BOGUS_BASIN_DISC = {
  south: 43.22739118,
  north: 44.31556882,
  west: -116.84210679,
  east: -115.33513321,
} as const;

/**
 * `idaho-central`, cell by cell, hashed as `<file>\0<bytes>` in path order so a
 * renamed cell fails as loudly as an edited one.
 *
 * Recomputing this constant is not how a failure here gets fixed. It is a lock
 * on a dataset whose upstream release no longer exists.
 */
const IDAHO_CENTRAL_SHA256 =
  'ee9a851fb33bee741aed34d20170ed1ed0319cbc2604f02022b6a01e4408760b';
const IDAHO_CENTRAL_FILES = 13;

async function hashRegion(region: string): Promise<{ sha256: string; files: number }> {
  const root = join(REGION_DIR, region);
  const cells = (await readdir(join(root, 'cells')))
    .filter((name) => name.endsWith('.json'))
    .sort();
  const paths = ['index.json', ...cells.map((name) => `cells/${name}`)];
  const hash = createHash('sha256');
  for (const path of paths) {
    hash.update(path);
    hash.update(Uint8Array.of(0));
    hash.update(await readFile(join(root, path)));
  }
  return { sha256: hash.digest('hex'), files: paths.length };
}

describe('idaho-bogus-basin covers the Bogus Basin disc', () => {
  it('states bounds that contain the 60.5 km disc', async () => {
    const store = await loadPeakCellIndex(join(REGION_DIR, 'idaho-bogus-basin', 'index.json'));
    const bounds = store.index.bounds;
    expect(bounds.south).toBeLessThanOrEqual(BOGUS_BASIN_DISC.south);
    expect(bounds.north).toBeGreaterThanOrEqual(BOGUS_BASIN_DISC.north);
    expect(bounds.west).toBeLessThanOrEqual(BOGUS_BASIN_DISC.west);
    expect(bounds.east).toBeGreaterThanOrEqual(BOGUS_BASIN_DISC.east);
  });

  it('names the release it was cut from', async () => {
    const store = await loadPeakCellIndex(join(REGION_DIR, 'idaho-bogus-basin', 'index.json'));
    expect(store.index.release).toBe('2026-09-23.1');
    expect(store.index.sources.map((source) => source.id)).toContain(
      'overture-2026-09-23.1-base-land',
    );
  });

  it('answers a 60 km query from the viewpoint completely', async () => {
    const store = await loadPeakCellIndex(join(REGION_DIR, 'idaho-bogus-basin', 'index.json'));
    const coverage = store.coverageFor({
      center: { lat: 43.77148, lon: -116.08862 },
      radiusKm: 60,
    });
    expect(coverage.complete).toBe(true);
    expect(coverage.cellsHeld).toBe(coverage.cellsSpanned);
  });
});

describe('idaho-central is frozen', () => {
  it('hashes to the bytes the Idaho acceptance cases were written against', async () => {
    const { sha256, files } = await hashRegion('idaho-central');
    expect(files).toBe(IDAHO_CENTRAL_FILES);
    expect(sha256).toBe(IDAHO_CENTRAL_SHA256);
  });

  it('still names the deleted release it was cut from', async () => {
    const store = await loadPeakCellIndex(join(REGION_DIR, 'idaho-central', 'index.json'));
    expect(store.index.release).toBe('2026-06-17.0');
    expect(store.index.peakCount).toBe(709);
  });
});

/**
 * How far two Overture releases may disagree about the same summit.
 *
 * Both regions carry OpenStreetMap through Overture unchanged, so a shared GERS
 * id is the same OSM node read three months apart. Name and height come from
 * tags and must match exactly — a changed `ele` is an upstream edit worth
 * knowing about, not noise. Position is a mapper's node placement and does move:
 * 250 m is the bound this pins, against a measured worst case of 198.3 m
 * (Lightning Creek Rocks). Anything further would be a different summit.
 */
const POSITION_DRIFT_TOLERANCE_M = 250;

describe('idaho-bogus-basin agrees with idaho-central where they overlap', () => {
  it('keeps every shared summit at the same name, height and roughly the same place', async () => {
    const central = await loadPeakCellIndex(join(REGION_DIR, 'idaho-central', 'index.json'));
    const bogus = await loadPeakCellIndex(join(REGION_DIR, 'idaho-bogus-basin', 'index.json'));

    // The intersection of the two stated bounds, by hand:
    // latitude  max(43.4, 43.2) … min(45.2, 44.4)
    // longitude max(−116.6, −116.9) … min(−113.8, −115.3)
    const overlap = { south: 43.4, north: 44.4, west: -116.6, east: -115.3 };
    const before = await central.recordsInBox(overlap);
    const after = new Map<string, PeakRecord>(
      (await bogus.recordsInBox(overlap)).map((record) => [record.id, record]),
    );

    let shared = 0;
    for (const record of before) {
      const now = after.get(record.id);
      if (now === undefined) continue;
      shared += 1;
      expect(now.name).toBe(record.name);
      expect(now.elevationM).toBe(record.elevationM);
      expect(haversineDistanceM(record, now)).toBeLessThan(POSITION_DRIFT_TOLERANCE_M);
    }
    // 120 of the 122 summits in the overlap carry the same id in both releases.
    // The two that do not are reported in fixtures/peaks/regions/README.md; this
    // guards against the comparison quietly matching nothing at all.
    expect(shared).toBe(120);
  });
});
