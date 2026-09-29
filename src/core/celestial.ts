/**
 * Topocentric apparent positions of the Sun and the Moon.
 *
 * The purpose here is bench-testing the phone: point the camera at the Sun or
 * the Moon, and the app draws a disc where this module says it should be. Any
 * error in heading, pitch or field of view shows up as a gap between the disc
 * and the real thing. That makes this module a measuring instrument, so its
 * accuracy is stated rather than assumed.
 *
 * ALGORITHMS AND THEIR STATED ACCURACY
 *
 * Sun — Meeus, *Astronomical Algorithms* 2nd ed., chapter 25, the low-accuracy
 * method (the same series NOAA's Solar Calculator implements). Meeus states an
 * accuracy of **0.01° in the Sun's longitude**. Longitude error carries into
 * right ascension and declination roughly one-for-one, so the resulting
 * azimuth and altitude are good to about 0.01° — a factor of five inside this
 * project's 0.05° target for the Sun.
 *
 * Moon — Meeus chapter 47, the truncated ELP-2000/82 series (60 terms for
 * longitude and distance, Table 47.A; 60 for latitude, Table 47.B). Meeus
 * states **10″ (0.003°) in longitude and 4″ (0.001°) in latitude**. Distance
 * carries only into the parallax correction, where 100 km of error moves the
 * apparent direction by under 0.0003°. So the Moon is good to roughly 0.004°,
 * well inside the 0.1° target.
 *
 * Nutation — Meeus chapter 22, the abridged series (four terms), stated as
 * 0.5″ in Δψ and 0.1″ in Δε. That is 0.0002°, negligible at this scale.
 *
 * Refraction — Sæmundsson's formula (Meeus 16.4), which takes the *airless*
 * altitude, which is what this module computes. Bennett's formula (Meeus 16.3)
 * is also exported, but it takes the *apparent* altitude and so is the inverse
 * problem; the two agree to within 0.1′ per Meeus. Refraction itself is the
 * dominant uncertainty near the horizon: the real atmosphere departs from any
 * mean formula by a large fraction of an arcminute at low altitudes, which is
 * why refraction is opt-in rather than always applied.
 *
 * WHAT IS DELIBERATELY LEFT OUT
 *
 * - UTC is treated as UT1. They differ by at most 0.9 s, worth 0.5″ of lunar
 *   motion and 0.04″ of solar motion.
 * - Lunar light-time (1.26 s, about 0.7″ of motion) is not removed. Meeus's
 *   chapter 47 series is used as the apparent position after nutation only,
 *   which is what his Example 47.a does.
 * - The horizon is taken as normal to the WGS-84 ellipsoid rather than to the
 *   plumb line. The geoid deflection between them is usually under 10″.
 *
 * Time is always an input: a UTC timestamp in milliseconds, or a `Date`.
 * Nothing here reads a clock, the network, or the DOM.
 */

import { normaliseBearingDeg, toDegrees, toRadians } from './geodesy';
import type { LatLng } from './types';

/** Julian Date of the Unix epoch, 1970-01-01T00:00:00Z. */
const JD_UNIX_EPOCH = 2440587.5;

/** Julian Date of the J2000.0 epoch, 2000-01-01T12:00:00 TT. */
const JD_J2000 = 2451545.0;

const MS_PER_DAY = 86400000;
const SECONDS_PER_DAY = 86400;

/** WGS-84 equatorial radius in km. Meeus uses 6378.14 throughout chapter 40. */
const EARTH_EQUATORIAL_RADIUS_KM = 6378.14;

/** WGS-84 polar/equatorial axis ratio b/a, as Meeus writes it in chapter 11. */
const EARTH_AXIS_RATIO = 0.99664719;

/** IAU astronomical unit in km. */
const AU_KM = 149597870.7;

/**
 * The Sun's apparent semidiameter at one astronomical unit, in arcseconds
 * (Meeus, chapter 28). Scale by 1/distance_AU for any other distance.
 */
const SUN_SEMIDIAMETER_AT_1AU_ARCSEC = 959.63;

/**
 * Ratio of the Moon's radius to the Earth's equatorial radius (Meeus chapter
 * 55, `k`). The Moon's semidiameter follows from sin s = k · sin π.
 */
const MOON_RADIUS_RATIO = 0.272481;

