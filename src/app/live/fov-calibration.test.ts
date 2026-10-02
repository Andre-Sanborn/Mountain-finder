/**
 * The tap-based field-of-view measurement, against hand arithmetic.
 *
 * Every expectation here is derived on paper from the affine model
 * `b = s·a + d` and from the two closed forms the module inverts:
 *
 *     tan(hFov/2) = (width/2) / f          f = s · f_assumed
 *     heading_true = heading_app − d_x / f
 *     pitch_true   = pitch_app   + d_y / f
 *
 * Two of the cases are built the other way round — a synthetic camera with a
 * KNOWN field of view and a KNOWN pointing error generates the taps through an
 * independent projection, and the fit has to recover both numbers. That is the
 * inversion the module exists for, and the independent projector is written out
 * here rather than imported so the expectation is not the code under test.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_TAP_DISTANCE_PX,
  MIN_REFERENCE_SPREAD_FRACTION,
  calibrationFromFit,
  fitFovCalibration,
  pickReference,
  resolveCalibrationTap,
  type CalibrationFrame,
  type CalibrationReference,
  type CalibrationTap,
} from './fov-calibration';

const DEG = Math.PI / 180;

/** The e2e's frame: an 800 × 450 viewport over a 1200 × 900 stream. */
const FRAME: CalibrationFrame = {
  framePx: { widthPx: 800, heightPx: 450 },
  principalPointPx: { xPx: 400, yPx: 225 },
  // 2·atan(0.75) across, 2·atan(0.421875) down: the 24 mm guess after the
  // `cover` crop, exactly as tests/e2e/live.spec.ts derives it.
  visibleFov: { hFovDeg: (2 * Math.atan(0.75)) / DEG, vFovDeg: (2 * Math.atan(0.421875)) / DEG },
  visibleFractionX: 1,
  decodedFrame: { widthPx: 1200, heightPx: 900 },
};

function sunAt(xPx: number, yPx: number): CalibrationReference {
  return { kind: 'sun', name: 'the Sun', drawnPx: { xPx, yPx } };
}

