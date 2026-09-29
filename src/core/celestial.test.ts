import { describe, expect, it } from 'vitest';

import {
  apparentSiderealTimeDeg,
  deltaTSecondsForJulianDay,
  equatorialToHorizontal,
  julianDayFromUtc,
  meanSiderealTimeDeg,
  moonGeocentric,
  moonPosition,
  nutationAndObliquity,
  observerGeocentricFactors,
  refractionBennettDeg,
  refractionSaemundssonDeg,
  sunGeocentric,
  sunPosition,
  type CelestialObserver,
} from './celestial';
import { angularDifferenceDeg, toDegrees, toRadians } from './geodesy';

/**
 * WHERE THE EXPECTATIONS COME FROM
 *
 * Nothing below was produced by running this module. Every number is either a
 * worked example printed in Jean Meeus, *Astronomical Algorithms* 2nd ed., or a
 * closed-form identity of spherical astronomy written out here.
 *
 * NOAA's Solar Calculator (gml.noaa.gov) and the USNO data services
 * (aa.usno.navy.mil) were both checked for reachability from this environment
 * and both are refused by the network egress proxy, as is JPL Horizons
 * (ssd.jpl.nasa.gov). So no third published ephemeris is used. The Meeus
 * examples were instead cross-checked for transcription errors by re-deriving
 * each one's right ascension and declination from its own published longitude
 * and obliquity with independent trigonometry; all three chains closed to the
 * last printed digit.
 *
 * TOLERANCES, AND WHY EACH ONE
 *
 * Meeus's own accuracy statements set the floor. Chapter 25's low-accuracy
 * solar method is stated as 0.01° in longitude; chapter 47's truncated lunar
 * series as 10″ (0.003°) in longitude and 4″ (0.001°) in latitude; chapter 22's
 * abridged nutation as 0.5″ in Δψ.
 *
 * A test that reproduces a worked example is not limited by that accuracy,
 * because the book computed the same series. There the only slack needed is the
 * book's own printing precision, five decimal places, so 1e-4 ° is used. Where
 * an expectation is a closed-form identity the tolerance is set by floating
 * point alone, and where the abridged nutation series stands between this code
 * and a book value that used the full series, the tolerance is widened to
 * 0.001° and said so at the assertion.
 *
 * The project targets 0.05° for the Sun and 0.1° for the Moon. Every tolerance
 * below is tighter than that, so passing these tests is a stronger claim than
 * the target.
 */

/** Degrees from a sexagesimal triple, sign taken from `degrees`. */
function fromDms(degrees: number, arcminutes: number, arcseconds: number): number {
  const magnitude = Math.abs(degrees) + arcminutes / 60 + arcseconds / 3600;
  return degrees < 0 ? -magnitude : magnitude;
}

/**
 * Bisect `f` for a sign change on [a, b]. Used to land on the instant of an
 * event (transit, rise) so that a closed-form identity can be checked there.
 * The identities themselves are the expectations; this only finds where to
 * evaluate them.
 */