/** Where the observer stands. Height is metres above the ellipsoid. */
export interface CelestialObserver extends LatLng {
  /**
   * Eye height above sea level, metres. For the project's {@link Observer},
   * that is `groundElevationM + eyeHeightM`. Defaults to 0.
   */
  heightM?: number;
}

/** Knobs on a position computation. All optional. */
export interface CelestialOptions {
  /**
   * Add atmospheric refraction to the altitude. Off by default, because the
   * airless altitude is the one that can be checked against an ephemeris.
   */
  refraction?: boolean;
  /** Station pressure in millibars for the refraction correction. */
  pressureMbar?: number;
  /** Station temperature in °C for the refraction correction. */
  temperatureC?: number;
  /**
   * Override ΔT = TT − UT in seconds. Tests of Meeus's worked examples pass 0,
   * because those examples are stated in dynamical time.
   */
  deltaTSeconds?: number;
}

/** Where a body appears from where the observer stands. */
export interface CelestialPosition {
  /** Azimuth in degrees from true north, clockwise, folded onto [0, 360). */
  azimuthDeg: number;
  /** Altitude above the horizon, degrees. Refracted only if asked for. */
  altitudeDeg: number;
  /** Altitude with no atmosphere, degrees. Always the airless value. */
  geometricAltitudeDeg: number;
  /** Refraction added to reach `altitudeDeg`; 0 when refraction is off. */
  refractionDeg: number;
  /** Angular radius of the visible disc, degrees. */
  angularRadiusDeg: number;
  /** Topocentric distance to the body's centre, km. */
  distanceKm: number;
  /** Topocentric apparent right ascension, degrees, [0, 360). */
  rightAscensionDeg: number;
  /** Topocentric apparent declination, degrees. */
  declinationDeg: number;
  /** Local hour angle, degrees. Negative before transit, positive after. */
  hourAngleDeg: number;
}

/** The four nutation and obliquity quantities, all in degrees. */
export interface NutationAndObliquity {
  /** Nutation in longitude, Δψ. */
  nutationLongitudeDeg: number;
  /** Nutation in obliquity, Δε. */
  nutationObliquityDeg: number;
  /** Mean obliquity of the ecliptic, ε₀. */
  meanObliquityDeg: number;
  /** True obliquity, ε = ε₀ + Δε. */
  trueObliquityDeg: number;
}

/** Geocentric apparent position of the Sun. */
export interface SunGeocentric {
  /** Apparent geocentric ecliptical longitude, degrees. */
  apparentLongitudeDeg: number;
  /** Apparent right ascension, degrees, [0, 360). */
  rightAscensionDeg: number;
  /** Apparent declination, degrees. */
  declinationDeg: number;
  /** Earth-to-Sun distance, astronomical units. */
  distanceAu: number;
  /** Obliquity used for the conversion, corrected per Meeus (25.8). */
  apparentObliquityDeg: number;
}

/** Geocentric position of the Moon. */
export interface MoonGeocentric {
  /** Geometric ecliptical longitude λ, degrees — Meeus's Σl result. */
  longitudeDeg: number;
  /** Ecliptical latitude β, degrees. */
  latitudeDeg: number;
  /** Apparent longitude, λ + Δψ, degrees. */
  apparentLongitudeDeg: number;
  /** Earth-to-Moon distance between centres, km. */
  distanceKm: number;
  /** Equatorial horizontal parallax π, degrees. */
  parallaxDeg: number;
  /** Apparent right ascension, degrees, [0, 360). */
  rightAscensionDeg: number;
  /** Apparent declination, degrees. */
  declinationDeg: number;
}

/** A direction in the equatorial frame, degrees. */
export interface EquatorialDirection {
  hourAngleDeg: number;
  declinationDeg: number;
}

/** A direction in the horizon frame, degrees. */
export interface HorizontalDirection {
  /** From true north, clockwise, [0, 360). */
  azimuthDeg: number;
  altitudeDeg: number;
}

/** Accept either a `Date` or a UTC timestamp in milliseconds. */
export type UtcTime = Date | number;

function toEpochMs(time: UtcTime): number {
  return typeof time === 'number' ? time : time.getTime();
}

/** Fold an angle onto [0, 360). Bearings and right ascensions share the rule. */
function fold360(degrees: number): number {
  return normaliseBearingDeg(degrees);
}

