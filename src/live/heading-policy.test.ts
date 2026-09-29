/**
 * The drawable-heading policy.
 *
 * The point under test is a distinction, not a calculation: a magnetic bearing
 * may be DRAWN but must never be LABELLED true. So most of these assert on
 * `basis` and on what reaches the caveat, and one asserts the thing that would
 * be easy to lose in a refactor — that the magnetic path returns the magnetic
 * number unchanged, rather than some number that merely looks plausible.
 */

import { describe, expect, it } from 'vitest';

import {
  MODEL_DECLINATION_RMS_DEG,
  TYPICAL_DECLINATION_BOUND_DEG,
  resolveHeadingForDrawing,
  type ModelDeclinationInput,
} from './heading-policy';
import type { HeadingSample } from './sensors';

const AT_MS = 10_000;

function magneticOnly(magneticDeg: number, timestampMs = AT_MS): HeadingSample {
  return { timestampMs, magneticDeg, accuracyDeg: 20 };
}

/**
 * Bogus Basin, the field-session viewpoint, at 2000 m on 2026-10-15.
 *
 * WMM2025 gives +12.605° E there. That figure is not from running this module:
 * it is the value recorded for this site and date in IMPLEMENTATION.md, under
 * "WMM2025 magnetic declination", where the model is checked against all 100 of
 * NOAA's published test values to within 0.005° and cross-checked against an
 * IGRF-14 computation of +12.8° for 2026-09-29.
 */
const BOGUS_BASIN: ModelDeclinationInput = {
  site: { latitudeDeg: 43.7715, longitudeDeg: -116.0886, heightM: 2000 },
  when: new Date('2026-10-15T00:00:00Z'),
};

/** The declination NOAA's model gives at `BOGUS_BASIN`, degrees east. */
const BOGUS_BASIN_DECLINATION_DEG = 12.605;

describe('resolveHeadingForDrawing', () => {
  it('prefers a true heading and says nothing about it', () => {
    const decision = resolveHeadingForDrawing(
      [{ timestampMs: AT_MS, trueDeg: 174.089, accuracyDeg: 20 }],
      AT_MS,
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('true');
    expect(decision.heading.headingDeg).toBeCloseTo(174.089, 10);
    expect(decision.heading.caveat).toBe('');
  });

  it('converts with a supplied declination rather than falling back', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(100)], AT_MS, { declinationDeg: 13.5 });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // Declination is east-positive and added: 100 + 13.5. The basis is `true`
    // because the conversion actually happened.
    expect(decision.heading.headingDeg).toBeCloseTo(113.5, 10);
    expect(decision.heading.basis).toBe('true');
    expect(decision.heading.caveat).toBe('');
  });

  it('draws a magnetic-only heading, unchanged, and labels it magnetic', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(212.75)], AT_MS);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('magnetic');
    // The number is the magnetic bearing itself — no fudge factor, no guessed
    // declination baked in. That is what makes the label honest.
    expect(decision.heading.headingDeg).toBeCloseTo(212.75, 10);
    expect(decision.heading.caveat).toContain('Magnetic north, not true north');
    expect(decision.heading.caveat).toContain(String(TYPICAL_DECLINATION_BOUND_DEG));
    // A caveat the user cannot act on is just an apology.
    expect(decision.heading.caveat).toContain('Drag');
  });

  it('still refuses when there is genuinely no bearing to draw', () => {
    const empty = resolveHeadingForDrawing([], AT_MS);
    expect(empty).toEqual({
      ok: false,
      refusal: 'no-samples',
      detail: 'the compass has not reported yet',
    });

    // Older than maxAgeMs (1500): stale, and staleness is not recoverable by
    // relabelling — the phone may have been put in a pocket.
    const stale = resolveHeadingForDrawing([magneticOnly(90, AT_MS - 5_000)], AT_MS);
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.refusal).toBe('stale');
    expect(stale.detail).toContain('compass reading');
  });

  it('carries the measured spread and sample count through both paths', () => {
    const samples = [magneticOnly(100, AT_MS - 200), magneticOnly(102, AT_MS - 100)];
    const decision = resolveHeadingForDrawing(samples, AT_MS);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.sampleCount).toBe(2);
    // Two readings 2° apart have a real, non-zero circular spread; the point is
    // that the fallback path does not quietly drop it and claim certainty.
    expect(decision.heading.spreadDeg).toBeGreaterThan(0);
    expect(decision.heading.spreadDeg).toBeLessThan(2);
  });

  it('never reports basis "true" for a bearing that was never converted', () => {
    // The regression this guards: a refactor that returns the magnetic value
    // on the recovery path but forgets to change the label. That single word
    // is the whole difference between honest and wrong.
    for (const bearing of [0, 45, 180, 359.9]) {
      const decision = resolveHeadingForDrawing([magneticOnly(bearing)], AT_MS);
      expect(decision.ok).toBe(true);
      if (!decision.ok) continue;
      expect(decision.heading.basis).toBe('magnetic');
    }
  });
});

