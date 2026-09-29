/**
 * Re-anchoring the labels on something whose direction is known — the way back
 * from a compass that is a quarter-turn wrong.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS FIXES, AND WHY THE DRAG CANNOT
 * ═══════════════════════════════════════════════════════════════════════════
 * IMG_7270's recorded heading is 92° out. The drag and the sliders are clamped
 * to ±30°, so that error cannot be dragged away at all, and an unclamped nudge
 * would snap back to the clamp on the next touch. So the correction is a
 * separate number — the gross heading offset in `src/app/trim.ts` — and this
 * module is what computes it from one tap.
 *
 * ── THE ARITHMETIC ─────────────────────────────────────────────────────────
 * A rectilinear frame puts a direction at
 *
 *     x − c_x = f · tan(azimuth − heading)
 *     y − c_y = f · tan(pitch − altitude)      (screen y grows downward)
 *
 * with `f = (widthPx / 2) / tan(hFov / 2)` in overlay pixels. The person taps
 * the REAL thing, so the two equations are solved for the pose instead of for
 * the pixel:
 *
 *     heading = azimuth  − atan((x − c_x) / f)
 *     pitch   = altitude + atan((y − c_y) / f)
 *
 * The two axes are solved independently, which is exact on the frame's centre
 * lines and first-order elsewhere: the cross term is the roll and the pitch's
 * own foreshortening, worth a fraction of a degree across a phone frame. That
 * is three orders below the 92° this exists to remove, and the fine trim is
 * what closes the rest.
 *
 * ── WHY IT IS NOT `pickReference` ──────────────────────────────────────────
 * `fov-calibration.ts` attributes a tap to the nearest DRAWN mark within 160 px.
 * Under a gross error nothing drawn is anywhere near the truth — the whole point
 * is that the labels are in the wrong place — so a nearest-mark rule would
 * attribute the tap to whatever happened to be on that part of the screen. Here
 * the person names the reference first and taps second, and no drawn position
 * enters the arithmetic.
 *
 * ── THE HEADING BASIS ──────────────────────────────────────────────────────
 * The pose's heading is magnetic, true, or true from the model, and the
 * reference's azimuth has to be in the SAME one or the re-anchor bakes the
 * declination in. {@link azimuthInBasis} is the one conversion, and it refuses
 * rather than guessing when a magnetic pose has no declination on file.
 *
 * Pure. Pixels and degrees in, degrees and a sentence out; no DOM, no clock.
 */

import { normaliseBearingDeg } from '../../core/geodesy';
import { TRIM_LIMIT_DEG } from '../trim';

import type { PointPx } from './fov-calibration';

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

/** How long the phone must be still before a re-anchor is offered, ms. */
export const STILL_FOR_REANCHOR_MS = 10_000;

/**
 * How far the sensed heading may disagree with a solved one before the screen
 * says the compass is broken rather than imprecise, degrees.
 *
 * Twenty is well outside anything the heading policy models — the worst
 * compass accuracy a phone reports is around 15° — and well inside the 92° the
 * one real measurement showed.
 */
export const GROSS_HEADING_WARNING_DEG = 20;

/** Which north the pose's heading is measured from. */
export type HeadingBasis = 'true' | 'true-model' | 'magnetic';

/**
 * A reference azimuth, moved into the basis the pose is drawn in.
 *
 * Returns undefined for a magnetic pose with no declination on file: the two
 * norths differ by up to 20° in the places this app is used, which is the size
 * of the error the re-anchor is meant to remove.
 */
export function azimuthInBasis(
  trueAzimuthDeg: number,
  basis: HeadingBasis,
  declinationDeg: number | undefined,
): number | undefined {
  if (basis !== 'magnetic') return normaliseBearingDeg(trueAzimuthDeg);
  if (declinationDeg === undefined || !Number.isFinite(declinationDeg)) return undefined;
  return normaliseBearingDeg(trueAzimuthDeg - declinationDeg);
}

