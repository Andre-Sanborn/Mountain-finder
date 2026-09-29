/**
 * How far the live sweep walks, taken from the terrain the deployment serves.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE RANGE IS DERIVED AND NOT A CONSTANT
 * ═══════════════════════════════════════════════════════════════════════════
 * `APP_SWEEP.maxRangeKm` is 30 km, which is right for a photograph: an occluder
 * is nearly always much nearer than the summit it hides. It is wrong at a field
 * site whose terrain was cut for a wider sweep. At Bogus Basin the deployment
 * serves a 60 km mosaic, 63 of the 104 summits within that radius lie beyond
 * 30 km, and the ten highest by apparent height are all 34–58 km away. A 30 km
 * sweep reports every one of them `unmeasured`, so the screen draws none of them
 * and says nothing about the mountains a person is standing there to name.
 *
 * ── WHERE THE NUMBER COMES FROM ────────────────────────────────────────────
 * The served grid's own geometry, through {@link coveredRadiusKm}: the largest
 * radius whose whole 360° ring lies inside the grid. That is the one fact about
 * the range the browser can check rather than trust. `TerrainCoverage.grid`
 * already carries the geometry, so nothing extra is fetched and nothing is
 * parsed out of a name.
 *
 * Two other sources were rejected. The grid NAME encodes the radius
 * (`bogus-basin-60km`) and the grid's `source` line spells it out in prose;
 * both are strings a packaging script happens to write, and a deployment that
 * renamed a grid would move the sweep. A served site record would be a second
 * request for a number the geometry already states.
 *
 * ── THE RANGE ONLY EVER GOES UP ────────────────────────────────────────────
 * The derived range is floored at {@link DEFAULT_SWEEP_RANGE_KM}. A whole 1°
 * tile inscribes a small circle around a viewpoint near its edge — at Gornergrat
 * the north edge is 1.85 km away — and cutting the sweep to that would drop the
 * occluders the tile does hold in the other three directions. The pipeline
 * already handles a ray that runs off the data: `rangeIsMeasured` refuses a
 * verdict on any summit whose sightline has a hole in it, so a short ray costs
 * an honest refusal rather than a wrong answer. Raising the range is the change
 * that needs the geometry's permission, and that is the direction this module
 * checks.
 *
 * Pure: geometry and a coordinate in, kilometres out.
 */

import { EARTH_RADIUS_M, destinationPoint } from '../../core/geodesy';
import type { LatLng } from '../../core/types';
import type { GridGeometry } from '../../providers/hgt-tile';
import { gridContains, terrainGridBounds } from '../../providers/terrain-manifest';
import { APP_SWEEP } from '../overlay-builder';

/** The still app's range, and the floor for the live one. */
export const DEFAULT_SWEEP_RANGE_KM = APP_SWEEP.maxRangeKm;

/**
 * The furthest the live sweep will walk, however much terrain is served.
 *
 * 60 km is the radius the Bogus Basin field site is cut for, and the sweep cost
 * grows with it: 720 rays at 90 m steps is 480 000 elevation reads at 60 km
 * against 240 000 at 30 km. A deployment that publishes a wider mosaic gets a
 * wider sweep by raising this, and pays for it in the wait before the first
 * label appears.
 */
export const SWEEP_RANGE_CAP_KM = 60;

/**
 * Slack between the sweep's own ray ends and the edge of the served grid, km.
 *
 * A grid edge is a posting line, and bilinear interpolation at a sample needs
 * the postings on both sides of it, so a ray that ends exactly on the edge is
 * reading half a cell. 0.25 km is about eight SRTM1 postings — far more than the
 * interpolation needs, and inside the 0.5 km of terrain margin a site package
 * already cuts beyond its declared sweep.
 */
export const SWEEP_RANGE_MARGIN_KM = 0.25;

const RAD = Math.PI / 180;

/**
 * The largest radius whose whole 360° ring lies inside this grid, km.
 *
 * Closed form, in four parts, on the same sphere `destinationPoint` walks:
 *
 *   • North and south are meridian arcs. Travelling due north by an angular
 *     distance δ raises the latitude by exactly δ, so the limit is the latitude
 *     gap in radians times the Earth's radius.
 *   • East and west are the extreme longitudes of a spherical circle. The
 *     easternmost point of a circle of angular radius δ centred at latitude φ is
 *     where the circle runs due north, which puts a right angle in the triangle
 *     pole–centre–point; the spherical rule for a right triangle gives
 *     `sin Δλ = sin δ / cos φ`. Inverted for δ: `sin δ = sin Δλ · cos φ`.
 *
 * The ring's extreme longitude is reached at a bearing that is neither 90° nor
 * 270°, so sampling bearings approaches this value from below and a sampled
 * answer would let one bearing in 720 run off the data.
 *
 * 0 for a coordinate outside the grid, and 0 at a pole, where `cos φ` is 0 and
 * a circle of any radius reaches every longitude.
 */
