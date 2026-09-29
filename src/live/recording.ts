/**
 * The home-session recording: its schema, its strict parser, and the analyzer
 * that reads a verdict out of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/live/web-sensors.ts` implements two hypotheses about what
 * `webkitCompassHeading` is referenced to and picks neither, because no
 * reachable source answers it. Ten further questions about the browser sensor
 * path are open for the same reason. All twelve are physical facts about a
 * phone, so a person has to record them, and the recording has to be read by
 * something that cannot talk itself into the answer it hoped for.
 *
 * This module is that reader. It is pure: a parsed recording in, a table of
 * verdicts out. No clock, no filesystem, no DOM. `scripts/analyze-recording.ts`
 * is the thin shell that loads a file and prints the table.
 *
 * ── THE DISCRIMINATOR, IN ONE LINE ─────────────────────────────────────────
 * For any attitude, the azimuth of the portrait top edge and the azimuth of the
 * rear camera differ by an angle Δ that depends only on beta and gamma. So
 *
 *   H1, `device-top-edge`:   reading = cameraBearing + Δ
 *   H2, `rear-camera-axis`:  reading = cameraBearing
 *
 * and the two hypotheses are separated by exactly Δ. Δ is 0 for a phone held
 * upright in portrait, which is why a portrait recording cannot settle this and
 * why the session needs the landscape holds (Δ = ±90°), the tip past vertical
 * (Δ jumps 0° → 180°) and the roll about the camera axis (Δ sweeps). Every
 * segment is scored by the same residual test against that one relation, so the
 * poses are not four separate arguments but four samples of one.
 *
 * ── PRIVACY: WHY NO POSITION AND NO WALL CLOCK ARE STORED ──────────────────
 * `AGENTS.md` § "Captures from the phone" allows orientation and motion events
 * only, with timestamps relative to the start of the capture. A UTC instant
 * dates a session as precisely as a coordinate places it, and the two together
 * are a movement record.
 *
 * The known-bearing reference is the one place a position and a wall clock
 * would otherwise be needed: the sun's azimuth is a function of both. So the
 * recording carries the ANSWER rather than the inputs. The web app computes the
 * sun's azimuth and altitude on the device with `src/core/celestial.ts`'s
 * `sunPosition`, converts to magnetic with `src/core/declination.ts`, and
 * stores the resulting bearing. Position and wall clock are consumed inside the
 * browser tab and never enter the file, so a recording that leaks cannot be
 * turned back into a place and a time.
 *
 * What the stored bearing does leak is bounded and stated rather than glossed:
 * an azimuth-and-altitude pair is reachable from a wide family of positions and
 * instants, and the optional `declinationDeg` narrows the observer to an
 * isogonic band. Both optional fields can be left out; they are carried when
 * present only so the parser can check that magnetic = true − declination,
 * which is the cross-check that catches a declination applied with the wrong
 * sign on the device.
 *
 * ── THE FORWARD MODEL IS AN INDEPENDENT INSTRUMENT ─────────────────────────
 * `synthesiseRecording` at the end of this file builds recordings from closed
 * forms derived by hand from the specification's rotation matrix — not by
 * calling the adapter. The analyzer reads Δ through the adapter's
 * `topEdgeBearing` and `rearCameraBearing`. Two derivations of the same
 * quantity, and `recording.test.ts` asserts they agree across a grid of
 * attitudes, so a transposed matrix cannot cancel itself out between the thing
 * under test and the thing testing it.
 */

import {
  angleBetweenDeg,
  diagnoseConvention,
  type CalibrationHold,
  type ConventionDiagnosis,
  type Observation,
  type Vector3,
} from './calibration.js';
// The one figure the drag trials exist to replace. Imported rather than
// transcribed, so the verdict cannot be scored against a stale copy of it.
import { BUDGET_TERMS } from './field-analysis.js';
import {
  detectMotionGravityConvention,
  gravityFromOrientation,
  normaliseScreenAngle,
  rearCameraBearing,
  topEdgeBearing,
  type CompassReferenceHypothesis,
  type WebGravityConvention,
  type WebMotionEventLike,
  type WebOrientationEventLike,
} from './web-sensors.js';

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — The schema
 * ══════════════════════════════════════════════════════════════════════════ */

/** Format tag. Bumped when a reader would misread an older file. */
export const RECORDING_FORMAT = 'mountain-finder/home-session-recording@1';

/** The only timestamp basis this format permits. */
export const TIMESTAMP_BASIS = 'ms-since-recording-start';

/**
 * The poses the session walks through, in the order the protocol runs them.
 *
 * The first four are `calibration.ts`'s holds under their own names rather than
 * renamed copies, so the four-hold diagnosis needs no translation table and a
 * label cannot drift away from the hold it means.
 */
export const POSE_LABELS = [
  'flat-face-up',
  'upright-portrait',
  'flat-face-down',
  'right-edge-down',
  'portrait-upright-known-bearing',
  'landscape-upright-known-bearing-top-left',
  'landscape-upright-known-bearing-top-right',
  'tip-past-vertical',
  'roll-about-camera-axis',
  'rotate-to-landscape',
  'still-drift',
  'handling',
  'sun-capture',
] as const;

export type PoseLabel = (typeof POSE_LABELS)[number];

/** The four poses that are also calibration holds. */
export const CALIBRATION_POSES: readonly CalibrationHold[] = [
  'flat-face-up',
  'upright-portrait',
  'flat-face-down',
  'right-edge-down',
];

/** Poses whose camera is aimed at the recording's known bearing. */
export const KNOWN_BEARING_POSES: readonly PoseLabel[] = [
  'portrait-upright-known-bearing',
  'landscape-upright-known-bearing-top-left',
  'landscape-upright-known-bearing-top-right',
  'sun-capture',
];

/**
 * The aiming poses, where the person was asked to keep the reference in the
 * MIDDLE of the frame.
 *
 * `sun-capture` is a known-bearing pose but not one of these: its instruction
 * puts the Sun near the left edge and then near the right edge, so its camera
 * axis is deliberately off the reference and its pitch says nothing about the
 * tilt zero point.
 */
export const AIMING_POSES: readonly PoseLabel[] = [
  'portrait-upright-known-bearing',
  'landscape-upright-known-bearing-top-left',
  'landscape-upright-known-bearing-top-right',
];

/**
 * Poses that hold no known bearing but move the top edge relative to the
 * camera, so the hypotheses separate without one.
 */
export const RELATIVE_DISCRIMINATOR_POSES: readonly PoseLabel[] = [
  'tip-past-vertical',
  'roll-about-camera-axis',
  'rotate-to-landscape',
];

/**
 * One `deviceorientation` or `deviceorientationabsolute` event, as recorded.
 *
 * `absolutePresent` is the web app's `'absolute' in event`, recorded
 * separately because JSON cannot tell an absent key from one holding
 * `undefined`, and "Safari has no such attribute" and "Safari says false" are
 * different answers to question 6.
 */
export interface RecordedOrientationEvent {
  readonly kind: 'orientation';
  /** Milliseconds since the start of the recording. Never a wall clock. */
  readonly tMs: number;
  readonly type: 'deviceorientation' | 'deviceorientationabsolute';
  readonly absolutePresent: boolean;
  /** `screen.orientation.angle` at the moment the event arrived. */
  readonly screenAngleDeg: number;
  readonly event: WebOrientationEventLike;
}

/** A `DeviceMotionEvent.rotationRate`, deg/s about each device axis. */
export interface RecordedRotationRate {
  readonly alpha: number | null;
  readonly beta: number | null;
  readonly gamma: number | null;
}

/** One `devicemotion` event, as recorded. */
export interface RecordedMotionEvent {
  readonly kind: 'motion';
  readonly tMs: number;
  readonly event: WebMotionEventLike;
  /**
   * Carried but not converted. A null or all-zero rotation rate is the other
   * marker of the no-gyroscope fallback that question 8 asks about.
   */
  readonly rotationRate?: RecordedRotationRate | null;
}

export type RecordedSensorEvent = RecordedOrientationEvent | RecordedMotionEvent;

/**
 * A `MediaStreamTrack.getSettings()` snapshot.
 *
 * `deviceId`, `groupId` and `label` are deliberately not in the schema: they
 * identify a particular handset, and the field of view work needs the geometry
 * only.
 */
export interface RecordedTrackSettings {
  readonly tMs: number;
  readonly width?: number;
  readonly height?: number;
  readonly frameRate?: number;
  readonly aspectRatio?: number;
  readonly facingMode?: string;
  readonly resizeMode?: string;
  readonly zoom?: number;
  readonly focusDistance?: number;
}

/** One labelled hold, with everything the phone reported while it was held. */
export interface RecordedSegment {
  readonly pose: PoseLabel;
  /** Milliseconds since the start of the recording. */
  readonly startMs: number;
  readonly endMs: number;
  /** What the person was doing. Free text, never a place or a time. */
  readonly note?: string;
  readonly events: readonly RecordedSensorEvent[];
  readonly trackSettings?: readonly RecordedTrackSettings[];
  /**
   * Where the reference actually sat in the frame during an aiming step, in
   * degrees from the centre of the picture: `pitchDeg` positive when it sat
   * ABOVE centre, `headingDeg` positive when it sat to the RIGHT.
   *
   * This is the tap offset. Absent when nobody measured it, and the pitch-bias
   * estimate then charges the aim as perfect and says so in its evidence.
   */
  readonly aimOffsetDeg?: { readonly headingDeg: number; readonly pitchDeg: number };
}

/**
 * The bearing the camera was aimed at during the known-bearing poses.
 *
 * `magneticAzimuthDeg` is what the analyzer compares `webkitCompassHeading`
 * against, because CLHeading is magnetic by name and the orientation
 * specification's earth frame has its y axis on magnetic north. Both variants
 * therefore carry the magnetic figure and treat true north as the optional
 * cross-check.
 */
export type KnownBearing =
  | {
      /**
       * The sun, centred horizontally in the camera frame. Its azimuth was
       * computed on the device from a position and a UTC instant that were
       * then discarded; see this file's header.
       */
      readonly kind: 'sun-azimuth';
      readonly magneticAzimuthDeg: number;
      /** The sun's altitude at capture. Above ~60° a wide lens centres it poorly. */
      readonly altitudeDeg: number;
      /** What computed the azimuth, e.g. `src/core/celestial.ts sunPosition`. */
      readonly ephemeris: string;
      readonly trueAzimuthDeg?: number;
      readonly declinationDeg?: number;
    }
  | {
      /** A bearing established some other way — a surveyed line, a map azimuth. */
      readonly kind: 'surveyed-bearing';
      readonly magneticAzimuthDeg: number;
      /** How the bearing was established. Free text, never a place. */
      readonly source: string;
      readonly trueAzimuthDeg?: number;
      readonly declinationDeg?: number;
    };

/** The two drag gains the session runs its trials at. */
export const RECORDED_DRAG_MODES = ['normal', 'fine'] as const;
export type RecordedDragMode = (typeof RECORDED_DRAG_MODES)[number];

/**
 * One repeated-drag attempt: how far the finger went, what it did to the
 * overlay, and how steady the phone was under it.
 *
 * Everything here is RELATIVE to the start of the gesture. An offset from where
 * a finger went down says nothing about where the phone was pointed, which is
 * why the trials can be written into a file that carries no position.
 *
 * The trials sit beside the segments rather than inside one. They are run after
 * the last pose, when no `PoseLabel` describes what the person is doing, and
 * filing them under whichever pose happened to be open would misname them.
 */
export interface RecordedDragTrial {
  /** 0-based position in the session's own trial plan. */
  readonly index: number;
  readonly mode: RecordedDragMode;
  /** Where the finger finished, relative to where it went down. CSS pixels. */
  readonly offsetPx: { readonly dx: number; readonly dy: number };
  /** What that did to the nudge, degrees, relative to the nudge before it. */
  readonly offsetDeg: { readonly headingDeg: number; readonly pitchDeg: number };
  /** Max minus min of the phone's roll while the attempt was open, degrees. */
  readonly rollSpreadDeg: number;
  readonly rollSampleCount: number;
  readonly durationMs: number;
  /** The multiplier the drag ran at: 1 for normal, 0.25 for fine. */
  readonly gain: number;
}

/** A whole home-session recording. */
export interface HomeSessionRecording {
  readonly format: typeof RECORDING_FORMAT;
  readonly timestampBasis: typeof TIMESTAMP_BASIS;
  /** `navigator.userAgent`, verbatim. Names the browser the verdicts apply to. */
  readonly device: string;
  readonly knownBearing: KnownBearing;
  readonly segments: readonly RecordedSegment[];
  /** The repeated-drag attempts, in the order they were made. */
  readonly dragTrials?: readonly RecordedDragTrial[];
  readonly note?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — The strict parser
 * ══════════════════════════════════════════════════════════════════════════ */

/** One reason a document was rejected, with the path that carries it. */
export interface RecordingProblem {
  /** Dotted path into the document, e.g. `segments[2].events[10].event.coords`. */
  readonly path: string;
  readonly message: string;
}

export type ParseResult =
  | { readonly ok: true; readonly value: HomeSessionRecording }
  | { readonly ok: false; readonly problems: readonly RecordingProblem[] };

/**
 * Keys that convict a document outright, whatever else is in it.
 *
 * The exact-key whitelists below already reject every one of these as unknown.
 * The list is here anyway for two reasons: it names the rule that was broken
 * instead of saying "unexpected key", and it keeps holding if a later revision
 * widens a whitelist by accident.
 */
const FORBIDDEN_KEYS: Readonly<Record<string, string>> = {
  geolocation: 'geolocation data has no place in a recording',
  coords: 'a GeolocationPosition.coords wrapper',
  position: 'a position fix',
  latitude: 'a coordinate',
  longitude: 'a coordinate',
  lat: 'a coordinate',
  lon: 'a coordinate',
  lng: 'a coordinate',
  gps: 'a position fix',
  elevation: 'a position fix',
  altitudeaccuracy: 'a position fix',
  deviceid: 'an identifier for one handset',
  groupid: 'an identifier for one handset',
  timestamp: 'a timestamp key; relative offsets are named tMs',
  time: 'a timestamp key; relative offsets are named tMs',
  date: 'a wall-clock date',
  utc: 'a wall clock',
  image: 'a camera frame',
  frame: 'a camera frame',
  photo: 'a camera frame',
  dataurl: 'an embedded camera frame',
  base64: 'an embedded camera frame',
};

/** Key shapes that carry a wall clock whatever their prefix. */
const FORBIDDEN_KEY_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /epoch/i, why: 'an epoch timestamp' },
  { pattern: /unix/i, why: 'an epoch timestamp' },
  { pattern: /wallclock/i, why: 'a wall clock' },
  // `capturedAt`, `startedAt`, `recordedAt`. Case-sensitive, so `format` is safe.
  { pattern: /At$/, why: 'a wall-clock instant' },
];

/**
 * Smallest magnitude treated as an epoch rather than an offset. 1e9 ms is 12
 * days and 1e9 s is 2001, so every epoch in seconds or milliseconds from 2001
 * onward is caught, while the longest plausible recording — call it a day, 8.6e7
 * ms — is an order of magnitude below it.
 */
export const EPOCH_FLOOR = 1e9;

/** An ISO 8601 date, with or without a time of day. */
const ISO_DATE = /\d{4}-[01]\d-[0-3]\d/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk the raw document and collect every forbidden key and every value that
 * takes an absolute-time shape.
 *
 * This runs BEFORE the structural parse, over the document as written, so a
 * banned key nested inside something the structural parse would have ignored is
 * still reported.
 */
