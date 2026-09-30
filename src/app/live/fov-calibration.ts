/**
 * Measuring the field of view from taps on the screen — the sun tap, and the
 * landmark sweep that shares its arithmetic.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS BEING MEASURED, AND WHY ONE TAP CANNOT DO IT
 * ═══════════════════════════════════════════════════════════════════════════
 * `fov-choice.ts` says the field of view of a browser video stream is a guess
 * until someone measures it. This module is the measurement. It needs something
 * whose direction is known independently of the camera, and the Sun and the
 * Moon are exactly that: `src/core/celestial.ts` puts them to about 0.01°, and
 * `celestial-markers.ts` already draws each one where the app's own pose says it
 * is. So the person taps the middle of the REAL disc in the camera image, and
 * the gap between the drawn disc and the tap is the app's error.
 *
 * One tap cannot separate the two causes of that gap. A rectilinear frame puts
 * a direction at
 *
 *     x − c = f · tan(azimuth − heading)
 *
 * so a wrong focal length f SCALES the displacement from the principal point,
 * while a wrong heading SHIFTS it. One tap is two numbers and the unknowns are
 * three — scale, heading offset, pitch offset — so a single tap fits infinitely
 * many camera. Two taps with the reference in DIFFERENT parts of the frame
 * separate them, because only the scale term grows with distance from the
 * centre. That is why the screen asks for the disc near one edge and then near
 * the other, and why {@link fitFovCalibration} refuses a set of taps whose
 * references sit on top of each other instead of returning a scale it cannot
 * defend.
 *
 * ── THE MODEL, IN PIXELS ───────────────────────────────────────────────────
 * The drawn position is already the projection of the true direction through
 * the ASSUMED camera, so no direction has to be passed in here:
 *
 *     a = drawn  − principal point  =  f_assumed · tan(off-axis angle)
 *     b = tapped − principal point  =  f_true    · tan(off-axis angle) + shift
 *
 * which is one affine relation with a shared scale,
 *
 *     b = s · a + d,        s = f_true / f_assumed
 *
 * fitted by ordinary least squares over the taps. The scale is one number for
 * both axes because a focal length is one number: `video-box.ts`'s `cover` crop
 * scales both axes of the decoded frame by the same factor, so the pixels-per-
 * tangent-unit of the visible box is the same horizontally and vertically.
 *
 * ── FROM THE FIT BACK TO A FIELD OF VIEW AND TWO OFFSETS ───────────────────
 *     tan(hFov_true/2) = tan(hFov_assumed/2) / s
 *
 * so s > 1 means the real lens is LONGER than the guess and the real field is
 * NARROWER. The offsets come from the same relation read near frame centre:
 *
 *     heading_true = heading_app − d_x / f_true
 *     pitch_true   = pitch_app   + d_y / f_true
 *
 * The signs are opposite because screen y grows downward while altitude grows
 * upward, and they are the reason this module has its own sign tests: a flipped
 * heading offset is a plausible-looking calibration that moves the labels the
 * wrong way by twice the error. The two offsets come out as a `TrimState`, in
 * the same convention `applyTrim` adds to a pose, so the correction is visible
 * to the user as a nudge rather than applied behind their back.
 *
 * ── THE LANDMARK SWEEP ─────────────────────────────────────────────────────
 * Nothing above is specific to the Sun. Any drawn mark whose direction the app
 * claims to know works the same way, so a labelled summit is an alternative
 * reference on an overcast day: tap the drawn dot's real counterpart on two
 * summits well apart across the frame. {@link pickReference} is what turns a tap
 * into "which drawn thing was this about", and it takes the Sun, the Moon and
 * every summit dot on the same footing.
 *
 * Pure. Pixels and degrees in, pixels and degrees out; no DOM, no storage, no
 * clock.
 */

import type { TrimState } from '../trim';

import type { FovCalibration } from './fov-choice';

const RAD_PER_DEG = Math.PI / 180;
const DEG_PER_RAD = 180 / Math.PI;

export interface PointPx {
  readonly xPx: number;
  readonly yPx: number;
}

/** What kind of thing a tap was about. */
export type ReferenceKind = 'sun' | 'moon' | 'summit';

/** One drawn mark a tap can be measured against. */
export interface CalibrationReference {
  readonly kind: ReferenceKind;
  /** What to call it on screen, e.g. `'the Sun'` or a summit's name. */
  readonly name: string;
  /** Where the app drew it, in overlay pixels. */
  readonly drawnPx: PointPx;
}

