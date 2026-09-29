/**
 * Raw browser sensor events → this project's `GravitySample` / `HeadingSample`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/live/device-samples.ts` does this job for the Expo shell. The phone
 * browser is now the primary field vehicle, and the browser hands out a
 * different set of numbers: Euler angles instead of a gravity vector, one
 * platform's gravity sign inverted against the other's, a compass that is
 * referenced to an axis the camera does not point along, and permission gates
 * that make every field null until a user gesture has run.
 *
 * Each of those is a place where a plausible wrong number gets through, so the
 * conversion lives here, pure and tested, rather than inside a React component
 * where nothing can check it.
 *
 * ── THE SIGN THAT DIVERGES BETWEEN THE TWO BROWSERS ────────────────────────
 * `devicemotion`'s `accelerationIncludingGravity` has OPPOSITE signs in
 * Chromium and in iOS Safari. Both readings are quoted from primary sources:
 *
 *   W3C, Device Orientation and Motion (Editor's Draft, 12 February 2025),
 *   § 1 Introduction: "A device lying flat on a horizontal surface with the
 *   screen upmost has an acceleration of zero and the following value for
 *   accelerationIncludingGravity: { x: 0, y: 0, z: 9.8 }". § 3.2 calls it
 *   "proper acceleration". +z is "out of the screen", so the spec's vector
 *   points UP for a resting device.
 *
 *   Chromium follows that. `device_motion_event_pump.cc` copies the platform
 *   ACCELEROMETER reading through unchanged, and on Android
 *   `PlatformSensor.java` copies `SensorEvent.values[0..2]` of
 *   `TYPE_ACCELEROMETER` with no negation; that sensor reads z = +9.81 flat on
 *   a table. A channel with no sensor behind it is reported as NaN components,
 *   not as a null object.
 *
 *   WebKit does not. `Source/WebCore/platform/ios/WebCoreMotionManager.mm`
 *   publishes `(userAcceleration + CMDeviceMotion.gravity) * 9.80665`, and
 *   CoreMotion's `gravity` is the direction of DOWN. That is the same
 *   expression Expo's iOS module uses, so iOS Safari's vector points DOWN.
 *
 * So the same field means opposite things on the two browsers this app must
 * run on. `X-11` in `docs/FINDINGS.md` recorded the Expo half of this; the
 * browser half is worse, because one API name now carries both conventions.
 * `WebGravityConvention` is therefore a REQUIRED argument of every function
 * that reads a motion event, and `detectMotionGravityConvention` settles it
 * from a pair of simultaneous events rather than from a user-agent string.
 *
 * ── THE ROUTE THAT AVOIDS THE SIGN ENTIRELY ────────────────────────────────
 * `deviceorientation`'s `beta` and `gamma` give gravity with no such
 * ambiguity, because both browsers decode them to the spec's angles from the
 * spec's own rotation matrix (WebKit's `WebCoreMotionManager.mm` builds that
 * matrix verbatim from § A.2 and inverts it). Gravity is the third row of that
 * matrix, negated:
 *
 *   ĝ = (cos β · sin γ, −sin β, −cos β · cos γ)
 *
 * alpha does not appear, which is what makes this usable on iOS where alpha is
 * relative. The four holds in `calibration.ts` fall straight out of it:
 * β=0, γ=0 → (0, 0, −1) face up; β=90 → (0, −1, 0) upright portrait;
 * β=180 → (0, 0, 1) face down; β=0, γ=90 → (1, 0, 0) right edge down. Those
 * are the vectors `sensors.ts` documents, so the orientation event is the
 * primary gravity route here and the motion event is a cross-check.
 *
 * ── THE HEADING THE OVERLAY ACTUALLY NEEDS ─────────────────────────────────
 * The camera looks out of the BACK of the screen, along −z in device
 * coordinates. Its compass bearing is the spec's own worked example § A.1:
 * "the compass heading of the horizontal component of a vector which is
 * orthogonal to the device's screen and pointing out of the back of the
 * screen". With R the ZXY matrix above and v = (0, 0, −1),
 *
 *   Vx = −cos α · sin γ − sin α · sin β · cos γ      (east)
 *   Vy = −sin α · sin γ + cos α · sin β · cos γ      (north)
 *   heading = atan2(Vx, Vy)
 *
 * The earth frame is east/north/up with north MAGNETIC, per the Orientation
 * Sensor specification's "Earth's reference coordinate system": "y-axis is
 * tangential to the ground and points towards magnetic north". So a heading
 * derived this way is magnetic, never true, and every result here is labelled
 * accordingly.
 *
 * ── WHAT EACH BROWSER CAN AND CANNOT ANSWER ────────────────────────────────
 * Chromium fires `deviceorientationabsolute`, whose alpha is referenced to the
 * earth frame, so the formula above applies directly. It reports no accuracy
 * figure of any kind.
 *
 * iOS Safari does not implement `deviceorientationabsolute` at all: the string
 * appears in WebKit's tree only inside imported web-platform-tests. Its
 * `deviceorientation` alpha is relative, because
 * `WebCoreMotionManager.mm` calls `startDeviceMotionUpdates` with no reference
 * frame, which leaves CoreMotion on its arbitrary-azimuth default. iOS instead
 * adds two non-standard fields, and the same file shows exactly what they are:
 *
 *   webkitCompassHeading   = CLHeading.magneticHeading
 *   webkitCompassAccuracy  = CLHeading.headingAccuracy
 *
 * and, when no compass is available, 0 and −1 respectively. A reported heading
 * of 0 is therefore ambiguous between "pointing north" and "no compass", and
 * only the accuracy separates them — so a negative accuracy is refused here
 * before the heading is read. Apple documents the −1 independently:
 * webkitCompassAccuracy is "The accuracy of the compass data in degrees …
 * A value of -1 means that the compass is not calibrated and not giving usable
 * readings", and webkitCompassHeading is "measured in degrees relative to
 * magnetic north … A negative value indicates an invalid direction".
 *
 * ── THE ONE THING THE PHONE MUST SETTLE ────────────────────────────────────
 * `webkitCompassHeading` is CLHeading, and CoreLocation references CLHeading
 * to an axis, not to the camera. Apple's `CLLocationManager.headingOrientation`
 * documents the default: "the location manager assumes that the top of the
 * device in portrait mode represents due north (0 degrees) by default", and
 * WebKit never sets that property. So the documented reading is the bearing of
 * the device's +y axis — the portrait TOP EDGE — tilt-compensated by
 * CoreLocation and unaffected by screen rotation.
 *
 * Hold the phone upright to photograph the horizon and that axis points at the
 * sky. Its horizontal projection vanishes, so the documented reading cannot
 * give the camera's bearing in exactly the pose the field test uses. What
 * CoreLocation actually returns there is not documented anywhere this project
 * could reach. Two hypotheses are therefore implemented side by side as
 * `CompassReferenceHypothesis`, both refusing rather than guessing when their
 * own input is degenerate, and a ten-second Safari recording decides between
 * them. Nothing in this module picks a winner.
 *
 * Pure, per `src/core`'s rules: no DOM types, no clock, no user-agent sniffing.
 * The event types below are structural mirrors, so this file compiles and tests
 * with no browser present.
 */

