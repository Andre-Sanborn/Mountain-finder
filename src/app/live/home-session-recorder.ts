/**
 * Turning the live screen's raw event stream into a recording the parser accepts.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE EVENTS COME FROM
 * ═══════════════════════════════════════════════════════════════════════════
 * `browser-sensors.ts` hands every raw `deviceorientation`, `deviceorientationabsolute`
 * and `devicemotion` object to a `RawEventSink` before any conversion, and every
 * `track.getSettings()` snapshot beside them. This class is that sink. It keeps
 * the events that arrive while a step is open, drops everything else, and builds
 * a `HomeSessionRecording`.
 *
 * ── WHY IT STAMPS ITS OWN TIME ─────────────────────────────────────────────
 * The `tMs` on a raw event is `performance.now()`, measured from page load, and
 * the `tMs` on a track-settings snapshot is measured from when the lens watch
 * started. Two different origins, neither of them the start of the recording.
 * The schema permits exactly one basis — milliseconds since the recording began —
 * so this class reads its own clock as each item arrives and subtracts the
 * instant `begin` was called. The sink is called synchronously from the DOM
 * listener, so its own reading and the event's differ by microseconds.
 *
 * ── WHAT IS DROPPED, AND WHAT IS KEPT VERBATIM ─────────────────────────────
 * Dropped: any event arriving outside a step, any orientation event whose DOM
 * type is neither of the two the schema names, and every field outside the
 * schema's whitelists. `deviceId`, `groupId` and `label` are dropped from the
 * track settings, because they identify one handset and the field-of-view work
 * needs the geometry only.
 *
 * Kept verbatim: every angle, every acceleration component, the compass heading
 * and its accuracy, including negative and out-of-range values. A browser that
 * reports gamma outside ±90° or an accuracy of −1 is a finding, and rounding it
 * into range would destroy the finding. A non-finite number becomes `null`,
 * which is what `JSON.stringify` writes for it anyway.
 *
 * Nothing here writes to disk, to storage or to the network. The recording is a
 * value the caller shares by the user's own action.
 */

import type { TrackSettingsLike } from './lens-log';
import type { RawEventSink, RawSensorEvent } from './browser-sensors';
import {
  RECORDING_FORMAT,
  TIMESTAMP_BASIS,
  type HomeSessionRecording,
  type KnownBearing,
  type PoseLabel,
  type RecordedDragTrial,
  type RecordedSegment,
  type RecordedSensorEvent,
  type RecordedTrackSettings,
} from '../../live/recording';

/** The two DOM event types the schema accepts for an orientation record. */
const ORIENTATION_TYPES = ['deviceorientation', 'deviceorientationabsolute'] as const;
type OrientationType = (typeof ORIENTATION_TYPES)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A number as the file will hold it: finite, or `null`. */
function jsonNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonVector(
  value: unknown,
): { readonly x: number | null; readonly y: number | null; readonly z: number | null } | null {
  if (!isRecord(value)) return null;
  return { x: jsonNumber(value.x), y: jsonNumber(value.y), z: jsonNumber(value.z) };
}

function jsonRotationRate(
  value: unknown,
): { readonly alpha: number | null; readonly beta: number | null; readonly gamma: number | null } | null {
  if (!isRecord(value)) return null;
  return { alpha: jsonNumber(value.alpha), beta: jsonNumber(value.beta), gamma: jsonNumber(value.gamma) };
}

/** Which of two counts a dropped item went into, for the screen's own honesty. */
export interface RecorderCounts {
  readonly events: number;
  readonly trackSettings: number;
  /** Items that arrived with no step open, or with a type the schema refuses. */
  readonly dropped: number;
}

interface OpenSegment {
  readonly pose: PoseLabel;
  readonly startMs: number;
  readonly note?: string;
  readonly events: RecordedSensorEvent[];
  readonly trackSettings: RecordedTrackSettings[];
}

export interface BuildRecordingInput {
  /** `navigator.userAgent`, verbatim. */
  readonly device: string;
  readonly knownBearing: KnownBearing;
  /** The repeated-drag attempts, which happen after the last pose. */
  readonly dragTrials?: readonly RecordedDragTrial[];
  readonly note?: string;
}

export class HomeSessionRecorder implements RawEventSink {
  private startMs: number | undefined;
  private open: OpenSegment | undefined;
  private readonly segments: RecordedSegment[] = [];
  private lastTMs = 0;
  private events = 0;
  private settings = 0;
  private dropped = 0;

  /** `now` is injected so the recorder runs under vitest with no browser. */
  constructor(private readonly now: () => number) {}

  /**
   * Start the clock, discarding anything already recorded.
   *
   * Every timestamp is measured from here, so segments kept from an earlier run
   * would sit after the new ones in time and the parser would refuse the pair as
   * overlapping.
   */
  begin(): void {
    this.startMs = this.now();
    this.lastTMs = 0;
    this.segments.length = 0;
    this.open = undefined;
    this.events = 0;
    this.settings = 0;
    this.dropped = 0;
  }

  get started(): boolean {
    return this.startMs !== undefined;
  }

  get counts(): RecorderCounts {
    return { events: this.events, trackSettings: this.settings, dropped: this.dropped };
  }