/**
 * The WMM2025 path.
 *
 * Two things are asserted separately, and they are different claims. The
 * VALUE comes from a reference figure recorded outside this file, so the test
 * fails if the model drifts. The SIGN comes from the convention itself —
 * true = magnetic + east declination — so the test fails if the conversion is
 * applied backwards, whatever the value happens to be.
 */
describe('resolveHeadingForDrawing with the WMM2025 model', () => {
  it('converts a magnetic bearing at Bogus Basin and labels it true-model', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(100)], AT_MS, {
      modelDeclination: BOGUS_BASIN,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;

    expect(decision.heading.basis).toBe('true-model');
    // 100.00° magnetic + 12.605° E = 112.605° true. The tolerance is 0.01°,
    // the same gate the declination module's own NOAA comparison uses.
    expect(decision.heading.headingDeg).toBeCloseTo(100 + BOGUS_BASIN_DECLINATION_DEG, 2);
    expect(decision.heading.model?.declinationDeg).toBeCloseTo(BOGUS_BASIN_DECLINATION_DEG, 2);
    expect(decision.heading.model?.modelName).toBe('WMM-2025');
    expect(decision.heading.model?.withinModelValidity).toBe(true);
    // 2026-10-15 is day 288 of a 365-day year: 2026 + 287/365 = 2026.7863.
    expect(decision.heading.model?.decimalYear).toBeCloseTo(2026 + 287 / 365, 6);
  });

  it('adds an east declination rather than subtracting it', () => {
    // The sign convention, checked without reference to the model's value: an
    // east declination moves a magnetic bearing clockwise. Bogus Basin's
    // declination is east, so the true bearing must be the LARGER of the two.
    const magneticDeg = 100;
    const decision = resolveHeadingForDrawing([magneticOnly(magneticDeg)], AT_MS, {
      modelDeclination: BOGUS_BASIN,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    const declinationDeg = decision.heading.model?.declinationDeg;
    expect(declinationDeg).toBeGreaterThan(0);
    if (declinationDeg === undefined) return;
    expect(decision.heading.headingDeg - magneticDeg).toBeCloseTo(declinationDeg, 10);
  });

  it('names the model and its accuracy in the caveat', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(100)], AT_MS, {
      modelDeclination: BOGUS_BASIN,
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    // A modelled north is still not a measured north, so the screen says which
    // model produced it and how far out it can be.
    expect(decision.heading.caveat).toContain('WMM-2025');
    expect(decision.heading.caveat).toContain(`${MODEL_DECLINATION_RMS_DEG}°`);
    expect(decision.heading.caveat).toContain('local rock');
    expect(decision.heading.caveat).toContain('+12.6°');
  });

  it('prefers the platform true heading over the model', () => {
    // iOS reports trueHeading ≥ 0 once it has a fix, and it resolves north with
    // its own model plus data this app cannot see. Both are present here; the
    // platform number must survive untouched and stay labelled `true`.
    const decision = resolveHeadingForDrawing(
      [{ timestampMs: AT_MS, magneticDeg: 100, trueDeg: 112.9, accuracyDeg: 20 }],
      AT_MS,
      { modelDeclination: BOGUS_BASIN },
    );
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('true');
    expect(decision.heading.headingDeg).toBeCloseTo(112.9, 10);
    expect(decision.heading.caveat).toBe('');
    expect(decision.heading.model).toBeUndefined();
  });

  it('falls back to MAG when the date is outside the model validity window', () => {
    // WMM2025 is fitted for 2025.0–2030.0. Beyond it the linear secular terms
    // extrapolate, so the model is not used at all.
    const decision = resolveHeadingForDrawing([magneticOnly(100)], AT_MS, {
      modelDeclination: { ...BOGUS_BASIN, when: new Date('2031-03-01T00:00:00Z') },
    });
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('magnetic');
    expect(decision.heading.headingDeg).toBeCloseTo(100, 10);
    expect(decision.heading.model).toBeUndefined();
    expect(decision.heading.caveat).toContain('Magnetic north, not true north');
    // And it says why the model went unused, rather than looking like the app
    // simply lost the position.
    expect(decision.heading.caveat).toContain('2025.0–2030.0');
  });

  it('falls back to MAG when the position is unknown', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(212.75)], AT_MS);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.heading.basis).toBe('magnetic');
    expect(decision.heading.headingDeg).toBeCloseTo(212.75, 10);
    expect(decision.heading.model).toBeUndefined();
    // No model was consulted, so nothing is said about one.
    expect(decision.heading.caveat).not.toContain('WMM-2025');
  });

  it('still refuses a stale trace rather than modelling it', () => {
    const decision = resolveHeadingForDrawing([magneticOnly(90, AT_MS - 5_000)], AT_MS, {
      modelDeclination: BOGUS_BASIN,
    });
    expect(decision.ok).toBe(false);
    if (decision.ok) return;
    expect(decision.refusal).toBe('stale');
  });
});
