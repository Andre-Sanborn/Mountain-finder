/**
 * The field-capture bundle: its schema, its strict parser, and the grader that
 * reads the pre-registered verdicts out of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * One field session produces a handful of camera frames, the pose each was
 * drawn at, and the overlay as it was actually drawn. Two independent agents
 * then locate each summit's apex in those frames. This module compares the two
 * and prints the criteria F2 to F5 from
 * `docs/FIELD-TEST-PREREGISTRATION.md`.
 *
 * It is pure: a parsed bundle and a parsed annotation set in, a table of
 * verdicts out. No clock, no filesystem, no DOM. `scripts/analyze-field.ts` is
 * the thin shell that loads two files and prints the table.
 *
 * ── THE THRESHOLDS ARE DATA, AND THEY ARE FIXED ─────────────────────────────
 * `PREREGISTERED_THRESHOLDS` is the table in § 2.3 of the pre-registration,
 * derived from the error budget in § 1.5 before any field number existed. The
 * grader takes no threshold argument, so a run cannot be graded against
 * anything else. Changing a number here changes it there, in the same commit,
 * with the reason.
 *
 * ── PRIVACY: WHY NO POSITION, NO CLOCK, AND NO DISTANCES IN THE OUTPUT ──────
 * `AGENTS.md` § "Captures from the phone" allows orientation and motion events
 * only, with timestamps relative to the start of the capture. The parser here
 * goes further, because a field bundle holds more than sensor events.
 *
 * A distance and a bearing to a named summit IS a position fix. So:
 *   - the schema carries no bearings at all. The grader does not need them: the
 *     overlay's own pixel positions are what it compares, and the distance is
 *     needed only to choose a tolerance band.
 *   - `FieldReport` carries band labels, never distances, and a test asserts the
 *     rendered lines hold no distance and no bearing.
 *   - the camera frame is referenced by file name. The bytes stay beside the
 *     bundle, and the parser refuses an embedded image.
 *
 * What remains is stated rather than glossed: a set of distances to named
 * summits locates the observer, and the bundle holds those distances because
 * the tolerance depends on them. That is why a bundle travels only by the
 * human's own action to their own account, is never committed, and is never
 * attached to an issue.
 *
 * ── WHERE SUMMIT TRUTH COMES FROM ──────────────────────────────────────────
 * Not from the bundle. The bundle is written by the device under test, so
 * letting it supply the identity and height of a summit would let a wrong
 * import grade itself as correct. `PeakLookup` resolves each summit id against
 * the committed peak data, and a summit whose height in the bundle disagrees
 * with the committed value by more than a metre is a provenance failure
 * reported before any geometry is graded.
 *
 * ── THE SYNTHESISER IS AN INDEPENDENT INSTRUMENT ───────────────────────────
 * `synthesiseFieldBundle` builds bundles by placing a truth apex at a pixel and
 * displacing the drawn marker from it by a stated pixel offset. It never calls
 * the grader, and it does no angle arithmetic at all — the expected residual in
 * degrees is written out as a literal in the test, from the tangent relation.
 * `angularOffsetDeg` is cross-checked against `src/core`'s own `projectToImage`
 * in the test suite, so an inverted projection cannot cancel itself out between
 * the grader and the fixtures that grade it.
 */

import type { Peak } from '../core/types';

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — The pre-registered thresholds
 * ══════════════════════════════════════════════════════════════════════════ */

/** The distance bands of the pre-registration's § 2.3 table, nearest first. */
export type BandId = 'near' | 'mid' | 'far' | 'distant' | 'horizon';

export interface BandThreshold {
  readonly band: BandId;
  /** Inclusive lower bound, km. The `near` band starts at 0. */
  readonly fromKm: number;
  /** Exclusive upper bound, km. `Infinity` for `horizon`. */
  readonly toKm: number;
  /** After-drag tolerance on the horizontal frame angle, degrees. */
  readonly horizontalDeg: number;
  /** After-drag tolerance on the vertical frame angle, degrees. */
  readonly verticalDeg: number;
}

/**
 * The F3 and F4 tolerances: 2σ of the error budget, rounded up to 0.05°.
 *
 * The last three bands carry the same figure because the budget is flat beyond
 * 7 km — the drag, the roll and the field-of-view scale do not care how far a
 * summit is, and beyond 7 km they are the whole budget. They stay separate rows
 * so the result reports how many summits each band actually held.
 */
export const PREREGISTERED_THRESHOLDS: readonly BandThreshold[] = [
  { band: 'near', fromKm: 0, toKm: 3, horizontalDeg: 1.9, verticalDeg: 1.45 },
  { band: 'mid', fromKm: 3, toKm: 7, horizontalDeg: 1.4, verticalDeg: 1.3 },
  { band: 'far', fromKm: 7, toKm: 20, horizontalDeg: 1.3, verticalDeg: 1.3 },
  { band: 'distant', fromKm: 20, toKm: 45, horizontalDeg: 1.3, verticalDeg: 1.3 },
  { band: 'horizon', fromKm: 45, toKm: Infinity, horizontalDeg: 1.3, verticalDeg: 1.3 },
];

/**
 * Widest apex disagreement between the two annotators that still permits a
 * grade, degrees. A quarter of the tightest F3 threshold: truth four times
 * finer than the tolerance is the least that makes a verdict mean anything.
 */
export const MAX_TRUTH_DISAGREEMENT_DEG = 0.3;

/** How far a pan may stray from the registered ±20° and still be graded. */
export const PAN_ENVELOPE_DEG = { min: 15, max: 25 } as const;

/** How far a tilt may stray from the registered ±10° and still be graded. */
export const TILT_ENVELOPE_DEG = { min: 5, max: 15 } as const;

/** The frame the budget was computed on, § 1.2 of the pre-registration. */
export const REGISTERED_FRAME = { hFovDeg: 73.74, aspectRatio: 956 / 440 } as const;

/** Fractional deviation from {@link REGISTERED_FRAME} that is worth reporting. */
export const FRAME_DEVIATION_TOLERANCE = 0.1;

/** How many of the most prominent predicted summits F5b requires a name on. */
export const PROMINENT_LABEL_COUNT = 3;

/** Largest height disagreement between bundle and committed peak data, metres. */
export const MAX_ELEVATION_DISAGREEMENT_M = 1;

/**
 * The band a distance falls in. Lower bound inclusive, upper bound exclusive,
 * so a summit exactly 3 km away is graded against `mid` rather than `near` —
 * the tighter of the two, which is the safe direction for a boundary.
 */
export function bandFor(distanceKm: number): BandThreshold | undefined {
  return PREREGISTERED_THRESHOLDS.find(
    (threshold) => distanceKm >= threshold.fromKm && distanceKm < threshold.toKm,
  );
}

/**
 * Whether a residual is inside a band's tolerance, on both axes.
 *
 * One implementation, called by every criterion that grades a position, so the
 * boundary cannot be `<=` in one place and `<` in another. The comparison is
 * inclusive: a residual exactly at the threshold passes, because the threshold
 * is a stated limit rather than a value the budget excludes.
 */
