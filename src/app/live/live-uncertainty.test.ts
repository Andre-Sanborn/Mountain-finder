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
import { MAX_QUALIFYING_TILT_SPREAD_DEG } from '../../live/recording';
import { MEASURED_ASSUMED_PITCH_ERROR_DEG } from '../uncertainty';
import { horizontalBandHalfWidthPx, liveUncertainty } from './live-uncertainty';
import type { PitchBiasCalibration } from './pitch-bias';

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

/** A home session that found the tilt reading 0.4° high, two aims 0.1° apart. */
const PITCH_BIAS: PitchBiasCalibration = {
  biasDeg: 0.4,
  spreadDeg: 0.1,
  segmentCount: 3,
  method: 'Measured against the sun over 3 aiming step(s) in the home session.',
  source: 'sun-aiming-steps',
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
      pitchBias: PITCH_BIAS,
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.terms.some((term) => term.label.includes('Field of view'))).toBe(false);
    expect(band.hasUnquantified).toBe(false);
  });
});

describe('the tilt zero point', () => {
  it('is unquantified until a home session has measured it', () => {
    // Without this term a calibrated band claims the pitch is known to the
    // width of a second's hand shake, which on a braced phone is thousandths
    // of a degree. The phone's tilt sensor has never been checked against a
    // known direction, and the band has to say so.
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.003,
      fovSource: 'calibrated',
      pose: POSE,
      framePx: FRAME,
    });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.axis).toBe('vertical');
    expect(term?.basis.kind).toBe('unquantified');
    expect(term?.basis.note).toContain('has ever checked its tilt sensor');
    expect(band.hasUnquantified).toBe(true);
    expect(band.summary).toContain('minimum');
  });

  it('charges the measured bias and its spread together', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.8,
      fovSource: 'calibrated',
      pitchBias: PITCH_BIAS,
      pose: POSE,
      framePx: FRAME,
    });
    // 0.8 of wobble, plus 0.4 of bias and 0.1 of re-aim spread.
    expect(band.measuredDeg.vertical).toBeCloseTo(1.3, 12);
    expect(band.hasUnquantified).toBe(false);
    expect(band.frameFraction.vertical).toBeCloseTo(
      Math.tan(1.3 * DEG) / Math.tan(17.5 * DEG),
      12,
    );
  });

  it('charges a bias the other way round by the same amount', () => {
    // The band is a width, so a phone reading 0.4° low costs exactly what one
    // reading 0.4° high costs.
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      fovSource: 'calibrated',
      pitchBias: { ...PITCH_BIAS, biasDeg: -0.4 },
      pose: POSE,
      framePx: FRAME,
    });
    expect(band.measuredDeg.vertical).toBeCloseTo(0.5, 12);
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.note).toContain('too low');
  });

  it('names the sun on screen, so the figure is traceable', () => {
    const band = liveUncertainty({
      heading: MODEL_HEADING,
      fovSource: 'calibrated',
      pitchBias: PITCH_BIAS,
      pose: POSE,
      framePx: FRAME,
    });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.label).toContain('sun');
    expect(term?.basis.kind === 'measured' ? term.basis.sampleCount : 0).toBe(3);
    expect(term?.basis.note).toContain('0.40° too high');
  });
});

/**
 * The qualifying rule, at the live band.
 *
 * Every expectation here is the rule read off `qualifiesToGateVertical` by
 * hand — a source, a count and a spread against the three published constants —
 * rather than anything the code printed.
 */
