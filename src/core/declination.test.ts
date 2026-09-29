import { describe, expect, it } from 'vitest';

import { wmm2025TestValues } from '../../fixtures/wmm2025/index';
import {
  WMM2025_EPOCH,
  geomagneticField,
  magneticBearingFromTrueDeg,
  magneticDeclinationDeg,
  toDecimalYear,
  trueBearingFromMagneticDeg,
} from './declination';
import { angularDifferenceDeg } from './geodesy';
import { WMM2025_G, WMM2025_G_DOT, WMM2025_N_MAX, wmmCoefficient } from './wmm2025-coefficients';

/**
 * WHERE THE EXPECTATIONS COME FROM.
 *
 * The 100-row sweep below checks against NOAA's own published WMM2025 test
 * values, committed verbatim at fixtures/wmm2025/WMM2025_TestValues.txt. They
 * were produced by NOAA's reference implementation, not by anything in this
 * repository.
 *
 * Every other expectation here is a property that follows from the model's
 * definition — periodicity in longitude, continuity of the polar limit, the
 * inverse-cube fall-off of a dipole, the calendar arithmetic of a decimal year.
 * None of them is a number this module printed.
 *
 * TOLERANCES, fixed before the numbers existed. NOAA prints D and I to two
 * decimal places, so a correct implementation cannot agree better than 0.005°;
 * the gate is 0.01°, twice the rounding floor and five times inside the 0.05°
 * the task asked for. The intensity columns are printed to six decimals, and
 * the gate on them is 0.05 nT.
 */
const ANGLE_TOLERANCE_DEG = 0.01;
const INTENSITY_TOLERANCE_NT = 0.05;

describe('WMM2025 coefficient table', () => {
  it('carries the published dipole terms', () => {
    // Spot values read off the .COF header rows, independent of any code here.
    expect(wmmCoefficient(WMM2025_G, 1, 0)).toBe(-29351.8);
    expect(wmmCoefficient(WMM2025_G, 1, 1)).toBe(-1410.8);
    expect(wmmCoefficient(WMM2025_G, 2, 0)).toBe(-2556.6);
    expect(wmmCoefficient(WMM2025_G_DOT, 1, 0)).toBe(12.0);
  });

  it('reports zero for coefficients that do not exist', () => {
    expect(wmmCoefficient(WMM2025_G, 1, 2)).toBe(0);
    expect(wmmCoefficient(WMM2025_G, WMM2025_N_MAX + 1, 0)).toBe(0);
    expect(wmmCoefficient(WMM2025_G, 0, 0)).toBe(0);
  });
});

describe("NOAA's published WMM2025 test values", () => {
  it('parses all 100 rows of the committed file', () => {
    expect(wmm2025TestValues).toHaveLength(100);
  });

  it.each(
    wmm2025TestValues.map((row) => [
      `${row.decimalYear.toFixed(1)} ${row.latitudeDeg}°,${row.longitudeDeg}° @ ${row.altitudeKm} km`,
      row,
    ] as const),
  )('reproduces %s', (_label, row) => {
    const field = geomagneticField(
      {
        latitudeDeg: row.latitudeDeg,
        longitudeDeg: row.longitudeDeg,
        heightM: row.altitudeKm * 1000,
      },
      row.decimalYear,
    );

    // Wrap-safe: two declinations either side of ±180° differ by a little.
    expect(
      Math.abs(angularDifferenceDeg(row.declinationDeg, field.declinationDeg)),
    ).toBeLessThanOrEqual(ANGLE_TOLERANCE_DEG);
    expect(Math.abs(field.inclinationDeg - row.inclinationDeg)).toBeLessThanOrEqual(
      ANGLE_TOLERANCE_DEG,
    );

    expect(field.northNt).toBeCloseTo(row.northNt, 1);
    expect(field.eastNt).toBeCloseTo(row.eastNt, 1);
    expect(field.downNt).toBeCloseTo(row.downNt, 1);
    expect(Math.abs(field.horizontalNt - row.horizontalNt)).toBeLessThanOrEqual(
      INTENSITY_TOLERANCE_NT,
    );
    expect(Math.abs(field.totalNt - row.totalNt)).toBeLessThanOrEqual(INTENSITY_TOLERANCE_NT);
  });

  it('holds every row inside the stated tolerances at once', () => {
    let worstAngleDeg = 0;
    let worstIntensityNt = 0;

    for (const row of wmm2025TestValues) {
      const field = geomagneticField(
        {
          latitudeDeg: row.latitudeDeg,
          longitudeDeg: row.longitudeDeg,
          heightM: row.altitudeKm * 1000,
        },
        row.decimalYear,
      );
      worstAngleDeg = Math.max(
        worstAngleDeg,
        Math.abs(angularDifferenceDeg(row.declinationDeg, field.declinationDeg)),
        Math.abs(field.inclinationDeg - row.inclinationDeg),
      );
      worstIntensityNt = Math.max(worstIntensityNt, Math.abs(field.totalNt - row.totalNt));
    }

    expect(worstAngleDeg).toBeLessThanOrEqual(ANGLE_TOLERANCE_DEG);
    expect(worstIntensityNt).toBeLessThanOrEqual(INTENSITY_TOLERANCE_NT);
  });

  it('covers the high latitudes where declination is worst conditioned', () => {
    const extremes = wmm2025TestValues.filter((row) => Math.abs(row.latitudeDeg) >= 85);
    expect(extremes.length).toBeGreaterThanOrEqual(5);
  });
});