function bisect(f: (ms: number) => number, aMs: number, bMs: number): number {
  let lo = aMs;
  let hi = bMs;
  let loValue = f(lo);
  expect(Math.sign(loValue)).not.toBe(Math.sign(f(hi)));
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    const midValue = f(mid);
    if (Math.sign(midValue) === Math.sign(loValue)) {
      lo = mid;
      loValue = midValue;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

const utcMs = (iso: string): number => Date.parse(iso);

describe('Julian Day from a UTC instant', () => {
  // The Julian Day number of a calendar instant is a definition, not a
  // computation: J2000.0 is JD 2451545.0 at 2000 January 1.5.
  it.each([
    ['2000-01-01T12:00:00Z', 2451545.0],
    ['1992-10-13T00:00:00Z', 2448908.5], // Meeus Example 25.a
    ['1992-04-12T00:00:00Z', 2448724.5], // Meeus Example 47.a
    ['1987-04-10T00:00:00Z', 2446895.5], // Meeus Examples 12.a and 22.a
    ['1987-04-10T19:21:00Z', 2446896.30625], // Meeus Example 12.b
  ])('%s is JD %p', (iso, expected) => {
    expect(julianDayFromUtc(utcMs(iso))).toBeCloseTo(expected, 9);
  });

  it('accepts a Date and a timestamp interchangeably', () => {
    const iso = '2026-09-29T14:30:00Z';
    expect(julianDayFromUtc(new Date(iso))).toBe(julianDayFromUtc(Date.parse(iso)));
  });
});

describe('delta T', () => {
  /**
   * The Espenak–Meeus expression for 1986–2005 is anchored at 63.86 s for
   * 2000.0 by construction. The observed value there is 63.83 s, so the
   * expression is right to 0.03 s at its own anchor.
   */
  it('gives 63.86 s at 2000.0', () => {
    expect(deltaTSecondsForJulianDay(2451545.0)).toBeCloseTo(63.86, 2);
  });

  /**
   * Observed ΔT in 1992 was close to 58.3 s (IERS). The polynomial is an
   * approximation to that record, so 1 s is the fair test.
   */
  it('is near the observed 58.3 s in 1992', () => {
    expect(deltaTSecondsForJulianDay(2448724.5)).toBeCloseTo(58.3, 0);
  });

  /**
   * The Espenak–Meeus segments are fitted piecewise, so they meet only
   * approximately. A jump much larger than a second would mean a mistranscribed
   * coefficient rather than a fitting artefact.
   */
  it.each([1920, 1941, 1961, 1986, 2005, 2050])(
    'is continuous across the %p segment join',
    (year) => {
      const jdAtYear = 2451545.0 + (year - 2000) * 365.25;
      const before = deltaTSecondsForJulianDay(jdAtYear - 0.5);
      const after = deltaTSecondsForJulianDay(jdAtYear + 0.5);
      expect(Math.abs(after - before)).toBeLessThan(1.5);
    },
  );

  it('rises monotonically over the modern era', () => {
    let previous = deltaTSecondsForJulianDay(2451545.0 + (2005 - 2000) * 365.25);
    for (let year = 2006; year <= 2100; year += 1) {
      const value = deltaTSecondsForJulianDay(2451545.0 + (year - 2000) * 365.25);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
  });
});

describe('sidereal time, Meeus chapter 12', () => {
  /** Example 12.a: 1987 April 10 at 0h UT, θ₀ = 197.693195°. */
  it('reproduces Example 12.a', () => {
    expect(meanSiderealTimeDeg(2446895.5)).toBeCloseTo(197.693195, 5);
  });

  /**
   * Example 12.b: 1987 April 10 at 19h21m00s UT, θ₀ = 13h10m46.3668s... for
   * Greenwich mean sidereal time, printed as 128.7378734°.
   */
  it('reproduces Example 12.b', () => {
    expect(meanSiderealTimeDeg(2446896.30625)).toBeCloseTo(128.7378734, 5);
  });

  /**
   * Example 13.b takes its apparent sidereal time as the mean value plus
   * −3.868″/15 in time units, i.e. Δψ·cos ε with Δψ = −3.868″. The abridged
   * nutation series used here is stated to 0.5″ in Δψ, which is 0.5″·cos ε of
   * sidereal time. That is the tolerance, written out rather than rounded to a
   * `toBeCloseTo` digit count, because 0.5″ falls between two of those.
   */
  it('adds the equation of the equinoxes', () => {
    const mean = meanSiderealTimeDeg(2446896.30625);
    const apparent = apparentSiderealTimeDeg(2446896.30625, 0);
    const abridgedSeriesLimitDeg = (0.5 / 3600) * Math.cos(toRadians(23.44));
    expect(Math.abs(apparent - mean - -3.868 / 3600)).toBeLessThan(abridgedSeriesLimitDeg);
  });
});

describe('nutation and obliquity, Meeus Example 22.a', () => {
  // 1987 April 10.0 TD, JDE 2446895.5.
  const result = nutationAndObliquity(2446895.5);

  /** The book prints ε₀ = 23°26′27.407″, straight from formula (22.2). */
  it('gives the mean obliquity to the printed digit', () => {
    expect(result.meanObliquityDeg).toBeCloseTo(fromDms(23, 26, 27.407), 6);
  });

  /**
   * The book's Δψ = −3.788″ and Δε = +9.443″ come from the full IAU 1980
   * series. This module uses Meeus's abridged four-term form, stated as 0.5″
   * in Δψ and 0.1″ in Δε, so those are the tolerances — expressed in degrees.
   */
  it('gives the nutation within the abridged series accuracy', () => {
    expect(Math.abs(result.nutationLongitudeDeg - -3.788 / 3600)).toBeLessThan(0.5 / 3600);
    expect(Math.abs(result.nutationObliquityDeg - 9.443 / 3600)).toBeLessThan(0.1 / 3600);
  });

  it('gives the true obliquity as the sum', () => {
    expect(result.trueObliquityDeg).toBeCloseTo(
      result.meanObliquityDeg + result.nutationObliquityDeg,
      12,
    );
    expect(Math.abs(result.trueObliquityDeg - fromDms(23, 26, 36.85))).toBeLessThan(
      0.6 / 3600,
    );
  });
});

describe('Sun, Meeus Example 25.a', () => {
  // 1992 October 13.0 TD, JDE 2448908.5.
  const sun = sunGeocentric(2448908.5);

  /**
   * The book prints every quantity to five decimals and uses the same series,
   * so agreement is expected at 1e-5 °. The assertions allow 1e-4 ° for the
   * book's rounding of its own intermediates — still 500 times inside the
   * project's 0.05° target for the Sun.
   */
  it.each<[string, number, number]>([
    ['apparent longitude', sun.apparentLongitudeDeg, 199.90895],
    ['apparent right ascension', sun.rightAscensionDeg, 198.38083],
    ['apparent declination', sun.declinationDeg, -7.78507],
    ['corrected obliquity', sun.apparentObliquityDeg, 23.43999],
  ])('%s matches the book', (_label, computed, expected) => {
    expect(Math.abs(computed - expected)).toBeLessThan(1e-4);
  });

  /** The book prints R = 0.99766 AU. */
  it('gives the Earth–Sun distance', () => {
    expect(sun.distanceAu).toBeCloseTo(0.99766, 5);
  });
});

describe('Moon, Meeus Example 47.a', () => {
  // 1992 April 12.0 TD, JDE 2448724.5.
  const moon = moonGeocentric(2448724.5);

  /**
   * λ, β and Δ are pure sums over Tables 47.A and 47.B, with no rounding on
   * the book's side beyond its printed digits. A mistranscribed coefficient
   * anywhere in the 120 rows shows up here, which is what makes 1e-5 ° the
   * right tolerance rather than the series' own 10″ accuracy.
   */
  it('gives the geometric longitude and latitude', () => {
    expect(moon.longitudeDeg).toBeCloseTo(133.162655, 5);
    expect(moon.latitudeDeg).toBeCloseTo(-3.229126, 5);
  });

  it('gives the distance and the equatorial horizontal parallax', () => {
    expect(moon.distanceKm).toBeCloseTo(368409.7, 1);
    expect(moon.parallaxDeg).toBeCloseTo(0.99199, 5);
  });

  /**
   * The book's apparent λ = 133.167265° uses Δψ = +16.595″ from the full
   * nutation series; the abridged series here is stated to 0.5″, which is
   * 0.00014°. Allowing 0.001° covers that with room to spare and still checks
   * the equatorial conversion to a thirtieth of the Moon's radius.
   */
  it('gives the apparent right ascension and declination', () => {
    expect(Math.abs(moon.apparentLongitudeDeg - 133.167265)).toBeLessThan(0.001);
    expect(Math.abs(moon.rightAscensionDeg - 134.68847)).toBeLessThan(0.001);
    expect(Math.abs(moon.declinationDeg - 13.768368)).toBeLessThan(0.001);
  });
});

describe('equatorial to horizontal, Meeus Example 13.b', () => {
  /**
   * Venus from Washington, 1987 April 10 at 19h21m00s UT. The book's inputs are
   * δ = −6°43′11.61″ and φ = 38°55′17″, with local hour angle H = 64.352133°.
   * Its answers are A = 68.0337° measured westward from south and h = 15.1249°.
   * This project measures azimuth clockwise from north, so 180° is added.
   */
  it('matches the book', () => {
    const { azimuthDeg, altitudeDeg } = equatorialToHorizontal(
      { hourAngleDeg: 64.352133, declinationDeg: fromDms(-6, 43, 11.61) },
      fromDms(38, 55, 17),
    );
    expect(azimuthDeg).toBeCloseTo(68.0337 + 180, 3);
    expect(altitudeDeg).toBeCloseTo(15.1249, 3);
  });

  /** An object on the meridian south of the observer bears due south. */
  it('puts a body at zero hour angle due south when it is south of the zenith', () => {
    const { azimuthDeg, altitudeDeg } = equatorialToHorizontal(
      { hourAngleDeg: 0, declinationDeg: 10 },
      45,
    );
    expect(azimuthDeg).toBeCloseTo(180, 10);
    expect(altitudeDeg).toBeCloseTo(90 - 45 + 10, 10);
  });

  /** North of the zenith it bears due north, and the altitude folds over. */
  it('puts a body at zero hour angle due north when it is north of the zenith', () => {
    const { azimuthDeg, altitudeDeg } = equatorialToHorizontal(
      { hourAngleDeg: 0, declinationDeg: 60 },
      45,
    );
    expect(azimuthDeg).toBeCloseTo(0, 10);
    expect(altitudeDeg).toBeCloseTo(90 - 60 + 45, 10);
  });
});

describe('solar transit, by the closed-form identity', () => {
  /**
   * At the instant of upper transit the hour angle is zero, so the altitude is
   * exactly 90° − φ + δ for an observer north of the sub-solar latitude. The
   * bisection below only locates the transit; the identity is the expectation,
   * and it ties azimuth and altitude together through the declination the
   * module reports. Both quantities would have to be wrong in the same way for
   * this to pass.
   */
  const observer: CelestialObserver = { lat: 39.0, lon: 0, heightM: 0 };

  it.each([
    ['2026-03-20', '2026-03-20'],
    ['2026-06-21', '2026-06-21'],
    ['2026-09-29', '2026-09-29'],
    ['2026-12-21', '2026-12-21'],
  ])('on %s the Sun transits due south at 90 - lat + dec', (day) => {
    const azimuthOffset = (ms: number) =>
      angularDifferenceDeg(180, sunPosition(ms, observer).azimuthDeg);
    // Local apparent noon at longitude 0 falls within a quarter hour of 12 UT.
    const transitMs = bisect(azimuthOffset, utcMs(`${day}T11:30:00Z`), utcMs(`${day}T12:30:00Z`));
    const at = sunPosition(transitMs, observer);

    expect(at.azimuthDeg).toBeCloseTo(180, 5);
    expect(at.geometricAltitudeDeg).toBeCloseTo(90 - observer.lat + at.declinationDeg, 4);
  });

  /**
   * Southern hemisphere: the Sun is always north of a Sydney observer, because
   * |φ| exceeds the obliquity. So transit is at azimuth 0° — the wrap case the
   * northern test cannot reach — and the altitude is 90° − (δ − φ).
   */
  it('transits due north from Sydney', () => {
    const sydney: CelestialObserver = { lat: -33.8688, lon: 151.2093, heightM: 0 };
    const azimuthOffset = (ms: number) =>
      angularDifferenceDeg(0, sunPosition(ms, sydney).azimuthDeg);
    const transitMs = bisect(
      azimuthOffset,
      utcMs('2026-06-21T01:30:00Z'),
      utcMs('2026-06-21T02:30:00Z'),
    );
    const at = sunPosition(transitMs, sydney);

    // Folded onto (−180, 180] this is 0; reported on [0, 360) it may print 360.
    expect(Math.abs(angularDifferenceDeg(0, at.azimuthDeg))).toBeLessThan(1e-5);
    expect(at.geometricAltitudeDeg).toBeCloseTo(90 - (at.declinationDeg - sydney.lat), 4);
  });
});

describe('rise azimuth, by the closed-form identity', () => {
  /**
   * Setting h = 0 in the altitude equation and substituting into the azimuth
   * equation gives cos A = sin δ / cos φ, with A measured from north. This is
   * exact, holds at any latitude and date, and is independent of how the module
   * gets to an azimuth.
   */
  const cases: Array<[string, CelestialObserver, string, string]> = [
    ['equinox, mid-northern', { lat: 40, lon: 0 }, '2026-03-20T04:00:00Z', '2026-03-20T07:00:00Z'],
    ['solstice, mid-northern', { lat: 40, lon: 0 }, '2026-06-21T03:00:00Z', '2026-06-21T06:00:00Z'],
    ['equinox, southern', { lat: -35, lon: 0 }, '2026-03-20T04:00:00Z', '2026-03-20T07:00:00Z'],
  ];

  it.each(cases)('%s: cos A = sin d / cos lat at h = 0', (_label, observer, fromIso, toIso) => {
    const altitude = (ms: number) => sunPosition(ms, observer).geometricAltitudeDeg;
    const riseMs = bisect(altitude, utcMs(fromIso), utcMs(toIso));
    const at = sunPosition(riseMs, observer);

    const expectedAzimuthDeg = toDegrees(
      Math.acos(Math.sin(toRadians(at.declinationDeg)) / Math.cos(toRadians(observer.lat))),
    );
    expect(at.geometricAltitudeDeg).toBeCloseTo(0, 6);
    expect(at.azimuthDeg).toBeCloseTo(expectedAzimuthDeg, 4);
  });

  /**
   * At the March equinox the Sun's declination is within 0.4° of zero, and
   * cos A = sin δ / cos φ then puts sunrise within 0.6° of due east at 40°
   * latitude. Stating the bound this way keeps it a prediction rather than a
   * reading.
   */
  it('rises near due east at the equinox', () => {
    const observer: CelestialObserver = { lat: 40, lon: 0 };
    const altitude = (ms: number) => sunPosition(ms, observer).geometricAltitudeDeg;
    const riseMs = bisect(altitude, utcMs('2026-03-20T04:00:00Z'), utcMs('2026-03-20T07:00:00Z'));
    const at = sunPosition(riseMs, observer);

    expect(Math.abs(at.declinationDeg)).toBeLessThan(0.4);
    expect(Math.abs(angularDifferenceDeg(90, at.azimuthDeg))).toBeLessThan(0.6);
  });
});

describe('polar day and night', () => {
  /**
   * Longyearbyen sits at 78.22° N, above the Arctic Circle. At the solstice the
   * Sun's declination is ±23.44°, so its lowest altitude over the day is
   * δ − (90° − φ) = 23.44 − 11.78 = +11.66° in June, and its highest is
   * (90° − φ) + δ = 11.78 − 23.44 = −11.66° in December. Those are the bounds
   * asserted; they come from the geometry of a circumpolar diurnal circle, not
   * from any ephemeris.
   */
  const longyearbyen: CelestialObserver = { lat: 78.2232, lon: 15.6469, heightM: 0 };

  function altitudesThroughDay(day: string): number[] {
    const samples: number[] = [];
    for (let minute = 0; minute < 24 * 60; minute += 10) {
      samples.push(
        sunPosition(utcMs(`${day}T00:00:00Z`) + minute * 60000, longyearbyen)
          .geometricAltitudeDeg,
      );
    }
    return samples;
  }

  it('never sets at the June solstice', () => {
    const altitudes = altitudesThroughDay('2026-06-21');
    expect(Math.min(...altitudes)).toBeGreaterThan(11);
    expect(Math.max(...altitudes)).toBeLessThan(35.3); // (90 − φ) + δ = 35.22
  });

  it('never rises at the December solstice', () => {
    const altitudes = altitudesThroughDay('2026-12-21');
    expect(Math.max(...altitudes)).toBeLessThan(-11);
    expect(Math.min(...altitudes)).toBeGreaterThan(-35.3);
  });

  it('sweeps the full azimuth circle during the polar day', () => {
    const azimuths: number[] = [];
    for (let hour = 0; hour < 24; hour += 1) {
      azimuths.push(
        sunPosition(utcMs('2026-06-21T00:00:00Z') + hour * 3600000, longyearbyen).azimuthDeg,
      );
    }
    // Circumpolar: the azimuth advances monotonically through all four
    // quadrants, so consecutive steps sum to one full turn.
    let total = 0;
    for (let i = 1; i < azimuths.length; i += 1) {
      const previous = azimuths[i - 1];
      const current = azimuths[i];
      if (previous === undefined || current === undefined) throw new Error('missing sample');
      const step = angularDifferenceDeg(previous, current);
      expect(step).toBeGreaterThan(0);
      total += step;
    }
    // 23 of the 24 hourly steps, at roughly 15° each.
    expect(total).toBeGreaterThan(330);
    expect(total).toBeLessThan(360);
  });
});

describe('azimuth convention and wrapping', () => {
  const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };

  it('keeps every azimuth on [0, 360)', () => {
    for (let hour = 0; hour < 24 * 30; hour += 1) {
      const ms = utcMs('2026-01-01T00:00:00Z') + hour * 3600000;
      for (const position of [sunPosition(ms, observer), moonPosition(ms, observer)]) {
        expect(position.azimuthDeg).toBeGreaterThanOrEqual(0);
        expect(position.azimuthDeg).toBeLessThan(360);
      }
    }
  });

  /**
   * Crossing north, the raw azimuth jumps from just under 360 to just over 0.
   * The signed short-way difference must stay small across that seam, which is
   * the wrap case that silently breaks anything comparing bare numbers.
   */
  it('is continuous across north', () => {
    const start = utcMs('2026-06-21T00:00:00Z');
    let crossings = 0;
    let previous = moonPosition(start, observer).azimuthDeg;
    for (let minute = 1; minute <= 60 * 24 * 30; minute += 1) {
      const current = moonPosition(start + minute * 60000, observer).azimuthDeg;
      const step = angularDifferenceDeg(previous, current);
      expect(Math.abs(step)).toBeLessThan(1);
      if ((previous > 350 && current < 10) || (previous < 10 && current > 350)) crossings += 1;
      previous = current;
    }
    expect(crossings).toBeGreaterThan(0);
  });
});

describe('lunar parallax', () => {
  /**
   * Meeus (40.5) gives the parallax in altitude exactly, for an observer at the
   * ellipsoid's equatorial radius: sin p = sin π · cos h′, where h′ is the
   * topocentric altitude. An equatorial sea-level observer is used so that
   * ρ = 1 and the relation applies without the ρ factor.
   *
   * This also fixes the *sign*: parallax always lowers the Moon, so the
   * topocentric altitude is below the geocentric one.
   */
  const equatorial: CelestialObserver = { lat: 0, lon: 0, heightM: 0 };

  it.each([
    '2026-01-15T03:00:00Z',
    '2026-01-15T09:00:00Z',
    '2026-04-02T18:00:00Z',
    '2026-08-11T22:00:00Z',
  ])('at %s the shift equals asin(sin pi cos h)', (iso) => {
    const ms = utcMs(iso);
    const jdUt = julianDayFromUtc(ms);
    const deltaT = 0;
    const geocentric = moonGeocentric(jdUt);
    const topocentric = moonPosition(ms, equatorial, { deltaTSeconds: deltaT });

    const localSiderealTimeDeg = apparentSiderealTimeDeg(jdUt, deltaT) + equatorial.lon;
    const geocentricHorizon = equatorialToHorizontal(
      {
        hourAngleDeg: localSiderealTimeDeg - geocentric.rightAscensionDeg,
        declinationDeg: geocentric.declinationDeg,
      },
      equatorial.lat,
    );

    const observedShift = geocentricHorizon.altitudeDeg - topocentric.geometricAltitudeDeg;
    const predictedShift = toDegrees(
      Math.asin(
        Math.sin(toRadians(geocentric.parallaxDeg)) *
          Math.cos(toRadians(topocentric.geometricAltitudeDeg)),
      ),
    );

    expect(observedShift).toBeGreaterThan(0);
    expect(observedShift).toBeCloseTo(predictedShift, 4);
  });

  /**
   * The size of the effect is the reason it is here at all. Near the horizon
   * the shift approaches the full parallax, which is between 0.89° and 1.02°
   * over the Moon's orbit — more than three full lunar diameters.
   */
  it('reaches nearly a degree near the horizon', () => {
    const start = utcMs('2026-01-01T00:00:00Z');
    let largest = 0;
    for (let hour = 0; hour < 24 * 30; hour += 1) {
      const ms = start + hour * 3600000;
      const jdUt = julianDayFromUtc(ms);
      const geocentric = moonGeocentric(jdUt);
      const topocentric = moonPosition(ms, equatorial, { deltaTSeconds: 0 });
      const localSiderealTimeDeg = apparentSiderealTimeDeg(jdUt, 0) + equatorial.lon;
      const geocentricHorizon = equatorialToHorizontal(
        {
          hourAngleDeg: localSiderealTimeDeg - geocentric.rightAscensionDeg,
          declinationDeg: geocentric.declinationDeg,
        },
        equatorial.lat,
      );
      if (Math.abs(topocentric.geometricAltitudeDeg) < 1) {
        largest = Math.max(
          largest,
          geocentricHorizon.altitudeDeg - topocentric.geometricAltitudeDeg,
        );
      }
    }
    expect(largest).toBeGreaterThan(0.85);
  });
});

describe('angular radius', () => {
  const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };

  /**
   * The bounds here are derived, not read off. Semidiameter is
   * arcsin(radius / distance), so the extremes follow from the published
   * orbital extremes:
   *
   *   Sun   s = 959.63″ / R, with R between 0.98329 AU at perihelion and
   *         1.01671 AU at aphelion → 943.9″ (15′43.9″) to 975.9″ (16′15.9″).
   *   Moon  s = arcsin(k·a / Δ) with k·a = 1737.9 km, Δ between 356 500 km at
   *         perigee and 406 700 km at apogee. These are TOPOCENTRIC distances,
   *         so one Earth radius is added at the horizon and subtracted at the
   *         zenith: Δ spans 350 100 to 413 100 km → 14′27.8″ to 17′03.9″.
   *
   * Each test also asserts the span is wide, so a radius that never varied —
   * a fixed mean distance, say — would fail rather than sit inside the range.
   */
  it('keeps the Sun inside its perihelion and aphelion semidiameters', () => {
    const radii: number[] = [];
    for (let day = 0; day < 365; day += 1) {
      radii.push(sunPosition(utcMs('2026-01-01T12:00:00Z') + day * 86400000, observer)
        .angularRadiusDeg);
    }
    expect(Math.min(...radii)).toBeGreaterThan(fromDms(0, 0, 943.8));
    expect(Math.max(...radii)).toBeLessThan(fromDms(0, 0, 976.0));
    // A full year must very nearly reach both extremes.
    expect(Math.min(...radii)).toBeLessThan(fromDms(0, 0, 944.5));
    expect(Math.max(...radii)).toBeGreaterThan(fromDms(0, 0, 975.0));
  });

  it('keeps the Moon inside its topocentric perigee and apogee semidiameters', () => {
    const radii: number[] = [];
    for (let hour = 0; hour < 24 * 60; hour += 1) {
      radii.push(moonPosition(utcMs('2026-01-01T00:00:00Z') + hour * 3600000, observer)
        .angularRadiusDeg);
    }
    expect(Math.min(...radii)).toBeGreaterThan(fromDms(0, 14, 27.8));
    expect(Math.max(...radii)).toBeLessThan(fromDms(0, 17, 3.9));
    expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(fromDms(0, 1, 30));
  });

  /**
   * The topocentric distance shrinks by one Earth radius between horizon and
   * zenith, so the Moon must look measurably larger overhead. One Earth radius
   * out of 385 000 km is 1.7 %, and 1.7 % of 15′ is about 15″.
   */
  it('grows towards the zenith', () => {
    const equator: CelestialObserver = { lat: 0, lon: 0, heightM: 0 };
    let atHorizon = 0;
    let highest = 0;
    let atHighest = 0;
    for (let minute = 0; minute < 60 * 24 * 2; minute += 5) {
      const at = moonPosition(utcMs('2026-04-02T00:00:00Z') + minute * 60000, equator);
      if (Math.abs(at.geometricAltitudeDeg) < 0.2) atHorizon = at.angularRadiusDeg;
      if (at.geometricAltitudeDeg > highest) {
        highest = at.geometricAltitudeDeg;
        atHighest = at.angularRadiusDeg;
      }
    }
    expect(highest).toBeGreaterThan(80);
    expect(atHighest - atHorizon).toBeGreaterThan(fromDms(0, 0, 10));
  });
});

describe('refraction', () => {
  /**
   * Sæmundsson (Meeus 16.4) takes the airless altitude; Bennett (16.3) takes
   * the apparent one. So they must be mutual inverses, and Meeus states they
   * agree to within 0.1′. Round-tripping an altitude through both is therefore
   * a documented check with no ephemeris involved.
   */
  it.each([0, 0.5, 1, 2, 5, 10, 20, 45, 80, 89])(
    'the two formulas invert each other at %p degrees',
    (airlessAltitudeDeg) => {
      const up = refractionSaemundssonDeg(airlessAltitudeDeg);
      const down = refractionBennettDeg(airlessAltitudeDeg + up);
      expect(Math.abs(up - down)).toBeLessThan(0.1 / 60);
    },
  );

  /** At the airless horizon Sæmundsson gives 1.02/tan(10.3/5.11°) = 28.98′. */
  it('lifts a body at the airless horizon by about 29 arcminutes', () => {
    expect(refractionSaemundssonDeg(0) * 60).toBeCloseTo(
      1.02 / Math.tan(toRadians(10.3 / 5.11)),
      6,
    );
  });

  /** At the apparent horizon Bennett gives 1/tan(7.31/4.4°) = 34.47′. */
  it('shows the classical 34 arcminutes at the apparent horizon', () => {
    expect(refractionBennettDeg(0) * 60).toBeCloseTo(1 / Math.tan(toRadians(7.31 / 4.4)), 6);
  });

  it('shrinks towards the zenith and vanishes past the usable range', () => {
    expect(refractionSaemundssonDeg(90)).toBeLessThan(0.01 / 60);
    expect(refractionSaemundssonDeg(-2)).toBe(0);
  });

  /** Meeus (16.1): the correction scales as (P/1010)·(283/(273+T)). */
  it('scales with pressure and temperature', () => {
    const standard = refractionSaemundssonDeg(10, 1010, 10);
    expect(refractionSaemundssonDeg(10, 505, 10)).toBeCloseTo(standard / 2, 12);
    expect(refractionSaemundssonDeg(10, 1010, 30)).toBeCloseTo(
      standard * (283 / 303),
      12,
    );
  });

  /**
   * Refraction always lifts a body, so the refracted altitude must be the
   * higher of the two. The instant below has the Sun a few degrees up, where
   * the correction is several arcminutes — large enough that a sign error could
   * not hide inside it.
   */
  it('is opt-in, and lifts the altitude by exactly the formula value', () => {
    const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };
    const ms = utcMs('2026-09-29T14:30:00Z');
    const airless = sunPosition(ms, observer);
    const refracted = sunPosition(ms, observer, { refraction: true });

    expect(airless.geometricAltitudeDeg).toBeGreaterThan(1);
    expect(airless.geometricAltitudeDeg).toBeLessThan(15);
    expect(airless.refractionDeg).toBe(0);
    expect(airless.altitudeDeg).toBe(airless.geometricAltitudeDeg);

    expect(refracted.geometricAltitudeDeg).toBeCloseTo(airless.geometricAltitudeDeg, 12);
    expect(refracted.refractionDeg).toBeGreaterThan(3 / 60);
    expect(refracted.altitudeDeg).toBeGreaterThan(refracted.geometricAltitudeDeg);
    expect(refracted.altitudeDeg - refracted.geometricAltitudeDeg).toBeCloseTo(
      refractionSaemundssonDeg(airless.geometricAltitudeDeg),
      12,
    );
    expect(refracted.azimuthDeg).toBeCloseTo(airless.azimuthDeg, 12);
  });
});

