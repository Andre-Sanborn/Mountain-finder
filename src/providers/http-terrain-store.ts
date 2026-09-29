/**
 * Terrain over HTTP — the browser's `TileStore` (archive/v2-docs-20260929/TODO.md Q1).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * HOW THE APP GETS TERRAIN, AND WHY THIS WAY
 * ═══════════════════════════════════════════════════════════════════════════
 * `DirectoryTileStore` reads `.hgt` files off a disk, which a browser does not
 * have. This store does the same job against a **same-origin static directory**
 * published by whoever serves the app: an index (`terrain-manifest.ts`) plus the
 * raw sample files it names.
 *
 * That keeps decision D7 intact in the browser:
 *
 *   • **No live third-party API at runtime.** The only requests are to the
 *     app's own origin for static files it shipped with. `npm run fetch:tiles`
 *     remains the one thing that talks to the outside world, at acquisition
 *     time, exactly as on the Node side.
 *   • **Cacheable and offline-able.** Static bytes under one path are what an
 *     HTTP cache — and later a service worker — can hold, so a photograph
 *     re-opened on a train is answered from the device.
 *   • **Honest about absence.** A coordinate the served directory does not
 *     cover produces `null`, never a substituted neighbour tile, and
 *     {@link HttpTerrainStore.coverage} answers *before* any download so the
 *     app can say WHICH tile is missing instead of drawing an empty overlay.
 *
 * The alternative — bundling one pre-baked window as an app asset — was
 * rejected as the primary mechanism: it makes the app work in exactly one
 * valley and silently useless everywhere else. It survives as a *special case*
 * of this design instead, because a window and a whole tile are both just grids
 * in the index, so an app can ship a small window AND serve whole tiles with no
 * second code path.
 *
 * WHAT THIS COSTS. A whole SRTM1 tile is 25 MB, and `selectTerrainGrid`
 * deliberately prefers the largest covering grid, so a full-tile deployment
 * pays 25 MB once per tile per session. That is the right trade: the small
 * window cannot see the ridge that hides a summit, and a cheap wrong answer is
 * the thing this project exists to avoid. The LRU keeps the parsed grids that
 * are actually in use and nothing more.
 */

import { ProviderError } from './errors.js';
import { HgtTile, parseGridWindow } from './hgt-tile.js';
import {
  expectedGridByteLength,
  parseTerrainManifest,
  selectTerrainGrid,
  type TerrainGrid,
  type TerrainManifest,
} from './terrain-manifest.js';
import { tileNameFor, type TileStore } from './tile-store.js';

/**
 * The subset of `Response` this store uses.
 *
 * Structural, so the global `fetch` satisfies it without a cast and a test can
 * hand over a plain object — the same injectable-transport principle as
 * `Transport`, kept minimal because there is no retry policy here: a static
 * file on our own origin either exists or does not.
 */
export interface TerrainFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  json(): Promise<unknown>;
}

export type TerrainFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<TerrainFetchResponse>;

export interface HttpTerrainStoreOptions {
  /** Injected for tests; defaults to the global `fetch`. */
  readonly fetch?: TerrainFetch;
  /**
   * Parsed grids kept in memory. SRTM1 tiles cost ~26 MB each as `Int16Array`,
   * so the default is small on purpose.
   */
  readonly maxCachedGrids?: number;
}

/** What the app needs to say something specific about a bare spot. */
export interface TerrainCoverage {
  readonly covered: boolean;
  /** The grid that will answer, when one does. */
  readonly grid?: TerrainGrid;
  /** The SRTM tile this coordinate falls in — what to go and fetch. */
  readonly tileName: string;
  /** Names of every grid the server holds, for the diagnostic. */
  readonly available: readonly string[];
}

const DEFAULT_MAX_CACHED_GRIDS = 3;

/**
 * Resolve a grid URL against the index's own URL.
 *
 * Deliberately not `new URL(...)`: this module runs in Node tests where there
 * is no document base, and the index URL is normally a root-relative path.
 * Absolute and root-relative entries are passed through untouched.
 *
 * A PROTOCOL-RELATIVE entry (`//host/path`) is refused. It starts with `/`, so
 * a "root-relative means same origin" test waves it through — but a browser
 * resolves it against a different HOST, which is precisely what this store
 * promises not to do (see the module header: static files on the app's own
 * origin, nothing substituted for them). An index that carries one is either
 * mis-generated or tampered with, and both deserve to be loud.
 */