function sinDeg(degrees: number): number {
  return Math.sin(toRadians(degrees));
}

function cosDeg(degrees: number): number {
  return Math.cos(toRadians(degrees));
}

function tanDeg(degrees: number): number {
  return Math.tan(toRadians(degrees));
}

/** Julian Date on the UT scale for a UTC instant. */
export function julianDayFromUtc(time: UtcTime): number {
  return JD_UNIX_EPOCH + toEpochMs(time) / MS_PER_DAY;
}

/** Decimal year, used only to select a ΔT polynomial. */
function decimalYear(julianDayUt: number): number {
  return 2000 + (julianDayUt - JD_J2000) / 365.25;
}

/**
 * ΔT = TT − UT in seconds, by the Espenak–Meeus polynomial expressions
 * published on NASA GSFC's eclipse site.
 *
 * Only the 1900–2150 segments are carried, because that is the range a
 * photograph can fall in; outside it the nearest segment is used unchanged.
 * The cost of being wrong here is small: one second of ΔT moves the Moon by
 * 0.55″ and the Sun by 0.04″, so even a 60 s error stays under 0.01°.
 *
 * The 2005–2050 expression is known to run high — it gives about 75 s for 2026
 * where the observed value is near 69 s — because Earth's rotation did not slow
 * as the extrapolation assumed. That 6 s is worth 3″ of lunar motion. Pass
 * `deltaTSeconds` to override it when a better value is to hand.
 */
