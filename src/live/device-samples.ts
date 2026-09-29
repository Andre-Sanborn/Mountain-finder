/**
 * Expo sensor payloads → this project's `GravitySample` / `HeadingSample`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/live/sensors.ts` consumes a clean, documented convention: gravity as
 * the direction of DOWN in device coordinates, unit magnitude, timestamps in
 * epoch-ish milliseconds. Expo hands out something else entirely — m/s², a
 * *derived* gravity channel that does not exist as a field, timestamps in
 * seconds on a different clock, and a compass "accuracy" that is a 0–3 bucket
 * rather than degrees.
 *
 * Every one of those is a place where a plausible wrong number gets through.
 * So the conversion lives here, pure and tested, instead of being scattered
 * through a React Native component where nothing can check it.
 *
 * ── WHAT WAS VERIFIED, AND HOW (2026-08-18) ────────────────────────────────
 * Not from the docs (blocked at this environment's egress) and not from
 * memory. From the native source that ships inside `expo-sensors@57.0.2`,
 * quoted here so a later reader can re-check the claim without a phone:
 *
 *   iOS — ios/DeviceMotionModule.swift:
 *     "acceleration":                    userAcceleration * GRAVITY
 *     "accelerationIncludingGravity":   (userAcceleration + data.gravity) * GRAVITY
 *
 *   Android — DeviceMotionModule.kt:
 *     "acceleration":                    TYPE_LINEAR_ACCELERATION
 *     "accelerationIncludingGravity":    TYPE_ACCELEROMETER − 2 × TYPE_GRAVITY
 *
 * Subtracting gives the SAME vector on both platforms:
 *
 *   iOS      (uA + g)·G − uA·G                     = g·G
 *   Android  (LA + G_up) − 2·G_up − LA             = −G_up = G_down
 *
 * where CoreMotion's `data.gravity` and Android's negated `TYPE_GRAVITY` are
 * both the direction of DOWN. Dividing by 9.80665 yields exactly the unit
 * vector `GravitySample` documents — **with no sign flip**.
 *
 * That last clause is the point of doing this properly. The W3C DeviceMotion
 * spec defines `accelerationIncludingGravity` as the *specific force*, which
 * points UP for a resting device — the opposite sign. Expo's iOS module does
 * not follow the spec here, and Android's `− 2 × gravity` term exists solely
 * to bend the platform into iOS's convention. Anyone reasoning from the W3C
 * definition (as I was about to) gets a pitch that is correct in magnitude and
 * inverted in sign — which passes a smoke test, looks like a plausible
 * mountain overlay, and is wrong. `docs/FINDINGS.md` carries this as X-11.
 *
 * ── THE TWO CLOCKS ─────────────────────────────────────────────────────────
 * DeviceMotion timestamps are **seconds since device boot** (iOS:
 * `CMDeviceMotion.timestamp`; Android: `SensorEvent.timestamp / 1e9`).
 * `LocationHeadingObject` carries **no timestamp at all**. Since
 * `fuseSensorPose` compares both traces against one `atMs`, feeding it two
 * different clock origins would silently mark one trace permanently stale.
 *
 * So both adapters stamp samples with a caller-supplied `receivedAtMs` — one
 * clock, chosen by the shell — and the device's own timestamp is preserved
 * separately as `deviceTimestampMs` for jitter diagnostics. At the 60 Hz these
 * sensors run, arrival time and sample time differ by well under a frame,
 * which is far below the smoothing time constant (400 ms).
 *
 * Pure, per `src/core`'s rules: no clock is read here, no Expo module is
 * imported. The payload types below are structural mirrors of Expo's, so this
 * file compiles and tests in this environment with no mobile toolchain.
 */

import type { GravitySample, HeadingSample } from './sensors.js';

/** Standard gravity, m/s². The exact constant both Expo platforms scale by. */
export const STANDARD_GRAVITY_MS2 = 9.80665;

/** One `{x, y, z}` channel of a DeviceMotion payload. `timestamp` is SECONDS. */
export interface MotionVectorLike {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly timestamp?: number;
}

/**
 * Structural mirror of Expo's `DeviceMotionMeasurement`.
 *
 * `accelerationIncludingGravity` is typed optional even though Expo types it
 * as always present: the Android module only writes that key when BOTH the
 * accelerometer and gravity sensor have reported at least once, so a device
 * that is still warming up genuinely emits a payload without it.
 */
export interface DeviceMotionLike {
  readonly acceleration?: MotionVectorLike | null;
  readonly accelerationIncludingGravity?: MotionVectorLike | null;
  /** Screen rotation: 0 portrait, 90 right-landscape, 180 upside-down, −90 left. */
  readonly orientation?: number;
  readonly interval?: number;
}

/** Why a raw payload could not become a `GravitySample`. */
export type SampleRefusal =
  /** Neither channel needed to isolate gravity was present in the payload. */
  | 'no-gravity-channel'
  /** A component was NaN/Infinity — never propagate that into geometry. */
  | 'not-finite'
  /** Compass reported no usable heading (see `headingSampleFromLocation`). */
  | 'no-heading';

/**
 * A gravity sample plus what had to be assumed to get it.
 *
 * `contaminated` is true when the payload carried no separate `acceleration`
 * channel, so user acceleration could not be subtracted out and the vector is
 * gravity PLUS whatever the hand was doing. That is not fatal — a phone being
 * held still is dominated by gravity — but it is exactly what
 * `GRAVITY_MAGNITUDE_RANGE` in `sensors.ts` exists to catch, and a UI may
 * prefer to wait for a clean sample rather than show a wobbling horizon.
 */
