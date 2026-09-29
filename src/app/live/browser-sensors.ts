/**
 * The browser side of the sensor chain: listeners, permission gates, traces.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS HERE AND WHAT IS DELIBERATELY NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * `web-sensors.ts` is a pure function of raw event objects and is where all the
 * arithmetic and every sign convention live. This file is the part that cannot
 * be pure: `addEventListener`, `requestPermission`, a clock, and two ring
 * buffers. It converts nothing itself — every event goes straight through
 * `webOrientationSample` — so a bug here is a plumbing bug and not a geometry
 * bug.
 *
 * ── THE PERMISSION GESTURE ─────────────────────────────────────────────────
 * iOS 13 and later refuse orientation events until
 * `DeviceOrientationEvent.requestPermission()` has resolved, and that call only
 * works from inside a user gesture. Called outside one it rejects, and calling
 * it twice in the same gesture rejects as well. So it is called exactly once,
 * from the Start button's handler, and its answer is kept.
 *
 * Chromium implements no such method, and treating its absence as a denial
 * would refuse the only browser this project can test in. So an absent method
 * is `'granted'` — the platform is saying it has no gate, not that it said no.
 *
 * ── THE CLOCK ──────────────────────────────────────────────────────────────
 * Sample timestamps come from `performance.now()`, not from `Date.now()`.
 * `performance.now()` is monotonic, so it cannot jump backwards when the system
 * clock is corrected mid-session, and it is measured from page load rather than
 * from an epoch — which also means a trace carries no wall-clock time, matching
 * the capture rule in AGENTS.md even though nothing here is written to disk.
 *
 * ── WHY A BOUNDED BUFFER ───────────────────────────────────────────────────
 * Orientation events arrive up to 60 times a second and `fuseSensorPose`
 * ignores anything older than 1.5 s, so an unbounded array would grow for the
 * whole session and be filtered away on every frame. The buffers hold two
 * seconds' worth at 60 Hz, which is more than the fusion window and a fixed
 * cost.
 */

import {
  detectMotionGravityConvention,
  webMotionSample,
  webOrientationSample,
  type WebGravityConvention,
  type WebOrientationEventLike,
  type WebSampleRefusal,
} from '../../live/web-sensors';
import type { GravitySample, HeadingSample } from '../../live/sensors';
import type { TrackSettingsLike } from './lens-log';

/** Samples kept per trace: two seconds at 60 Hz, past the 1.5 s fusion window. */
export const TRACE_CAPACITY = 120;

export type MotionPermission = 'granted' | 'denied' | 'unsupported' | 'error';

/**
 * Structurally what iOS adds to `DeviceOrientationEvent`. Declared rather than
 * cast, because the DOM types this project compiles against do not have it.
 */
interface OrientationPermissionApi {
  requestPermission?: () => Promise<'granted' | 'denied' | 'prompt'>;
}

/**
 * Ask iOS for motion and orientation. Must be called from inside a tap.
 *
 * Returns `'unsupported'` where no such method exists, which is every browser
 * but Safari on iOS. That is not a denial: the events arrive without asking.
 */
export async function requestMotionPermission(): Promise<MotionPermission> {
  const api = (globalThis as { DeviceOrientationEvent?: OrientationPermissionApi })
    .DeviceOrientationEvent;
  if (api === undefined || typeof api.requestPermission !== 'function') return 'unsupported';
  try {
    const answer = await api.requestPermission();
    return answer === 'granted' ? 'granted' : 'denied';
  } catch {
    // Thrown when called outside a gesture, and when called twice in one.
    return 'error';
  }
}

/** A bounded, append-only ring of samples in arrival order. */
class Ring<T> {
  private items: T[] = [];

  constructor(private readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items = this.items.slice(this.items.length - this.capacity);
    }
  }

  snapshot(): readonly T[] {
    return this.items;
  }

  get length(): number {
    return this.items.length;
  }
}