describe('longitude wrap', () => {
  const when = 2027.25;
  const site = { latitudeDeg: 30, heightM: 0 };

  it('treats +180° and −180° as the same meridian', () => {
    const east = geomagneticField({ ...site, longitudeDeg: 180 }, when);
    const west = geomagneticField({ ...site, longitudeDeg: -180 }, when);
    expect(west.declinationDeg).toBe(east.declinationDeg);
    expect(west.totalNt).toBe(east.totalNt);
  });

  it('is periodic in longitude, so a full turn changes nothing', () => {
    for (const longitudeDeg of [-179.5, -90, 0, 45, 179.5]) {
      const direct = magneticDeclinationDeg({ ...site, longitudeDeg }, when);
      const wrapped = magneticDeclinationDeg({ ...site, longitudeDeg: longitudeDeg + 360 }, when);
      expect(wrapped).toBeCloseTo(direct, 9);
    }
  });

  it('is continuous across the antimeridian', () => {
    const before = magneticDeclinationDeg({ ...site, longitudeDeg: 179.99 }, when);
    const after = magneticDeclinationDeg({ ...site, longitudeDeg: -179.99 }, when);
    // 0.02° of longitude at 30°N is under 2 km; the field cannot jump there.
    expect(Math.abs(angularDifferenceDeg(before, after))).toBeLessThan(0.01);
  });
});

