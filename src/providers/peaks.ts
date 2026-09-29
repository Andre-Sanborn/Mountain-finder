/**
 * Peaks provider — Overpass API (archive/v2-docs-20260929/PLAN.md P2.3).
 *
 * https://overpass-api.de/api/interpreter  (POST, form field `data=<query>`)
 *
 * Fetches `natural=peak` elements that carry a `name`, as **both nodes and
 * ways**: a summit mapped as a small closed way has no lat/lon of its own, so
 * the query asks for `out body center` and the way's centroid is used.
 *
 * Elevation comes from the tags: `ele` (metres, per the OSM wiki) with `ele:ft`
 * (feet — common in the US) as fallback. Real-world tags are messy, so values
 * like "4808 m", "14,505 ft" and "1 100" are tolerated; anything that cannot be
 * read as a number is left as `null` rather than guessed at, and
 * `elevationSource` records where the number actually came from.
 */

import type { ElevationSource, LatLng, Peak } from '../core/types.js';
import type { ElevationProvider } from './elevation.js';
import { ProviderError } from './errors.js';
import { parseJsonBody, type Transport } from './transport.js';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Metres per international foot (exact). */
const METRES_PER_FOOT = 0.3048;

/** A peak as OSM knows it. `elevationM === null` = no usable `ele`/`ele:ft` tag. */
export interface PeakCandidate extends LatLng {
  /** `node/12345` or `way/12345` — matches `Peak.id` in core/types.ts. */
  readonly id: string;
  readonly name: string;
  readonly elevationM: number | null;
  /** `osm` when the tags supplied the height, `unknown` when nothing did. */
  readonly elevationSource: ElevationSource;
}

/** Where to look for peaks: a radius around a point, or an explicit bounding box. */
export type PeakSearchArea =
  | { readonly center: LatLng; readonly radiusKm: number }
  | { readonly bbox: BoundingBox };

export interface BoundingBox {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

export interface PeaksRequestOptions {
  readonly signal?: AbortSignal;
  /** Return `[]` instead of throwing `empty-result` when nothing is found. */
  readonly allowEmpty?: boolean;
}

export interface OverpassOptions {
  readonly url?: string;
  /** Overpass server-side timeout in seconds, embedded in the query. Default 60. */
  readonly timeoutSec?: number;
}

export interface PeaksProvider {
  fetchPeaks(
    area: PeakSearchArea,
    options?: PeaksRequestOptions,
  ): Promise<readonly PeakCandidate[]>;
}

function coord(value: number): string {
  return value.toFixed(6);
}

/** The Overpass QL filter for one search area, e.g. `(around:12000,45.976300,7.658600)`. */
function areaFilter(area: PeakSearchArea): string {
  if ('bbox' in area) {
    const { south, west, north, east } = area.bbox;
    return `(${coord(south)},${coord(west)},${coord(north)},${coord(east)})`;
  }
  const metres = Math.round(area.radiusKm * 1000);
  return `(around:${metres},${coord(area.center.lat)},${coord(area.center.lon)})`;
}

/**
 * Build the Overpass QL query. Exported so the query text itself is testable —
 * a wrong query returns a plausible-looking but wrong peak list.
 */
export function buildPeaksQuery(area: PeakSearchArea, options: OverpassOptions = {}): string {
  const filter = areaFilter(area);
  const timeout = Math.round(options.timeoutSec ?? 60);
  return [
    `[out:json][timeout:${timeout}];`,
    '(',
    `  node["natural"="peak"]["name"]${filter};`,
    `  way["natural"="peak"]["name"]${filter};`,
    ');',
    'out body center;',
  ].join('\n');
}

export class OverpassPeaksProvider implements PeaksProvider {
  private readonly transport: Transport;
  private readonly options: OverpassOptions;

  constructor(transport: Transport, options: OverpassOptions = {}) {
    this.transport = transport;
    this.options = options;
  }

