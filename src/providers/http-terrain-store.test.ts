/**
 * The browser's terrain store (archive/v2-docs-20260929/TODO.md Q1), driven against a fake fetch.
 *
 * The grid under test is authored here, so every expectation is arithmetic on
 * numbers written in this file:
 *
 *   3 × 3 samples, north 46, west 7, spacing 0.5° → covers 45…46 N, 7…8 E
 *   row 0 (NORTH):  100  110  120
 *   row 1        :  200  210  220
 *   row 2 (SOUTH):  300  310  320
 *
 * so (46, 7) is the north-west corner sample = 100 m, (45.5, 7.5) is the
 * centre sample = 210 m, and (45, 8) is the south-east corner = 320 m.
 * 3 × 3 × 2 = 18 bytes.
 */

import { describe, expect, it } from 'vitest';

import { ProviderError, isProviderError } from './errors';
import { encodeBigEndianInt16 } from './hgt-tile';
import {
  HttpTerrainStore,
  resolveTerrainUrl,
  type TerrainFetch,
  type TerrainFetchResponse,
} from './http-terrain-store';
import type { TerrainManifest } from './terrain-manifest';

const GEOMETRY = {
  northLat: 46,
  westLon: 7,
  rows: 3,
  cols: 3,
  latStepDeg: 0.5,
  lonStepDeg: 0.5,
} as const;

const SAMPLES = encodeBigEndianInt16(
  Int16Array.from([100, 110, 120, 200, 210, 220, 300, 310, 320]),
);

const MANIFEST: TerrainManifest = {
  version: 1,
  grids: [{ name: 'N45E007', url: 'tiles/N45E007.hgt', dataset: 'srtm1', geometry: GEOMETRY }],
};

interface Recorder {
  readonly fetch: TerrainFetch;
  readonly urls: string[];
}

function ok(body: ArrayBuffer | unknown): TerrainFetchResponse {
  return {
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(body as ArrayBuffer),
    json: () => Promise.resolve(body),
  };
}

function status(code: number): TerrainFetchResponse {
  return {
    ok: false,
    status: code,
    arrayBuffer: () => Promise.reject(new Error('no body')),
    json: () => Promise.reject(new Error('no body')),
  };
}

function recorder(
  handler: (url: string) => TerrainFetchResponse,
): Recorder {
  const urls: string[] = [];
  return {
    urls,
    fetch: (url: string) => {
      urls.push(url);
      return Promise.resolve(handler(url));
    },
  };
}

