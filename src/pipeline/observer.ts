/**
 * Resolving where the observer stands.
 *
 * The eye's height above sea level is `groundElevationM + eyeHeightM`, and of
 * those two the camera height is the one a human can state ("about 1.6 m") while
 * the ground height is the one nobody knows. So the ground height is read off
 * the terrain, and THIS is the use of SRTM the data actually supports:
 *
 *   MISSION.md, verified 2026-08-16 — Zermatt village reads 1608 m, its true
 *   elevation, to the metre. Broad terrain and valley floors are trustworthy.
 *   Sharp summits are not (−248 m at the Matterhorn, and displaced ~320 m),
 *   which is why SUMMIT heights come from the peak database instead.
 *
 * A viewpoint on a knife-edge ridge is the one case where the observer lookup
 * inherits the summit problem — the Gornergrat platform is a ridge crest — so
 * a caller that has a surveyed figure should pass it and skip the lookup. The
 * result records which of the two happened.
 */

import type { LatLng, Observer } from '../core/types.js';
import type { ElevationProvider } from '../providers/elevation.js';

import { PipelineError } from './errors.js';
import type { GroundElevationSource, ObserverRequest, ObserverResolution } from './types.js';

/**
 * Settle the observer's ground elevation, preferring a supplied figure, then
 * the terrain, then an explicit fallback.
 *
 * When all three fail it throws rather than assuming sea level. An observer at
 * a fictitious 0 m in the Alps produces a horizon that is wrong by kilometres
 * and a set of peak labels that all look approximately reasonable, which is the
 * worst possible failure.
 */
export async function resolveObserver(
  request: ObserverRequest,
  elevation: ElevationProvider,
  options: { readonly signal?: AbortSignal } = {},
): Promise<ObserverResolution> {
  const at: LatLng = { lat: request.lat, lon: request.lon };

  if (request.groundElevationM !== undefined) {
    return {
      observer: build(at, request.groundElevationM, request.eyeHeightM),
      groundElevationSource: 'supplied' satisfies GroundElevationSource,
    };
  }

  const [reading] = await elevation.fetchElevations([at], { signal: options.signal });
  if (reading !== undefined && reading.elevationM !== null) {
    return {
      observer: build(at, reading.elevationM, request.eyeHeightM),
      groundElevationSource: 'terrain',
      terrainNote: `${reading.elevationM.toFixed(1)} m from ${reading.dataset}`,
    };
  }

  if (request.fallbackGroundElevationM !== undefined) {
    return {
      observer: build(at, request.fallbackGroundElevationM, request.eyeHeightM),
      groundElevationSource: 'fallback',
      terrainNote:
        `the terrain source had no data at ${at.lat}, ${at.lon}` +
        `${reading === undefined ? '' : ` (${reading.dataset})`}`,
    };
  }

  throw new PipelineError(
    'observer-elevation-unknown',
    `No ground elevation for the observer at ${at.lat}, ${at.lon}: the terrain ` +
      `source returned no data${reading === undefined ? '' : ` (${reading.dataset})`} and no ` +
      'groundElevationM or fallbackGroundElevationM was supplied. Fetch the tile ' +
      '(npm run fetch:tiles) or pass a surveyed figure.',
  );
}

function build(at: LatLng, groundElevationM: number, eyeHeightM: number): Observer {
  if (!Number.isFinite(eyeHeightM)) {
    throw new PipelineError('incomplete-pose', `eyeHeightM must be a finite number`);
  }
  // NaN propagates instead of failing: every sight line, every horizon angle
  // and every clearance comparison goes NaN, the sweep keeps no profile point
  // and every peak comes back unjudged. The run then looks like a viewpoint
  // with nothing to see rather than a run that never happened, so the
  // non-finite figure is refused here, where it enters.
  if (!Number.isFinite(groundElevationM)) {
    throw new PipelineError(
      'observer-elevation-not-finite',
      `The observer's ground elevation at ${at.lat}, ${at.lon} is ${String(groundElevationM)}, ` +
        'not a finite number of metres. Nothing can be measured from it: every horizon angle ' +
        'and every visibility verdict would be NaN, and the empty overlay that produces reads ' +
        'as "no peaks are visible from here". Supply a ground elevation, or leave it unset and ' +
        'let the terrain answer.',
    );
  }
  return { lat: at.lat, lon: at.lon, groundElevationM, eyeHeightM };
}

/** Eye height above sea level — the number every sight line is measured from. */
export function eyeElevationM(observer: Observer): number {
  return observer.groundElevationM + observer.eyeHeightM;
}
