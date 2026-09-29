/**
 * SCENE 1 — FLAT PLANE, RAISED OBSERVER  (archive/v2-docs-20260929/PLAN.md P6.1 "plateau")
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Terrain: elevationM = 0 everywhere. Nothing else. The observer's eye sits
 * 100 m above it (read it as a 100 m tower on a featureless plain).
 *
 * This scene exists to isolate ONE thing: does the pipeline apply curvature and
 * refraction correctly? There is no terrain relief to hide behind. If curvature
 * is dropped entirely, a flat plane has no skyline at all and the computed
 * horizon runs to 0.000° or to −h/s for whatever the last sample happens to be;
 * if refraction is dropped (k = 0 instead of 0.13), the dip comes out 7.2% too
 * steep. Both failures are unmissable against the number below.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * DERIVATION — THE ANSWER, BY HAND
 * ───────────────────────────────────────────────────────────────────────────
 * THIS SCENE ASSUMES R = 6 371 008.8 m (IUGG mean radius) and k = 0.13. The
 * effective radius is never hard-coded as a decimal anywhere in the fixtures;
 * scene-geometry.ts evaluates R/(1 − k) from those two constants. The value
 * quoted below is shown only so the hand arithmetic can be followed.
 *
 *     R      = 6 371 008.8 m
 *     k      = 0.13
 *     R_eff  = R / (1 − k) = 6 371 008.8 / 0.87 = 7 322 998.6207 m
 *     h      = 100 m   (eye above the plane)
 *
 * ── Route 1: tangent-line construction (exact) ──────────────────────────────
 * The sightline that grazes the plane is tangent to the sphere of radius R_eff.
 * O = centre, P = eye, T = tangent point. Angle OTP is a right angle, so
 *
 *     cos(dip) = R_eff / (R_eff + h)
 *              = 7 322 998.6207 / 7 323 098.6207
 *              = 1 − 100/7 323 098.6207
 *              = 1 − 1.3655466e-5
 *
 *     dip = arccos(1 − 1.3655466e-5)
 *
 * Using arccos(1 − x) = √(2x)·(1 + x/12 + …):
 *
 *     √(2x) = √(2.7310932e-5) = 5.2259862e-3 rad
 *     ×(1 + x/12) = 5.2259862e-3 × (1 + 1.138e-6) = 5.2259922e-3 rad
 *     × 180/π     = 5.2259922e-3 × 57.29577951 = 0.2994268°
 *
 *     ⇒  altitudeDeg = −0.299427°     (rounded to 6 dp: −0.2994268)
 *
 * ── Route 2: maximise the drop model over range (independent) ───────────────
 * Under the curvature-drop approximation the angle to a point of the plane at
 * ground distance s is
 *
 *     α(s) = atan( (0 − h − s²/(2R_eff)) / s )  ≈  −h/s − s/(2R_eff)
 *
 * Both terms are negative; α is greatest (least negative) where dα/ds = 0:
 *
 *     h/s² − 1/(2R_eff) = 0     ⇒     s_opt = √(2 R_eff h)
 *                                          = √(2 × 7 322 998.6207 × 100)
 *                                          = √(1 464 599 724.14)
 *                                          = 38 270.09 m
 *
 *     α(s_opt) = −h/s_opt − s_opt / (2R_eff) = −2 √(h/(2R_eff)) = −√(2h/R_eff)
 *           = −√(200 / 7 322 998.6207)
 *           = −√(2.7311211e-5)
 *           = −5.2260135e-3 rad
 *           = −0.2994286°
 *
 * Two constructions that share no algebra agree to 1.8e-6°. That is the
 * cross-check: neither number was produced by running pipeline code, and the
 * residual is 5 500× smaller than archive/v2-docs-20260929/PLAN.md's 0.01° tolerance.
 *
 * ── Horizon distance ────────────────────────────────────────────────────────
 *     small-angle:  s* = √(2 R_eff h)  = 38 270.09 m
 *     exact arc:    s  = R_eff · dip   = 7 322 998.6207 × 5.2259922e-3
 *                                      = 38 269.87 m
 * Both round to 38.27 km, matching the standard surveying rule of thumb
 * d(km) = 3.827·√h(m) = 3.827 × 10 = 38.27 km for k = 0.13.
 *
 * ── Why discretisation cannot spoil this ────────────────────────────────────
 * α is stationary at s_opt, so sampling error is second order:
 *
 *     α''(s) = −2h/s³ = −2×100 / (38 270.09)³ = −3.567e-12 rad·m⁻²
 *
 * A sample landing Δ = 500 m off the optimum loses only
 *
 *     ½ |α''| Δ² = ½ × 3.567e-12 × 250 000 = 4.46e-7 rad = 2.6e-5 °
 *
 * so even a 1 km sampling step reproduces the dip to 1e-5°. The 250 m step
 * used here is far finer than it needs to be.
 *
 * ── Bearing independence ────────────────────────────────────────────────────
 * The terrain is invariant under rotation about the observer, so the skyline is
 * the SAME at every bearing. Any bearing-dependence the pipeline produces is a
 * bug in its ray sweep or its profile interpolation, not a property of this
 * scene. Expectations are therefore listed at four widely separated bearings
 * including 0°, which also exercises the 0°/360° wrap of P1.3.
 */

import type { ElevationSample, LatLng, Observer, Peak } from '../../src/core/types';
import {
  apparentAltitudeDeg,
  apparentAltitudeDegPlaneDrop,
  horizonArcDistanceM,
  horizonDipDeg,
  horizonDipSmallAngleDeg,
  horizonDistanceSmallAngleM,
} from './scene-geometry';
import {
  eyeElevationM,
  generateRadialSamples,
  type ExpectedPeakVerdict,
  type ExpectedSkylinePoint,
  type SceneSampling,
  type SyntheticScene,
} from './scene';

