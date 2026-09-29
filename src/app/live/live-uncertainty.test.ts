/**
 * The live uncertainty band — D9's statement with the terms a sensor stream has.
 *
 * The arithmetic expectations are the same closed forms `uncertainty.test.ts`
 * uses, written out here:
 *
 *   frameFraction = tan(band) / tan(fov / 2)        saturating at 1
 *   pixelsPerDegree = (size / 2) · (π/180) / tan(fov / 2)
 *
 * The term-selection expectations come from the rule stated in the module
 * header: what is measured is reported with its figure, what has no figure is
 * reported as having none, and nothing is blended.
 *
 * The decisive test is the last one. Carrying the photo path's 3.52°
 * assumed-pitch term into a screen that reads gravity would report an error the
 * app is not making, so the live band must not contain it.
 */

import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../../core/types';
import {
  MODEL_DECLINATION_RMS_DEG,
  type DrawableHeading,
} from '../../live/heading-policy';
import { MEASURED_ASSUMED_PITCH_ERROR_DEG } from '../uncertainty';
import { horizontalBandHalfWidthPx, liveUncertainty } from './live-uncertainty';

const DEG = Math.PI / 180;
const FRAME = { widthPx: 800, heightPx: 450 };
const POSE: CameraPose = {
  headingDeg: 265.4,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 60,
  vFovDeg: 35,
};

const MODEL_HEADING: DrawableHeading = {
  basis: 'true-model',
  headingDeg: 265.4,
  spreadDeg: undefined,
  sampleCount: 1,
  caveat: 'converted',
  model: {
    modelName: 'WMM-2025',
    declinationDeg: 12.605,
    decimalYear: 2026.7,
    withinModelValidity: true,
  },
};

const MAGNETIC_HEADING: DrawableHeading = {
  basis: 'magnetic',
  headingDeg: 265.4,
  spreadDeg: undefined,
  sampleCount: 1,
  caveat: 'magnetic',
};

describe('the heading terms', () => {
  it('reports the model’s own RMS for a converted bearing', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.horizontal).toBeCloseTo(MODEL_DECLINATION_RMS_DEG, 12);
    expect(band.terms[0]?.label).toContain('model');
    // The declination it added is named, so the number on screen is traceable.
    const basis = band.terms[0]?.basis;
    expect(basis?.kind).toBe('measured');
    if (basis?.kind === 'measured') expect(basis.note).toContain('12.6°');
  });

  it('states no figure for an unconverted magnetic bearing', () => {
    // The error IS the local declination and the app has no position to
    // evaluate it at. A plausible-looking 15° would be invented.
    const band = liveUncertainty({
      heading: MAGNETIC_HEADING,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.horizontal).toBe(0);
    expect(band.hasUnquantified).toBe(true);
    expect(band.terms[0]?.basis.kind).toBe('unquantified');
    expect(band.summary).toContain('minimum');
  });

  it('states no figure for a platform heading either', () => {
    // Core Location resolved north itself and publishes no accuracy for it.
    const band = liveUncertainty({
      heading: { basis: 'true', headingDeg: 12, spreadDeg: undefined, sampleCount: 1, caveat: '' },
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.terms[0]?.basis.kind).toBe('unquantified');
    expect(band.hasUnquantified).toBe(true);
  });

  it('adds the compass’s own reported accuracy when the platform gives one', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      compassAccuracyDeg: 8,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    // 0.5 (model) + 8 (CLHeading.headingAccuracy).
    expect(band.measuredDeg.horizontal).toBeCloseTo(8.5, 12);
  });

  it('ignores a negative or zero accuracy rather than subtracting it', () => {
    // CLHeading reports −1 for "no usable reading", and `web-sensors.ts`
    // refuses those before they reach here. Adding −1 to a band would shrink it.
    for (const accuracy of [-1, 0]) {
      const band = liveUncertainty({
        heading: MODEL_HEADING,
        compassAccuracyDeg: accuracy,
        fovSource: 'calibrated',
        pose: POSE,
        framePx: FRAME,
      });
      expect(band.measuredDeg.horizontal).toBeCloseTo(MODEL_DECLINATION_RMS_DEG, 12);
    }
  });

  it('adds the trace’s own scatter, and calls it what it is', () => {
    const band = liveUncertainty({
      heading: { ...MODEL_HEADING, spreadDeg: 1.25, sampleCount: 40 },
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.horizontal).toBeCloseTo(1.75, 12);
    const scatter = band.terms.find((term) => term.label.includes('wobble'));
    expect(scatter?.basis.kind).toBe('measured');
    if (scatter?.basis.kind === 'measured') {
      expect(scatter.basis.sampleCount).toBe(40);
      // A still phone has almost no scatter and can still point 12° wrong.
      expect(scatter.basis.note).toContain('not how far off north');
    }
  });
});

