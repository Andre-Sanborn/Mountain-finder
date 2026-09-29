/**
 * Peaks over HTTP — the browser's `TiledPeakStore` loader (archive/v2-docs-20260929/TODO.md Q8).
 *
 * The same shape as `HttpTerrainStore`, for the same reasons (decision D7):
 * the only requests are to the app's OWN origin for static files staged by
 * `npm run package:deploy` (or served by `scripts/peaks-server.ts` in dev) at
 * `/peaks/<region>/…` — no live peak API at runtime, cacheable, offline-able.
 *
 * WHAT IS FETCHED AND WHAT IS BUNDLED. The region INDEXES are compiled into
 * the JS bundle (src/app/data-credits.ts imports them for the attribution
 * footer — ~10 KB for five regions), so the app knows at build time which
 * regions exist and which cells each holds, and `TiledPeakStore` can prune to
 * the cells a query's bounding box touches before a single request leaves.
 * Only CELL FILES travel over HTTP, on demand: a Gornergrat query fetches
 * Zermatt's `N45E007.json` and nothing of California's 3 341 summits.
 *
 * WHY A MULTI-REGION SOURCE AND NOT ONE BIG STORE. Regions are imported,
 * shipped and credited independently (each index carries its own citations —
 * see P10.3), and their cell lists can overlap at the edges if two imports
 * ever cover adjacent ground. So each region keeps its own `TiledPeakStore`,
 * queries fan out to all of them — pruning makes the misses free — and the
 * results are de-duplicated by peak id, first region in sorted-name order
 * winning. Ids are Overture GERS ids, so the "duplicate" case is the same
 * physical summit imported twice, not two summits sharing a name.
 */

import type { LatLng, Peak } from '../core/types.js';
import { ProviderError } from './errors.js';
import {
  TiledPeakStore,
  parsePeakCellIndex,
  type PeakCellEntry,
  type PeakCellLoader,
} from './peak-tile-store.js';

/** The subset of `Response` this loader uses — see `TerrainFetchResponse`. */
export interface PeakFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

export type PeakFetch = (url: string) => Promise<PeakFetchResponse>;

/** The one question the pipeline asks — same seam as `PeakSource`. */
export interface RegionPeakSource {
  peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]>;
  /** Region names served, sorted — for notes and tests. */
  readonly regionNames: readonly string[];
  /** Total summits the indexes promise, before any cell is fetched. */
  readonly peakCount: number;
}

/**
 * A loader fetching each cell relative to `baseUrl`.
 *
 * The same path discipline as `peakCellFileLoader`: an index is data, and a
 * cell path that could climb out of its region (`../…`, absolute, `//host`)
 * is refused before it becomes a URL. 404 maps to `null` — "not held", which
 * `TiledPeakStore` then reports as the index breaking its promise — and any
 * other failure is a typed error, never an empty dataset: an empty answer
 * reads as "there are no mountains here".
 */
export function httpPeakCellLoader(baseUrl: string, fetchFn: PeakFetch): PeakCellLoader {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return async (entry: PeakCellEntry): Promise<unknown | null> => {
    if (
      entry.file.startsWith('/') ||
      entry.file.includes('..') ||
      entry.file.includes('\\') ||
      entry.file.includes('//')
    ) {
      throw new ProviderError(
        'bad-response',
        `Cell ${entry.name} names "${entry.file}", which is not a safe relative path`,
      );
    }
    const url = `${base}/${entry.file}`;
    const response = await fetchFn(url);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ProviderError('bad-response', `GET ${url} answered ${response.status}`);
    }
    return response.json();
  };
}

/**
 * Build the app's peak source from bundled region indexes.
 *
 * @param indexes region name → the region's parsed `index.json` value, exactly
 *   as `import.meta.glob` + `regionNameFromPath` produce. Each is validated by
 *   `parsePeakCellIndex` HERE, at construction: a malformed index is a build
 *   defect and should fail at startup, not as a silent hole in a query.
 * @param baseUrl where the regions are served, `/peaks` in the app.
 */
export function createRegionPeakSource(
  indexes: Readonly<Record<string, unknown>>,
  baseUrl: string,
  fetchFn: PeakFetch,
): RegionPeakSource {
  const regionNames = Object.keys(indexes).sort();
  const stores = regionNames.map((name) => {
    const index = parsePeakCellIndex(indexes[name], `region ${name} index`);
    return new TiledPeakStore(index, httpPeakCellLoader(`${baseUrl}/${name}`, fetchFn));
  });
  const peakCount = stores.reduce((total, store) => total + store.index.peakCount, 0);

  return {
    regionNames,
    peakCount,
    async peaksWithin(center: LatLng, radiusKm: number): Promise<readonly Peak[]> {
      const answers = await Promise.all(
        stores.map((store) => store.peaksWithin(center, radiusKm)),
      );
      const seen = new Set<string>();
      const merged: Peak[] = [];
      for (const peaks of answers) {
        for (const peak of peaks) {
          if (seen.has(peak.id)) continue;
          seen.add(peak.id);
          merged.push(peak);
        }
      }
      return merged;
    },
  };
}
