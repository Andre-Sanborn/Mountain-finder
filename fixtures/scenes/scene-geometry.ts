/**
 * Independent geometry kit for the synthetic ground-truth scenes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS AND DUPLICATES src/core
 * ─────────────────────────────────────────────────────────────────────────────
 * This is deliberate duplication. Group F is the yardstick that `src/core` is
 * measured against, so nothing here may import from `src/core` except the
 * frozen *type* contract (`src/core/types.ts`). If the scenes were built with
 * the pipeline's own geodesy, a bug in that geodesy would move the terrain and
 * the "expected" answer in lockstep, and the test would pass while both were
 * wrong. Every formula below is re-derived from first principles in the
 * comments so a reviewer can check the mathematics without running anything.
 *
 * Naming follows src/core/types.ts:
 *   *M    = metres (a height or a distance)
 *   *Deg  = degrees (an angle)
 *   elevationM = height above sea level; altitudeDeg = vertical angle.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EARTH MODEL
 * ─────────────────────────────────────────────────────────────────────────────
 * A sphere of radius R, plus standard atmospheric refraction folded in by the
 * effective-radius substitution. Light bends toward the Earth by a fraction k
 * of the Earth's own curvature (k ≈ 0.13 for standard air near the surface, the
 * value archive/v2-docs-20260929/PLAN.md P1.2 fixes). Replacing curved rays over a sphere of radius R by
 * straight rays over a sphere of radius
 *
 *     R_eff = R / (1 − k)
 *
 * reproduces the same ray geometry to first order, because the *relative*
 * curvature between ray and surface is what determines what is hidden:
 *
 *     1/R_ray_relative = 1/R − k/R = (1 − k)/R  =>  R_eff = R/(1 − k)
 *
 * With R = 6 371 008.8 m (IUGG mean radius R₁) and k = 0.13:
 *
 *     R_eff = 6 371 008.8 / 0.87 = 7 322 998.6207 m
 *
 * Check: 0.87 × 7 322 998.6207 = 6 371 008.80. ✓
 *
 * A pipeline that picks R = 6 371 000 m instead differs by 1.4 ppm, which moves
 * every angle below by < 1e-6°. That is 4 orders of magnitude inside the 0.01°
 * tolerance archive/v2-docs-20260929/PLAN.md asks for, so the choice of mean radius cannot decide a test.
 */

import type { LatLng } from '../../src/core/types';

/** IUGG mean Earth radius R₁ = (2a + b)/3 for WGS-84. */
export const EARTH_MEAN_RADIUS_M = 6_371_008.8;

/** Standard refraction coefficient. archive/v2-docs-20260929/PLAN.md P1.2 fixes k = 0.13. */
export const REFRACTION_COEFFICIENT_K = 0.13;

/** R_eff = R / (1 − k) = 7 322 998.6207 m. See header derivation. */
export const EFFECTIVE_EARTH_RADIUS_M =
  EARTH_MEAN_RADIUS_M / (1 - REFRACTION_COEFFICIENT_K);

const DEG = Math.PI / 180;

function toDeg(radians: number): number {
  return radians / DEG;
}

/**
 * Great-circle distance on the sphere of radius R, via the haversine form.
 *
 *   hav(θ) = sin²(θ/2)
 *   hav(Δσ) = hav(Δφ) + cos φ₁ · cos φ₂ · hav(Δλ)
 *   Δσ      = 2 · asin( √hav(Δσ) )
 *   s       = R · Δσ
 *
 * The haversine (rather than the spherical law of cosines) is used because it
 * stays well-conditioned for the short baselines the twin-ridge scene uses.
 * Distances here are measured on the *datum sphere*, i.e. at radius R, which is
 * what "ground distance" means everywhere in this repository.
 */