describe('delta T belongs to the ephemeris, not to Earth rotation', () => {
  /**
   * ΔT converts UT to TT. It must reach the Sun's and Moon's positions in
   * their orbits, and must NOT reach sidereal time, which measures Earth's
   * rotation and is a function of UT alone.
   *
   * The two costs are wildly different sizes, which is what makes this a test.
   * Advancing TT by 75 s moves the Sun 3″ and the Moon 41″ along their paths.
   * Advancing sidereal time by 75 s would turn the sky 0.313°, four hundred
   * times more for the Sun. So a small change here is the whole assertion:
   * feeding TT where UT belongs cannot stay inside these bounds.
   */
  const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };
  const ms = utcMs('2026-09-29T20:00:00Z');

  it('moves the Sun by only its own motion over 75 s', () => {
    const a = sunPosition(ms, observer, { deltaTSeconds: 0 });
    const b = sunPosition(ms, observer, { deltaTSeconds: 75 });
    // 75 s of solar motion is 75 × 0.041″ ≈ 3″ = 0.0009°.
    expect(Math.abs(angularDifferenceDeg(a.azimuthDeg, b.azimuthDeg))).toBeLessThan(0.002);
    expect(Math.abs(a.geometricAltitudeDeg - b.geometricAltitudeDeg)).toBeLessThan(0.002);
  });

  it('moves the Moon by only its own motion over 75 s', () => {
    const a = moonPosition(ms, observer, { deltaTSeconds: 0 });
    const b = moonPosition(ms, observer, { deltaTSeconds: 75 });
    // 75 s of lunar motion is 75 × 0.55″ ≈ 41″ = 0.011°.
    expect(Math.abs(angularDifferenceDeg(a.azimuthDeg, b.azimuthDeg))).toBeLessThan(0.03);
    expect(Math.abs(a.geometricAltitudeDeg - b.geometricAltitudeDeg)).toBeLessThan(0.03);
  });

  /**
   * The hour angle is apparent sidereal time plus east longitude minus right
   * ascension. Both ingredients are checked against Meeus's own examples
   * elsewhere in this file — sidereal time against 12.a and 12.b, the Sun's
   * right ascension against 25.a — so this asserts only that the module
   * composes them with the right time scale on each. An observer at the pole is
   * used because ρ·cos φ′ vanishes there, which makes the topocentric right
   * ascension identical to the geocentric one.
   */
  it('composes the hour angle from UT sidereal time and TT right ascension', () => {
    const pole: CelestialObserver = { lat: 90, lon: 0, heightM: 0 };
    const julianDayUt = julianDayFromUtc(ms);
    const deltaT = deltaTSecondsForJulianDay(julianDayUt);
    expect(deltaT).toBeGreaterThan(60);

    const expectedHourAngle = angularDifferenceDeg(
      sunGeocentric(julianDayUt + deltaT / 86400).rightAscensionDeg,
      apparentSiderealTimeDeg(julianDayUt, deltaT) + pole.lon,
    );
    expect(sunPosition(ms, pole).hourAngleDeg).toBeCloseTo(expectedHourAngle, 6);
  });
});

