/**
 * The correlated pass rates § 2.3 and § 2.4 of the pre-registration quote.
 *
 * The simulation is seeded, so these are exact figures rather than intervals: a
 * change to the budget's terms, its limits or the gate's allowance schedule moves
 * them, and this file is where that shows up.
 *
 * The binomial formula the document used to quote is checked here too, as the
 * thing the simulation disagrees with. Treating six units as six independent
 * draws puts a three-summit band at 0.960; the units share the anchor, the
 * observer, the scale error, the roll and the same k drags, and the correlated
 * figure is 0.914. The gap is the finding, not a rounding difference.
 */

import { describe, expect, it } from 'vitest';

import {
  f3PassRate,
  f4PassRates,
  medianSdOfKNormals,
  type BandScenario,
} from '../../scripts/lib/field-budget-simulation.js';
import { twoSigmaAllowanceFor } from '../../src/live/field-analysis.js';

/** The `far` band, spread over 8–19 km as the simulation's own helper does. */
function farBand(summits: number, k: number): BandScenario {
  const distances = [8, 10, 12, 14, 16, 18, 9, 11, 13, 15, 17, 19];
  return {
    band: 'far',
    distancesKm: Array.from({ length: summits }, (_unused, index) => distances[index % 12] ?? 10),
    k,
  };
}

/** `Σ_{j≤a} C(n,j)·p1^j·p0^(n−j)`, the independent-unit model § 2.3 used to quote. */
function binomialPassRate(units: number): number {
  const p0 = 0.9545;
  const p1 = 0.0428;
  const allowance = twoSigmaAllowanceFor(units);
  let total = 0;
  for (let j = 0; j <= allowance; j += 1) {
    let choose = 1;
    for (let i = 0; i < j; i += 1) choose = (choose * (units - i)) / (i + 1);
    total += choose * p1 ** j * p0 ** (units - j);
  }
  return total;
}

describe('F3 under the budget’s own sharing', () => {
  it('passes a correct app at the rates § 2.3 registers, k = 1', () => {
    expect(f3PassRate(farBand(3, 1))).toBeCloseTo(0.914, 3);
    expect(f3PassRate(farBand(5, 1))).toBeCloseTo(0.906, 3);
    expect(f3PassRate(farBand(6, 1))).toBeCloseTo(0.904, 3);
    expect(f3PassRate(farBand(12, 1))).toBeCloseTo(0.902, 3);
  });

  it('passes a correct app at the rates § 2.3 registers, k = 3', () => {
    expect(f3PassRate(farBand(3, 3))).toBeCloseTo(0.942, 3);
    expect(f3PassRate(farBand(12, 3))).toBeCloseTo(0.931, 3);
  });

  it('still catches a term understated by half again', () => {
    // The draws come from a 1.5× drag while the limits stay registered: 0.914
    // becomes 0.797 at three summits. That is the gate's power, and it is what
    // § 2.3 quotes.
    expect(f3PassRate({ ...farBand(3, 1), dragInflation: 1.5 })).toBeCloseTo(0.797, 3);
  });

  it('is flatter in n than the independent-unit model, and lower at n = 6', () => {
    // Independent units: 0.960 at n = 6 falling to 0.861 at n = 24. Shared
    // terms: 0.914 at n = 6 and 0.902 at n = 24. Exceedances arrive together,
    // so the allowance schedule buys much less than the binomial says.
    expect(binomialPassRate(6)).toBeCloseTo(0.96, 2);
    expect(binomialPassRate(24)).toBeCloseTo(0.861, 3);
    const small = f3PassRate(farBand(3, 1));
    const large = f3PassRate(farBand(12, 1));
    expect(small).toBeLessThan(binomialPassRate(6) - 0.03);
    expect(large).toBeGreaterThan(binomialPassRate(24) + 0.03);
    expect(Math.abs(small - large)).toBeLessThan(0.02);
  });
});

describe('the drag factor per k', () => {
  it('agrees with § 1.5’s closed forms, and puts k = 4 below k = 3', () => {
    // 400 000 draws puts the standard error of an sd near 0.001, so three
    // decimal places is what this instrument can settle.
    expect(medianSdOfKNormals(1, 400_000)).toBeCloseTo(1, 2);
    expect(medianSdOfKNormals(2, 400_000)).toBeCloseTo(Math.SQRT1_2, 2);
    expect(medianSdOfKNormals(3, 400_000)).toBeCloseTo(
      Math.sqrt(1 - Math.sqrt(3) / Math.PI),
      2,
    );
    // The figure § 1.5 quotes to say that charging a median of four at the
    // k = 3 factor cannot let a wrong budget pass.
    expect(medianSdOfKNormals(4, 400_000)).toBeCloseTo(0.546, 2);
    expect(medianSdOfKNormals(4, 400_000)).toBeLessThan(medianSdOfKNormals(3, 400_000));
  });
});

describe('F4 under the budget’s own sharing', () => {
  it('passes a correct app at the rates § 2.4 registers', () => {
    const three = f4PassRates(3);
    expect(three.perMovement).toBeCloseTo(0.943, 3);
    expect(three.allFour).toBeCloseTo(0.839, 3);
    const five = f4PassRates(5);
    expect(five.perMovement).toBeCloseTo(0.927, 3);
    expect(five.allFour).toBeCloseTo(0.797, 3);
  });

  it('does not multiply out to four independent movements', () => {
    // The calibration error and the reference hold are shared across all four,
    // so the four movements are not four independent chances: 0.943^4 = 0.790,
    // and the correlated figure is higher than that.
    const three = f4PassRates(3);
    expect(three.allFour).toBeGreaterThan(three.perMovement ** 4);
  });
});
