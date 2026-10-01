/**
 * The re-anchor's arithmetic, against hand-derived answers.
 *
 * Every expectation below is written from the projection, not from a run:
 *
 *   f = (widthPx / 2) / tan(hFov / 2)
 *
 * The frame is 800 px wide at hFov = 2·atan(0.75) = 73.73979529168804°, so
 * tan(hFov/2) = 3/4 exactly and f = 400 / 0.75 = 1600/3 = 533.333… px. A tap
 * f/√3 = 307.92 px from the principal point is therefore atan(1/√3) = 30° off
 * axis, and f·tan(10°) = 94.05 px from it is 10°. Both angles are standard and
 * both taps land inside an 800 × 450 frame, which a 45° one would not.
 */

import { describe, expect, it } from 'vitest';

import { projectToImage } from '../../core/projection';
import { TRIM_LIMIT_DEG } from '../trim';

import {
  anchorDrift,
  azimuthInBasis,
  grossHeadingWarning,
  GROSS_HEADING_WARNING_DEG,
  reanchorFromTap,
  reanchorSentence,
  readsAsSunTap,
  type ReanchorInput,
} from './reanchor';

const FRAME = { widthPx: 800, heightPx: 450 };
/** 2·atan(3/4) — see the header. */
const HFOV_DEG = 73.73979529168804;
/** (800 / 2) / tan(hFov/2) = 400 / 0.75. */
const FOCAL_PX = 1600 / 3;
const CENTRE = { xPx: 400, yPx: 225 };
/** f·tan(30°) = f/√3, the horizontal offset that is exactly 30° off axis. */
const THIRTY_DEG_PX = FOCAL_PX / Math.sqrt(3);
/** f·tan(10°). */
const TEN_DEG_PX = FOCAL_PX * Math.tan((10 * Math.PI) / 180);

function input(partial: Partial<ReanchorInput> = {}): ReanchorInput {
  return {
    reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 29 },
    tappedPx: CENTRE,
    sensedPose: { headingDeg: 222, pitchDeg: 29, rollDeg: 0 },
    drawnHeadingDeg: 222,
    framePx: FRAME,
    principalPointPx: CENTRE,
    visibleHFovDeg: HFOV_DEG,
    ...partial,
  };
}

describe('reanchorFromTap — the heading', () => {
  it('puts the heading on the reference when the tap is at the principal point', () => {
    const result = reanchorFromTap(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // atan(0) = 0, so heading = azimuth exactly.
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(130, 12);
    // The sensed heading is 222°: 130 − 222 = −92, which is the real error this
    // exists for (IMG_7270, X-10).
    expect(result.value.grossHeadingOffsetDeg).toBeCloseTo(-92, 12);
  });

  it('subtracts atan((x − c)/f) on the horizon: a tap f/√3 to the right is 30° off axis', () => {
    // At altitude 0 with no roll: sin P = 0, so P = 0 and the heading is
    // azimuth − atan2(1/√3, 1) = 130 − 30.
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 0 },
        sensedPose: { headingDeg: 222, pitchDeg: 0, rollDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx + THIRTY_DEG_PX, yPx: CENTRE.yPx },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(100, 12);
    expect(result.value.pitchTrimDeg).toBeCloseTo(0, 12);
  });

  it('adds it on the other side: the same tap to the left', () => {
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 0 },
        sensedPose: { headingDeg: 222, pitchDeg: 0, rollDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx - THIRTY_DEG_PX, yPx: CENTRE.yPx },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(160, 12);
  });

  it('allows for the foreshortening of a tap off axis with the Sun 30° up', () => {
    // Tap f/√3 right of centre on the horizontal centre line, so a = 1/√3, b = 0.
    // sin P = sin 30° · √(1 + 1/3) = ½ · 2/√3 = 1/√3, so cos P = √(2/3), and
    // the ray's azimuth is atan(a / cos P) = atan(1/√2). Heading = 130 − that,
    // pitch = asin(1/√3). The separate-axes formula said 100° and 30°.
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 30 },
        sensedPose: { headingDeg: 222, pitchDeg: 30, rollDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx + THIRTY_DEG_PX, yPx: CENTRE.yPx },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const DEG = 180 / Math.PI;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(130 - Math.atan(1 / Math.SQRT2) * DEG, 10);
    expect(result.value.pitchTrimDeg).toBeCloseTo(Math.asin(1 / Math.sqrt(3)) * DEG - 30, 10);
  });

  it('wraps the anchored heading into [0, 360) rather than reporting −5°', () => {
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 10, altitudeDeg: 0 },
        sensedPose: { headingDeg: 222, pitchDeg: 0, rollDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx + THIRTY_DEG_PX, yPx: CENTRE.yPx },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(340, 12);
  });

  it('reports the gross offset on the short way round, never as 268°', () => {
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 0 },
        sensedPose: { headingDeg: 222, pitchDeg: 0, rollDeg: 0 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grossHeadingOffsetDeg).toBeCloseTo(-92, 12);
  });
});