import type { Vector3 } from './calibration.js';
import type { GravitySample, HeadingSample } from './sensors.js';

/** Standard gravity, m/s². WebKit's `kGravity`, and the spec's own scale. */
export const STANDARD_GRAVITY_MS2 = 9.80665;

/**
 * Which sign convention a `devicemotion` event's gravity follows.
 *
 * `'w3c-specific-force'` is the spec's: the vector points UP for a resting
 * device, and gravity is its negation. `'coremotion-gravity'` is WebKit's on
 * iOS: the vector already points DOWN. There is no third option and no
 * default, because a wrong guess inverts every pitch while looking plausible.
 */
export type WebGravityConvention = 'w3c-specific-force' | 'coremotion-gravity';

/** Structural mirror of `DeviceOrientationEvent`, both browsers' fields. */
export interface WebOrientationEventLike {
  /** Rotation about z, degrees in [0, 360). Null when unavailable. */
  readonly alpha: number | null;
  /** Rotation about x', degrees in [-180, 180). */
  readonly beta: number | null;
  /** Rotation about y'', degrees in [-90, 90). */
  readonly gamma: number | null;
  /** Chromium only: true when alpha is referenced to the earth frame. */
  readonly absolute?: boolean | null;
  /** iOS only: CLHeading.magneticHeading, or 0 with accuracy −1 if absent. */
  readonly webkitCompassHeading?: number | null;
  /** iOS only: CLHeading.headingAccuracy, degrees. Negative means unusable. */
  readonly webkitCompassAccuracy?: number | null;
}

/** One `{x, y, z}` channel of a `devicemotion` event. Components may be null. */
export interface WebMotionVectorLike {
  readonly x: number | null;
  readonly y: number | null;
  readonly z: number | null;
}

/** Structural mirror of `DeviceMotionEvent`. */
export interface WebMotionEventLike {
  readonly acceleration?: WebMotionVectorLike | null;
  readonly accelerationIncludingGravity?: WebMotionVectorLike | null;
  /** Reporting interval, ms. Passed through for diagnostics only. */
  readonly interval?: number | null;
}

