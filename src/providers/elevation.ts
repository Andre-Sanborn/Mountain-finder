/**
 * Elevation provider — OpenTopoData SRTM 90 m (archive/v2-docs-20260929/PLAN.md P2.2).
 *
 * https://api.opentopodata.org/v1/srtm90m?locations=lat,lng|lat,lng
 *
 * Response schema (documented at https://www.opentopodata.org/api/):
 *   { "status": "OK",
 *     "results": [ { "dataset": "srtm90m",
 *                    "elevation": 815.0,          // null over ocean / voids
 *                    "location": { "lat": …, "lng": … } } ] }
 *
 * Two things this client refuses to fudge:
 *  1. The API's hard limit of 100 locations per request — larger sets are split
 *     into batches and stitched back together *in request order*.
 *  2. `elevation: null` means "this dataset has no data here" (ocean, void). It
 *     is kept as `null` rather than quietly becoming 0 m, because 0 m is a real
 *     elevation and a horizon computed from fake sea level is silently wrong.
 */

import type { ElevationSample, LatLng } from '../core/types.js';
import { ProviderError } from './errors.js';
import { parseJsonBody, type Transport } from './transport.js';

/** Default dataset endpoint. */
export const SRTM90M_URL = 'https://api.opentopodata.org/v1/srtm90m';

/** OpenTopoData's hard cap on locations per request. */
export const MAX_LOCATIONS_PER_REQUEST = 100;

/** Decimal places used when formatting coordinates into the URL (~0.11 m). */
const COORD_DECIMALS = 6;

/** One point's reading. `elevationM === null` means the dataset has no data there. */
export interface ElevationResult extends LatLng {
  readonly elevationM: number | null;
  /** Dataset name echoed by the API, e.g. "srtm90m". */
  readonly dataset: string;
}

export interface ElevationProvider {
  fetchElevations(
    points: readonly LatLng[],
    options?: ElevationRequestOptions,
  ): Promise<readonly ElevationResult[]>;
}

export interface ElevationRequestOptions {
  readonly signal?: AbortSignal;
}

export interface OpenTopoDataOptions {
  /** Dataset endpoint. Default `SRTM90M_URL`. */
  readonly url?: string;
  /** Locations per request; clamped to 1…100. Default 100. */
  readonly batchSize?: number;
  /** OpenTopoData interpolation mode. Default `bilinear`. */
  readonly interpolation?: 'nearest' | 'bilinear' | 'cubic';
}

function formatCoord(value: number): string {
  return value.toFixed(COORD_DECIMALS);
}

/** `lat,lng|lat,lng…` exactly as OpenTopoData documents it. */
export function formatLocations(points: readonly LatLng[]): string {
  return points.map((p) => `${formatCoord(p.lat)},${formatCoord(p.lon)}`).join('|');
}

/** The request URL for one batch. Exported so its shape can be asserted directly. */
export function elevationRequestUrl(
  points: readonly LatLng[],
  options: OpenTopoDataOptions = {},
): string {
  const base = options.url ?? SRTM90M_URL;
  const params = new URLSearchParams({
    locations: formatLocations(points),
    interpolation: options.interpolation ?? 'bilinear',
  });
  return `${base}?${params.toString()}`;
}

/** Split into consecutive batches, preserving order. */
export function batchPoints(
  points: readonly LatLng[],
  batchSize: number,
): readonly (readonly LatLng[])[] {
  const size = Math.max(1, Math.min(Math.trunc(batchSize), MAX_LOCATIONS_PER_REQUEST));
  const batches: (readonly LatLng[])[] = [];
  for (let i = 0; i < points.length; i += size) batches.push(points.slice(i, i + size));
  return batches;
}

export class OpenTopoDataElevationProvider implements ElevationProvider {
  private readonly transport: Transport;
  private readonly options: OpenTopoDataOptions;

  constructor(transport: Transport, options: OpenTopoDataOptions = {}) {
    this.transport = transport;
    this.options = options;
  }

  /** How many requests `points` will cost — batching is observable, not incidental. */
  batchCount(points: readonly LatLng[]): number {
    return batchPoints(points, this.options.batchSize ?? MAX_LOCATIONS_PER_REQUEST).length;
  }

  async fetchElevations(
    points: readonly LatLng[],
    options: ElevationRequestOptions = {},
  ): Promise<readonly ElevationResult[]> {
    if (points.length === 0) return [];

    const batches = batchPoints(points, this.options.batchSize ?? MAX_LOCATIONS_PER_REQUEST);
    const out: ElevationResult[] = [];

    // Sequential on purpose: OpenTopoData's free tier allows ~1 call/second and
    // asks callers not to parallelise.
    for (const batch of batches) {
      const url = elevationRequestUrl(batch, this.options);
      const res = await this.transport.request({ url, method: 'GET', signal: options.signal });
      out.push(...parseElevationBatch(parseJsonBody(res, url), batch, url));
    }

    return out;
  }
}