/** One tap: the mark it was about, and where the real thing actually was. */
export interface CalibrationTap {
  readonly reference: CalibrationReference;
  readonly tappedPx: PointPx;
}

/** The frame the taps were made on. */
export interface CalibrationFrame {
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
  /** Centre of projection, from `videoBoxGeometry`. */
  readonly principalPointPx: PointPx;
  /** The field of view the marks were DRAWN with — the one being corrected. */
  readonly visibleFov: { readonly hFovDeg: number; readonly vFovDeg: number };
  /** Fraction of the decoded frame's width the box shows, to un-crop the answer. */
  readonly visibleFractionX: number;
  /** The decoded camera frame, so the answer can be stored against it. */
  readonly decodedFrame: { readonly widthPx: number; readonly heightPx: number };
}

/**
 * Smallest spread of reference positions a fit is allowed, as a fraction of the
 * frame width.
 *
 * Below this the scale and the offsets are not separable in any useful sense:
 * the fitted scale becomes the ratio of two small differences and its
 * uncertainty runs away. A tenth of the frame width is about 7° at a 74° field,
 * which a person can reach by turning the phone a little between taps and which
 * keeps the scale's own error near a percent for a tap placed to a few pixels.
 */
export const MIN_REFERENCE_SPREAD_FRACTION = 0.1;

/** Bounds a fitted field of view has to land inside to be believable. */
export const MIN_FITTED_HFOV_DEG = 5;
export const MAX_FITTED_HFOV_DEG = 175;

export type FovFitRefusal =
  | 'no-frame'
  | 'too-few-taps'
  | 'references-too-close'
  | 'fitted-field-out-of-range';

export interface FovFit {
  /** `f_true / f_assumed`. Above 1 the real field is narrower than the guess. */
  readonly scale: number;
  /** Field of view of the VISIBLE box, corrected. */
  readonly visibleHFovDeg: number;
  readonly visibleVFovDeg: number;
  /** Field of view of the whole decoded frame — what gets stored. */
  readonly frameHFovDeg: number;
  /** Add these to the pose, in `applyTrim`'s own convention. */
  readonly trim: TrimState;
  /**
   * The fitted focal length, overlay pixels: `scale` times the assumed one.
   *
   * It is what turns a pixel into an angle, so the residual below only becomes
   * a degree figure beside it. Carried on the fit rather than re-derived by
   * each caller, which would have to know the frame the fit was made in.
   */
  readonly focalPx: number;
  readonly taps: number;
  /** RMS distance between each tap and where the fit puts it, pixels. */
  readonly residualPx: number;
  /** RMS spread of the reference positions the fit was made from, pixels. */
  readonly referenceSpreadPx: number;
}

export type FovFitResult =
  | { readonly ok: true; readonly value: FovFit }
  | { readonly ok: false; readonly refusal: FovFitRefusal; readonly detail: string };

/**
 * Fit one scale and one two-axis shift to a set of taps.
 *
 * Refuses rather than guessing wherever the taps cannot support an answer, and
 * every refusal says what the person should do differently, because this runs on
 * a phone held by someone who cannot read the code.
 */
