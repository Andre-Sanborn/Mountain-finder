/**
 * Where the camera image actually lands on the screen, and what field of view
 * survives the crop.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A LAYOUT DETAIL
 * ═══════════════════════════════════════════════════════════════════════════
 * The AR screen draws a `<video>` at `object-fit: cover` and an SVG overlay on
 * top of it. `layoutOverlay` projects every summit through `projectToImage`,
 * which puts the optical axis at the CENTRE of the frame it is given and scales
 * by the half-field tangents. Two things therefore have to be true, and neither
 * is automatic:
 *
 *   1. the overlay's own box is the video element's box, pixel for pixel, so
 *      that "centre of frame" means the same point in both
 *   2. the field of view handed to the pose is the field of the VISIBLE box,
 *      not the field of the camera frame the browser decoded
 *
 * `cover` scales the frame up until it covers the box and throws away the
 * overflow, so a 4:3 stream in a 16:9 landscape window loses a quarter of its
 * height. Feeding the uncropped vertical field into the pose would stretch the
 * overlay by that same quarter: the horizon would sit right at the centre of
 * the frame and drift further out with every degree away from it. That is a
 * plausible-looking wrong answer, which is why the arithmetic is here and
 * tested rather than inline in a component.
 *
 * ── WHY THE OVERLAY IS NOT INSET TO THE SAFE AREA ──────────────────────────
 * An iPhone in landscape has a notch on one short edge and a home indicator on
 * the bottom, and `env(safe-area-inset-*)` reports them. It is tempting to
 * shrink the overlay to the safe box so no label hides under the notch. That
 * breaks the projection: inside a box whose centre is not the optical axis,
 * `projectToImage`'s 0.5 is the wrong point, and every label picks up a
 * constant offset of half the inset difference.
 *
 * So the video and the overlay both span the whole element box, and the safe
 * area is applied as a KEEP-OUT MARGIN instead ({@link VideoBoxGeometry.labelMarginPx}),
 * which is what `OverlayOptions.frameMarginPx` already means. The principal
 * point is then the element box's own centre — computed here rather than
 * assumed, because the day the layout does inset the video this function is
 * what stays right.
 *
 * Pure: numbers in, numbers out. No DOM types; the caller measures the element.
 */

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