export function findForbiddenContent(raw: unknown): readonly RecordingProblem[] {
  const problems: RecordingProblem[] = [];

  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        problems.push({ path, message: 'not a finite number' });
      } else if (Math.abs(value) >= EPOCH_FLOOR) {
        problems.push({
          path,
          message: `${value} is at least ${EPOCH_FLOOR}, the shape of an absolute epoch timestamp; timestamps are relative to the start of the recording`,
        });
      }
      return;
    }
    if (typeof value === 'string') {
      if (ISO_DATE.test(value)) {
        problems.push({ path, message: 'holds an ISO 8601 date, which is a wall clock' });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const banned = FORBIDDEN_KEYS[key.toLowerCase()];
      if (banned !== undefined) {
        problems.push({ path: childPath, message: `forbidden key: ${banned}` });
      }
      for (const { pattern, why } of FORBIDDEN_KEY_PATTERNS) {
        if (pattern.test(key)) {
          problems.push({ path: childPath, message: `forbidden key shape: ${why}` });
        }
      }
      visit(child, childPath);
    }
  };

  visit(raw, '');
  return problems;
}

/** Collects problems while the structural parse walks the document. */
class Problems {
  readonly list: RecordingProblem[] = [];

  add(path: string, message: string): undefined {
    this.list.push({ path, message });
    return undefined;
  }
}

function checkKeys(p: Problems, path: string, obj: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      p.add(path === '' ? key : `${path}.${key}`, `unknown key; allowed here: ${allowed.join(', ')}`);
    }
  }
}

function asRecord(p: Problems, path: string, value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : p.add(path, 'expected an object');
}

function asArray(p: Problems, path: string, value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : p.add(path, 'expected an array');
}

interface NumberBounds {
  readonly min?: number;
  readonly max?: number;
}

function asNumber(p: Problems, path: string, value: unknown, bounds: NumberBounds = {}): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return p.add(path, 'expected a finite number');
  }
  if (bounds.min !== undefined && value < bounds.min) {
    return p.add(path, `${value} is below the allowed minimum ${bounds.min}`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return p.add(path, `${value} is above the allowed maximum ${bounds.max}`);
  }
  return value;
}

/** A number, or an explicit null. Absent is reported as a problem. */
function asNullableNumber(
  p: Problems,
  path: string,
  present: boolean,
  value: unknown,
  bounds: NumberBounds = {},
): number | null | undefined {
  if (!present) return p.add(path, 'required key is missing');
  if (value === null) return null;
  return asNumber(p, path, value, bounds);
}

function asOptionalNumber(
  p: Problems,
  path: string,
  present: boolean,
  value: unknown,
  bounds: NumberBounds = {},
): number | undefined {
  if (!present) return undefined;
  return asNumber(p, path, value, bounds);
}

function asString(p: Problems, path: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return p.add(path, 'expected a non-empty string');
  }
  return value;
}

function asBoolean(p: Problems, path: string, value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : p.add(path, 'expected a boolean');
}

function asMember<T extends string>(
  p: Problems,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) return value as T;
  return p.add(path, `expected one of: ${allowed.join(', ')}`);
}

/**
 * A three-component vector whose axes are named by `names`.
 *
 * `DeviceMotionEvent`'s acceleration vectors are x/y/z and its rotation rate is
 * alpha/beta/gamma, so the axis names are a parameter rather than two readers
 * that could disagree about what a nullable component is.
 */
function asTriple(
  p: Problems,
  path: string,
  value: unknown,
  names: readonly [string, string, string],
): readonly [number | null, number | null, number | null] | null | undefined {
  if (value === null) return null;
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, names);
  const read = (name: string): number | null | undefined =>
    asNullableNumber(p, `${path}.${name}`, name in obj, obj[name]);
  const a = read(names[0]);
  const b = read(names[1]);
  const c = read(names[2]);
  if (a === undefined || b === undefined || c === undefined) return undefined;
  return [a, b, c];
}

const XYZ = ['x', 'y', 'z'] as const;
const ALPHA_BETA_GAMMA = ['alpha', 'beta', 'gamma'] as const;

function asVector(
  p: Problems,
  path: string,
  value: unknown,
): { x: number | null; y: number | null; z: number | null } | null | undefined {
  const triple = asTriple(p, path, value, XYZ);
  if (triple === undefined || triple === null) return triple;
  return { x: triple[0], y: triple[1], z: triple[2] };
}

function asRotationRate(p: Problems, path: string, value: unknown): RecordedRotationRate | null | undefined {
  const triple = asTriple(p, path, value, ALPHA_BETA_GAMMA);
  if (triple === undefined || triple === null) return triple;
  return { alpha: triple[0], beta: triple[1], gamma: triple[2] };
}

const ORIENTATION_EVENT_KEYS = [
  'alpha',
  'beta',
  'gamma',
  'absolute',
  'webkitCompassHeading',
  'webkitCompassAccuracy',
] as const;

const ORIENTATION_RECORD_KEYS = ['kind', 'tMs', 'type', 'absolutePresent', 'screenAngleDeg', 'event'] as const;
const MOTION_EVENT_KEYS = ['acceleration', 'accelerationIncludingGravity', 'interval'] as const;
const MOTION_RECORD_KEYS = ['kind', 'tMs', 'event', 'rotationRate'] as const;
const TRACK_SETTINGS_KEYS = [
  'tMs',
  'width',
  'height',
  'frameRate',
  'aspectRatio',
  'facingMode',
  'resizeMode',
  'zoom',
  'focusDistance',
] as const;
const SEGMENT_KEYS = ['pose', 'startMs', 'endMs', 'note', 'events', 'trackSettings', 'aimOffsetDeg'] as const;
const RECORDING_KEYS = [
  'format',
  'timestampBasis',
  'device',
  'knownBearing',
  'segments',
  'dragTrials',
  'note',
] as const;
const DRAG_TRIAL_KEYS = [
  'index',
  'mode',
  'offsetPx',
  'offsetDeg',
  'rollSpreadDeg',
  'rollSampleCount',
  'durationMs',
  'gain',
] as const;
const OFFSET_PX_KEYS = ['dx', 'dy'] as const;
const OFFSET_DEG_KEYS = ['headingDeg', 'pitchDeg'] as const;

/**
 * Widest angle accepted for beta and gamma. The specification narrows gamma to
 * [−90, 90), but a browser that reports a wider range is a finding rather than
 * a corrupt file, so the parser accepts it and the analyzer reports it.
 */
const MAX_EULER_DEG = 180;

function parseOrientationEvent(p: Problems, path: string, value: unknown): WebOrientationEventLike | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, ORIENTATION_EVENT_KEYS);

  const alpha = asNullableNumber(p, `${path}.alpha`, 'alpha' in obj, obj.alpha, { min: -360, max: 360 });
  const beta = asNullableNumber(p, `${path}.beta`, 'beta' in obj, obj.beta, { min: -MAX_EULER_DEG, max: MAX_EULER_DEG });
  const gamma = asNullableNumber(p, `${path}.gamma`, 'gamma' in obj, obj.gamma, { min: -MAX_EULER_DEG, max: MAX_EULER_DEG });
  if (alpha === undefined || beta === undefined || gamma === undefined) return undefined;

  let absolute: boolean | null | undefined;
  if ('absolute' in obj) {
    absolute = obj.absolute === null ? null : asBoolean(p, `${path}.absolute`, obj.absolute);
    if (absolute === undefined) return undefined;
  }

  // CLHeading publishes heading 0 with accuracy −1 when it has no compass, so
  // negative values are data rather than errors and are carried through.
  const heading = 'webkitCompassHeading' in obj
    ? asNullableNumber(p, `${path}.webkitCompassHeading`, true, obj.webkitCompassHeading, { min: -360, max: 360 })
    : undefined;
  if ('webkitCompassHeading' in obj && heading === undefined) return undefined;
  const accuracy = 'webkitCompassAccuracy' in obj
    ? asNullableNumber(p, `${path}.webkitCompassAccuracy`, true, obj.webkitCompassAccuracy, { min: -360, max: 360 })
    : undefined;
  if ('webkitCompassAccuracy' in obj && accuracy === undefined) return undefined;

  return {
    alpha,
    beta,
    gamma,
    ...(absolute !== undefined ? { absolute } : {}),
    ...(heading !== undefined ? { webkitCompassHeading: heading } : {}),
    ...(accuracy !== undefined ? { webkitCompassAccuracy: accuracy } : {}),
  };
}

function parseMotionEvent(p: Problems, path: string, value: unknown): WebMotionEventLike | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, MOTION_EVENT_KEYS);

  let acceleration: ReturnType<typeof asVector>;
  if ('acceleration' in obj) {
    acceleration = asVector(p, `${path}.acceleration`, obj.acceleration);
    if (acceleration === undefined) return undefined;
  }
  let withGravity: ReturnType<typeof asVector>;
  if ('accelerationIncludingGravity' in obj) {
    withGravity = asVector(p, `${path}.accelerationIncludingGravity`, obj.accelerationIncludingGravity);
    if (withGravity === undefined) return undefined;
  }
  const interval = 'interval' in obj
    ? asNullableNumber(p, `${path}.interval`, true, obj.interval, { min: 0, max: 60_000 })
    : undefined;
  if ('interval' in obj && interval === undefined) return undefined;

  return {
    ...(acceleration !== undefined ? { acceleration } : {}),
    ...(withGravity !== undefined ? { accelerationIncludingGravity: withGravity } : {}),
    ...(interval !== undefined ? { interval } : {}),
  };
}

function parseEvent(p: Problems, path: string, value: unknown, maxTMs: number): RecordedSensorEvent | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  const kind = asMember(p, `${path}.kind`, obj.kind, ['orientation', 'motion'] as const);
  if (kind === undefined) return undefined;

  if (kind === 'orientation') {
    checkKeys(p, path, obj, ORIENTATION_RECORD_KEYS);
    const tMs = asNumber(p, `${path}.tMs`, obj.tMs, { min: 0, max: maxTMs });
    const type = asMember(p, `${path}.type`, obj.type, ['deviceorientation', 'deviceorientationabsolute'] as const);
    const absolutePresent = asBoolean(p, `${path}.absolutePresent`, obj.absolutePresent);
    const screenAngleDeg = asNumber(p, `${path}.screenAngleDeg`, obj.screenAngleDeg, { min: -360, max: 360 });
    const event = parseOrientationEvent(p, `${path}.event`, obj.event);
    if (tMs === undefined || type === undefined || absolutePresent === undefined) return undefined;
    if (screenAngleDeg === undefined || event === undefined) return undefined;
    return { kind, tMs, type, absolutePresent, screenAngleDeg, event };
  }

  checkKeys(p, path, obj, MOTION_RECORD_KEYS);
  const tMs = asNumber(p, `${path}.tMs`, obj.tMs, { min: 0, max: maxTMs });
  const event = parseMotionEvent(p, `${path}.event`, obj.event);
  if (tMs === undefined || event === undefined) return undefined;
  if (!('rotationRate' in obj)) return { kind, tMs, event };
  const rate = asRotationRate(p, `${path}.rotationRate`, obj.rotationRate);
  if (rate === undefined) return undefined;
  return { kind, tMs, event, rotationRate: rate };
}

function parseTrackSettings(p: Problems, path: string, value: unknown, maxTMs: number): RecordedTrackSettings | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, TRACK_SETTINGS_KEYS);
  const tMs = asNumber(p, `${path}.tMs`, obj.tMs, { min: 0, max: maxTMs });
  if (tMs === undefined) return undefined;
  const width = asOptionalNumber(p, `${path}.width`, 'width' in obj, obj.width, { min: 0, max: 100_000 });
  const height = asOptionalNumber(p, `${path}.height`, 'height' in obj, obj.height, { min: 0, max: 100_000 });
  const frameRate = asOptionalNumber(p, `${path}.frameRate`, 'frameRate' in obj, obj.frameRate, { min: 0, max: 10_000 });
  const aspectRatio = asOptionalNumber(p, `${path}.aspectRatio`, 'aspectRatio' in obj, obj.aspectRatio, { min: 0, max: 100 });
  const zoom = asOptionalNumber(p, `${path}.zoom`, 'zoom' in obj, obj.zoom, { min: 0, max: 1000 });
  const focusDistance = asOptionalNumber(p, `${path}.focusDistance`, 'focusDistance' in obj, obj.focusDistance, { min: 0, max: 1e6 });
  const facingMode = 'facingMode' in obj ? asString(p, `${path}.facingMode`, obj.facingMode) : undefined;
  const resizeMode = 'resizeMode' in obj ? asString(p, `${path}.resizeMode`, obj.resizeMode) : undefined;
  return {
    tMs,
    ...(width !== undefined ? { width } : {}),
    ...(height !== undefined ? { height } : {}),
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(aspectRatio !== undefined ? { aspectRatio } : {}),
    ...(facingMode !== undefined ? { facingMode } : {}),
    ...(resizeMode !== undefined ? { resizeMode } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
    ...(focusDistance !== undefined ? { focusDistance } : {}),
  };
}

/** Longest recording the parser accepts, ms. A day, well under `EPOCH_FLOOR`. */
const MAX_RECORDING_MS = 86_400_000;

function parseSegment(p: Problems, path: string, value: unknown): RecordedSegment | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, SEGMENT_KEYS);
  const pose = asMember(p, `${path}.pose`, obj.pose, POSE_LABELS);
  const startMs = asNumber(p, `${path}.startMs`, obj.startMs, { min: 0, max: MAX_RECORDING_MS });
  const endMs = asNumber(p, `${path}.endMs`, obj.endMs, { min: 0, max: MAX_RECORDING_MS });
  const note = 'note' in obj ? asString(p, `${path}.note`, obj.note) : undefined;
  const rawEvents = asArray(p, `${path}.events`, obj.events);
  if (pose === undefined || startMs === undefined || endMs === undefined || rawEvents === undefined) {
    return undefined;
  }
  if (endMs < startMs) {
    p.add(`${path}.endMs`, `${endMs} is before startMs ${startMs}`);
    return undefined;
  }

  const events: RecordedSensorEvent[] = [];
  let previousTMs = -Infinity;
  rawEvents.forEach((raw, index) => {
    const event = parseEvent(p, `${path}.events[${index}]`, raw, MAX_RECORDING_MS);
    if (!event) return;
    if (event.tMs < startMs || event.tMs > endMs) {
      p.add(`${path}.events[${index}].tMs`, `${event.tMs} is outside the segment's [${startMs}, ${endMs}]`);
      return;
    }
    if (event.tMs < previousTMs) {
      p.add(`${path}.events[${index}].tMs`, `${event.tMs} goes backwards from ${previousTMs}`);
      return;
    }
    previousTMs = event.tMs;
    events.push(event);
  });

  let trackSettings: RecordedTrackSettings[] | undefined;
  if ('trackSettings' in obj) {
    const rawSettings = asArray(p, `${path}.trackSettings`, obj.trackSettings);
    if (rawSettings === undefined) return undefined;
    trackSettings = [];
    rawSettings.forEach((raw, index) => {
      const parsed = parseTrackSettings(p, `${path}.trackSettings[${index}]`, raw, MAX_RECORDING_MS);
      if (parsed) trackSettings?.push(parsed);
    });
  }

  let aimOffsetDeg: { readonly headingDeg: number; readonly pitchDeg: number } | undefined;
  if ('aimOffsetDeg' in obj) {
    const offset = asRecord(p, `${path}.aimOffsetDeg`, obj.aimOffsetDeg);
    if (offset === undefined) return undefined;
    checkKeys(p, `${path}.aimOffsetDeg`, offset, OFFSET_DEG_KEYS);
    const headingDeg = asNumber(p, `${path}.aimOffsetDeg.headingDeg`, offset.headingDeg, {
      min: -90,
      max: 90,
    });
    const pitchDeg = asNumber(p, `${path}.aimOffsetDeg.pitchDeg`, offset.pitchDeg, { min: -90, max: 90 });
    if (headingDeg === undefined || pitchDeg === undefined) return undefined;
    aimOffsetDeg = { headingDeg, pitchDeg };
  }

  return {
    pose,
    startMs,
    endMs,
    ...(note !== undefined ? { note } : {}),
    events,
    ...(trackSettings !== undefined ? { trackSettings } : {}),
    ...(aimOffsetDeg !== undefined ? { aimOffsetDeg } : {}),
  };
}

/** Widest drag offset accepted, CSS pixels. No phone screen is this big. */
const MAX_DRAG_OFFSET_PX = 10_000;