export interface GravitySampleResult {
  readonly sample: GravitySample;
  readonly contaminated: boolean;
  /** The device's own timestamp in ms (boot-relative), when it supplied one. */
  readonly deviceTimestampMs?: number;
  /** Screen rotation the payload reported, passed through unchanged. */
  readonly orientation?: number;
}

export type SampleOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refusal: SampleRefusal };

function isFiniteVector(v: MotionVectorLike): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Isolate CoreMotion-convention gravity from one DeviceMotion payload.
 *
 * The result is a UNIT vector: `sensors.ts` re-normalises anyway, but its
 * magnitude gate is a physical plausibility check, so the magnitude handed to
 * it must mean "g", not "m/s²". A 9.81-magnitude vector would be rejected as
 * `not-gravity` by a module that is otherwise entirely correct — a bug that
 * reads as a hardware fault.
 */
export function gravitySampleFromDeviceMotion(
  motion: DeviceMotionLike,
  receivedAtMs: number,
): SampleOutcome<GravitySampleResult> {
  const withGravity = motion.accelerationIncludingGravity;
  if (!withGravity) return { ok: false, refusal: 'no-gravity-channel' };
  if (!isFiniteVector(withGravity)) return { ok: false, refusal: 'not-finite' };

  const linear = motion.acceleration;
  const contaminated = !linear || !isFiniteVector(linear);
  // (uA + g)·G − uA·G = g·G exactly — see the derivation in the header. When
  // the linear channel is absent the difference degenerates to the sum, which
  // is gravity plus user acceleration; `contaminated` says so rather than
  // pretending otherwise.
  const gx = (withGravity.x - (contaminated ? 0 : (linear?.x ?? 0))) / STANDARD_GRAVITY_MS2;
  const gy = (withGravity.y - (contaminated ? 0 : (linear?.y ?? 0))) / STANDARD_GRAVITY_MS2;
  const gz = (withGravity.z - (contaminated ? 0 : (linear?.z ?? 0))) / STANDARD_GRAVITY_MS2;

  if (!Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz)) {
    return { ok: false, refusal: 'not-finite' };
  }

  const deviceTimestampS = withGravity.timestamp;
  return {
    ok: true,
    value: {
      sample: { timestampMs: receivedAtMs, x: gx, y: gy, z: gz },
      contaminated,
      ...(deviceTimestampS !== undefined && Number.isFinite(deviceTimestampS)
        ? { deviceTimestampMs: deviceTimestampS * 1000 }
        : {}),
      ...(motion.orientation !== undefined ? { orientation: motion.orientation } : {}),
    },
  };
}

/** Structural mirror of expo-location's `LocationHeadingObject`. */
export interface LocationHeadingLike {
  /** Degrees from true north, or **−1** when location permission is missing. */
  readonly trueHeading: number;
  /** Degrees from magnetic north. */
  readonly magHeading: number;
  /** Calibration BUCKET, not degrees: 3 high … 0 unusable. */
  readonly accuracy: number;
}

/**
 * Apple's documented uncertainty ceiling for each calibration bucket, degrees,
 * indexed by `LocationHeadingObject.accuracy`.
 *
 * These are **upper bounds quoted from the platform** ("3: < 20 degrees
 * uncertainty, 2: < 35, 1: < 50, 0: > 50"), not estimates of the true error.
 * Bucket 0 has no ceiling at all, so it maps to −1 — `smoothedHeading`'s
 * documented "invalid" marker, which makes it drop the sample.
 *
 * The alternative — passing `accuracy` straight through — would put the number
 * 3 into a field named `accuracyDeg` and quietly claim three-degree precision
 * from the least trustworthy channel in the system. This project has been
 * caught twice by a sentinel read as a measurement (SRTM's −32768, and
 * `trueHeading`'s −1 immediately below); the pattern gets a named constant.
 */
export const HEADING_ACCURACY_CEILING_DEG: readonly number[] = [-1, 50, 35, 20];

/** Bucket → degrees, with anything outside 0–3 treated as unusable. */
export function headingAccuracyCeilingDeg(bucket: number): number {
  if (!Number.isInteger(bucket)) return -1;
  return HEADING_ACCURACY_CEILING_DEG[bucket] ?? -1;
}

/**
 * One compass reading → a `HeadingSample`.
 *
 * `trueHeading` is −1 when the app lacks location permission, and Android can
 * report it absent in other ways; any non-finite or negative value therefore
 * drops the true-north field entirely rather than being averaged in. What
 * survives is `magneticDeg`, which makes the downstream refusal
 * `needs-declination` — the correct, honest outcome. Silently treating a
 * magnetic bearing as true is the exact failure `src/exif/resolve.ts` refuses,
 * and it is worth 10–20° in the mountains.
 */
export function headingSampleFromLocation(
  heading: LocationHeadingLike,
  receivedAtMs: number,
): SampleOutcome<HeadingSample> {
  const accuracyDeg = headingAccuracyCeilingDeg(heading.accuracy);
  const hasTrue = Number.isFinite(heading.trueHeading) && heading.trueHeading >= 0;
  const hasMagnetic = Number.isFinite(heading.magHeading) && heading.magHeading >= 0;
  if (!hasTrue && !hasMagnetic) return { ok: false, refusal: 'no-heading' };

  return {
    ok: true,
    value: {
      timestampMs: receivedAtMs,
      ...(hasTrue ? { trueDeg: heading.trueHeading } : {}),
      ...(hasMagnetic ? { magneticDeg: heading.magHeading } : {}),
      accuracyDeg,
    },
  };
}