export function greatCircleDistanceM(a: LatLng, b: LatLng): number {
  const phi1 = a.lat * DEG;
  const phi2 = b.lat * DEG;
  const dPhi = (b.lat - a.lat) * DEG;
  const dLambda = (b.lon - a.lon) * DEG;

  const h =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;

  return 2 * EARTH_MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Initial great-circle bearing from `a` to `b`, degrees clockwise from true
 * north, normalised to [0, 360).
 *
 * From the spherical triangle (north pole, a, b):
 *
 *   θ = atan2( sin Δλ · cos φ₂ ,
 *              cos φ₁ · sin φ₂ − sin φ₁ · cos φ₂ · cos Δλ )
 *
 * "Initial" matters: on a great circle the bearing changes along the path, and
 * what a camera at `a` sees is the bearing AT `a`. Used only to cross-check the
 * real-world ground-truth cases; the synthetic scenes place their own terrain.
 */
export function initialBearingDeg(a: LatLng, b: LatLng): number {
  const phi1 = a.lat * DEG;
  const phi2 = b.lat * DEG;
  const dLambda = (b.lon - a.lon) * DEG;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Direct geodetic problem on a sphere: where do you arrive travelling
 * `distanceM` along the great circle leaving `origin` on `bearingDeg`?
 *
 * With angular distance δ = s/R and initial bearing θ, spherical trigonometry
 * on the triangle (north pole, origin, destination) gives
 *
 *   sin φ₂ = sin φ₁ · cos δ + cos φ₁ · sin δ · cos θ
 *   Δλ     = atan2( sin θ · sin δ · cos φ₁ ,  cos δ − sin φ₁ · sin φ₂ )
 *
 * Longitude is normalised back into (−180, 180].
 *
 * Exact analytic checks this must satisfy (asserted in the acceptance suite):
 *   • From (0,0) heading 000° for R·(π/180) m  → (1°, 0°)
 *   • From (0,0) heading 090° for R·(π/180) m  → (0°, 1°)
 *   • From (0,0) heading 000° for R·(π/2) m    → the north pole (90°, ·)
 */
export function destinationPoint(
  origin: LatLng,
  bearingDeg: number,
  distanceM: number,
): LatLng {
  const delta = distanceM / EARTH_MEAN_RADIUS_M;
  const theta = bearingDeg * DEG;
  const phi1 = origin.lat * DEG;
  const lambda1 = origin.lon * DEG;

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) +
    Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(Math.min(1, Math.max(-1, sinPhi2)));

  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );

  const lonDeg = ((toDeg(lambda2) + 540) % 360) - 180;
  return { lat: toDeg(phi2), lon: lonDeg };
}

/**
 * Apparent altitude angle of a terrain point, EXACT for the effective-radius
 * sphere model. This is the canonical expectation used by the scenes.
 *
 * Put the observer's eye at radius r₁ = R_eff + H_o and the target at
 * r₂ = R_eff + E, separated by central angle γ = d / R_eff (d = ground distance
 * measured on the datum sphere). Work in the plane of the great circle, with
 * the observer on the polar axis:
 *
 *   observer  P₁ = (0,   r₁)
 *   target    P₂ = (r₂ sin γ,  r₂ cos γ)
 *
 * The observer's local horizontal is perpendicular to P₁, i.e. the x-axis, and
 * "up" is +y. The vector from observer to target is
 *
 *   P₂ − P₁ = ( r₂ sin γ ,  r₂ cos γ − r₁ )
 *
 * so the angle above the local horizontal is exactly
 *
 *   altitudeDeg = atan2( r₂ cos γ − r₁ , r₂ sin γ )
 *
 * No small-angle assumption anywhere. Positive = above horizontal.
 */
export function apparentAltitudeDeg(
  observerEyeElevationM: number,
  targetElevationM: number,
  groundDistanceM: number,
): number {
  const r1 = EFFECTIVE_EARTH_RADIUS_M + observerEyeElevationM;
  const r2 = EFFECTIVE_EARTH_RADIUS_M + targetElevationM;
  const gamma = groundDistanceM / EFFECTIVE_EARTH_RADIUS_M;
  return toDeg(
    Math.atan2(r2 * Math.cos(gamma) - r1, r2 * Math.sin(gamma)),
  );
}

