/**
 * The field session, as a script a person on a ridge can follow — and the
 * builder that turns one moment of the live screen into a bundle capture.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * `docs/FIELD-TEST-PREREGISTRATION.md` § 2.7 lists the steps of one field
 * session, and `src/live/field-analysis.ts` defines the bundle those steps have
 * to produce. This module is what sits between them: the steps in plain words,
 * and a pure function per capture that emits exactly the shape the bundle
 * parser accepts.
 *
 * It is pure. No DOM, no camera, no clock, no network. `FieldSessionPanel.tsx`
 * drives it, `field-share.ts` gets the result off the phone, and the parser in
 * `field-analysis.ts` is the contract both of them answer to.
 *
 * ── WHY EVERY FIELD IS PICKED OUT BY HAND ──────────────────────────────────
 * Nothing here spreads an object into the bundle. The overlay's own peaks carry
 * `bearingDeg`, and a bearing to a named summit with its distance is a position
 * fix; the camera track carries `deviceId` and `label`, which identify one
 * handset. The parser refuses all four, so a spread would fail on the phone
 * after the drive rather than here. Listing each field instead means a new field
 * on an upstream type cannot arrive in the bundle by itself.
 *
 * ── WHAT A CAPTURE MAY SAY ABOUT THE FIX ───────────────────────────────────
 * One number: `horizontalAccuracyM`, under the bundle's declared
 * `accuracyConvention`. A radius says how well the phone knew where it was and
 * never where that was. Timestamps are milliseconds from the start of the
 * session, because a wall clock dates a session as precisely as a coordinate
 * places it.
 *
 * ── THE FRAME IS A FILE, NOT BYTES ─────────────────────────────────────────
 * A capture names its camera frame by a bare file name beside the bundle. The
 * frame is stored at the video track's own width, which the pre-registration
 * registers at {@link MIN_STORED_FRAME_WIDTH_PX} or more: truth is a pixel
 * picked by two people, and at 1920 px a 5 px disagreement is 0.22° where at the
 * CSS viewport's 956 px it would be 0.45°.
 */

import type { CameraPose } from '../../core/types';
import type { OverlayLayout, OverlayPeak } from '../../render/types';
import type { PoseUncertainty } from '../uncertainty';
import {
  frameAngleDeg,
  MAX_REGISTERED_PAN_DEG,
  PAN_ANCHOR_EDGE_OFFSET,
  REGISTERED_STORED_FRAME,
  TILT_ENVELOPE_DEG,
  BUNDLE_FORMAT,
  TIMESTAMP_BASIS,
  ACCURACY_CONFIDENCE,
  MAX_OBSERVER_ACCURACY_M,
  type Capture,
  type CapturePose,
  type CaptureRole,
  type CaptureTrace,
  type DisplayedBand,
  type DrawnOverlay,
  type DrawnSummit,
  type FieldBundle,
  type GrossHeadingSource,
  type TrackGeometry,
  type WithheldSummit,
} from '../../live/field-analysis';
import { angularSpreadDeg } from './drag-trial';
import type { TrackSettingsLike } from './lens-log';

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — Getting into the mode
 * ══════════════════════════════════════════════════════════════════════════ */

/** Query flag that turns `live.html` into the guided field session. */
export const FIELD_SESSION_QUERY = 'session';
export const FIELD_SESSION_VALUE = 'field';

/**
 * Is this page being opened for the field session?
 *
 * A query flag rather than a second HTML entry, for the same reason the home
 * session uses one: the session needs this screen's camera, sensors and overlay,
 * and a person on a ridge is given one address to open.
 */
export function isFieldSessionRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get(FIELD_SESSION_QUERY) === FIELD_SESSION_VALUE;
  } catch {
    return false;
  }
}

/**
 * What the screen says before anything is captured.
 *
 * Shown before the first capture, because consent to a capture is only consent
 * if it is given before the capture. The photograph line is the one the home
 * session does not need: a field capture stores the camera frame, and a frame of
 * a skyline shows where it was taken to anyone who knows the skyline.
 */