  async fetchPeaks(
    area: PeakSearchArea,
    options: PeaksRequestOptions = {},
  ): Promise<readonly PeakCandidate[]> {
    const url = this.options.url ?? OVERPASS_URL;
    const res = await this.transport.request({
      url,
      method: 'POST',
      body: { data: buildPeaksQuery(area, this.options) },
      signal: options.signal,
    });

    const peaks = parsePeaksResponse(parseJsonBody(res, url), url);
    if (peaks.length === 0 && options.allowEmpty !== true) {
      throw new ProviderError('empty-result', `Overpass found no named peaks in this area (${url})`, {
        url,
      });
    }
    return peaks;
  }
}

interface OverpassElement {
  readonly type?: unknown;
  readonly id?: unknown;
  readonly lat?: unknown;
  readonly lon?: unknown;
  readonly center?: unknown;
  readonly tags?: unknown;
}

export function parsePeaksResponse(payload: unknown, url: string): readonly PeakCandidate[] {
  if (typeof payload !== 'object' || payload === null) {
    throw new ProviderError('bad-response', `Overpass response was not an object (${url})`, { url });
  }
  const body = payload as { elements?: unknown; remark?: unknown };

  // Overpass reports runtime failures (timeouts, out-of-memory) in `remark`
  // while still answering HTTP 200 with an empty element list.
  if (typeof body.remark === 'string' && /error|timed out|exceeded/i.test(body.remark)) {
    throw new ProviderError('bad-response', `Overpass reported: ${body.remark}`, { url });
  }
  if (!Array.isArray(body.elements)) {
    throw new ProviderError('bad-response', `Overpass response had no elements array (${url})`, {
      url,
    });
  }

  const peaks: PeakCandidate[] = [];
  for (const raw of body.elements as readonly unknown[]) {
    const candidate = toPeakCandidate(raw);
    if (candidate !== null) peaks.push(candidate);
  }
  return peaks;
}

function toPeakCandidate(raw: unknown): PeakCandidate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const element = raw as OverpassElement;

  const type = typeof element.type === 'string' ? element.type : null;
  const id = typeof element.id === 'number' ? element.id : null;
  if (type === null || id === null) return null;

  const tags =
    typeof element.tags === 'object' && element.tags !== null
      ? (element.tags as Readonly<Record<string, unknown>>)
      : {};

  const name = tags['name'];
  if (typeof name !== 'string' || name.trim() === '') return null;

  const position = elementPosition(element);
  if (position === null) return null;

  const elevationM = readTaggedElevation(tags);

  return {
    id: `${type}/${id}`,
    name: name.trim(),
    lat: position.lat,
    lon: position.lon,
    elevationM,
    elevationSource: elevationM === null ? 'unknown' : 'osm',
  };
}

/** Nodes carry lat/lon directly; ways only have the `center` that `out center` adds. */
function elementPosition(element: OverpassElement): LatLng | null {
  if (typeof element.lat === 'number' && typeof element.lon === 'number') {
    return { lat: element.lat, lon: element.lon };
  }
  if (typeof element.center === 'object' && element.center !== null) {
    const center = element.center as { lat?: unknown; lon?: unknown };
    if (typeof center.lat === 'number' && typeof center.lon === 'number') {
      return { lat: center.lat, lon: center.lon };
    }
  }
  return null;
}

/** `ele` first (metres), then `ele:ft` (feet). Returns null when neither is usable. */
function readTaggedElevation(tags: Readonly<Record<string, unknown>>): number | null {
  const ele = tags['ele'];
  if (typeof ele === 'string' || typeof ele === 'number') {
    const metres = parseEleMetres(String(ele));
    if (metres !== null) return metres;
  }
  const eleFt = tags['ele:ft'];
  if (typeof eleFt === 'string' || typeof eleFt === 'number') {
    const feet = parseEleFeet(String(eleFt));
    if (feet !== null) return feetToMetres(feet);
  }
  return null;
}

/** Feet → metres, rounded to 1 mm so binary-float noise never reaches the pipeline. */
export function feetToMetres(feet: number): number {
  return Math.round(feet * METRES_PER_FOOT * 1000) / 1000;
}