function parseDragTrial(p: Problems, path: string, value: unknown): RecordedDragTrial | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, DRAG_TRIAL_KEYS);

  const index = asNumber(p, `${path}.index`, obj.index, { min: 0, max: 999 });
  const mode = asMember(p, `${path}.mode`, obj.mode, RECORDED_DRAG_MODES);
  const rollSpreadDeg = asNumber(p, `${path}.rollSpreadDeg`, obj.rollSpreadDeg, { min: 0, max: 360 });
  const rollSampleCount = asNumber(p, `${path}.rollSampleCount`, obj.rollSampleCount, { min: 0 });
  const durationMs = asNumber(p, `${path}.durationMs`, obj.durationMs, { min: 0, max: MAX_RECORDING_MS });
  const gain = asNumber(p, `${path}.gain`, obj.gain, { min: 0, max: 100 });

  const pxObj = asRecord(p, `${path}.offsetPx`, obj.offsetPx);
  let offsetPx: { readonly dx: number; readonly dy: number } | undefined;
  if (pxObj) {
    checkKeys(p, `${path}.offsetPx`, pxObj, OFFSET_PX_KEYS);
    const dx = asNumber(p, `${path}.offsetPx.dx`, pxObj.dx, { min: -MAX_DRAG_OFFSET_PX, max: MAX_DRAG_OFFSET_PX });
    const dy = asNumber(p, `${path}.offsetPx.dy`, pxObj.dy, { min: -MAX_DRAG_OFFSET_PX, max: MAX_DRAG_OFFSET_PX });
    if (dx !== undefined && dy !== undefined) offsetPx = { dx, dy };
  }

  const degObj = asRecord(p, `${path}.offsetDeg`, obj.offsetDeg);
  let offsetDeg: { readonly headingDeg: number; readonly pitchDeg: number } | undefined;
  if (degObj) {
    checkKeys(p, `${path}.offsetDeg`, degObj, OFFSET_DEG_KEYS);
    const headingDeg = asNumber(p, `${path}.offsetDeg.headingDeg`, degObj.headingDeg, { min: -180, max: 180 });
    const pitchDeg = asNumber(p, `${path}.offsetDeg.pitchDeg`, degObj.pitchDeg, { min: -90, max: 90 });
    if (headingDeg !== undefined && pitchDeg !== undefined) offsetDeg = { headingDeg, pitchDeg };
  }

  if (
    index === undefined ||
    mode === undefined ||
    offsetPx === undefined ||
    offsetDeg === undefined ||
    rollSpreadDeg === undefined ||
    rollSampleCount === undefined ||
    durationMs === undefined ||
    gain === undefined
  ) {
    return undefined;
  }
  return { index, mode, offsetPx, offsetDeg, rollSpreadDeg, rollSampleCount, durationMs, gain };
}

/** How far the stored magnetic bearing may sit from true − declination. */
export const BEARING_CONSISTENCY_TOLERANCE_DEG = 0.05;

const SUN_BEARING_KEYS = ['kind', 'magneticAzimuthDeg', 'altitudeDeg', 'ephemeris', 'trueAzimuthDeg', 'declinationDeg'] as const;
const SURVEYED_BEARING_KEYS = ['kind', 'magneticAzimuthDeg', 'source', 'trueAzimuthDeg', 'declinationDeg'] as const;

function parseKnownBearing(p: Problems, path: string, value: unknown): KnownBearing | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  const kind = asMember(p, `${path}.kind`, obj.kind, ['sun-azimuth', 'surveyed-bearing'] as const);
  if (kind === undefined) return undefined;
  checkKeys(p, path, obj, kind === 'sun-azimuth' ? SUN_BEARING_KEYS : SURVEYED_BEARING_KEYS);

  const magneticAzimuthDeg = asNumber(p, `${path}.magneticAzimuthDeg`, obj.magneticAzimuthDeg, { min: 0, max: 360 });
  const trueAzimuthDeg = asOptionalNumber(p, `${path}.trueAzimuthDeg`, 'trueAzimuthDeg' in obj, obj.trueAzimuthDeg, { min: 0, max: 360 });
  const declinationDeg = asOptionalNumber(p, `${path}.declinationDeg`, 'declinationDeg' in obj, obj.declinationDeg, { min: -180, max: 180 });
  if (magneticAzimuthDeg === undefined) return undefined;

  // magnetic = true − declination. Carrying all three buys this check, which is
  // what catches a declination applied with the wrong sign on the device.
  if (trueAzimuthDeg !== undefined && declinationDeg !== undefined) {
    const error = Math.abs(signedDeltaDeg(magneticAzimuthDeg, trueAzimuthDeg - declinationDeg));
    if (error > BEARING_CONSISTENCY_TOLERANCE_DEG) {
      p.add(
        `${path}.magneticAzimuthDeg`,
        `${magneticAzimuthDeg.toFixed(3)}° is ${error.toFixed(3)}° from trueAzimuthDeg − declinationDeg; magnetic = true − declination`,
      );
    }
  }

  if (kind === 'sun-azimuth') {
    const altitudeDeg = asNumber(p, `${path}.altitudeDeg`, obj.altitudeDeg, { min: -90, max: 90 });
    const ephemeris = asString(p, `${path}.ephemeris`, obj.ephemeris);
    if (altitudeDeg === undefined || ephemeris === undefined) return undefined;
    return {
      kind,
      magneticAzimuthDeg,
      altitudeDeg,
      ephemeris,
      ...(trueAzimuthDeg !== undefined ? { trueAzimuthDeg } : {}),
      ...(declinationDeg !== undefined ? { declinationDeg } : {}),
    };
  }

  const source = asString(p, `${path}.source`, obj.source);
  if (source === undefined) return undefined;
  return {
    kind,
    magneticAzimuthDeg,
    source,
    ...(trueAzimuthDeg !== undefined ? { trueAzimuthDeg } : {}),
    ...(declinationDeg !== undefined ? { declinationDeg } : {}),
  };
}

/**
 * Parse a recording, or say everything that is wrong with it.
 *
 * Every problem is collected rather than the first one thrown, because a
 * recording arrives once, from a person holding a phone, and a parser that
 * reports one typo per run wastes the session.
 */
export function parseRecording(raw: unknown): ParseResult {
  const p = new Problems();
  for (const problem of findForbiddenContent(raw)) p.list.push(problem);

  const obj = asRecord(p, '', raw);
  if (!obj) return { ok: false, problems: p.list };
  checkKeys(p, '', obj, RECORDING_KEYS);

  if (obj.format !== RECORDING_FORMAT) {
    p.add('format', `expected exactly "${RECORDING_FORMAT}"`);
  }
  if (obj.timestampBasis !== TIMESTAMP_BASIS) {
    p.add('timestampBasis', `expected exactly "${TIMESTAMP_BASIS}"`);
  }
  const device = asString(p, 'device', obj.device);
  const note = 'note' in obj ? asString(p, 'note', obj.note) : undefined;
  const knownBearing = parseKnownBearing(p, 'knownBearing', obj.knownBearing);
  const rawSegments = asArray(p, 'segments', obj.segments);

  const segments: RecordedSegment[] = [];
  if (rawSegments !== undefined) {
    if (rawSegments.length === 0) p.add('segments', 'a recording with no segments says nothing');
    let previousEndMs = -Infinity;
    rawSegments.forEach((raw, index) => {
      const segment = parseSegment(p, `segments[${index}]`, raw);
      if (!segment) return;
      if (segment.startMs < previousEndMs) {
        p.add(`segments[${index}].startMs`, `${segment.startMs} overlaps the previous segment, which ended at ${previousEndMs}`);
        return;
      }
      previousEndMs = segment.endMs;
      segments.push(segment);
    });
  }

  // Optional, so every recording written before the trials existed still parses.
  let dragTrials: RecordedDragTrial[] | undefined;
  if ('dragTrials' in obj) {
    const rawTrials = asArray(p, 'dragTrials', obj.dragTrials);
    if (rawTrials !== undefined) {
      dragTrials = [];
      const seen = new Set<number>();
      rawTrials.forEach((raw, index) => {
        const trial = parseDragTrial(p, `dragTrials[${index}]`, raw);
        if (!trial) return;
        if (seen.has(trial.index)) {
          p.add(`dragTrials[${index}].index`, `${trial.index} is used twice`);
          return;
        }
        seen.add(trial.index);
        dragTrials?.push(trial);
      });
    }
  }

  if (p.list.length > 0) return { ok: false, problems: p.list };
  if (device === undefined || knownBearing === undefined) {
    return { ok: false, problems: [{ path: '', message: 'incomplete recording' }] };
  }
  return {
    ok: true,
    value: {
      format: RECORDING_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device,
      knownBearing,
      segments,
      ...(dragTrials !== undefined ? { dragTrials } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3 — Angle and statistics helpers
 * ══════════════════════════════════════════════════════════════════════════ */

const DEG = Math.PI / 180;

export function fold360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** `a − b` folded onto (−180, 180]. */
export function signedDeltaDeg(a: number, b: number): number {
  const d = fold360(a - b);
  return d > 180 ? d - 360 : d;
}

function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  const lower = sorted[mid - 1];
  const upper = sorted[mid];
  if (lower === undefined || upper === undefined) return undefined;
  return (lower + upper) / 2;
}

function rms(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let sum = 0;
  for (const v of values) sum += v * v;
  return Math.sqrt(sum / values.length);
}

/** Best constant fit to a set of angles: the centre that minimises RMS residual. */
export interface CircularFit {
  readonly centreDeg: number;
  readonly rmsDeg: number;
}

/**
 * The angle that minimises the RMS of `signedDelta(value, centre)`.
 *
 * A circular mean is the usual answer, but it is undefined for an antipodal set
 * — exactly what the tip-past-vertical hold produces, where the offset takes
 * the values 0° and 180°. A coarse scan then a refinement has no such
 * degenerate case, is deterministic, and costs 360 passes over a segment.
 */
export function bestCircularFit(values: readonly number[]): CircularFit {
  if (values.length === 0) return { centreDeg: NaN, rmsDeg: NaN };
  const score = (centre: number): number => rms(values.map((v) => signedDeltaDeg(v, centre)));
  let bestCentre = 0;
  let bestScore = Infinity;
  for (let centre = 0; centre < 360; centre += 1) {
    const s = score(centre);
    if (s < bestScore) {
      bestScore = s;
      bestCentre = centre;
    }
  }
  for (let offset = -1; offset <= 1; offset += 0.02) {
    const centre = bestCentre + offset;
    const s = score(centre);
    if (s < bestScore) {
      bestScore = s;
      bestCentre = centre;
    }
  }
  return { centreDeg: fold360(bestCentre), rmsDeg: bestScore };
}

/** Least-squares slope of `y` against `x`, or undefined when `x` does not vary. */
function slope(x: readonly number[], y: readonly number[]): number | undefined {
  const n = Math.min(x.length, y.length);
  if (n < 2) return undefined;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i] ?? 0;
    sy += y[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - mx;
    sxx += dx * dx;
    sxy += dx * ((y[i] ?? 0) - my);
  }
  if (sxx === 0) return undefined;
  return sxy / sxx;
}

function pearson(x: readonly number[], y: readonly number[]): number | undefined {
  const n = Math.min(x.length, y.length);
  if (n < 3) return undefined;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += x[i] ?? 0;
    sy += y[i] ?? 0;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = (x[i] ?? 0) - mx;
    const dy = (y[i] ?? 0) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  if (sxx === 0 || syy === 0) return undefined;
  return sxy / Math.sqrt(sxx * syy);
}

function unitise(v: Vector3): Vector3 | undefined {
  const m = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(m) || m === 0) return undefined;
  return { x: v.x / m, y: v.y / m, z: v.z / m };
}

function meanDirection(vectors: readonly Vector3[]): Vector3 | undefined {
  if (vectors.length === 0) return undefined;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const v of vectors) {
    x += v.x;
    y += v.y;
    z += v.z;
  }
  return unitise({ x: x / vectors.length, y: y / vectors.length, z: z / vectors.length });
}