interface RawResult {
  readonly elevation: unknown;
  readonly location: unknown;
  readonly dataset: unknown;
}

function parseElevationBatch(
  payload: unknown,
  requested: readonly LatLng[],
  url: string,
): readonly ElevationResult[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new ProviderError('bad-response', `OpenTopoData response was not an object (${url})`, {
      url,
    });
  }
  const body = payload as { status?: unknown; error?: unknown; results?: unknown };

  if (typeof body.status === 'string' && body.status !== 'OK') {
    const detail = typeof body.error === 'string' ? body.error : body.status;
    throw new ProviderError('bad-response', `OpenTopoData returned ${body.status}: ${detail}`, {
      url,
    });
  }
  if (!Array.isArray(body.results)) {
    throw new ProviderError('bad-response', `OpenTopoData response had no results array (${url})`, {
      url,
    });
  }
  if (body.results.length === 0) {
    throw new ProviderError(
      'empty-result',
      `OpenTopoData returned no results for ${requested.length} location(s) (${url})`,
      { url },
    );
  }
  if (body.results.length !== requested.length) {
    throw new ProviderError(
      'bad-response',
      `OpenTopoData returned ${body.results.length} results for ${requested.length} locations (${url})`,
      { url },
    );
  }

  const results: ElevationResult[] = [];
  for (let i = 0; i < requested.length; i += 1) {
    const point = requested[i];
    const raw = body.results[i] as RawResult | undefined;
    if (point === undefined || typeof raw !== 'object' || raw === null) {
      throw new ProviderError('bad-response', `OpenTopoData result ${i} was not an object (${url})`, {
        url,
      });
    }

    assertEchoedLocation(raw.location, point, i, url);

    const elevation = raw.elevation;
    if (elevation !== null && typeof elevation !== 'number') {
      throw new ProviderError(
        'bad-response',
        `OpenTopoData result ${i} had a non-numeric elevation (${url})`,
        { url },
      );
    }
    if (typeof elevation === 'number' && !Number.isFinite(elevation)) {
      throw new ProviderError(
        'bad-response',
        `OpenTopoData result ${i} had a non-finite elevation (${url})`,
        { url },
      );
    }

    results.push({
      lat: point.lat,
      lon: point.lon,
      elevationM: elevation,
      dataset: typeof raw.dataset === 'string' ? raw.dataset : 'unknown',
    });
  }
  return results;
}

/**
 * The API echoes each queried location. Checking it is how we prove results came
 * back in request order rather than trusting a comment in the docs.
 */
function assertEchoedLocation(location: unknown, point: LatLng, index: number, url: string): void {
  if (typeof location !== 'object' || location === null) return;
  const echo = location as { lat?: unknown; lng?: unknown };
  const tolerance = 1e-6;
  const latOk = typeof echo.lat !== 'number' || Math.abs(echo.lat - point.lat) <= tolerance;
  const lngOk = typeof echo.lng !== 'number' || Math.abs(echo.lng - point.lon) <= tolerance;
  if (!latOk || !lngOk) {
    throw new ProviderError(
      'bad-response',
      `OpenTopoData result ${index} echoed ${String(echo.lat)},${String(echo.lng)} ` +
        `but ${point.lat},${point.lon} was requested — results are out of order (${url})`,
      { url },
    );
  }
}

/** What to do with points the dataset has no data for. */
export type NoDataPolicy = 'throw' | 'drop' | { readonly fillM: number };

/**
 * Narrow `ElevationResult[]` to the pipeline's `ElevationSample[]`, forcing the
 * caller to say out loud what "no data" should become.
 */
export function toElevationSamples(
  results: readonly ElevationResult[],
  policy: NoDataPolicy = 'throw',
): readonly ElevationSample[] {
  const samples: ElevationSample[] = [];
  for (const result of results) {
    if (result.elevationM !== null) {
      samples.push({ lat: result.lat, lon: result.lon, elevationM: result.elevationM });
      continue;
    }
    if (policy === 'drop') continue;
    if (policy === 'throw') {
      throw new ProviderError(
        'empty-result',
        `No elevation data at ${result.lat},${result.lon} in dataset ${result.dataset}`,
      );
    }
    samples.push({ lat: result.lat, lon: result.lon, elevationM: policy.fillM });
  }
  return samples;
}