describe('fitFovCalibration', () => {
  it('recovers a scale and a shift that were put in by hand', () => {
    // a₁ = (−160, 40), a₂ = (200, −80) measured from the principal point.
    // With s = 1.25 and d = (10, −6): b₁ = (−190, 44), b₂ = (260, −106).
    const taps: CalibrationTap[] = [
      { reference: sunAt(400 - 160, 225 + 40), tappedPx: { xPx: 400 - 190, yPx: 225 + 44 } },
      { reference: sunAt(400 + 200, 225 - 80), tappedPx: { xPx: 400 + 260, yPx: 225 - 106 } },
    ];

    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;

    expect(fitted.value.scale).toBeCloseTo(1.25, 12);
    // Two points and three parameters fit exactly, so nothing is left over.
    expect(fitted.value.residualPx).toBeCloseTo(0, 9);
    expect(fitted.value.taps).toBe(2);

    // f_assumed = 400 / tan(hFov/2) = 400 / 0.75 = 533.3333…; f = 1.25 f_assumed
    // = 666.6667. So the visible field is 2·atan(400 / 666.6667) = 2·atan(0.6).
    expect(fitted.value.visibleHFovDeg).toBeCloseTo((2 * Math.atan(0.6)) / DEG, 9);
    expect(fitted.value.visibleHFovDeg).toBeCloseTo(61.92751306414704, 9);
    // Down the frame: 2·atan(225 / 666.6667) = 2·atan(0.3375).
    expect(fitted.value.visibleVFovDeg).toBeCloseTo((2 * Math.atan(0.3375)) / DEG, 9);
    // Nothing is cropped in this frame, so the decoded frame's field is the same.
    expect(fitted.value.frameHFovDeg).toBeCloseTo(fitted.value.visibleHFovDeg, 9);

    // d_x = +10 px: the real mark is right of where the app drew it, so the app
    // was aimed too far right and the heading correction is NEGATIVE.
    //   −atan(10 / 666.6667) = −atan(0.015) = −0.8593722°
    expect(fitted.value.trim.headingDeg).toBeCloseTo(-(Math.atan(0.015) / DEG), 12);
    expect(fitted.value.trim.headingDeg).toBeCloseTo(-0.859372, 6);
    // d_y = −6 px: the real mark is ABOVE the drawn one, so the app's pitch was
    // too high and the correction is negative too.
    //   +atan(−6 / 666.6667) = −atan(0.009) = −0.5156481°
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(-(Math.atan(0.009) / DEG), 12);
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(-0.515648, 6);
    // A tap calibration never touches the field-of-view slider: the width it
    // measured is stored as a calibration, not as a nudge.
    expect(fitted.value.trim.hFovDeg).toBe(0);
  });

  it('un-crops the answer through the visible fraction', () => {
    // Same taps, but the box shows only 0.5 of the decoded width. A rectilinear
    // crop scales the tangent, so the whole frame's half-field tangent is
    // 0.6 / 0.5 = 1.2 and its field is 2·atan(1.2) = 100.3889°.
    const taps: CalibrationTap[] = [
      { reference: sunAt(240, 265), tappedPx: { xPx: 210, yPx: 269 } },
      { reference: sunAt(600, 145), tappedPx: { xPx: 660, yPx: 119 } },
    ];
    const fitted = fitFovCalibration(taps, { ...FRAME, visibleFractionX: 0.5 });
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    expect(fitted.value.visibleHFovDeg).toBeCloseTo((2 * Math.atan(0.6)) / DEG, 9);
    expect(fitted.value.frameHFovDeg).toBeCloseTo((2 * Math.atan(1.2)) / DEG, 9);
    expect(fitted.value.frameHFovDeg).toBeCloseTo(100.38885781546962, 9);
  });

  it('inverts a synthetic camera whose field of view and aim are known', () => {
    // The inversion, done the way it happens in the field. A true camera has a
    // 60° horizontal field and is aimed 0.8° left of and 0.4° below where the
    // app believes it is aimed. The app draws each reference through its own
    // 73.7398° assumption; the person taps where the true camera puts it.
    //
    // The independent projector below is the pinhole relation written out, with
    // no roll: x = c + f·tan(Δaz), y = c − f·tan(alt)/cos(Δaz).
    const trueHFovDeg = 60;
    const appHeadingDeg = 100;
    const appPitchDeg = 0;
    const trueHeadingDeg = appHeadingDeg - 0.8;
    const truePitchDeg = appPitchDeg - 0.4;

    const project = (
      focalPx: number,
      headingDeg: number,
      pitchDeg: number,
      azimuthDeg: number,
      altitudeDeg: number,
    ): { xPx: number; yPx: number } => {
      const dAz = (azimuthDeg - headingDeg) * DEG;
      const dAlt = (altitudeDeg - pitchDeg) * DEG;
      return {
        xPx: 400 + focalPx * Math.tan(dAz),
        yPx: 225 - (focalPx * Math.tan(dAlt)) / Math.cos(dAz),
      };
    };

    const appFocalPx = 400 / Math.tan((FRAME.visibleFov.hFovDeg * DEG) / 2);
    const trueFocalPx = 400 / Math.tan((trueHFovDeg * DEG) / 2);

    // Two bodies, one well left of the axis and one well right of it, at
    // altitudes a few degrees apart — the sweep the screen asks a person for.
    const bodies = [
      { azimuthDeg: 88, altitudeDeg: 3 },
      { azimuthDeg: 112, altitudeDeg: -2 },
      { azimuthDeg: 100, altitudeDeg: 6 },
    ];
    const taps: CalibrationTap[] = bodies.map((body) => ({
      reference: {
        kind: 'sun',
        name: 'the Sun',
        drawnPx: project(appFocalPx, appHeadingDeg, appPitchDeg, body.azimuthDeg, body.altitudeDeg),
      },
      tappedPx: project(trueFocalPx, trueHeadingDeg, truePitchDeg, body.azimuthDeg, body.altitudeDeg),
    }));

    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;

    // The recovered field of view, to a tenth of a degree. The affine model is
    // exact only to first order in the off-axis angles — tan is not linear — so
    // a 24° spread of azimuth leaves a small residual, and that residual is the
    // honest limit of a three-parameter fit, not a bug.
    expect(fitted.value.visibleHFovDeg).toBeCloseTo(trueHFovDeg, 1);
    expect(fitted.value.scale).toBeCloseTo(appFocalPx === 0 ? 0 : trueFocalPx / appFocalPx, 2);

    // And the aim: the app is pointed 0.8° right of and 0.4° above the truth, so
    // the corrections are −0.8° and −0.4°.
    expect(fitted.value.trim.headingDeg).toBeCloseTo(-0.8, 1);
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(-0.4, 1);
    expect(fitted.value.residualPx).toBeLessThan(4);
  });

  it('reads a pure heading error as a shift and leaves the field of view alone', () => {
    // Every reference displaced by the same +24 px: no scale change at all.
    const taps: CalibrationTap[] = [
      { reference: sunAt(200, 225), tappedPx: { xPx: 224, yPx: 225 } },
      { reference: sunAt(700, 225), tappedPx: { xPx: 724, yPx: 225 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    expect(fitted.value.scale).toBeCloseTo(1, 12);
    expect(fitted.value.visibleHFovDeg).toBeCloseTo(FRAME.visibleFov.hFovDeg, 9);
    // f = 533.3333; −atan(24 / 533.3333) = −atan(0.045) = −2.5765°.
    expect(fitted.value.trim.headingDeg).toBeCloseTo(-(Math.atan(0.045) / DEG), 12);
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(0, 12);
  });

  it('reads a pure scale error with no shift', () => {
    // References symmetric about the principal point, taps 1.1× further out.
    const taps: CalibrationTap[] = [
      { reference: sunAt(200, 225), tappedPx: { xPx: 180, yPx: 225 } },
      { reference: sunAt(600, 225), tappedPx: { xPx: 620, yPx: 225 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    expect(fitted.value.scale).toBeCloseTo(1.1, 12);
    expect(fitted.value.trim.headingDeg).toBeCloseTo(0, 12);
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(0, 12);
    // f = 1.1 · 533.3333 = 586.6667, so the field is 2·atan(400/586.6667).
    expect(fitted.value.visibleHFovDeg).toBeCloseTo(
      (2 * Math.atan(400 / (1.1 * (400 / 0.75)))) / DEG,
      9,
    );
    // A narrower field than the guess, because the real lens is longer.
    expect(fitted.value.visibleHFovDeg).toBeLessThan(FRAME.visibleFov.hFovDeg);
  });

  it('refuses one tap, and says why two are needed', () => {
    const fitted = fitFovCalibration(
      [{ reference: sunAt(300, 200), tappedPx: { xPx: 310, yPx: 205 } }],
      FRAME,
    );
    expect(fitted.ok).toBe(false);
    if (fitted.ok) return;
    expect(fitted.refusal).toBe('too-few-taps');
    expect(fitted.detail).toContain('different parts of the picture');
  });

  it('refuses taps whose references sit on top of each other', () => {
    // 20 px apart on an 800 px frame: the spread is 10 px against the 80 px
    // floor, so the scale would be the ratio of two small differences.
    const taps: CalibrationTap[] = [
      { reference: sunAt(400, 225), tappedPx: { xPx: 402, yPx: 226 } },
      { reference: sunAt(420, 225), tappedPx: { xPx: 424, yPx: 226 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(false);
    if (fitted.ok) return;
    expect(fitted.refusal).toBe('references-too-close');
    expect(fitted.detail).toContain('80 px are needed');
    expect(MIN_REFERENCE_SPREAD_FRACTION * 800).toBe(80);
  });

  it('refuses a fit that says the picture is mirrored', () => {
    // Taps that reverse the reference order imply a negative focal length.
    const taps: CalibrationTap[] = [
      { reference: sunAt(200, 225), tappedPx: { xPx: 600, yPx: 225 } },
      { reference: sunAt(600, 225), tappedPx: { xPx: 200, yPx: 225 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(false);
    if (fitted.ok) return;
    expect(fitted.refusal).toBe('fitted-field-out-of-range');
  });

  it('refuses a frame with no picture in it', () => {
    const taps: CalibrationTap[] = [
      { reference: sunAt(200, 225), tappedPx: { xPx: 210, yPx: 225 } },
      { reference: sunAt(600, 225), tappedPx: { xPx: 610, yPx: 225 } },
    ];
    const fitted = fitFovCalibration(taps, {
      ...FRAME,
      framePx: { widthPx: 0, heightPx: 0 },
    });
    expect(fitted.ok).toBe(false);
    if (fitted.ok) return;
    expect(fitted.refusal).toBe('no-frame');
  });

  it('averages three taps rather than trusting the last one', () => {
    // Two taps on the model line and one deliberately 12 px off it. Least
    // squares must land between, so the residual is neither 0 nor the full 12.
    const taps: CalibrationTap[] = [
      { reference: sunAt(240, 225), tappedPx: { xPx: 240, yPx: 225 } },
      { reference: sunAt(560, 225), tappedPx: { xPx: 560, yPx: 225 } },
      { reference: sunAt(400, 225), tappedPx: { xPx: 400, yPx: 237 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    // The offending tap is at the mean reference position, so it moves only the
    // shift: d_y = 12/3 = 4 px, and the residuals are −4, −4, +8.
    expect(fitted.value.scale).toBeCloseTo(1, 12);
    expect(fitted.value.trim.pitchDeg).toBeCloseTo(Math.atan(4 / (400 / 0.75)) / DEG, 12);
    expect(fitted.value.residualPx).toBeCloseTo(Math.sqrt((16 + 16 + 64) / 3), 9);
  });
});

describe('pickReference', () => {
  const sun = sunAt(300, 200);
  const summit: CalibrationReference = {
    kind: 'summit',
    name: 'Matterhorn',
    drawnPx: { xPx: 520, yPx: 180 },
  };

  it('attaches a tap to the nearest drawn mark', () => {
    expect(pickReference({ xPx: 310, yPx: 205 }, [sun, summit], MAX_TAP_DISTANCE_PX)).toBe(sun);
    expect(pickReference({ xPx: 500, yPx: 190 }, [sun, summit], MAX_TAP_DISTANCE_PX)).toBe(summit);
  });

  it('discards a tap that is not near anything', () => {
    // (300, 200) to (700, 420) is 456 px, well past the 160 px limit.
    expect(pickReference({ xPx: 700, yPx: 420 }, [sun], MAX_TAP_DISTANCE_PX)).toBeUndefined();
  });

  it('has nothing to attach a tap to when nothing is drawn', () => {
    expect(pickReference({ xPx: 300, yPx: 200 }, [], MAX_TAP_DISTANCE_PX)).toBeUndefined();
  });
});

describe('the fitted focal length', () => {
  it('is the assumed one times the scale, which is what turns a pixel into an angle', () => {
    // The 800 px frame at 2·atan(0.75) across has f_assumed = 400/0.75 = 533.33 px.
    const taps: CalibrationTap[] = [
      { reference: sunAt(200, 225), tappedPx: { xPx: 150, yPx: 225 } },
      { reference: sunAt(600, 225), tappedPx: { xPx: 650, yPx: 225 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    // ±200 px of reference became ±250 px of tap, so the scale is 1.25.
    expect(fitted.value.scale).toBeCloseTo(1.25, 12);
    expect(fitted.value.focalPx).toBeCloseTo(1.25 * (400 / 0.75), 9);
    // And the fit's own field of view is read back through it.
    expect(fitted.value.visibleHFovDeg).toBeCloseTo(
      (2 * Math.atan(400 / fitted.value.focalPx)) / DEG,
      12,
    );
  });
});

describe('resolveCalibrationTap', () => {
  const sun = sunAt(300, 200);
  const framePx = { widthPx: 800, heightPx: 450 };

  it('accepts a tap the app drew nothing near, because that gap is the measurement', () => {
    // (300, 200) to (700, 420) is 456 px. At the 800 px frame's own focal
    // length, 400/0.75 = 533.3 px, that is 40.5° — a tilt error no gate is
    // entitled to refuse on the sensor's word.
    const outcome = resolveCalibrationTap({ xPx: 700, yPx: 420 }, framePx, [sun]);
    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.reference : undefined).toBe(sun);
  });

  it('never lets an in-frame Moon mark claim a tap, even one nearer than an above-frame Sun mark', () => {
    // The tap is 22 px from the Moon mark and 269 px from the Sun mark above the
    // picture. A Moon claim would hide the tap from the gross compass check.
    const aboveFrame = sunAt(400, -60);
    const moon: CalibrationReference = {
      kind: 'moon',
      name: 'the Moon',
      drawnPx: { xPx: 520, yPx: 180 },
    };
    const outcome = resolveCalibrationTap({ xPx: 500, yPx: 190 }, framePx, [aboveFrame, moon]);
    expect(outcome.ok ? outcome.reference : undefined).toBe(aboveFrame);
  });

  it('refuses a tap when only the Moon is drawn', () => {
    const moon: CalibrationReference = {
      kind: 'moon',
      name: 'the Moon',
      drawnPx: { xPx: 300, yPx: 200 },
    };
    const outcome = resolveCalibrationTap({ xPx: 300, yPx: 200 }, framePx, [moon]);
    expect(outcome.ok ? '' : outcome.refusal).toBe('nothing-drawn');
  });

  it('never lets a summit dot claim a tap, even one nearer than an above-frame Sun mark', () => {
    // The Sun mark sits 60 px above the picture; the tap lands 380 px below it
    // and 20 px from a summit dot. Only the Sun may be measured.
    const aboveFrame = sunAt(400, -60);
    const summit: CalibrationReference = {
      kind: 'summit',
      name: 'Matterhorn',
      drawnPx: { xPx: 420, yPx: 320 },
    };
    const outcome = resolveCalibrationTap({ xPx: 400, yPx: 320 }, framePx, [aboveFrame, summit]);
    expect(outcome.ok ? outcome.reference : undefined).toBe(aboveFrame);
  });

  it('refuses a tap when only summit dots are drawn', () => {
    const summit: CalibrationReference = {
      kind: 'summit',
      name: 'Matterhorn',
      drawnPx: { xPx: 300, yPx: 200 },
    };
    const outcome = resolveCalibrationTap({ xPx: 300, yPx: 200 }, framePx, [summit]);
    expect(outcome.ok ? '' : outcome.refusal).toBe('nothing-drawn');
  });

  it('refuses a tap outside the picture', () => {
    for (const point of [
      { xPx: -1, yPx: 200 },
      { xPx: 200, yPx: -1 },
      { xPx: 801, yPx: 200 },
      { xPx: 200, yPx: 451 },
      { xPx: Number.NaN, yPx: 200 },
    ]) {
      const outcome = resolveCalibrationTap(point, framePx, [sun]);
      expect(outcome.ok).toBe(false);
      expect(outcome.ok ? '' : outcome.refusal).toBe('outside-picture');
    }
    // The edges themselves are inside.
    expect(resolveCalibrationTap({ xPx: 0, yPx: 0 }, framePx, [sun]).ok).toBe(true);
    expect(resolveCalibrationTap({ xPx: 800, yPx: 450 }, framePx, [sun]).ok).toBe(true);
  });

  it('refuses a tap when nothing is drawn to compare against', () => {
    const outcome = resolveCalibrationTap({ xPx: 300, yPx: 200 }, framePx, []);
    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? '' : outcome.refusal).toBe('nothing-drawn');
  });
});

describe('calibrationFromFit', () => {
  it('stores the decoded frame and names the reference in the method', () => {
    const taps: CalibrationTap[] = [
      { reference: sunAt(240, 265), tappedPx: { xPx: 210, yPx: 269 } },
      { reference: sunAt(600, 145), tappedPx: { xPx: 660, yPx: 119 } },
    ];
    const fitted = fitFovCalibration(taps, FRAME);
    expect(fitted.ok).toBe(true);
    if (!fitted.ok) return;
    const stored = calibrationFromFit(
      fitted.value,
      FRAME,
      taps.map((tap) => tap.reference),
    );
    expect(stored.frameWidthPx).toBe(1200);
    expect(stored.frameHeightPx).toBe(900);
    expect(stored.frameHFovDeg).toBeCloseTo(fitted.value.frameHFovDeg, 12);
    expect(stored.method).toContain('2 taps on the Sun');
  });
});