/**
 * Parse an OSM `ele` value into metres.
 *
 * Accepts: "4808", "4808 m", "4808m", "4,808 m", "1 100", "812.5", "+30".
 * Accepts an explicit foot unit ("14505 ft") and converts it.
 * Rejects anything else (e.g. "unknown", "approx 3000", "4808 m ASL") → null.
 */
export function parseEleMetres(value: string): number | null {
  const match = matchTaggedNumber(
    value,
    /^([+-]?\d+(?:\.\d+)?)\s*(m|meters?|metres?|ft|foot|feet)?$/i,
  );
  if (match === null) return null;
  const { magnitude, unit } = match;
  return unit !== undefined && /^(ft|foot|feet)$/i.test(unit) ? feetToMetres(magnitude) : magnitude;
}

/**
 * Parse an OSM `ele:ft` value into feet. The tag is defined as a bare foot
 * count; a redundant "ft" suffix is tolerated, a metre suffix is not.
 */
export function parseEleFeet(value: string): number | null {
  const match = matchTaggedNumber(value, /^([+-]?\d+(?:\.\d+)?)\s*(ft|foot|feet)?$/i);
  return match === null ? null : match.magnitude;
}

/** Strip thousands separators ("4,808", "1 100"), then apply a unit-aware pattern. */
function matchTaggedNumber(
  value: string,
  pattern: RegExp,
): { readonly magnitude: number; readonly unit: string | undefined } | null {
  const cleaned = value.trim().replace(/(\d)[,\s](?=\d{3}(\D|$))/g, '$1');
  const match = pattern.exec(cleaned);
  if (match === null) return null;

  const [, digits, unit] = match;
  if (digits === undefined) return null;
  const magnitude = Number(digits);
  if (!Number.isFinite(magnitude)) return null;
  return { magnitude, unit };
}

export interface ResolvedPeaks {
  /** Peaks with a trustworthy height, in the order the candidates arrived. */
  readonly peaks: readonly Peak[];
  /** Candidates no source could place a height on — reported, never faked. */
  readonly unresolved: readonly PeakCandidate[];
}

/**
 * Fill missing heights from the elevation dataset so every `Peak` handed to the
 * geometry core has a real number and an honest `elevationSource`.
 */
export async function resolvePeakElevations(
  candidates: readonly PeakCandidate[],
  elevation: ElevationProvider,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ResolvedPeaks> {
  const missingIndexes = candidates
    .map((candidate, index) => (candidate.elevationM === null ? index : -1))
    .filter((index) => index >= 0);

  const filled = new Map<number, number>();
  if (missingIndexes.length > 0) {
    const points = missingIndexes.map((index) => {
      const candidate = candidates[index];
      if (candidate === undefined) throw new ProviderError('bad-response', 'Candidate index lost');
      return { lat: candidate.lat, lon: candidate.lon };
    });
    const results = await elevation.fetchElevations(points, { signal: options.signal });
    missingIndexes.forEach((candidateIndex, i) => {
      const elevationM = results[i]?.elevationM;
      if (typeof elevationM === 'number') filled.set(candidateIndex, elevationM);
    });
  }

  const peaks: Peak[] = [];
  const unresolved: PeakCandidate[] = [];

  candidates.forEach((candidate, index) => {
    if (candidate.elevationM !== null) {
      peaks.push({
        id: candidate.id,
        name: candidate.name,
        lat: candidate.lat,
        lon: candidate.lon,
        elevationM: candidate.elevationM,
        elevationSource: candidate.elevationSource,
      });
      return;
    }
    const dataset = filled.get(index);
    if (dataset === undefined) {
      unresolved.push(candidate);
      return;
    }
    peaks.push({
      id: candidate.id,
      name: candidate.name,
      lat: candidate.lat,
      lon: candidate.lon,
      elevationM: dataset,
      elevationSource: 'srtm',
    });
  });

  return { peaks, unresolved };
}