describe('the observer sits on an ellipsoid, not a sphere', () => {
  /**
   * Two exact properties of the WGS-84 meridian ellipse pin ρ·sin φ′ and
   * ρ·cos φ′ at sea level, independently of how Meeus chooses to write them:
   *
   *   tan φ′ = (b/a)² · tan φ           geocentric from geodetic latitude
   *   ρ = 1 / sqrt(cos²φ′ + sin²φ′/(b/a)²)   radius in units of a
   *
   * A spherical Earth satisfies neither except at the equator and the poles,
   * so these are what separate the ellipsoid from a sphere.
   */
  const axisRatio = 0.99664719;

  it.each([10, 33.356111, 45, 51.5, 78.2232])(
    'matches the ellipse identities at latitude %p',
    (latitudeDeg) => {
      const { rhoSin, rhoCos } = observerGeocentricFactors(latitudeDeg, 0);

      const geocentricLatitudeDeg = toDegrees(
        Math.atan(axisRatio * axisRatio * Math.tan(toRadians(latitudeDeg))),
      );
      expect(toDegrees(Math.atan2(rhoSin, rhoCos))).toBeCloseTo(geocentricLatitudeDeg, 10);

      const cosGeocentric = Math.cos(toRadians(geocentricLatitudeDeg));
      const sinGeocentric = Math.sin(toRadians(geocentricLatitudeDeg));
      const expectedRho =
        1 /
        Math.sqrt(
          cosGeocentric * cosGeocentric +
            (sinGeocentric * sinGeocentric) / (axisRatio * axisRatio),
        );
      expect(Math.hypot(rhoSin, rhoCos)).toBeCloseTo(expectedRho, 10);
    },
  );

  /** Geocentric latitude lags geodetic latitude by up to 11.5′, at 45°. */
  it('puts the largest latitude difference near 45 degrees', () => {
    const differenceAt = (latitudeDeg: number) => {
      const { rhoSin, rhoCos } = observerGeocentricFactors(latitudeDeg, 0);
      return latitudeDeg - toDegrees(Math.atan2(rhoSin, rhoCos));
    };
    expect(differenceAt(45) * 60).toBeCloseTo(11.5, 1);
    expect(differenceAt(0)).toBeCloseTo(0, 12);
    expect(differenceAt(90)).toBeCloseTo(0, 10);
  });

  /** Height is added along the geodetic normal, one Earth radius per 6378.14 km. */
  it('adds height along the local vertical', () => {
    const seaLevel = observerGeocentricFactors(45, 0);
    const aloft = observerGeocentricFactors(45, 6378140);
    expect(aloft.rhoSin - seaLevel.rhoSin).toBeCloseTo(Math.sin(toRadians(45)), 10);
    expect(aloft.rhoCos - seaLevel.rhoCos).toBeCloseTo(Math.cos(toRadians(45)), 10);
  });
});