export function deltaTSecondsForJulianDay(julianDayUt: number): number {
  const y = decimalYear(julianDayUt);

  if (y < 1920) {
    const t = y - 1900;
    return (
      -2.79 + 1.494119 * t - 0.0598939 * t * t + 0.0061966 * t ** 3 - 0.000197 * t ** 4
    );
  }
  if (y < 1941) {
    const t = y - 1920;
    return 21.2 + 0.84493 * t - 0.0761 * t * t + 0.0020936 * t ** 3;
  }
  if (y < 1961) {
    const t = y - 1950;
    return 29.07 + 0.407 * t - (t * t) / 233 + t ** 3 / 2547;
  }
  if (y < 1986) {
    const t = y - 1975;
    return 45.45 + 1.067 * t - (t * t) / 260 - t ** 3 / 718;
  }
  if (y < 2005) {
    const t = y - 2000;
    return (
      63.86 +
      0.3345 * t -
      0.060374 * t * t +
      0.0017275 * t ** 3 +
      0.000651814 * t ** 4 +
      0.00002373599 * t ** 5
    );
  }
  if (y < 2050) {
    const t = y - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  const u = (Math.min(y, 2150) - 1820) / 100;
  return -20 + 32 * u * u - 0.5628 * (2150 - Math.min(y, 2150));
}

/** Julian Ephemeris Day (TT scale) for a UT Julian Day and a ΔT in seconds. */
export function julianEphemerisDay(julianDayUt: number, deltaTSeconds: number): number {
  return julianDayUt + deltaTSeconds / SECONDS_PER_DAY;
}

/**
 * Nutation and obliquity, Meeus chapter 22, abridged series.
 *
 * `julianEphemerisDay` is on the TT scale. Stated accuracy is 0.5″ in Δψ and
 * 0.1″ in Δε.
 */
export function nutationAndObliquity(julianEphemerisDayTt: number): NutationAndObliquity {
  const t = (julianEphemerisDayTt - JD_J2000) / 36525;

  // Mean longitudes of the Sun and Moon, and the Moon's ascending node.
  const sunLongitude = 280.4665 + 36000.7698 * t;
  const moonLongitude = 218.3165 + 481267.8813 * t;
  const node = 125.04452 - 1934.136261 * t;

  const nutationLongitudeArcsec =
    -17.2 * sinDeg(node) -
    1.32 * sinDeg(2 * sunLongitude) -
    0.23 * sinDeg(2 * moonLongitude) +
    0.21 * sinDeg(2 * node);

  const nutationObliquityArcsec =
    9.2 * cosDeg(node) +
    0.57 * cosDeg(2 * sunLongitude) +
    0.1 * cosDeg(2 * moonLongitude) -
    0.09 * cosDeg(2 * node);

  // Meeus (22.2): ε₀ = 23°26′21.448″ − 46.8150″T − 0.00059″T² + 0.001813″T³.
  const meanObliquityDeg =
    23 +
    26 / 60 +
    21.448 / 3600 +
    (-46.815 * t - 0.00059 * t * t + 0.001813 * t ** 3) / 3600;

  const nutationLongitudeDeg = nutationLongitudeArcsec / 3600;
  const nutationObliquityDeg = nutationObliquityArcsec / 3600;

  return {
    nutationLongitudeDeg,
    nutationObliquityDeg,
    meanObliquityDeg,
    trueObliquityDeg: meanObliquityDeg + nutationObliquityDeg,
  };
}

/**
 * Mean sidereal time at Greenwich, degrees, Meeus (12.4).
 *
 * The argument is on the UT scale, not TT: sidereal time measures Earth's
 * rotation, so substituting TT here would offset it by ΔT (about 0.29° per
 * minute of ΔT — the single easiest way to get a wrong azimuth).
 */
export function meanSiderealTimeDeg(julianDayUt: number): number {
  const d = julianDayUt - JD_J2000;
  const t = d / 36525;
  return fold360(
    280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - t ** 3 / 38710000,
  );
}

/** Apparent sidereal time at Greenwich, degrees: mean plus Δψ·cos ε. */
export function apparentSiderealTimeDeg(
  julianDayUt: number,
  deltaTSeconds: number,
): number {
  const jde = julianEphemerisDay(julianDayUt, deltaTSeconds);
  const { nutationLongitudeDeg, trueObliquityDeg } = nutationAndObliquity(jde);
  return fold360(
    meanSiderealTimeDeg(julianDayUt) +
      nutationLongitudeDeg * cosDeg(trueObliquityDeg),
  );
}

/**
 * Geocentric apparent position of the Sun, Meeus chapter 25, low accuracy.
 * Stated accuracy 0.01° in longitude. The argument is on the TT scale.
 */
export function sunGeocentric(julianEphemerisDayTt: number): SunGeocentric {
  const t = (julianEphemerisDayTt - JD_J2000) / 36525;

  const geometricMeanLongitude = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const meanAnomaly = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const eccentricity = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t;

  // Equation of the centre, C. Its sign is what makes the true longitude lead
  // or lag the mean one, so a flipped sign here is worth up to 2° of azimuth.
  const centre =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * sinDeg(meanAnomaly) +
    (0.019993 - 0.000101 * t) * sinDeg(2 * meanAnomaly) +
    0.000289 * sinDeg(3 * meanAnomaly);

  const trueLongitude = geometricMeanLongitude + centre;
  const trueAnomaly = meanAnomaly + centre;

  const distanceAu =
    (1.000001018 * (1 - eccentricity * eccentricity)) /
    (1 + eccentricity * cosDeg(trueAnomaly));

  // Meeus (25.8): nutation in longitude plus aberration, then a matching
  // correction to the obliquity for the apparent right ascension.
  const node = 125.04 - 1934.136 * t;
  const apparentLongitudeDeg = trueLongitude - 0.00569 - 0.00478 * sinDeg(node);
  const apparentObliquityDeg =
    nutationAndObliquity(julianEphemerisDayTt).meanObliquityDeg +
    0.00256 * cosDeg(node);

  return {
    apparentLongitudeDeg: fold360(apparentLongitudeDeg),
    distanceAu,
    apparentObliquityDeg,
    ...eclipticToEquatorial(apparentLongitudeDeg, 0, apparentObliquityDeg),
  };
}

/**
 * Ecliptical longitude and latitude to right ascension and declination,
 * Meeus (13.3) and (13.4). All angles in degrees.
 */
function eclipticToEquatorial(
  longitudeDeg: number,
  latitudeDeg: number,
  obliquityDeg: number,
): { rightAscensionDeg: number; declinationDeg: number } {
  const sinObliquity = sinDeg(obliquityDeg);
  const cosObliquity = cosDeg(obliquityDeg);
  const sinLongitude = sinDeg(longitudeDeg);

  const rightAscensionDeg = fold360(
    toDegrees(
      Math.atan2(
        sinLongitude * cosObliquity - tanDeg(latitudeDeg) * sinObliquity,
        cosDeg(longitudeDeg),
      ),
    ),
  );
  const declinationDeg = toDegrees(
    Math.asin(
      sinDeg(latitudeDeg) * cosObliquity +
        cosDeg(latitudeDeg) * sinObliquity * sinLongitude,
    ),
  );

  return { rightAscensionDeg, declinationDeg };
}

/**
 * One row of Meeus Table 47.A: the multiples of D, M, M′ and F, then the
 * longitude coefficient in 10⁻⁶ degree and the distance coefficient in metres
 * (the book's 0.001 km).
 */
type MoonLongitudeTerm = readonly [number, number, number, number, number, number];

/** One row of Meeus Table 47.B: multiples of D, M, M′, F and the coefficient. */
type MoonLatitudeTerm = readonly [number, number, number, number, number];

/** Meeus, *Astronomical Algorithms* 2nd ed., Table 47.A (pages 339–340). */
const MOON_LONGITUDE_TERMS: readonly MoonLongitudeTerm[] = [
  [0, 0, 1, 0, 6288774, -20905355],
  [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968],
  [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888],
  [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158],
  [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733],
  [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620],
  [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755],
  [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0],
  [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782],
  [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636],
  [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824],
  [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675],
  [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445],
  [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403],
  [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0],
  [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322],
  [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751],
  [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950],
  [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0],
  [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0],
  [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616],
  [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117],
  [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0],
  [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423],
  [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571],
  [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0],
  [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0],
  [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0],
  [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165],
  [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0],
  [2, 0, -1, -2, 0, 8752],
];

/** Meeus, *Astronomical Algorithms* 2nd ed., Table 47.B (page 341). */
const MOON_LATITUDE_TERMS: readonly MoonLatitudeTerm[] = [
  [0, 0, 0, 1, 5128122],
  [0, 0, 1, 1, 280602],
  [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237],
  [2, 0, -1, 1, 55413],
  [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573],
  [0, 0, 2, 1, 17198],
  [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822],
  [2, -1, 0, -1, 8216],
  [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200],
  [2, 1, 0, -1, -3359],
  [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211],
  [2, -1, -1, -1, 2065],
  [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828],
  [0, 1, 0, 1, -1794],
  [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565],
  [1, 0, 0, 1, -1491],
  [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410],
  [0, 1, 0, -1, -1344],
  [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107],
  [4, 0, 0, -1, 1021],
  [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777],
  [4, 0, -2, 1, 671],
  [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596],
  [2, -1, 1, -1, 491],
  [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439],
  [2, 0, 2, 1, 422],
  [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366],
  [2, 1, 0, 1, -351],
  [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315],
  [2, -2, 0, -1, 302],
  [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229],
  [1, 1, 0, -1, 223],
  [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220],
  [2, 1, -1, -1, -220],
  [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181],
  [0, 1, 2, 1, -177],
  [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166],
  [1, 0, 1, -1, -164],
  [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119],
  [4, -1, 0, -1, 115],
  [2, -2, 0, 1, 107],
];

/**
 * Geocentric position of the Moon, Meeus chapter 47. The argument is on the TT
 * scale. Stated accuracy 10″ in longitude and 4″ in latitude.
 */
export function moonGeocentric(julianEphemerisDayTt: number): MoonGeocentric {
  const t = (julianEphemerisDayTt - JD_J2000) / 36525;

  // Meeus (47.1)–(47.5): the Moon's mean longitude and the four arguments.
  const meanLongitude =
    218.3164477 +
    481267.88123421 * t -
    0.0015786 * t * t +
    t ** 3 / 538841 -
    t ** 4 / 65194000;
  const elongation =
    297.8501921 +
    445267.1114034 * t -
    0.0018819 * t * t +
    t ** 3 / 545868 -
    t ** 4 / 113065000;
  const sunAnomaly = 357.5291092 + 35999.0502909 * t - 0.0001536 * t * t + t ** 3 / 24490000;
  const moonAnomaly =
    134.9633964 +
    477198.8675055 * t +
    0.0087414 * t * t +
    t ** 3 / 69699 -
    t ** 4 / 14712000;
  const argumentOfLatitude =
    93.272095 +
    483202.0175233 * t -
    0.0036539 * t * t -
    t ** 3 / 3526000 +
    t ** 4 / 863310000;

  const a1 = 119.75 + 131.849 * t;
  const a2 = 53.09 + 479264.29 * t;
  const a3 = 313.45 + 481266.484 * t;

  // E accounts for the decreasing eccentricity of Earth's orbit; it multiplies
  // every term whose argument involves the Sun's anomaly M, squared for |M| = 2.
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;

  let sumLongitude = 0;
  let sumDistance = 0;
  for (const [d, m, mp, f, longitudeCoefficient, distanceCoefficient] of MOON_LONGITUDE_TERMS) {
    const argument = d * elongation + m * sunAnomaly + mp * moonAnomaly + f * argumentOfLatitude;
    const eccentricityFactor = e ** Math.abs(m);
    sumLongitude += longitudeCoefficient * sinDeg(argument) * eccentricityFactor;
    sumDistance += distanceCoefficient * cosDeg(argument) * eccentricityFactor;
  }

  let sumLatitude = 0;
  for (const [d, m, mp, f, latitudeCoefficient] of MOON_LATITUDE_TERMS) {
    const argument = d * elongation + m * sunAnomaly + mp * moonAnomaly + f * argumentOfLatitude;
    sumLatitude += latitudeCoefficient * sinDeg(argument) * e ** Math.abs(m);
  }

  // Additive terms for Venus (A1), Jupiter (A2) and Earth's flattening.
  sumLongitude +=
    3958 * sinDeg(a1) + 1962 * sinDeg(meanLongitude - argumentOfLatitude) + 318 * sinDeg(a2);
  sumLatitude +=
    -2235 * sinDeg(meanLongitude) +
    382 * sinDeg(a3) +
    175 * sinDeg(a1 - argumentOfLatitude) +
    175 * sinDeg(a1 + argumentOfLatitude) +
    127 * sinDeg(meanLongitude - moonAnomaly) -
    115 * sinDeg(meanLongitude + moonAnomaly);

  const longitudeDeg = fold360(meanLongitude + sumLongitude / 1e6);
  const latitudeDeg = sumLatitude / 1e6;
  const distanceKm = 385000.56 + sumDistance / 1000;
  const parallaxDeg = toDegrees(Math.asin(EARTH_EQUATORIAL_RADIUS_KM / distanceKm));

  const { nutationLongitudeDeg, trueObliquityDeg } = nutationAndObliquity(julianEphemerisDayTt);
  const apparentLongitudeDeg = fold360(longitudeDeg + nutationLongitudeDeg);

  return {
    longitudeDeg,
    latitudeDeg,
    apparentLongitudeDeg,
    distanceKm,
    parallaxDeg,
    ...eclipticToEquatorial(apparentLongitudeDeg, latitudeDeg, trueObliquityDeg),
  };
}

/**
 * The observer's geocentric position, Meeus chapter 11: ρ·sin φ′ and ρ·cos φ′
 * in units of the Earth's equatorial radius, where φ′ is the *geocentric*
 * latitude and ρ the geocentric radius.
 *
 * The ellipsoid matters here. Geocentric and geodetic latitude differ by up to
 * 11.5′, which displaces the observer's position vector by up to 21 km and so
 * moves the Moon's topocentric direction by about 0.003°. Exported because that
 * is checkable against the closed-form ellipse identities and nothing else in
 * the module's output isolates it.
 */
export function observerGeocentricFactors(
  latitudeDeg: number,
  heightM: number,
): { rhoSin: number; rhoCos: number } {
  const u = Math.atan(EARTH_AXIS_RATIO * tanDeg(latitudeDeg));
  const heightInRadii = heightM / (EARTH_EQUATORIAL_RADIUS_KM * 1000);
  return {
    rhoSin: EARTH_AXIS_RATIO * Math.sin(u) + heightInRadii * sinDeg(latitudeDeg),
    rhoCos: Math.cos(u) + heightInRadii * cosDeg(latitudeDeg),
  };
}

/**
 * Shift a geocentric direction to the observer's own position.
 *
 * Meeus gives this as corrections Δα and Δδ (chapter 40). Here the same
 * geometry is done by subtracting the observer's geocentric vector from the
 * body's, which is exact and also yields the topocentric *distance* — needed
 * for the apparent disc size, since the Moon at the zenith is about 1.7 %
 * closer than at rise.
 */
function toTopocentric(
  rightAscensionDeg: number,
  declinationDeg: number,
  distanceKm: number,
  localSiderealTimeDeg: number,
  observer: CelestialObserver,
): { rightAscensionDeg: number; declinationDeg: number; distanceKm: number } {
  const { rhoSin, rhoCos } = observerGeocentricFactors(observer.lat, observer.heightM ?? 0);

  const bodyX = distanceKm * cosDeg(declinationDeg) * cosDeg(rightAscensionDeg);
  const bodyY = distanceKm * cosDeg(declinationDeg) * sinDeg(rightAscensionDeg);
  const bodyZ = distanceKm * sinDeg(declinationDeg);

  const observerX = EARTH_EQUATORIAL_RADIUS_KM * rhoCos * cosDeg(localSiderealTimeDeg);
  const observerY = EARTH_EQUATORIAL_RADIUS_KM * rhoCos * sinDeg(localSiderealTimeDeg);
  const observerZ = EARTH_EQUATORIAL_RADIUS_KM * rhoSin;

  const x = bodyX - observerX;
  const y = bodyY - observerY;
  const z = bodyZ - observerZ;
  const range = Math.sqrt(x * x + y * y + z * z);

  return {
    rightAscensionDeg: fold360(toDegrees(Math.atan2(y, x))),
    declinationDeg: toDegrees(Math.asin(z / range)),
    distanceKm: range,
  };
}

/**
 * Equatorial to horizon frame, Meeus (13.5) and (13.6), with the azimuth
 * turned round to this project's convention.
 *
 * Meeus measures azimuth westward from the south. Everything else in this
 * codebase measures bearings clockwise from true north, so 180° is added.
 */
export function equatorialToHorizontal(
  direction: EquatorialDirection,
  latitudeDeg: number,
): HorizontalDirection {
  const { hourAngleDeg, declinationDeg } = direction;
  const sinLatitude = sinDeg(latitudeDeg);
  const cosLatitude = cosDeg(latitudeDeg);

  const azimuthFromSouthDeg = toDegrees(
    Math.atan2(
      sinDeg(hourAngleDeg),
      cosDeg(hourAngleDeg) * sinLatitude - tanDeg(declinationDeg) * cosLatitude,
    ),
  );
  const altitudeDeg = toDegrees(
    Math.asin(
      sinLatitude * sinDeg(declinationDeg) +
        cosLatitude * cosDeg(declinationDeg) * cosDeg(hourAngleDeg),
    ),
  );

  return { azimuthDeg: fold360(azimuthFromSouthDeg + 180), altitudeDeg };
}

/**
 * Lowest airless altitude at which a mean refraction formula still means
 * anything. Both formulas turn round and rise again a few degrees below the
 * horizon, so they are not extrapolated past here.
 */
const MIN_REFRACTED_ALTITUDE_DEG = -1;

/** Meeus (16.1): scale a refraction for station pressure and temperature. */
function atmosphereFactor(pressureMbar: number, temperatureC: number): number {
  return (pressureMbar / 1010) * (283 / (273 + temperatureC));
}

/**
 * Refraction to ADD to an airless altitude, degrees — Sæmundsson's formula,
 * Meeus (16.4). This is the direction this module needs, because it computes
 * the airless altitude and then asks where the body appears.
 *
 * Returns 0 below {@link MIN_REFRACTED_ALTITUDE_DEG}, where the formula is not
 * valid.
 */
export function refractionSaemundssonDeg(
  airlessAltitudeDeg: number,
  pressureMbar = 1010,
  temperatureC = 10,
): number {
  if (airlessAltitudeDeg < MIN_REFRACTED_ALTITUDE_DEG) return 0;
  const arcminutes = 1.02 / tanDeg(airlessAltitudeDeg + 10.3 / (airlessAltitudeDeg + 5.11));
  return (arcminutes / 60) * atmosphereFactor(pressureMbar, temperatureC);
}

/**
 * Refraction to SUBTRACT from an apparent altitude, degrees — Bennett's
 * formula, Meeus (16.3). Exported because it is the inverse of
 * {@link refractionSaemundssonDeg} and so an independent check on it: Meeus
 * states the two agree to within 0.1′.
 */
export function refractionBennettDeg(
  apparentAltitudeDeg: number,
  pressureMbar = 1010,
  temperatureC = 10,
): number {
  if (apparentAltitudeDeg < MIN_REFRACTED_ALTITUDE_DEG) return 0;
  const arcminutes = 1 / tanDeg(apparentAltitudeDeg + 7.31 / (apparentAltitudeDeg + 4.4));
  return (arcminutes / 60) * atmosphereFactor(pressureMbar, temperatureC);
}

/** Assemble the common part of a result once the topocentric direction is known. */
function finishPosition(
  topocentric: { rightAscensionDeg: number; declinationDeg: number; distanceKm: number },
  localSiderealTimeDeg: number,
  observer: CelestialObserver,
  angularRadiusDeg: number,
  options: CelestialOptions,
): CelestialPosition {
  // Hour angle folded onto (−180, +180] so that the sign reads as before or
  // after transit, which is what a bench test wants to see.
  const hourAngle = fold360(localSiderealTimeDeg - topocentric.rightAscensionDeg);
  const hourAngleDeg = hourAngle > 180 ? hourAngle - 360 : hourAngle;

  const { azimuthDeg, altitudeDeg: geometricAltitudeDeg } = equatorialToHorizontal(
    { hourAngleDeg, declinationDeg: topocentric.declinationDeg },
    observer.lat,
  );

  const refractionDeg = options.refraction
    ? refractionSaemundssonDeg(
        geometricAltitudeDeg,
        options.pressureMbar ?? 1010,
        options.temperatureC ?? 10,
      )
    : 0;

  return {
    azimuthDeg,
    altitudeDeg: geometricAltitudeDeg + refractionDeg,
    geometricAltitudeDeg,
    refractionDeg,
    angularRadiusDeg,
    distanceKm: topocentric.distanceKm,
    rightAscensionDeg: topocentric.rightAscensionDeg,
    declinationDeg: topocentric.declinationDeg,
    hourAngleDeg,
  };
}

/** Local apparent sidereal time, degrees, east longitude positive. */
function localSiderealTime(
  julianDayUt: number,
  deltaTSeconds: number,
  observer: CelestialObserver,
): number {
  return fold360(apparentSiderealTimeDeg(julianDayUt, deltaTSeconds) + observer.lon);
}

function resolveDeltaT(julianDayUt: number, options: CelestialOptions): number {
  return options.deltaTSeconds ?? deltaTSecondsForJulianDay(julianDayUt);
}

/**
 * Topocentric apparent azimuth and altitude of the Sun.
 *
 * `time` is a UTC instant. Azimuth is degrees clockwise from true north.
 */
export function sunPosition(
  time: UtcTime,
  observer: CelestialObserver,
  options: CelestialOptions = {},
): CelestialPosition {
  const julianDayUt = julianDayFromUtc(time);
  const deltaT = resolveDeltaT(julianDayUt, options);
  const geocentric = sunGeocentric(julianEphemerisDay(julianDayUt, deltaT));
  const siderealTime = localSiderealTime(julianDayUt, deltaT, observer);

  const topocentric = toTopocentric(
    geocentric.rightAscensionDeg,
    geocentric.declinationDeg,
    geocentric.distanceAu * AU_KM,
    siderealTime,
    observer,
  );

  const angularRadiusDeg =
    SUN_SEMIDIAMETER_AT_1AU_ARCSEC / 3600 / (topocentric.distanceKm / AU_KM);

  return finishPosition(topocentric, siderealTime, observer, angularRadiusDeg, options);
}

/**
 * Topocentric apparent azimuth and altitude of the Moon.
 *
 * The parallax shift is not a refinement here: it reaches about 1° near the
 * horizon, more than ten times the Moon's own radius, so a geocentric position
 * would put the drawn disc a whole Moon-width or more off the real one.
 */
export function moonPosition(
  time: UtcTime,
  observer: CelestialObserver,
  options: CelestialOptions = {},
): CelestialPosition {
  const julianDayUt = julianDayFromUtc(time);
  const deltaT = resolveDeltaT(julianDayUt, options);
  const geocentric = moonGeocentric(julianEphemerisDay(julianDayUt, deltaT));
  const siderealTime = localSiderealTime(julianDayUt, deltaT, observer);

  const topocentric = toTopocentric(
    geocentric.rightAscensionDeg,
    geocentric.declinationDeg,
    geocentric.distanceKm,
    siderealTime,
    observer,
  );

  const angularRadiusDeg = toDegrees(
    Math.asin((MOON_RADIUS_RATIO * EARTH_EQUATORIAL_RADIUS_KM) / topocentric.distanceKm),
  );

  return finishPosition(topocentric, siderealTime, observer, angularRadiusDeg, options);
}
