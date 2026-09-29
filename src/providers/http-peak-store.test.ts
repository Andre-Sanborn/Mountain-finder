/**
 * The browser's peak loader (archive/v2-docs-20260929/TODO.md Q8): region indexes compiled into the
 * bundle, summit cells fetched from the app's own origin on demand.
 *
 * Distances here reuse the figure derived in peak-tile-store.test.ts:
 * one degree of latitude = R·π/180 = 111.19508 km. Every query radius is
 * chosen against that number, not against the code's answer.
 */

import { describe, expect, it } from 'vitest';

import { ProviderError } from './errors.js';
import {
  createRegionPeakSource,
  httpPeakCellLoader,
  type PeakFetch,
} from './http-peak-store.js';
import type { PeakCellEntry } from './peak-tile-store.js';

const SOURCES = [
  {
    id: 'test-source',
    title: 'Test citation',
    url: 'https://example.invalid/',
    retrieved: '2026-08-16',
    access: 'derived' as const,
  },
];

function record(id: string, lat: number, lon: number, elevationM: number): unknown {
  return {
    id,
    name: id,
    lat,
    lon,
    elevationM,
    positionSourceId: 'test-source',
    elevationSourceId: 'test-source',
    elevationSourceKind: 'osm',
    usedBy: [],
  };
}

function indexJson(cells: readonly { name: string; peaks: number }[]): unknown {
  return {
    version: 1,
    description: 'test index',
    release: 'test',
    generatedBy: 'hand',
    bounds: { south: 45, west: 7, north: 47, east: 9 },
    sources: SOURCES,
    cells: cells.map((cell) => ({ ...cell, file: `cells/${cell.name}.json` })),
    peakCount: cells.reduce((total, cell) => total + cell.peaks, 0),
  };
}

/** A fetch over a plain URL→JSON map; anything absent is a 404. */
function fetchOver(files: Record<string, unknown>, log?: string[]): PeakFetch {
  return (url: string) => {
    log?.push(url);
    const body = files[url];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
  };
}

const entry: PeakCellEntry = { name: 'N45E007', peaks: 1, file: 'cells/N45E007.json' };

describe('httpPeakCellLoader', () => {
  it('fetches the cell relative to the base URL and returns its JSON', async () => {
    const body = { cell: 'N45E007', peaks: [record('a', 45.5, 7.5, 1000)] };
    const loader = httpPeakCellLoader('/peaks/zermatt', fetchOver({ '/peaks/zermatt/cells/N45E007.json': body }));
    await expect(loader(entry)).resolves.toBe(body);
  });

  it('maps 404 to null — "not held", which the store then reports honestly', async () => {
    const loader = httpPeakCellLoader('/peaks/zermatt', fetchOver({}));
    await expect(loader(entry)).resolves.toBeNull();
  });

  it('refuses any other failure with a typed error, never an empty dataset', async () => {
    const fetch500: PeakFetch = () =>
      Promise.resolve({ ok: false, status: 500, json: () => Promise.reject(new Error('500')) });
    const loader = httpPeakCellLoader('/peaks/zermatt', fetch500);
    await expect(loader(entry)).rejects.toBeInstanceOf(ProviderError);
  });

  it('refuses a cell path that could escape its region', async () => {
    const loader = httpPeakCellLoader('/peaks/zermatt', fetchOver({}));
    for (const file of ['/etc/passwd', '../california/cells/N37W120.json', 'cells//x.json', 'a\\b.json']) {
      await expect(loader({ ...entry, file })).rejects.toBeInstanceOf(ProviderError);
    }
  });
});

describe('createRegionPeakSource', () => {
  const zermattIndex = indexJson([{ name: 'N45E007', peaks: 2 }]);
  const zermattCell = {
    cell: 'N45E007',
    peaks: [record('overture/a', 45.95, 7.65, 4478), record('overture/b', 45.9, 7.7, 4100)],
  };

  it('answers a query from the right region cells, and prunes the others', async () => {
    const log: string[] = [];
    const files = {
      '/peaks/zermatt/cells/N45E007.json': zermattCell,
      '/peaks/california/cells/N37W120.json': {
        cell: 'N37W120',
        peaks: [record('overture/far', 37.5, -119.5, 3000)],
      },
    };
    const source = createRegionPeakSource(
      {
        zermatt: zermattIndex,
        california: indexJson([{ name: 'N37W120', peaks: 1 }]),
      },
      '/peaks',
      fetchOver(files, log),
    );

    expect(source.regionNames).toEqual(['california', 'zermatt']);
    expect(source.peakCount).toBe(3);

    // 20 km around Zermatt touches only N45E007-ish cells; California's index
    // holds none of them, so its cell file must never be requested.
    const peaks = await source.peaksWithin({ lat: 45.95, lon: 7.65 }, 20);
    expect(peaks.map((peak) => peak.id).sort()).toEqual(['overture/a', 'overture/b']);
    expect(log).toContain('/peaks/zermatt/cells/N45E007.json');
    expect(log).not.toContain('/peaks/california/cells/N37W120.json');
  });

  it('de-duplicates a summit two regions both hold, by id', async () => {
    // The same physical summit (same GERS id) imported by two overlapping
    // regions must appear once — the pipeline would otherwise label it twice.
    const files = {
      '/peaks/east/cells/N45E007.json': {
        cell: 'N45E007',
        peaks: [record('overture/shared', 45.5, 7.5, 2000)],
      },
      '/peaks/west/cells/N45E007.json': {
        cell: 'N45E007',
        peaks: [record('overture/shared', 45.5, 7.5, 2000)],
      },
    };
    const source = createRegionPeakSource(
      {
        east: indexJson([{ name: 'N45E007', peaks: 1 }]),
        west: indexJson([{ name: 'N45E007', peaks: 1 }]),
      },
      '/peaks',
      fetchOver(files),
    );
    const peaks = await source.peaksWithin({ lat: 45.5, lon: 7.5 }, 10);
    expect(peaks.map((peak) => peak.id)).toEqual(['overture/shared']);
  });

  it('rejects a malformed region index at construction, not at query time', () => {
    expect(() =>
      createRegionPeakSource({ broken: { version: 2 } }, '/peaks', fetchOver({})),
    ).toThrow(ProviderError);
  });
});
