/**
 * Magnetic declination from the World Magnetic Model 2025.
 *
 * Declination is the angle from true north to magnetic north, positive east.
 * A compass heading plus the declination at the observer's position gives a
 * true bearing, which is what every other module in `src/core` works in.
 *
 * Pure: the coefficients are a committed table, and the date is an argument.
 * Nothing here reads a clock, a sensor or the network — see src/core/README.md.
 *
 * WHAT THIS IS NOT. The model describes the main field generated in the core
 * plus the long-wavelength crustal field. It does not describe local magnetic
 * anomalies, which reach a few degrees over iron-rich rock, nor the daily and
 * storm-driven variations in the ionosphere. NOAA quotes the model's own
 * declination error as roughly 0.5° RMS at sea level, growing near the
 * magnetic poles where the horizontal field is weak and D is ill-conditioned.
 * Treat a declination from here as good to about a degree, not to a minute.
 *
 * THE ALGORITHM, following the WMM2025 technical report (Chulliat et al.,
 * NOAA/NCEI and BGS) and NOAA's reference implementation `geomag70`:
 *
 *  1. Advance each Gauss coefficient linearly from the epoch:
 *         g(n,m,t) = g(n,m,t0) + (t − t0)·ġ(n,m)
 *
 *  2. Convert geodetic (φ, λ, h above the WGS-84 ellipsoid) to geocentric
 *     spherical (φ′, λ, r). The two latitudes differ by up to 0.19°, and that
 *     difference rotates the field vector in step 5.
 *
 *  3. Evaluate Schmidt semi-normalised associated Legendre functions
 *     P̃(n,m)(sin φ′) and their derivatives with respect to latitude, by the
 *     Gauss-normalised recursion followed by a normalisation ratio.
 *
 *  4. Sum the field in geocentric spherical components, with a = 6371.2 km the
 *     model's geomagnetic reference radius:
 *
 *         X′ = −Σ (a/r)^(n+2) Σ [g cos mλ + h sin mλ] ∂P̃/∂φ′
 *         Y′ =  (1/cos φ′) Σ (a/r)^(n+2) Σ m [g sin mλ − h cos mλ] P̃
 *         Z′ = −Σ (n+1)(a/r)^(n+2) Σ [g cos mλ + h sin mλ] P̃
 *
 *  5. Rotate from geocentric to geodetic components through
 *     ψ = φ′ − φ:
 *
 *         X = X′ cos ψ − Z′ sin ψ,   Y = Y′,   Z = X′ sin ψ + Z′ cos ψ
 *
 *  6. Read off the elements: H = √(X²+Y²), F = √(H²+Z²),
 *     D = atan2(Y, X), I = atan2(Z, H).
 *
 * Step 4's Y′ divides by cos φ′, which vanishes at the geographic poles. Every
 * m ≥ 1 term of P̃ carries a factor cos^m φ′, so the quotient is finite there
 * and only the expression is singular. `polarEastwardComponent` evaluates the
 * limit directly with the recursion NOAA uses for the same case.
 */

import { normaliseBearingDeg, normaliseLongitudeDeg, toDegrees, toRadians } from './geodesy';
import {
  WMM2025_EPOCH,
  WMM2025_G,
  WMM2025_G_DOT,
  WMM2025_H,
  WMM2025_H_DOT,
  WMM2025_NAME,
  WMM2025_N_MAX,
  WMM2025_VALID_FROM,
  WMM2025_VALID_UNTIL,
  wmmCoefficient,
} from './wmm2025-coefficients';

/**
 * Geomagnetic reference radius of the model, in kilometres. This is not an
 * Earth radius to be swapped for the one in geodesy.ts: it is the constant the
 * Gauss coefficients were fitted against, and changing it changes the field.
 */
const GEOMAGNETIC_REFERENCE_RADIUS_KM = 6371.2;

/** WGS-84 semi-major axis, in kilometres. */
const WGS84_SEMI_MAJOR_AXIS_KM = 6378.137;