export function fitFovCalibration(
  taps: readonly CalibrationTap[],
  frame: CalibrationFrame,
): FovFitResult {
  const { widthPx, heightPx } = frame.framePx;
  if (
    !(widthPx > 0) ||
    !(heightPx > 0) ||
    !(frame.visibleFov.hFovDeg > 0) ||
    frame.visibleFov.hFovDeg >= 180 ||
    !(frame.visibleFov.vFovDeg > 0) ||
    !(frame.visibleFractionX > 0)
  ) {
    return {
      ok: false,
      refusal: 'no-frame',
      detail: 'The camera has not delivered a picture yet, so there is nothing to measure against.',
    };
  }

  if (taps.length < 2) {
    return {
      ok: false,
      refusal: 'too-few-taps',
      detail:
        'Two taps are needed, with the mark in different parts of the picture. One tap cannot ' +
        'tell a wrong lens width apart from a wrong direction.',
    };
  }

  // Both vectors are measured from the principal point, which is where the
  // projection's scale is measured from.
  const a = taps.map((tap) => ({
    x: tap.reference.drawnPx.xPx - frame.principalPointPx.xPx,
    y: tap.reference.drawnPx.yPx - frame.principalPointPx.yPx,
  }));
  const b = taps.map((tap) => ({
    x: tap.tappedPx.xPx - frame.principalPointPx.xPx,
    y: tap.tappedPx.yPx - frame.principalPointPx.yPx,
  }));

  const n = taps.length;
  const mean = (values: readonly { x: number; y: number }[]): { x: number; y: number } => ({
    x: values.reduce((sum, value) => sum + value.x, 0) / n,
    y: values.reduce((sum, value) => sum + value.y, 0) / n,
  });
  const aBar = mean(a);
  const bBar = mean(b);

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) continue;
    const dax = ai.x - aBar.x;
    const day = ai.y - aBar.y;
    numerator += dax * (bi.x - bBar.x) + day * (bi.y - bBar.y);
    denominator += dax * dax + day * day;
  }

  const referenceSpreadPx = Math.sqrt(denominator / n);
  const minSpreadPx = MIN_REFERENCE_SPREAD_FRACTION * widthPx;
  if (!(referenceSpreadPx >= minSpreadPx)) {
    return {
      ok: false,
      refusal: 'references-too-close',
      detail:
        `The taps were all in the same part of the picture (${referenceSpreadPx.toFixed(0)} px ` +
        `apart, and ${minSpreadPx.toFixed(0)} px are needed). Turn the phone so the mark moves ` +
        'across the screen, then tap it again.',
    };
  }

  const scale = numerator / denominator;
  const shift = { x: bBar.x - scale * aBar.x, y: bBar.y - scale * aBar.y };

  // f is measured in overlay pixels: half the frame width over the tangent of
  // the half-field. The fitted camera's own f is what the offsets are read in.
  const assumedFocalPx = widthPx / 2 / Math.tan((frame.visibleFov.hFovDeg * RAD_PER_DEG) / 2);
  const fittedFocalPx = scale * assumedFocalPx;
  if (!(fittedFocalPx > 0) || !Number.isFinite(fittedFocalPx)) {
    return {
      ok: false,
      refusal: 'fitted-field-out-of-range',
      detail:
        'The taps say the picture is mirrored or has no width, which no camera does. Tap the ' +
        'middle of the real mark rather than the drawn one.',
    };
  }

  const visibleHFovDeg = 2 * Math.atan(widthPx / 2 / fittedFocalPx) * DEG_PER_RAD;
  const visibleVFovDeg = 2 * Math.atan(heightPx / 2 / fittedFocalPx) * DEG_PER_RAD;
  if (visibleHFovDeg < MIN_FITTED_HFOV_DEG || visibleHFovDeg > MAX_FITTED_HFOV_DEG) {
    return {
      ok: false,
      refusal: 'fitted-field-out-of-range',
      detail:
        `The taps work out to a ${visibleHFovDeg.toFixed(1)}° wide picture, which no phone lens ` +
        'is. Check that each tap was on the real mark and try again.',
    };
  }

  // Un-crop: the visible box is a fraction of the decoded frame, and a
  // rectilinear crop scales the tangent of the half-angle by that fraction.
  const frameHFovDeg =
    2 *
    Math.atan(Math.tan((visibleHFovDeg * RAD_PER_DEG) / 2) / Math.min(1, frame.visibleFractionX)) *
    DEG_PER_RAD;

  let squared = 0;
  for (let i = 0; i < n; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (ai === undefined || bi === undefined) continue;
    squared +=
      (bi.x - (scale * ai.x + shift.x)) ** 2 + (bi.y - (scale * ai.y + shift.y)) ** 2;
  }

  return {
    ok: true,
    value: {
      scale,
      visibleHFovDeg,
      visibleVFovDeg,
      frameHFovDeg,
      trim: {
        headingDeg: -Math.atan(shift.x / fittedFocalPx) * DEG_PER_RAD,
        pitchDeg: Math.atan(shift.y / fittedFocalPx) * DEG_PER_RAD,
        hFovDeg: 0,
      },
      focalPx: fittedFocalPx,
      taps: n,
      residualPx: Math.sqrt(squared / n),
      referenceSpreadPx,
    },
  };
}

/**
 * The stored form of a fit.
 *
 * The method string is what `fov-choice.ts` prints beside the numbers, so it
 * names the reference and the number of taps rather than saying "calibrated" —
 * a measurement whose provenance is not on screen is indistinguishable from a
 * guess to the person reading it.
 */