export const FIELD_SESSION_PRIVACY_STATEMENT: readonly string[] = [
  'This saves photographs from the camera — one for each capture you take — together with the labels the app drew over them and what the phone’s sensors said at that moment.',
  'A photograph of a view shows where it was taken. Anyone who knows those mountains can work out roughly where you stood, so treat these pictures the way you would treat any photograph of your own location.',
  'The file beside the photographs holds no location, no compass bearing to any summit, no date and no time of day, and nothing that names this phone. Times in it are counted from when you tapped Start.',
  'It does keep one number about your position: how accurate the phone says its own fix is, in metres. That says how well the phone knew where it was, never where that was.',
  'Nothing is uploaded. Everything stays on this phone until you tap Share at the end, and then it goes only where you send it.',
];

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — The script
 * ══════════════════════════════════════════════════════════════════════════ */

/** How long a braced hold runs before a capture, milliseconds (term 8). */
export const BRACE_HOLD_MS = 2000;

/** How many times the drag onto the same summit is repeated (§ 2.7 step 10). */
export const REPEATED_DRAG_COUNT = 3;

/**
 * Smallest stored frame width the pre-registration accepts, pixels (§ 2.0).
 *
 * Read from `field-analysis.ts`'s registration rather than written again here.
 * The parser refuses a narrower frame on the same figure, so a second copy
 * would let the screen accept a capture the bundle then rejects.
 */
export const MIN_STORED_FRAME_WIDTH_PX = REGISTERED_STORED_FRAME.minWidthPx;

/** The tilt the person is asked for. The graded envelope is 5–15°. */
export const TILT_TARGET_DEG = 10;

/** What the person is doing during a step, which decides what the screen shows. */
export type FieldStepKind = 'read' | 'tap' | 'brace' | 'capture' | 'drag' | 'pan' | 'tilt';

export interface FieldStep {
  readonly id: string;
  /** Two or three words for the progress line. */
  readonly title: string;
  /** One plain sentence of what to do. No jargon, no explanation. */
  readonly instruction: string;
  readonly kind: FieldStepKind;
  /** The role a capture taken on this step carries. Absent on every other kind. */
  readonly role?: CaptureRole;
  /** Which edge the anchor must reach. Pan steps only. */
  readonly edge?: 'left' | 'right';
  /** Which way the phone is tipped. Tilt steps only. */
  readonly tilt?: 'up' | 'down';
}

/**
 * The steps, in the order § 2.7 runs them.
 *
 * Written for someone standing on a ridge holding a phone. What each step PROVES
 * is in the pre-registration and is deliberately not on screen: a person at arm's
 * length cannot act on it, and the screen room goes to the instruction.
 *
 * The three repeated drags are one step repeated rather than three entries, so
 * the count lives in {@link REPEATED_DRAG_COUNT} alone.
 */
export const FIELD_SESSION_STEPS: readonly FieldStep[] = [
  {
    id: 'stand',
    title: 'Where to stand',
    instruction:
      'Stand within a couple of hundred metres of the marked spot. Further than that and the app is working from ground it did not measure.',
    kind: 'read',
  },
  {
    id: 'fov-check',
    title: 'Check the camera width',
    instruction:
      'Point the camera so the sun, or a summit the app has labelled, is near the left edge and tap the middle of the real one. Then turn until it is near the right edge and tap it again.',
    kind: 'tap',
  },
  {
    id: 'fix-direction',
    title: 'Check which way the labels point',
    instruction:
      'If the labels point the wrong way, tap Fix direction — tap the sun, or pick a summit you know by name and tap it. Otherwise carry on.',
    kind: 'read',
  },
  {
    id: 'fix',
    title: 'Wait for the location',
    instruction:
      'Stand still until the phone says it knows where it is to better than 30 metres. If it will not settle, wait a minute and try again.',
    kind: 'read',
  },
  {
    id: 'brace',
    title: 'Brace the phone',
    instruction:
      'Hold the phone in both hands with your elbows on a rail, a rock or your knee, point it at the view, and keep it still until the bar fills.',
    kind: 'brace',
  },
  {
    id: 'capture-raw',
    title: 'Capture as it is',
    instruction:
      'Without touching the labels, tap Capture raw. This is the picture of what the app got right or wrong on its own.',
    kind: 'capture',
    role: 'before-drag',
  },
  {
    id: 'drag',
    title: 'Line one label up',
    instruction:
      'Pick the one summit you are certain of, and drag its label onto it with your finger. Fine drag is on, so the labels move slowly.',
    kind: 'drag',
  },
  {
    id: 'capture-drag',
    title: 'Capture after the drag',
    instruction: 'Hold the phone still again, then tap Capture after drag.',
    kind: 'capture',
    role: 'after-drag',
  },
  {
    id: 'pan-left',
    title: 'Turn to the left edge',
    instruction:
      'Without touching the labels again, turn slowly to your right until that same summit slides over to the LEFT edge of the picture. The screen says when it is far enough. Hold still, then capture.',
    kind: 'pan',
    role: 'moved',
    edge: 'left',
  },
  {
    id: 'pan-right',
    title: 'Turn to the right edge',
    instruction:
      'Now turn the other way, past the middle, until that summit sits near the RIGHT edge instead. Hold still, then capture.',
    kind: 'pan',
    role: 'moved',
    edge: 'right',
  },
  {
    id: 'tilt-up',
    title: 'Tip up',
    instruction:
      'Point at the view again. Still without touching the labels, tip the top of the phone back about ten degrees, hold still, then capture.',
    kind: 'tilt',
    role: 'moved',
    tilt: 'up',
  },
  {
    id: 'tilt-down',
    title: 'Tip down',
    instruction:
      'Now tip it about ten degrees the other way, so it points a little below the view. Hold still, then capture.',
    kind: 'tilt',
    role: 'moved',
    tilt: 'down',
  },
  {
    id: 'face-north-east',
    title: 'Turn to the north-east',
    instruction:
      'Turn to your left until you face north-east, toward the far high mountains. Do not touch the labels on the way round.',
    kind: 'read',
  },
  {
    id: 'capture-north-east',
    title: 'Capture the far mountains',
    instruction:
      'Keep the phone braced and level, hold still, then capture. Make sure nobody is in the picture.',
    kind: 'capture',
    role: 'turned',
  },
  {
    id: 'capture-north-east-again',
    title: 'And once more',
    instruction:
      'Without dragging anything, hold still and capture the same view a second time.',
    kind: 'capture',
    role: 'turned',
  },
];