export function coveredRadiusKm(geometry: GridGeometry, at: LatLng): number {
  const bounds = terrainGridBounds(geometry);
  if (at.lat > bounds.north || at.lat < bounds.south) return 0;
  const cosLat = Math.cos(at.lat * RAD);
  if (!(cosLat > 0)) return 0;

  // Longitude is compared the way `gridContains` compares it: as an offset east
  // of the grid's west edge, modulo 360, so a grid spanning the ±180 seam and a
  // coordinate on the other convention still agree.
  const lonSpanDeg = (geometry.cols - 1) * geometry.lonStepDeg;
  const eastOfWestDeg = (((at.lon - geometry.westLon) % 360) + 360) % 360;
  if (eastOfWestDeg > lonSpanDeg) return 0;

  // The longitude gap is clamped to a quarter turn before the formula is
  // inverted, because `sin Δλ` turns over there: a gap of 120° would otherwise
  // read as the same bound as 60°. At the clamp the answer is 90° − |φ| of
  // angular radius, thousands of kilometres past the cap below, so a grid that
  // wide simply never sets the range.
  const metresFor = (deltaLonDeg: number): number => {
    const sinDelta = Math.sin(Math.min(deltaLonDeg, 90) * RAD) * cosLat;
    return Math.asin(Math.max(0, Math.min(1, sinDelta))) * EARTH_RADIUS_M;
  };

  const radiusM = Math.min(
    (bounds.north - at.lat) * RAD * EARTH_RADIUS_M,
    (at.lat - bounds.south) * RAD * EARTH_RADIUS_M,
    metresFor(lonSpanDeg - eastOfWestDeg),
    metresFor(eastOfWestDeg),
  );
  return Math.max(0, radiusM / 1000);
}

/** Which fact set the sweep's range. */
export type SweepRangeSource = 'served-grid' | 'default';

export interface LiveSweepRange {
  /** What `PipelineConfig.sweep.maxRangeKm` is set to, km. */
  readonly maxRangeKm: number;
  readonly source: SweepRangeSource;
  /**
   * The radius the served grid covers in every direction, km, or `undefined`
   * when no grid geometry was available to check.
   */
  readonly coveredRadiusKm: number | undefined;
}

/**
 * The range for a sweep at `at` over a served grid.
 *
 * `undefined` geometry is the honest default rather than an error: a terrain
 * source that answers coverage without naming a grid has said nothing about how
 * far it reaches, and 30 km is what the app claims without evidence.
 */
export function liveSweepRange(
  geometry: GridGeometry | undefined,
  at: LatLng,
): LiveSweepRange {
  if (geometry === undefined) {
    return { maxRangeKm: DEFAULT_SWEEP_RANGE_KM, source: 'default', coveredRadiusKm: undefined };
  }
  const covered = coveredRadiusKm(geometry, at);
  const usable = Math.min(SWEEP_RANGE_CAP_KM, covered - SWEEP_RANGE_MARGIN_KM);
  if (!(usable > DEFAULT_SWEEP_RANGE_KM)) {
    return { maxRangeKm: DEFAULT_SWEEP_RANGE_KM, source: 'default', coveredRadiusKm: covered };
  }
  // Whole kilometres, so the figure on screen is the figure the sweep ran and a
  // grid a few metres wider does not change the label.
  return {
    maxRangeKm: Math.floor(usable),
    source: 'served-grid',
    coveredRadiusKm: covered,
  };
}

/**
 * One sentence naming the radius, for the readout.
 *
 * It takes the kilometres rather than a {@link LiveSweepRange} so the screen can
 * write the label from the range the sweep actually ran with — which travels on
 * the annotated scene — instead of deriving the range a second time and possibly
 * disagreeing with it. Anything above {@link DEFAULT_SWEEP_RANGE_KM} was cleared
 * by the served geometry, because that is the only way {@link liveSweepRange}
 * exceeds the floor.
 */
export function sweepRangeSentence(maxRangeKm: number): string {
  if (maxRangeKm > DEFAULT_SWEEP_RANGE_KM) {
    return `Skyline measured out to ${maxRangeKm} km, the radius this site's terrain covers.`;
  }
  return `Skyline swept out to ${maxRangeKm} km, the app's default range.`;
}

/**
 * Whether every ray end of a 360° sweep at `radiusKm` lands inside the grid.
 *
 * The sampled answer to the question {@link coveredRadiusKm} answers in closed
 * form. It exists so the two can be checked against each other rather than one
 * of them being trusted, and it is what a caller uses to assert a range it was
 * handed rather than to choose one.
 */
export function ringIsInside(
  geometry: GridGeometry,
  at: LatLng,
  radiusKm: number,
  bearingCount: number,
): boolean {
  for (let index = 0; index < bearingCount; index += 1) {
    const end = destinationPoint(at, (index * 360) / bearingCount, radiusKm * 1000);
    if (!gridContains(geometry, end.lat, end.lon)) return false;
  }
  return true;
}
