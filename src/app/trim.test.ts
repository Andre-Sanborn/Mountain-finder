/**
 * Trim arithmetic. Every expectation below is derived from closed-form
 * geometry and written out as a literal — never by running `applyTrim` and
 * pasting what it said.
 *
 * The field-of-view cases lean on the 3-4-5 right triangle, whose angles are
 * standard reference values:
 *
 *   atan(3/4) = 36.869897645844021°   → 2·atan(3/4) =  73.73979529168804°
 *   atan(4/3) = 53.130102354155978°   → 2·atan(4/3) = 106.26020470831196°
 *
 * A pose with hFov = 90° and vFov = 73.73979529168804° therefore has aspect
 * ratio tan(vFov/2)/tan(hFov/2) = 0.75/1 = 3/4 exactly — a 4:3 frame.
 */

import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../core/types';
import {
  applyTrim,
  aspectRatioOfPose,
  isUntrimmed,
  NO_GROSS_HEADING_OFFSET_DEG,
  NO_TRIM,
  TRIM_LIMIT_DEG,
  type TrimState,
} from './trim';

/** 2·atan(3/4), the vertical FOV of a 4:3 frame whose horizontal FOV is 90°. */
const TWO_ATAN_THREE_QUARTERS = 73.73979529168804;
/** 2·atan(4/3). */
const TWO_ATAN_FOUR_THIRDS = 106.26020470831196;

const FOUR_BY_THREE: CameraPose = {
  headingDeg: 137.25,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 90,
  vFovDeg: TWO_ATAN_THREE_QUARTERS,
};

const trim = (partial: Partial<TrimState>): TrimState => ({ ...NO_TRIM, ...partial });

describe('applyTrim — heading', () => {
  it('adds the offset exactly', () => {
    const result = applyTrim(FOUR_BY_THREE, trim({ headingDeg: 12.5 }));
    expect(result.headingDeg).toBeCloseTo(149.75, 12);
  });

  it('wraps past north rather than reporting 370°', () => {
    const pose = { ...FOUR_BY_THREE, headingDeg: 355 };
    expect(applyTrim(pose, trim({ headingDeg: 20 })).headingDeg).toBeCloseTo(15, 12);
  });

  it('wraps below zero rather than reporting a negative bearing', () => {
    const pose = { ...FOUR_BY_THREE, headingDeg: 5 };
    expect(applyTrim(pose, trim({ headingDeg: -20 })).headingDeg).toBeCloseTo(345, 12);
  });
});

describe('applyTrim — the gross heading offset', () => {
  it('is zero when it is not given, so the fine trim alone is unchanged', () => {
    const trimmed = trim({ headingDeg: 12.5 });
    expect(applyTrim(FOUR_BY_THREE, trimmed, NO_GROSS_HEADING_OFFSET_DEG)).toEqual(
      applyTrim(FOUR_BY_THREE, trimmed),
    );
  });

  it('adds beside the fine trim rather than replacing it', () => {
    // 137.25 + 12.5 + 92 = 241.75.
    const result = applyTrim(FOUR_BY_THREE, trim({ headingDeg: 12.5 }), 92);
    expect(result.headingDeg).toBeCloseTo(241.75, 12);
  });

  it('is not clamped, which is the whole reason it is separate', () => {
    const past = TRIM_LIMIT_DEG.headingDeg + 62;
    expect(applyTrim(FOUR_BY_THREE, NO_TRIM, past).headingDeg).toBeCloseTo(137.25 + past, 12);
  });

  it('wraps the total past north like any other heading', () => {
    expect(applyTrim(FOUR_BY_THREE, NO_TRIM, 240).headingDeg).toBeCloseTo(17.25, 12);
  });

  it('changes nothing but the heading', () => {
    const plain = applyTrim(FOUR_BY_THREE, NO_TRIM);
    const offset = applyTrim(FOUR_BY_THREE, NO_TRIM, 92);
    expect({ ...offset, headingDeg: plain.headingDeg }).toEqual(plain);
  });
});