/** Constant height of the plane, above sea level. */
export const PLANE_ELEVATION_M = 0;

/** Height of the eye above the plane. */
export const EYE_HEIGHT_M = 100;

const OBSERVER: Observer = {
  // Mid-latitude, off any special meridian, so no coordinate arithmetic gets
  // an accidental free pass from a zero. Far from the poles and the
  // antimeridian: those edge cases belong to P1.1's own unit tests.
  lat: 47,
  lon: 11,
  groundElevationM: PLANE_ELEVATION_M,
  eyeHeightM: EYE_HEIGHT_M,
};

const SAMPLING: SceneSampling = {
  bearingStepDeg: 1,
  // 250 m divides the 38 270 m optimum to within 20 m, and the second-order
  // argument above says that costs < 1e-5°.
  rangeStepM: 250,
  // Comfortably past the 38.27 km horizon, so the pipeline has to *find* the
  // maximum rather than run out of data at it.
  maxRangeM: 60_000,
};

const EYE_ELEVATION_M = eyeElevationM(OBSERVER); // = 100 m above sea level

/** Closed-form dip, exact tangent construction. Negative = below horizontal. */
export const EXPECTED_DIP_DEG = horizonDipDeg(EYE_HEIGHT_M);

/** Closed-form dip via the independent drop-model optimum. */
export const EXPECTED_DIP_SMALL_ANGLE_DEG = horizonDipSmallAngleDeg(EYE_HEIGHT_M);

/** Ground distance to the skyline, exact arc on the effective sphere. */
export const EXPECTED_HORIZON_DISTANCE_M = horizonArcDistanceM(EYE_HEIGHT_M);

/** Ground distance to the skyline, small-angle form √(2 R_eff h). */
export const EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M =
  horizonDistanceSmallAngleM(EYE_HEIGHT_M);

function elevationAtM(_point: LatLng): number {
  // A plane is a plane. The parameter is kept for interface conformance.
  return PLANE_ELEVATION_M;
}

const EXPECTED_BEARINGS_DEG = [0, 90, 187.5, 315] as const;

const expectedSkyline: readonly ExpectedSkylinePoint[] = EXPECTED_BEARINGS_DEG.map(
  (bearingDeg): ExpectedSkylinePoint => ({
    bearingDeg,
    altitudeDeg: EXPECTED_DIP_DEG,
    // Recomputed through the drop route at the optimum range, so the two model
    // variants are both visible in the fixture rather than assumed equal.
    altitudeDegPlaneDrop: apparentAltitudeDegPlaneDrop(
      EYE_ELEVATION_M,
      PLANE_ELEVATION_M,
      EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M,
    ),
    distanceM: EXPECTED_HORIZON_DISTANCE_M,
    elevationM: PLANE_ELEVATION_M,
    note:
      'Geometric horizon of a featureless plane: arccos(R_eff/(R_eff+h)) below ' +
      'horizontal, identical at every bearing.',
  }),
);

/**
 * 187.5° is deliberately NOT a sampled ray (rays land on whole degrees), so it
 * also exercises P1.3's interpolation between profile samples. On this scene
 * interpolation is exact, because the profile is constant.
 */
export const NON_SAMPLED_EXPECTATION_BEARING_DEG = 187.5;

/**
 * No named summits: a plane has none. The empty list is itself an expectation —
 * a visibility filter fed no peaks must return no peaks, and a renderer must
 * cope with a skyline that carries no labels.
 */
const peaks: readonly Peak[] = [];
const expectedPeakVerdicts: readonly ExpectedPeakVerdict[] = [];

export const flatPlaneScene: SyntheticScene = {
  id: 'flat-plane',
  title: 'Flat plane at sea level, eye 100 m above it',
  derivation:
    'Skyline is the geometric horizon of a sphere of effective radius ' +
    'R_eff = R/(1-k) with k = 0.13. Dip = arccos(R_eff/(R_eff+h)) = 0.299427 deg ' +
    'below horizontal at 38.27 km, the same at every bearing. Cross-checked ' +
    'against the calculus optimum of the independent curvature-drop model, ' +
    'which gives 0.299429 deg.',
  observer: OBSERVER,
  sampling: SAMPLING,
  elevationAtM,
  generateSamples(): ElevationSample[] {
    return generateRadialSamples(OBSERVER, SAMPLING, elevationAtM);
  },
  expectedSkyline,
  peaks,
  expectedPeakVerdicts,
  toleranceDeg: 0.01,
  distanceToleranceM: SAMPLING.rangeStepM,
};

/**
 * Exposed for the acceptance suite's own scan of the generated samples: the
 * greatest altitude angle any generated sample subtends, computed with the
 * exact model. It must equal the closed-form dip to within the discretisation
 * bound argued above, and it is computed here by brute force over ranges —
 * a third route to the same number, using no pipeline code.
 */
export function bruteForceSkylineAltitudeDeg(): { altitudeDeg: number; distanceM: number } {
  let bestAltitudeDeg = Number.NEGATIVE_INFINITY;
  let bestDistanceM = 0;
  for (
    let distanceM = SAMPLING.rangeStepM;
    distanceM <= SAMPLING.maxRangeM;
    distanceM += SAMPLING.rangeStepM
  ) {
    const altitudeDeg = apparentAltitudeDeg(
      EYE_ELEVATION_M,
      PLANE_ELEVATION_M,
      distanceM,
    );
    if (altitudeDeg > bestAltitudeDeg) {
      bestAltitudeDeg = altitudeDeg;
      bestDistanceM = distanceM;
    }
  }
  return { altitudeDeg: bestAltitudeDeg, distanceM: bestDistanceM };
}
