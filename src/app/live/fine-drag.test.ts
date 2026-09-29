/**
 * Fine drag — exactly four times slower, in degrees.
 *
 * The expectations are the closed form of the drag geometry, written out here:
 *
 *     angle(dPx) = atan( (dPx / extentPx) · 2·tan(fov/2) )
 *
 * and the gain multiplies that angle. The ratio between the two modes is
 * therefore exactly 1/4 at every drag length, which is the claim the screen makes
 * and is asserted at three lengths rather than one. The alternative
 * implementation — quartering the PIXELS — is also computed here, and shown to
 * miss 1/4 by 0.7 % at 100 px, which is why it is not the one used.
 */

import { describe, expect, it } from 'vitest';

import { dragAngleDeg, trimFromDrag } from '../../live/drag-trim';
import { NO_TRIM, TRIM_LIMIT_DEG } from '../trim';
import {
  CSS_PX_PER_MM,
  dragGain,
  dragStepSentence,
  dragStepSize,
  FINE_DRAG_FACTOR,
  trimFromDragAtGain,
} from './fine-drag';

/** The field-test frame: iPhone 17 Pro Max in landscape, 24 mm-equivalent main lens. */
const FRAME = { widthPx: 956, heightPx: 440 };
const FOV = { hFovDeg: 73.739795, vFovDeg: 2 * (Math.atan(0.5) * 180) / Math.PI };

describe('dragGain', () => {
  it('is 1 for normal and a quarter for fine', () => {
    expect(dragGain('normal')).toBe(1);
    expect(dragGain('fine')).toBe(1 / FINE_DRAG_FACTOR);
    expect(FINE_DRAG_FACTOR).toBe(4);
  });
});

describe('trimFromDragAtGain', () => {
  it('is `trimFromDrag` at gain 1, so the two cannot drift apart', () => {
    for (const dx of [-300, -17, 1, 64, 250]) {
      const drag = { dx, dy: dx / 3 };
      expect(trimFromDragAtGain(NO_TRIM, drag, FRAME, FOV, 1)).toEqual(
        trimFromDrag(NO_TRIM, drag, FRAME, FOV),
      );
    }
  });

  it('moves the labels exactly a quarter as far in fine mode, at every drag length', () => {
    // Every length here stays inside the ±30° heading clamp; a drag that hit the
    // clamp at normal gain would compare a clamped angle with an unclamped one.
    for (const dx of [10, 100, 250]) {
      const normal = trimFromDragAtGain(NO_TRIM, { dx, dy: 0 }, FRAME, FOV, dragGain('normal'));
      const fine = trimFromDragAtGain(NO_TRIM, { dx, dy: 0 }, FRAME, FOV, dragGain('fine'));
      expect(fine.headingDeg).toBeCloseTo(normal.headingDeg / 4, 12);
    }
  });

  it('is not the same as quartering the pixels, which is what makes the ratio exact', () => {
    // The projection is linear in the tangent of the angle, so a quarter of the
    // pixels is not a quarter of the angle. At 100 px across this frame,
    // k = (100/956)·2·tan(36.869898°) = 0.15690376, and
    // atan(k/4) / atan(k) = 0.2519091 rather than 0.25.
    const full = dragAngleDeg(100, FRAME.widthPx, FOV.hFovDeg);
    const quarterPixels = dragAngleDeg(25, FRAME.widthPx, FOV.hFovDeg);
    expect(full).toBeCloseTo(8.917221, 5);
    expect(quarterPixels / full).toBeCloseTo(0.2519091, 6);
    expect(quarterPixels / full).not.toBeCloseTo(0.25, 3);
  });

  it('applies the gain before the sliders’ own clamp', () => {
    // A drag long enough to hit the ±30° heading limit at normal gain stays well
    // inside it at fine gain, so a long fine drag is usable rather than pinned.
    const long = { dx: 3000, dy: 0 };
    expect(
      Math.abs(trimFromDragAtGain(NO_TRIM, long, FRAME, FOV, 1).headingDeg),
    ).toBe(TRIM_LIMIT_DEG.headingDeg);
    expect(
      Math.abs(trimFromDragAtGain(NO_TRIM, long, FRAME, FOV, 0.25).headingDeg),
    ).toBeLessThan(TRIM_LIMIT_DEG.headingDeg);
  });

  it('leaves the field-of-view nudge alone, as a one-finger drag must', () => {
    const base = { headingDeg: 1, pitchDeg: -2, hFovDeg: 3 };
    expect(trimFromDragAtGain(base, { dx: 50, dy: 50 }, FRAME, FOV, 0.25).hFovDeg).toBe(3);
  });
});

describe('dragStepSize', () => {
  it('reproduces the budget’s own drag-precision figure at normal gain', () => {
    // docs/FIELD-TEST-PREREGISTRATION.md: 11.1235 CSS px per degree at frame
    // centre, so 1 px is 0.08990° and 1 mm of glass (6.037 px at 460 ppi) is
    // 0.5427°. That 0.543° is term 9 of the error budget.
    const step = dragStepSize(FRAME, FOV, 1);
    expect(1 / step.perPxDeg).toBeCloseTo(11.1235, 3);
    expect(step.perMmDeg).toBeCloseTo(0.5427, 4);
    expect(CSS_PX_PER_MM).toBeCloseTo(6.037, 3);
  });

  it('is 0.136° per millimetre in fine mode, which is the mode’s whole point', () => {
    expect(dragStepSize(FRAME, FOV, dragGain('fine')).perMmDeg).toBeCloseTo(0.1357, 4);
  });

  it('is the derivative of the drag angle at zero, so the two agree on small drags', () => {
    const step = dragStepSize(FRAME, FOV, 1);
    expect(dragAngleDeg(1, FRAME.widthPx, FOV.hFovDeg)).toBeCloseTo(step.perPxDeg, 6);
  });

  it('is 0 for a frame with no extent, rather than dividing by zero', () => {
    expect(dragStepSize({ widthPx: 0, heightPx: 0 }, FOV, 1).perPxDeg).toBe(0);
  });
});

describe('dragStepSentence', () => {
  it('names the mode and both units', () => {
    const fine = dragStepSentence('fine', dragStepSize(FRAME, FOV, dragGain('fine')));
    expect(fine).toContain('Fine drag');
    expect(fine).toContain('0.136°');
    expect(fine).toContain('per pixel');
    expect(dragStepSentence('normal', dragStepSize(FRAME, FOV, 1))).toContain('Normal drag');
  });
});
