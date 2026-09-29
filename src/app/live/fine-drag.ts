/**
 * Fine drag — the same gesture, four times slower, and the step size on screen.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SLOW MODE EXISTS AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * Drag precision is the largest single term in the field-test error budget:
 * 0.543° at 1σ, against a combined 0.95° (docs/FIELD-TEST-PREREGISTRATION.md,
 * term 9). It is 1 mm of finger on the glass — 6.037 CSS px at 460 ppi, at
 * 11.1235 px per degree. Nothing about the geometry reduces it; only a lower gain
 * does. At {@link FINE_DRAG_FACTOR} the same millimetre of finger is 0.136°,
 * which drops that term below the roll and field-of-view terms beside it.
 *
 * ── WHY THE GAIN SCALES THE ANGLE AND NOT THE PIXELS ───────────────────────
 * Quartering the pixel delta before `dragAngleDeg` would be the other obvious
 * implementation, and it is not 4× slower: the projection is linear in the
 * TANGENT of the angle, so a quarter of a 100 px drag at 73.74° across 956 px
 * comes back as 0.2518 of the angle rather than 0.25 of it. The claim on screen
 * is in degrees, so the gain is applied to degrees and the ratio is exact at
 * every drag length.
 *
 * ── WHY 0.05° NUDGE BUTTONS ARE NOT THE ANSWER ─────────────────────────────
 * One pixel is 0.0899° in the budget frame, so a 0.05° button cannot be
 * expressed on screen: two taps of it would move the overlay by either one pixel
 * or two, depending on where the rounding fell. A gain on the gesture people
 * already use has no quantisation of its own.
 *
 * Pure: pixels, a frame and a field of view in, degrees out.
 */

import { dragAngleDeg, type DragPx, type FramePx, type FrameFov } from '../../live/drag-trim';
import { TRIM_LIMIT_DEG, type TrimState } from '../trim';

/** How much slower fine drag is than normal drag. */
export const FINE_DRAG_FACTOR = 4;

/**
 * CSS pixels per millimetre of glass on the field-test phone.
 *
 * 460 ppi at a device pixel ratio of 3, transcribed from
 * docs/FIELD-TEST-PREREGISTRATION.md's frame table. Used only to put the step
 * size in a unit a finger has; the degrees-per-pixel figure beside it is exact
 * for whatever screen the page is actually on.
 */
export const CSS_PX_PER_MM = 6.037;

export type DragMode = 'normal' | 'fine';

/** The multiplier on the drag angle for a mode. */
export function dragGain(mode: DragMode): number {
  return mode === 'fine' ? 1 / FINE_DRAG_FACTOR : 1;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * The trim after a drag of `drag` pixels from `base`, at a gain.
 *
 * At gain 1 this is `trimFromDrag`, asserted as an identity in the tests rather
 * than left to inspection — the two must not drift apart, because the fine mode's
 * whole claim is a ratio between them. The clamp is the sliders' own
 * `TRIM_LIMIT_DEG`, applied after the gain, so a long fine drag stops where a
 * long normal drag stops.
 */
export function trimFromDragAtGain(
  base: TrimState,
  drag: DragPx,
  frame: FramePx,
  fov: FrameFov,
  gain: number,
): TrimState {
  return {
    headingDeg: clamp(
      base.headingDeg - gain * dragAngleDeg(drag.dx, frame.widthPx, fov.hFovDeg),
      TRIM_LIMIT_DEG.headingDeg,
    ),
    pitchDeg: clamp(
      base.pitchDeg + gain * dragAngleDeg(drag.dy, frame.heightPx, fov.vFovDeg),
      TRIM_LIMIT_DEG.pitchDeg,
    ),
    hFovDeg: base.hFovDeg,
  };
}

export interface DragStepSize {
  /** Degrees the overlay moves per CSS pixel of finger, at frame centre. */
  readonly perPxDeg: number;
  /** The same figure per millimetre of glass, at {@link CSS_PX_PER_MM}. */
  readonly perMmDeg: number;
}

/**
 * How coarse the gesture is, across the frame, at this gain.
 *
 * The horizontal axis only: heading is what the drag is for, and a readout with
 * two numbers in it is one nobody reads on a 400 px screen. The scale is taken
 * at frame CENTRE, where `dragAngleDeg`'s derivative is
 * `2·tan(hFov/2) / widthPx`; a drag beginning near an edge is slightly
 * compressed, which is the projection rather than an error in this figure.
 */
export function dragStepSize(frame: FramePx, fov: FrameFov, gain: number): DragStepSize {
  const RAD = Math.PI / 180;
  const perPxDeg =
    frame.widthPx > 0
      ? (gain * (2 * Math.tan((fov.hFovDeg * RAD) / 2))) / frame.widthPx / RAD
      : 0;
  return { perPxDeg, perMmDeg: perPxDeg * CSS_PX_PER_MM };
}

/** The step size as the screen states it, with the mode named. */
export function dragStepSentence(mode: DragMode, step: DragStepSize): string {
  const which = mode === 'fine' ? 'Fine drag' : 'Normal drag';
  return (
    `${which}: 1 mm of finger moves the labels ${step.perMmDeg.toFixed(3)}° ` +
    `(${step.perPxDeg.toFixed(4)}° per pixel).`
  );
}