export function withinThreshold(residual: Residual, threshold: BandThreshold): boolean {
  return (
    Math.abs(residual.horizontalDeg) <= threshold.horizontalDeg &&
    Math.abs(residual.verticalDeg) <= threshold.verticalDeg
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — The bundle schema
 * ══════════════════════════════════════════════════════════════════════════ */

/** Format tag. Bumped when a reader would misread an older file. */
export const BUNDLE_FORMAT = 'mountain-finder/field-bundle@1';

/** Format tag of the separate truth-annotation document. */
export const TRUTH_FORMAT = 'mountain-finder/field-apex-truth@1';

/** The only timestamp basis either format permits. */
export const TIMESTAMP_BASIS = 'ms-since-session-start';

/** What a capture is for, which decides which criteria grade it. */
export const CAPTURE_ROLES = ['before-drag', 'after-drag', 'moved'] as const;
export type CaptureRole = (typeof CAPTURE_ROLES)[number];

/** A pixel in the stored camera frame. Origin top-left, x right, y down. */
export interface PixelPoint {
  readonly xPx: number;
  readonly yPx: number;
}

/**
 * A summit as the overlay drew it.
 *
 * `summitPx` is in the overlay's own drawing space, which is the CSS viewport
 * rather than the stored frame; `Capture.overlayPx` and `Capture.framePx` give
 * the two sizes and the grader scales between them. No bearing is carried; see
 * this file's header.
 */
export interface DrawnSummit {
  readonly summitId: string;
  readonly name: string;
  readonly elevationM: number;
  readonly distanceKm: number;
  /** Apparent height above the horizontal, degrees. F5b ranks on this. */
  readonly altitudeDeg: number;
  readonly visibility: 'visible' | 'marginal' | 'self-occluded';
  readonly summitPx: PixelPoint;
  /** False for a summit that got a dot but no name, i.e. crowded out. */
  readonly labelled: boolean;
}

/**
 * A summit the overlay held back, and why.
 *
 * `unmeasured` is the one F5c grades: a summit beyond the swept terrain gets no
 * verdict at all. The others are carried so the report can say what happened to
 * a summit an annotator found but the overlay never drew.
 */
export interface WithheldSummit {
  readonly summitId: string;
  readonly name: string;
  readonly distanceKm: number;
  readonly reason: 'unmeasured' | 'off-frame' | 'foreground-occluded';
}

/** The overlay as drawn, reduced to what a grader needs. */
export interface DrawnOverlay {
  readonly drawn: readonly DrawnSummit[];
  readonly withheld: readonly WithheldSummit[];
}

/**
 * The uncertainty band the screen displayed, in the app's own terms.
 *
 * `hasUnquantifiedHorizontal` and its vertical twin are what make F2's gate
 * conditional: a band with an unquantified term is a floor, which `summarise`
 * already says on screen, and a floor cannot be exceeded.
 */
export interface DisplayedBand {
  readonly horizontalDeg: number;
  readonly verticalDeg: number;
  readonly hasUnquantifiedHorizontal: boolean;
  readonly hasUnquantifiedVertical: boolean;
}

/** The pose the overlay was drawn at, plus the trim the user had dragged in. */
export interface CapturePose {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
  readonly hFovDeg: number;
  readonly vFovDeg: number;
  readonly headingBasis: 'true' | 'true-model' | 'magnetic';
  readonly trimHeadingDeg: number;
  readonly trimPitchDeg: number;
}

/**
 * What the sensor trace did over the capture second.
 *
 * `stillForMs` is what earns the exclusion of the heading-smoothing lag from
 * the budget: the 400 ms smoothing time constant decays to under 0.06° after
 * 2 s of stillness, and a capture that was not still for that long is graded
 * with the shortfall reported.
 */
export interface CaptureTrace {
  readonly headingSpreadDeg: number;
  readonly pitchSpreadDeg: number;
  readonly rollSpreadDeg: number;
  readonly sampleCount: number;
  readonly stillForMs: number;
  readonly compassAccuracyDeg?: number;
  /** Overlay re-projection ticks in the capture second, for F1's rate floor. */
  readonly tickCount?: number;
  readonly longestTickGapMs?: number;
}

/** A `MediaStreamTrack.getSettings()` snapshot, with the identifiers removed. */
export interface TrackGeometry {
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  readonly facingMode?: string;
  readonly resizeMode?: string;
  readonly zoom?: number;
}

/** One camera frame, and everything the app knew when it drew over it. */
export interface Capture {
  readonly captureId: string;
  readonly role: CaptureRole;
  /** Milliseconds since the start of the session. Never a wall clock. */
  readonly tMs: number;
  /**
   * File name of the camera frame, beside the bundle. A plain relative name:
   * no directory, no traversal, and never the bytes themselves.
   */
  readonly framePath: string;
  /** Stored frame size. The truth apexes are in this space. */
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
  /** The overlay's drawing space, i.e. the CSS viewport. */
  readonly overlayPx: { readonly widthPx: number; readonly heightPx: number };
  readonly pose: CapturePose;
  readonly trace: CaptureTrace;
  readonly track: TrackGeometry;
  readonly fovSource: 'calibrated' | 'spec-sheet-guess';
  /** Radius of the terrain sweep behind this overlay, km. F5c needs it. */
  readonly sweepRadiusKm: number;
  readonly band: DisplayedBand;
  readonly overlay: DrawnOverlay;
  /** The summit the drag was anchored on. Absent on a before-drag capture. */
  readonly dragAnchorSummitId?: string;
  /** For a `moved` capture: which after-drag capture it moved from. */
  readonly movedFromCaptureId?: string;
  readonly panFromReferenceDeg?: number;
  readonly tiltFromReferenceDeg?: number;
  readonly note?: string;
}

/** A whole field session. */
export interface FieldBundle {
  readonly format: typeof BUNDLE_FORMAT;
  readonly timestampBasis: typeof TIMESTAMP_BASIS;
  /** `navigator.userAgent`, verbatim. Names the browser the verdicts apply to. */
  readonly device: string;
  /** Which committed peak regions the app had loaded. Public identifiers. */
  readonly peakRegions: readonly string[];
  readonly captures: readonly Capture[];
  readonly note?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3 — The truth-annotation schema
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * One annotator's reading of one summit in one frame.
 *
 * `apexPx: null` means "I cannot identify this summit in this frame". It is a
 * positive answer, and it is what makes F5a's false-`visible` check possible.
 */
export interface ApexAnnotation {
  readonly summitId: string;
  readonly apexPx: PixelPoint | null;
  readonly note?: string;
}

export interface AnnotatorReading {
  /** Stable annotator id, e.g. `agent-a`. Never a person's name. */
  readonly annotatorId: string;
  readonly apexes: readonly ApexAnnotation[];
}

export interface CaptureTruth {
  readonly captureId: string;
  readonly readings: readonly AnnotatorReading[];
}

/** The apex truth for a whole session, from two independent annotators. */
export interface FieldTruth {
  readonly format: typeof TRUTH_FORMAT;
  /** How the annotators worked, and what they were shown. One or two lines. */
  readonly method: string;
  readonly captures: readonly CaptureTruth[];
}

/** Exactly two independent readings per capture, per § 2.0 of the prereg. */
export const REQUIRED_ANNOTATORS = 2;

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4 — The strict parser
 * ══════════════════════════════════════════════════════════════════════════ */

/** One reason a document was rejected, with the path that carries it. */
export interface BundleProblem {
  readonly path: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly BundleProblem[] };

/**
 * Keys that convict a document outright, whatever else is in it.
 *
 * The exact-key whitelists below already reject every one of these as unknown.
 * The list is here anyway for two reasons: it names the rule that was broken
 * instead of saying "unexpected key", and it keeps holding if a later revision
 * widens a whitelist by accident.
 */
const FORBIDDEN_KEYS: Readonly<Record<string, string>> = {
  geolocation: 'geolocation data has no place in a field bundle',
  coords: 'a GeolocationPosition.coords wrapper',
  position: 'a position fix',
  latitude: 'a coordinate',
  longitude: 'a coordinate',
  lat: 'a coordinate',
  lon: 'a coordinate',
  lng: 'a coordinate',
  gps: 'a position fix',
  altitudeaccuracy: 'a position fix',
  bearingdeg: 'a bearing to a named summit, which with its distance is a position fix',
  bearing: 'a bearing to a named summit, which with its distance is a position fix',
  azimuthdeg: 'a bearing to a named summit',
  observer: 'the observer position',
  viewpoint: 'the observer position',
  siteid: 'the committed site definition names a viewpoint',
  deviceid: 'an identifier for one handset',
  groupid: 'an identifier for one handset',
  label: "a camera device's label identifies one handset",
  timestamp: 'a timestamp key; relative offsets are named tMs',
  time: 'a timestamp key; relative offsets are named tMs',
  date: 'a wall-clock date',
  utc: 'a wall clock',
  image: 'a camera frame',
  frame: 'a camera frame',
  photo: 'a camera frame',
  dataurl: 'an embedded camera frame',
  base64: 'an embedded camera frame',
  bytes: 'an embedded camera frame',
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
 * onward is caught, while the longest plausible session — an hour, 3.6e6 ms —
 * is two orders of magnitude below it.
 */
export const EPOCH_FLOOR = 1e9;

/** An ISO 8601 date, with or without a time of day. */
const ISO_DATE = /\d{4}-[01]\d-[0-3]\d/;

/**
 * Longest string the document may hold. A base64 frame smuggled into a free-text
 * field would pass every key rule, and 4 kB is far more than any note needs.
 */
export const MAX_STRING_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk the raw document and collect every forbidden key, every absolute-time
 * value and every string long enough to hide an image.
 *
 * This runs BEFORE the structural parse, over the document as written, so a
 * banned key nested inside something the structural parse would have ignored is
 * still reported.
 */
export function findForbiddenContent(raw: unknown): readonly BundleProblem[] {
  const problems: BundleProblem[] = [];

  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        problems.push({ path, message: 'not a finite number' });
      } else if (Math.abs(value) >= EPOCH_FLOOR) {
        problems.push({
          path,
          message: `${value} is at least ${EPOCH_FLOOR}, the shape of an absolute epoch timestamp; timestamps are relative to the start of the session`,
        });
      }
      return;
    }
    if (typeof value === 'string') {
      if (ISO_DATE.test(value)) {
        problems.push({ path, message: 'holds an ISO 8601 date, which is a wall clock' });
      }
      if (value.length > MAX_STRING_LENGTH) {
        problems.push({
          path,
          message: `${value.length} characters, over the ${MAX_STRING_LENGTH} limit; a string this long can hide an encoded camera frame`,
        });
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
  readonly list: BundleProblem[] = [];

  add(path: string, message: string): undefined {
    this.list.push({ path, message });
    return undefined;
  }
}

function checkKeys(
  p: Problems,
  path: string,
  obj: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      p.add(
        path === '' ? key : `${path}.${key}`,
        `unknown key; allowed here: ${allowed.join(', ')}`,
      );
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

function asNumber(
  p: Problems,
  path: string,
  value: unknown,
  bounds: NumberBounds = {},
): number | undefined {
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
  if (typeof value !== 'boolean') return p.add(path, 'expected true or false');
  return value;
}

function asMember<T extends string>(
  p: Problems,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return p.add(path, `expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

const PIXEL_KEYS = ['xPx', 'yPx'] as const;

function asPixelPoint(p: Problems, path: string, value: unknown): PixelPoint | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, PIXEL_KEYS);
  const xPx = asNumber(p, `${path}.xPx`, obj.xPx);
  const yPx = asNumber(p, `${path}.yPx`, obj.yPx);
  if (xPx === undefined || yPx === undefined) return undefined;
  return { xPx, yPx };
}

const SIZE_KEYS = ['widthPx', 'heightPx'] as const;

function asSize(
  p: Problems,
  path: string,
  value: unknown,
): { readonly widthPx: number; readonly heightPx: number } | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, SIZE_KEYS);
  const widthPx = asNumber(p, `${path}.widthPx`, obj.widthPx, { min: 1 });
  const heightPx = asNumber(p, `${path}.heightPx`, obj.heightPx, { min: 1 });
  if (widthPx === undefined || heightPx === undefined) return undefined;
  return { widthPx, heightPx };
}

const DRAWN_KEYS = [
  'summitId',
  'name',
  'elevationM',
  'distanceKm',
  'altitudeDeg',
  'visibility',
  'summitPx',
  'labelled',
] as const;

const DRAWN_VISIBILITIES = ['visible', 'marginal', 'self-occluded'] as const;

function parseDrawnSummit(p: Problems, path: string, value: unknown): DrawnSummit | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, DRAWN_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  const name = asString(p, `${path}.name`, obj.name);
  const elevationM = asNumber(p, `${path}.elevationM`, obj.elevationM, { min: -500, max: 9000 });
  const distanceKm = asNumber(p, `${path}.distanceKm`, obj.distanceKm, { min: 0, max: 400 });
  const altitudeDeg = asNumber(p, `${path}.altitudeDeg`, obj.altitudeDeg, { min: -90, max: 90 });
  const visibility = asMember(p, `${path}.visibility`, obj.visibility, DRAWN_VISIBILITIES);
  const summitPx = asPixelPoint(p, `${path}.summitPx`, obj.summitPx);
  const labelled = asBoolean(p, `${path}.labelled`, obj.labelled);
  if (
    summitId === undefined ||
    name === undefined ||
    elevationM === undefined ||
    distanceKm === undefined ||
    altitudeDeg === undefined ||
    visibility === undefined ||
    summitPx === undefined ||
    labelled === undefined
  ) {
    return undefined;
  }
  return { summitId, name, elevationM, distanceKm, altitudeDeg, visibility, summitPx, labelled };
}

const WITHHELD_KEYS = ['summitId', 'name', 'distanceKm', 'reason'] as const;
const WITHHELD_REASONS = ['unmeasured', 'off-frame', 'foreground-occluded'] as const;

function parseWithheldSummit(p: Problems, path: string, value: unknown): WithheldSummit | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, WITHHELD_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  const name = asString(p, `${path}.name`, obj.name);
  const distanceKm = asNumber(p, `${path}.distanceKm`, obj.distanceKm, { min: 0, max: 400 });
  const reason = asMember(p, `${path}.reason`, obj.reason, WITHHELD_REASONS);
  if (
    summitId === undefined ||
    name === undefined ||
    distanceKm === undefined ||
    reason === undefined
  ) {
    return undefined;
  }
  return { summitId, name, distanceKm, reason };
}

const OVERLAY_KEYS = ['drawn', 'withheld'] as const;

function parseOverlay(p: Problems, path: string, value: unknown): DrawnOverlay | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, OVERLAY_KEYS);
  const rawDrawn = asArray(p, `${path}.drawn`, obj.drawn);
  const rawWithheld = asArray(p, `${path}.withheld`, obj.withheld);
  if (rawDrawn === undefined || rawWithheld === undefined) return undefined;
  const drawn: DrawnSummit[] = [];
  rawDrawn.forEach((item, index) => {
    const summit = parseDrawnSummit(p, `${path}.drawn[${index}]`, item);
    if (summit) drawn.push(summit);
  });
  const withheld: WithheldSummit[] = [];
  rawWithheld.forEach((item, index) => {
    const summit = parseWithheldSummit(p, `${path}.withheld[${index}]`, item);
    if (summit) withheld.push(summit);
  });
  return { drawn, withheld };
}

const BAND_KEYS = [
  'horizontalDeg',
  'verticalDeg',
  'hasUnquantifiedHorizontal',
  'hasUnquantifiedVertical',
] as const;

function parseBand(p: Problems, path: string, value: unknown): DisplayedBand | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, BAND_KEYS);
  const horizontalDeg = asNumber(p, `${path}.horizontalDeg`, obj.horizontalDeg, { min: 0, max: 90 });
  const verticalDeg = asNumber(p, `${path}.verticalDeg`, obj.verticalDeg, { min: 0, max: 90 });
  const hasUnquantifiedHorizontal = asBoolean(
    p,
    `${path}.hasUnquantifiedHorizontal`,
    obj.hasUnquantifiedHorizontal,
  );
  const hasUnquantifiedVertical = asBoolean(
    p,
    `${path}.hasUnquantifiedVertical`,
    obj.hasUnquantifiedVertical,
  );
  if (
    horizontalDeg === undefined ||
    verticalDeg === undefined ||
    hasUnquantifiedHorizontal === undefined ||
    hasUnquantifiedVertical === undefined
  ) {
    return undefined;
  }
  return { horizontalDeg, verticalDeg, hasUnquantifiedHorizontal, hasUnquantifiedVertical };
}

const POSE_KEYS = [
  'headingDeg',
  'pitchDeg',
  'rollDeg',
  'hFovDeg',
  'vFovDeg',
  'headingBasis',
  'trimHeadingDeg',
  'trimPitchDeg',
] as const;

const HEADING_BASES = ['true', 'true-model', 'magnetic'] as const;

function parsePose(p: Problems, path: string, value: unknown): CapturePose | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, POSE_KEYS);
  const headingDeg = asNumber(p, `${path}.headingDeg`, obj.headingDeg, { min: 0, max: 360 });
  const pitchDeg = asNumber(p, `${path}.pitchDeg`, obj.pitchDeg, { min: -90, max: 90 });
  const rollDeg = asNumber(p, `${path}.rollDeg`, obj.rollDeg, { min: -180, max: 180 });
  const hFovDeg = asNumber(p, `${path}.hFovDeg`, obj.hFovDeg, { min: 1, max: 179 });
  const vFovDeg = asNumber(p, `${path}.vFovDeg`, obj.vFovDeg, { min: 1, max: 179 });
  const headingBasis = asMember(p, `${path}.headingBasis`, obj.headingBasis, HEADING_BASES);
  const trimHeadingDeg = asNumber(p, `${path}.trimHeadingDeg`, obj.trimHeadingDeg, {
    min: -180,
    max: 180,
  });
  const trimPitchDeg = asNumber(p, `${path}.trimPitchDeg`, obj.trimPitchDeg, { min: -90, max: 90 });
  if (
    headingDeg === undefined ||
    pitchDeg === undefined ||
    rollDeg === undefined ||
    hFovDeg === undefined ||
    vFovDeg === undefined ||
    headingBasis === undefined ||
    trimHeadingDeg === undefined ||
    trimPitchDeg === undefined
  ) {
    return undefined;
  }
  return {
    headingDeg,
    pitchDeg,
    rollDeg,
    hFovDeg,
    vFovDeg,
    headingBasis,
    trimHeadingDeg,
    trimPitchDeg,
  };
}

const TRACE_KEYS = [
  'headingSpreadDeg',
  'pitchSpreadDeg',
  'rollSpreadDeg',
  'sampleCount',
  'stillForMs',
  'compassAccuracyDeg',
  'tickCount',
  'longestTickGapMs',
] as const;

function parseTrace(p: Problems, path: string, value: unknown): CaptureTrace | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, TRACE_KEYS);
  const headingSpreadDeg = asNumber(p, `${path}.headingSpreadDeg`, obj.headingSpreadDeg, { min: 0 });
  const pitchSpreadDeg = asNumber(p, `${path}.pitchSpreadDeg`, obj.pitchSpreadDeg, { min: 0 });
  const rollSpreadDeg = asNumber(p, `${path}.rollSpreadDeg`, obj.rollSpreadDeg, { min: 0 });
  const sampleCount = asNumber(p, `${path}.sampleCount`, obj.sampleCount, { min: 1 });
  const stillForMs = asNumber(p, `${path}.stillForMs`, obj.stillForMs, { min: 0 });
  const compassAccuracyDeg = asOptionalNumber(
    p,
    `${path}.compassAccuracyDeg`,
    'compassAccuracyDeg' in obj,
    obj.compassAccuracyDeg,
    { min: 0 },
  );
  const tickCount = asOptionalNumber(p, `${path}.tickCount`, 'tickCount' in obj, obj.tickCount, {
    min: 0,
  });
  const longestTickGapMs = asOptionalNumber(
    p,
    `${path}.longestTickGapMs`,
    'longestTickGapMs' in obj,
    obj.longestTickGapMs,
    { min: 0 },
  );
  if (
    headingSpreadDeg === undefined ||
    pitchSpreadDeg === undefined ||
    rollSpreadDeg === undefined ||
    sampleCount === undefined ||
    stillForMs === undefined
  ) {
    return undefined;
  }
  return {
    headingSpreadDeg,
    pitchSpreadDeg,
    rollSpreadDeg,
    sampleCount,
    stillForMs,
    ...(compassAccuracyDeg !== undefined ? { compassAccuracyDeg } : {}),
    ...(tickCount !== undefined ? { tickCount } : {}),
    ...(longestTickGapMs !== undefined ? { longestTickGapMs } : {}),
  };
}

const TRACK_KEYS = ['width', 'height', 'frameRate', 'facingMode', 'resizeMode', 'zoom'] as const;

function parseTrack(p: Problems, path: string, value: unknown): TrackGeometry | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, TRACK_KEYS);
  const width = asNumber(p, `${path}.width`, obj.width, { min: 1 });
  const height = asNumber(p, `${path}.height`, obj.height, { min: 1 });
  const frameRate = asOptionalNumber(p, `${path}.frameRate`, 'frameRate' in obj, obj.frameRate, {
    min: 0,
  });
  const zoom = asOptionalNumber(p, `${path}.zoom`, 'zoom' in obj, obj.zoom, { min: 0 });
  const facingMode =
    'facingMode' in obj ? asString(p, `${path}.facingMode`, obj.facingMode) : undefined;
  const resizeMode =
    'resizeMode' in obj ? asString(p, `${path}.resizeMode`, obj.resizeMode) : undefined;
  if (width === undefined || height === undefined) return undefined;
  return {
    width,
    height,
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(facingMode !== undefined ? { facingMode } : {}),
    ...(resizeMode !== undefined ? { resizeMode } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

const CAPTURE_KEYS = [
  'captureId',
  'role',
  'tMs',
  'framePath',
  'framePx',
  'overlayPx',
  'pose',
  'trace',
  'track',
  'fovSource',
  'sweepRadiusKm',
  'band',
  'overlay',
  'dragAnchorSummitId',
  'movedFromCaptureId',
  'panFromReferenceDeg',
  'tiltFromReferenceDeg',
  'note',
] as const;

const FOV_SOURCES = ['calibrated', 'spec-sheet-guess'] as const;

/** A plain relative file name: no directory, no traversal, no scheme. */
const FRAME_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/;

/** Longest session the format accepts, ms. An hour is generous for 25 minutes. */
const MAX_SESSION_MS = 3_600_000;

function parseCapture(p: Problems, path: string, value: unknown): Capture | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, CAPTURE_KEYS);

  const captureId = asString(p, `${path}.captureId`, obj.captureId);
  const role = asMember(p, `${path}.role`, obj.role, CAPTURE_ROLES);
  const tMs = asNumber(p, `${path}.tMs`, obj.tMs, { min: 0, max: MAX_SESSION_MS });
  const framePath = asString(p, `${path}.framePath`, obj.framePath);
  if (framePath !== undefined && !FRAME_PATH.test(framePath)) {
    p.add(
      `${path}.framePath`,
      'expected a plain image file name beside the bundle, with no directory and no traversal',
    );
  }
  const framePx = asSize(p, `${path}.framePx`, obj.framePx);
  const overlayPx = asSize(p, `${path}.overlayPx`, obj.overlayPx);
  const pose = parsePose(p, `${path}.pose`, obj.pose);
  const trace = parseTrace(p, `${path}.trace`, obj.trace);
  const track = parseTrack(p, `${path}.track`, obj.track);
  const fovSource = asMember(p, `${path}.fovSource`, obj.fovSource, FOV_SOURCES);
  const sweepRadiusKm = asNumber(p, `${path}.sweepRadiusKm`, obj.sweepRadiusKm, {
    min: 1,
    max: 400,
  });
  const band = parseBand(p, `${path}.band`, obj.band);
  const overlay = parseOverlay(p, `${path}.overlay`, obj.overlay);

  const dragAnchorSummitId =
    'dragAnchorSummitId' in obj
      ? asString(p, `${path}.dragAnchorSummitId`, obj.dragAnchorSummitId)
      : undefined;
  const movedFromCaptureId =
    'movedFromCaptureId' in obj
      ? asString(p, `${path}.movedFromCaptureId`, obj.movedFromCaptureId)
      : undefined;
  const panFromReferenceDeg = asOptionalNumber(
    p,
    `${path}.panFromReferenceDeg`,
    'panFromReferenceDeg' in obj,
    obj.panFromReferenceDeg,
    { min: -180, max: 180 },
  );
  const tiltFromReferenceDeg = asOptionalNumber(
    p,
    `${path}.tiltFromReferenceDeg`,
    'tiltFromReferenceDeg' in obj,
    obj.tiltFromReferenceDeg,
    { min: -90, max: 90 },
  );
  const note = 'note' in obj ? asString(p, `${path}.note`, obj.note) : undefined;

  if (role === 'after-drag' && dragAnchorSummitId === undefined) {
    p.add(`${path}.dragAnchorSummitId`, 'an after-drag capture must name the summit it anchored on');
  }
  if (role === 'moved') {
    if (movedFromCaptureId === undefined) {
      p.add(`${path}.movedFromCaptureId`, 'a moved capture must name the capture it moved from');
    }
    if (panFromReferenceDeg === undefined && tiltFromReferenceDeg === undefined) {
      p.add(`${path}.panFromReferenceDeg`, 'a moved capture must record its pan or its tilt');
    }
  }

  if (
    captureId === undefined ||
    role === undefined ||
    tMs === undefined ||
    framePath === undefined ||
    framePx === undefined ||
    overlayPx === undefined ||
    pose === undefined ||
    trace === undefined ||
    track === undefined ||
    fovSource === undefined ||
    sweepRadiusKm === undefined ||
    band === undefined ||
    overlay === undefined
  ) {
    return undefined;
  }
  return {
    captureId,
    role,
    tMs,
    framePath,
    framePx,
    overlayPx,
    pose,
    trace,
    track,
    fovSource,
    sweepRadiusKm,
    band,
    overlay,
    ...(dragAnchorSummitId !== undefined ? { dragAnchorSummitId } : {}),
    ...(movedFromCaptureId !== undefined ? { movedFromCaptureId } : {}),
    ...(panFromReferenceDeg !== undefined ? { panFromReferenceDeg } : {}),
    ...(tiltFromReferenceDeg !== undefined ? { tiltFromReferenceDeg } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

const BUNDLE_KEYS = [
  'format',
  'timestampBasis',
  'device',
  'peakRegions',
  'captures',
  'note',
] as const;

/**
 * Parse a bundle, or say everything that is wrong with it.
 *
 * Every problem is collected rather than the first one thrown, because a bundle
 * arrives once, from a person who has already driven somewhere, and a parser
 * that reports one typo per run wastes the trip.
 */
export function parseFieldBundle(raw: unknown): ParseResult<FieldBundle> {
  const p = new Problems();
  for (const problem of findForbiddenContent(raw)) p.list.push(problem);

  const obj = asRecord(p, '', raw);
  if (!obj) return { ok: false, problems: p.list };
  checkKeys(p, '', obj, BUNDLE_KEYS);

  if (obj.format !== BUNDLE_FORMAT) p.add('format', `expected exactly "${BUNDLE_FORMAT}"`);
  if (obj.timestampBasis !== TIMESTAMP_BASIS) {
    p.add('timestampBasis', `expected exactly "${TIMESTAMP_BASIS}"`);
  }
  const device = asString(p, 'device', obj.device);
  const note = 'note' in obj ? asString(p, 'note', obj.note) : undefined;

  const rawRegions = asArray(p, 'peakRegions', obj.peakRegions);
  const peakRegions: string[] = [];
  rawRegions?.forEach((item, index) => {
    const region = asString(p, `peakRegions[${index}]`, item);
    if (region !== undefined) peakRegions.push(region);
  });

  const rawCaptures = asArray(p, 'captures', obj.captures);
  const captures: Capture[] = [];
  if (rawCaptures !== undefined) {
    if (rawCaptures.length === 0) p.add('captures', 'a bundle with no captures says nothing');
    const seen = new Set<string>();
    rawCaptures.forEach((item, index) => {
      const capture = parseCapture(p, `captures[${index}]`, item);
      if (!capture) return;
      if (seen.has(capture.captureId)) {
        p.add(`captures[${index}].captureId`, `${capture.captureId} is used twice`);
        return;
      }
      seen.add(capture.captureId);
      captures.push(capture);
    });
  }

  if (p.list.length > 0) return { ok: false, problems: p.list };
  if (device === undefined) {
    return { ok: false, problems: [{ path: '', message: 'incomplete bundle' }] };
  }
  return {
    ok: true,
    value: {
      format: BUNDLE_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device,
      peakRegions,
      captures,
      ...(note !== undefined ? { note } : {}),
    },
  };
}

const APEX_KEYS = ['summitId', 'apexPx', 'note'] as const;
const READING_KEYS = ['annotatorId', 'apexes'] as const;
const CAPTURE_TRUTH_KEYS = ['captureId', 'readings'] as const;
const TRUTH_KEYS = ['format', 'method', 'captures'] as const;

function parseApex(p: Problems, path: string, value: unknown): ApexAnnotation | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, APEX_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  if (!('apexPx' in obj)) {
    p.add(`${path}.apexPx`, 'required: a pixel, or null for "I cannot identify this summit"');
    return undefined;
  }
  const apexPx = obj.apexPx === null ? null : asPixelPoint(p, `${path}.apexPx`, obj.apexPx);
  const note = 'note' in obj ? asString(p, `${path}.note`, obj.note) : undefined;
  if (summitId === undefined || apexPx === undefined) return undefined;
  return { summitId, apexPx, ...(note !== undefined ? { note } : {}) };
}

/** Parse the truth document, or say everything that is wrong with it. */
export function parseFieldTruth(raw: unknown): ParseResult<FieldTruth> {
  const p = new Problems();
  for (const problem of findForbiddenContent(raw)) p.list.push(problem);

  const obj = asRecord(p, '', raw);
  if (!obj) return { ok: false, problems: p.list };
  checkKeys(p, '', obj, TRUTH_KEYS);
  if (obj.format !== TRUTH_FORMAT) p.add('format', `expected exactly "${TRUTH_FORMAT}"`);
  const method = asString(p, 'method', obj.method);

  const rawCaptures = asArray(p, 'captures', obj.captures);
  const captures: CaptureTruth[] = [];
  rawCaptures?.forEach((item, index) => {
    const path = `captures[${index}]`;
    const captureObj = asRecord(p, path, item);
    if (!captureObj) return;
    checkKeys(p, path, captureObj, CAPTURE_TRUTH_KEYS);
    const captureId = asString(p, `${path}.captureId`, captureObj.captureId);
    const rawReadings = asArray(p, `${path}.readings`, captureObj.readings);
    if (rawReadings !== undefined && rawReadings.length !== REQUIRED_ANNOTATORS) {
      p.add(
        `${path}.readings`,
        `expected exactly ${REQUIRED_ANNOTATORS} independent readings, found ${rawReadings.length}`,
      );
    }
    const readings: AnnotatorReading[] = [];
    rawReadings?.forEach((rawReading, readingIndex) => {
      const readingPath = `${path}.readings[${readingIndex}]`;
      const readingObj = asRecord(p, readingPath, rawReading);
      if (!readingObj) return;
      checkKeys(p, readingPath, readingObj, READING_KEYS);
      const annotatorId = asString(p, `${readingPath}.annotatorId`, readingObj.annotatorId);
      const rawApexes = asArray(p, `${readingPath}.apexes`, readingObj.apexes);
      const apexes: ApexAnnotation[] = [];
      rawApexes?.forEach((rawApex, apexIndex) => {
        const apex = parseApex(p, `${readingPath}.apexes[${apexIndex}]`, rawApex);
        if (apex) apexes.push(apex);
      });
      if (annotatorId === undefined) return;
      readings.push({ annotatorId, apexes });
    });
    if (captureId === undefined) return;
    if (new Set(readings.map((reading) => reading.annotatorId)).size !== readings.length) {
      p.add(`${path}.readings`, 'two readings share an annotator id, so they are not independent');
    }
    captures.push({ captureId, readings });
  });

  if (p.list.length > 0) return { ok: false, problems: p.list };
  if (method === undefined) {
    return { ok: false, problems: [{ path: '', message: 'incomplete truth document' }] };
  }
  return { ok: true, value: { format: TRUTH_FORMAT, method, captures } };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 5 — Pixels to frame angles
 * ══════════════════════════════════════════════════════════════════════════ */

const RAD_PER_DEG = Math.PI / 180;

/**
 * The angle from the optical axis of a point `offsetPx` from the frame centre.
 *
 * The pinhole relation the renderer projects with, read backwards:
 * `px = (size/2) · tan θ / tan(fov/2)`, so
 * `θ = atan( (2·offsetPx / size) · tan(fov/2) )`. Exact, not a small-angle
 * approximation, because a label near the edge of a 74° frame covers fewer
 * degrees per pixel than one in the middle and a linear scale would understate
 * an edge residual by a fifth.
 *
 * These are FRAME angles — the tangent-plane angles about the optical axis,
 * which is exactly what a drag trims. For a label far above or below the
 * horizon the horizontal frame angle differs from the difference in azimuth by
 * a factor of 1/cos(elevation); summit labels sit within a few degrees of the
 * horizon, where that factor is under 1.002.
 */
export function angularOffsetDeg(offsetPx: number, sizePx: number, fovDeg: number): number {
  if (!(sizePx > 0) || !(fovDeg > 0)) return 0;
  return Math.atan(((2 * offsetPx) / sizePx) * Math.tan((fovDeg / 2) * RAD_PER_DEG)) / RAD_PER_DEG;
}

/** Pixels per degree at the frame centre. What a reader converts a residual with. */
export function pixelsPerDegreeAtCentre(fovDeg: number, sizePx: number): number {
  if (!(fovDeg > 0) || !(sizePx > 0)) return 0;
  return ((sizePx / 2) * RAD_PER_DEG) / Math.tan((fovDeg / 2) * RAD_PER_DEG);
}

/** A signed residual on both axes, in frame angles and in stored-frame pixels. */
export interface Residual {
  readonly horizontalDeg: number;
  readonly verticalDeg: number;
  readonly horizontalPx: number;
  readonly verticalPx: number;
}

/**
 * Drawn minus truth, in frame angles.
 *
 * The overlay is drawn in the CSS viewport and the truth apex is read off the
 * stored frame, so the drawn point is scaled into the frame's space first. Both
 * spaces share the optical axis and the field of view, because the overlay box
 * is centred on the principal point (`video-box.ts`), so the scale is a plain
 * ratio of widths.
 */
export function residualOf(capture: Capture, drawn: PixelPoint, truth: PixelPoint): Residual {
  const xScale = capture.framePx.widthPx / capture.overlayPx.widthPx;
  const yScale = capture.framePx.heightPx / capture.overlayPx.heightPx;
  const drawnFrame = { xPx: drawn.xPx * xScale, yPx: drawn.yPx * yScale };
  const { widthPx, heightPx } = capture.framePx;
  const { hFovDeg, vFovDeg } = capture.pose;
  const horizontalDeg =
    angularOffsetDeg(drawnFrame.xPx - widthPx / 2, widthPx, hFovDeg) -
    angularOffsetDeg(truth.xPx - widthPx / 2, widthPx, hFovDeg);
  const verticalDeg =
    angularOffsetDeg(drawnFrame.yPx - heightPx / 2, heightPx, vFovDeg) -
    angularOffsetDeg(truth.yPx - heightPx / 2, heightPx, vFovDeg);
  return {
    horizontalDeg,
    verticalDeg,
    horizontalPx: drawnFrame.xPx - truth.xPx,
    verticalPx: drawnFrame.yPx - truth.yPx,
  };
}

/** How far into the frame a point sits: 0 at the centre, 1 at the edge. */
export function frameOffsetFraction(xPx: number, widthPx: number): number {
  if (!(widthPx > 0)) return 0;
  return Math.abs(xPx - widthPx / 2) / (widthPx / 2);
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 6 — Truth, reduced
 * ══════════════════════════════════════════════════════════════════════════ */

/** What the two annotators, together, say about one summit in one frame. */
export type SummitTruth =
  | {
      /** Both annotators found it, and they agree closely enough to grade. */
      readonly kind: 'located';
      readonly apexPx: PixelPoint;
      readonly disagreementDeg: number;
      readonly disagreementPx: number;
    }
  | {
      /** Both annotators independently say the summit is not in this frame. */
      readonly kind: 'absent';
    }
  | {
      /** They disagree, by distance or by presence. Reported, never averaged. */
      readonly kind: 'disputed';
      readonly why: string;
      readonly disagreementDeg?: number;
      readonly disagreementPx?: number;
    };

/**
 * Reduce two independent readings of one summit to one truth.
 *
 * A disagreement is never split: two annotators who disagree about whether a
 * summit is in the picture are not making a measurement with an error bar, they
 * are making two incompatible claims, and averaging them would manufacture a
 * truth neither of them reported.
 */
export function reduceTruth(
  capture: Capture,
  picks: readonly (PixelPoint | null)[],
): SummitTruth | undefined {
  if (picks.length !== REQUIRED_ANNOTATORS) return undefined;
  const [first, second] = picks;
  if (first === undefined || second === undefined) return undefined;
  if (first === null && second === null) return { kind: 'absent' };
  if (first === null || second === null) {
    return {
      kind: 'disputed',
      why: 'one annotator located the summit and the other could not identify it',
    };
  }
  const dxPx = first.xPx - second.xPx;
  const dyPx = first.yPx - second.yPx;
  const disagreementPx = Math.hypot(dxPx, dyPx);
  const { widthPx, heightPx } = capture.framePx;
  const dxDeg =
    angularOffsetDeg(first.xPx - widthPx / 2, widthPx, capture.pose.hFovDeg) -
    angularOffsetDeg(second.xPx - widthPx / 2, widthPx, capture.pose.hFovDeg);
  const dyDeg =
    angularOffsetDeg(first.yPx - heightPx / 2, heightPx, capture.pose.vFovDeg) -
    angularOffsetDeg(second.yPx - heightPx / 2, heightPx, capture.pose.vFovDeg);
  const disagreementDeg = Math.hypot(dxDeg, dyDeg);
  if (disagreementDeg > MAX_TRUTH_DISAGREEMENT_DEG) {
    return {
      kind: 'disputed',
      why: `the two apex picks are ${disagreementDeg.toFixed(3)}° apart, over the ${MAX_TRUTH_DISAGREEMENT_DEG}° limit`,
      disagreementDeg,
      disagreementPx,
    };
  }
  return {
    kind: 'located',
    apexPx: { xPx: (first.xPx + second.xPx) / 2, yPx: (first.yPx + second.yPx) / 2 },
    disagreementDeg,
    disagreementPx,
  };
}

function truthIndex(truth: FieldTruth, captureId: string): Map<string, (PixelPoint | null)[]> {
  const index = new Map<string, (PixelPoint | null)[]>();
  const entry = truth.captures.find((capture) => capture.captureId === captureId);
  if (entry === undefined) return index;
  for (const reading of entry.readings) {
    for (const apex of reading.apexes) {
      const picks = index.get(apex.summitId) ?? [];
      picks.push(apex.apexPx);
      index.set(apex.summitId, picks);
    }
  }
  return index;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7 — The verdict vocabulary
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What a criterion did.
 *
 * `no-sample` is a real outcome, not a failure: a band no summit fell into is
 * neither passed nor failed, and saying so is the honest report at this n.
 * `refused` means a precondition of the criterion was not met — an uncalibrated
 * field of view, for instance — so nothing was graded.
 */
export type Outcome = 'pass' | 'fail' | 'no-sample' | 'refused';

export interface Criterion {
  /** Stable id, e.g. `F3.far`. A script or a test can name one criterion. */
  readonly id: string;
  /** What was claimed, in one line. */
  readonly claim: string;
  readonly outcome: Outcome;
  /** How many summit-observations the criterion was graded on. */
  readonly n: number;
  /** The numbers behind the outcome. One claim per line, no coordinates. */
  readonly evidence: readonly string[];
}

/** One graded summit-observation. Carries a band label, never a distance. */
export interface GradedSummit {
  readonly captureId: string;
  readonly summitId: string;
  readonly name: string;
  readonly band: BandId;
  readonly residual: Residual;
  /** 0 at the frame centre, 1 at its edge. Separates the scale terms. */
  readonly frameOffset: number;
  readonly truthDisagreementDeg: number;
  readonly withinThreshold: boolean;
}

/** Everything a run produced, ready to print. */
export interface FieldAnalysis {
  readonly device: string;
  readonly captureCount: number;
  readonly criteria: readonly Criterion[];
  readonly graded: readonly GradedSummit[];
  /** Problems that stop a capture being graded at all. */
  readonly refusals: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 8 — Summit truth from the committed peak data
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolves a summit id against the committed peak data.
 *
 * The bundle is written by the device under test, so its own account of a
 * summit's identity and height cannot grade itself. `scripts/analyze-field.ts`
 * builds this from `fixtures/peaks/`; a test builds it from a literal.
 */
export type PeakLookup = (summitId: string) => Peak | undefined;

/**
 * Check the drawn summits against the committed peak data.
 *
 * Only the drawn ones. A withheld summit was never named to the user, so a
 * disagreement about its height claims nothing.
 */
function provenanceProblems(capture: Capture, peaks: PeakLookup): readonly string[] {
  const problems: string[] = [];
  for (const summit of capture.overlay.drawn) {
    const peak = peaks(summit.summitId);
    if (peak === undefined) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} (${summit.name}) is not in the committed peak data`,
      );
      continue;
    }
    if (peak.name !== summit.name) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} is drawn as "${summit.name}" and committed as "${peak.name}"`,
      );
    }
    const gapM = Math.abs(peak.elevationM - summit.elevationM);
    if (gapM > MAX_ELEVATION_DISAGREEMENT_M) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} is drawn at ${summit.elevationM} m and committed at ${peak.elevationM} m, ${gapM.toFixed(0)} m apart`,
      );
    }
  }
  return problems;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 9 — The criteria
 * ══════════════════════════════════════════════════════════════════════════ */

function isGradable(capture: Capture): string | undefined {
  if (capture.fovSource !== 'calibrated') {
    return `${capture.captureId}: the field of view is a spec-sheet guess, so the scale term is unquantified and the capture is not graded (pre-registration § 1.3 term 6)`;
  }
  return undefined;
}

function frameDeviation(capture: Capture): string | undefined {
  const hFovOff = Math.abs(capture.pose.hFovDeg - REGISTERED_FRAME.hFovDeg) / REGISTERED_FRAME.hFovDeg;
  const aspect = capture.overlayPx.widthPx / capture.overlayPx.heightPx;
  const aspectOff = Math.abs(aspect - REGISTERED_FRAME.aspectRatio) / REGISTERED_FRAME.aspectRatio;
  if (hFovOff <= FRAME_DEVIATION_TOLERANCE && aspectOff <= FRAME_DEVIATION_TOLERANCE) {
    return undefined;
  }
  return `${capture.captureId}: frame geometry is ${(hFovOff * 100).toFixed(1)}% off the registered hFOV and ${(aspectOff * 100).toFixed(1)}% off its aspect, so the roll and scale terms were budgeted on a different frame`;
}

interface Observation {
  readonly capture: Capture;
  readonly summit: DrawnSummit;
  readonly truth: SummitTruth;
}

function observationsOf(
  captures: readonly Capture[],
  truth: FieldTruth,
): readonly Observation[] {
  const out: Observation[] = [];
  for (const capture of captures) {
    const index = truthIndex(truth, capture.captureId);
    for (const summit of capture.overlay.drawn) {
      const picks = index.get(summit.summitId);
      if (picks === undefined) continue;
      const reduced = reduceTruth(capture, picks);
      if (reduced === undefined) continue;
      out.push({ capture, summit, truth: reduced });
    }
  }
  return out;
}

/**
 * F2 — the raw error is a measurement, gated only on the displayed band.
 *
 * An axis whose band carries an unquantified term is a FLOOR, which the screen
 * already says, and a floor cannot be exceeded. Such an axis is recorded and
 * not gated, which is a pass for F2 and an open item in the report.
 */
function gradeF2(observations: readonly Observation[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let outside = 0;
  let notGated = 0;

  for (const { capture, summit, truth } of observations) {
    if (capture.role !== 'before-drag') continue;
    if (truth.kind !== 'located') continue;
    graded += 1;
    const residual = residualOf(capture, summit.summitPx, truth.apexPx);
    const band = capture.band;
    const axes: readonly {
      readonly name: string;
      readonly errorDeg: number;
      readonly bandDeg: number;
      readonly floor: boolean;
    }[] = [
      {
        name: 'across',
        errorDeg: Math.abs(residual.horizontalDeg),
        bandDeg: band.horizontalDeg,
        floor: band.hasUnquantifiedHorizontal,
      },
      {
        name: 'up/down',
        errorDeg: Math.abs(residual.verticalDeg),
        bandDeg: band.verticalDeg,
        floor: band.hasUnquantifiedVertical,
      },
    ];
    for (const axis of axes) {
      if (axis.floor) {
        notGated += 1;
        evidence.push(
          `${capture.captureId} ${summit.name} ${axis.name}: raw ${axis.errorDeg.toFixed(3)}° against a band of ${axis.bandDeg.toFixed(3)}° that carries an unquantified term — recorded, not gated`,
        );
        continue;
      }
      const inside = axis.errorDeg <= axis.bandDeg;
      if (!inside) outside += 1;
      evidence.push(
        `${capture.captureId} ${summit.name} ${axis.name}: raw ${axis.errorDeg.toFixed(3)}° against a band of ${axis.bandDeg.toFixed(3)}° — ${inside ? 'inside' : 'OUTSIDE'}`,
      );
    }
  }

  const claim = 'the band the app displays contains the error the app is making';
  if (graded === 0) {
    return {
      id: 'F2',
      claim,
      outcome: 'no-sample',
      n: 0,
      evidence: ['no before-drag capture carried a located summit'],
    };
  }
  return {
    id: 'F2',
    claim,
    outcome: outside === 0 ? 'pass' : 'fail',
    n: graded,
    evidence: [
      `${graded} summit-observation(s); ${outside} outside a band that carried only measured terms; ${notGated} axis-observation(s) recorded but not gated`,
      ...evidence,
    ],
  };
}

function gradePositional(
  id: string,
  claim: string,
  observations: readonly Observation[],
  select: (capture: Capture) => boolean,
): readonly Criterion[] {
  const rows: GradedSummit[] = [];
  const disputed: string[] = [];

  for (const { capture, summit, truth } of observations) {
    if (!select(capture)) continue;
    if (truth.kind === 'disputed') {
      disputed.push(`${capture.captureId} ${summit.name}: truth disputed — ${truth.why}`);
      continue;
    }
    if (truth.kind !== 'located') continue;
    const threshold = bandFor(summit.distanceKm);
    if (threshold === undefined) continue;
    const residual = residualOf(capture, summit.summitPx, truth.apexPx);
    rows.push({
      captureId: capture.captureId,
      summitId: summit.summitId,
      name: summit.name,
      band: threshold.band,
      residual,
      frameOffset: frameOffsetFraction(truth.apexPx.xPx, capture.framePx.widthPx),
      truthDisagreementDeg: truth.disagreementDeg,
      withinThreshold: withinThreshold(residual, threshold),
    });
  }

  const criteria: Criterion[] = PREREGISTERED_THRESHOLDS.map((threshold) => {
    const band = rows.filter((row) => row.band === threshold.band);
    const failures = band.filter((row) => !row.withinThreshold);
    const evidence = band.map(
      (row) =>
        `${row.captureId} ${row.name}: ${Math.abs(row.residual.horizontalDeg).toFixed(3)}° across (limit ${threshold.horizontalDeg}°), ${Math.abs(row.residual.verticalDeg).toFixed(3)}° up/down (limit ${threshold.verticalDeg}°), at ${(row.frameOffset * 100).toFixed(0)}% of the half-frame, truth ±${row.truthDisagreementDeg.toFixed(3)}°${row.withinThreshold ? '' : ' — OUTSIDE'}`,
    );
    return {
      id: `${id}.${threshold.band}`,
      claim: `${claim} (${threshold.band}: ${threshold.fromKm}${Number.isFinite(threshold.toKm) ? `–${threshold.toKm}` : '+'} km)`,
      outcome: band.length === 0 ? 'no-sample' : failures.length === 0 ? 'pass' : 'fail',
      n: band.length,
      evidence:
        band.length === 0
          ? ['no graded summit fell in this band']
          : [
              band.length === 1 ? 'n = 1' : `n = ${band.length}`,
              ...evidence,
            ],
    };
  });

  if (disputed.length > 0) {
    criteria.push({
      id: `${id}.truth-disputed`,
      claim: 'summits the two annotators did not agree on, excluded from grading',
      outcome: 'no-sample',
      n: disputed.length,
      evidence: disputed,
    });
  }
  return criteria;
}

function gradeF4Envelope(captures: readonly Capture[]): readonly string[] {
  const problems: string[] = [];
  for (const capture of captures) {
    if (capture.role !== 'moved') continue;
    const pan = capture.panFromReferenceDeg;
    const tilt = capture.tiltFromReferenceDeg;
    if (pan !== undefined && pan !== 0) {
      const size = Math.abs(pan);
      if (size < PAN_ENVELOPE_DEG.min || size > PAN_ENVELOPE_DEG.max) {
        problems.push(
          `${capture.captureId}: panned ${size.toFixed(1)}°, outside the registered ${PAN_ENVELOPE_DEG.min}–${PAN_ENVELOPE_DEG.max}° envelope`,
        );
      }
    }
    if (tilt !== undefined && tilt !== 0) {
      const size = Math.abs(tilt);
      if (size < TILT_ENVELOPE_DEG.min || size > TILT_ENVELOPE_DEG.max) {
        problems.push(
          `${capture.captureId}: tilted ${size.toFixed(1)}°, outside the registered ${TILT_ENVELOPE_DEG.min}–${TILT_ENVELOPE_DEG.max}° envelope`,
        );
      }
    }
  }
  return problems;
}

/** F5a — a summit drawn `visible` that both annotators say is not there. */
function gradeF5a(observations: readonly Observation[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let falseVisible = 0;

  for (const { capture, summit, truth } of observations) {
    if (summit.visibility !== 'visible') continue;
    graded += 1;
    if (truth.kind === 'absent') {
      falseVisible += 1;
      evidence.push(
        `${capture.captureId} ${summit.name}: drawn visible, and both annotators say it is not in the frame — FALSE VISIBLE`,
      );
    } else if (truth.kind === 'disputed') {
      evidence.push(
        `${capture.captureId} ${summit.name}: drawn visible, truth disputed — ${truth.why}; counted in neither direction`,
      );
    }
  }

  return {
    id: 'F5a',
    claim: 'no summit is drawn `visible` that is not in the picture',
    outcome: graded === 0 ? 'no-sample' : falseVisible === 0 ? 'pass' : 'fail',
    n: graded,
    evidence:
      graded === 0
        ? ['no summit was drawn visible in any capture']
        : [`${graded} summit(s) drawn visible; ${falseVisible} false`, ...evidence],
  };
}

/** F5b — the three most prominent predicted summits each carry a name. */
function gradeF5b(captures: readonly Capture[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let failures = 0;

  for (const capture of captures) {
    const ranked = [...capture.overlay.drawn].sort(
      (a, b) =>
        b.altitudeDeg - a.altitudeDeg ||
        b.elevationM - a.elevationM ||
        (a.summitId < b.summitId ? -1 : a.summitId > b.summitId ? 1 : 0),
    );
    const top = ranked.slice(0, PROMINENT_LABEL_COUNT);
    if (top.length < PROMINENT_LABEL_COUNT) {
      evidence.push(
        `${capture.captureId}: only ${top.length} summit(s) predicted in frame, fewer than the ${PROMINENT_LABEL_COUNT} the criterion ranks`,
      );
      continue;
    }
    graded += 1;
    const unnamed = top.filter((summit) => !summit.labelled);
    if (unnamed.length > 0) failures += 1;
    // The apparent height itself is not printed: with a committed summit height
    // it gives the distance, and three distances to named summits are a fix.
    evidence.push(
      `${capture.captureId}: top ${PROMINENT_LABEL_COUNT} by apparent height are ${top.map((summit) => `${summit.name}${summit.labelled ? '' : ' (UNNAMED)'}`).join(', ')}`,
    );
  }

  return {
    id: 'F5b',
    claim: `the ${PROMINENT_LABEL_COUNT} most prominent predicted summits each carry a name`,
    outcome: graded === 0 ? 'no-sample' : failures === 0 ? 'pass' : 'fail',
    n: graded,
    evidence: graded === 0 ? evidence : [`${graded} capture(s); ${failures} failing`, ...evidence],
  };
}

/** F5c — every summit beyond the swept terrain is `unmeasured` and undrawn. */
function gradeF5c(captures: readonly Capture[]): Criterion {
  const evidence: string[] = [];
  let failures = 0;

  for (const capture of captures) {
    for (const summit of capture.overlay.drawn) {
      if (summit.distanceKm > capture.sweepRadiusKm) {
        failures += 1;
        evidence.push(
          `${capture.captureId} ${summit.name}: drawn with a verdict from beyond the swept terrain — FABRICATED`,
        );
      }
    }
    const beyond = capture.overlay.withheld.filter(
      (summit) => summit.distanceKm > capture.sweepRadiusKm,
    );
    for (const summit of beyond) {
      if (summit.reason !== 'unmeasured') {
        failures += 1;
        evidence.push(
          `${capture.captureId} ${summit.name}: beyond the swept terrain but withheld as "${summit.reason}" rather than unmeasured`,
        );
      }
    }
    evidence.push(
      `${capture.captureId}: ${beyond.length} summit(s) beyond the sweep, ${beyond.filter((summit) => summit.reason === 'unmeasured').length} reported unmeasured`,
    );
  }

  return {
    id: 'F5c',
    claim: 'every summit beyond the swept terrain is reported unmeasured and drawn nowhere',
    outcome: captures.length === 0 ? 'no-sample' : failures === 0 ? 'pass' : 'fail',
    n: captures.length,
    evidence,
  };
}

/**
 * Grade a run against the pre-registered criteria.
 *
 * F1 and F6 are stopwatch numbers recorded by the person on site and are not
 * computed here.
 */
export function analyseFieldRun(
  bundle: FieldBundle,
  truth: FieldTruth,
  peaks: PeakLookup,
): FieldAnalysis {
  const refusals: string[] = [];
  const gradable: Capture[] = [];
  for (const capture of bundle.captures) {
    const refusal = isGradable(capture);
    if (refusal !== undefined) {
      refusals.push(refusal);
      continue;
    }
    const deviation = frameDeviation(capture);
    if (deviation !== undefined) refusals.push(deviation);
    refusals.push(...provenanceProblems(capture, peaks));
    gradable.push(capture);
  }

  const observations = observationsOf(gradable, truth);
  const criteria: Criterion[] = [
    gradeF2(observations),
    ...gradePositional(
      'F3',
      'after one drag, every labelled summit sits within the budget',
      observations,
      (capture) => capture.role === 'after-drag',
    ),
    ...gradePositional(
      'F4',
      'the drag holds after a pan and a tilt',
      observations,
      (capture) => capture.role === 'moved',
    ),
    gradeF5a(observations),
    gradeF5b(gradable),
    gradeF5c(gradable),
  ];

  const envelope = gradeF4Envelope(gradable);
  if (envelope.length > 0) {
    criteria.push({
      id: 'F4.envelope',
      claim: 'the movements performed were the registered ±20° pan and ±10° tilt',
      outcome: 'fail',
      n: envelope.length,
      evidence: envelope,
    });
  }

  const graded: GradedSummit[] = [];
  for (const { capture, summit, truth: reduced } of observations) {
    if (capture.role === 'before-drag' || reduced.kind !== 'located') continue;
    const threshold = bandFor(summit.distanceKm);
    if (threshold === undefined) continue;
    const residual = residualOf(capture, summit.summitPx, reduced.apexPx);
    graded.push({
      captureId: capture.captureId,
      summitId: summit.summitId,
      name: summit.name,
      band: threshold.band,
      residual,
      frameOffset: frameOffsetFraction(reduced.apexPx.xPx, capture.framePx.widthPx),
      truthDisagreementDeg: reduced.disagreementDeg,
      withinThreshold: withinThreshold(residual, threshold),
    });
  }

  return {
    device: bundle.device,
    captureCount: bundle.captures.length,
    criteria,
    graded,
    refusals,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 10 — Reporting, with no coordinates in it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Render the analysis as lines of text.
 *
 * Nothing here prints a distance or a bearing. A distance and a bearing to a
 * named summit is a position fix, and a report is the artefact most likely to be
 * pasted somewhere. Bands are named, not measured, and a test asserts the
 * rendered lines hold no distance.
 */
export function renderFieldReport(analysis: FieldAnalysis, options: { brief?: boolean } = {}): readonly string[] {
  const lines: string[] = [];
  lines.push(`device:   ${analysis.device}`);
  lines.push(`captures: ${analysis.captureCount}`);
  lines.push(`graded:   ${analysis.graded.length} summit-observation(s)`);
  if (analysis.refusals.length > 0) {
    lines.push('');
    lines.push('not graded:');
    for (const refusal of analysis.refusals) lines.push(`  ! ${refusal}`);
  }
  lines.push('');

  const widths = {
    id: Math.max(8, ...analysis.criteria.map((criterion) => criterion.id.length)),
    outcome: Math.max(7, ...analysis.criteria.map((criterion) => criterion.outcome.length)),
  };
  lines.push(`${'criterion'.padEnd(widths.id)}  ${'outcome'.padEnd(widths.outcome)}  n`);
  lines.push(`${'─'.repeat(widths.id)}  ${'─'.repeat(widths.outcome)}  ─`);
  for (const criterion of analysis.criteria) {
    lines.push(
      `${criterion.id.padEnd(widths.id)}  ${criterion.outcome.padEnd(widths.outcome)}  ${criterion.n}`,
    );
  }

  if (options.brief !== true) {
    for (const criterion of analysis.criteria) {
      lines.push('');
      lines.push(`${criterion.id} — ${criterion.claim}`);
      lines.push(`  outcome: ${criterion.outcome}  [n = ${criterion.n}]`);
      for (const line of criterion.evidence) lines.push(`  · ${line}`);
    }
  }

  const failed = analysis.criteria.filter((criterion) => criterion.outcome === 'fail');
  const noSample = analysis.criteria.filter((criterion) => criterion.outcome === 'no-sample');
  lines.push('');
  lines.push(
    `${analysis.criteria.length - failed.length - noSample.length} passed, ${failed.length} failed, ${noSample.length} without a sample` +
      (failed.length === 0 ? '' : `; failing: ${failed.map((criterion) => criterion.id).join(', ')}`),
  );
  lines.push(
    'A pass means nothing here contradicts the error budget at this n. One site, one session, one phone.',
  );
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 11 — The synthesiser
 * ══════════════════════════════════════════════════════════════════════════ */

/** One summit in a synthetic capture, with its error injected in pixels. */
export interface SynthSummit {
  readonly summitId: string;
  readonly name: string;
  readonly elevationM: number;
  readonly distanceKm: number;
  readonly altitudeDeg: number;
  /** Where the two annotators put the apex, in stored-frame pixels. */
  readonly truthPx: PixelPoint;
  /** The drawn marker's displacement from the truth, in stored-frame pixels. */
  readonly errorPx: PixelPoint;
  readonly visibility?: 'visible' | 'marginal' | 'self-occluded';
  readonly labelled?: boolean;
  /** How far the second annotator's pick sits from the first's, pixels. */
  readonly annotatorSplitPx?: PixelPoint;
  /** Both annotators report the summit absent, whatever it is drawn as. */
  readonly truthAbsent?: boolean;
  /** Only the first annotator finds it, which makes the truth disputed. */
  readonly truthOnlyFirst?: boolean;
}

export interface SynthCapture {
  readonly captureId: string;
  readonly role: CaptureRole;
  readonly summits: readonly SynthSummit[];
  readonly withheld?: readonly WithheldSummit[];
  readonly sweepRadiusKm?: number;
  readonly fovSource?: 'calibrated' | 'spec-sheet-guess';
  readonly band?: DisplayedBand;
  readonly panFromReferenceDeg?: number;
  readonly tiltFromReferenceDeg?: number;
  readonly framePx?: { readonly widthPx: number; readonly heightPx: number };
  readonly overlayPx?: { readonly widthPx: number; readonly heightPx: number };
  readonly hFovDeg?: number;
  readonly vFovDeg?: number;
}

export interface SynthSpec {
  readonly device?: string;
  readonly captures: readonly SynthCapture[];
}

/** The registered frame geometry, as a synthesiser default. */
const SYNTH_FRAME = { widthPx: 1920, heightPx: 884 } as const;
const SYNTH_OVERLAY = { widthPx: 956, heightPx: 440 } as const;
const SYNTH_HFOV = 73.74;
const SYNTH_VFOV = 38.088;

/**
 * Build a bundle and its truth document from injected pixel errors.
 *
 * It does no angle arithmetic at all: a truth apex is a pixel, the drawn marker
 * is that pixel plus a stated offset, and the expected residual in degrees is
 * written out as a literal in the test from the tangent relation. So the grader
 * is never graded against its own conversion.
 */
export function synthesiseFieldBundle(spec: SynthSpec): {
  readonly bundle: FieldBundle;
  readonly truth: FieldTruth;
} {
  const captures: Capture[] = [];
  const truthCaptures: CaptureTruth[] = [];

  spec.captures.forEach((synth, index) => {
    const framePx = synth.framePx ?? SYNTH_FRAME;
    const overlayPx = synth.overlayPx ?? SYNTH_OVERLAY;
    const xScale = overlayPx.widthPx / framePx.widthPx;
    const yScale = overlayPx.heightPx / framePx.heightPx;

    const drawn: DrawnSummit[] = synth.summits.map((summit) => ({
      summitId: summit.summitId,
      name: summit.name,
      elevationM: summit.elevationM,
      distanceKm: summit.distanceKm,
      altitudeDeg: summit.altitudeDeg,
      visibility: summit.visibility ?? 'visible',
      summitPx: {
        xPx: (summit.truthPx.xPx + summit.errorPx.xPx) * xScale,
        yPx: (summit.truthPx.yPx + summit.errorPx.yPx) * yScale,
      },
      labelled: summit.labelled ?? true,
    }));

    const first: ApexAnnotation[] = [];
    const second: ApexAnnotation[] = [];
    for (const summit of synth.summits) {
      if (summit.truthAbsent === true) {
        first.push({ summitId: summit.summitId, apexPx: null });
        second.push({ summitId: summit.summitId, apexPx: null });
        continue;
      }
      const split = summit.annotatorSplitPx ?? { xPx: 0, yPx: 0 };
      // The two picks straddle the truth, so their midpoint is the truth exactly.
      first.push({
        summitId: summit.summitId,
        apexPx: {
          xPx: summit.truthPx.xPx - split.xPx / 2,
          yPx: summit.truthPx.yPx - split.yPx / 2,
        },
      });
      second.push({
        summitId: summit.summitId,
        apexPx:
          summit.truthOnlyFirst === true
            ? null
            : {
                xPx: summit.truthPx.xPx + split.xPx / 2,
                yPx: summit.truthPx.yPx + split.yPx / 2,
              },
      });
    }

    captures.push({
      captureId: synth.captureId,
      role: synth.role,
      tMs: (index + 1) * 60_000,
      framePath: `f${index + 1}.jpg`,
      framePx,
      overlayPx,
      pose: {
        headingDeg: 280,
        pitchDeg: 0.5,
        rollDeg: 0,
        hFovDeg: synth.hFovDeg ?? SYNTH_HFOV,
        vFovDeg: synth.vFovDeg ?? SYNTH_VFOV,
        headingBasis: 'true-model',
        trimHeadingDeg: synth.role === 'before-drag' ? 0 : -1.25,
        trimPitchDeg: synth.role === 'before-drag' ? 0 : 0.4,
      },
      trace: {
        headingSpreadDeg: 0.2,
        pitchSpreadDeg: 0.15,
        rollSpreadDeg: 0.3,
        sampleCount: 40,
        stillForMs: 2400,
        compassAccuracyDeg: 8,
        tickCount: 22,
        longestTickGapMs: 90,
      },
      track: { width: framePx.widthPx, height: framePx.heightPx, frameRate: 30, facingMode: 'environment' },
      fovSource: synth.fovSource ?? 'calibrated',
      sweepRadiusKm: synth.sweepRadiusKm ?? 60,
      band: synth.band ?? {
        horizontalDeg: 8.5,
        verticalDeg: 0.15,
        hasUnquantifiedHorizontal: false,
        hasUnquantifiedVertical: false,
      },
      overlay: { drawn, withheld: synth.withheld ?? [] },
      ...(synth.role === 'before-drag' ? {} : { dragAnchorSummitId: synth.summits[0]?.summitId ?? 'none' }),
      ...(synth.role === 'moved' ? { movedFromCaptureId: 'c2' } : {}),
      ...(synth.panFromReferenceDeg !== undefined
        ? { panFromReferenceDeg: synth.panFromReferenceDeg }
        : {}),
      ...(synth.tiltFromReferenceDeg !== undefined
        ? { tiltFromReferenceDeg: synth.tiltFromReferenceDeg }
        : {}),
    });

    truthCaptures.push({
      captureId: synth.captureId,
      readings: [
        { annotatorId: 'agent-a', apexes: first },
        { annotatorId: 'agent-b', apexes: second },
      ],
    });
  });

  return {
    bundle: {
      format: BUNDLE_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device: spec.device ?? 'synthetic/not-a-real-browser',
      peakRegions: ['idaho-bogus-basin'],
      captures,
    },
    truth: {
      format: TRUTH_FORMAT,
      method:
        'Synthetic. Apex pixels were placed, not read; the two readings straddle the placed pixel so their midpoint is it exactly.',
      captures: truthCaptures,
    },
  };
}