/**
 * The same angle under the textbook "curvature drop" approximation, which is
 * what most surveying references (and most implementations) actually use:
 *
 *   c = d² / (2 R_eff)                 the drop of the sphere below the
 *                                      observer's horizontal plane at range d
 *   altitudeDeg = atan( (E − H_o − c) / d )
 *
 * Derivation of c: the sagitta of a circle of radius R over a chord subtending
 * γ = d/R is R(1 − cos γ) = R·γ²/2 + O(γ⁴) = d²/(2R).
 *
 * Kept as a SECOND, INDEPENDENT derivation. The two functions come from
 * different starting points, so agreement between them is a genuine check
 * rather than a tautology. Across every scene in this directory they agree to
 * better than 0.002°, which is 5× inside archive/v2-docs-20260929/PLAN.md's 0.01° tolerance — i.e.
 * whichever form src/core chooses, these fixtures do not care.
 */
export function apparentAltitudeDegPlaneDrop(
  observerEyeElevationM: number,
  targetElevationM: number,
  groundDistanceM: number,
): number {
  const drop = (groundDistanceM * groundDistanceM) / (2 * EFFECTIVE_EARTH_RADIUS_M);
  return toDeg(
    Math.atan(
      (targetElevationM - observerEyeElevationM - drop) / groundDistanceM,
    ),
  );
}

/**
 * Dip of the sea-level-style horizon below the local horizontal, for an eye
 * `heightM` above an unobstructed surface of constant elevation.
 *
 * The sightline that grazes the surface is tangent to the sphere of radius
 * R_eff at the tangent point T. The triangle (centre O, eye P, tangent T) has a
 * right angle at T, so with |OP| = R_eff + h and |OT| = R_eff:
 *
 *   cos(dip) = R_eff / (R_eff + h)      =>   dip = arccos( R_eff / (R_eff + h) )
 *
 * Returned NEGATIVE, because a dip is a downward angle and altitudeDeg is
 * positive-up (src/core/types.ts).
 */
export function horizonDipDeg(heightM: number): number {
  return -toDeg(
    Math.acos(EFFECTIVE_EARTH_RADIUS_M / (EFFECTIVE_EARTH_RADIUS_M + heightM)),
  );
}

/**
 * Ground distance (arc on the effective sphere) from the observer to that
 * tangent point:  s = R_eff · dip.
 */
export function horizonArcDistanceM(heightM: number): number {
  return (
    EFFECTIVE_EARTH_RADIUS_M *
    Math.acos(EFFECTIVE_EARTH_RADIUS_M / (EFFECTIVE_EARTH_RADIUS_M + heightM))
  );
}

/**
 * The small-angle horizon distance, √(2 R_eff h), reached from a completely
 * different direction: maximise the plane-drop altitude over range.
 *
 *   α(s) ≈ (0 − h)/s − s/(2 R_eff)          (target at the surface, eye at h)
 *   dα/ds = h/s² − 1/(2 R_eff) = 0          =>  s_opt = √(2 R_eff h)
 *   α(s_opt) = −h/s_opt − s_opt / (2 R_eff) = −√(2h/R_eff)
 *
 * So the calculus optimum of the drop model and the tangent-line construction
 * agree — two independent routes to the same dip. For h = 100 m they differ by
 * 1.7e-6°.
 */
export function horizonDistanceSmallAngleM(heightM: number): number {
  return Math.sqrt(2 * EFFECTIVE_EARTH_RADIUS_M * heightM);
}

/** The dip that pairs with {@link horizonDistanceSmallAngleM}: −√(2h/R_eff). */
export function horizonDipSmallAngleDeg(heightM: number): number {
  return -toDeg(Math.sqrt((2 * heightM) / EFFECTIVE_EARTH_RADIUS_M));
}