/** What the screen needs to know about the stream of events, beyond the traces. */
export interface SensorStatus {
  /** Events of each kind seen since the session started. */
  readonly counts: { readonly orientation: number; readonly motion: number };
  /** The most recent heading route that answered, for the readout. */
  readonly headingRoute: 'absolute-alpha' | 'compass-top-edge' | 'compass-camera-axis' | undefined;
  /** The platform's own compass accuracy, when the platform gave one. */
  readonly compassAccuracyDeg: number | undefined;
  /** The most recent heading refusal, so the screen can name the remedy. */
  readonly headingRefusal: WebSampleRefusal | undefined;
  /** `screen.orientation.angle` as last seen, validated. */
  readonly screenAngleDeg: number;
  /** Which motion convention was detected, if a pair of events settled it. */
  readonly motionConvention: WebGravityConvention | undefined;
  /** True once `deviceorientationabsolute` has delivered an earth-referenced alpha. */
  readonly sawAbsoluteOrientation: boolean;
}

/**
 * One raw event, exactly as the browser delivered it.
 *
 * Shaped so that `RecordedSensorEvent` in `src/live/recording.ts` can be built
 * from it with no further plumbing: `type` distinguishes
 * `deviceorientation` from `deviceorientationabsolute`, `screenAngleDeg` is the
 * angle at the moment the event arrived, and `event` is the object itself — so a
 * sink can read `absolute`, `rotationRate` or anything else off it without this
 * file having to know which fields the recording schema wants next.
 *
 * `tMs` is measured from the start of the session, never from an epoch: a
 * wall-clock stamp dates a session as precisely as a coordinate places it, and
 * AGENTS.md's capture rules forbid both.
 */
export interface RawSensorEvent {
  readonly kind: 'orientation' | 'motion';
  /** The DOM event type. */
  readonly type: string;
  readonly tMs: number;
  readonly screenAngleDeg: number;
  readonly event: unknown;
}

/**
 * The seam the capture feature fills, and the only one this screen offers it.
 *
 * Recording is its own task. Nothing in `src/app/live/` writes anything
 * anywhere; a sink is handed every raw event and every camera-settings snapshot
 * and decides for itself what to keep.
 */
export interface RawEventSink {
  /** Every raw event, in arrival order, before any conversion. */
  onRawEvent(sample: RawSensorEvent): void;
  /** Each `track.getSettings()` snapshot, as the lens watch reads it. */
  onTrackSettings?(settings: TrackSettingsLike, tMs: number): void;
}

/**
 * Listens for orientation and motion events and keeps the two traces
 * `fuseSensorPose` consumes.
 *
 * `attach` and `detach` are symmetric and safe to call twice. The screen holds
 * one of these for the whole session and reads `traces()` on every animation
 * frame; nothing here allocates per frame beyond the two array snapshots.
 */
export class BrowserSensorTraces {
  private readonly gravity = new Ring<GravitySample>(TRACE_CAPACITY);
  private readonly heading = new Ring<HeadingSample>(TRACE_CAPACITY);

  private orientationCount = 0;
  private motionCount = 0;
  private headingRoute: SensorStatus['headingRoute'];
  private compassAccuracyDeg: number | undefined;
  private headingRefusal: WebSampleRefusal | undefined;
  private motionConvention: WebGravityConvention | undefined;
  private sawAbsoluteOrientation = false;
  private lastOrientationEvent: WebOrientationEventLike | undefined;
  private attached = false;

  private readonly onOrientation = (event: Event): void => {
    this.ingestOrientation(event as unknown as WebOrientationEventLike, event.type);
  };

  private readonly onMotion = (event: Event): void => {
    this.ingestMotion(event as unknown as Parameters<typeof webMotionSample>[0], event.type);
  };

  constructor(
    private readonly window: Window,
    private readonly now: () => number = () => performance.now(),
    private readonly sink?: RawEventSink,
  ) {}