describe('the vertical terms', () => {
  it('reports the tilt scatter measured from the trace', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.8,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.vertical).toBeCloseTo(0.8, 12);
  });

  it('does NOT carry the photo path’s assumed-tilt error', () => {
    // The decisive assertion. Live, the tilt is sensed rather than assumed, so
    // the 3.52° term `uncertainty.ts` reports for a photograph would be an
    // error this app is not making.
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.8,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.vertical).toBeLessThan(MEASURED_ASSUMED_PITCH_ERROR_DEG);
    for (const term of band.terms) {
      if (term.basis.kind === 'measured') {
        expect(term.basis.deg).not.toBeCloseTo(MEASURED_ASSUMED_PITCH_ERROR_DEG, 6);
      }
      expect(term.label.toLowerCase()).not.toContain('not recorded');
    }
  });

  it('reports an uncalibrated field of view as unquantified, and says what it does', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      fovSource: 'spec-sheet-guess',
      pose: POSE,
      framePx: FRAME,
    });
    const term = band.terms.find((entry) => entry.label.includes('Field of view'));
    expect(term?.basis.kind).toBe('unquantified');
    // A field-of-view error stretches the labels; it does not slide them.
    expect(term?.basis.note).toContain('stretches');
    expect(band.hasUnquantified).toBe(true);
  });

  it('drops the field-of-view term once it is calibrated', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.8,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.terms.some((term) => term.label.includes('Field of view'))).toBe(false);
    expect(band.hasUnquantified).toBe(false);
  });
});

describe('the arithmetic', () => {
  it('converts degrees to a fraction of the half-frame by tangent', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      compassAccuracyDeg: 8,
      pitchSpreadDeg: 2,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    // horizontal 8.5° in a 60° field: tan(8.5°) / tan(30°).
    expect(band.frameFraction.horizontal).toBeCloseTo(
      Math.tan(8.5 * DEG) / Math.tan(30 * DEG),
      12,
    );
    // vertical 2° in a 35° field: tan(2°) / tan(17.5°).
    expect(band.frameFraction.vertical).toBeCloseTo(Math.tan(2 * DEG) / Math.tan(17.5 * DEG), 12);
  });

  it('gives the exact pixels-per-degree at frame centre', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.pixelsPerDegree.horizontal).toBeCloseTo(
      (400 * DEG) / Math.tan(30 * DEG),
      12,
    );
    expect(band.pixelsPerDegree.vertical).toBeCloseTo((225 * DEG) / Math.tan(17.5 * DEG), 12);
  });

  it('saturates at the frame edge rather than running away', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      compassAccuracyDeg: 80,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.frameFraction.horizontal).toBe(1);
    expect(band.summary).toContain('more than the whole picture');
  });
});

describe('horizontalBandHalfWidthPx', () => {
  it('is half the frame times the fraction, so the strip means what it shows', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      compassAccuracyDeg: 8,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    // 800 px frame: half-width = 400 · tan(8.5°)/tan(30°).
    expect(horizontalBandHalfWidthPx(band, FRAME)).toBeCloseTo(
      (400 * Math.tan(8.5 * DEG)) / Math.tan(30 * DEG),
      10,
    );
  });

  it('is zero when every horizontal term is unquantified', () => {
    // The honest width for "no figure": the strip disappears and the sentence
    // carries the statement instead.
    const band = liveUncertainty({
      heading: MAGNETIC_HEADING,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    expect(horizontalBandHalfWidthPx(band, FRAME)).toBe(0);
  });
});