/** The step ids, so a caller can name one without indexing the array. */
export const FIELD_STEP_IDS = FIELD_SESSION_STEPS.map((step) => step.id);

function stepById(id: string): FieldStep {
  const found = FIELD_SESSION_STEPS.find((step) => step.id === id);
  if (found === undefined) throw new Error(`no field step with id ${id}`);
  return found;
}

/** One entry of the run: a step, and which repeat of it this is. */
export interface FieldRunStep {
  readonly step: FieldStep;
  /** 1-based, for the drag and its capture. 0 for every other step. */
  readonly repeat: number;
}

/**
 * The steps as they are actually walked, with the repeats spelled out.
 *
 * § 2.7 runs the drag once, moves the phone twice from that capture, and only
 * then repeats the drag so its spread is recorded (§ 1.6). The pan and the tilt
 * therefore sit between repeat 1 and repeat 2, which is why the plan is built
 * here rather than read off {@link FIELD_SESSION_STEPS} in order.
 */
export function fieldRunPlan(): readonly FieldRunStep[] {
  const plain = (id: string): FieldRunStep => ({ step: stepById(id), repeat: 0 });
  const dragPair = (repeat: number): readonly FieldRunStep[] => [
    { step: stepById('drag'), repeat },
    { step: stepById('capture-drag'), repeat },
  ];
  return [
    plain('stand'),
    plain('fov-check'),
    plain('fix-direction'),
    plain('fix'),
    plain('brace'),
    plain('capture-raw'),
    ...dragPair(1),
    plain('pan-left'),
    plain('pan-right'),
    plain('tilt-up'),
    plain('tilt-down'),
    ...dragPair(2),
    ...dragPair(3),
    plain('face-north-east'),
    plain('capture-north-east'),
    plain('capture-north-east-again'),
  ];
}

/** The four movements § 2.4 asks for from one after-drag capture. */
export const MOVEMENT_STEP_COUNT = 4;

/** Captures of the second registered direction, which nothing is dragged in. */
export const TURNED_CAPTURE_COUNT = 2;

/**
 * Captures a complete run produces: the raw one, three drags, four movements,
 * and two of the north-east direction.
 */
export const FIELD_CAPTURE_COUNT =
  1 + REPEATED_DRAG_COUNT + MOVEMENT_STEP_COUNT + TURNED_CAPTURE_COUNT;

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3 — The pan target, read off the overlay
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * How far across the half-frame a drawn marker sits: 0 at the centre, 1 at the
 * edge.
 *
 * F4's pan target is a number the person can watch reach itself, rather than an
 * angle they have to estimate. It is read from the DRAWN overlay, which is the
 * marker they were looking at while they turned.
 */