/** A size in CSS pixels. */
export interface SizePx {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** A point in CSS pixels, origin at the element box's top-left corner. */
export interface PointPx {
  readonly xPx: number;
  readonly yPx: number;
}

/** A rectangle in CSS pixels, origin at the element box's top-left corner. */
export interface RectPx extends SizePx, PointPx {}

/** `env(safe-area-inset-*)`, CSS pixels. All four default to 0. */
export interface SafeAreaInsetsPx {
  readonly topPx?: number;
  readonly rightPx?: number;
  readonly bottomPx?: number;
  readonly leftPx?: number;
}

/** Both fields of view of one frame, degrees. */
export interface FieldOfViewDeg {
  readonly hFovDeg: number;
  readonly vFovDeg: number;
}

export interface VideoBoxGeometry {
  /** Factor `object-fit: cover` scales the decoded frame by. */
  readonly scale: number;
  /**
   * Fraction of the decoded frame's width and height that reaches the screen.
   * One of the two is always 1 — `cover` crops on one axis only.
   */
  readonly visibleFraction: { readonly x: number; readonly y: number };
  /**
   * Pixels of the scaled frame cut off each side. Symmetric, because
   * `object-position` is centred; `2 × overflow` is the whole discarded strip.
   */
  readonly overflowPx: { readonly xPx: number; readonly yPx: number };
  /**
   * Where the camera's optical axis lands, in overlay-local pixels. The centre
   * of the element box for a centred `cover`, which is what the overlay's own
   * projection assumes — so a caller can assert the two agree instead of
   * trusting that they do.
   */
  readonly principalPointPx: PointPx;
  /** The part of the element box no notch or home indicator covers. */
  readonly safeBoxPx: RectPx;
  /**
   * Keep-out margin for label boxes, pixels — the widest safe-area inset.
   *
   * `OverlayOptions.frameMarginPx` is one number for all four edges, so the
   * widest inset is the only value that keeps every label clear of every
   * obstruction. It costs screen room on the three edges that do not need it,
   * which is the right way round: a label under the notch is not readable at
   * all.
   */
  readonly labelMarginPx: number;
}

function inset(insets: SafeAreaInsetsPx, key: keyof SafeAreaInsetsPx): number {
  const value = insets[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Resolve where a `cover`-fitted video sits inside its element box.
 *
 * `elementBox` is the box the video and the overlay share, as
 * `getBoundingClientRect` measures it. `decodedFrame` is the stream's own
 * `videoWidth × videoHeight`. A zero or non-finite extent on either yields
 * scale 1, full visibility and a principal point at the element box's centre,
 * so a component's first render — before layout and before the first frame —
 * produces a degenerate but finite geometry instead of NaN.
 */
export function videoBoxGeometry(
  elementBox: SizePx,
  decodedFrame: SizePx,
  insets: SafeAreaInsetsPx = {},
): VideoBoxGeometry {
  const elementWidth = elementBox.widthPx;
  const elementHeight = elementBox.heightPx;
  const top = inset(insets, 'topPx');
  const right = inset(insets, 'rightPx');
  const bottom = inset(insets, 'bottomPx');
  const left = inset(insets, 'leftPx');

  const usable =
    elementWidth > 0 &&
    elementHeight > 0 &&
    decodedFrame.widthPx > 0 &&
    decodedFrame.heightPx > 0 &&
    Number.isFinite(elementWidth) &&
    Number.isFinite(elementHeight) &&
    Number.isFinite(decodedFrame.widthPx) &&
    Number.isFinite(decodedFrame.heightPx);

  const scale = usable
    ? Math.max(elementWidth / decodedFrame.widthPx, elementHeight / decodedFrame.heightPx)
    : 1;
  const renderedWidth = usable ? decodedFrame.widthPx * scale : elementWidth;
  const renderedHeight = usable ? decodedFrame.heightPx * scale : elementHeight;

  // Clamped at 1: floating-point error in the max() above can make the axis
  // that exactly fits report 1 + 1e-16, and a visible fraction over 1 would
  // claim the screen shows more of the frame than the frame has.
  const visibleX = usable && renderedWidth > 0 ? Math.min(1, elementWidth / renderedWidth) : 1;
  const visibleY = usable && renderedHeight > 0 ? Math.min(1, elementHeight / renderedHeight) : 1;

  return {
    scale,
    visibleFraction: { x: visibleX, y: visibleY },
    overflowPx: {
      xPx: Math.max(0, (renderedWidth - elementWidth) / 2),
      yPx: Math.max(0, (renderedHeight - elementHeight) / 2),
    },
    principalPointPx: { xPx: elementWidth / 2, yPx: elementHeight / 2 },
    safeBoxPx: {
      xPx: left,
      yPx: top,
      widthPx: Math.max(0, elementWidth - left - right),
      heightPx: Math.max(0, elementHeight - top - bottom),
    },
    labelMarginPx: Math.max(top, right, bottom, left),
  };
}

/**
 * The field of view of the visible box, from the field of view of the whole
 * decoded frame.
 *
 * A rectilinear frame is linear in the tangent of the off-axis angle, so a
 * crop that keeps a fraction `f` of an axis keeps a tangent fraction `f` of
 * that axis's half-angle:
 *
 *     tan(cropped/2) = tan(full/2) · f
 *
 * The same relation `otherAxisFovDeg` uses for a change of aspect ratio, for
 * the same reason. Scaling the ANGLES by `f` instead would over-report a wide
 * field by several degrees, which is the error this function exists to avoid.
 */
export function croppedFovDeg(
  fullFrameFov: FieldOfViewDeg,
  visibleFraction: { readonly x: number; readonly y: number },
): FieldOfViewDeg {
  const crop = (fovDeg: number, fraction: number): number => {
    if (!(fovDeg > 0) || fovDeg >= 180 || !(fraction > 0)) return 0;
    const clamped = Math.min(1, fraction);
    return 2 * Math.atan(Math.tan((fovDeg * RAD_PER_DEG) / 2) * clamped) * DEG_PER_RAD;
  };
  return {
    hFovDeg: crop(fullFrameFov.hFovDeg, visibleFraction.x),
    vFovDeg: crop(fullFrameFov.vFovDeg, visibleFraction.y),
  };
}