describe('applyTrim — pitch and roll', () => {
  it('adds the pitch offset and leaves roll alone', () => {
    const pose = { ...FOUR_BY_THREE, pitchDeg: -3, rollDeg: 1.5 };
    const result = applyTrim(pose, trim({ pitchDeg: 2.25 }));
    expect(result.pitchDeg).toBeCloseTo(-0.75, 12);
    expect(result.rollDeg).toBe(1.5);
  });

  it('clamps pitch at the zenith', () => {
    const pose = { ...FOUR_BY_THREE, pitchDeg: 85 };
    expect(applyTrim(pose, trim({ pitchDeg: 20 })).pitchDeg).toBe(90);
  });
});

describe('applyTrim — field of view', () => {
  it('keeps a square frame square: vFov tracks hFov exactly when aspect is 1', () => {
    // tan(45°)/tan(45°) = 1, so vFov must equal hFov for any trim.
    const square: CameraPose = { ...FOUR_BY_THREE, hFovDeg: 90, vFovDeg: 90 };
    const result = applyTrim(square, trim({ hFovDeg: 10 }));
    expect(result.hFovDeg).toBeCloseTo(100, 12);
    expect(result.vFovDeg).toBeCloseTo(100, 12);
  });

  it('re-derives vFov through the tangent relation, not linearly', () => {
    // 4:3 frame, hFov 90° → 106.26020470831196° (= 2·atan(4/3)).
    // tan(hFov'/2) = 4/3, so tan(vFov'/2) = (4/3)·(3/4) = 1 → vFov' = 90°.
    // A LINEAR scaling would have given 73.7398 × 106.2602/90 = 87.049°, so this
    // case separates the correct relation from the plausible-looking wrong one.
    const result = applyTrim(FOUR_BY_THREE, trim({ hFovDeg: TWO_ATAN_FOUR_THIRDS - 90 }));
    expect(result.hFovDeg).toBeCloseTo(TWO_ATAN_FOUR_THIRDS, 10);
    expect(result.vFovDeg).toBeCloseTo(90, 10);
    expect(result.vFovDeg).not.toBeCloseTo(87.049, 2);
  });

  it('clamps the horizontal field of view to a physically sane range', () => {
    expect(applyTrim(FOUR_BY_THREE, trim({ hFovDeg: 200 })).hFovDeg).toBe(175);
    const narrow = { ...FOUR_BY_THREE, hFovDeg: 5, vFovDeg: 3.75 };
    expect(applyTrim(narrow, trim({ hFovDeg: -20 })).hFovDeg).toBe(1);
  });

  it('leaves vFov untouched when the pose angles cannot define an aspect ratio', () => {
    const broken: CameraPose = { ...FOUR_BY_THREE, vFovDeg: 0 };
    expect(applyTrim(broken, trim({ hFovDeg: 5 })).vFovDeg).toBe(0);
  });
});

describe('aspectRatioOfPose', () => {
  it('recovers 3/4 from a 4:3 pose', () => {
    expect(aspectRatioOfPose(FOUR_BY_THREE)).toBeCloseTo(0.75, 12);
  });

  it('refuses to invent a ratio from an out-of-range angle', () => {
    expect(aspectRatioOfPose({ ...FOUR_BY_THREE, hFovDeg: 180 })).toBeUndefined();
    expect(aspectRatioOfPose({ ...FOUR_BY_THREE, vFovDeg: Number.NaN })).toBeUndefined();
  });
});

describe('isUntrimmed', () => {
  it('is true only when all three offsets are zero', () => {
    expect(isUntrimmed(NO_TRIM)).toBe(true);
    expect(isUntrimmed(trim({ pitchDeg: -0.25 }))).toBe(false);
  });
});

describe('the identity case', () => {
  it('returns the pose unchanged when nothing is trimmed', () => {
    const result = applyTrim(FOUR_BY_THREE, NO_TRIM);
    expect(result.headingDeg).toBeCloseTo(FOUR_BY_THREE.headingDeg, 12);
    expect(result.pitchDeg).toBe(FOUR_BY_THREE.pitchDeg);
    expect(result.hFovDeg).toBe(FOUR_BY_THREE.hFovDeg);
    expect(result.vFovDeg).toBeCloseTo(FOUR_BY_THREE.vFovDeg, 10);
  });
});