export function anchorOffsetU(xPx: number, frameWidthPx: number): number {
  const half = frameWidthPx / 2;
  if (!(half > 0)) return 0;
  return Math.abs(xPx - half) / half;
}

/** Has the anchor reached the registered pan target? */
export function panTargetReached(u: number): boolean {
  return u >= PAN_ANCHOR_EDGE_OFFSET;
}

/**
 * Which half of the frame a drawn marker is in.
 *
 * § 2.4 asks for the anchor at the LEFT edge and then at the RIGHT one, so the
 * screen has to tell a person which of the two they have reached. Exactly at the
 * centre there is no side, and a marker there is nowhere near either edge.
 */
export function anchorSide(xPx: number, frameWidthPx: number): 'left' | 'right' | 'centre' {
  const half = frameWidthPx / 2;
  if (xPx < half) return 'left';
  if (xPx > half) return 'right';
  return 'centre';
}

/** Is a tilt inside the graded 5–15° envelope? */
export function tiltWithinEnvelope(tiltDeg: number): boolean {
  const magnitude = Math.abs(tiltDeg);
  return magnitude >= TILT_ENVELOPE_DEG.min && magnitude <= TILT_ENVELOPE_DEG.max;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4 — What the sensors did over the capture
 * ══════════════════════════════════════════════════════════════════════════ */

/** One reading of the pose, stamped from the start of the session. */
export interface PoseSample {
  readonly tMs: number;
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
}

/** How much of the trace before a capture is summarised, milliseconds. */
export const CAPTURE_WINDOW_MS = 1000;

/**
 * How far the pose may wander and still count as still, degrees.
 *
 * It is a tenth of the tightest F3 threshold, 1.30°. A hold that stays inside a
 * tenth of the tolerance is a hold the tolerance does not notice.
 */
export const STILL_MOVE_DEG = 0.13;

function range(values: readonly number[]): number {
  if (values.length < 2) return 0;
  let lowest = Number.POSITIVE_INFINITY;
  let highest = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (value < lowest) lowest = value;
    if (value > highest) highest = value;
  }
  return highest - lowest;
}

/**
 * How long the pose has been still, ending at the newest sample.
 *
 * Walks backwards from the newest sample while every axis stays within
 * {@link STILL_MOVE_DEG} of it, and reports the span covered. Heading and roll
 * are folded onto ±180 first, so a hold near due north reports the fraction of a
 * degree it moved rather than the 360 the raw numbers straddle.
 *
 * This is what earns the exclusion of the heading-smoothing lag from the budget
 * (term 8): the 400 ms smoothing constant decays to under 0.06° after 2 s.
 */
export function stillForMs(samples: readonly PoseSample[]): number {
  const newest = samples[samples.length - 1];
  if (newest === undefined) return 0;
  let oldestStill = newest.tMs;
  for (let index = samples.length - 2; index >= 0; index -= 1) {
    const sample = samples[index];
    if (sample === undefined) break;
    const moved = Math.max(
      angularSpreadDeg([newest.headingDeg, sample.headingDeg]),
      Math.abs(newest.pitchDeg - sample.pitchDeg),
      angularSpreadDeg([newest.rollDeg, sample.rollDeg]),
    );
    if (moved > STILL_MOVE_DEG) break;
    oldestStill = sample.tMs;
  }
  return newest.tMs - oldestStill;
}

/**
 * The sensor trace over the capture second, plus the overlay's own tick rate.
 *
 * `tickCount` and `longestTickGapMs` are F1's frame-rate measurement, recorded
 * per capture: the number of times the overlay was re-projected in the window,
 * and the longest silence between two of them.
 */