/**
 * WGS-84 first eccentricity squared, e² = f(2 − f) with 1/f = 298.257223563.
 * Derived rather than pasted so the two constants cannot drift apart.
 */
const WGS84_ECCENTRICITY_SQUARED = (() => {
  const flattening = 1 / 298.257223563;
  return flattening * (2 - flattening);
})();

/**
 * Below this |cos φ′| the eastward sum is taken to its polar limit. NOAA's
 * reference code uses the same threshold; it is far enough from the pole that
 * the quotient is still well-conditioned in double precision, and near enough
 * that the limit and the quotient agree to well under a nanotesla.
 */
const POLAR_COS_LATITUDE_THRESHOLD = 1e-10;

/** A position for the field model: degrees, plus height above the ellipsoid. */
export interface GeomagneticSite {
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  /**
   * Height above the WGS-84 ellipsoid, in metres. Elevations elsewhere in this
   * project are in metres and are treated as ellipsoidal heights; the geoid
   * separation reaches ~100 m, which moves declination by far less than the
   * model's own 0.5° uncertainty.
   */
  readonly heightM: number;
}

/** The magnetic field at a place and time, in the local geodetic frame. */
export interface GeomagneticField {
  /** Declination: true north to magnetic north, degrees, positive east. */
  readonly declinationDeg: number;
  /** Inclination (dip): degrees below horizontal, positive down. */
  readonly inclinationDeg: number;
  /** Northward component X, nT. */
  readonly northNt: number;
  /** Eastward component Y, nT. */
  readonly eastNt: number;
  /** Downward component Z, nT. */
  readonly downNt: number;
  /** Horizontal intensity H = √(X² + Y²), nT. */
  readonly horizontalNt: number;
  /** Total intensity F = √(H² + Z²), nT. */
  readonly totalNt: number;
  /** The decimal year the field was evaluated at. */
  readonly decimalYear: number;
  /** False when the date falls outside the model's five-year fit window. */
  readonly withinModelValidity: boolean;
}

export { WMM2025_EPOCH, WMM2025_NAME, WMM2025_VALID_FROM, WMM2025_VALID_UNTIL };

/**
 * Decimal year for a UTC instant, by NOAA's convention: the fraction is
 * (dayOfYear − 1) / daysInYear, so 1 January 00:00 is exactly the year and the
 * time of day is ignored. The model's secular variation is linear in years, so
 * sub-day precision would be spurious.
 *
 * UTC fields are read deliberately. A local-time reading would make the same
 * instant a different decimal year depending on where the code runs.
 */
export function toDecimalYear(date: Date): number {
  const year = date.getUTCFullYear();
  const startOfYear = Date.UTC(year, 0, 1);
  const startOfNextYear = Date.UTC(year + 1, 0, 1);
  const millisecondsPerDay = 86_400_000;
  const dayOfYear = Math.floor((Date.UTC(
    year,
    date.getUTCMonth(),
    date.getUTCDate(),
  ) - startOfYear) / millisecondsPerDay);
  const daysInYear = (startOfNextYear - startOfYear) / millisecondsPerDay;
  return year + dayOfYear / daysInYear;
}

/** Accept either a decimal year or a Date, and normalise to a decimal year. */
function resolveDecimalYear(when: number | Date): number {
  return typeof when === 'number' ? when : toDecimalYear(when);
}

interface GeocentricSite {
  /** Geocentric latitude, degrees. */
  readonly latitudeDeg: number;
  /** Radius from the Earth's centre, kilometres. */
  readonly radiusKm: number;
}

/**
 * Geodetic latitude and ellipsoidal height to geocentric latitude and radius.
 *
 *   Rc = a / √(1 − e² sin²φ)          prime vertical radius of curvature
 *   p  = (Rc + h) cos φ               distance from the spin axis
 *   z  = (Rc(1 − e²) + h) sin φ       distance from the equatorial plane
 */