/** Why a raw browser event could not become a sample. */
export type WebSampleRefusal =
  /** alpha/beta/gamma are null — no permission, or no sensor on this device. */
  | 'no-orientation'
  /** `accelerationIncludingGravity` absent from the payload entirely. */
  | 'no-gravity-channel'
  /** A component was null, NaN or Infinity. Chromium reports NaN, not null. */
  | 'not-finite'
  /** No `webkitCompassHeading` on this event, or it is negative (invalid). */
  | 'no-compass'
  /** `webkitCompassAccuracy` is negative: CoreLocation has no usable reading. */
  | 'compass-uncalibrated'
  /** alpha is not earth-referenced, and nothing was supplied to anchor it. */
  | 'relative-alpha'
  /** The camera points within a degree of straight up or down. */
  | 'camera-near-vertical'
  /** The compass's own reference axis is near vertical, so it cannot be used. */
  | 'compass-reference-near-vertical'
  /** `screen.orientation.angle` was not one of 0, 90, 180, 270. */
  | 'bad-screen-angle';

export type WebOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: WebSampleRefusal };

function refuse<T>(refusal: WebSampleRefusal): WebOutcome<T> {
  return { ok: false, refusal };
}

const DEG = Math.PI / 180;

function toDegrees(rad: number): number {
  return rad / DEG;
}

function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/* ══════════════════════════════════════════════════════════════════════════
 * The spec's rotation matrix, and the three body vectors read off it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The ZXY rotation matrix of § A.2, row-major, mapping DEVICE coordinates to
 * the earth frame (x east, y magnetic north, z up).
 *
 * Transcribed from the specification's own `getRotationMatrix`, which WebKit
 * also builds verbatim. Keeping the transcription literal is deliberate: every
 * rearrangement of these nine terms is a chance to transpose the matrix, and a
 * transposed rotation matrix produces headings that look like headings.
 */
export function rotationMatrixFromOrientation(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): readonly [number, number, number, number, number, number, number, number, number] {
  const cX = Math.cos(betaDeg * DEG);
  const cY = Math.cos(gammaDeg * DEG);
  const cZ = Math.cos(alphaDeg * DEG);
  const sX = Math.sin(betaDeg * DEG);
  const sY = Math.sin(gammaDeg * DEG);
  const sZ = Math.sin(alphaDeg * DEG);
  return [
    cZ * cY - sZ * sX * sY,
    -cX * sZ,
    cY * sZ * sX + cZ * sY,
    cY * sZ + cZ * sX * sY,
    cZ * cX,
    sZ * sY - cZ * cY * sX,
    -cX * sY,
    sX,
    cX * cY,
  ];
}

/**
 * Gravity — DOWN in device coordinates, unit length — from beta and gamma.
 *
 * This is the negated third row of the matrix above, which is the earth frame's
 * "up" expressed in device coordinates. alpha cancels out of the third row, so
 * a relative alpha costs nothing here.
 */
export function gravityFromOrientation(betaDeg: number, gammaDeg: number): Vector3 {
  const cX = Math.cos(betaDeg * DEG);
  const cY = Math.cos(gammaDeg * DEG);
  const sX = Math.sin(betaDeg * DEG);
  const sY = Math.sin(gammaDeg * DEG);
  return { x: cX * sY, y: -sX, z: -cX * cY };
}

/** A bearing, with how sharply an attitude error would move it. */
export interface WebBearing {
  /** Degrees clockwise from MAGNETIC north, in [0, 360). */
  readonly headingDeg: number;
  /**
   * Length of the axis's horizontal projection, in [0, 1]. One degree of
   * attitude error moves the bearing by about `1 / horizontalFraction` degrees,
   * so this is the conditioning of the bearing, not its error.
   */
  readonly horizontalFraction: number;
}

/**
 * Below this horizontal projection the bearing of an axis is refused.
 * sin 1° — the axis is then within a degree of vertical and its azimuth is
 * whatever the last bit of noise says.
 */
export const MIN_HORIZONTAL_FRACTION = Math.sin(1 * DEG);

function bearingOf(east: number, north: number): WebOutcome<WebBearing> {
  const horizontalFraction = Math.hypot(east, north);
  if (!Number.isFinite(horizontalFraction) || horizontalFraction < MIN_HORIZONTAL_FRACTION) {
    return refuse('camera-near-vertical');
  }
  return {
    ok: true,
    value: { headingDeg: normaliseDeg(toDegrees(Math.atan2(east, north))), horizontalFraction },
  };
}

/**
 * The magnetic bearing the REAR CAMERA faces — the spec's § A.1 quantity.
 *
 * Requires an alpha that is referenced to the earth frame. Refuses when the
 * camera is within a degree of straight up or down, where the bearing has no
 * meaning; `sensors.ts` refuses roll in the same band for the same reason.
 */
export function rearCameraBearing(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): WebOutcome<WebBearing> {
  const m = rotationMatrixFromOrientation(alphaDeg, betaDeg, gammaDeg);
  const m13 = m[2];
  const m23 = m[5];
  return bearingOf(-m13, -m23);
}