  attach(): void {
    if (this.attached) return;
    this.attached = true;
    // Both orientation events are listened for. Chromium fires
    // `deviceorientationabsolute` with an earth-referenced alpha and
    // `deviceorientation` with a relative one; iOS fires only the latter, and
    // carries its compass fields on it. Taking both and letting
    // `webOrientationSample` pick the best-conditioned route is what makes one
    // code path serve both browsers.
    this.window.addEventListener('deviceorientationabsolute', this.onOrientation);
    this.window.addEventListener('deviceorientation', this.onOrientation);
    this.window.addEventListener('devicemotion', this.onMotion);
  }

  detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.window.removeEventListener('deviceorientationabsolute', this.onOrientation);
    this.window.removeEventListener('deviceorientation', this.onOrientation);
    this.window.removeEventListener('devicemotion', this.onMotion);
  }

  /** The screen angle, validated, defaulting to 0 where the API is absent. */
  screenAngleDeg(): number {
    const angle = this.window.screen?.orientation?.angle;
    return typeof angle === 'number' && Number.isFinite(angle) ? angle : 0;
  }

  ingestOrientation(event: WebOrientationEventLike, type = 'deviceorientation'): void {
    const tMs = this.now();
    const screenAngleDeg = this.screenAngleDeg();
    this.orientationCount += 1;
    this.lastOrientationEvent = event;
    if (event.absolute === true) this.sawAbsoluteOrientation = true;
    this.sink?.onRawEvent({ kind: 'orientation', type, tMs, screenAngleDeg, event });

    const sample = webOrientationSample(event, screenAngleDeg, tMs);
    if (sample.gravity.ok) this.gravity.push(sample.gravity.value.sample);

    if (sample.heading.ok) {
      this.heading.push(sample.heading.value.sample);
      this.headingRoute = sample.heading.value.route;
      this.compassAccuracyDeg = sample.heading.value.sample.accuracyDeg;
      this.headingRefusal = undefined;
      return;
    }

    // A relative-alpha `deviceorientation` event arriving alongside a working
    // absolute one is Chromium's normal behaviour, not a fault, so it must not
    // overwrite a refusal the screen would act on.
    if (this.sawAbsoluteOrientation && sample.heading.refusal === 'relative-alpha') return;
    this.headingRefusal = sample.heading.refusal;
  }

  ingestMotion(event: Parameters<typeof webMotionSample>[0], type = 'devicemotion'): void {
    const tMs = this.now();
    this.motionCount += 1;
    this.sink?.onRawEvent({
      kind: 'motion',
      type,
      tMs,
      screenAngleDeg: this.screenAngleDeg(),
      event,
    });

    // The motion event's sign differs between the two browsers, so it is only
    // usable once a simultaneous orientation event has settled which
    // convention this one is using. Until then it is counted and dropped:
    // gravity from the orientation event is sign-unambiguous and is enough.
    if (this.motionConvention === undefined) {
      const orientation = this.lastOrientationEvent;
      if (orientation === undefined) return;
      this.motionConvention = detectMotionGravityConvention(event, orientation);
      if (this.motionConvention === undefined) return;
    }
    const sample = webMotionSample(event, tMs, this.motionConvention);
    if (sample.gravity.ok) this.gravity.push(sample.gravity.value.sample);
  }

  traces(): { readonly gravity: readonly GravitySample[]; readonly heading: readonly HeadingSample[] } {
    return { gravity: this.gravity.snapshot(), heading: this.heading.snapshot() };
  }

  status(): SensorStatus {
    return {
      counts: { orientation: this.orientationCount, motion: this.motionCount },
      headingRoute: this.headingRoute,
      compassAccuracyDeg: this.compassAccuracyDeg,
      headingRefusal: this.headingRefusal,
      screenAngleDeg: this.screenAngleDeg(),
      motionConvention: this.motionConvention,
      sawAbsoluteOrientation: this.sawAbsoluteOrientation,
    };
  }
}