function toGeocentric(latitudeDeg: number, heightKm: number): GeocentricSite {
  const latitude = toRadians(latitudeDeg);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);

  const curvatureRadius =
    WGS84_SEMI_MAJOR_AXIS_KM /
    Math.sqrt(1 - WGS84_ECCENTRICITY_SQUARED * sinLatitude * sinLatitude);
  const axialDistance = (curvatureRadius + heightKm) * cosLatitude;
  const equatorialOffset =
    (curvatureRadius * (1 - WGS84_ECCENTRICITY_SQUARED) + heightKm) * sinLatitude;

  const radiusKm = Math.hypot(axialDistance, equatorialOffset);
  return { latitudeDeg: toDegrees(Math.asin(equatorialOffset / radiusKm)), radiusKm };
}

/** Packed index shared with the coefficient tables: n·(n+1)/2 + m − 1. */
function packedIndex(n: number, m: number): number {
  return (n * (n + 1)) / 2 + m - 1;
}

/** Read a value the recursion has already written, or fail loudly. */
function at(values: readonly number[], index: number): number {
  const value = values[index];
  if (value === undefined) throw new Error(`Legendre table missing index ${index}`);
  return value;
}

interface LegendreTable {
  /** Schmidt semi-normalised P̃(n,m)(sin φ′), packed. */
  readonly p: readonly number[];
  /** ∂P̃(n,m)/∂φ′ with respect to latitude, packed. */
  readonly dp: readonly number[];
}

/**
 * Schmidt semi-normalised associated Legendre functions and their latitude
 * derivatives, for x = sin φ′.
 *
 * Computed as NOAA's reference code does it: run the Gauss-normalised
 * recursion, which has no factorials and no cancellation, then multiply by the
 * ratio between the two normalisations. The recursion needs the n = 0 term, so
 * index 0 of the local arrays is P(0,0) = 1 and the packing here is
 * n·(n+1)/2 + m — one slot wider than the coefficient tables.
 *
 * The final sign flip on the derivative converts d/dθ (colatitude, which the
 * recursion produces) to d/dφ′ (latitude, which the field sums want).
 */
function legendre(x: number, nMax: number): LegendreTable {
  const size = ((nMax + 1) * (nMax + 2)) / 2;
  const p = new Array<number>(size).fill(0);
  const dp = new Array<number>(size).fill(0);
  const ratio = new Array<number>(size).fill(0);

  // z = cos φ′, written as √((1−x)(1+x)) to stay accurate as |x| → 1.
  const z = Math.sqrt((1 - x) * (1 + x));
  p[0] = 1;
  dp[0] = 0;

  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const index = (n * (n + 1)) / 2 + m;
      if (n === m) {
        // Sectoral: P(n,n) = cos φ′ · P(n−1,n−1).
        const previous = ((n - 1) * n) / 2 + m - 1;
        p[index] = z * at(p, previous);
        dp[index] = z * at(dp, previous) + x * at(p, previous);
      } else if (m > n - 2) {
        // One step below the diagonal: the (n−2) term does not exist.
        const previous = ((n - 1) * n) / 2 + m;
        p[index] = x * at(p, previous);
        dp[index] = x * at(dp, previous) - z * at(p, previous);
      } else {
        const twoBack = ((n - 2) * (n - 1)) / 2 + m;
        const oneBack = ((n - 1) * n) / 2 + m;
        const k = ((n - 1) * (n - 1) - m * m) / ((2 * n - 1) * (2 * n - 3));
        p[index] = x * at(p, oneBack) - k * at(p, twoBack);
        dp[index] = x * at(dp, oneBack) - z * at(p, oneBack) - k * at(dp, twoBack);
      }
    }
  }

  // Gauss-normalised → Schmidt semi-normalised ratio, built by the same walk.
  ratio[0] = 1;
  for (let n = 1; n <= nMax; n += 1) {
    const zonal = (n * (n + 1)) / 2;
    ratio[zonal] = (at(ratio, ((n - 1) * n) / 2) * (2 * n - 1)) / n;
    for (let m = 1; m <= n; m += 1) {
      const index = (n * (n + 1)) / 2 + m;
      const previous = (n * (n + 1)) / 2 + m - 1;
      ratio[index] =
        at(ratio, previous) * Math.sqrt(((n - m + 1) * (m === 1 ? 2 : 1)) / (n + m));
    }
  }

  for (let index = 0; index < size; index += 1) {
    p[index] = at(p, index) * at(ratio, index);
    dp[index] = -at(dp, index) * at(ratio, index);
  }

  return { p, dp };
}