export function summariseTrace(
  samples: readonly PoseSample[],
  tickTMs: readonly number[],
  atMs: number,
  compassAccuracyDeg?: number,
): CaptureTrace {
  const from = atMs - CAPTURE_WINDOW_MS;
  const window = samples.filter((sample) => sample.tMs >= from && sample.tMs <= atMs);
  const ticks = tickTMs.filter((tick) => tick >= from && tick <= atMs);

  let longestTickGapMs = ticks.length > 0 ? 0 : CAPTURE_WINDOW_MS;
  for (let index = 1; index < ticks.length; index += 1) {
    const gap = (ticks[index] ?? 0) - (ticks[index - 1] ?? 0);
    if (gap > longestTickGapMs) longestTickGapMs = gap;
  }

  return {
    headingSpreadDeg: angularSpreadDeg(window.map((sample) => sample.headingDeg)),
    pitchSpreadDeg: range(window.map((sample) => sample.pitchDeg)),
    rollSpreadDeg: angularSpreadDeg(window.map((sample) => sample.rollDeg)),
    // The parser requires at least one sample. A capture taken before any pose
    // arrived is refused on the phone rather than written as a zero-sample hold.
    sampleCount: window.length,
    stillForMs: stillForMs(samples),
    ...(compassAccuracyDeg === undefined ? {} : { compassAccuracyDeg }),
    tickCount: ticks.length,
    longestTickGapMs,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 5 — The overlay, the band and the track, reduced to the schema
 * ══════════════════════════════════════════════════════════════════════════ */

/** A summit the sweep never reached, as the pipeline reports it. */
export interface UnmeasuredSummit {
  readonly id: string;
  readonly name: string;
  readonly distanceKm: number;
}

/**
 * The three states a DRAWN summit may be in, or undefined.
 *
 * `foreground-occluded` is not one of them: `layoutOverlay` moves such a peak to
 * `foregroundOccludedPeaks` and never draws it. A marker that carried it anyway
 * would be a renderer bug, so it is reported as withheld rather than given a
 * visibility it does not have.
 */
function drawableVisibility(peak: OverlayPeak): DrawnSummit['visibility'] | undefined {
  const visibility = peak.visibility ?? 'visible';
  return visibility === 'foreground-occluded' ? undefined : visibility;
}

function drawnSummit(
  peak: OverlayPeak,
  xPx: number,
  yPx: number,
  labelled: boolean,
): DrawnSummit | undefined {
  const visibility = drawableVisibility(peak);
  if (visibility === undefined) return undefined;
  return {
    summitId: peak.id,
    name: peak.name,
    elevationM: peak.elevationM,
    distanceKm: peak.distanceKm,
    altitudeDeg: peak.altitudeDeg,
    visibility,
    summitPx: { xPx, yPx },
    labelled,
  };
}

function withheldSummit(peak: OverlayPeak, reason: WithheldSummit['reason']): WithheldSummit {
  return { summitId: peak.id, name: peak.name, distanceKm: peak.distanceKm, reason };
}

/**
 * The overlay as it was drawn, in the schema's terms.
 *
 * A labelled marker and a crowded-out dot are both `drawn`, separated by
 * `labelled`: both are on the picture, and F5b grades which of them got a name.
 * The three withheld kinds stay apart because they say different things — off
 * the picture, behind something else, and beyond the terrain anyone measured.
 */
export function drawnOverlayFrom(
  layout: OverlayLayout,
  unmeasured: readonly UnmeasuredSummit[],
): DrawnOverlay {
  const drawn: DrawnSummit[] = [];
  const withheld: WithheldSummit[] = [];

  const place = (peak: OverlayPeak, xPx: number, yPx: number, labelled: boolean): void => {
    const summit = drawnSummit(peak, xPx, yPx, labelled);
    if (summit === undefined) withheld.push(withheldSummit(peak, 'foreground-occluded'));
    else drawn.push(summit);
  };

  for (const marker of layout.markers) {
    place(marker.peak, marker.summitPx.xPx, marker.summitPx.yPx, true);
  }
  for (const summit of layout.crowdedOutSummits) {
    place(summit.peak, summit.summitPx.xPx, summit.summitPx.yPx, false);
  }
  for (const peak of layout.offFramePeaks) withheld.push(withheldSummit(peak, 'off-frame'));
  for (const peak of layout.foregroundOccludedPeaks) {
    withheld.push(withheldSummit(peak, 'foreground-occluded'));
  }
  for (const summit of unmeasured) {
    withheld.push({
      summitId: summit.id,
      name: summit.name,
      distanceKm: summit.distanceKm,
      reason: 'unmeasured',
    });
  }
  return { drawn, withheld };
}

/**
 * The band the screen displayed, split per axis.
 *
 * `PoseUncertainty` carries one `hasUnquantified` flag over both axes, and F2's
 * gate is per axis: an axis whose band carries an unquantified term is a floor,
 * and a floor cannot be exceeded. So the flag is re-derived from the terms.
 */
export function displayedBandFrom(band: PoseUncertainty): DisplayedBand {
  const unquantified = (axis: 'horizontal' | 'vertical'): boolean =>
    band.terms.some((term) => term.axis === axis && term.basis.kind === 'unquantified');
  return {
    horizontalDeg: band.measuredDeg.horizontal,
    verticalDeg: band.measuredDeg.vertical,
    hasUnquantifiedHorizontal: unquantified('horizontal'),
    hasUnquantifiedVertical: unquantified('vertical'),
  };
}

/**
 * The camera track's geometry, with every identifier left behind.
 *
 * `deviceId`, `groupId` and `label` name one handset and the parser refuses all
 * three. They are dropped by naming the six fields that are kept rather than by
 * deleting the three that are not, so a new identifier on the platform's own
 * settings object cannot arrive here by itself.
 */
export function trackGeometryFrom(settings: TrackSettingsLike): TrackGeometry | undefined {
  const { width, height, frameRate, facingMode, resizeMode, zoom } = settings;
  if (typeof width !== 'number' || typeof height !== 'number') return undefined;
  if (!(width >= 1) || !(height >= 1)) return undefined;
  return {
    width,
    height,
    ...(typeof frameRate === 'number' && Number.isFinite(frameRate) ? { frameRate } : {}),
    ...(typeof facingMode === 'string' && facingMode.length > 0 ? { facingMode } : {}),
    ...(typeof resizeMode === 'string' && resizeMode.length > 0 ? { resizeMode } : {}),
    ...(typeof zoom === 'number' && Number.isFinite(zoom) ? { zoom } : {}),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 6 — One capture
 * ══════════════════════════════════════════════════════════════════════════ */

/** The file name a capture's frame is stored under, beside the bundle. */
export function frameFileNameFor(captureId: string): string {
  return `${captureId}.jpg`;
}

/** The bundle's own file name. No date in it — a date is a wall clock. */
export const FIELD_BUNDLE_FILE_NAME = 'mountain-finder-field-bundle.json';

/** What set the capture's gross heading offset. The bundle schema owns the list. */
export type { GrossHeadingSource };

/**
 * Whether a capture's pose carries the gross heading offset and its source.
 *
 * True: `parseFieldBundle` takes both keys and requires them, and the grader's
 * pose-level F2 reads the raw compass heading back out of the pose by
 * subtracting them. `buildFieldCapture` still takes this as an argument so a
 * test can build the pose without the two fields and watch the parser refuse it.
 */
export const POSE_CARRIES_GROSS_OFFSET = true;

/** Everything the live screen knows at the instant a capture is taken. */
export interface FieldCaptureContext {
  readonly pose: CameraPose;
  readonly headingBasis: CapturePose['headingBasis'];
  readonly trim: { readonly headingDeg: number; readonly pitchDeg: number };
  /** The re-anchor's heading correction, degrees. Zero when none was made. */
  readonly grossHeadingOffsetDeg: number;
  /** What set that correction. `'sensors'` means nobody re-anchored. */
  readonly grossHeadingSource: GrossHeadingSource;
  /** The overlay's drawing space, i.e. the CSS viewport. */
  readonly overlayPx: { readonly widthPx: number; readonly heightPx: number };
  readonly band: PoseUncertainty;
  readonly layout: OverlayLayout;
  readonly unmeasured: readonly UnmeasuredSummit[];
  readonly track: TrackSettingsLike;
  readonly fovSource: 'calibrated' | 'spec-sheet-guess';
  readonly sweepRadiusKm: number;
  /** The platform's own horizontal accuracy for the fix, metres, as reported. */
  readonly horizontalAccuracyM?: number;
  readonly compassAccuracyDeg?: number;
}

export interface FieldCaptureInput {
  readonly captureId: string;
  readonly role: CaptureRole;
  /** Milliseconds since the start of the session. Never a wall clock. */
  readonly tMs: number;
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
  readonly trace: CaptureTrace;
  readonly context: FieldCaptureContext;
  readonly dragAnchorSummitId?: string;
  readonly movedFromCaptureId?: string;
  readonly panFromReferenceDeg?: number;
  readonly tiltFromReferenceDeg?: number;
}

/** A heading folded onto [0, 360), leaving one already in range untouched. */
function fold360(deg: number): number {
  if (deg >= 0 && deg < 360) return deg;
  return ((deg % 360) + 360) % 360;
}

/**
 * One capture, in exactly the shape `parseFieldBundle` accepts.
 *
 * The heading is folded onto [0, 360) because the parser's bound is that range
 * and a pose that came back as −4° is the same direction, not a corrupt one.
 */
export function buildFieldCapture(
  input: FieldCaptureInput,
  carryGrossOffset: boolean = POSE_CARRIES_GROSS_OFFSET,
): Capture {
  const { context } = input;
  const track = trackGeometryFrom(context.track);
  const pose: CapturePose = {
    headingDeg: fold360(context.pose.headingDeg),
    pitchDeg: context.pose.pitchDeg,
    rollDeg: context.pose.rollDeg,
    hFovDeg: context.pose.hFovDeg,
    vFovDeg: context.pose.vFovDeg,
    headingBasis: context.headingBasis,
    trimHeadingDeg: context.trim.headingDeg,
    trimPitchDeg: context.trim.pitchDeg,
    grossHeadingOffsetDeg: context.grossHeadingOffsetDeg,
    grossHeadingSource: context.grossHeadingSource,
  };
  // Dropping the two gross fields makes a pose the parser refuses, so the cast
  // states what the caller asked for. Only a test asks for it.
  const { grossHeadingOffsetDeg: _offset, grossHeadingSource: _source, ...withoutGross } = pose;
  return {
    captureId: input.captureId,
    role: input.role,
    tMs: input.tMs,
    framePath: frameFileNameFor(input.captureId),
    framePx: input.framePx,
    overlayPx: context.overlayPx,
    pose: carryGrossOffset ? pose : (withoutGross as CapturePose),
    trace: input.trace,
    track: track ?? { width: 0, height: 0 },
    fovSource: context.fovSource,
    sweepRadiusKm: context.sweepRadiusKm,
    band: displayedBandFrom(context.band),
    overlay: drawnOverlayFrom(context.layout, context.unmeasured),
    ...(input.dragAnchorSummitId === undefined
      ? {}
      : { dragAnchorSummitId: input.dragAnchorSummitId }),
    ...(input.movedFromCaptureId === undefined
      ? {}
      : { movedFromCaptureId: input.movedFromCaptureId }),
    ...(input.panFromReferenceDeg === undefined
      ? {}
      : { panFromReferenceDeg: input.panFromReferenceDeg }),
    ...(input.tiltFromReferenceDeg === undefined
      ? {}
      : { tiltFromReferenceDeg: input.tiltFromReferenceDeg }),
    ...(context.horizontalAccuracyM === undefined
      ? {}
      : { horizontalAccuracyM: context.horizontalAccuracyM }),
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7 — The whole bundle
 * ══════════════════════════════════════════════════════════════════════════ */

export interface FieldBundleInput {
  /** `navigator.userAgent`, verbatim. Names the browser the verdicts apply to. */
  readonly device: string;
  /** Which committed peak regions the app had loaded. Public identifiers. */
  readonly peakRegions: readonly string[];
  readonly captures: readonly Capture[];
}

/**
 * The bundle, with `accuracyConvention` declared whenever a capture reports one.
 *
 * The parser requires the pair: a radius without its confidence level is not a
 * σ, and the budget's conversion to 1σ must not be applied to a number that
 * meant something else.
 */
export function buildFieldBundle(input: FieldBundleInput): FieldBundle {
  const reportsAccuracy = input.captures.some(
    (capture) => capture.horizontalAccuracyM !== undefined,
  );
  return {
    format: BUNDLE_FORMAT,
    timestampBasis: TIMESTAMP_BASIS,
    ...(reportsAccuracy ? { accuracyConvention: ACCURACY_CONFIDENCE } : {}),
    device: input.device,
    peakRegions: [...input.peakRegions],
    captures: [...input.captures],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 8 — What the screen says about a capture that is off-protocol
 * ══════════════════════════════════════════════════════════════════════════ */

/** One thing about a capture the pre-registration would not grade, in plain words. */
export interface CaptureShortfall {
  readonly code:
    | 'frame-too-small'
    | 'not-still'
    | 'uncalibrated'
    | 'fix-too-loose'
    | 'pan-short'
    | 'pan-too-wide'
    | 'pan-wrong-side'
    | 'tilt-outside'
    | 'tilt-wrong-way';
  readonly text: string;
}

/**
 * Everything about a finished capture that falls short of the protocol.
 *
 * Reported rather than refused. A capture the grader will not use is still
 * evidence about the app, and a person who has already driven somewhere is
 * better served by being told what to repeat than by having the tap ignored.
 */
export function captureShortfalls(
  capture: Capture,
  options: {
    readonly anchorU?: number;
    readonly anchorSide?: 'left' | 'right' | 'centre';
    /**
     * Where the anchor sat in the capture this one moved from, signed.
     *
     * § 2.7 step 6 asks for it near the middle, and § 2.4 charges its
     * field-of-view term at the widest pan that framing allows. A pan from
     * further out turns the phone further than the budget covers, so the
     * grader will not score it.
     */
    readonly referenceAnchorSignedU?: number;
    readonly wantedEdge?: 'left' | 'right';
    readonly wantedTilt?: 'up' | 'down';
  } = {},
): readonly CaptureShortfall[] {
  const out: CaptureShortfall[] = [];
  if (capture.framePx.widthPx < MIN_STORED_FRAME_WIDTH_PX) {
    out.push({
      code: 'frame-too-small',
      text:
        `The saved picture is ${capture.framePx.widthPx} pixels across. The test needs at least ` +
        `${MIN_STORED_FRAME_WIDTH_PX}, because the answer is read off the picture by eye.`,
    });
  }
  if (capture.trace.stillForMs < BRACE_HOLD_MS) {
    out.push({
      code: 'not-still',
      text:
        `The phone was only still for ${(capture.trace.stillForMs / 1000).toFixed(1)} s before ` +
        `this one. Two seconds is what settles the compass. Take it again.`,
    });
  }
  if (capture.fovSource !== 'calibrated') {
    out.push({
      code: 'uncalibrated',
      text:
        'The camera width has not been measured on this phone, so this capture cannot be marked. ' +
        'Go back and do the two taps.',
    });
  }
  if (
    capture.horizontalAccuracyM !== undefined &&
    capture.horizontalAccuracyM > MAX_OBSERVER_ACCURACY_M
  ) {
    out.push({
      code: 'fix-too-loose',
      text:
        `The phone only knows where it is to ${capture.horizontalAccuracyM.toFixed(0)} m. ` +
        `Above ${MAX_OBSERVER_ACCURACY_M} m this capture is not marked. Wait and take it again.`,
    });
  }
  if (capture.panFromReferenceDeg !== undefined && options.anchorU !== undefined) {
    if (!panTargetReached(options.anchorU)) {
      out.push({
        code: 'pan-short',
        text:
          `That summit only reached ${(options.anchorU * 100).toFixed(0)} % of the way to the ` +
          `edge. It needs ${(PAN_ANCHOR_EDGE_OFFSET * 100).toFixed(0)} %. Turn a little further.`,
      });
    }
    if (options.referenceAnchorSignedU !== undefined) {
      const movedSignedU = options.anchorSide === 'left' ? -options.anchorU : options.anchorU;
      const turnDeg = Math.abs(
        frameAngleDeg(movedSignedU) - frameAngleDeg(options.referenceAnchorSignedU),
      );
      if (turnDeg > MAX_REGISTERED_PAN_DEG) {
        out.push({
          code: 'pan-too-wide',
          text:
            `You turned about ${turnDeg.toFixed(0)}°, and the test allows up to ` +
            `${MAX_REGISTERED_PAN_DEG.toFixed(0)}°. That summit started ` +
            `${Math.abs(options.referenceAnchorSignedU * 100).toFixed(0)} % of the way to the edge ` +
            `instead of near the middle. Frame it nearer the middle and take the drag again.`,
        });
      }
    }
    if (options.wantedEdge !== undefined && options.anchorSide !== options.wantedEdge) {
      out.push({
        code: 'pan-wrong-side',
        text:
          `That summit ended up on the ${options.anchorSide ?? 'other'} of the picture, and this ` +
          `capture wanted it on the ${options.wantedEdge}. Turn the other way.`,
      });
    }
  }
  if (capture.tiltFromReferenceDeg !== undefined) {
    if (!tiltWithinEnvelope(capture.tiltFromReferenceDeg)) {
      out.push({
        code: 'tilt-outside',
        text:
          `You tipped the phone ${Math.abs(capture.tiltFromReferenceDeg).toFixed(1)}°. It needs to ` +
          `be between ${TILT_ENVELOPE_DEG.min}° and ${TILT_ENVELOPE_DEG.max}°.`,
      });
    }
    const went = capture.tiltFromReferenceDeg >= 0 ? 'up' : 'down';
    if (options.wantedTilt !== undefined && went !== options.wantedTilt) {
      out.push({
        code: 'tilt-wrong-way',
        text: `You tipped the phone ${went} and this capture wanted it ${options.wantedTilt}.`,
      });
    }
  }
  return out;
}