describe('a tilt zero point that does not qualify to gate the up/down axis', () => {
  const TAPS: PitchBiasCalibration = {
    biasDeg: 0.4,
    spreadDeg: 0.38,
    segmentCount: 2,
    method: 'Read from the 2 field-of-view taps on sun in the home session.',
    source: 'fov-calibration-taps',
  };

  const bandWith = (bias: PitchBiasCalibration): ReturnType<typeof liveUncertainty> =>
    liveUncertainty({
      heading: MODEL_HEADING,
      pitchSpreadDeg: 0.003,
      fovSource: 'calibrated',
      pitchBias: bias,
      pose: POSE,
      framePx: FRAME,
    });

  it('gates on two taps that agree, which is the measurement the field test rests on', () => {
    const band = bandWith(TAPS);
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.kind).toBe('measured');
    // 0.003 of wobble, plus 0.4 of bias, plus the tap disagreement: 0.38 as
    // reported, lifted to the two-tap floor 0.543 / √2 = 0.383959…
    expect(band.measuredDeg.vertical).toBeCloseTo(0.003 + 0.4 + 0.543 / Math.SQRT2, 12);
    expect(band.hasUnquantified).toBe(false);
  });

  it('charges a spread above the floor as reported', () => {
    // 0.9 is past 0.543 / √2, so the floor does nothing: 0.003 + 0.4 + 0.9.
    const band = bandWith({ ...TAPS, spreadDeg: 0.9 });
    expect(band.measuredDeg.vertical).toBeCloseTo(1.303, 12);
    expect(
      band.terms.find((entry) => entry.label.includes('Tilt zero point'))?.basis.note,
    ).not.toContain('charged at');
  });

  it('charges two taps that agree exactly at the floor, not at zero', () => {
    // A spread of 0 is one degree of freedom landing on its luckiest value. The
    // term is 0.4 + 0.543 / √2 = 0.783959…, stated as 0.38° on screen.
    const band = bandWith({ ...TAPS, spreadDeg: 0 });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.kind === 'measured' ? term.basis.deg : NaN).toBeCloseTo(
      0.4 + 0.543 / Math.SQRT2,
      12,
    );
    expect(term?.basis.note).toContain('charged at 0.38°');
  });

  it('floors four taps at 0.543 / √4 = 0.2715°', () => {
    const band = bandWith({ ...TAPS, segmentCount: 4, spreadDeg: 0.1 });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.kind === 'measured' ? term.basis.deg : NaN).toBeCloseTo(0.6715, 12);
  });

  it('charges aiming steps at their own spread, since they are re-aims rather than taps', () => {
    const band = bandWith({ ...PITCH_BIAS, source: 'sun-aiming-steps', segmentCount: 3, spreadDeg: 0.05 });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.kind === 'measured' ? term.basis.deg : NaN).toBeCloseTo(
      Math.abs(PITCH_BIAS.biasDeg) + 0.05,
      12,
    );
  });

  it('gates a pair sitting exactly on the 1.0° spread ceiling', () => {
    // The ceiling is a maximum, so the boundary qualifies. An off-by-one
    // comparison here would refuse an honest pair.
    const band = bandWith({ ...TAPS, spreadDeg: MAX_QUALIFYING_TILT_SPREAD_DEG });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.basis.kind).toBe('measured');
    expect(band.hasUnquantified).toBe(false);
  });

  it('keeps the term unquantified when two taps disagree past the ceiling', () => {
    const band = bandWith({ ...TAPS, spreadDeg: 1.2 });
    const term = band.terms.find((entry) => entry.label.includes('Tilt zero point'));
    expect(term?.label).toBe('Tilt zero point never checked');
    expect(term?.basis.kind).toBe('unquantified');
    // The screen says which measurement fell short, not that none was taken.
    expect(term?.basis.note).toContain('1.20° apart');
    expect(band.hasUnquantified).toBe(true);
    expect(band.summary).toContain('minimum');
    // A floor cannot be exceeded, so the vertical axis charges wobble alone.
    expect(band.measuredDeg.vertical).toBeCloseTo(0.003, 12);
  });

  it('keeps the term unquantified for a single tap, however tight its spread', () => {
    const band = bandWith({ ...TAPS, segmentCount: 1, spreadDeg: 0 });
    expect(
      band.terms.find((entry) => entry.label.includes('Tilt zero point'))?.basis.kind,
    ).toBe('unquantified');
  });

  it('asks three aiming steps for the older measurement, not two', () => {
    const aiming: PitchBiasCalibration = { ...PITCH_BIAS, segmentCount: 2 };
    expect(
      bandWith(aiming).terms.find((entry) => entry.label.includes('Tilt zero point'))?.basis.kind,
    ).toBe('unquantified');
    expect(
      bandWith({ ...aiming, segmentCount: 3 }).terms.find((entry) =>
        entry.label.includes('Tilt zero point'),
      )?.basis.kind,
    ).toBe('measured');
  });

  it('keeps the term unquantified for a bias past the credible ceiling', () => {
    // A 20° figure is a missed aim rather than a sensor's zero point.
    const band = bandWith({ ...TAPS, biasDeg: 20 });
    expect(
      band.terms.find((entry) => entry.label.includes('Tilt zero point'))?.basis.kind,
    ).toBe('unquantified');
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
