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

import { TRIM_LIMIT_DEG } from '../trim';

import {
  anchorDrift,
  azimuthInBasis,
  grossHeadingWarning,
  GROSS_HEADING_WARNING_DEG,
  reanchorFromTap,
  reanchorSentence,
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
    sensedPose: { headingDeg: 222, pitchDeg: 29 },
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

  it('subtracts atan((x − c)/f): a tap f/√3 to the right is 30° off axis', () => {
    const result = reanchorFromTap(
      input({ tappedPx: { xPx: CENTRE.xPx + THIRTY_DEG_PX, yPx: CENTRE.yPx } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(100, 12);
  });

  it('adds it on the other side: the same tap to the left', () => {
    const result = reanchorFromTap(
      input({ tappedPx: { xPx: CENTRE.xPx - THIRTY_DEG_PX, yPx: CENTRE.yPx } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.anchoredHeadingDeg).toBeCloseTo(160, 12);
  });

  it('wraps the anchored heading into [0, 360) rather than reporting −5°', () => {
    const result = reanchorFromTap(
      input({
        reference: { name: 'the sun', azimuthDeg: 10, altitudeDeg: 0 },
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
        sensedPose: { headingDeg: 222, pitchDeg: 0 },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.grossHeadingOffsetDeg).toBeCloseTo(-92, 12);
  });
});

describe('reanchorFromTap — the pitch', () => {
  it('adds atan((y − c)/f), and clamps an answer no slider could hold', () => {
    // Screen y grows downward, so a reference 10° below the axis means the
    // camera is pointed 10° ABOVE it. Reference altitude 29°, so the wanted
    // pitch is 39°; against a sensed pitch of 0° that is +39, past the ±20°
    // slider, so it comes back at the clamp.
    const result = reanchorFromTap(
      input({
        sensedPose: { headingDeg: 222, pitchDeg: 0 },
        tappedPx: { xPx: CENTRE.xPx, yPx: CENTRE.yPx + TEN_DEG_PX },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pitchTrimDeg).toBeCloseTo(TRIM_LIMIT_DEG.pitchDeg, 12);
    expect(result.value.pitchClamped).toBe(true);
  });

  it('leaves a small pitch answer unclamped and says so', () => {
    const result = reanchorFromTap(
      input({ tappedPx: { xPx: CENTRE.xPx, yPx: CENTRE.yPx - TEN_DEG_PX } }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pitchTrimDeg).toBeCloseTo(-10, 10);
    expect(result.value.pitchClamped).toBe(false);
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
      input({ sensedPose: { headingDeg: 38, pitchDeg: 29 }, drawnHeadingDeg: 38 }),
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
        sensedPose: { headingDeg: 350, pitchDeg: 0 },
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

describe('reanchorFromTap — refusals', () => {
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
  it('is quiet while the compass stays inside the band the screen claims', () => {
    const drift = anchorDrift(222.4, 222, 1.2);
    expect(drift.gapDeg).toBeCloseTo(0.4, 10);
    expect(drift.beyondBand).toBe(false);
  });

  it('warns once the compass has moved further than the band', () => {
    const drift = anchorDrift(225, 222, 1.2);
    expect(drift.beyondBand).toBe(true);
    expect(drift.text).toContain('3.0°');
    expect(drift.text).toContain('Fix the direction again');
  });

  it('takes the short way round north rather than reporting 359°', () => {
    expect(anchorDrift(1, 359, 5).gapDeg).toBeCloseTo(2, 10);
  });

  it('cannot warn when the screen claims no band at all', () => {
    expect(anchorDrift(280, 222, 0).beyondBand).toBe(false);
  });
});