/**
 * The eastward sum at |φ′| = 90°, where Y′'s 1/cos φ′ is a removable
 * singularity.
 *
 * Only m = 1 survives: P̃(n,m)/cos φ′ carries cos^(m−1) φ′, which vanishes at
 * the pole for every m ≥ 2, and the m = 0 terms are killed by their own factor
 * of m. What is left is a two-term recursion in n on the limit of
 * P̃(n,1)/cos φ′, times the Schmidt ratio for (n, 1).
 */
function polarEastwardComponent(
  sinLatitude: number,
  radiusPowers: readonly number[],
  cosLongitude: number,
  sinLongitude: number,
  g: readonly number[],
  h: readonly number[],
  nMax: number,
): number {
  let east = 0;
  // limit[n] is lim P(n,1)/cos φ′ in the Gauss normalisation; limit[0] = 1.
  const limit = new Array<number>(nMax + 1).fill(0);
  limit[0] = 1;
  let zonalRatio = 1;

  for (let n = 1; n <= nMax; n += 1) {
    const nextZonalRatio = (zonalRatio * (2 * n - 1)) / n;
    const sectoralRatio = nextZonalRatio * Math.sqrt((2 * n) / (n + 1));
    zonalRatio = nextZonalRatio;

    if (n === 1) {
      limit[n] = at(limit, 0);
    } else {
      const k = ((n - 1) * (n - 1) - 1) / ((2 * n - 1) * (2 * n - 3));
      limit[n] = sinLatitude * at(limit, n - 1) - k * at(limit, n - 2);
    }

    east +=
      at(radiusPowers, n) *
      (wmmCoefficient(g, n, 1) * sinLongitude - wmmCoefficient(h, n, 1) * cosLongitude) *
      at(limit, n) *
      sectoralRatio;
  }

  return east;
}

/**
 * The full field at a site and time. `when` is a decimal year or a Date; the
 * date is never read from a clock here.
 */
