/**
 * The terrain the live view re-projects — swept once, all the way round.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ONE SWEEP, NOT ONE PER TICK
 * ═══════════════════════════════════════════════════════════════════════════
 * Every verdict in an `AnnotatedScene` is pose-free: a summit clears the ground
 * in front of it or it does not, whichever way the camera points. `loop.ts`
 * builds on that — the scene is computed once and re-projected as the sensors
 * move the pose. That is the whole reason a phone can run this at all.
 *
 * The still app sweeps twice the field of view around the photograph's heading,
 * which is right for a photograph and wrong for a live view: a user turns, and
 * `liveOverlayScene` correctly REFUSES a pose whose drawn span reaches outside
 * the swept sector. Re-sweeping on every turn would stall the screen every time
 * the phone moved. So the live sweep is the full circle at the position fix,
 * and `uncoveredSpanDeg` then returns 0 for every heading — no refusals, no
 * re-sweeps, and no labels over terrain nobody measured.
 *
 * ── WHAT IT COSTS, AND WHAT THAT BUYS ──────────────────────────────────────
 * The full circle is 720 rays at `APP_SWEEP`'s half-degree spacing, each walked
 * in 90 m steps as far as the served terrain covers: about 240 000 elevation
 * reads at the 30 km default and 480 000 at the 60 km a field-site mosaic
 * permits. Four to eight times the work the still app does, once, against a turn
 * that would otherwise stall. TODO.md carries measuring it under CPU throttling
 * as its own item; the e2e prints the wall time it actually took.
 *
 * ── HOW FAR THE RAYS GO ────────────────────────────────────────────────────
 * From the served grid, not from a constant. `sweep-range.ts` takes the geometry
 * `TerrainCoverage` already carries and works out the largest radius covered in
 * every direction, so a viewpoint inside the Bogus Basin mosaic sweeps the site's
 * own 60 km and a viewpoint on a whole tile keeps the 30 km default. That module
 * says why the default is a floor rather than a ceiling.
 *
 * ── D10 IS ON ──────────────────────────────────────────────────────────────
 * `nearFieldRadiusM` is `APP_NEAR_FIELD_RADIUS_M`, the same 150 m the still app
 * and `npm run annotate` use. A DEM cannot resolve the ground within about
 * 150 m of the camera, and on a ridge that ground decides verdicts, so a summit
 * whose clearance flips inside that uncertainty is labelled "may be hidden"
 * rather than being decided by the sampling grid. Live is exactly where a user
 * stands on that ground.
 *
 * This module is the one place the live screen touches the pipeline, and every
 * dependency is injected, so it runs under vitest against an analytic surface
 * with no browser and no tiles.
 */

import type { LatLng, Observer } from '../../core/types';
import { annotateScene } from '../../pipeline/annotate';
import type {
  AnnotatedScene,
  GroundElevationSource,
  ObserverResolution,
  PeakSource,
  PipelineConfig,
} from '../../pipeline/types';
import {
  APP_NEAR_FIELD_RADIUS_M,
  APP_PEAK_RADIUS_KM,
  APP_SWEEP,
  TerrainUnavailableError,
  noTerrainMessage,
  type TerrainSource,
} from '../overlay-builder';
import { DEFAULT_SWEEP_RANGE_KM, liveSweepRange, type LiveSweepRange } from './sweep-range';

/** Where the observer is standing, as the position fix reports it. */
export interface LiveObserver extends LatLng {
  readonly eyeHeightM: number;
  /**
   * The ground height GPS implies, used only if the terrain has no reading here.
   *
   * The fix's own altitude is deliberately NOT the first answer. Two reasons,
   * both measured:
   *
   *   • CoreLocation reports altitude above the geoid while this pipeline works
   *     in ellipsoidal heights, and the gap reaches about 50 m — 0.29° on a
   *     summit 10 km away, which is several label widths.
   *   • A phone's vertical GPS error is two to three times its horizontal one,
   *     tens of metres on a good fix.
   *
   * The DEM, by contrast, reads broad terrain to the metre: Zermatt village
   * comes back at its true 1608 m (MISSION.md, verified 2026-08-16). So the
   * ground under the observer comes from the terrain and the eye sits 1.6 m
   * above it, and the GPS figure is the fallback for a void in the DEM.
   */
  readonly fallbackGroundElevationM?: number | undefined;
}

/** The full circle, from due north. */
export const LIVE_SWEEP_SPAN_DEG = 360;

/** The pipeline configuration the live sweep runs under, at a given range. */
export function liveSweepConfig(maxRangeKm: number = DEFAULT_SWEEP_RANGE_KM): PipelineConfig {
  return {
    peakRadiusKm: APP_PEAK_RADIUS_KM,
    nearFieldRadiusM: APP_NEAR_FIELD_RADIUS_M,
    sweep: { ...APP_SWEEP, maxRangeKm, spanDeg: LIVE_SWEEP_SPAN_DEG, startBearingDeg: 0 },
  };
}

export interface BuildLiveSceneDeps {
  readonly terrain: TerrainSource;
  readonly peaks: PeakSource;
  readonly signal?: AbortSignal | undefined;
}