/** Fold a signed angle onto (−180, 180]. */
function foldSigned(deg: number): number {
  const wrapped = normaliseBearingDeg(deg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** What the person tapped, and where its real direction is. */
export interface ReanchorReference {
  /** `'the sun'`, `'the moon'` or a summit's name — what the screen calls it. */
  readonly name: string;
  /** Azimuth in the pose's own heading basis, degrees. */
  readonly azimuthDeg: number;
  /** Altitude above the horizon, degrees. */
  readonly altitudeDeg: number;
}

export interface ReanchorInput {
  readonly reference: ReanchorReference;
  /** Where the person tapped the real thing, in overlay pixels. */
  readonly tappedPx: PointPx;
  /** The pose the sensors report, before any trim or offset. */
  readonly sensedPose: { readonly headingDeg: number; readonly pitchDeg: number };
  /** The heading the overlay is drawn at now — sensed, trimmed and offset. */
  readonly drawnHeadingDeg: number;
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
  /** Centre of projection, from `videoBoxGeometry`. */
  readonly principalPointPx: PointPx;
  /** The field of view the overlay is drawn at — calibrated where measured. */
  readonly visibleHFovDeg: number;
}

export interface Reanchor {
  /** What to store as the gross heading offset. Unclamped, signed. */
  readonly grossHeadingOffsetDeg: number;
  /** What to store as the fine pitch trim, clamped to the slider's range. */
  readonly pitchTrimDeg: number;
  /** True when the pitch answer hit that clamp, so the screen can say so. */
  readonly pitchClamped: boolean;
  /** The heading the labels are now drawn at, [0, 360). */
  readonly anchoredHeadingDeg: number;
  /** How far the labels move, degrees, always positive. */
  readonly moveDeg: number;
  /** Which way they move on screen. */
  readonly moveDirection: 'left' | 'right';
  /** The confirmation sentence, in the screen's own words. */
  readonly sentence: string;
}

export type ReanchorRefusal = 'no-frame' | 'tap-outside-frame';

export type ReanchorResult =
  | { readonly ok: true; readonly value: Reanchor }
  | { readonly ok: false; readonly refusal: ReanchorRefusal; readonly detail: string };

/**
 * Solve the pose from one tap on a reference whose direction is known.
 *
 * The fine heading trim is not an input and not an output: a re-anchor replaces
 * the whole heading correction, and the caller zeroes the fine heading trim as
 * it stores the answer. That is why `drawnHeadingDeg` is passed separately —
 * the move the sentence states is measured from what is on screen now, which is
 * what the person is being asked about.
 */
export function reanchorFromTap(input: ReanchorInput): ReanchorResult {
  const { widthPx, heightPx } = input.framePx;
  if (
    !(widthPx > 0) ||
    !(heightPx > 0) ||
    !(input.visibleHFovDeg > 0) ||
    input.visibleHFovDeg >= 180
  ) {
    return {
      ok: false,
      refusal: 'no-frame',
      detail: 'The camera has not delivered a picture yet, so there is nothing to aim at.',
    };
  }
  if (
    input.tappedPx.xPx < 0 ||
    input.tappedPx.xPx > widthPx ||
    input.tappedPx.yPx < 0 ||
    input.tappedPx.yPx > heightPx
  ) {
    return {
      ok: false,
      refusal: 'tap-outside-frame',
      detail: 'That tap was off the picture. Tap the middle of the real thing on the screen.',
    };
  }

  const focalPx = widthPx / 2 / Math.tan((input.visibleHFovDeg * RAD_PER_DEG) / 2);
  const dxPx = input.tappedPx.xPx - input.principalPointPx.xPx;
  const dyPx = input.tappedPx.yPx - input.principalPointPx.yPx;

  const anchoredHeadingDeg = normaliseBearingDeg(
    input.reference.azimuthDeg - Math.atan(dxPx / focalPx) * DEG_PER_RAD,
  );
  const wantedPitchDeg = input.reference.altitudeDeg + Math.atan(dyPx / focalPx) * DEG_PER_RAD;

  const pitchOffsetDeg = wantedPitchDeg - input.sensedPose.pitchDeg;
  const pitchTrimDeg = clamp(pitchOffsetDeg, TRIM_LIMIT_DEG.pitchDeg);

  // Positive heading change turns the camera to the right, so what it is
  // pointed at moves LEFT across the frame — the same sign relation the drag
  // carries (`src/live/drag-trim.ts`).
  const changeDeg = foldSigned(anchoredHeadingDeg - input.drawnHeadingDeg);
  const moveDirection = changeDeg < 0 ? 'right' : 'left';
  const moveDeg = Math.abs(changeDeg);

  return {
    ok: true,
    value: {
      grossHeadingOffsetDeg: foldSigned(anchoredHeadingDeg - input.sensedPose.headingDeg),
      pitchTrimDeg,
      pitchClamped: pitchTrimDeg !== pitchOffsetDeg,
      anchoredHeadingDeg,
      moveDeg,
      moveDirection,
      sentence: reanchorSentence(moveDeg, moveDirection),
    },
  };
}

/** The confirmation sentence: what the tap will do, before it is done. */
export function reanchorSentence(moveDeg: number, direction: 'left' | 'right'): string {
  return `This turns the labels ${moveDeg.toFixed(0)}° to the ${direction}.`;
}

/**
 * The warning shown when a solved heading and the sensed one are far apart.
 *
 * Undefined below {@link GROSS_HEADING_WARNING_DEG}, where the difference is an
 * ordinary compass error the uncertainty band already states. Above it the
 * compass is wrong in a way no nudge can reach, and saying "the labels may be a
 * little off" would be misleading.
 */
export function grossHeadingWarning(
  sensedHeadingDeg: number,
  solvedHeadingDeg: number,
): string | undefined {
  const offDeg = Math.abs(foldSigned(solvedHeadingDeg - sensedHeadingDeg));
  if (!(offDeg > GROSS_HEADING_WARNING_DEG)) return undefined;
  return (
    `The compass looks ${offDeg.toFixed(0)}° off — tap the sun (or a summit you know) to fix it.`
  );
}

/** How far the compass has moved since the re-anchor, and whether that matters. */
export interface AnchorDrift {
  /** Sensed heading now, less the sensed heading when the anchor was set. */
  readonly gapDeg: number;
  /** True once the gap is wider than the band the screen claims. */
  readonly beyondBand: boolean;
  readonly text: string;
}

/**
 * The live gap between the compass and the anchor.
 *
 * A re-anchor is one instant's correction. If the compass error was a transient
 * — a magnet near the phone, a calibration that settled afterwards — the
 * correction is now baked in and wrong by the amount the compass has since
 * moved. Nothing else on this screen would notice, because the labels are drawn
 * from the anchored heading and look exactly as confident as before.
 *
 * `bandDeg` is the horizontal uncertainty the screen is already claiming, so
 * the warning fires exactly when the drift has outgrown the band beside it.
 */
export function anchorDrift(
  sensedHeadingDeg: number,
  anchoredAtSensedHeadingDeg: number,
  bandDeg: number,
): AnchorDrift {
  const gapDeg = foldSigned(sensedHeadingDeg - anchoredAtSensedHeadingDeg);
  const magnitude = Math.abs(gapDeg);
  const beyondBand = bandDeg > 0 && magnitude > bandDeg;
  return {
    gapDeg,
    beyondBand,
    text: beyondBand
      ? `The compass has moved ${magnitude.toFixed(1)}° since you fixed the direction, which is ` +
        `more than the ${bandDeg.toFixed(1)}° this screen allows for. Fix the direction again.`
      : `The compass has moved ${magnitude.toFixed(1)}° since you fixed the direction.`,
  };
}
