/**
 * The Sun and the Moon as marks on the AR screen — the bench-test instrument.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THESE TWO DISCS ARE FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/core/celestial.ts` says where the Sun and Moon are to about 0.01°,
 * measured against Meeus's own worked examples. Both are in the sky, both are
 * unmistakable, and neither depends on terrain, a peak database or a pose. So
 * the gap between the drawn disc and the real one in the camera image is a
 * DIRECT reading of the app's own heading, pitch and field-of-view error —
 * which is why IMPLEMENTATION.md calls this the bench-test instrument and why
 * TODO.md's field route asks for the discs before the field session.
 *
 * The disc is drawn at its true angular size, not at an icon size. A Sun or
 * Moon about half a degree across is a ruler: half a degree of heading error
 * offsets the drawn disc by its own diameter, and a field-of-view error of a
 * few percent shows as a size mismatch at the same time.
 *
 * ── THE CLOCK ──────────────────────────────────────────────────────────────
 * `src/core` may not read the clock, and does not: `sunPosition` and
 * `moonPosition` take the instant as an argument. Reading it is the caller's
 * job and `src/app` is where that is allowed. So this module takes a `Date`
 * too, and the component passes `new Date()`.
 *
 * ── REFRACTION IS ON HERE ──────────────────────────────────────────────────
 * `celestial.ts` defaults refraction off, because the airless altitude is the
 * one an ephemeris can be checked against. What the camera sees is refracted,
 * and near the horizon that is about half a degree — a whole Sun's width. This
 * screen is compared against a photograph, so it asks for the refracted
 * altitude and the mark records that it did.
 *
 * Pure: an instant, an observer and a pose in, marks out.
 */

import { moonPosition, sunPosition, type CelestialObserver } from '../../core/celestial';
import { isBehindCamera, projectToImage } from '../../core/projection';
import type { CameraPose } from '../../core/types';

export type CelestialBody = 'sun' | 'moon';

export interface CelestialMark {
  readonly body: CelestialBody;
  /** Centre of the disc, in overlay pixels. */
  readonly centrePx: { readonly xPx: number; readonly yPx: number };
  /**
   * Drawn radius in pixels, from the body's own angular radius through the
   * pose's tangent scale. Never below 2 px: a mark smaller than that is not a
   * disc anyone can line up against, and this is a measuring instrument.
   */
  readonly radiusPx: number;
  /** True angular radius, degrees, for the readout. */
  readonly angularRadiusDeg: number;
  readonly azimuthDeg: number;
  /** Refracted altitude, degrees — what the camera sees. */
  readonly altitudeDeg: number;
  /** True when the disc's centre falls inside the frame. */
  readonly inFrame: boolean;
  /** True when the body is below the horizon, so the mark is advisory only. */
  readonly belowHorizon: boolean;
}

/** Smallest radius worth drawing, pixels. */
export const MIN_MARK_RADIUS_PX = 2;

/**
 * Project one body at a given instant.
 *
 * Returns the mark whether or not it lands in frame, so the screen can say
 * "the Sun is 40° to your left" instead of silently omitting it. `inFrame`
 * is what decides whether the disc is drawn.
 */
export function celestialMark(
  body: CelestialBody,
  when: Date,
  observer: CelestialObserver,
  pose: CameraPose,
  frame: { readonly widthPx: number; readonly heightPx: number },
): CelestialMark {
  const position =
    body === 'sun'
      ? sunPosition(when, observer, { refraction: true })
      : moonPosition(when, observer, { refraction: true });

  const point = projectToImage(pose, position.azimuthDeg, position.altitudeDeg);
  // The disc's radius in pixels is the difference between the centre's
  // projection and the projection of a point one angular radius above it, so
  // it carries the same tangent scale as every other mark on the frame. Taken
  // vertically because the vertical field is the smaller one in landscape and
  // is therefore the tighter measurement.
  const edge = projectToImage(
    pose,
    position.azimuthDeg,
    position.altitudeDeg + position.angularRadiusDeg,
  );
  const radiusPx = Math.abs(edge.y - point.y) * frame.heightPx;

  return {
    body,
    centrePx: { xPx: point.x * frame.widthPx, yPx: point.y * frame.heightPx },
    radiusPx: Math.max(MIN_MARK_RADIUS_PX, radiusPx),
    angularRadiusDeg: position.angularRadiusDeg,
    azimuthDeg: position.azimuthDeg,
    altitudeDeg: position.altitudeDeg,
    inFrame: point.inFrame,
    belowHorizon: position.altitudeDeg < 0,
  };
}

/**
 * May a tap on the real body be measured against this mark?
 *
 * A mark in the picture always may. A mark above or below the picture also
 * may, because a tilt sensor that is several degrees out draws the Sun off the
 * top or bottom, and that gap is the measurement the home session takes. A mark
 * off either side is a heading error wider than the picture, which the re-anchor
 * fixes first; fitting a field of view to it would store a scale bent by that
 * error. A mark behind the camera has no image at all, and one below the
 * horizon cannot be seen.
 */
export function isTappableMark(
  mark: CelestialMark,
  pose: CameraPose,
  frame: { readonly widthPx: number },
): boolean {
  if (mark.belowHorizon) return false;
  if (mark.inFrame) return true;
  if (isBehindCamera(pose, mark.azimuthDeg, mark.altitudeDeg)) return false;
  return mark.centrePx.xPx >= 0 && mark.centrePx.xPx <= frame.widthPx;
}

/** Both bodies at one instant. */
export function celestialMarks(
  when: Date,
  observer: CelestialObserver,
  pose: CameraPose,
  frame: { readonly widthPx: number; readonly heightPx: number },
): readonly CelestialMark[] {
  return [
    celestialMark('sun', when, observer, pose, frame),
    celestialMark('moon', when, observer, pose, frame),
  ];
}

/**
 * Where a body is relative to where the camera looks, for a mark that is off
 * screen.
 *
 * The horizontal difference is folded onto (−180, 180], so the sentence can
 * say left or right rather than an unhelpful 350°.
 */
export function offFrameDirection(
  mark: CelestialMark,
  pose: CameraPose,
): { readonly turnDeg: number; readonly text: string } {
  const raw = mark.azimuthDeg - pose.headingDeg;
  const turnDeg = ((((raw + 180) % 360) + 360) % 360) - 180;
  const side = turnDeg >= 0 ? 'right' : 'left';
  const name = mark.body === 'sun' ? 'Sun' : 'Moon';
  if (mark.belowHorizon) {
    return {
      turnDeg,
      text: `The ${name} is below the horizon (${mark.altitudeDeg.toFixed(1)}°), so there is nothing to line up against.`,
    };
  }
  return {
    turnDeg,
    text:
      `The ${name} is ${Math.abs(turnDeg).toFixed(0)}° to your ${side} and ` +
      `${mark.altitudeDeg.toFixed(0)}° up. Turn that way to check the app against it.`,
  };
}