export function calibrationFromFit(
  fit: FovFit,
  frame: CalibrationFrame,
  references: readonly CalibrationReference[],
): FovCalibration {
  const kinds = [...new Set(references.map((reference) => reference.name))];
  return {
    frameHFovDeg: fit.frameHFovDeg,
    frameWidthPx: frame.decodedFrame.widthPx,
    frameHeightPx: frame.decodedFrame.heightPx,
    method:
      `measured from ${fit.taps} tap${fit.taps === 1 ? '' : 's'} on ` +
      `${kinds.join(' and ')}, residual ${fit.residualPx.toFixed(1)} px`,
  };
}

/**
 * Which drawn mark a tap was about: the nearest one, or none.
 *
 * `maxDistancePx` keeps a tap in an empty corner from being attached to a mark
 * on the far side of the screen. A tap nobody can attribute is discarded and the
 * screen says so, because attributing it to whatever happened to be closest is
 * how a calibration acquires a sample of something else entirely.
 */
export function pickReference(
  tappedPx: PointPx,
  candidates: readonly CalibrationReference[],
  maxDistancePx: number,
): CalibrationReference | undefined {
  let best: CalibrationReference | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.hypot(
      candidate.drawnPx.xPx - tappedPx.xPx,
      candidate.drawnPx.yPx - tappedPx.yPx,
    );
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return bestDistance <= maxDistancePx ? best : undefined;
}

/** How far from a drawn mark a tap may land and still be about it, pixels. */
export const MAX_TAP_DISTANCE_PX = 160;

export type TapRefusal = 'outside-picture' | 'nothing-drawn';

export type TapOutcome =
  | { readonly ok: true; readonly reference: CalibrationReference }
  | { readonly ok: false; readonly refusal: TapRefusal; readonly detail: string };

/**
 * What a calibration tap was about, and the only two reasons to refuse one.
 *
 * ── THE RULE, AND WHY IT IS THIS ONE ───────────────────────────────────────
 * A tap is refused for landing outside the picture, and for landing on a screen
 * with nothing drawn to compare against. It is never refused for landing far
 * from the drawn mark, because THAT DISTANCE IS THE MEASUREMENT: the gap
 * between where the app's sensors put the Sun and where the Sun really is, in
 * pixels. Capping it caps the tilt error the session can report, and the cap
 * would be set by the sensor whose error is under test. See
 * {@link UNCAPPED_TAP_DISTANCE_PX}.
 *
 * The frame is the bound the sensor has no part in. A finger cannot land
 * outside the picture without the person meaning something else by it.
 */
export function resolveCalibrationTap(
  tappedPx: PointPx,
  framePx: { readonly widthPx: number; readonly heightPx: number },
  candidates: readonly CalibrationReference[],
): TapOutcome {
  if (
    !(tappedPx.xPx >= 0) ||
    !(tappedPx.yPx >= 0) ||
    !(tappedPx.xPx <= framePx.widthPx) ||
    !(tappedPx.yPx <= framePx.heightPx)
  ) {
    return {
      ok: false,
      refusal: 'outside-picture',
      detail: 'That tap landed outside the picture. Tap the middle of the real sun in the camera view.',
    };
  }
  const reference = pickReference(tappedPx, candidates, UNCAPPED_TAP_DISTANCE_PX);
  if (reference === undefined) {
    return {
      ok: false,
      refusal: 'nothing-drawn',
      detail:
        "The app's own circle for the sun is not on the picture or just above or below it, so " +
        'there is nothing to measure this tap against. Turn the phone until that circle is on ' +
        'the screen too, then tap the middle of the real sun. If the labels point the wrong ' +
        'way, fix the direction first.',
    };
  }
  return { ok: true, reference };
}

/**
 * No distance limit at all, for the home session's calibration taps.
 *
 * The gap between the drawn mark and the real thing IS the measurement. A limit
 * on it is a limit on the answer: a phone whose tilt zero point sits three
 * degrees low draws the Sun about 45 px off at a 74° field on a 1280 px
 * overlay, and one that sits twelve degrees low draws it past
 * {@link MAX_TAP_DISTANCE_PX} and has its honest tap refused. That refusal is
 * the sensor deciding what the sensor's own error is allowed to be.
 *
 * What replaces it is a bound the sensor has no part in: the tap has to land
 * inside the picture. The cost is that with several marks drawn, a tap far from
 * all of them is still attributed to the nearest — which the home session's
 * step avoids by asking for the Sun, the brightest thing on the screen.
 */
export const UNCAPPED_TAP_DISTANCE_PX = Number.POSITIVE_INFINITY;