/**
 * The range the sweep at `observer` will run at, given what the server holds.
 *
 * Exported so a caller can state the radius before waiting minutes for the
 * sweep, and so the screen's label and the sweep itself cannot disagree: both
 * read this.
 */
export async function liveSweepRangeAt(
  observer: LatLng,
  terrain: TerrainSource,
): Promise<LiveSweepRange> {
  const coverage = await terrain.coverage(observer.lat, observer.lon);
  return liveSweepRange(coverage.grid?.geometry, observer);
}

/**
 * Sweep the circle at the fix, or refuse with the position named.
 *
 * Coverage is settled before the pipeline runs, exactly as the still path does
 * it, and its absence is raised as `TerrainUnavailableError` carrying
 * `noTerrainMessage`. An empty overlay would read as "no peaks are visible from
 * here", which is a claim, and a fabricated one.
 *
 * The same coverage answer sets how far the rays go: it carries the served
 * grid's geometry, and `sweep-range.ts` turns that into the radius the grid can
 * answer for.
 */
export async function buildLiveScene(
  observer: LiveObserver,
  deps: BuildLiveSceneDeps,
): Promise<AnnotatedScene> {
  const coverage = await deps.terrain.coverage(observer.lat, observer.lon);
  if (!coverage.covered) {
    throw new TerrainUnavailableError(noTerrainMessage(coverage, observer), coverage);
  }
  const range = liveSweepRange(coverage.grid?.geometry, observer);

  return annotateScene({
    observer: {
      lat: observer.lat,
      lon: observer.lon,
      eyeHeightM: observer.eyeHeightM,
      // `fallbackGroundElevationM`, never `groundElevationM`: supplying the
      // latter skips the terrain lookup, and the DEM's ground at the fix is the
      // better figure. `resolveObserver` records which of the two it used.
      ...(observer.fallbackGroundElevationM === undefined
        ? {}
        : { fallbackGroundElevationM: observer.fallbackGroundElevationM }),
    },
    // The sweep and every verdict are pose-free, so the camera handed to the
    // pipeline only has to be a valid pose — the live loop supplies the real
    // one per tick. Due north and level, with a field of view wide enough that
    // no pipeline step treats the frame as degenerate.
    camera: { headingDeg: 0, pitchDeg: 0, rollDeg: 0, hFovDeg: 60, vFovDeg: 45 },
    elevation: deps.terrain.elevation,
    peaks: deps.peaks,
    config: liveSweepConfig(range.maxRangeKm),
    ...(deps.signal === undefined ? {} : { signal: deps.signal }),
  });
}

/**
 * How far the observer has walked from the fix the scene was swept at, metres.
 *
 * Plane trigonometry on a local tangent plane, which is exact enough for the
 * few hundred metres that matter: the scene is a sweep from one point, and a
 * user who walks far enough for parallax to move a near ridge needs a new one.
 * Used to offer a re-sweep rather than to trigger one silently — a screen that
 * rebuilt itself while someone was aiming it would be worse than a stale near
 * field.
 */
export function metresFromFix(fix: LatLng, now: LatLng): number {
  const metresPerDegreeLat = 111_132;
  const dLat = (now.lat - fix.lat) * metresPerDegreeLat;
  const dLon =
    (now.lon - fix.lon) * metresPerDegreeLat * Math.cos((fix.lat * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** How far the observer may move before the screen offers a fresh sweep. */
export const RESWEEP_DISTANCE_M = 500;

/** Where the height the labels were worked out from came from, for the screen. */
export interface GroundHeightNote {
  readonly source: GroundElevationSource;
  /** One or two sentences for the readout. */
  readonly text: string;
  /** True when the figure is the GPS one, which is the weaker of the two. */
  readonly warn: boolean;
}

/**
 * Say which height the sight lines were measured from, in the user's own terms.
 *
 * On screen rather than in a log, because the two answers differ by tens of
 * metres and the user is the only one who can tell whether the labels sit too
 * high or too low. A screen that showed one number without saying where it came
 * from would make a GPS guess look like a survey.
 */
export function groundHeightNote(
  observer: Observer,
  resolution: ObserverResolution,
): GroundHeightNote {
  const eye = observer.groundElevationM + observer.eyeHeightM;
  const heights =
    `${observer.groundElevationM.toFixed(1)} m of ground plus ${observer.eyeHeightM.toFixed(2)} m ` +
    `of eye height, so ${eye.toFixed(1)} m`;
  if (resolution.groundElevationSource === 'terrain') {
    return {
      source: 'terrain',
      text: `Your height came from the map's own terrain: ${heights}.`,
      warn: false,
    };
  }
  if (resolution.groundElevationSource === 'fallback') {
    return {
      source: 'fallback',
      text:
        `The map has no ground height at this spot, so your phone's altitude was used instead: ` +
        `${heights}. Phone altitude can be tens of metres out, which tilts the whole skyline.`,
      warn: true,
    };
  }
  return {
    source: 'supplied',
    text: `Your height was set by hand: ${heights}.`,
    warn: false,
  };
}