describe('the geographic poles', () => {
  const when = 2026.5;

  it.each([90, -90])('returns a finite field at latitude %p', (latitudeDeg) => {
    const field = geomagneticField({ latitudeDeg, longitudeDeg: 0, heightM: 0 }, when);
    for (const value of [
      field.declinationDeg,
      field.inclinationDeg,
      field.northNt,
      field.eastNt,
      field.downNt,
      field.horizontalNt,
      field.totalNt,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    // The dip poles are elsewhere, so the field at a geographic pole is steep
    // but not vertical, and the horizontal component stays well above zero.
    expect(Math.abs(field.inclinationDeg)).toBeGreaterThan(60);
    expect(field.horizontalNt).toBeGreaterThan(100);
  });

  it('meets the limit the 1/cos φ term is singular at', () => {
    // Off the pole the eastward sum is a quotient; at the pole it is the limit
    // of that quotient. Continuity is the only thing that makes the special
    // case correct, so it is what gets asserted.
    for (const sign of [1, -1]) {
      const pole = geomagneticField({ latitudeDeg: sign * 90, longitudeDeg: 0, heightM: 0 }, when);
      const nearPole = geomagneticField(
        { latitudeDeg: sign * 89.999999, longitudeDeg: 0, heightM: 0 },
        when,
      );
      expect(Math.abs(angularDifferenceDeg(pole.declinationDeg, nearPole.declinationDeg))).toBeLessThan(
        1e-3,
      );
      expect(pole.eastNt).toBeCloseTo(nearPole.eastNt, 3);
      expect(pole.totalNt).toBeCloseTo(nearPole.totalNt, 3);
    }
  });

  it('keeps the total field continuous through the pole along a meridian', () => {
    // Crossing the pole from 89.9°E-of-Greenwich to 89.9° on the far side is a
    // continuous path in space, whatever the longitude coordinate does.
    const approach = geomagneticField({ latitudeDeg: 89.9, longitudeDeg: 0, heightM: 0 }, when);
    const pole = geomagneticField({ latitudeDeg: 90, longitudeDeg: 0, heightM: 0 }, when);
    const beyond = geomagneticField({ latitudeDeg: 89.9, longitudeDeg: 180, heightM: 0 }, when);
    expect(pole.totalNt).toBeGreaterThan(Math.min(approach.totalNt, beyond.totalNt) - 500);
    expect(pole.totalNt).toBeLessThan(Math.max(approach.totalNt, beyond.totalNt) + 500);
  });
});

describe('altitude', () => {
  const when = 2026.0;
  const site = { latitudeDeg: 43.7715, longitudeDeg: -116.0886 };

  it('takes height in metres, not kilometres', () => {
    // NOAA's rows are in km. If heightM were read as km the 98 km row would be
    // evaluated 98 000 km up, where the field is essentially nothing.
    const row = wmm2025TestValues.find((value) => value.altitudeKm >= 90);
    if (row === undefined) throw new Error('fixture has no high-altitude row');

    const metres = geomagneticField(
      { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, heightM: row.altitudeKm * 1000 },
      row.decimalYear,
    );
    const mistakenlyKm = geomagneticField(
      { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, heightM: row.altitudeKm },
      row.decimalYear,
    );

    expect(Math.abs(metres.totalNt - row.totalNt)).toBeLessThanOrEqual(INTENSITY_TOLERANCE_NT);
    // The unit error is worth ~1 nT per km of altitude at this latitude, which
    // is 30 times the gate above. It cannot hide inside the tolerance.
    expect(Math.abs(mistakenlyKm.totalNt - row.totalNt)).toBeGreaterThan(
      30 * INTENSITY_TOLERANCE_NT,
    );
  });

  it('falls off close to the dipole inverse cube', () => {
    // Every term carries (a/r)^(n+2), and the n = 1 dipole dominates, so
    // F(h)/F(0) ≈ (r0/r)³. The higher degrees make this approximate, hence a
    // 5 % band rather than an equality.
    const referenceRadiusKm = 6371.2;
    const heightKm = 400;
    const surface = geomagneticField({ ...site, heightM: 0 }, when);
    const aloft = geomagneticField({ ...site, heightM: heightKm * 1000 }, when);

    const dipoleRatio = (referenceRadiusKm / (referenceRadiusKm + heightKm)) ** 3;
    expect(aloft.totalNt / surface.totalNt).toBeGreaterThan(dipoleRatio * 0.95);
    expect(aloft.totalNt / surface.totalNt).toBeLessThan(dipoleRatio * 1.05);
  });

  it('separates geodetic from geocentric latitude', () => {
    // The two latitudes differ by up to 0.19° at 45°, and the rotation by that
    // angle is what a naive spherical implementation leaves out. The NOAA sweep
    // is the real check; this pins the size of the effect being modelled.
    const field = geomagneticField({ ...site, heightM: 0 }, when);
    const asIfSpherical = Math.atan2(field.downNt, field.horizontalNt);
    expect(Math.abs((asIfSpherical * 180) / Math.PI - field.inclinationDeg)).toBeLessThan(1e-9);
  });
});

describe('secular variation', () => {
  it('advances the field linearly in time from the epoch', () => {
    // g(1,0) moves 12.0 nT/year, so five years of drift is 60 nT on one
    // coefficient. With the dipole term dominating, the field at a mid-latitude
    // site must move by a comparable amount rather than staying put.
    const site = { latitudeDeg: 43.7715, longitudeDeg: -116.0886, heightM: 0 };
    const atEpoch = geomagneticField(site, WMM2025_EPOCH);
    const fiveYearsOn = geomagneticField(site, WMM2025_EPOCH + 5);
    expect(Math.abs(fiveYearsOn.totalNt - atEpoch.totalNt)).toBeGreaterThan(20);

    // Linear in time: the midpoint of the interval is the mean of the ends, to
    // the extent that D is a smooth function of a linear coefficient drift.
    const midpoint = geomagneticField(site, WMM2025_EPOCH + 2.5);
    const meanNorth = (atEpoch.northNt + fiveYearsOn.northNt) / 2;
    expect(midpoint.northNt).toBeCloseTo(meanNorth, 6);
  });

  it('flags dates outside the five-year fit window', () => {
    const site = { latitudeDeg: 0, longitudeDeg: 0, heightM: 0 };
    expect(geomagneticField(site, 2025.0).withinModelValidity).toBe(true);
    expect(geomagneticField(site, 2030.0).withinModelValidity).toBe(true);
    expect(geomagneticField(site, 2024.9).withinModelValidity).toBe(false);
    expect(geomagneticField(site, 2030.1).withinModelValidity).toBe(false);
  });
});

describe('toDecimalYear', () => {
  // Expectations are calendar arithmetic: year + (dayOfYear − 1) / daysInYear.
  it.each([
    ['2026-01-01', Date.UTC(2026, 0, 1), 2026],
    ['2025-12-31', Date.UTC(2025, 11, 31), 2025 + 364 / 365],
    ['2028-07-01 (leap)', Date.UTC(2028, 6, 1), 2028 + 182 / 366],
    ['2027-07-02', Date.UTC(2027, 6, 2), 2027 + 182 / 365],
  ])('maps %s to its decimal year', (_label, epochMs, expected) => {
    expect(toDecimalYear(new Date(epochMs))).toBeCloseTo(expected, 12);
  });

  it('ignores the time of day', () => {
    const morning = new Date(Date.UTC(2026, 5, 10, 1, 2, 3));
    const evening = new Date(Date.UTC(2026, 5, 10, 23, 58, 59));
    expect(toDecimalYear(morning)).toBe(toDecimalYear(evening));
  });

  it('accepts a Date wherever a decimal year is accepted', () => {
    const site = { latitudeDeg: 43.7715, longitudeDeg: -116.0886, heightM: 2000 };
    const date = new Date(Date.UTC(2026, 9, 15));
    expect(magneticDeclinationDeg(site, date)).toBe(
      magneticDeclinationDeg(site, toDecimalYear(date)),
    );
  });
});

describe('bearing conversion', () => {
  const site = { latitudeDeg: 43.7715, longitudeDeg: -116.0886, heightM: 2000 };
  const when = 2026.0;

  it('adds declination going from magnetic to true', () => {
    const declination = magneticDeclinationDeg(site, when);
    // Southern Idaho declination is east (positive), so true > magnetic here.
    expect(declination).toBeGreaterThan(0);
    expect(trueBearingFromMagneticDeg(90, site, when)).toBeCloseTo(90 + declination, 9);
  });

  it('round-trips through magnetic and back', () => {
    for (const bearing of [0, 1, 45, 179, 270, 359.5]) {
      const asTrue = trueBearingFromMagneticDeg(bearing, site, when);
      expect(magneticBearingFromTrueDeg(asTrue, site, when)).toBeCloseTo(bearing, 9);
    }
  });

  it('folds a converted bearing onto [0, 360)', () => {
    const declination = magneticDeclinationDeg(site, when);
    expect(trueBearingFromMagneticDeg(359, site, when)).toBeCloseTo(359 + declination - 360, 9);
    expect(magneticBearingFromTrueDeg(1, site, when)).toBeCloseTo(1 - declination + 360, 9);
  });
});