/**
 * The magnetic bearing of the device's PORTRAIT TOP EDGE (+y) — CLHeading's
 * documented reference axis.
 *
 * This is the second column of the matrix. Refuses when the top edge is near
 * vertical, which is where a phone held up to the horizon puts it.
 */
export function topEdgeBearing(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): WebOutcome<WebBearing> {
  const m = rotationMatrixFromOrientation(alphaDeg, betaDeg, gammaDeg);
  const m12 = m[1];
  const m22 = m[4];
  const outcome = bearingOf(m12, m22);
  if (!outcome.ok) return refuse('compass-reference-near-vertical');
  return outcome;
}

/**
 * The earth-referenced alpha implied by a measured top-edge bearing.
 *
 * Inverting `topEdgeBearing` costs nothing in conditioning — a rotation of the
 * whole device about the earth's vertical moves alpha and every body axis's
 * bearing by the same angle — but the MEASUREMENT degrades as the top edge
 * approaches vertical, and `horizontalFraction` is how far along that path the
 * pose is.
 *
 * Two branches, because the top edge tips over when the phone leans past
 * upright: for cos β > 0 the bearing is −alpha, and for cos β < 0 it is
 * 180° − alpha. gamma does not appear in either, because the top edge's
 * horizontal projection has length |cos β| whatever gamma is.
 */
export function absoluteAlphaFromTopEdgeBearing(
  topEdgeHeadingDeg: number,
  betaDeg: number,
): WebOutcome<{ readonly alphaDeg: number; readonly horizontalFraction: number }> {
  const cX = Math.cos(betaDeg * DEG);
  const horizontalFraction = Math.abs(cX);
  if (!Number.isFinite(horizontalFraction) || horizontalFraction < MIN_HORIZONTAL_FRACTION) {
    return refuse('compass-reference-near-vertical');
  }
  const alphaDeg = normaliseDeg(cX > 0 ? -topEdgeHeadingDeg : 180 - topEdgeHeadingDeg);
  return { ok: true, value: { alphaDeg, horizontalFraction } };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Gravity samples
 * ══════════════════════════════════════════════════════════════════════════ */

/** A gravity sample, plus what had to be assumed to get it. */
export interface WebGravityResult {
  readonly sample: GravitySample;
  /**
   * True when user acceleration could not be removed, so the vector is gravity
   * plus whatever the hand was doing. `GRAVITY_MAGNITUDE_RANGE` in
   * `sensors.ts` is what catches the cases where that matters.
   */
  readonly contaminated: boolean;
  /** Which event supplied it. The orientation route cannot be contaminated. */
  readonly source: 'orientation' | 'motion';
}

/**
 * Gravity from a `deviceorientation` event. The sign-unambiguous route.
 *
 * The vector is exact and unit-length by construction, so there is no
 * magnitude to sanity-check and no user acceleration mixed in: the browser's
 * sensor fusion already separated them to produce beta and gamma.
 */
export function gravitySampleFromWebOrientation(
  event: WebOrientationEventLike,
  receivedAtMs: number,
): WebOutcome<WebGravityResult> {
  if (!isFiniteNumber(event.beta) || !isFiniteNumber(event.gamma)) {
    return refuse('no-orientation');
  }
  const g = gravityFromOrientation(event.beta, event.gamma);
  return {
    ok: true,
    value: {
      sample: { timestampMs: receivedAtMs, x: g.x, y: g.y, z: g.z },
      contaminated: false,
      source: 'orientation',
    },
  };
}

function readVector(v: WebMotionVectorLike | null | undefined): Vector3 | undefined {
  if (!v) return undefined;
  if (!isFiniteNumber(v.x) || !isFiniteNumber(v.y) || !isFiniteNumber(v.z)) return undefined;
  return { x: v.x, y: v.y, z: v.z };
}

/**
 * Gravity from a `devicemotion` event, in the caller's stated convention.
 *
 * `acceleration` is subtracted when present, exactly as in `device-samples.ts`,
 * then the result is divided by standard gravity so the magnitude means g
 * rather than m/s². `sensors.ts`'s plausibility gate is a physical check, so
 * handing it a 9.8-magnitude vector reads as a hardware fault.
 *
 * An `acceleration` of exactly (0, 0, 0) is treated as absent. On iOS that is
 * a real state rather than a still hand: when no gyroscope is available,
 * `WebCoreMotionManager.mm` publishes the raw accelerometer as
 * `accelerationIncludingGravity` and literal zeros for `acceleration`, so
 * subtracting it would claim a clean vector from a contaminated one.
 */
export function gravitySampleFromWebMotion(
  event: WebMotionEventLike,
  receivedAtMs: number,
  convention: WebGravityConvention,
): WebOutcome<WebGravityResult> {
  if (event.accelerationIncludingGravity === undefined || event.accelerationIncludingGravity === null) {
    return refuse('no-gravity-channel');
  }
  const withGravity = readVector(event.accelerationIncludingGravity);
  if (!withGravity) return refuse('not-finite');

  const linear = readVector(event.acceleration);
  const linearIsZero = linear !== undefined && linear.x === 0 && linear.y === 0 && linear.z === 0;
  const usableLinear = linearIsZero ? undefined : linear;
  const contaminated = usableLinear === undefined;

  const sign = convention === 'w3c-specific-force' ? -1 : 1;
  const scale = sign / STANDARD_GRAVITY_MS2;
  const x = (withGravity.x - (usableLinear?.x ?? 0)) * scale;
  const y = (withGravity.y - (usableLinear?.y ?? 0)) * scale;
  const z = (withGravity.z - (usableLinear?.z ?? 0)) * scale;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    return refuse('not-finite');
  }

  return {
    ok: true,
    value: {
      sample: { timestampMs: receivedAtMs, x, y, z },
      contaminated,
      source: 'motion',
    },
  };
}