/** Device-frame roll, `atan2(ĝ_x, −ĝ_y)`, the angle `sensors.ts` derives. */
function rollDegOf(g: Vector3): number | undefined {
  const horizontal = Math.hypot(g.x, g.y);
  if (horizontal < 0.3) return undefined;
  return (Math.atan2(g.x, -g.y) * 180) / Math.PI;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4 — Reading one orientation event
 * ══════════════════════════════════════════════════════════════════════════ */

/** Everything the analyzer needs from one orientation event, already reduced. */
interface Reduced {
  readonly tMs: number;
  readonly betaDeg: number;
  readonly gammaDeg: number;
  readonly alphaDeg: number | undefined;
  readonly screenAngleDeg: number;
  readonly gravity: Vector3;
  /** `webkitCompassHeading`, only when `webkitCompassAccuracy` says it is usable. */
  readonly compassDeg: number | undefined;
  readonly compassAccuracyDeg: number | undefined;
  /**
   * Top-edge azimuth minus camera azimuth, degrees, folded to (−180, 180].
   * Undefined when either axis is within a degree of vertical.
   */
  readonly offsetDeg: number | undefined;
  /** Camera azimuth implied by the reported alpha. Relative when alpha is. */
  readonly cameraFromAlphaDeg: number | undefined;
}

/**
 * The separation between the two hypotheses at one attitude, read through the
 * adapter's own rotation matrix.
 *
 * `synthesiseRecording` derives the same quantity from a closed form instead,
 * and the test suite asserts the two agree — a transposed matrix would
 * otherwise cancel out between the analyzer and the recordings it scores.
 */
export function topEdgeMinusCameraDeg(betaDeg: number, gammaDeg: number): number | undefined {
  const top = topEdgeBearing(0, betaDeg, gammaDeg);
  const camera = rearCameraBearing(0, betaDeg, gammaDeg);
  if (!top.ok || !camera.ok) return undefined;
  return signedDeltaDeg(top.value.headingDeg, camera.value.headingDeg);
}

function reduce(event: RecordedOrientationEvent): Reduced | undefined {
  const { beta, gamma, alpha } = event.event;
  if (beta === null || gamma === null) return undefined;
  const accuracy = event.event.webkitCompassAccuracy;
  const heading = event.event.webkitCompassHeading;
  const compassUsable =
    typeof accuracy === 'number' && accuracy >= 0 && typeof heading === 'number' && heading >= 0;
  const cameraFromAlpha = alpha === null ? undefined : rearCameraBearing(alpha, beta, gamma);
  return {
    tMs: event.tMs,
    betaDeg: beta,
    gammaDeg: gamma,
    alphaDeg: alpha ?? undefined,
    screenAngleDeg: event.screenAngleDeg,
    gravity: gravityFromOrientation(beta, gamma),
    compassDeg: compassUsable ? fold360(heading) : undefined,
    compassAccuracyDeg: typeof accuracy === 'number' ? accuracy : undefined,
    offsetDeg: topEdgeMinusCameraDeg(beta, gamma),
    cameraFromAlphaDeg: cameraFromAlpha?.ok === true ? cameraFromAlpha.value.headingDeg : undefined,
  };
}

function reduceSegment(segment: RecordedSegment): readonly Reduced[] {
  const out: Reduced[] = [];
  for (const event of segment.events) {
    if (event.kind !== 'orientation') continue;
    const reduced = reduce(event);
    if (reduced) out.push(reduced);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 5 — The verdict vocabulary
 * ══════════════════════════════════════════════════════════════════════════ */

export type Confidence = 'high' | 'moderate' | 'low' | 'none';

/** One answered question. `inconclusive` is a real answer, not a failure. */
export interface Verdict {
  /** Stable id, so a script or a test can name one question. */
  readonly id: string;
  /** What was asked, in one line. */
  readonly question: string;
  /** What the data says. The literal string `inconclusive` when it does not separate. */
  readonly answer: string;
  readonly inconclusive: boolean;
  readonly confidence: Confidence;
  /** The numbers behind the answer. One claim per line. */
  readonly evidence: readonly string[];
}

const INCONCLUSIVE = 'inconclusive';

function verdict(
  id: string,
  question: string,
  answer: string,
  confidence: Confidence,
  evidence: readonly string[],
): Verdict {
  return { id, question, answer, inconclusive: answer === INCONCLUSIVE, confidence, evidence };
}

function inconclusive(id: string, question: string, evidence: readonly string[]): Verdict {
  return verdict(id, question, INCONCLUSIVE, 'none', evidence);
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 6 — The compass reference hypothesis
 * ══════════════════════════════════════════════════════════════════════════ */

export type HypothesisVerdict = CompassReferenceHypothesis | typeof INCONCLUSIVE;

/** How far apart the hypotheses must predict the reading before a score counts. */
export const MIN_SEPARATION_DEG = 15;
/** Widest residual the winning hypothesis may leave and still win. */
export const MAX_WINNER_RESIDUAL_DEG = 12;
/** Fewest usable samples a segment needs before it is scored at all. */
export const MIN_SCORED_SAMPLES = 8;

export interface SegmentScore {
  readonly pose: PoseLabel;
  /** `absolute` compares against the known bearing; `relative` fits an offset. */
  readonly mode: 'absolute' | 'relative';
  readonly samples: number;
  /** RMS of the offset the model cannot absorb — the room to discriminate in. */
  readonly separationDeg: number;
  readonly topEdgeResidualDeg: number;
  readonly cameraAxisResidualDeg: number;
  /** Median of `reading − predicted bearing` under each hypothesis, absolute mode only. */
  readonly topEdgeBiasDeg: number | undefined;
  readonly cameraAxisBiasDeg: number | undefined;
  readonly verdict: HypothesisVerdict;
  readonly confidence: Confidence;
  /**
   * Why an inconclusive segment is inconclusive. `neither-fits` is different in
   * kind from the rest: missing evidence is silence, but a pose that matches
   * neither hypothesis is evidence against both, and the pooled verdict treats
   * it that way.
   */
  readonly reason: 'decided' | 'insufficient-samples' | 'no-separation' | 'neither-fits' | 'too-close';
  readonly detail: string;
}

/**
 * Score one segment against both hypotheses.
 *
 * Both are tested on the SAME samples: a sample whose top edge is within a
 * degree of vertical has no offset, so it cannot test H1, and letting it test
 * H2 alone would hand H2 the segments where it was never challenged.
 *
 * `absolute` mode compares the reading against the known bearing with no free
 * parameter, so a constant offset of 90° convicts on its own. `relative` mode
 * has no known bearing, so it fits the one constant the unknown camera bearing
 * represents; a constant offset is then invisible and only a CHANGING offset
 * discriminates. `separationDeg` is the offset's RMS after removing whatever
 * the mode can absorb, which is why one number gates both modes.
 */
function scoreSegment(
  pose: PoseLabel,
  samples: readonly Reduced[],
  knownBearingDeg: number | undefined,
): SegmentScore {
  const mode = knownBearingDeg === undefined ? 'relative' : 'absolute';
  const offsets: number[] = [];
  const topEdgeResiduals: number[] = [];
  const cameraResiduals: number[] = [];

  for (const s of samples) {
    if (s.compassDeg === undefined || s.offsetDeg === undefined) continue;
    let reference: number;
    if (knownBearingDeg !== undefined) {
      reference = knownBearingDeg;
    } else if (s.cameraFromAlphaDeg !== undefined) {
      // A relative alpha is enough: both hypotheses are tested against the same
      // unknown constant, which the fit below removes.
      reference = s.cameraFromAlphaDeg;
    } else {
      continue;
    }
    offsets.push(s.offsetDeg);
    topEdgeResiduals.push(signedDeltaDeg(s.compassDeg - s.offsetDeg, reference));
    cameraResiduals.push(signedDeltaDeg(s.compassDeg, reference));
  }

  const n = offsets.length;
  if (n < MIN_SCORED_SAMPLES) {
    return {
      pose,
      mode,
      samples: n,
      separationDeg: NaN,
      topEdgeResidualDeg: NaN,
      cameraAxisResidualDeg: NaN,
      topEdgeBiasDeg: undefined,
      cameraAxisBiasDeg: undefined,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      reason: 'insufficient-samples',
      detail:
        `${n} usable sample(s); at least ${MIN_SCORED_SAMPLES} are needed. A sample is usable ` +
        'only with a valid compass reading and a top edge more than a degree from vertical' +
        (mode === 'relative' ? ', plus an alpha to reference the camera against' : ''),
    };
  }

  const separationDeg = mode === 'absolute' ? rms(offsets) : bestCircularFit(offsets).rmsDeg;
  const topEdgeResidualDeg =
    mode === 'absolute' ? rms(topEdgeResiduals) : bestCircularFit(topEdgeResiduals).rmsDeg;
  const cameraAxisResidualDeg =
    mode === 'absolute' ? rms(cameraResiduals) : bestCircularFit(cameraResiduals).rmsDeg;
  const topEdgeBiasDeg = mode === 'absolute' ? median(topEdgeResiduals) : undefined;
  const cameraAxisBiasDeg = mode === 'absolute' ? median(cameraResiduals) : undefined;

  const base = {
    pose,
    mode,
    samples: n,
    separationDeg,
    topEdgeResidualDeg,
    cameraAxisResidualDeg,
    topEdgeBiasDeg,
    cameraAxisBiasDeg,
  } as const;

  if (!(separationDeg >= MIN_SEPARATION_DEG)) {
    return {
      ...base,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      reason: 'no-separation',
      detail:
        `the two hypotheses predict readings only ${separationDeg.toFixed(1)}° apart here ` +
        `(${MIN_SEPARATION_DEG}° needed) — this pose does not separate them`,
    };
  }

  const winner: CompassReferenceHypothesis =
    topEdgeResidualDeg <= cameraAxisResidualDeg ? 'device-top-edge' : 'rear-camera-axis';
  const winnerResidual = Math.min(topEdgeResidualDeg, cameraAxisResidualDeg);
  const loserResidual = Math.max(topEdgeResidualDeg, cameraAxisResidualDeg);
  const margin = loserResidual - winnerResidual;

  if (winnerResidual > MAX_WINNER_RESIDUAL_DEG) {
    return {
      ...base,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      reason: 'neither-fits',
      detail:
        `neither hypothesis fits: the better one still leaves ${winnerResidual.toFixed(1)}° RMS ` +
        `(${MAX_WINNER_RESIDUAL_DEG}° allowed) — the bearing, the pose or the compass is wrong`,
    };
  }
  if (margin < 0.5 * separationDeg) {
    return {
      ...base,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      reason: 'too-close',
      detail:
        `the hypotheses are ${margin.toFixed(1)}° apart in residual where ${separationDeg.toFixed(1)}° ` +
        'of separation was available — too close to call',
    };
  }

  const confidence: Confidence =
    separationDeg >= 60 && winnerResidual <= 6 && margin >= 0.8 * separationDeg
      ? 'high'
      : separationDeg >= 30 && winnerResidual <= MAX_WINNER_RESIDUAL_DEG
        ? 'moderate'
        : 'low';

  return {
    ...base,
    verdict: winner,
    confidence,
    reason: 'decided',
    detail:
      `${winner} fits to ${winnerResidual.toFixed(1)}° RMS while the other leaves ` +
      `${loserResidual.toFixed(1)}°, with ${separationDeg.toFixed(1)}° of separation available`,
  };
}

export interface CompassReferenceAnalysis {
  readonly perSegment: readonly SegmentScore[];
  readonly verdict: HypothesisVerdict;
  readonly confidence: Confidence;
  readonly detail: string;
}

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { none: 0, low: 1, moderate: 2, high: 3 };

function analyseCompassReference(
  recording: HomeSessionRecording,
): CompassReferenceAnalysis {
  const known = recording.knownBearing.magneticAzimuthDeg;
  const perSegment: SegmentScore[] = [];
  for (const segment of recording.segments) {
    const isKnown = KNOWN_BEARING_POSES.includes(segment.pose);
    const isRelative = RELATIVE_DISCRIMINATOR_POSES.includes(segment.pose);
    if (!isKnown && !isRelative) continue;
    perSegment.push(scoreSegment(segment.pose, reduceSegment(segment), isKnown ? known : undefined));
  }

  // A hypothesis that is right fits every pose that can test it. One pose that
  // fits neither convicts the whole recording, however clean the others look:
  // the bearing, a label, or the compass itself is wrong, and a verdict drawn
  // from the rest would be drawn from data already shown to be inconsistent.
  const misfits = perSegment.filter((s) => s.reason === 'neither-fits');
  if (misfits.length > 0) {
    return {
      perSegment,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      detail:
        `${misfits.length} pose(s) fit neither hypothesis (${misfits.map((s) => s.pose).join(', ')}), ` +
        'so nothing is concluded from the rest: check the known bearing, the pose labels and the compass calibration',
    };
  }

  const decided = perSegment.filter((s) => s.verdict !== INCONCLUSIVE);
  if (decided.length === 0) {
    return {
      perSegment,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      detail:
        perSegment.length === 0
          ? 'no discriminating pose was recorded: none of the known-bearing, tip-past-vertical, roll or rotate-to-landscape segments is present'
          : 'every discriminating segment came back inconclusive; the recording does not separate the hypotheses',
    };
  }
  const names = new Set(decided.map((s) => s.verdict));
  if (names.size > 1) {
    return {
      perSegment,
      verdict: INCONCLUSIVE,
      confidence: 'none',
      detail:
        'the segments disagree: ' +
        decided.map((s) => `${s.pose} says ${s.verdict}`).join('; ') +
        ' — one of these poses was performed or labelled wrongly, so nothing is concluded',
    };
  }
  const agreed = decided[0]?.verdict;
  if (agreed === undefined || agreed === INCONCLUSIVE) {
    return { perSegment, verdict: INCONCLUSIVE, confidence: 'none', detail: 'no decided segment' };
  }
  let best: Confidence = 'none';
  for (const s of decided) {
    if (CONFIDENCE_RANK[s.confidence] > CONFIDENCE_RANK[best]) best = s.confidence;
  }
  // One segment agreeing with itself is one measurement. Two independent poses
  // agreeing is the cross-check AGENTS.md asks for before a claim is written down.
  const confidence: Confidence = decided.length >= 2 ? best : best === 'high' ? 'moderate' : 'low';
  return {
    perSegment,
    verdict: agreed,
    confidence,
    detail:
      `${decided.length} discriminating segment(s) agree on ${agreed}: ` +
      decided.map((s) => `${s.pose} (${Math.min(s.topEdgeResidualDeg, s.cameraAxisResidualDeg).toFixed(1)}° RMS)`).join(', '),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7 — The remaining questions
 * ══════════════════════════════════════════════════════════════════════════ */

function landscapeSignVerdict(analysis: CompassReferenceAnalysis): Verdict {
  const question =
    'Under device-top-edge, is the landscape reading the camera bearing plus 90° or minus 90°?';
  const landscape = analysis.perSegment.filter(
    (s) => s.pose === 'landscape-upright-known-bearing-top-left' || s.pose === 'landscape-upright-known-bearing-top-right',
  );
  if (landscape.length === 0) {
    return inconclusive('landscape-sign', question, ['no landscape known-bearing segment in the recording']);
  }
  if (analysis.verdict !== 'device-top-edge') {
    return inconclusive('landscape-sign', question, [
      `the compass reference came out ${analysis.verdict}, so no ±90° offset applies`,
      ...landscape.map(
        (s) => `${s.pose}: reading − known bearing = ${fmtSigned(s.cameraAxisBiasDeg)} (median)`,
      ),
    ]);
  }

  const evidence: string[] = [];
  const signs: number[] = [];
  for (const s of landscape) {
    const bias = s.cameraAxisBiasDeg;
    if (bias === undefined || !Number.isFinite(bias)) {
      evidence.push(`${s.pose}: no usable offset`);
      continue;
    }
    // The label says where the portrait top edge points; the geometry says the
    // offset that follows. A mismatch is a mislabelled hold, not a new fact.
    const predicted = s.pose === 'landscape-upright-known-bearing-top-right' ? 90 : -90;
    signs.push(Math.sign(bias));
    evidence.push(
      `${s.pose}: reading − known bearing = ${fmtSigned(bias)} (median), geometry predicts ${fmtSigned(predicted)} for this label`,
    );
    if (Math.abs(signedDeltaDeg(bias, predicted)) > 25) {
      evidence.push(
        `  that is ${Math.abs(signedDeltaDeg(bias, predicted)).toFixed(1)}° from the prediction — check which way the phone was turned`,
      );
    }
  }
  if (signs.length === 0) return inconclusive('landscape-sign', question, evidence);
  const distinct = new Set(signs);
  if (distinct.size === 2) {
    return verdict(
      'landscape-sign',
      question,
      'the sign follows the landscape direction: +90° with the top edge right, −90° with the top edge left',
      landscape.length >= 2 ? 'high' : 'moderate',
      evidence,
    );
  }
  const only = signs[0] ?? 0;
  return verdict(
    'landscape-sign',
    question,
    `${only >= 0 ? '+90°' : '−90°'} in the one landscape direction recorded`,
    'low',
    [...evidence, 'only one landscape direction was recorded, so the sign is not shown to follow the direction'],
  );
}

function fmtSigned(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}°`;
}

/** Flat-enough and upright-enough bands for the accuracy comparison. */
const LOW_TILT_COS = 0.8;
const HIGH_TILT_COS = 0.3;

function accuracyGrowthVerdict(recording: HomeSessionRecording): Verdict {
  const question = 'Does webkitCompassAccuracy widen as the phone rises from flat to upright?';
  const low: number[] = [];
  const high: number[] = [];
  const tiltFactors: number[] = [];
  const accuracies: number[] = [];
  const distinct = new Set<number>();
  for (const segment of recording.segments) {
    for (const s of reduceSegment(segment)) {
      const accuracy = s.compassAccuracyDeg;
      if (accuracy === undefined || accuracy < 0) continue;
      const cosBeta = Math.abs(Math.cos(s.betaDeg * DEG));
      distinct.add(accuracy);
      if (cosBeta >= 1e-3) {
        tiltFactors.push(1 / cosBeta);
        accuracies.push(accuracy);
      }
      if (cosBeta >= LOW_TILT_COS) low.push(accuracy);
      else if (cosBeta <= HIGH_TILT_COS) high.push(accuracy);
    }
  }

  const lowMedian = median(low);
  const highMedian = median(high);
  const evidence = [
    `flat band (|cos β| ≥ ${LOW_TILT_COS}): ${low.length} samples, median accuracy ${fmtDeg(lowMedian)}`,
    `upright band (|cos β| ≤ ${HIGH_TILT_COS}): ${high.length} samples, median accuracy ${fmtDeg(highMedian)}`,
    `${distinct.size} distinct accuracy value(s) reported in the whole recording`,
  ];
  const correlation = pearson(tiltFactors, accuracies);
  if (correlation !== undefined) {
    evidence.push(`correlation of accuracy with 1/|cos β|: r = ${correlation.toFixed(2)}`);
  }

  if (low.length < MIN_SCORED_SAMPLES || high.length < MIN_SCORED_SAMPLES) {
    return inconclusive('accuracy-growth', question, [
      ...evidence,
      `each band needs at least ${MIN_SCORED_SAMPLES} samples`,
    ]);
  }
  if (lowMedian === undefined || highMedian === undefined) {
    return inconclusive('accuracy-growth', question, evidence);
  }
  if (distinct.size === 1) {
    return verdict(
      'accuracy-growth',
      question,
      "no — one fixed accuracy at every tilt, so the adapter's 1/|cos β| inflation does not double-count",
      'high',
      evidence,
    );
  }
  if (highMedian >= lowMedian + 5 && highMedian >= 1.5 * lowMedian) {
    return verdict(
      'accuracy-growth',
      question,
      `yes — it grows from ${fmtDeg(lowMedian)} flat to ${fmtDeg(highMedian)} upright, so the adapter's 1/|cos β| inflation double-counts`,
      'moderate',
      evidence,
    );
  }
  if (Math.abs(highMedian - lowMedian) <= 3) {
    return verdict(
      'accuracy-growth',
      question,
      "no — the reported accuracy is flat across tilt, so the adapter's 1/|cos β| inflation does not double-count",
      'moderate',
      evidence,
    );
  }
  return inconclusive('accuracy-growth', question, [
    ...evidence,
    'the two bands differ, but by less than the threshold for growth and more than the threshold for flat',
  ]);
}

function fmtDeg(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(1)}°`;
}

/**
 * Window at each end of a segment used as its before and after state, ms, and
 * the largest share of the segment one window may take.
 *
 * The windows only average noise out of the two end states, so they must stay
 * clear of the movement in between. A fixed width would swallow a short hold
 * whole and report a rotation that had not finished.
 */
const END_WINDOW_MS = 1500;
const END_WINDOW_FRACTION = 0.15;

function windowSamples(samples: readonly Reduced[], which: 'first' | 'last'): readonly Reduced[] {
  if (samples.length === 0) return [];
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return [];
  const width = Math.min(END_WINDOW_MS, END_WINDOW_FRACTION * (last.tMs - first.tMs));
  return which === 'first'
    ? samples.filter((s) => s.tMs <= first.tMs + width)
    : samples.filter((s) => s.tMs >= last.tMs - width);
}

interface RotationEnds {
  readonly rollStartDeg: number;
  readonly rollEndDeg: number;
  readonly screenStartDeg: number;
  readonly screenEndDeg: number;
}

function rotationEnds(samples: readonly Reduced[]): RotationEnds | undefined {
  const start = windowSamples(samples, 'first');
  const end = windowSamples(samples, 'last');
  const gStart = meanDirection(start.map((s) => s.gravity));
  const gEnd = meanDirection(end.map((s) => s.gravity));
  if (!gStart || !gEnd) return undefined;
  const rollStartDeg = rollDegOf(gStart);
  const rollEndDeg = rollDegOf(gEnd);
  const screenStartDeg = median(start.map((s) => s.screenAngleDeg));
  const screenEndDeg = median(end.map((s) => s.screenAngleDeg));
  if (rollStartDeg === undefined || rollEndDeg === undefined) return undefined;
  if (screenStartDeg === undefined || screenEndDeg === undefined) return undefined;
  return { rollStartDeg, rollEndDeg, screenStartDeg, screenEndDeg };
}

/** Smallest rotation treated as a deliberate quarter turn. */
const QUARTER_TURN_FLOOR_DEG = 60;
/** Largest rotation treated as "did not move". */
const NO_ROTATION_CEILING_DEG = 20;

function screenFrameVerdicts(recording: HomeSessionRecording): readonly Verdict[] {
  const frameQuestion = 'Does rotating to landscape move the device coordinate frame, or only the screen?';
  const signQuestion = 'Which way does screen.orientation.angle move when the device rolls positive?';
  const segment = recording.segments.find((s) => s.pose === 'rotate-to-landscape');
  if (!segment) {
    const why = ['no rotate-to-landscape segment in the recording'];
    return [inconclusive('screen-frame', frameQuestion, why), inconclusive('screen-roll-sign', signQuestion, why)];
  }
  const samples = reduceSegment(segment);
  const ends = rotationEnds(samples);
  if (!ends) {
    const why = [
      'the segment has no usable roll at both ends: gravity was within 0.3 of the camera axis, which is what a rotation performed flat on a table looks like',
    ];
    return [inconclusive('screen-frame', frameQuestion, why), inconclusive('screen-roll-sign', signQuestion, why)];
  }
  const rollChange = signedDeltaDeg(ends.rollEndDeg, ends.rollStartDeg);
  const screenChange = signedDeltaDeg(ends.screenEndDeg, ends.screenStartDeg);
  const evidence = [
    `device roll ${ends.rollStartDeg.toFixed(1)}° → ${ends.rollEndDeg.toFixed(1)}°, a change of ${fmtSigned(rollChange)}`,
    `screen.orientation.angle ${ends.screenStartDeg.toFixed(0)}° → ${ends.screenEndDeg.toFixed(0)}°, a change of ${fmtSigned(screenChange)}`,
  ];
  const headingStart = median(windowSamples(samples, 'first').flatMap((s) => (s.compassDeg === undefined ? [] : [s.compassDeg])));
  const headingEnd = median(windowSamples(samples, 'last').flatMap((s) => (s.compassDeg === undefined ? [] : [s.compassDeg])));
  if (headingStart !== undefined && headingEnd !== undefined) {
    evidence.push(
      `webkitCompassHeading moved ${fmtSigned(signedDeltaDeg(headingEnd, headingStart))} across the same rotation`,
    );
  }

  let frame: Verdict;
  if (Math.abs(screenChange) < QUARTER_TURN_FLOOR_DEG) {
    frame = inconclusive('screen-frame', frameQuestion, [
      ...evidence,
      `the screen angle barely moved, so the segment does not test this; a quarter turn needs at least ${QUARTER_TURN_FLOOR_DEG}°`,
    ]);
  } else if (Math.abs(rollChange) >= QUARTER_TURN_FLOOR_DEG) {
    frame = verdict(
      'screen-frame',
      frameQuestion,
      'only the screen — the device frame stayed fixed to the device, so carrying screen.orientation.angle without applying it is right',
      'high',
      evidence,
    );
  } else if (Math.abs(rollChange) <= NO_ROTATION_CEILING_DEG) {
    frame = verdict(
      'screen-frame',
      frameQuestion,
      'the frame followed the screen — beta and gamma were re-based to the rotated layout, so the adapter must apply the screen angle rather than carry it',
      'high',
      evidence,
    );
  } else {
    frame = inconclusive('screen-frame', frameQuestion, [
      ...evidence,
      'the roll change is neither a quarter turn nor nothing; the phone was rotated about some other axis too',
    ]);
  }

  let sign: Verdict;
  if (Math.abs(screenChange) < QUARTER_TURN_FLOOR_DEG || Math.abs(rollChange) < QUARTER_TURN_FLOOR_DEG) {
    sign = inconclusive('screen-roll-sign', signQuestion, [
      ...evidence,
      `both the roll and the screen angle must change by at least ${QUARTER_TURN_FLOOR_DEG}° before a sign can be read`,
    ]);
  } else {
    const same = Math.sign(rollChange) === Math.sign(screenChange);
    sign = verdict(
      'screen-roll-sign',
      signQuestion,
      same
        ? 'the same way — screen.orientation.angle increases with positive device roll, so the UI rotates the overlay by −angle'
        : 'the opposite way — screen.orientation.angle decreases as device roll increases, so the UI rotates the overlay by +angle',
      'high',
      evidence,
    );
  }
  return [frame, sign];
}

function absolutePresenceVerdict(recording: HomeSessionRecording): Verdict {
  const question = "Does DeviceOrientationEvent.absolute exist on this browser, and what does it say?";
  let total = 0;
  let present = 0;
  const values = new Set<string>();
  const types = new Set<string>();
  for (const segment of recording.segments) {
    for (const event of segment.events) {
      if (event.kind !== 'orientation') continue;
      total += 1;
      types.add(event.type);
      if (event.absolutePresent) present += 1;
      values.add(event.event.absolute === undefined ? 'absent' : String(event.event.absolute));
    }
  }
  const evidence = [
    `${present} of ${total} orientation events carried an 'absolute' key`,
    `values seen: ${[...values].sort().join(', ')}`,
    `event types recorded: ${[...types].sort().join(', ')}`,
  ];
  if (total === 0) return inconclusive('absolute-presence', question, ['no orientation events in the recording']);
  if (present === 0) {
    return verdict(
      'absolute-presence',
      question,
      "absent — no event carries 'absolute', so treating an undefined value as relative is right",
      'high',
      evidence,
    );
  }
  if (present === total && values.has('true') && values.size === 1) {
    return verdict(
      'absolute-presence',
      question,
      "present and true on every event — this browser's alpha claims to be earth-referenced",
      'high',
      evidence,
    );
  }
  if (present === total && values.has('false') && values.size === 1) {
    return verdict('absolute-presence', question, "present and false on every event", 'high', evidence);
  }
  return inconclusive('absolute-presence', question, [
    ...evidence,
    "'absolute' is present on some events and not others, or changes value; that is a finding to chase before any alpha is trusted",
  ]);
}

/** Widest gap between a motion event and the orientation event it is paired with, ms. */
const PAIRING_WINDOW_MS = 60;

function motionGravitySignVerdict(recording: HomeSessionRecording): Verdict {
  const question = 'Which sign convention does accelerationIncludingGravity follow?';
  const counts: Partial<Record<WebGravityConvention, number>> = {};
  let pairs = 0;
  let undecided = 0;
  for (const segment of recording.segments) {
    const orientation = segment.events.filter(
      (e): e is RecordedOrientationEvent => e.kind === 'orientation',
    );
    for (const event of segment.events) {
      if (event.kind !== 'motion') continue;
      let nearest: RecordedOrientationEvent | undefined;
      let nearestGap = Infinity;
      for (const candidate of orientation) {
        const gap = Math.abs(candidate.tMs - event.tMs);
        if (gap < nearestGap) {
          nearestGap = gap;
          nearest = candidate;
        }
      }
      if (!nearest || nearestGap > PAIRING_WINDOW_MS) continue;
      pairs += 1;
      const convention = detectMotionGravityConvention(event.event, nearest.event);
      if (convention === undefined) undecided += 1;
      else counts[convention] = (counts[convention] ?? 0) + 1;
    }
  }
  const w3c = counts['w3c-specific-force'] ?? 0;
  const core = counts['coremotion-gravity'] ?? 0;
  const evidence = [
    `${pairs} motion events paired with an orientation event within ${PAIRING_WINDOW_MS} ms`,
    `w3c-specific-force (points up when resting): ${w3c}`,
    `coremotion-gravity (points down when resting): ${core}`,
    `no verdict from the vector: ${undecided}`,
  ];
  if (pairs < MIN_SCORED_SAMPLES) {
    return inconclusive('motion-gravity-sign', question, [
      ...evidence,
      `at least ${MIN_SCORED_SAMPLES} pairs are needed`,
    ]);
  }
  if (w3c > 0 && core > 0) {
    return inconclusive('motion-gravity-sign', question, [
      ...evidence,
      'both conventions were detected in one recording, which no browser does; the pairing window or the data is wrong',
    ]);
  }
  if (w3c === 0 && core === 0) return inconclusive('motion-gravity-sign', question, evidence);
  const winner: WebGravityConvention = w3c > 0 ? 'w3c-specific-force' : 'coremotion-gravity';
  const decided = Math.max(w3c, core);
  return verdict(
    'motion-gravity-sign',
    question,
    `${winner} — ${winner === 'w3c-specific-force' ? 'the vector points UP for a resting phone (+9.8 on z flat and face up)' : 'the vector points DOWN for a resting phone (−9.8 on z flat and face up)'}`,
    decided >= 0.9 * pairs ? 'high' : 'moderate',
    evidence,
  );
}

function zeroAccelerationVerdict(recording: HomeSessionRecording): Verdict {
  const question = 'Is acceleration ever absent or exactly zero, the no-gyroscope fallback?';
  let total = 0;
  let missing = 0;
  let exactlyZero = 0;
  let rateMissing = 0;
  let rateZero = 0;
  for (const segment of recording.segments) {
    for (const event of segment.events) {
      if (event.kind !== 'motion') continue;
      total += 1;
      const a = event.event.acceleration;
      if (a === undefined || a === null) missing += 1;
      else if (a.x === 0 && a.y === 0 && a.z === 0) exactlyZero += 1;
      const r = event.rotationRate;
      if (r === undefined || r === null) rateMissing += 1;
      else if (r.alpha === 0 && r.beta === 0 && r.gamma === 0) rateZero += 1;
    }
  }
  const evidence = [
    `${total} motion events`,
    `acceleration absent or null: ${missing}`,
    `acceleration exactly (0, 0, 0): ${exactlyZero}`,
    `rotationRate absent or null: ${rateMissing}`,
    `rotationRate exactly zero: ${rateZero}`,
  ];
  if (total < MIN_SCORED_SAMPLES) {
    return inconclusive('zero-acceleration', question, [...evidence, 'too few motion events to say'])
  }
  if (missing === 0 && exactlyZero === 0) {
    return verdict(
      'zero-acceleration',
      question,
      'no — every event carried a non-zero linear acceleration, so gravity can be separated from the specific force',
      'high',
      evidence,
    );
  }
  return verdict(
    'zero-acceleration',
    question,
    `yes — ${missing + exactlyZero} of ${total} events have no usable linear acceleration, so those samples are gravity-contaminated and the adapter marks them so`,
    'high',
    evidence,
  );
}

function calibrationVerdict(recording: HomeSessionRecording): Verdict {
  const question = 'Do the four calibration holds match the frame convention in sensors.ts?';
  const observations: Observation[] = [];
  const evidence: string[] = [];
  const missing: CalibrationHold[] = [];
  for (const hold of CALIBRATION_POSES) {
    const segment = recording.segments.find((s) => s.pose === hold);
    if (!segment) {
      missing.push(hold);
      continue;
    }
    const samples = reduceSegment(segment);
    const measured = meanDirection(samples.map((s) => s.gravity));
    if (!measured || samples.length < MIN_SCORED_SAMPLES) {
      evidence.push(`${hold}: only ${samples.length} usable orientation events, skipped`);
      continue;
    }
    const spread = median(samples.map((s) => angleBetweenDeg(measured, s.gravity)));
    observations.push({ hold, measured });
    evidence.push(
      `${hold}: mean gravity (${measured.x.toFixed(3)}, ${measured.y.toFixed(3)}, ${measured.z.toFixed(3)}) over ${samples.length} events, median scatter ${fmtDeg(spread)}`,
    );
  }
  if (missing.length > 0) evidence.push(`holds not recorded: ${missing.join(', ')}`);
  if (observations.length < 2) {
    return inconclusive('calibration-holds', question, [...evidence, 'at least two holds are needed']);
  }
  const diagnosis: ConventionDiagnosis = diagnoseConvention(observations);
  evidence.push(diagnosis.detail);
  if (diagnosis.verdict === 'insufficient') {
    return inconclusive('calibration-holds', question, evidence);
  }
  return verdict(
    'calibration-holds',
    question,
    diagnosis.verdict,
    diagnosis.verdict === 'matches-convention' && observations.length === 4 ? 'high' : 'moderate',
    evidence,
  );
}

function eventRateVerdict(recording: HomeSessionRecording): Verdict {
  const question = 'What rate and timestamp jitter does the browser deliver?';
  const evidence: string[] = [];
  let decided = false;
  for (const kind of ['orientation', 'motion'] as const) {
    const times: number[] = [];
    for (const segment of recording.segments) {
      for (const event of segment.events) {
        if (event.kind === kind) times.push(event.tMs);
      }
    }
    if (times.length < 2) {
      evidence.push(`${kind}: ${times.length} event(s), too few to time`);
      continue;
    }
    const gaps: number[] = [];
    for (let i = 1; i < times.length; i += 1) {
      const a = times[i - 1];
      const b = times[i];
      if (a === undefined || b === undefined) continue;
      // A segment boundary leaves a gap that is a pause in the protocol, not
      // jitter, so only intervals inside a plausible stream are timed.
      if (b - a >= 0 && b - a < 1000) gaps.push(b - a);
    }
    const mid = median(gaps);
    const sorted = [...gaps].sort((x, y) => x - y);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
    const worst = sorted[sorted.length - 1];
    const meanGap = gaps.length === 0 ? undefined : gaps.reduce((s, g) => s + g, 0) / gaps.length;
    const jitter = meanGap === undefined ? undefined : rms(gaps.map((g) => g - meanGap));
    evidence.push(
      `${kind}: ${times.length} events, median interval ${fmtMs(mid)} (${mid === undefined || mid === 0 ? 'n/a' : (1000 / mid).toFixed(1)} Hz), p95 ${fmtMs(p95)}, worst ${fmtMs(worst)}, jitter ${fmtMs(jitter)} RMS`,
    );
    if (gaps.length >= MIN_SCORED_SAMPLES) decided = true;
  }
  const reported = new Set<number>();
  for (const segment of recording.segments) {
    for (const event of segment.events) {
      if (event.kind === 'motion' && typeof event.event.interval === 'number') reported.add(event.event.interval);
    }
  }
  if (reported.size > 0) {
    evidence.push(`devicemotion reported interval values: ${[...reported].sort((a, b) => a - b).join(', ')} ms`);
  }

  const angles = new Set<number>();
  let badAngles = 0;
  for (const segment of recording.segments) {
    for (const event of segment.events) {
      if (event.kind !== 'orientation') continue;
      angles.add(event.screenAngleDeg);
      if (normaliseScreenAngle(event.screenAngleDeg) === undefined) badAngles += 1;
    }
  }
  evidence.push(
    `screen.orientation.angle values seen: ${[...angles].sort((a, b) => a - b).join(', ')}` +
      (badAngles > 0 ? ` — ${badAngles} event(s) reported an angle that is not a quarter turn` : ''),
  );
  evidence.push(
    'whether the motion-permission grant survives a reload and airplane mode is not in the event stream; the session notes carry it',
  );
  if (!decided) return inconclusive('event-rate', question, evidence);
  return verdict('event-rate', question, 'measured, see the evidence', 'high', evidence);
}

function fmtMs(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? 'n/a' : `${value.toFixed(1)} ms`;
}

/**
 * Largest jump in a tracked angle treated as a re-base rather than motion.
 *
 * An alpha re-base on tab suspend or reload moves the whole series at once. A
 * phone on a table cannot yaw 10° between two events at any rate a browser
 * delivers, and the compass-referenced series is smooth for the same reason, so
 * a jump this large is the platform re-zeroing rather than the phone turning.
 */
export const REBASE_JUMP_DEG = 10;

export interface DriftEstimate {
  readonly degPerMinute: number | undefined;
  readonly method: 'still-alpha-slope' | 'compass-referenced-bias' | 'none';
  readonly samples: number;
  readonly spanMinutes: number;
  readonly rebases: number;
  /** Spread of the per-run slopes, degrees per minute. */
  readonly runDisagreementDegPerMinute: number | undefined;
  readonly detail: string;
}

/** Split a series at re-base jumps, fit each run, and combine by duration. */
function driftFromSeries(
  times: readonly number[],
  values: readonly number[],
): { degPerMinute: number | undefined; rebases: number; disagreement: number | undefined } {
  const runs: { t: number[]; v: number[] }[] = [];
  let current: { t: number[]; v: number[] } | undefined;
  let previous: number | undefined;
  let unwrapped = 0;
  let rebases = 0;
  for (let i = 0; i < times.length; i += 1) {
    const t = times[i];
    const raw = values[i];
    if (t === undefined || raw === undefined) continue;
    if (previous === undefined) {
      unwrapped = raw;
      current = { t: [t], v: [unwrapped] };
      runs.push(current);
      previous = raw;
      continue;
    }
    const step = signedDeltaDeg(raw, previous);
    if (Math.abs(step) > REBASE_JUMP_DEG) {
      rebases += 1;
      unwrapped = raw;
      current = { t: [t], v: [unwrapped] };
      runs.push(current);
    } else {
      unwrapped += step;
      current?.t.push(t);
      current?.v.push(unwrapped);
    }
    previous = raw;
  }

  let weighted = 0;
  let weight = 0;
  const slopes: number[] = [];
  for (const run of runs) {
    if (run.t.length < 3) continue;
    const first = run.t[0];
    const last = run.t[run.t.length - 1];
    if (first === undefined || last === undefined) continue;
    const span = last - first;
    if (span <= 0) continue;
    const perMs = slope(run.t, run.v);
    if (perMs === undefined) continue;
    const perMinute = perMs * 60_000;
    slopes.push(perMinute);
    weighted += perMinute * span;
    weight += span;
  }
  if (weight === 0) return { degPerMinute: undefined, rebases, disagreement: undefined };
  const combined = weighted / weight;
  const disagreement = slopes.length < 2 ? undefined : rms(slopes.map((s) => s - combined));
  return { degPerMinute: combined, rebases, disagreement };
}

/** How still a segment's gravity must be before alpha alone measures drift. */
const STILL_SCATTER_DEG = 2;

function estimateDrift(
  segment: RecordedSegment,
  hypothesis: HypothesisVerdict,
): DriftEstimate {
  const samples = reduceSegment(segment);
  const spanMinutes = (segment.endMs - segment.startMs) / 60_000;
  const gravities = samples.map((s) => s.gravity);
  const meanG = meanDirection(gravities);
  const scatter = meanG === undefined ? undefined : median(gravities.map((g) => angleBetweenDeg(meanG, g)));
  const still = scatter !== undefined && scatter <= STILL_SCATTER_DEG;

  if (still) {
    const usable = samples.filter((s): s is Reduced & { alphaDeg: number } => s.alphaDeg !== undefined);
    if (usable.length >= MIN_SCORED_SAMPLES) {
      const fit = driftFromSeries(usable.map((s) => s.tMs), usable.map((s) => s.alphaDeg));
      return {
        degPerMinute: fit.degPerMinute,
        method: 'still-alpha-slope',
        samples: usable.length,
        spanMinutes,
        rebases: fit.rebases,
        runDisagreementDegPerMinute: fit.disagreement,
        detail:
          `the phone was still (median gravity scatter ${fmtDeg(scatter)}), so reported alpha is a direct ` +
          `read of the reference frame's own drift; ${fit.rebases} re-base(s) split out`,
      };
    }
  }

  if (hypothesis === INCONCLUSIVE) {
    return {
      degPerMinute: undefined,
      method: 'none',
      samples: samples.length,
      spanMinutes,
      rebases: 0,
      runDisagreementDegPerMinute: undefined,
      detail:
        `the phone moved (median gravity scatter ${fmtDeg(scatter)}), so drift can only be read against the ` +
        'compass, and the compass reference hypothesis is unsettled',
    };
  }

  // Bias = reported alpha − the alpha the compass and the attitude imply. On a
  // moving phone that is the only quantity whose change is drift rather than
  // the person turning.
  const times: number[] = [];
  const bias: number[] = [];
  for (const s of samples) {
    if (s.compassDeg === undefined || s.alphaDeg === undefined) continue;
    let cameraBearing: number;
    if (hypothesis === 'rear-camera-axis') {
      cameraBearing = s.compassDeg;
    } else {
      if (s.offsetDeg === undefined) continue;
      cameraBearing = s.compassDeg - s.offsetDeg;
    }
    const cameraFromAlpha = s.cameraFromAlphaDeg;
    if (cameraFromAlpha === undefined) continue;
    // `cameraFromAlphaDeg` is the camera bearing the REPORTED alpha implies, so
    // it is the true bearing minus alpha's error. Subtracting it from the
    // measured bearing leaves that error, signed the same way as the reported
    // alpha, so both methods here report the drift of alpha itself.
    times.push(s.tMs);
    bias.push(signedDeltaDeg(cameraBearing, cameraFromAlpha));
  }
  if (times.length < MIN_SCORED_SAMPLES) {
    return {
      degPerMinute: undefined,
      method: 'none',
      samples: times.length,
      spanMinutes,
      rebases: 0,
      runDisagreementDegPerMinute: undefined,
      detail: `only ${times.length} sample(s) carry both a compass reading and an alpha`,
    };
  }
  const fit = driftFromSeries(times, bias);
  return {
    degPerMinute: fit.degPerMinute,
    method: 'compass-referenced-bias',
    samples: times.length,
    spanMinutes,
    rebases: fit.rebases,
    runDisagreementDegPerMinute: fit.disagreement,
    detail:
      `the phone moved, so drift is read as the change in (alpha − the alpha the compass implies) under ` +
      `${hypothesis}; ${fit.rebases} re-base(s) split out. CLHeading is filtered and lags attitude, so ` +
      'vigorous handling inflates this figure rather than deflating it',
  };
}