/** The ordinary case: an index plus one grid file, both served. */
function servedStore(bytes: Uint8Array = SAMPLES): { store: HttpTerrainStore; log: Recorder } {
  const log = recorder((url) => {
    if (url === '/terrain/manifest.json') return ok(MANIFEST);
    if (url === '/terrain/tiles/N45E007.hgt') {
      return ok(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return status(404);
  });
  return { store: new HttpTerrainStore('/terrain/manifest.json', { fetch: log.fetch }), log };
}

describe('HttpTerrainStore', () => {
  it('reads elevations out of a grid fetched over HTTP', async () => {
    const { store } = servedStore();
    const tile = await store.tileFor(45.5, 7.5);
    expect(tile).not.toBeNull();
    const reading = tile?.read(45.5, 7.5);
    expect(reading?.status).toBe('ok');
    expect(reading?.elevationM).toBeCloseTo(210, 9);
    // The north-west corner sample, to prove row 0 is NORTH after transport.
    expect(tile?.read(46, 7).elevationM).toBeCloseTo(100, 9);
    expect(tile?.read(45, 8).elevationM).toBeCloseTo(320, 9);
  });

  it('resolves grid URLs relative to the index it came from', async () => {
    const { store, log } = servedStore();
    await store.tileFor(45.5, 7.5);
    expect(log.urls).toEqual(['/terrain/manifest.json', '/terrain/tiles/N45E007.hgt']);
  });

  it('fetches the index once and each grid once, however many points are read', async () => {
    const { store, log } = servedStore();
    await store.tileFor(45.5, 7.5);
    await store.tileFor(45.6, 7.4);
    await store.tileByName('N45E007');
    expect(log.urls.filter((url) => url.endsWith('manifest.json'))).toHaveLength(1);
    expect(log.urls.filter((url) => url.endsWith('.hgt'))).toHaveLength(1);
  });

  it('returns null — and fetches nothing — where the index has no coverage', async () => {
    const { store, log } = servedStore();
    // Chamonix: one degree west of the only grid served.
    expect(await store.tileFor(45.9237, 6.8694)).toBeNull();
    expect(log.urls).toEqual(['/terrain/manifest.json']);
  });

  it('refuses a truncated grid instead of parsing it as a different shape', async () => {
    const { store } = servedStore(SAMPLES.subarray(0, 16));
    await expect(store.tileFor(45.5, 7.5)).rejects.toThrow(/18 bytes|16/);
  });

  it('reports a missing index as a configuration failure, naming the URL', async () => {
    const log = recorder(() => status(404));
    const store = new HttpTerrainStore('/terrain/manifest.json', { fetch: log.fetch });
    try {
      await store.tileFor(45.5, 7.5);
      expect.unreachable('a missing terrain index must not read as "no terrain here"');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
      expect((error as Error).message).toContain('/terrain/manifest.json');
      expect((error as Error).message).toMatch(/404/);
    }
  });

  it('reports an indexed grid whose file is missing, naming the file', async () => {
    const log = recorder((url) => (url.endsWith('manifest.json') ? ok(MANIFEST) : status(404)));
    const store = new HttpTerrainStore('/terrain/manifest.json', { fetch: log.fetch });
    await expect(store.tileFor(45.5, 7.5)).rejects.toThrow(/tiles\/N45E007\.hgt/);
  });
});

describe('HttpTerrainStore.coverage', () => {
  it('confirms coverage and names the grid that answers', async () => {
    const { store } = servedStore();
    const coverage = await store.coverage(45.5, 7.5);
    expect(coverage.covered).toBe(true);
    expect(coverage.grid?.name).toBe('N45E007');
    expect(coverage.tileName).toBe('N45E007');
  });

  it('says exactly which tile a bare spot would need, and what is held instead', async () => {
    const { store } = servedStore();
    const coverage = await store.coverage(45.9237, 6.8694);
    expect(coverage.covered).toBe(false);
    expect(coverage.grid).toBeUndefined();
    // The specific fact the user needs in order to fix it.
    expect(coverage.tileName).toBe('N45E006');
    expect(coverage.available).toEqual(['N45E007']);
  });
});

/* Wave 3 suspicion — `resolveTerrainUrl` treated `//host/x` as same-origin
 * because it starts with `/`. A protocol-relative URL is not root-relative: a
 * browser resolves it against another HOST entirely, so an index entry reading
 * `//evil.example/N45E007.hgt` would take this store — documented as reading
 * only from its own origin — off it, and the elevation behind the whole
 * skyline would come from somewhere nobody named. */
describe('resolveTerrainUrl', () => {
  it('joins a relative entry to the index’s own directory', () => {
    expect(resolveTerrainUrl('/terrain/manifest.json', 'tiles/N45E007.hgt')).toBe(
      '/terrain/tiles/N45E007.hgt',
    );
    expect(resolveTerrainUrl('manifest.json', 'windows/w.i16be')).toBe('windows/w.i16be');
  });

  it('passes a root-relative entry through untouched', () => {
    expect(resolveTerrainUrl('/terrain/manifest.json', '/other/N45E007.hgt')).toBe(
      '/other/N45E007.hgt',
    );
  });

  it('refuses a protocol-relative entry, which points at another origin', () => {
    expect(() => resolveTerrainUrl('/terrain/manifest.json', '//evil.example/x.hgt')).toThrow(
      /another origin/,
    );
    expect(() => resolveTerrainUrl('/terrain/manifest.json', '//evil.example/x.hgt')).toThrow(
      ProviderError,
    );
  });
});