  get completedSegments(): readonly RecordedSegment[] {
    return this.segments;
  }

  /** Milliseconds since `begin`, never below the last value handed out. */
  private stamp(): number {
    if (this.startMs === undefined) return 0;
    const tMs = Math.max(0, this.now() - this.startMs);
    // performance.now() is monotonic, so this only matters for an injected
    // clock in a test; a timestamp that went backwards would fail the parser.
    this.lastTMs = Math.max(this.lastTMs, tMs);
    return this.lastTMs;
  }

  /** Open a step. Closes any step still open, so the segments never overlap. */
  beginSegment(pose: PoseLabel, note?: string): void {
    if (this.startMs === undefined) this.begin();
    this.endSegment();
    this.open = {
      pose,
      startMs: this.stamp(),
      ...(note === undefined ? {} : { note }),
      events: [],
      trackSettings: [],
    };
  }

  /** Close the open step and keep it. A step with no events is still evidence. */
  endSegment(): void {
    const open = this.open;
    if (open === undefined) return;
    this.open = undefined;
    this.segments.push({
      pose: open.pose,
      startMs: open.startMs,
      endMs: this.stamp(),
      ...(open.note === undefined ? {} : { note: open.note }),
      events: open.events,
      ...(open.trackSettings.length === 0 ? {} : { trackSettings: open.trackSettings }),
    });
  }

  onRawEvent(sample: RawSensorEvent): void {
    const open = this.open;
    if (open === undefined) {
      this.dropped += 1;
      return;
    }
    const tMs = this.stamp();
    const converted =
      sample.kind === 'orientation'
        ? this.orientationRecord(sample, tMs)
        : this.motionRecord(sample, tMs);
    if (converted === undefined) {
      this.dropped += 1;
      return;
    }
    open.events.push(converted);
    this.events += 1;
  }

  onTrackSettings(settings: TrackSettingsLike, _tMs: number): void {
    const open = this.open;
    if (open === undefined) {
      this.dropped += 1;
      return;
    }
    const width = jsonNumber(settings.width);
    const height = jsonNumber(settings.height);
    const frameRate = jsonNumber(settings.frameRate);
    const aspectRatio = jsonNumber(settings.aspectRatio);
    open.trackSettings.push({
      tMs: this.stamp(),
      ...(width === null ? {} : { width }),
      ...(height === null ? {} : { height }),
      ...(frameRate === null ? {} : { frameRate }),
      ...(aspectRatio === null ? {} : { aspectRatio }),
    });
    this.settings += 1;
  }

  private orientationRecord(sample: RawSensorEvent, tMs: number): RecordedSensorEvent | undefined {
    const type = ORIENTATION_TYPES.find((candidate): candidate is OrientationType => candidate === sample.type);
    if (type === undefined) return undefined;
    const event = sample.event;
    if (!isRecord(event)) return undefined;

    const absolutePresent = 'absolute' in event;
    // `absolute` is recorded as the value AND as a presence flag: JSON cannot
    // tell a missing key from one holding undefined, and "Safari has no such
    // attribute" and "Safari says false" are different answers.
    const absolute = absolutePresent
      ? typeof event.absolute === 'boolean'
        ? event.absolute
        : null
      : undefined;

    return {
      kind: 'orientation',
      tMs,
      type,
      absolutePresent,
      screenAngleDeg: jsonNumber(sample.screenAngleDeg) ?? 0,
      event: {
        alpha: jsonNumber(event.alpha),
        beta: jsonNumber(event.beta),
        gamma: jsonNumber(event.gamma),
        ...(absolute === undefined ? {} : { absolute }),
        ...('webkitCompassHeading' in event
          ? { webkitCompassHeading: jsonNumber(event.webkitCompassHeading) }
          : {}),
        ...('webkitCompassAccuracy' in event
          ? { webkitCompassAccuracy: jsonNumber(event.webkitCompassAccuracy) }
          : {}),
      },
    };
  }

  private motionRecord(sample: RawSensorEvent, tMs: number): RecordedSensorEvent | undefined {
    const event = sample.event;
    if (!isRecord(event)) return undefined;
    return {
      kind: 'motion',
      tMs,
      event: {
        ...('acceleration' in event ? { acceleration: jsonVector(event.acceleration) } : {}),
        ...('accelerationIncludingGravity' in event
          ? { accelerationIncludingGravity: jsonVector(event.accelerationIncludingGravity) }
          : {}),
        ...('interval' in event ? { interval: jsonNumber(event.interval) } : {}),
      },
      ...('rotationRate' in event ? { rotationRate: jsonRotationRate(event.rotationRate) } : {}),
    };
  }

  /** The recording as it stands. Closes an open step first. */
  build(input: BuildRecordingInput): HomeSessionRecording {
    this.endSegment();
    return {
      format: RECORDING_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device: input.device,
      knownBearing: input.knownBearing,
      segments: [...this.segments],
      ...(input.dragTrials === undefined || input.dragTrials.length === 0
        ? {}
        : { dragTrials: [...input.dragTrials] }),
      ...(input.note === undefined ? {} : { note: input.note }),
    };
  }
}
