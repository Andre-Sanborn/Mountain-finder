/**
 * Dragging the overlay into place — the phone's version of the trim sliders.
 *
 * D9 is explicit about the interaction: *"we put our peaks overlay on screen
 * for them to scoot right or left as they wish to align."* On the web that is
 * three sliders (`src/app/trim.ts`); on a phone the natural gesture is to push
 * the overlay with a finger. This module is the geometry that connects the
 * two, so the phone produces the SAME `TrimState` the web app does and both
 * feed the same `applyTrim`.
 *
 * ── THE MISTAKE THIS MODULE WAS FIRST WRITTEN WITH ─────────────────────────
 * The obvious scale for a drag is `fovDeg / widthPx` — degrees per pixel. It
 * is wrong, and wrong in a way that hides on a narrow lens and becomes glaring
 * on a wide one, because a rectilinear projection is linear in the TANGENT of
 * the angle, not in the angle:
 *
 *     x = 0.5 + tan(B − heading) / (2 · tan(hFov/2))
 *
 * A phone held upright has a vertical field of view around 69° on its main
 * camera and around 108° on its ultrawide. At 69° the `fov/px` scale
 * under-reads the true scale at frame centre by 12 %, at 108° by 32 %: the
 * overlay lags the finger. Inverting the equation properly costs one `atan`:
 *
 *     angle = atan( (dPx / extentPx) · 2 · tan(fov/2) )
 *
 * which is EXACT for a drag measured from the centre of frame, and is what
 * `dragAngleDeg` computes. The round-trip is asserted through the real
 * `projectToImage` in the tests rather than trusted to this comment.
 *
 * The signs follow from the same equation. Pushing the overlay RIGHT by `dx`
 * *decreases* the heading — the feature moves right because the camera is
 * treated as pointing further left. Dragging DOWN increases pitch, because
 * tilting a camera up moves the world down the frame.
 *
 * Pure: pixels in, degrees out. Both `src/core`'s rules and D9's discipline —
 * the drag writes the SAME visible trim state the sliders do, never a hidden
 * correction applied behind the user's back.
 */

import { TRIM_LIMIT_DEG, type TrimState } from '../app/trim.js';

export interface DragPx {
  readonly dx: number;
  readonly dy: number;
}

export interface FramePx {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface FrameFov {
  readonly hFovDeg: number;
  readonly vFovDeg: number;
}

const RAD_PER_DEG = Math.PI / 180;

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/**
 * The angle a drag of `dPx` subtends across a frame `extentPx` wide with field
 * of view `fovDeg`, in degrees.
 *
 * Exact at frame centre; a drag that starts near an edge is slightly
 * compressed, which is inherent to a rectilinear projection rather than an
 * approximation being made here. Returns 0 for a frame with no extent — a
 * React Native view reports 0×0 before its first layout pass, and a division
 * by zero would send the trim to its clamp on the first stray touch.
 */
export function dragAngleDeg(dPx: number, extentPx: number, fovDeg: number): number {
  if (!(extentPx > 0) || !(fovDeg > 0)) return 0;
  const halfExtentTangent = 2 * Math.tan((fovDeg * RAD_PER_DEG) / 2);
  return Math.atan((dPx / extentPx) * halfExtentTangent) / RAD_PER_DEG;
}

/**
 * Degrees per pixel AT THE CENTRE of frame, for a UI that wants to tell the
 * user how coarse the gesture is. This is the derivative of `dragAngleDeg` at
 * zero, so the two cannot drift apart:
 *
 *     d(angle)/d(px) |₀ = 2 · tan(fov/2) / extentPx
 */
export function degPerPx(frame: FramePx, fov: FrameFov): { x: number; y: number } {
  const scale = (fovDeg: number, extentPx: number): number =>
    extentPx > 0 ? (2 * Math.tan((fovDeg * RAD_PER_DEG) / 2)) / extentPx / RAD_PER_DEG : 0;
  return {
    x: scale(fov.hFovDeg, frame.widthPx),
    y: scale(fov.vFovDeg, frame.heightPx),
  };
}

/**
 * The trim after a drag of `drag` pixels from `base`.
 *
 * Clamped to the same `TRIM_LIMIT_DEG` the sliders use (±30° heading, ±20°
 * pitch), so a long swipe stops where a slider stops instead of winding the
 * pose somewhere no slider could express. `hFovDeg` is passed through
 * untouched: a one-finger drag has no business changing the field of view.
 */
export function trimFromDrag(
  base: TrimState,
  drag: DragPx,
  frame: FramePx,
  fov: FrameFov,
): TrimState {
  return {
    headingDeg: clamp(
      base.headingDeg - dragAngleDeg(drag.dx, frame.widthPx, fov.hFovDeg),
      TRIM_LIMIT_DEG.headingDeg,
    ),
    pitchDeg: clamp(
      base.pitchDeg + dragAngleDeg(drag.dy, frame.heightPx, fov.vFovDeg),
      TRIM_LIMIT_DEG.pitchDeg,
    ),
    hFovDeg: base.hFovDeg,
  };
}