/** Shortest still capture that puts a useful number on drift, minutes. */
const MIN_STILL_MINUTES = 2;

function driftVerdict(
  recording: HomeSessionRecording,
  pose: 'still-drift' | 'handling',
  hypothesis: HypothesisVerdict,
): Verdict {
  const id = pose === 'still-drift' ? 'alpha-drift-still' : 'alpha-drift-handling';
  const question =
    pose === 'still-drift'
      ? 'How fast does the relative alpha reference frame drift while the phone sits still?'
      : 'How fast does it drift while the phone is handled?';
  const segment = recording.segments.find((s) => s.pose === pose);
  if (!segment) return inconclusive(id, question, [`no ${pose} segment in the recording`]);
  const estimate = estimateDrift(segment, hypothesis);
  const evidence = [
    `segment span ${estimate.spanMinutes.toFixed(2)} min, ${estimate.samples} usable sample(s)`,
    `method: ${estimate.method}`,
    estimate.detail,
  ];
  if (estimate.runDisagreementDegPerMinute !== undefined) {
    evidence.push(
      `per-run slopes disagree by ${estimate.runDisagreementDegPerMinute.toFixed(2)} °/min RMS about the combined figure`,
    );
  }
  if (estimate.degPerMinute === undefined) return inconclusive(id, question, evidence);

  const disagreement = estimate.runDisagreementDegPerMinute ?? 0;
  const shaky = estimate.spanMinutes < MIN_STILL_MINUTES || disagreement > Math.abs(estimate.degPerMinute);
  const confidence: Confidence =
    estimate.method === 'still-alpha-slope' ? (shaky ? 'moderate' : 'high') : 'low';
  if (estimate.method === 'compass-referenced-bias') {
    evidence.push(
      'this is an upper bound: compass lag during handling adds to it, and it inherits whatever the compass reference verdict got wrong',
    );
  }
  if (estimate.spanMinutes < MIN_STILL_MINUTES) {
    evidence.push(`the segment is shorter than the ${MIN_STILL_MINUTES} min the protocol asks for`);
  }
  return verdict(
    id,
    question,
    `${estimate.degPerMinute >= 0 ? '+' : '−'}${Math.abs(estimate.degPerMinute).toFixed(2)} °/min` +
      (estimate.rebases > 0 ? `, with ${estimate.rebases} re-base(s) removed` : ''),
    confidence,
    evidence,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7b — The repeated-drag trials
 * ══════════════════════════════════════════════════════════════════════════
 * The field-test budget's largest term is drag precision, 0.543° at 1σ, and
 * that figure is an assumption about a hand rather than a measurement of one
 * (docs/FIELD-TEST-PREREGISTRATION.md, term 9). These trials replace it.
 *
 * The SCATTER is the term, not the mean. A person who is consistently 2° off
 * has a bias that the drag exists to remove; what limits the result is how far
 * apart their repeated attempts land. The sample standard deviation (n − 1) is
 * used because three attempts are a sample of a hand, not the whole of it.
 */

/** Fewest attempts in one mode before its scatter is worth stating. */
export const MIN_DRAG_TRIALS_PER_MODE = 3;

/** Mean, and the sample standard deviation (n − 1), of a run of numbers. */
export function meanAndSampleSd(values: readonly number[]): {
  readonly mean: number;
  readonly sd: number;
} {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length < 2) return { mean, sd: 0 };
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export interface DragModeScatter {
  readonly mode: RecordedDragMode;
  readonly count: number;
  /** Sample sd of the signed heading offset, degrees. This is the budget term. */
  readonly headingSdDeg: number;
  readonly headingMeanDeg: number;
  /** Sample sd of the signed horizontal finger offset, CSS pixels. */
  readonly pxSdPx: number;
  /** Mean and sample sd of the per-attempt roll spread, degrees. */
  readonly rollSpreadMeanDeg: number;
  readonly rollSpreadSdDeg: number;
  readonly rollSampleCount: number;
}

/** One mode's attempts, reduced to the statistics the budget wants. */
export function dragModeScatter(
  trials: readonly RecordedDragTrial[],
  mode: RecordedDragMode,
): DragModeScatter {
  const mine = trials.filter((trial) => trial.mode === mode);
  const heading = meanAndSampleSd(mine.map((trial) => trial.offsetDeg.headingDeg));
  const px = meanAndSampleSd(mine.map((trial) => trial.offsetPx.dx));
  const roll = meanAndSampleSd(mine.map((trial) => trial.rollSpreadDeg));
  return {
    mode,
    count: mine.length,
    headingSdDeg: heading.sd,
    headingMeanDeg: heading.mean,
    pxSdPx: px.sd,
    rollSpreadMeanDeg: roll.mean,
    rollSpreadSdDeg: roll.sd,
    rollSampleCount: mine.reduce((sum, trial) => sum + trial.rollSampleCount, 0),
  };
}

function dragScatterVerdict(recording: HomeSessionRecording): Verdict {
  const question =
    'How repeatable is the drag, and how steady was the roll under it?';
  const trials = recording.dragTrials ?? [];
  if (trials.length === 0) {
    return inconclusive('drag-scatter', question, ['no drag trials in the recording']);
  }

  const scatters = RECORDED_DRAG_MODES.map((mode) => dragModeScatter(trials, mode));
  const evidence = scatters.map((s) =>
    s.count === 0
      ? `${s.mode}: no attempts`
      : `${s.mode}: ${s.count} attempt(s), heading scatter ${s.headingSdDeg.toFixed(3)}° ` +
        `(mean ${s.headingMeanDeg >= 0 ? '+' : '−'}${Math.abs(s.headingMeanDeg).toFixed(3)}°, ` +
        `${s.pxSdPx.toFixed(1)} px), ` +
        `roll spread ${s.rollSpreadMeanDeg.toFixed(2)}° ± ${s.rollSpreadSdDeg.toFixed(2)}° ` +
        `over ${s.rollSampleCount} roll sample(s)`,
  );
  evidence.push(
    `the budget assumes ${BUDGET_TERMS.dragDeg}° at 1σ for this term, both axes`,
  );

  const measured = scatters.filter((s) => s.count >= MIN_DRAG_TRIALS_PER_MODE);
  if (measured.length === 0) {
    return verdict(
      'drag-scatter',
      question,
      `fewer than ${MIN_DRAG_TRIALS_PER_MODE} attempts in either mode, so the scatter is reported and not relied on`,
      'low',
      evidence,
    );
  }

  const best = measured.reduce((a, b) => (b.headingSdDeg < a.headingSdDeg ? b : a));
  const against = best.headingSdDeg <= BUDGET_TERMS.dragDeg ? 'under' : 'over';
  return verdict(
    'drag-scatter',
    question,
    `${best.mode} drag scatters ${best.headingSdDeg.toFixed(3)}° at 1σ, ${against} the ` +
      `${BUDGET_TERMS.dragDeg}° the budget assumed; the roll held to ` +
      `${best.rollSpreadMeanDeg.toFixed(2)}° over each attempt`,
    // Both modes measured is two independent samples of the same hand, which is
    // what separates a gain effect from one person's steady day.
    measured.length === RECORDED_DRAG_MODES.length ? 'moderate' : 'low',
    evidence,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7c — The tilt zero point, and whether the compass's own figure is honest
 * ══════════════════════════════════════════════════════════════════════════
 * Two biases, both read off the aiming steps, both absent from the error
 * budget until this session measures them.
 *
 * The pitch bias is the one the live band could not state. `live-uncertainty.ts`
 * carries a tilt SCATTER term and nothing else on the vertical axis, so a band
 * with a calibrated field of view claims the pitch is known to the width of a
 * second's worth of hand shake. Scatter is not bias: a phone whose gravity zero
 * sits 2° low reports the same tiny scatter while every label sits 2° wrong.
 *
 * The Sun supplies the missing reference. During an aiming step the person is
 * asked to keep it in the MIDDLE of the frame, so the camera axis points at the
 * Sun and the axis's true altitude is the Sun's altitude — a number the device
 * already computed and stored in `knownBearing.altitudeDeg`. The sensed
 * altitude comes from beta and gamma alone. The difference is the bias.
 *
 * The heading bias falls out of the same steps for free. The compass reading is
 * compared against the Sun's magnetic azimuth with no free parameter, and the
 * result is checked against the accuracy the phone itself reported at the time.
 * `webkitCompassAccuracy` is published by nobody, and this is the one place in
 * the project where it can be held against a bearing it did not supply.
 */

/**
 * Altitude of the rear camera's axis above the horizon, degrees.
 *
 * The camera looks along −z in device coordinates, and `gravityFromOrientation`
 * gives DOWN in those same coordinates as `(cos β sin γ, −sin β, −cos β cos γ)`.
 * The component of the camera axis along down is therefore `cos β cos γ`, and
 * the altitude is the arcsine of its negative. alpha cancels, so a phone with a
 * relative or drifting alpha costs this nothing.
 */
export function cameraAltitudeDeg(betaDeg: number, gammaDeg: number): number {
  const sinAltitude = -Math.cos(betaDeg * DEG) * Math.cos(gammaDeg * DEG);
  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / DEG;
}

/** One aiming step, reduced to what the pitch bias is pooled from. */
export interface PitchBiasSegment {
  readonly pose: PoseLabel;
  readonly samples: number;
  /** Median of sensed camera altitude minus the Sun's altitude, degrees. */
  readonly medianDeg: number;
  /** RMS about that median: the hand during the hold, not the zero point. */
  readonly scatterDeg: number;
  /** Tap offset applied, degrees. Zero when the step carries none. */
  readonly aimOffsetPitchDeg: number;
  readonly aimOffsetMeasured: boolean;
}

export interface PitchBiasEstimate {
  /** Mean of the per-step medians: how far the sensed tilt sits from truth. */
  readonly biasDeg: number;
  /** How far two re-aims disagree, degrees. Sample sd (n − 1) of those medians. */
  readonly spreadDeg: number;
  readonly perSegment: readonly PitchBiasSegment[];
  /** True only when every aiming step carried a measured tap offset. */
  readonly aimOffsetsMeasured: boolean;
  readonly sunAltitudeDeg: number;
  /**
   * False when the bias is too large to be a sensor's zero point.
   *
   * A phone's gravity vector is good to a degree or two; a figure of thirty
   * says the camera was not pointing at the Sun, which is a failed aim rather
   * than a measurement. Storing one would put that error straight into the live
   * band, so the screen keeps only a credible estimate.
   */
  readonly credible: boolean;
}

/** Fewest usable samples an aiming step needs before its median is pooled. */
export const MIN_PITCH_BIAS_SAMPLES = MIN_SCORED_SAMPLES;

/** Largest bias that can be a tilt sensor rather than a missed aim, degrees. */
export const MAX_CREDIBLE_PITCH_BIAS_DEG = 15;

/**
 * The tilt zero point, measured against the Sun.
 *
 * `undefined` when the reference is not the Sun, or when no aiming step carries
 * enough samples. Both are silence rather than a zero bias, and the live band
 * reports silence as an unquantified term.
 *
 * The per-step figure is a MEDIAN, because a hold includes the moment the
 * person was still settling and a mean would follow it. The pooled figure is
 * the MEAN of those medians, because each step is one independent re-aim and
 * the spread that matters is how far two re-aims land apart.
 */
export function estimatePitchBias(recording: HomeSessionRecording): PitchBiasEstimate | undefined {
  const bearing = recording.knownBearing;
  if (bearing.kind !== 'sun-azimuth') return undefined;

  const perSegment: PitchBiasSegment[] = [];
  for (const segment of recording.segments) {
    if (!AIMING_POSES.includes(segment.pose)) continue;
    // A reference sitting ABOVE centre means the camera axis pointed that far
    // BELOW it, so the offset is added back to the sensed altitude.
    const aimOffsetPitchDeg = segment.aimOffsetDeg?.pitchDeg ?? 0;
    const residuals = reduceSegment(segment).map(
      (s) => cameraAltitudeDeg(s.betaDeg, s.gammaDeg) - bearing.altitudeDeg + aimOffsetPitchDeg,
    );
    if (residuals.length < MIN_PITCH_BIAS_SAMPLES) continue;
    const medianDeg = median(residuals);
    if (medianDeg === undefined) continue;
    perSegment.push({
      pose: segment.pose,
      samples: residuals.length,
      medianDeg,
      scatterDeg: rms(residuals.map((value) => value - medianDeg)),
      aimOffsetPitchDeg,
      aimOffsetMeasured: segment.aimOffsetDeg !== undefined,
    });
  }
  if (perSegment.length === 0) return undefined;

  const { mean, sd } = meanAndSampleSd(perSegment.map((s) => s.medianDeg));
  const first = perSegment[0];
  return {
    biasDeg: mean,
    // One aiming step cannot show how far two re-aims disagree, so its own
    // within-hold scatter stands in and the verdict drops to low confidence.
    spreadDeg: perSegment.length >= 2 ? sd : (first?.scatterDeg ?? 0),
    perSegment,
    aimOffsetsMeasured: perSegment.every((s) => s.aimOffsetMeasured),
    sunAltitudeDeg: bearing.altitudeDeg,
    credible: Math.abs(mean) <= MAX_CREDIBLE_PITCH_BIAS_DEG,
  };
}

/**
 * A tilt figure, signed, at three decimals.
 *
 * `fmtSigned` rounds to a tenth of a degree, which is the right scale for a
 * compass bias and too coarse for a tilt one: a band term of 0.04° would print
 * as +0.0°.
 */
function fmtTilt(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(3)}°`;
}

function pitchBiasVerdict(
  recording: HomeSessionRecording,
  estimate: PitchBiasEstimate | undefined,
): Verdict {
  const question = 'How far is the sensed tilt from the truth, and how far apart do two re-aims land?';
  if (estimate === undefined) {
    return inconclusive('pitch-bias', question, [
      recording.knownBearing.kind === 'sun-azimuth'
        ? `no aiming step carries ${MIN_PITCH_BIAS_SAMPLES} usable orientation samples`
        : 'the known bearing is not the Sun, so no independent altitude is on file',
      `aiming poses: ${AIMING_POSES.join(', ')}`,
    ]);
  }

  const evidence = estimate.perSegment.map(
    (s) =>
      `${s.pose}: ${s.samples} samples, sensed tilt ${fmtTilt(s.medianDeg)} from the Sun's ` +
      `${estimate.sunAltitudeDeg.toFixed(2)}° altitude, ${s.scatterDeg.toFixed(3)}° RMS about that` +
      (s.aimOffsetMeasured
        ? `, tap offset ${fmtTilt(s.aimOffsetPitchDeg)} applied`
        : ', no tap offset recorded, so the aim is charged as perfect'),
  );
  if (!estimate.aimOffsetsMeasured) {
    evidence.push(
      'an unmeasured tap offset is the dominant unmodelled error here: it is how far the ' +
        'Sun really sat from the centre of the picture while the person held the step',
    );
  }

  if (!estimate.credible) {
    return inconclusive('pitch-bias', question, [
      `the sensed tilt sits ${fmtTilt(estimate.biasDeg)} from the Sun, past the ` +
        `${MAX_CREDIBLE_PITCH_BIAS_DEG}° a tilt sensor can be out by — the camera was not ` +
        'pointing at the Sun during the aiming steps, so nothing here measures the zero point',
      ...evidence,
    ]);
  }

  return verdict(
    'pitch-bias',
    question,
    `the sensed tilt sits ${fmtTilt(estimate.biasDeg)} from truth, and two re-aims land ` +
      `${estimate.spreadDeg.toFixed(3)}° apart at 1σ`,
    estimate.perSegment.length >= 2 ? 'moderate' : 'low',
    evidence,
  );
}

function headingBiasVerdict(
  recording: HomeSessionRecording,
  analysis: CompassReferenceAnalysis,
): Verdict {
  const question =
    'How far is webkitCompassHeading from the Sun’s magnetic azimuth, and does its reported accuracy cover that?';

  const accuracies: number[] = [];
  for (const segment of recording.segments) {
    if (!KNOWN_BEARING_POSES.includes(segment.pose)) continue;
    for (const s of reduceSegment(segment)) {
      if (s.compassDeg === undefined || s.compassAccuracyDeg === undefined) continue;
      if (s.compassAccuracyDeg >= 0) accuracies.push(s.compassAccuracyDeg);
    }
  }
  const reportedDeg = median(accuracies);

  // The bias is only defined once the reference axis is settled: the two
  // hypotheses differ by up to 90° in landscape, which would swamp it.
  const scored = analysis.perSegment.filter(
    (s) => s.mode === 'absolute' && s.topEdgeBiasDeg !== undefined && s.cameraAxisBiasDeg !== undefined,
  );
  const evidence = scored.map(
    (s) =>
      `${s.pose}: device-top-edge ${fmtSigned(s.topEdgeBiasDeg)}, ` +
      `rear-camera-axis ${fmtSigned(s.cameraAxisBiasDeg)} from the known bearing`,
  );
  evidence.push(
    reportedDeg === undefined
      ? 'the phone reported no compass accuracy during the aiming steps'
      : `the phone reported ${reportedDeg.toFixed(1)}° of accuracy, median over ${accuracies.length} aiming samples`,
  );

  if (scored.length === 0) {
    return inconclusive('heading-bias', question, [
      'no aiming step scored against the known bearing',
      ...evidence,
    ]);
  }
  if (analysis.verdict === INCONCLUSIVE) {
    return inconclusive('heading-bias', question, [
      'the compass reference is undecided, so the two hypotheses give two different biases',
      ...evidence,
    ]);
  }

  const biases = scored.map((s) =>
    analysis.verdict === 'device-top-edge' ? (s.topEdgeBiasDeg ?? 0) : (s.cameraAxisBiasDeg ?? 0),
  );
  const { mean, sd } = meanAndSampleSd(biases);
  evidence.push(
    `pooled under ${analysis.verdict}: ${fmtSigned(mean)} across ${biases.length} step(s), ` +
      `spread ${sd.toFixed(2)}°`,
  );

  if (reportedDeg === undefined) {
    return verdict(
      'heading-bias',
      question,
      `the reading sits ${fmtSigned(mean)} from the Sun’s magnetic azimuth; the phone claimed nothing, so nothing is checked`,
      'low',
      evidence,
    );
  }
  const covered = Math.abs(mean) <= reportedDeg;
  return verdict(
    'heading-bias',
    question,
    `the reading sits ${fmtSigned(mean)} from the Sun’s magnetic azimuth against the ` +
      `${reportedDeg.toFixed(1)}° the phone claimed, so the claim ${covered ? 'covers the bias' : 'understates it'}`,
    scored.length >= 2 ? 'moderate' : 'low',
    evidence,
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 8 — The whole analysis
 * ══════════════════════════════════════════════════════════════════════════ */

export interface RecordingAnalysis {
  /** `navigator.userAgent`. The verdicts apply to this browser and no other. */
  readonly device: string;
  readonly compassReference: CompassReferenceAnalysis;
  readonly verdicts: readonly Verdict[];
  /** The tilt zero point against the Sun, when the aiming steps support one. */
  readonly pitchBias?: PitchBiasEstimate;
  /** Poses the protocol asks for that the recording does not contain. */
  readonly missingPoses: readonly PoseLabel[];
}

/** Read every verdict the recording supports, and say so where it supports none. */
export function analyseRecording(recording: HomeSessionRecording): RecordingAnalysis {
  const compassReference = analyseCompassReference(recording);
  const present = new Set(recording.segments.map((s) => s.pose));
  const missingPoses = POSE_LABELS.filter((pose) => !present.has(pose));

  const compassVerdict = verdict(
    'compass-reference',
    'What is webkitCompassHeading referenced to when the phone is held up?',
    compassReference.verdict,
    compassReference.confidence,
    [
      compassReference.detail,
      ...compassReference.perSegment.map(
        (s) =>
          `${s.pose} [${s.mode}]: ${s.samples} samples, separation ${fmtDeg(s.separationDeg)}, ` +
          `device-top-edge ${fmtDeg(s.topEdgeResidualDeg)} RMS, rear-camera-axis ${fmtDeg(s.cameraAxisResidualDeg)} RMS → ` +
          `${s.verdict}${s.reason === 'decided' ? '' : ` (${s.reason})`}`,
      ),
    ],
  );

  const rollSegment = compassReference.perSegment.find((s) => s.pose === 'roll-about-camera-axis');
  const rollVerdict = rollSegment
    ? verdict(
        'roll-discriminator',
        'Does the heading move when the phone rolls about the camera axis?',
        rollSegment.verdict === 'device-top-edge'
          ? 'yes — the reading follows the top edge through the roll, which is the independent confirmation of the compass reference'
          : rollSegment.verdict === 'rear-camera-axis'
            ? 'no — the reading stayed with the camera through the roll'
            : INCONCLUSIVE,
        rollSegment.confidence,
        [rollSegment.detail],
      )
    : inconclusive('roll-discriminator', 'Does the heading move when the phone rolls about the camera axis?', [
        'no roll-about-camera-axis segment in the recording',
      ]);

  const tipSegment = compassReference.perSegment.find((s) => s.pose === 'tip-past-vertical');
  const tipVerdict = tipSegment
    ? verdict(
        'tip-discriminator',
        'Does the heading flip 180° as the phone tips past vertical?',
        tipSegment.verdict === 'device-top-edge'
          ? 'yes — the reading flipped with the top edge, so it is referenced to the top edge'
          : tipSegment.verdict === 'rear-camera-axis'
            ? 'no — the reading stayed continuous through vertical'
            : INCONCLUSIVE,
        tipSegment.confidence,
        [tipSegment.detail],
      )
    : inconclusive('tip-discriminator', 'Does the heading flip 180° as the phone tips past vertical?', [
        'no tip-past-vertical segment in the recording',
      ]);

  const [screenFrame, screenRollSign] = screenFrameVerdicts(recording);
  const verdicts: Verdict[] = [compassVerdict, tipVerdict, rollVerdict, landscapeSignVerdict(compassReference)];
  verdicts.push(accuracyGrowthVerdict(recording));
  if (screenFrame) verdicts.push(screenFrame);
  if (screenRollSign) verdicts.push(screenRollSign);
  verdicts.push(absolutePresenceVerdict(recording));
  verdicts.push(motionGravitySignVerdict(recording));
  verdicts.push(zeroAccelerationVerdict(recording));
  verdicts.push(calibrationVerdict(recording));
  verdicts.push(eventRateVerdict(recording));
  verdicts.push(driftVerdict(recording, 'still-drift', compassReference.verdict));
  verdicts.push(driftVerdict(recording, 'handling', compassReference.verdict));
  verdicts.push(dragScatterVerdict(recording));
  const pitchBias = estimatePitchBias(recording);
  verdicts.push(pitchBiasVerdict(recording, pitchBias));
  verdicts.push(headingBiasVerdict(recording, compassReference));

  return {
    device: recording.device,
    compassReference,
    verdicts,
    ...(pitchBias === undefined ? {} : { pitchBias }),
    missingPoses,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 9 — The forward model
 * ══════════════════════════════════════════════════════════════════════════
 * Everything below builds recordings rather than reading them. It exists so the
 * analyzer can be tested against data whose right answer is known before the
 * analyzer runs, and so the committed fixtures are reproducible.
 *
 * The three closed forms are derived by hand from § A.2 of the W3C Device
 * Orientation specification, whose ZXY matrix maps device coordinates to the
 * earth frame (x east, y magnetic north, z up):
 *
 *   column 2, the portrait top edge  = (−cosβ·sinα,  cosβ·cosα,  sinβ)
 *   column 3, out of the screen      = ( cosγ·sinα·sinβ + cosα·sinγ,
 *                                        sinα·sinγ − cosα·cosγ·sinβ,
 *                                        cosβ·cosγ )
 *   row 3, the earth's up in device coordinates = (−cosβ·sinγ, sinβ, cosβ·cosγ)
 *
 * The rear camera looks along −z, so its earth vector is column 3 negated, and
 * gravity is row 3 negated. Azimuth is atan2(east, north) throughout. Nothing
 * here calls the adapter, which is what makes a disagreement between the two
 * derivations visible instead of cancelling.
 */

function sin(deg: number): number {
  return Math.sin(deg * DEG);
}
function cos(deg: number): number {
  return Math.cos(deg * DEG);
}

/**
 * The camera's azimuth at alpha = 0, from the closed form above.
 *
 * With alpha = 0 the column-3 east and north components reduce to sinγ and
 * −cosγ·sinβ, and the camera negates both.
 */
export function cameraAzimuthAtZeroAlphaDeg(betaDeg: number, gammaDeg: number): number {
  return fold360((Math.atan2(-sin(gammaDeg), cos(gammaDeg) * sin(betaDeg)) * 180) / Math.PI);
}

/**
 * Top-edge azimuth minus camera azimuth, derived independently of the adapter.
 *
 * At alpha = 0 the top edge's horizontal projection is (0, cosβ), so its
 * azimuth is 0° while cosβ > 0 and 180° once the phone tips past vertical. That
 * 180° step is what the tip-past-vertical hold exists to catch.
 */
export function expectedTopEdgeMinusCameraDeg(betaDeg: number, gammaDeg: number): number {
  const topEdge = cos(betaDeg) > 0 ? 0 : 180;
  return signedDeltaDeg(topEdge, cameraAzimuthAtZeroAlphaDeg(betaDeg, gammaDeg));
}

/** Gravity in device coordinates, from row 3 of the matrix, negated. */
export function expectedGravity(betaDeg: number, gammaDeg: number): Vector3 {
  return { x: cos(betaDeg) * sin(gammaDeg), y: -sin(betaDeg), z: -cos(betaDeg) * cos(gammaDeg) };
}

/**
 * The alpha that puts the rear camera on `cameraAzimuthDeg`.
 *
 * Increasing alpha rotates the whole device about the earth's vertical, so
 * every body axis's azimuth decreases by the same amount: azimuth(α) =
 * azimuth(0) − α.
 */
export function alphaForCameraAzimuth(betaDeg: number, gammaDeg: number, cameraAzimuthDeg: number): number {
  return fold360(cameraAzimuthAtZeroAlphaDeg(betaDeg, gammaDeg) - cameraAzimuthDeg);
}

/** Standard gravity, m/s². Matches the adapter's `STANDARD_GRAVITY_MS2`. */
const G0 = 9.80665;

/** One attitude in a synthetic pose's trajectory. */
export interface SynthAttitude {
  readonly betaDeg: number;
  readonly gammaDeg: number;
}

export interface SynthSegmentSpec {
  readonly pose: PoseLabel;
  /** How long the hold runs, ms. */
  readonly durationMs: number;
  /** Orientation events per second. */
  readonly orientationHz: number;
  /** Motion events per second. 0 for none. */
  readonly motionHz?: number;
  /** Attitude at the start and at the end; the hold interpolates between them. */
  readonly from: SynthAttitude;
  readonly to?: SynthAttitude;
  /** Camera azimuth, magnetic degrees. Defaults to the recording's known bearing. */
  readonly cameraAzimuthDeg?: number;
  /** `screen.orientation.angle` during the hold. */
  readonly screenAngleDeg?: number;
  /**
   * Angle the screen switches to at the halfway point. The sign of the mapping
   * from device roll to screen angle is what question 5 measures, so it is an
   * input here rather than a constant: a test injects either sign and checks the
   * analyzer reports the one it was given.
   */
  readonly screenAngleToDeg?: number;
  readonly note?: string;
}

export interface SynthSpec {
  /** Which hypothesis the synthetic phone obeys. */
  readonly hypothesis: CompassReferenceHypothesis;
  readonly knownBearingDeg: number;
  readonly device: string;
  readonly segments: readonly SynthSegmentSpec[];
  /** Gaussian-ish noise on beta and gamma, degrees peak. */
  readonly attitudeNoiseDeg?: number;
  /** Noise on the compass reading, degrees peak. */
  readonly compassNoiseDeg?: number;
  /** Accuracy the compass reports when it is not inflated by tilt. */
  readonly compassAccuracyDeg?: number;
  /** Inflate the reported accuracy by 1/|cos β|, to test question 2 both ways. */
  readonly accuracyGrowsWithTilt?: boolean;
  /** Drift injected into the reported alpha, degrees per minute. */
  readonly alphaDriftDegPerMinute?: number;
  /** Constant added to the reported alpha, standing in for iOS's arbitrary zero. */
  readonly alphaBiasDeg?: number;
  /** Re-base the reported alpha by this much, at this time. */
  readonly alphaRebase?: { readonly atMs: number; readonly byDeg: number };
  readonly motionConvention?: WebGravityConvention;
  /** Emit `acceleration: (0,0,0)` and a null rotation rate: the no-gyroscope phone. */
  readonly noGyroscope?: boolean;
  /** Omit `absolute` from every event, as Safari does. */
  readonly omitAbsolute?: boolean;
  /** Seed for the deterministic noise generator. */
  readonly seed?: number;
  readonly note?: string;
}

/**
 * A deterministic noise source.
 *
 * A linear congruential generator, so a synthesised recording is identical on
 * every machine and a test that fails does so reproducibly. Numerical Recipes'
 * constants; the sum of three draws makes the distribution roughly triangular
 * rather than flat, which is closer to sensor noise and costs nothing.
 */
function noiseSource(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  const next = (): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return () => (next() + next() + next()) / 1.5 - 1;
}

/**
 * Build a recording from a specification.
 *
 * The events it emits are what a phone obeying `spec.hypothesis` would report,
 * so a test knows the answer before the analyzer runs. Every number comes from
 * the closed forms above.
 */
export function synthesiseRecording(spec: SynthSpec): HomeSessionRecording {
  const noise = noiseSource(spec.seed ?? 1);
  const attitudeNoise = spec.attitudeNoiseDeg ?? 0;
  const compassNoise = spec.compassNoiseDeg ?? 0;
  const baseAccuracy = spec.compassAccuracyDeg ?? 8;
  const segments: RecordedSegment[] = [];
  let tMs = 0;

  for (const segSpec of spec.segments) {
    const startMs = tMs;
    const endMs = startMs + segSpec.durationMs;
    const events: RecordedSensorEvent[] = [];
    const cameraAzimuth = segSpec.cameraAzimuthDeg ?? spec.knownBearingDeg;
    const screenAngleDeg = segSpec.screenAngleDeg ?? 0;
    const to = segSpec.to ?? segSpec.from;
    const orientationStep = 1000 / segSpec.orientationHz;
    const motionHz = segSpec.motionHz ?? 0;
    const motionStep = motionHz > 0 ? 1000 / motionHz : Infinity;

    const timeline: { t: number; kind: 'orientation' | 'motion' }[] = [];
    for (let t = 0; t <= segSpec.durationMs; t += orientationStep) {
      timeline.push({ t, kind: 'orientation' });
    }
    if (motionHz > 0) {
      for (let t = 0; t <= segSpec.durationMs; t += motionStep) {
        timeline.push({ t, kind: 'motion' });
      }
    }
    timeline.sort((a, b) => a.t - b.t || (a.kind === 'orientation' ? -1 : 1));

    for (const slot of timeline) {
      const fraction = segSpec.durationMs === 0 ? 0 : slot.t / segSpec.durationMs;
      const trueBeta = segSpec.from.betaDeg + fraction * (to.betaDeg - segSpec.from.betaDeg);
      const trueGamma = segSpec.from.gammaDeg + fraction * (to.gammaDeg - segSpec.from.gammaDeg);
      // Fold into the range a browser reports. A phone lying face down sits at
      // beta ±180, and noise on the wrong side of that would leave the range.
      const betaDeg = round4(foldSigned(trueBeta + attitudeNoise * noise()));
      const gammaDeg = round4(foldSigned(trueGamma + attitudeNoise * noise()));
      const absoluteTMs = startMs + slot.t;

      if (slot.kind === 'motion') {
        events.push(motionEventAt(spec, absoluteTMs, betaDeg, gammaDeg, noise));
        continue;
      }

      // Alpha follows the NOISE-FREE attitude, with its own noise added after.
      // Deriving it from the noisy beta and gamma instead would send it round
      // the circle at the flat poses, where the camera axis is vertical and its
      // azimuth is undefined — an excursion no phone reports, because a phone's
      // yaw stays well defined when its camera's bearing does not.
      const trueAlpha =
        alphaForCameraAzimuth(trueBeta, trueGamma, cameraAzimuth) + attitudeNoise * noise();
      let bias = spec.alphaBiasDeg ?? 0;
      bias += ((spec.alphaDriftDegPerMinute ?? 0) * absoluteTMs) / 60_000;
      if (spec.alphaRebase && absoluteTMs >= spec.alphaRebase.atMs) bias += spec.alphaRebase.byDeg;

      const offset = expectedTopEdgeMinusCameraDeg(betaDeg, gammaDeg);
      const reading =
        spec.hypothesis === 'rear-camera-axis' ? cameraAzimuth : cameraAzimuth + offset;
      const cosBeta = Math.abs(cos(betaDeg));
      const accuracy =
        spec.accuracyGrowsWithTilt === true && cosBeta > 1e-3
          ? round4(baseAccuracy / cosBeta)
          : baseAccuracy;

      events.push({
        kind: 'orientation',
        tMs: absoluteTMs,
        type: spec.omitAbsolute === true ? 'deviceorientation' : 'deviceorientationabsolute',
        absolutePresent: spec.omitAbsolute !== true,
        screenAngleDeg:
          segSpec.screenAngleToDeg !== undefined && fraction >= 0.5
            ? segSpec.screenAngleToDeg
            : screenAngleDeg,
        event: {
          alpha: round4(fold360(trueAlpha + bias)),
          beta: betaDeg,
          gamma: gammaDeg,
          ...(spec.omitAbsolute === true ? {} : { absolute: true }),
          webkitCompassHeading: round4(fold360(reading + compassNoise * noise())),
          webkitCompassAccuracy: accuracy,
        },
      });
    }

    segments.push({
      pose: segSpec.pose,
      startMs,
      endMs,
      ...(segSpec.note !== undefined ? { note: segSpec.note } : {}),
      events,
    });
    // A gap between holds: the person is repositioning the phone, and the
    // analyzer must not read that gap as event jitter.
    tMs = endMs + 500;
  }

  return {
    format: RECORDING_FORMAT,
    timestampBasis: TIMESTAMP_BASIS,
    device: spec.device,
    knownBearing: {
      kind: 'surveyed-bearing',
      magneticAzimuthDeg: fold360(spec.knownBearingDeg),
      source: 'synthetic: the bearing this recording was built around',
    },
    segments,
    ...(spec.note !== undefined ? { note: spec.note } : {}),
  };
}

function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Fold onto (−180, 180], the range `beta` and `gamma` are reported in. */
function foldSigned(deg: number): number {
  const folded = fold360(deg);
  return folded > 180 ? folded - 360 : folded;
}

function motionEventAt(
  spec: SynthSpec,
  tMs: number,
  betaDeg: number,
  gammaDeg: number,
  noise: () => number,
): RecordedMotionEvent {
  const g = expectedGravity(betaDeg, gammaDeg);
  const convention = spec.motionConvention ?? 'w3c-specific-force';
  const linear = spec.noGyroscope === true
    ? { x: 0, y: 0, z: 0 }
    : { x: round4(0.2 * noise()), y: round4(0.2 * noise()), z: round4(0.2 * noise()) };
  // The adapter recovers gravity as (withGravity − linear) × sign / g0, with
  // sign −1 for the W3C convention. Inverting that gives the payload a browser
  // in each convention would publish.
  const sign = convention === 'w3c-specific-force' ? -1 : 1;
  const withGravity = {
    x: round4(linear.x + sign * G0 * g.x),
    y: round4(linear.y + sign * G0 * g.y),
    z: round4(linear.z + sign * G0 * g.z),
  };
  return {
    kind: 'motion',
    tMs,
    event: { acceleration: linear, accelerationIncludingGravity: withGravity, interval: 16 },
    rotationRate: spec.noGyroscope === true
      ? null
      : { alpha: round4(2 * noise()), beta: round4(2 * noise()), gamma: round4(2 * noise()) },
  };
}

/**
 * The protocol the home session runs, as a synthetic specification.
 *
 * Every pose the analyzer looks for is here, so a synthesised recording from
 * this list answers every question and a recording missing a pose can be built
 * by dropping one entry. The attitudes are the ones `calibration.ts` and
 * `web-sensors.ts` name: portrait upright is beta 85° rather than 90° because a
 * top edge at exactly vertical has no azimuth at all, and a person holding a
 * phone at a horizon does not hit 90° either.
 */
export function protocolSegments(): readonly SynthSegmentSpec[] {
  return [
    { pose: 'flat-face-up', durationMs: 4000, orientationHz: 10, motionHz: 10, from: { betaDeg: 0, gammaDeg: 0 } },
    { pose: 'upright-portrait', durationMs: 4000, orientationHz: 10, motionHz: 10, from: { betaDeg: 90, gammaDeg: 0 } },
    { pose: 'flat-face-down', durationMs: 4000, orientationHz: 10, motionHz: 10, from: { betaDeg: 180, gammaDeg: 0 } },
    { pose: 'right-edge-down', durationMs: 4000, orientationHz: 10, motionHz: 10, from: { betaDeg: 0, gammaDeg: 90 } },
    {
      pose: 'portrait-upright-known-bearing',
      durationMs: 5000,
      orientationHz: 10,
      from: { betaDeg: 85, gammaDeg: 0 },
      note: 'portrait, camera on the known bearing; the blind spot where the hypotheses agree',
    },
    {
      pose: 'landscape-upright-known-bearing-top-right',
      durationMs: 5000,
      orientationHz: 10,
      from: { betaDeg: 0, gammaDeg: 90 },
      to: { betaDeg: 5, gammaDeg: 90 },
      screenAngleDeg: 90,
      note: 'top edge to the right of the target; the hypotheses differ by +90 degrees',
    },
    {
      pose: 'landscape-upright-known-bearing-top-left',
      durationMs: 5000,
      orientationHz: 10,
      from: { betaDeg: 0, gammaDeg: -90 },
      to: { betaDeg: 5, gammaDeg: -90 },
      screenAngleDeg: 270,
      note: 'top edge to the left of the target; the hypotheses differ by -90 degrees',
    },
    {
      pose: 'tip-past-vertical',
      durationMs: 6000,
      orientationHz: 10,
      from: { betaDeg: 70, gammaDeg: 0 },
      to: { betaDeg: 110, gammaDeg: 0 },
      note: 'tipped through vertical; the top edge azimuth steps 180 degrees at beta 90',
    },
    {
      pose: 'roll-about-camera-axis',
      durationMs: 6000,
      orientationHz: 10,
      from: { betaDeg: 80, gammaDeg: -60 },
      to: { betaDeg: 80, gammaDeg: 60 },
      note: 'rolled about the camera axis with the bearing held',
    },
    {
      pose: 'rotate-to-landscape',
      durationMs: 5000,
      orientationHz: 10,
      from: { betaDeg: 85, gammaDeg: 0 },
      to: { betaDeg: 0, gammaDeg: 90 },
      screenAngleDeg: 0,
      screenAngleToDeg: 90,
      note: 'portrait upright to landscape upright, so the device roll swings a quarter turn',
    },
    {
      pose: 'still-drift',
      durationMs: 200_000,
      orientationHz: 1,
      from: { betaDeg: 0, gammaDeg: 0 },
      note: 'flat on a table, untouched',
    },
    {
      pose: 'handling',
      durationMs: 60_000,
      orientationHz: 5,
      from: { betaDeg: 20, gammaDeg: -40 },
      to: { betaDeg: 80, gammaDeg: 40 },
      note: 'picked up, turned, put down',
    },
    {
      pose: 'sun-capture',
      durationMs: 4000,
      orientationHz: 10,
      from: { betaDeg: 0, gammaDeg: 80 },
      screenAngleDeg: 90,
      note: 'landscape, sun centred horizontally in the frame',
    },
  ];
}