export function resolveTerrainUrl(manifestUrl: string, url: string): string {
  if (url.startsWith('//')) {
    throw new ProviderError(
      'bad-response',
      `The terrain index entry "${url}" is protocol-relative, so it names another origin. ` +
        'This store reads terrain only from static files on the app’s own origin.',
      { url },
    );
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/')) return url;
  const cut = manifestUrl.lastIndexOf('/');
  return cut < 0 ? url : `${manifestUrl.slice(0, cut + 1)}${url}`;
}

export class HttpTerrainStore implements TileStore {
  readonly manifestUrl: string;

  private readonly fetchImpl: TerrainFetch;

  private readonly maxCachedGrids: number;

  private manifestPromise: Promise<TerrainManifest> | undefined;

  /** grid name → parsed grid. Insertion order is LRU order. */
  private readonly cache = new Map<string, Promise<HgtTile>>();

  constructor(manifestUrl: string, options: HttpTerrainStoreOptions = {}) {
    this.manifestUrl = manifestUrl;
    const injected = options.fetch;
    this.fetchImpl =
      injected ??
      ((url, init) => fetch(url, init) as unknown as Promise<TerrainFetchResponse>);
    this.maxCachedGrids = Math.max(1, options.maxCachedGrids ?? DEFAULT_MAX_CACHED_GRIDS);
  }

  /**
   * The served index, fetched at most once.
   *
   * A missing or malformed index throws rather than reading as "no terrain
   * anywhere": one is a deployment that forgot to publish its tiles, the other
   * is a photograph taken off the edge of the data, and telling a user the
   * second when the first is true sends them looking in the wrong place.
   */
  async manifest(): Promise<TerrainManifest> {
    this.manifestPromise ??= this.loadManifest();
    try {
      return await this.manifestPromise;
    } catch (error) {
      // Do not cache the failure: a server that was still starting up, or a
      // directory that has since been populated, should be retried.
      this.manifestPromise = undefined;
      throw error;
    }
  }

  /** Whether this coordinate has terrain, answered without downloading any. */
  async coverage(lat: number, lon: number): Promise<TerrainCoverage> {
    const manifest = await this.manifest();
    const grid = selectTerrainGrid(manifest, lat, lon);
    const base: TerrainCoverage = {
      covered: grid !== undefined,
      tileName: tileNameFor(lat, lon),
      available: manifest.grids.map((entry) => entry.name),
    };
    return grid === undefined ? base : { ...base, grid };
  }

  async tileFor(lat: number, lon: number): Promise<HgtTile | null> {
    const manifest = await this.manifest();
    const grid = selectTerrainGrid(manifest, lat, lon);
    return grid === undefined ? null : this.grid(grid);
  }

  async tileByName(name: string): Promise<HgtTile | null> {
    const manifest = await this.manifest();
    const wanted = name.trim().toUpperCase();
    const grid = manifest.grids.find((entry) => entry.name.toUpperCase() === wanted);
    return grid === undefined ? null : this.grid(grid);
  }

  /** Grid names currently parsed and held, least recently used first. */
  get cachedNames(): readonly string[] {
    return [...this.cache.keys()];
  }

  private grid(grid: TerrainGrid): Promise<HgtTile> {
    const cached = this.cache.get(grid.name);
    if (cached !== undefined) {
      this.cache.delete(grid.name);
      this.cache.set(grid.name, cached);
      return cached;
    }
    const loading = this.loadGrid(grid);
    this.cache.set(grid.name, loading);
    void loading.catch(() => {
      if (this.cache.get(grid.name) === loading) this.cache.delete(grid.name);
    });
    while (this.cache.size > this.maxCachedGrids) {
      const oldest = this.cache.keys().next();
      if (oldest.done === true) break;
      this.cache.delete(oldest.value);
    }
    return loading;
  }

  private async loadManifest(): Promise<TerrainManifest> {
    let response: TerrainFetchResponse;
    try {
      response = await this.fetchImpl(this.manifestUrl);
    } catch (cause) {
      throw new ProviderError(
        'network',
        `Could not reach the terrain index at ${this.manifestUrl}. ` +
          'This app reads elevation from static files on its own origin; ' +
          'nothing else can be substituted for them.',
        { cause, url: this.manifestUrl },
      );
    }
    if (!response.ok) {
      throw new ProviderError(
        'bad-response',
        `No terrain index at ${this.manifestUrl} (HTTP ${response.status}). ` +
          'The app has no elevation data at all until that directory is served — ' +
          'fetch tiles with "npm run fetch:tiles" and serve them at /terrain/.',
        { status: response.status, url: this.manifestUrl },
      );
    }
    return parseTerrainManifest(await response.json(), this.manifestUrl);
  }

  private async loadGrid(grid: TerrainGrid): Promise<HgtTile> {
    const url = resolveTerrainUrl(this.manifestUrl, grid.url);
    let response: TerrainFetchResponse;
    try {
      response = await this.fetchImpl(url);
    } catch (cause) {
      throw new ProviderError('network', `Could not fetch terrain grid ${url}`, { cause, url });
    }
    if (!response.ok) {
      throw new ProviderError(
        'bad-response',
        `The terrain index lists ${grid.name} but ${url} is not being served ` +
          `(HTTP ${response.status}).`,
        { status: response.status, url },
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const expected = expectedGridByteLength(grid.geometry);
    if (bytes.length !== expected) {
      throw new ProviderError(
        'bad-tile',
        `${grid.name} (${url}) should be ${expected} bytes for its ` +
          `${grid.geometry.rows}×${grid.geometry.cols} grid but ${bytes.length} arrived — ` +
          'a truncated download, not terrain.',
        { url },
      );
    }
    return parseGridWindow(bytes, grid.geometry, grid.name);
  }
}
