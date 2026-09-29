/**
 * Field-of-view derivation from lens focal length, for the photo pipeline.
 *
 * The geometry lives in `src/core/projection.ts` and this module re-exports it.
 * There is one implementation of "35 mm-equivalent focal length + displayed
 * width and height -> hFOV and vFOV", and both the still path and the live path
 * reach it here. A second copy existed once: it applied the 36 mm-gate angle to
 * the frame's width whatever the orientation, which on a portrait photograph
 * put every bearing 12 % of the frame's width out of place (adversarial review
 * 2, finding 3; docs/FINDINGS.md W2-3).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE CONVENTION, STATED AS A CONVENTION
 * ───────────────────────────────────────────────────────────────────────────
 * `FocalLengthIn35mmFormat` is one number and a frame has two dimensions, so
 * turning it into a field of view needs an assumption about what the camera
 * maker matched when it computed the equivalence. Two are in circulation:
 *
 *   LONG SIDE (used here). f35 is the focal length that frames the same view
 *     across the 36 mm side of the gate. The 36 mm angle therefore belongs to
 *     the LONGER side of the photograph, and the other side follows through the
 *     rectilinear tangent relation.
 *   DIAGONAL. f35 is derived from the ratio of frame diagonals (43.267 mm for
 *     the 35 mm gate), which is how crop factors are usually quoted.
 *
 * The two agree EXACTLY on a 3:2 frame — the shape of the 35 mm gate itself —
 * and diverge elsewhere: on the 3:4 dead-sea fixture at f35 = 50 the long-side
 * convention gives hFOV 30.219° and the diagonal convention 29.105°.
 *
 * The long side is chosen because the tag names the 35 mm FILM FORMAT, whose
 * gate is 36 x 24, and because the sensor's true diagonal — the input the
 * diagonal convention actually needs — is not in the file. Apple's published
 * figures point the other way, and `longSideFovDegFromFocalLength35mm` in core
 * records that open question and how it is to be settled.
 *
 * The vertical field of view is NOT hFov * height / width — that is only true
 * for very narrow lenses. The rectilinear relation runs through the tangent:
 *
 *   tan(vFov / 2) = tan(hFov / 2) * (heightPx / widthPx)
 *
 * Angles are degrees (`Deg` suffix per src/core/types.ts naming rules).
 */

import { otherAxisFovDeg } from '../core/projection';

// FULL_FRAME_WIDTH_MM is the gate's 36 mm long side, FULL_FRAME_HEIGHT_MM its
// 24 mm short side.
export {
  FULL_FRAME_WIDTH_MM,
  FULL_FRAME_HEIGHT_MM,
  fovDegFromFocalLength35mm,
  hFovDegFromFocalLength35mm,
  longSideFovDegFromFocalLength35mm,
  type FieldOfViewDeg,
} from '../core/projection';

/**
 * Vertical field of view implied by a horizontal field of view and the image
 * aspect ratio. Only the ratio of the pixel dimensions matters.
 *
 * A named spelling of core's `otherAxisFovDeg` for the pipeline's usual case:
 * an hFov across the width, a vFov wanted down the height.
 *
 * @throws RangeError on non-positive dimensions or an hFov outside (0, 180).
 */
export function vFovDegFromHFov(hFovDeg: number, widthPx: number, heightPx: number): number {
  if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) {
    throw new RangeError(
      `image dimensions must be positive, got ${String(widthPx)}x${String(heightPx)}`,
    );
  }
  return otherAxisFovDeg(hFovDeg, widthPx, heightPx);
}