describe('purity', () => {
  const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };
  const ms = utcMs('2026-09-29T13:20:00Z');

  it('returns the same answer every time', () => {
    expect(sunPosition(ms, observer)).toEqual(sunPosition(ms, observer));
    expect(moonPosition(ms, observer)).toEqual(moonPosition(ms, observer));
  });

  it('treats a Date and its timestamp as the same instant', () => {
    expect(moonPosition(new Date(ms), observer)).toEqual(moonPosition(ms, observer));
  });

  it('defaults the observer height to sea level', () => {
    expect(moonPosition(ms, { lat: 43.1, lon: -114.5 })).toEqual(
      moonPosition(ms, { lat: 43.1, lon: -114.5, heightM: 0 }),
    );
  });

  /**
   * Observer height matters for the Moon through parallax: 2400 m is 0.038 % of
   * an Earth radius, worth about 1.4″ of parallax. Small, but it must not be
   * silently dropped.
   */
  it('uses the observer height', () => {
    const atSeaLevel = moonPosition(ms, { lat: 43.1, lon: -114.5, heightM: 0 });
    const onTheMountain = moonPosition(ms, { lat: 43.1, lon: -114.5, heightM: 4000 });
    expect(atSeaLevel.distanceKm).not.toBe(onTheMountain.distanceKm);
    expect(Math.abs(atSeaLevel.altitudeDeg - onTheMountain.altitudeDeg)).toBeGreaterThan(
      0.5 / 3600,
    );
  });
});

describe('hour angle sign', () => {
  const observer: CelestialObserver = { lat: 43.1, lon: -114.5, heightM: 2400 };

  it('is negative before transit and positive after', () => {
    const azimuthOffset = (ms: number) =>
      angularDifferenceDeg(180, sunPosition(ms, observer).azimuthDeg);
    const transitMs = bisect(
      azimuthOffset,
      utcMs('2026-09-29T19:00:00Z'),
      utcMs('2026-09-29T20:00:00Z'),
    );
    expect(sunPosition(transitMs, observer).hourAngleDeg).toBeCloseTo(0, 4);
    expect(sunPosition(transitMs - 3600000, observer).hourAngleDeg).toBeCloseTo(-15.04, 1);
    expect(sunPosition(transitMs + 3600000, observer).hourAngleDeg).toBeCloseTo(15.04, 1);
  });
});