export function geomagneticField(site: GeomagneticSite, when: number | Date): GeomagneticField {
  const decimalYear = resolveDecimalYear(when);
  const yearsFromEpoch = decimalYear - WMM2025_EPOCH;
  const nMax = WMM2025_N_MAX;

  // Time-adjusted coefficients, in the same packing as the tables.
  const g = WMM2025_G.map((value, i) => value + yearsFromEpoch * at(WMM2025_G_DOT, i));
  const h = WMM2025_H.map((value, i) => value + yearsFromEpoch * at(WMM2025_H_DOT, i));

  const longitudeDeg = normaliseLongitudeDeg(site.longitudeDeg);
  const geocentric = toGeocentric(site.latitudeDeg, site.heightM / 1000);
  const geocentricLatitude = toRadians(geocentric.latitudeDeg);
  const sinGeocentricLatitude = Math.sin(geocentricLatitude);
  const cosGeocentricLatitude = Math.cos(geocentricLatitude);

  // radiusPowers[n] = (a/r)^(n+2), built up rather than exponentiated 12 times.
  const radiusRatio = GEOMAGNETIC_REFERENCE_RADIUS_KM / geocentric.radiusKm;
  const radiusPowers = new Array<number>(nMax + 1).fill(0);
  radiusPowers[0] = radiusRatio * radiusRatio;
  for (let n = 1; n <= nMax; n += 1) {
    radiusPowers[n] = at(radiusPowers, n - 1) * radiusRatio;
  }

  const longitude = toRadians(longitudeDeg);
  const cosMLongitude = new Array<number>(nMax + 1).fill(0);
  const sinMLongitude = new Array<number>(nMax + 1).fill(0);
  for (let m = 0; m <= nMax; m += 1) {
    cosMLongitude[m] = Math.cos(m * longitude);
    sinMLongitude[m] = Math.sin(m * longitude);
  }

  const { p, dp } = legendre(sinGeocentricLatitude, nMax);

  let north = 0;
  let east = 0;
  let down = 0;
  for (let n = 1; n <= nMax; n += 1) {
    for (let m = 0; m <= n; m += 1) {
      const legendreIndex = (n * (n + 1)) / 2 + m;
      const coefficientIndex = packedIndex(n, m);
      const gnm = at(g, coefficientIndex);
      const hnm = at(h, coefficientIndex);
      const cosPart = gnm * at(cosMLongitude, m) + hnm * at(sinMLongitude, m);
      const sinPart = gnm * at(sinMLongitude, m) - hnm * at(cosMLongitude, m);
      const power = at(radiusPowers, n);

      north -= power * cosPart * at(dp, legendreIndex);
      east += power * sinPart * m * at(p, legendreIndex);
      down -= power * cosPart * (n + 1) * at(p, legendreIndex);
    }
  }

  const eastSpherical =
    Math.abs(cosGeocentricLatitude) > POLAR_COS_LATITUDE_THRESHOLD
      ? east / cosGeocentricLatitude
      : polarEastwardComponent(
          sinGeocentricLatitude,
          radiusPowers,
          at(cosMLongitude, 1),
          at(sinMLongitude, 1),
          g,
          h,
          nMax,
        );

  // Rotate the geocentric components into the local geodetic frame.
  const psi = toRadians(geocentric.latitudeDeg - site.latitudeDeg);
  const cosPsi = Math.cos(psi);
  const sinPsi = Math.sin(psi);
  const northGeodetic = north * cosPsi - down * sinPsi;
  const downGeodetic = north * sinPsi + down * cosPsi;

  const horizontalNt = Math.hypot(northGeodetic, eastSpherical);
  return {
    declinationDeg: toDegrees(Math.atan2(eastSpherical, northGeodetic)),
    inclinationDeg: toDegrees(Math.atan2(downGeodetic, horizontalNt)),
    northNt: northGeodetic,
    eastNt: eastSpherical,
    downNt: downGeodetic,
    horizontalNt,
    totalNt: Math.hypot(horizontalNt, downGeodetic),
    decimalYear,
    withinModelValidity:
      decimalYear >= WMM2025_VALID_FROM && decimalYear <= WMM2025_VALID_UNTIL,
  };
}

/**
 * Declination in degrees, positive east, in (−180, +180].
 *
 * The sign convention matters and is easy to get backwards: declination is
 * added to a magnetic bearing to get a true bearing.
 */
export function magneticDeclinationDeg(site: GeomagneticSite, when: number | Date): number {
  return geomagneticField(site, when).declinationDeg;
}

/**
 * True bearing from a magnetic-compass bearing, folded onto [0, 360).
 *
 *     true = magnetic + declination
 */
export function trueBearingFromMagneticDeg(
  magneticBearingDeg: number,
  site: GeomagneticSite,
  when: number | Date,
): number {
  return normaliseBearingDeg(magneticBearingDeg + magneticDeclinationDeg(site, when));
}

/**
 * Magnetic bearing from a true bearing, folded onto [0, 360). The inverse of
 * `trueBearingFromMagneticDeg` at the same site and time.
 */
export function magneticBearingFromTrueDeg(
  trueBearingDeg: number,
  site: GeomagneticSite,
  when: number | Date,
): number {
  return normaliseBearingDeg(trueBearingDeg - magneticDeclinationDeg(site, when));
}