/**
 * Which motion convention a browser is using, decided from a simultaneous pair
 * of events rather than from its user-agent string.
 *
 * The orientation event's beta and gamma give gravity with no sign ambiguity,
 * so the motion event's vector either agrees with that direction or opposes
 * it. Returns undefined when the two are too close to perpendicular to decide,
 * which happens while the phone is being shaken and at the free-fall limit.
 *
 * The threshold is a dot product of 0.5 between unit vectors — 60° — which is
 * far looser than needed to separate two answers that are 180° apart, and
 * loose enough that a hand's wobble does not make the test refuse.
 */
export function detectMotionGravityConvention(
  motion: WebMotionEventLike,
  orientation: WebOrientationEventLike,
): WebGravityConvention | undefined {
  if (!isFiniteNumber(orientation.beta) || !isFiniteNumber(orientation.gamma)) return undefined;
  const expected = gravityFromOrientation(orientation.beta, orientation.gamma);
  const measured = readVector(motion.accelerationIncludingGravity);
  if (!measured) return undefined;
  const magnitude = Math.hypot(measured.x, measured.y, measured.z);
  if (!Number.isFinite(magnitude) || magnitude === 0) return undefined;
  const dot =
    (measured.x * expected.x + measured.y * expected.y + measured.z * expected.z) / magnitude;
  if (dot >= 0.5) return 'coremotion-gravity';
  if (dot <= -0.5) return 'w3c-specific-force';
  return undefined;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Heading samples
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What `webkitCompassHeading` is the bearing OF. Unsettled, so both candidates
 * are implemented and neither is preferred by this module.
 *
 * `'device-top-edge'` is what Apple documents: CLHeading referenced to the top
 * of the device in portrait, which WebKit never overrides. Under it the
 * camera's bearing is recovered by turning the reading into an earth-referenced
 * alpha and then reading the camera axis off the rotation matrix, and the
 * recovery refuses when the top edge is near vertical.
 *
 * `'rear-camera-axis'` is the hypothesis that CoreLocation reports the bearing
 * of whichever axis is closest to horizontal, which would make the reading the
 * camera's bearing directly for an upright phone. Nothing in Apple's
 * documentation says this; it is here so a recording can score it.
 */
export type CompassReferenceHypothesis = 'device-top-edge' | 'rear-camera-axis';

/**
 * Widest heading uncertainty worth drawing, degrees. Past a quarter turn the
 * band spans more sky than the frame shows, so a refusal says more than a
 * label with a ±90° caveat on it.
 */
export const MAX_USEFUL_ACCURACY_DEG = 90;

/**
 * How much of the camera axis is horizontal, from beta and gamma alone.
 *
 * The camera's vertical component in the earth frame is −cos β · cos γ,
 * independent of alpha, and that number is also the pitch `sensors.ts` derives
 * from gravity: `asin(ĝ_z)` with `ĝ_z = −cos β · cos γ`. One quantity, two
 * derivations, which is why the two modules cannot disagree about where the
 * gimbal zone is.
 */
function rearCameraHorizontalFraction(betaDeg: number, gammaDeg: number): WebOutcome<number> {
  const vertical = -Math.cos(betaDeg * DEG) * Math.cos(gammaDeg * DEG);
  const horizontalFraction = Math.sqrt(Math.max(0, 1 - vertical * vertical));
  if (!Number.isFinite(horizontalFraction) || horizontalFraction < MIN_HORIZONTAL_FRACTION) {
    return refuse('camera-near-vertical');
  }
  return { ok: true, value: horizontalFraction };
}

/** A heading sample, plus the basis and the axis it was derived through. */
export interface WebHeadingResult {
  readonly sample: HeadingSample;
  /**
   * Always `'magnetic'`. Both routes end at magnetic north: the earth frame of
   * the orientation specification has its y axis on magnetic north, and
   * CLHeading.magneticHeading is magnetic by name. Declination is applied
   * downstream, explicitly, or the heading is drawn labelled magnetic.
   */
  readonly basis: 'magnetic';
  /** Which event and which axis produced it. */
  readonly route: 'absolute-alpha' | 'compass-top-edge' | 'compass-camera-axis';
  /** The bearing and its conditioning. */
  readonly bearing: WebBearing;
}

/**
 * The rear camera's magnetic bearing from a Chromium
 * `deviceorientationabsolute` event.
 *
 * Refuses an event whose alpha is not earth-referenced. `absolute` is the only
 * evidence available for that, and iOS does not have the attribute at all —
 * WebKit's `DeviceOrientationEvent.idl` exposes `webkitCompassHeading` and
 * `webkitCompassAccuracy` in its place — so an undefined `absolute` is treated
 * as "not absolute" rather than as "probably fine".
 *
 * No `accuracyDeg` is set: Chromium publishes no accuracy figure for
 * orientation, and inventing one would put a number the platform never gave
 * into a field the uncertainty band reads.
 */
export function headingSampleFromWebOrientation(
  event: WebOrientationEventLike,
  receivedAtMs: number,
): WebOutcome<WebHeadingResult> {
  if (!isFiniteNumber(event.alpha) || !isFiniteNumber(event.beta) || !isFiniteNumber(event.gamma)) {
    return refuse('no-orientation');
  }
  if (event.absolute !== true) return refuse('relative-alpha');
  const bearing = rearCameraBearing(event.alpha, event.beta, event.gamma);
  if (!bearing.ok) return bearing;
  return {
    ok: true,
    value: {
      sample: { timestampMs: receivedAtMs, magneticDeg: bearing.value.headingDeg },
      basis: 'magnetic',
      route: 'absolute-alpha',
      bearing: bearing.value,
    },
  };
}

/** A validated `webkitCompassHeading` / `webkitCompassAccuracy` pair. */
export interface WebCompassReading {
  /** Degrees clockwise from magnetic north, in [0, 360). */
  readonly headingDeg: number;
  /** CLHeading.headingAccuracy, degrees. Non-negative by the time it is here. */
  readonly accuracyDeg: number;
}

/**
 * Read and validate iOS's two non-standard fields.
 *
 * Accuracy is checked BEFORE the heading, because WebKit publishes heading 0
 * with accuracy −1 when no compass is available, and a heading of 0 is
 * otherwise a perfectly good reading. Checking the other way round would let
 * "no compass" through as "pointing at magnetic north".
 */
export function webCompassReading(
  event: WebOrientationEventLike,
): WebOutcome<WebCompassReading> {
  const accuracy = event.webkitCompassAccuracy;
  // Absent or null is a browser without the field; a negative number is a
  // browser that has it and says the reading is unusable. Different states.
  if (accuracy === undefined || accuracy === null) return refuse('no-compass');
  if (!isFiniteNumber(accuracy) || accuracy < 0) return refuse('compass-uncalibrated');
  const heading = event.webkitCompassHeading;
  if (!isFiniteNumber(heading) || heading < 0) return refuse('no-compass');
  return { ok: true, value: { headingDeg: normaliseDeg(heading), accuracyDeg: accuracy } };
}

/**
 * The rear camera's magnetic bearing from an iOS event, under one hypothesis
 * about what `webkitCompassHeading` references.
 *
 * Under `'device-top-edge'` the reported accuracy is inflated by
 * `1 / horizontalFraction`, the first-order propagation of an attitude error
 * about the vertical through a projection that is shrinking. That inflation is
 * a bound derived from geometry, not a measurement, and it may double-count if
 * the home recording shows CoreLocation already widens its own figure near
 * vertical. It is capped at `MAX_USEFUL_ACCURACY_DEG`, beyond which the
 * bearing is refused instead of drawn.
 */
export function rearCameraHeadingUnderHypothesis(
  event: WebOrientationEventLike,
  hypothesis: CompassReferenceHypothesis,
  receivedAtMs: number,
): WebOutcome<WebHeadingResult> {
  if (!isFiniteNumber(event.beta) || !isFiniteNumber(event.gamma)) return refuse('no-orientation');
  const compass = webCompassReading(event);
  if (!compass.ok) return compass;

  if (hypothesis === 'rear-camera-axis') {
    // The reading IS the camera's bearing, so nothing is derived and nothing is
    // amplified. The camera's own conditioning still applies: a phone pointed
    // at its feet has no bearing whatever the compass says.
    const geometry = rearCameraHorizontalFraction(event.beta, event.gamma);
    if (!geometry.ok) return refuse('camera-near-vertical');
    return {
      ok: true,
      value: {
        sample: {
          timestampMs: receivedAtMs,
          magneticDeg: compass.value.headingDeg,
          accuracyDeg: compass.value.accuracyDeg,
        },
        basis: 'magnetic',
        route: 'compass-camera-axis',
        bearing: {
          headingDeg: compass.value.headingDeg,
          horizontalFraction: geometry.value,
        },
      },
    };
  }

  const alpha = absoluteAlphaFromTopEdgeBearing(compass.value.headingDeg, event.beta);
  if (!alpha.ok) return alpha;
  const accuracyDeg = compass.value.accuracyDeg / alpha.value.horizontalFraction;
  if (!Number.isFinite(accuracyDeg) || accuracyDeg > MAX_USEFUL_ACCURACY_DEG) {
    return refuse('compass-reference-near-vertical');
  }
  const bearing = rearCameraBearing(alpha.value.alphaDeg, event.beta, event.gamma);
  if (!bearing.ok) return bearing;
  return {
    ok: true,
    value: {
      sample: { timestampMs: receivedAtMs, magneticDeg: bearing.value.headingDeg, accuracyDeg },
      basis: 'magnetic',
      route: 'compass-top-edge',
      bearing: bearing.value,
    },
  };
}

/**
 * The rear camera's magnetic bearing from a RELATIVE alpha plus a stored
 * offset — the route that works for an upright phone on iOS.
 *
 * `alphaOffsetDeg` converts relative alpha to earth-referenced alpha and is
 * estimated by the live loop at moments when `absoluteAlphaFromTopEdgeBearing`
 * is well conditioned, then held while the phone is raised. Estimating and
 * holding it is stateful, so it belongs to the loop; this function is the pure
 * half, and it is exact at the upright pose where the compass route refuses.
 */
export function rearCameraHeadingFromRelativeAlpha(
  event: WebOrientationEventLike,
  alphaOffsetDeg: number,
  receivedAtMs: number,
  accuracyDeg?: number,
): WebOutcome<WebHeadingResult> {
  if (!isFiniteNumber(event.alpha) || !isFiniteNumber(event.beta) || !isFiniteNumber(event.gamma)) {
    return refuse('no-orientation');
  }
  if (!Number.isFinite(alphaOffsetDeg)) return refuse('relative-alpha');
  const bearing = rearCameraBearing(event.alpha + alphaOffsetDeg, event.beta, event.gamma);
  if (!bearing.ok) return bearing;
  return {
    ok: true,
    value: {
      sample: {
        timestampMs: receivedAtMs,
        magneticDeg: bearing.value.headingDeg,
        ...(accuracyDeg !== undefined ? { accuracyDeg } : {}),
      },
      basis: 'magnetic',
      route: 'absolute-alpha',
      bearing: bearing.value,
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The one call the live loop makes
 * ══════════════════════════════════════════════════════════════════════════ */

/** Screen rotation relative to the device's natural orientation, degrees. */
export type WebScreenAngle = 0 | 90 | 180 | 270;

/**
 * Validate `screen.orientation.angle`.
 *
 * Nothing in the pose depends on it. The orientation specification is explicit
 * that the device coordinate frame is fixed to the device: "If the orientation
 * of the screen changes when the device is rotated … this does not affect the
 * orientation of the coordinate frame relative to the device." Apple's
 * CLHeading reference edge is fixed the same way, because WebKit never sets
 * `headingOrientation` away from its portrait default.
 *
 * So the angle is carried, not applied. It is what the UI needs to draw a
 * device-frame roll into a rotated layout, and the sign of that mapping is one
 * of the things the home recording settles.
 */
export function normaliseScreenAngle(angleDeg: number): WebScreenAngle | undefined {
  if (!Number.isFinite(angleDeg)) return undefined;
  const wrapped = normaliseDeg(angleDeg);
  return wrapped === 0 || wrapped === 90 || wrapped === 180 || wrapped === 270
    ? (wrapped as WebScreenAngle)
    : undefined;
}

export interface WebOrientationSampleOptions {
  /** Which axis `webkitCompassHeading` refers to. Default `'device-top-edge'`. */
  readonly compassReference?: CompassReferenceHypothesis;
  /**
   * Offset that converts this event's relative alpha to an earth-referenced
   * one. When supplied it takes precedence over the compass routes, because it
   * stays well conditioned at the upright pose where they do not.
   */
  readonly alphaOffsetDeg?: number;
}

/** One `deviceorientation` event, converted. Each field answers or refuses. */
export interface WebOrientationSample {
  readonly gravity: WebOutcome<WebGravityResult>;
  readonly heading: WebOutcome<WebHeadingResult>;
  readonly screenAngle: WebOutcome<WebScreenAngle>;
}

/**
 * Convert one `deviceorientation` or `deviceorientationabsolute` event.
 *
 * Gravity and heading are answered independently, so a pose keeps its pitch and
 * roll when the compass refuses — the same per-field provenance `sensors.ts`
 * and `poseWithSensors` already work in.
 *
 * Heading routes are tried in order of how well conditioned they are at the
 * pose this app is used in: a stored alpha offset first, then an absolute
 * alpha, then the iOS compass. The refusal returned is the last route's, so it
 * names the platform the caller is actually on.
 */
export function webOrientationSample(
  event: WebOrientationEventLike,
  screenAngleDeg: number,
  receivedAtMs: number,
  options: WebOrientationSampleOptions = {},
): WebOrientationSample {
  const angle = normaliseScreenAngle(screenAngleDeg);
  const screenAngle: WebOutcome<WebScreenAngle> =
    angle === undefined ? refuse('bad-screen-angle') : { ok: true, value: angle };

  let heading: WebOutcome<WebHeadingResult>;
  if (options.alphaOffsetDeg !== undefined) {
    heading = rearCameraHeadingFromRelativeAlpha(event, options.alphaOffsetDeg, receivedAtMs);
  } else if (event.absolute === true) {
    heading = headingSampleFromWebOrientation(event, receivedAtMs);
  } else {
    heading = rearCameraHeadingUnderHypothesis(
      event,
      options.compassReference ?? 'device-top-edge',
      receivedAtMs,
    );
  }

  return {
    gravity: gravitySampleFromWebOrientation(event, receivedAtMs),
    heading,
    screenAngle,
  };
}

/** One `devicemotion` event, converted. */
export interface WebMotionSample {
  readonly gravity: WebOutcome<WebGravityResult>;
  /** Reporting interval the event carried, ms, when it carried one. */
  readonly intervalMs?: number;
}

/** Convert one `devicemotion` event in the caller's stated convention. */
export function webMotionSample(
  event: WebMotionEventLike,
  receivedAtMs: number,
  convention: WebGravityConvention,
): WebMotionSample {
  return {
    gravity: gravitySampleFromWebMotion(event, receivedAtMs, convention),
    ...(isFiniteNumber(event.interval) ? { intervalMs: event.interval } : {}),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Replaying a recording
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * One recorded event. `tMs` is RELATIVE to the start of the capture: a
 * wall-clock stamp would date a session as precisely as a coordinate places it,
 * and `AGENTS.md`'s capture rules forbid both. No geolocation event has a place
 * in this type, deliberately.
 */
export type RecordedWebSensorEvent =
  | { readonly kind: 'orientation'; readonly tMs: number; readonly screenAngleDeg: number; readonly event: WebOrientationEventLike }
  | { readonly kind: 'motion'; readonly tMs: number; readonly event: WebMotionEventLike };

/** What a recording yielded: two traces, plus what was refused and why. */
export interface WebSensorReplay {
  readonly gravity: readonly GravitySample[];
  readonly heading: readonly HeadingSample[];
  /** Refusal counts by reason, so a recording reports its own gaps. */
  readonly refusals: Readonly<Partial<Record<WebSampleRefusal, number>>>;
  /** Screen angles seen, in order of first appearance. */
  readonly screenAngles: readonly WebScreenAngle[];
}

/**
 * Replay a recording into the traces `fuseSensorPose` consumes.
 *
 * Motion events contribute gravity only when `convention` is given. Leaving it
 * out replays the orientation route alone, which is the honest default for a
 * recording whose browser is not known: no sign is assumed.
 */
export function replayWebSensorEvents(
  events: readonly RecordedWebSensorEvent[],
  options: WebOrientationSampleOptions & { readonly motionConvention?: WebGravityConvention } = {},
): WebSensorReplay {
  const gravity: GravitySample[] = [];
  const heading: HeadingSample[] = [];
  const refusals: Partial<Record<WebSampleRefusal, number>> = {};
  const screenAngles: WebScreenAngle[] = [];

  const note = (outcome: { ok: boolean } & Partial<{ refusal: WebSampleRefusal }>): void => {
    if (outcome.ok || outcome.refusal === undefined) return;
    refusals[outcome.refusal] = (refusals[outcome.refusal] ?? 0) + 1;
  };

  for (const recorded of events) {
    if (recorded.kind === 'orientation') {
      const sample = webOrientationSample(
        recorded.event,
        recorded.screenAngleDeg,
        recorded.tMs,
        options,
      );
      if (sample.gravity.ok) gravity.push(sample.gravity.value.sample);
      else note(sample.gravity);
      if (sample.heading.ok) heading.push(sample.heading.value.sample);
      else note(sample.heading);
      if (sample.screenAngle.ok) {
        if (!screenAngles.includes(sample.screenAngle.value)) screenAngles.push(sample.screenAngle.value);
      } else note(sample.screenAngle);
      continue;
    }
    if (options.motionConvention === undefined) continue;
    const motion = webMotionSample(recorded.event, recorded.tMs, options.motionConvention);
    if (motion.gravity.ok) gravity.push(motion.gravity.value.sample);
    else note(motion.gravity);
  }

  return { gravity, heading, refusals, screenAngles };
}