describe('reanchorFromTap — the pitch', () => {
  it('adds atan((y − c)/f): a reference 10° below the axis wants the camera 10° higher', () => {
    // Screen y grows downward, so a reference 10° below the axis means the
    // camera is pointed 10° ABOVE it: 29° + 10° against a sensed 29°.
    const result = reanchorFromTap(
      input({ tappedPx: { xPx: CENTRE.xPx, yPx: CENTRE.yPx + TEN_DEG_PX } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pitchTrimDeg).toBeCloseTo(10, 10);
  });

  it('subtracts it for a reference above the axis', () => {
    const result = reanchorFromTap(
      input({ tappedPx: { xPx: CENTRE.xPx, yPx: CENTRE.yPx - TEN_DEG_PX } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pitchTrimDeg).toBeCloseTo(-10, 10);
  });

  it('refuses a tap whose pitch answer is past the ±20° trim, rather than a heading solved there', () => {
    // Wanted pitch 29° + 10° = 39°; against a sensed 0° that is +39°, past the
    // slider and far past any tilt sensor's credible bias.
    const result = reanchorFromTap(
      input({
        sensedPose: { headingDeg: 222, pitchDeg: 0, rollDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx, yPx: CENTRE.yPx + TEN_DEG_PX },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.refusal).toBe('tilt-out-of-range');
    expect(result.ok ? '' : result.detail).toContain('39°');
  });

  it('accepts a pitch answer just inside the trim and refuses one just outside', () => {
    // On the axis the wanted pitch is the altitude, 29°; the trim is 29 − sensed.
    const inside = reanchorFromTap(
      input({ sensedPose: { headingDeg: 222, pitchDeg: 29 - TRIM_LIMIT_DEG.pitchDeg + 0.01, rollDeg: 0 } }),
    );
    expect(inside.ok).toBe(true);
    const outside = reanchorFromTap(
      input({ sensedPose: { headingDeg: 222, pitchDeg: 29 - TRIM_LIMIT_DEG.pitchDeg - 0.01, rollDeg: 0 } }),
    );
    expect(outside.ok).toBe(false);
  });

  it('is zero when the tap sits on the axis and the sensed pitch already agrees', () => {
    const result = reanchorFromTap(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pitchTrimDeg).toBeCloseTo(0, 12);
  });
});

describe('reanchorFromTap — the sentence and the direction', () => {
  it('says the labels turn right when the heading correction is negative', () => {
    // Drawn at 222°, anchored at 130°: the camera is treated as pointing 92°
    // further LEFT, so what it is looking at moves right across the frame.
    const result = reanchorFromTap(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.moveDeg).toBeCloseTo(92, 12);
    expect(result.value.moveDirection).toBe('right');
    expect(result.value.sentence).toBe('This turns the labels 92° to the right.');
  });

  it('says left for the opposite sign', () => {
    const result = reanchorFromTap(
      input({ sensedPose: { headingDeg: 38, pitchDeg: 29, rollDeg: 0 }, drawnHeadingDeg: 38 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sentence).toBe('This turns the labels 92° to the left.');
  });

  it('measures the move from what is DRAWN, not from what the compass says', () => {
    // A fine trim of +10° is already in force, so the labels only have 82° to go
    // even though the compass is still 92° out.
    const result = reanchorFromTap(input({ drawnHeadingDeg: 232 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.moveDeg).toBeCloseTo(102, 12);
    expect(result.value.grossHeadingOffsetDeg).toBeCloseTo(-92, 12);
  });

  it('takes the short way round a move that straddles north', () => {
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 10, altitudeDeg: 0 },
        sensedPose: { headingDeg: 350, pitchDeg: 0, rollDeg: 0 },
        drawnHeadingDeg: 350,
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.moveDeg).toBeCloseTo(20, 12);
    expect(result.value.moveDirection).toBe('left');
  });

  it('rounds the sentence to whole degrees, because a beginner reads it once', () => {
    expect(reanchorSentence(91.6, 'right')).toBe('This turns the labels 92° to the right.');
  });
});

describe('reanchorFromTap — inverting the projection the overlay draws with', () => {
  // A forward projection through `projectToImage` at a known pose, handed back
  // as a tap, must return that pose. The pose is the answer; nothing here was
  // read off a run of the solver.
  const WIDTH = 956;
  const HEIGHT = 440;
  const H_FOV = 73.74;
  const V_FOV =
    (2 * Math.atan((Math.tan((H_FOV * Math.PI) / 360) * HEIGHT) / WIDTH) * 180) / Math.PI;
  const TRUE_HEADING = 200;
  const SENSED_HEADING = 292;

  const cases: { altitudeDeg: number; offAxisDeg: number; rollDeg: number; pitchDeg: number }[] =
    [];
  for (const altitudeDeg of [-5, 5, 15, 30, 50]) {
    for (const offAxisDeg of [-35, -20, -10, 0, 10, 20, 35]) {
      for (const rollDeg of [-15, 0, 8]) {
        // The camera pointed a little below the reference, as a hand holds it.
        cases.push({ altitudeDeg, offAxisDeg, rollDeg, pitchDeg: altitudeDeg - 4 });
      }
    }
  }

  it.each(cases)(
    'recovers heading and pitch to 0.05° at altitude $altitudeDeg°, $offAxisDeg° off axis, roll $rollDeg°',
    ({ altitudeDeg, offAxisDeg, rollDeg, pitchDeg }) => {
      const azimuthDeg = TRUE_HEADING + offAxisDeg;
      const drawn = projectToImage(
        { headingDeg: TRUE_HEADING, pitchDeg, rollDeg, hFovDeg: H_FOV, vFovDeg: V_FOV },
        azimuthDeg,
        altitudeDeg,
      );
      // A reference off the picture cannot be tapped; the grid keeps the ones
      // that land on it and requires most of them to.
      if (!drawn.inFrame) return;
      const sensedPitchDeg = pitchDeg + 3;
      const result = reanchorFromTap({
        reference: { name: 'the sun', azimuthDeg, altitudeDeg },
        tappedPx: { xPx: drawn.x * WIDTH, yPx: drawn.y * HEIGHT },
        sensedPose: { headingDeg: SENSED_HEADING, pitchDeg: sensedPitchDeg, rollDeg },
        drawnHeadingDeg: SENSED_HEADING,
        framePx: { widthPx: WIDTH, heightPx: HEIGHT },
        principalPointPx: { xPx: WIDTH / 2, yPx: HEIGHT / 2 },
        visibleHFovDeg: H_FOV,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const headingErrorDeg = ((result.value.anchoredHeadingDeg - TRUE_HEADING + 540) % 360) - 180;
      expect(Math.abs(headingErrorDeg)).toBeLessThan(0.05);
      expect(Math.abs(result.value.pitchTrimDeg - (pitchDeg - sensedPitchDeg))).toBeLessThan(0.05);
    },
  );

  it('keeps most of the grid on the picture, so the check above is not vacuous', () => {
    const inFrame = cases.filter(({ altitudeDeg, offAxisDeg, rollDeg, pitchDeg }) =>
      projectToImage(
        { headingDeg: TRUE_HEADING, pitchDeg, rollDeg, hFovDeg: H_FOV, vFovDeg: V_FOV },
        TRUE_HEADING + offAxisDeg,
        altitudeDeg,
      ).inFrame,
    );
    expect(inFrame.length).toBeGreaterThan(cases.length * 0.8);
  });

  it('recovers a summit below the horizon, Deer Point at −4.5°, 25° off axis', () => {
    const drawn = projectToImage(
      { headingDeg: 140, pitchDeg: -2, rollDeg: 3, hFovDeg: H_FOV, vFovDeg: V_FOV },
      165,
      -4.5,
    );
    expect(drawn.inFrame).toBe(true);
    const result = reanchorFromTap({
      reference: { name: 'Deer Point', azimuthDeg: 165, altitudeDeg: -4.5 },
      tappedPx: { xPx: drawn.x * WIDTH, yPx: drawn.y * HEIGHT },
      sensedPose: { headingDeg: 232, pitchDeg: 0, rollDeg: 3 },
      drawnHeadingDeg: 232,
      framePx: { widthPx: WIDTH, heightPx: HEIGHT },
      principalPointPx: { xPx: WIDTH / 2, yPx: HEIGHT / 2 },
      visibleHFovDeg: H_FOV,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(140, 6);
    expect(result.value.pitchTrimDeg).toBeCloseTo(-2, 6);
    expect(result.value.grossHeadingOffsetDeg).toBeCloseTo(-92, 6);
  });
});

describe('reanchorFromTap — refusals', () => {
  it('refuses a tap no pose can explain rather than returning NaN', () => {
    // The Sun at 89° cannot sit far off the vertical axis: the ray's elevation
    // tops out below it, so the asin argument exceeds 1.
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 130, altitudeDeg: 89 },
        tappedPx: { xPx: 790, yPx: 440 },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('no-pose');
  });


  it('refuses a frame with no picture in it', () => {
    const result = reanchorFromTap(input({ framePx: { widthPx: 0, heightPx: 0 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('no-frame');
  });

  it('refuses a field of view no lens has', () => {
    const result = reanchorFromTap(input({ visibleHFovDeg: 180 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('no-frame');
  });

  it('refuses a tap off the picture rather than solving a pose from it', () => {
    const result = reanchorFromTap(input({ tappedPx: { xPx: 900, yPx: 225 } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('tap-outside-frame');
  });
});

describe('azimuthInBasis', () => {
  it('leaves a true-north pose alone, model or not', () => {
    expect(azimuthInBasis(130, 'true', 2.5)).toBeCloseTo(130, 12);
    expect(azimuthInBasis(130, 'true-model', 2.5)).toBeCloseTo(130, 12);
  });

  it('subtracts the declination for a magnetic pose', () => {
    expect(azimuthInBasis(130, 'magnetic', 2.5)).toBeCloseTo(127.5, 12);
    expect(azimuthInBasis(1, 'magnetic', 5)).toBeCloseTo(356, 12);
  });

  it('refuses a magnetic pose with no declination rather than guessing zero', () => {
    expect(azimuthInBasis(130, 'magnetic', undefined)).toBeUndefined();
  });
});

describe('grossHeadingWarning', () => {
  it('names the size of the error and what to do about it', () => {
    expect(grossHeadingWarning(222, 130)).toBe(
      'The compass looks 92° off — tap the sun (or a summit you know) to fix it.',
    );
  });

  it('stays quiet inside the threshold, and speaks just outside it', () => {
    expect(grossHeadingWarning(100, 100 + GROSS_HEADING_WARNING_DEG)).toBeUndefined();
    expect(grossHeadingWarning(100, 100 + GROSS_HEADING_WARNING_DEG + 1)).toContain('21° off');
  });

  it('measures the short way round north', () => {
    expect(grossHeadingWarning(355, 5)).toBeUndefined();
    expect(grossHeadingWarning(350, 40)).toContain('50° off');
  });
});

describe('anchorDrift', () => {
  /** A drift check with the two headings and the two yaws named. */
  const drift = (
    compass: [number, number],
    yaw: [number, number] | undefined,
    bandDeg: number,
  ): ReturnType<typeof anchorDrift> =>
    anchorDrift({
      anchoredAtSensedHeadingDeg: compass[0],
      sensedHeadingDeg: compass[1],
      anchoredAtYawDeg: yaw?.[0],
      yawDeg: yaw?.[1],
      bandDeg,
    });

  it('stays quiet through a deliberate 45° turn, where both move together', () => {
    // The compass reads 45° further round and the phone turned 45°, so the
    // compass did nothing the phone did not: 45 − 45 = 0.
    const turned = drift([200, 245], [100, 145], 1.2);
    expect(turned.gapDeg).toBeCloseTo(45, 10);
    expect(turned.turnDeg).toBeCloseTo(45, 10);
    expect(turned.driftDeg).toBeCloseTo(0, 10);
    expect(turned.beyondBand).toBe(false);
  });

  it('warns on a 30° compass fault with the phone standing still', () => {
    // 30 − 0 = 30, against a 1.2° band.
    const faulty = drift([200, 230], [100, 100], 1.2);
    expect(faulty.driftDeg).toBeCloseTo(30, 10);
    expect(faulty.beyondBand).toBe(true);
    expect(faulty.text).toContain('30.0°');
    expect(faulty.text).toContain('Fix the direction again');
  });

  it('keeps a turn with a small compass error inside the band', () => {
    // A 45° turn the compass read as 45.5°: 0.5° of error, inside 1.2°.
    const nearly = drift([200, 245.5], [100, 145], 1.2);
    expect(nearly.driftDeg).toBeCloseTo(0.5, 10);
    expect(nearly.beyondBand).toBe(false);
  });

  it('takes the short way round north on both angles', () => {
    // Compass 359 → 1 is +2°; yaw 350 → 359 is +9°. The compass fell 7° behind.
    const wrapped = drift([359, 1], [350, 359], 5);
    expect(wrapped.gapDeg).toBeCloseTo(2, 10);
    expect(wrapped.turnDeg).toBeCloseTo(9, 10);
    expect(wrapped.driftDeg).toBeCloseTo(-7, 10);
    expect(wrapped.beyondBand).toBe(true);
    expect(wrapped.text).toContain('7.0°');
  });

  it('cannot warn when the screen claims no band at all', () => {
    expect(drift([222, 280], [100, 100], 0).beyondBand).toBe(false);
  });

  it('says a turn cannot be told apart when the phone reports no yaw', () => {
    const blind = drift([200, 230], undefined, 1.2);
    expect(blind.turnDeg).toBeUndefined();
    expect(blind.driftDeg).toBeUndefined();
    expect(blind.beyondBand).toBe(false);
    expect(blind.text).toContain('30.0°');
    expect(blind.text).toContain('cannot be told apart');
  });

  it('is equally blind when only one end of the pair has a yaw', () => {
    expect(
      anchorDrift({
        anchoredAtSensedHeadingDeg: 200,
        sensedHeadingDeg: 230,
        anchoredAtYawDeg: 100,
        yawDeg: undefined,
        bandDeg: 1.2,
      }).beyondBand,
    ).toBe(false);
  });
});

describe('readsAsSunTap', () => {
  const TAP = { xPx: 400, yPx: 225 };
  const summitAt = (xPx: number): Parameters<typeof readsAsSunTap>[1] => ({
    kind: 'summit',
    name: 'Deer Point',
    drawnPx: { xPx, yPx: 225 },
  });

  it('reads an unclaimed tap and a tap the Sun claimed as a Sun tap', () => {
    expect(readsAsSunTap(TAP, undefined)).toBe(true);
    expect(readsAsSunTap(TAP, { kind: 'sun', name: 'the Sun', drawnPx: { xPx: 0, yPx: 0 } })).toBe(
      true,
    );
  });

  it('leaves a tap on a summit dot within 160 px to the summit', () => {
    expect(readsAsSunTap(TAP, summitAt(400 + 160))).toBe(false);
    expect(readsAsSunTap(TAP, summitAt(400 - 30))).toBe(false);
  });

  it('reads a tap a far summit dot claimed as a Sun tap', () => {
    // 161 px away: past the 160 px a tap is attributed within on the field step.
    expect(readsAsSunTap(TAP, summitAt(400 + 161))).toBe(true);
  });
});
