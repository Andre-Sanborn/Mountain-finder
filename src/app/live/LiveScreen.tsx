/**
 * The live AR screen — landscape, over the rear camera, drawn with the same
 * renderer the still app uses.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS COMPONENT DOES, AND WHAT IT DELEGATES
 * ═══════════════════════════════════════════════════════════════════════════
 * Everything checkable is somewhere else, on purpose. This file holds the
 * browser: a `<video>`, three permission prompts, three event listeners, a
 * redraw timer, and a pointer drag. Every number it draws with comes from a pure
 * module that has its own tests:
 *
 *   video-box.ts         where the image lands, and the field of view that
 *                        survives `object-fit: cover`
 *   fov-choice.ts        calibrated field of view, or a labelled guess
 *   landscape-pose.ts    web-sensors → fuseSensorPose → heading policy → pose
 *   live-terrain.ts      one 360° sweep at the fix, D10 on
 *   loop.ts              the stored scene re-projected per frame
 *   render/              the layout and the SVG, unchanged from the still app
 *   live-uncertainty.ts  D9's band, with the terms a sensor stream has
 *   celestial-markers.ts the Sun and Moon discs, the bench-test instrument
 *   refusals.ts          every refusal, in words someone on a ridge can act on
 *   camera-devices.ts    one rear lens, never a lens group
 *   lens-log.ts          the lens switch iOS does not announce
 *
 * ── THE ORDER OF THE THREE PERMISSIONS ─────────────────────────────────────
 * Camera, then motion, then location, all from one tap. Camera first because it
 * is the one the user expects and the one that populates the device labels
 * `chooseRearCamera` needs. Motion second because iOS only grants it from
 * inside a gesture and the gesture is still live. Location last because it is
 * the slowest and the only one that can be waited for afterwards.
 *
 * ── WHY THE SCENE IS BUILT ONCE ────────────────────────────────────────────
 * Verdicts are pose-free, so the terrain sweep runs once at the position fix
 * and `liveOverlayScene` re-projects it as the phone moves. The sweep is the
 * full circle, so no amount of turning asks for terrain nobody measured.
 *
 * ── THE CAPTURE HOOK ───────────────────────────────────────────────────────
 * `rawEventSink` receives every raw sensor event before any conversion, and every
 * `track.getSettings()` snapshot the lens watch reads. Between them that is
 * everything `RecordedSensorEvent` and `RecordedTrackSettings` in
 * `src/live/recording.ts` are built from. `HomeSessionRecorder` is a sink of
 * exactly that shape, and `live.html?session=home` attaches one alongside any
 * sink the caller passed. Nothing here writes to disk or to the network: the
 * finished recording leaves only through the share sheet the person taps.
 *
 * ── THE OBSERVER'S HEIGHT COMES FROM THE MAP, NOT FROM GPS ─────────────────
 * The fix's altitude is handed over as `fallbackGroundElevationM`, so the
 * pipeline reads the ground under the observer off the terrain and puts the eye
 * 1.6 m above it. `live-terrain.ts` carries the measurements behind that choice,
 * and `groundHeightNote` puts the answer on screen, because the two figures
 * differ by tens of metres and only the user can see whether the labels sit too
 * high.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import type { CameraPose } from '../../core/types';
import { liveOverlayScene } from '../../live/loop';
import { buildOverlaySvgFromLayout, layoutOverlay } from '../../render';
import type { OverlayLayout } from '../../render/types';
import type { AnnotatedScene } from '../../pipeline/types';
import { DEFAULT_TERRAIN_MANIFEST_URL } from '../../providers/terrain-manifest';
import { resolveFromBase } from '../base-path';
import { selectOverlayPeaks, TerrainUnavailableError } from '../overlay-builder';
import { NO_GROSS_HEADING_OFFSET_DEG, NO_TRIM, isUntrimmed, type TrimState } from '../trim';
import { magneticDeclinationDeg } from '../../core/declination';
import { BrowserSensorTraces, requestMotionPermission, type RawEventSink } from './browser-sensors';
import { CameraOpenError, openRearCamera, readTrackSettings, TRACK_POLL_INTERVAL_MS } from './camera-stream';
import { celestialMarks, isTappableMark, offFrameDirection, type CelestialMark } from './celestial-markers';
import {
  dragGain,
  dragStepSentence,
  dragStepSize,
  FINE_DRAG_FACTOR,
  trimFromDragAtGain,
  type DragMode,
} from './fine-drag';
import type { CompletedDrag } from './drag-trial';
import { HomeSessionPanel } from './HomeSessionPanel';
import type {
  CalibrationFrame,
  CalibrationReference,
  CalibrationTap,
  FovFit,
  PointPx,
} from './fov-calibration';
import { calibrationFromFit } from './fov-calibration';
import { FieldSessionPanel, type CapturedFrame } from './FieldSessionPanel';
import {
  isFieldSessionRequested,
  stillForMs,
  type FieldCaptureContext,
  type PoseSample,
  type UnmeasuredSummit,
} from './field-session';
import {
  anchorDrift,
  azimuthInBasis,
  grossHeadingWarning,
  reanchorFromTap,
  readsAsSunTap,
  STILL_FOR_REANCHOR_MS,
  type Reanchor,
  type ReanchorReference,
} from './reanchor';
import { browserBundleShareTarget } from './field-share';
import type { PitchBiasEstimate } from '../../live/recording';

import { isHomeSessionRequested, sunKnownBearing } from './home-session';
import { HomeSessionRecorder } from './home-session-recorder';
import { browserShareTarget } from './home-session-share';
import {
  DEFAULT_LENS_LABEL,
  DEFAULT_MODEL_NAME,
  PHONE_MODEL_PRESETS,
  fovCalibrationKey,
  phoneModelPreset,
  readStoredFovCalibration,
  resolveFov,
  writeStoredFovCalibration,
  type FovCalibration,
} from './fov-choice';
import {
  pitchBiasKey,
  readStoredPitchBias,
  writeStoredPitchBias,
  type PitchBiasCalibration,
} from './pitch-bias';
import {
  DEFAULT_SCREEN_ROLL_HYPOTHESIS,
  isLandscapeViewport,
  landscapePose,
  type ScreenRollHypothesis,
} from './landscape-pose';
import { EMPTY_LENS_LOG, lensSwitchWarning, recordTrackSettings, type LensLog } from './lens-log';
import { groundHeightNote, metresFromFix, RESWEEP_DISTANCE_M, type LiveObserver } from './live-terrain';
import { horizontalBandHalfWidthPx, liveUncertainty } from './live-uncertainty';
import { OfflinePanel } from './OfflinePanel';
import { liveRefusal, refusalForWebSample, type LiveRefusalCode } from './refusals';
import { sweepRangeSentence } from './sweep-range';
import { videoBoxGeometry, type SafeAreaInsetsPx } from './video-box';

/** How often the overlay is laid out again, milliseconds. */
const REDRAW_INTERVAL_MS = 50;

/** Standing eye height, the same figure the still app assumes. */
const EYE_HEIGHT_M = 1.6;

/**
 * JPEG quality the stored field frame is encoded at.
 *
 * High, because truth is a pixel two people pick out of this frame by eye
 * (docs/FIELD-TEST-PREREGISTRATION.md § 2.0). Compression artefacts around a
 * summit ridge cost annotation precision directly.
 */
const FRAME_QUALITY = 0.92;

/** How much of the overlay's tick history is kept, milliseconds. */
const TICK_MEMORY_MS = 4000;

/**
 * How much of the pose's own history is kept, milliseconds.
 *
 * Longer than the tick history, because the re-anchor is gated on ten seconds
 * of stillness and `stillForMs` can only report what is still in the buffer.
 */
const POSE_TRACE_MEMORY_MS = STILL_FOR_REANCHOR_MS + 4000;

export interface LiveScreenProps {
  /** Builds the one 360° scene. Injected so the screen has no data source of its own. */
  readonly buildScene: (
    observer: LiveObserver,
    signal: AbortSignal,
  ) => Promise<AnnotatedScene>;
  /** A second sink beside the home session's own. Nothing here writes anything. */
  readonly rawEventSink?: RawEventSink;
  /**
   * Run the guided home session. Defaults to whether the address asks for it,
   * so `live-main.tsx` needs no knowledge of this mode.
   */
  readonly homeSession?: boolean;
  /**
   * Run the guided field session. Defaults to whether the address asks for it,
   * so `live-main.tsx` needs no knowledge of this mode either.
   */
  readonly fieldSession?: boolean;
  /**
   * Which committed peak regions this build serves, by name. A field bundle
   * records them, so a grader can say which data the labels came from. They are
   * public identifiers; nothing about them names a viewpoint.
   */
  readonly peakRegions?: readonly string[];
  /**
   * Where the terrain index is served. Defaults to this build's own base, which
   * is what the offline strip needs to name the grid it would download.
   */
  readonly terrainManifestUrl?: string;
}

type Phase = 'idle' | 'starting' | 'running';

interface PositionFix {
  readonly lat: number;
  readonly lon: number;
  readonly altitudeM: number | undefined;
  readonly accuracyM: number | undefined;
  /** Wall clock of the fix — WMM2025 needs a date, and this is `src/app`. */
  readonly when: Date;
}

interface Viewport {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly insets: SafeAreaInsetsPx;
}

interface DecodedFrame {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Which reference the next tap on the picture is about. */
type ReanchorMode = 'off' | 'sun' | 'summit';

/** What a re-anchor recorded, so the screen can watch the compass leave it. */
interface Anchor {
  /** The sensed heading at the instant the anchor was set, degrees. */
  readonly sensedHeadingDeg: number;
  /** The camera's yaw at that instant, in the device's own azimuth frame. */
  readonly yawDeg: number | undefined;
  /** What the direction was taken from, for the field bundle and the screen. */
  readonly source: 'sun' | 'summit';
  readonly referenceName: string;
  readonly offsetDeg: number;
}

/** A summit re-anchor the person has not confirmed yet. */
interface PendingReanchor {
  readonly value: Reanchor;
  readonly reference: ReanchorReference;
  readonly source: 'sun' | 'summit';
}

/** Read `env(safe-area-inset-*)` off a probe element the layout already sizes. */
function readInsets(probe: HTMLElement | null): SafeAreaInsetsPx {
  if (probe === null) return {};
  const style = getComputedStyle(probe);
  const px = (value: string): number => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    topPx: px(style.paddingTop),
    rightPx: px(style.paddingRight),
    bottomPx: px(style.paddingBottom),
    leftPx: px(style.paddingLeft),
  };
}

function formatDeg(value: number, places = 1): string {
  return `${value.toFixed(places)}°`;
}

export function LiveScreen(props: LiveScreenProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle');
  const [blockingRefusal, setBlockingRefusal] = useState<LiveRefusalCode | undefined>('not-started');
  const [viewport, setViewport] = useState<Viewport>({ widthPx: 0, heightPx: 0, insets: {} });
  const [decodedFrame, setDecodedFrame] = useState<DecodedFrame>({ widthPx: 0, heightPx: 0 });
  const [lensLog, setLensLog] = useState<LensLog>(EMPTY_LENS_LOG);
  const [lensWarning, setLensWarning] = useState<string | undefined>(undefined);
  const [fix, setFix] = useState<PositionFix | undefined>(undefined);
  const [scene, setScene] = useState<AnnotatedScene | undefined>(undefined);
  const [sceneError, setSceneError] = useState<string | undefined>(undefined);
  const [sweepMs, setSweepMs] = useState<number | undefined>(undefined);
  const [trim, setTrim] = useState<TrimState>(NO_TRIM);
  /**
   * The re-anchor's heading correction. Separate from `trim` on purpose: no
   * drag can reach it, so a quarter-turn correction survives the next touch.
   */
  const [grossHeadingOffsetDeg, setGrossHeadingOffsetDeg] = useState(
    NO_GROSS_HEADING_OFFSET_DEG,
  );
  const [anchor, setAnchor] = useState<Anchor | undefined>(undefined);
  /** Which reference the next tap on the picture is about, or none. */
  const [reanchorMode, setReanchorMode] = useState<ReanchorMode>('off');
  /** The summit the person picked by name, by peak id. */
  const [summitId, setSummitId] = useState('');
  /** A summit re-anchor waiting to be confirmed, with the sentence to confirm. */
  const [pendingReanchor, setPendingReanchor] = useState<PendingReanchor | undefined>(undefined);
  const [reanchorNote, setReanchorNote] = useState<string | undefined>(undefined);
  /** The warning raised when a tap says the compass is grossly wrong. */
  const [grossWarning, setGrossWarning] = useState<string | undefined>(undefined);
  /**
   * The summit the field session is anchored on, by peak id.
   *
   * The layout keeps a label for it whatever the frame's budget says, so a
   * summit the person picked out of the crowded-out list has a name on screen.
   */
  const [fieldAnchorSummitId, setFieldAnchorSummitId] = useState<string | undefined>(undefined);
  const [dragMode, setDragMode] = useState<DragMode>('normal');
  /** The last drag that finished, for the home session's repeated-drag trials. */
  const [completedDrag, setCompletedDrag] = useState<CompletedDrag | undefined>(undefined);
  const [modelName, setModelName] = useState(DEFAULT_MODEL_NAME);
  const [lensLabel, setLensLabel] = useState(DEFAULT_LENS_LABEL);
  const [rollHypothesis, setRollHypothesis] = useState<ScreenRollHypothesis>(
    DEFAULT_SCREEN_ROLL_HYPOTHESIS,
  );
  const [calibration, setCalibration] = useState<FovCalibration | undefined>(undefined);
  const [calibrationNote, setCalibrationNote] = useState<string | undefined>(undefined);
  /** Bumped on a timer so the pose, the marks and the layout are recomputed. */
  const [tick, setTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const insetProbeRef = useRef<HTMLDivElement>(null);
  const tracesRef = useRef<BrowserSensorTraces | undefined>(undefined);
  const trackRef = useRef<MediaStreamTrack | undefined>(undefined);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const dragRef = useRef<
    { x: number; y: number; dx: number; dy: number; base: TrimState; startedAtMs: number } | undefined
  >(undefined);
  /** Serial number of finished drags, so a repeat of the same offset is a new one. */
  const dragSerialRef = useRef(0);
  /** The pose's roll, readable without a re-render, for the drag trials. */
  const rollRef = useRef<number | undefined>(undefined);
  /** When the overlay was last re-projected, newest last. Bounded by age. */
  const tickTimesRef = useRef<number[]>([]);
  /** The pose's recent history, for the stillness the re-anchor is gated on. */
  const poseTraceRef = useRef<PoseSample[]>([]);
  const reanchorLayerRef = useRef<HTMLDivElement>(null);

  const landscape = isLandscapeViewport(viewport.widthPx, viewport.heightPx);

  /* ── the home session ───────────────────────────────────────────────────── */
  const homeSession =
    props.homeSession ??
    (typeof window === 'undefined' ? false : isHomeSessionRequested(window.location.search));
  const fieldSession =
    props.fieldSession ??
    (typeof window === 'undefined' ? false : isFieldSessionRequested(window.location.search));
  // One recorder for the life of the screen. `performance.now()` is monotonic and
  // carries no wall clock, which is what the recording's timestamps need.
  const recorderRef = useRef<HomeSessionRecorder>();
  if (recorderRef.current === undefined) {
    recorderRef.current = new HomeSessionRecorder(() => performance.now());
  }
  const recorder = recorderRef.current;
  const sink: RawEventSink | undefined = useMemo(() => {
    const passed = props.rawEventSink;
    if (!homeSession) return passed;
    if (passed === undefined) return recorder;
    return {
      onRawEvent: (sample) => {
        passed.onRawEvent(sample);
        recorder.onRawEvent(sample);
      },
      onTrackSettings: (settings, tMs) => {
        passed.onTrackSettings?.(settings, tMs);
        recorder.onTrackSettings(settings, tMs);
      },
    };
  }, [props.rawEventSink, homeSession, recorder]);

  /* ── viewport and safe area ─────────────────────────────────────────────── */
  useEffect(() => {
    const measure = (): void => {
      setViewport({
        widthPx: window.innerWidth,
        heightPx: window.innerHeight,
        insets: readInsets(insetProbeRef.current),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);

  /* ── the redraw timer ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const handle = window.setInterval(() => {
      // Each tick is one overlay re-projection, which is what F1's frame-rate
      // floor is measured on. The times go into a ref rather than state: a
      // capture reads them, nothing draws them.
      const at = performance.now();
      const times = tickTimesRef.current;
      times.push(at);
      while ((times[0] ?? at) < at - TICK_MEMORY_MS) times.shift();
      setTick((value) => value + 1);
    }, REDRAW_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [phase]);

  /* ── the one sweep, once a fix exists ───────────────────────────────────── */
  useEffect(() => {
    if (fix === undefined) return undefined;
    const controller = new AbortController();
    const observer: LiveObserver = {
      lat: fix.lat,
      lon: fix.lon,
      eyeHeightM: EYE_HEIGHT_M,
      // The fix's altitude is the CAMERA's height, so the ground under it is
      // that less the eye height — the same subtraction the still app makes for
      // a photograph's GPS altitude. It is the FALLBACK: the DEM's ground at the
      // fix is the better figure, and `live-terrain.ts` says by how much.
      ...(fix.altitudeM === undefined
        ? {}
        : { fallbackGroundElevationM: fix.altitudeM - EYE_HEIGHT_M }),
    };
    setSceneError(undefined);
    const startedAt = performance.now();
    props
      .buildScene(observer, controller.signal)
      .then((built) => {
        if (controller.signal.aborted) return;
        setScene(built);
        setSweepMs(performance.now() - startedAt);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // A named absence, verbatim. The message says which square degree is
        // missing and that nothing was drawn, because a blank overlay would
        // read as "no peaks are visible from here".
        setSceneError(
          error instanceof TerrainUnavailableError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'The skyline could not be worked out.',
        );
      });
    return () => controller.abort();
  }, [fix, props]);

  /* ── start: camera, motion, location, all from one tap ──────────────────── */
  const start = useCallback(async () => {
    setPhase('starting');
    setBlockingRefusal(undefined);

    if (!window.isSecureContext) {
      setBlockingRefusal('insecure-context');
      setPhase('idle');
      return;
    }

    // 1 — camera. First, because it is what populates the device labels.
    try {
      const opened = await openRearCamera(navigator.mediaDevices);
      streamRef.current = opened.stream;
      trackRef.current = opened.track;
      setLensWarning(opened.warning);
      const video = videoRef.current;
      if (video !== null) {
        video.srcObject = opened.stream;
        await video.play().catch(() => undefined);
      }
    } catch (error) {
      setBlockingRefusal(
        error instanceof CameraOpenError && error.failure === 'denied'
          ? 'camera-denied'
          : 'camera-unavailable',
      );
      setPhase('idle');
      return;
    }

    // 2 — motion and orientation. iOS only grants this inside a gesture.
    const motion = await requestMotionPermission();
    if (motion === 'denied' || motion === 'error') {
      setBlockingRefusal('motion-denied');
      setPhase('idle');
      return;
    }
    const traces = new BrowserSensorTraces(window, () => performance.now(), sink);
    traces.attach();
    tracesRef.current = traces;

    // 3 — location. Slowest, and the only one that can be waited for after the
    // screen is already drawing the camera.
    setPhase('running');
    if (navigator.geolocation === undefined) {
      setBlockingRefusal('location-unavailable');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setFix({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          altitudeM: position.coords.altitude ?? undefined,
          accuracyM: position.coords.accuracy,
          when: new Date(),
        });
      },
      (error) => {
        setBlockingRefusal(error.code === error.PERMISSION_DENIED ? 'location-denied' : 'location-unavailable');
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }, [sink]);

  /* ── the lens watch ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const startedAt = performance.now();
    const read = (): void => {
      const track = trackRef.current;
      if (track === undefined) return;
      const settings = readTrackSettings(track);
      const tMs = performance.now() - startedAt;
      sink?.onTrackSettings?.(settings, tMs);
      setLensLog((log) => recordTrackSettings(log, settings, tMs));
    };
    read();
    const handle = window.setInterval(read, TRACK_POLL_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [phase, sink]);

  /* ── tear down on unmount ───────────────────────────────────────────────── */
  useEffect(
    () => () => {
      tracesRef.current?.detach();
      const stream = streamRef.current;
      if (stream !== undefined) for (const track of stream.getTracks()) track.stop();
    },
    [],
  );

  /* ── the decoded frame, once the first frame arrives ────────────────────── */
  const onVideoMetadata = useCallback(() => {
    const video = videoRef.current;
    if (video === null) return;
    setDecodedFrame({ widthPx: video.videoWidth, heightPx: video.videoHeight });
  }, []);

  /* ── geometry, field of view, pose, scene, marks ────────────────────────── */
  const geometry = useMemo(
    () =>
      videoBoxGeometry(
        { widthPx: viewport.widthPx, heightPx: viewport.heightPx },
        decodedFrame,
        viewport.insets,
      ),
    [viewport, decodedFrame],
  );

  const trackSettings = lensLog.entries[lensLog.entries.length - 1]?.settings ?? {};
  const calibrationStoreKey = fovCalibrationKey(trackSettings);

  useEffect(() => {
    setCalibration(
      readStoredFovCalibration(
        typeof localStorage === 'undefined' ? undefined : localStorage,
        calibrationStoreKey,
      ),
    );
  }, [calibrationStoreKey]);

  const [pitchBias, setPitchBias] = useState<PitchBiasCalibration | undefined>(undefined);
  const pitchBiasStoreKey = pitchBiasKey(trackSettings);

  useEffect(() => {
    setPitchBias(
      readStoredPitchBias(
        typeof localStorage === 'undefined' ? undefined : localStorage,
        pitchBiasStoreKey,
      ),
    );
  }, [pitchBiasStoreKey]);

  /** Take the home session's tilt measurement, store it, and band with it. */
  const applyPitchBias = useCallback(
    (estimate: PitchBiasEstimate) => {
      const calibration: PitchBiasCalibration = {
        biasDeg: estimate.biasDeg,
        spreadDeg: estimate.spreadDeg,
        segmentCount: estimate.sampleCount,
        method: estimate.method,
        source: estimate.source,
      };
      writeStoredPitchBias(
        typeof localStorage === 'undefined' ? undefined : localStorage,
        pitchBiasStoreKey,
        calibration,
      );
      setPitchBias(calibration);
    },
    [pitchBiasStoreKey],
  );

  const fov = useMemo(
    () =>
      resolveFov({
        decodedFrame,
        visibleFraction: geometry.visibleFraction,
        modelName,
        lensLabel,
        calibration,
      }),
    [decodedFrame, geometry.visibleFraction, modelName, lensLabel, calibration],
  );

  const poseResult = useMemo(() => {
    const traces = tracesRef.current;
    // No field of view means no frame has been decoded yet, and a pose scaled by
    // a field of view that does not exist would place labels over a black
    // rectangle. Both absences produce no pose, and the refusal below says which.
    if (traces === undefined || fov === undefined) return undefined;
    const { gravity, heading } = traces.traces();
    return landscapePose({
      gravity,
      heading,
      atMs: performance.now(),
      ...(fix === undefined
        ? {}
        : {
            modelDeclination: {
              site: {
                latitudeDeg: fix.lat,
                longitudeDeg: fix.lon,
                // Sea level when the fix carries no altitude. Declination moves
                // by about 0.007° over 3 km of height — two orders below the
                // model's own 0.5° RMS — so a missing altitude is not worth
                // waiting for the terrain sweep to supply one.
                heightM: fix.altitudeM ?? 0,
              },
              when: fix.when,
            },
          }),
      visibleFov: fov.visibleFov,
      screenAngle: (traces.status().screenAngleDeg % 360) as 0 | 90 | 180 | 270,
      screenRollHypothesis: rollHypothesis,
      trim,
      grossHeadingOffsetDeg,
    });
    // `tick` is what drives this: the traces are a mutable object the listeners
    // append to, so there is nothing else for a dependency array to notice.
  }, [tick, fix, fov, rollHypothesis, trim, grossHeadingOffsetDeg, phase]);

  const sensorStatus = tracesRef.current?.status();

  const framePx = { widthPx: viewport.widthPx, heightPx: viewport.heightPx };
  const pose: CameraPose | undefined = poseResult?.ok === true ? poseResult.value.pose : undefined;

  const liveFrame = useMemo(() => {
    if (scene === undefined || pose === undefined || framePx.widthPx === 0) return undefined;
    return liveOverlayScene(scene, pose, framePx);
    // `framePx` is rebuilt every render, so its two numbers are the dependencies.
  }, [scene, pose, framePx.widthPx, framePx.heightPx]);

  const layout: OverlayLayout | undefined = useMemo(() => {
    if (liveFrame?.ok !== true || scene === undefined) return undefined;
    return layoutOverlay(
      { ...liveFrame.overlay, peaks: selectOverlayPeaks(scene, true) },
      {
        frameMarginPx: Math.max(geometry.labelMarginPx, framePx.widthPx * 0.01),
        alwaysLabelPeakIds: fieldAnchorSummitId === undefined ? [] : [fieldAnchorSummitId],
      },
    );
  }, [liveFrame, scene, geometry.labelMarginPx, framePx.widthPx, fieldAnchorSummitId]);

  const overlaySvg = useMemo(
    () => (layout === undefined ? undefined : buildOverlaySvgFromLayout(layout)),
    [layout],
  );

  const marks: readonly CelestialMark[] = useMemo(() => {
    if (fix === undefined || pose === undefined || framePx.widthPx === 0) return [];
    return celestialMarks(
      new Date(),
      { lat: fix.lat, lon: fix.lon, heightM: fix.altitudeM ?? 0 },
      pose,
      framePx,
    );
    // `tick` is in the list on purpose: the Sun and Moon move with the clock,
    // which nothing else here reads.
  }, [fix, pose, framePx.widthPx, framePx.heightPx, tick]);

  const band = useMemo(() => {
    if (poseResult?.ok !== true || pose === undefined) return undefined;
    return liveUncertainty({
      heading: poseResult.value.heading,
      compassAccuracyDeg: sensorStatus?.compassAccuracyDeg,
      pitchSpreadDeg: poseResult.value.pitchSpreadDeg,
      fovSource: fov?.source ?? 'spec-sheet-guess',
      pitchBias,
      pose,
      framePx,
    });
  }, [poseResult, pose, fov?.source, pitchBias, sensorStatus?.compassAccuracyDeg, framePx.widthPx]);


  /* ── re-anchoring, for a compass that is grossly wrong ──────────────────── */
  /**
   * The pose's own history, one sample per redraw.
   *
   * The SENSED heading, not the drawn one: stillness is a property of the phone,
   * and a drag moves the labels without moving the phone.
   */
  useEffect(() => {
    if (pose === undefined || poseResult?.ok !== true) return;
    const trace = poseTraceRef.current;
    const tMs = performance.now();
    trace.push({
      tMs,
      headingDeg: poseResult.value.sensedPose.headingDeg,
      pitchDeg: poseResult.value.sensedPose.pitchDeg,
      rollDeg: pose.rollDeg,
    });
    while ((trace[0]?.tMs ?? tMs) < tMs - POSE_TRACE_MEMORY_MS) trace.shift();
  }, [tick, pose, poseResult]);

  const stillMs = stillForMs(poseTraceRef.current);
  const stillEnoughToReanchor = stillMs >= STILL_FOR_REANCHOR_MS;

  /** WMM2025's declination here, so a magnetic pose gets a magnetic reference. */
  const declinationDeg = useMemo(() => {
    if (fix === undefined) return undefined;
    return magneticDeclinationDeg(
      { latitudeDeg: fix.lat, longitudeDeg: fix.lon, heightM: fix.altitudeM ?? 0 },
      fix.when,
    );
  }, [fix]);

  const headingBasis = poseResult?.ok === true ? poseResult.value.heading.basis : undefined;
  const sunMark = marks.find((mark) => mark.body === 'sun');

  const sunReference = useMemo((): ReanchorReference | undefined => {
    if (sunMark === undefined || sunMark.belowHorizon || headingBasis === undefined) return undefined;
    const azimuthDeg = azimuthInBasis(sunMark.azimuthDeg, headingBasis, declinationDeg);
    if (azimuthDeg === undefined) return undefined;
    return { name: 'the sun', azimuthDeg, altitudeDeg: sunMark.altitudeDeg };
  }, [sunMark, headingBasis, declinationDeg]);

  /**
   * Every summit the sweep found, by name.
   *
   * Not the drawn ones: under a gross error the labels are in the wrong part of
   * the sky, and the summit the person recognises is usually one the app has
   * put somewhere else entirely or left off the frame.
   */
  const reanchorPeaks = useMemo(() => {
    if (scene === undefined) return [];
    return [...scene.peaks]
      .filter((peak) => peak.name.trim() !== '')
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [scene]);

  const summitReference = useMemo((): ReanchorReference | undefined => {
    if (headingBasis === undefined) return undefined;
    const peak = reanchorPeaks.find((candidate) => candidate.id === summitId);
    if (peak === undefined) return undefined;
    const azimuthDeg = azimuthInBasis(peak.bearingDeg, headingBasis, declinationDeg);
    if (azimuthDeg === undefined) return undefined;
    return { name: peak.name, azimuthDeg, altitudeDeg: peak.altitudeDeg };
  }, [headingBasis, declinationDeg, reanchorPeaks, summitId]);

  const reanchorReference =
    reanchorMode === 'sun' ? sunReference : reanchorMode === 'summit' ? summitReference : undefined;

  const applyReanchor = useCallback(
    (value: Reanchor, reference: ReanchorReference, source: 'sun' | 'summit') => {
      if (poseResult?.ok !== true) return;
      setGrossHeadingOffsetDeg(value.grossHeadingOffsetDeg);
      // The fine heading trim is cleared: a re-anchor replaces the whole
      // heading correction rather than adding to whatever was dragged in.
      setTrim((current) => ({ ...current, headingDeg: 0, pitchDeg: value.pitchTrimDeg }));
      setAnchor({
        sensedHeadingDeg: poseResult.value.sensedPose.headingDeg,
        yawDeg: tracesRef.current?.status().deviceYawDeg,
        source,
        referenceName: reference.name,
        offsetDeg: value.grossHeadingOffsetDeg,
      });
      setReanchorMode('off');
      setPendingReanchor(undefined);
      setGrossWarning(undefined);
      setReanchorNote(
        `The labels now line up with ${reference.name}. ${value.sentence}` +
          (value.pitchClamped
            ? ' The up-and-down part was bigger than the nudge allows, so only part of it was used.'
            : ''),
      );
    },
    [poseResult],
  );

  const onReanchorTap = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const layer = reanchorLayerRef.current;
      if (layer === null || pose === undefined || poseResult?.ok !== true) return;
      if (reanchorReference === undefined) {
        setReanchorNote(
          reanchorMode === 'summit'
            ? 'Pick the summit by name first.'
            : 'The sun is not up, or the app does not know which way north is yet.',
        );
        return;
      }
      const box = layer.getBoundingClientRect();
      const solved = reanchorFromTap({
        reference: reanchorReference,
        tappedPx: { xPx: event.clientX - box.left, yPx: event.clientY - box.top },
        sensedPose: poseResult.value.sensedPose,
        drawnHeadingDeg: pose.headingDeg,
        framePx,
        principalPointPx: geometry.principalPointPx,
        visibleHFovDeg: pose.hFovDeg,
      });
      if (!solved.ok) {
        setReanchorNote(solved.detail);
        return;
      }
      if (reanchorMode === 'sun') {
        applyReanchor(solved.value, reanchorReference, 'sun');
        return;
      }
      setPendingReanchor({ value: solved.value, reference: reanchorReference, source: 'summit' });
    },
    [
      pose,
      poseResult,
      reanchorReference,
      reanchorMode,
      framePx.widthPx,
      framePx.heightPx,
      geometry.principalPointPx,
      applyReanchor,
    ],
  );

  /**
   * Watch a tap on the picture for a gross compass error.
   *
   * Both sessions ask for taps on the real Sun to measure the field of view,
   * and the same tap solves a heading. A heading tens of degrees from the
   * sensed one is a broken compass, not a mis-measured lens.
   *
   * An UNATTRIBUTED tap counts, and so does one a mark more than 160 px away
   * claimed (`readsAsSunTap`). 160 px is about 17° at this field of view,
   * narrower than the 20° this warns about, so under a gross error the app's
   * own Sun disc is never that close to the tap. The home session attributes a
   * tap to the nearest mark at any distance, so a summit dot across the
   * picture would otherwise claim it. The step the person is on asks them to
   * tap the real Sun, so such a tap is read as one.
   */
  const notePictureTap = useCallback(
    (tappedPx: PointPx, reference: CalibrationReference | undefined) => {
      if (!readsAsSunTap(tappedPx, reference)) return;
      if (sunReference === undefined || pose === undefined || poseResult?.ok !== true) return;
      const solved = reanchorFromTap({
        reference: sunReference,
        tappedPx,
        sensedPose: poseResult.value.sensedPose,
        drawnHeadingDeg: pose.headingDeg,
        framePx,
        principalPointPx: geometry.principalPointPx,
        visibleHFovDeg: pose.hFovDeg,
      });
      if (!solved.ok) return;
      // Set unconditionally: a later tap that solves close to the sensed
      // heading clears a warning the first one raised.
      setGrossWarning(
        grossHeadingWarning(
          poseResult.value.sensedPose.headingDeg,
          solved.value.anchoredHeadingDeg,
        ),
      );
    },
    [sunReference, pose, poseResult, framePx.widthPx, framePx.heightPx, geometry.principalPointPx],
  );

  /** How far the compass has moved since the anchor was set. */
  const drift = useMemo(() => {
    if (anchor === undefined || poseResult?.ok !== true) return undefined;
    return anchorDrift({
      sensedHeadingDeg: poseResult.value.sensedPose.headingDeg,
      anchoredAtSensedHeadingDeg: anchor.sensedHeadingDeg,
      yawDeg: sensorStatus?.deviceYawDeg,
      anchoredAtYawDeg: anchor.yawDeg,
      bandDeg: band?.measuredDeg.horizontal ?? 0,
    });
  }, [anchor, poseResult, band, sensorStatus?.deviceYawDeg]);

  /** Put everything the person has changed back where the sensors say. */
  const clearAllTrim = useCallback(() => {
    setTrim(NO_TRIM);
    setGrossHeadingOffsetDeg(NO_GROSS_HEADING_OFFSET_DEG);
    setAnchor(undefined);
    setPendingReanchor(undefined);
    setReanchorMode('off');
    setReanchorNote(undefined);
  }, []);

  /* ── the drag (D9), at normal or fine gain ──────────────────────────────── */
  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      dragRef.current = {
        x: event.clientX,
        y: event.clientY,
        dx: 0,
        dy: 0,
        base: trim,
        startedAtMs: Date.now(),
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [trim],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (drag === undefined || pose === undefined) return;
      drag.dx = event.clientX - drag.x;
      drag.dy = event.clientY - drag.y;
      setTrim(
        trimFromDragAtGain(
          drag.base,
          { dx: drag.dx, dy: drag.dy },
          framePx,
          { hFovDeg: pose.hFovDeg, vFovDeg: pose.vFovDeg },
          dragGain(dragMode),
        ),
      );
    },
    [pose, framePx.widthPx, framePx.heightPx, dragMode],
  );

  /**
   * Close the drag and publish what it moved, relative to where it went down.
   *
   * The offset is what the home session's repeated-drag trials measure, and it
   * is relative on purpose: an offset from the start of a gesture says nothing
   * about where the phone was pointed. The degrees are worked out against the
   * trim this drag started from, so they are what this attempt contributed
   * rather than the total nudge in force.
   */
  const onPointerUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = undefined;
    if (drag === undefined || pose === undefined) return;
    if (drag.dx === 0 && drag.dy === 0) return;
    const offsetPx = { dx: drag.dx, dy: drag.dy };
    const after = trimFromDragAtGain(drag.base, offsetPx, framePx, pose, dragGain(dragMode));
    dragSerialRef.current += 1;
    setCompletedDrag({
      serial: dragSerialRef.current,
      mode: dragMode,
      offsetPx,
      offsetDeg: {
        headingDeg: after.headingDeg - drag.base.headingDeg,
        pitchDeg: after.pitchDeg - drag.base.pitchDeg,
      },
      durationMs: Date.now() - drag.startedAtMs,
    });
  }, [dragMode, pose, framePx.widthPx, framePx.heightPx]);

  /** A cancelled gesture is not an attempt: it is dropped rather than recorded. */
  const onPointerCancel = useCallback(() => {
    dragRef.current = undefined;
  }, []);

  /* ── calibrating the field of view from the drag ────────────────────────── */
  const storeCalibration = useCallback(() => {
    if (pose === undefined || decodedFrame.widthPx === 0) return;
    // The drag's field-of-view offset is a measurement of the VISIBLE box, so
    // it is converted back to the whole decoded frame before being stored —
    // that is what the key describes and what the next session will crop again.
    const RAD = Math.PI / 180;
    const uncrop = geometry.visibleFraction.x > 0 ? geometry.visibleFraction.x : 1;
    const frameHFovDeg =
      (2 * Math.atan(Math.tan((pose.hFovDeg * RAD) / 2) / uncrop)) / RAD;
    const stored = writeStoredFovCalibration(
      typeof localStorage === 'undefined' ? undefined : localStorage,
      calibrationStoreKey,
      {
        frameHFovDeg,
        frameWidthPx: decodedFrame.widthPx,
        frameHeightPx: decodedFrame.heightPx,
        method: 'set by hand on this screen',
      },
    );
    setCalibrationNote(
      stored
        ? `Saved ${formatDeg(frameHFovDeg, 2)} across the camera frame for this lens and resolution.`
        : 'This browser would not save the setting, so it is in use for this session only.',
    );
    setCalibration({
      frameHFovDeg,
      frameWidthPx: decodedFrame.widthPx,
      frameHeightPx: decodedFrame.heightPx,
      method: 'set by hand on this screen',
    });
    setTrim((current) => ({ ...current, hFovDeg: 0 }));
  }, [pose, decodedFrame, geometry.visibleFraction.x, calibrationStoreKey]);

  /* ── the home session's three seams ─────────────────────────────────────── */
  /**
   * Every mark a tap could be about: the two discs, including one drawn just
   * above or below the picture (`isTappableMark`), plus every summit the
   * renderer put a dot on. A summit is on the same footing as the Sun here —
   * that is the landmark sweep, and it needs no arithmetic of its own.
   */
  const calibrationReferences = useCallback(
    (): readonly CalibrationReference[] => [
      ...marks
        .filter((mark) => pose !== undefined && isTappableMark(mark, pose, framePx))
        .map((mark) => ({
          kind: mark.body,
          name: mark.body === 'sun' ? 'the Sun' : 'the Moon',
          drawnPx: mark.centrePx,
        })),
      ...(layout?.markers ?? []).map((marker) => ({
        kind: 'summit' as const,
        name: marker.peak.name,
        drawnPx: marker.summitPx,
      })),
    ],
    [marks, layout, pose, framePx.widthPx],
  );

  const calibrationFrame = useCallback((): CalibrationFrame | undefined => {
    if (pose === undefined || framePx.widthPx === 0 || decodedFrame.widthPx === 0) return undefined;
    return {
      framePx,
      principalPointPx: geometry.principalPointPx,
      // The field of view the marks were DRAWN with, trim included, because the
      // fit corrects what is on screen rather than what the guess said.
      visibleFov: { hFovDeg: pose.hFovDeg, vFovDeg: pose.vFovDeg },
      visibleFractionX: geometry.visibleFraction.x,
      decodedFrame,
    };
  }, [pose, framePx.widthPx, framePx.heightPx, geometry, decodedFrame]);

  const applyFovFit = useCallback(
    (fit: FovFit, taps: readonly CalibrationTap[]) => {
      const frame = calibrationFrame();
      if (frame === undefined) return;
      const references = taps.map((tap) => tap.reference);
      const measured = calibrationFromFit(fit, frame, references);
      const stored = writeStoredFovCalibration(
        typeof localStorage === 'undefined' ? undefined : localStorage,
        calibrationStoreKey,
        measured,
      );
      setCalibration(measured);
      setCalibrationNote(
        stored
          ? `Measured ${formatDeg(measured.frameHFovDeg, 2)} across the camera frame — ${measured.method}.`
          : `Measured ${formatDeg(measured.frameHFovDeg, 2)} across the camera frame, but this ` +
            'browser would not save it, so it lasts for this session only.',
      );
      // The fit was made against the pose as drawn, trim and all, so its two
      // offsets are added to the trim already in force. The width goes into the
      // calibration instead of the field-of-view nudge, which is reset.
      setTrim((current) => ({
        headingDeg: current.headingDeg + fit.trim.headingDeg,
        pitchDeg: current.pitchDeg + fit.trim.pitchDeg,
        hFovDeg: 0,
      }));
      // The fit is the only place the tilt zero point is measured, and applying
      // it is the moment the number exists. `trim` is the nudge the marks were
      // drawn through, so the recorder gets both halves of the correction and
      // the raw taps behind them; `estimatePitchBiasFromFovFit` reads the bias
      // back out of them.
      recorder.recordFovFit({
        trimDeg: { headingDeg: fit.trim.headingDeg, pitchDeg: fit.trim.pitchDeg },
        trimInForceDeg: { headingDeg: trim.headingDeg, pitchDeg: trim.pitchDeg },
        focalPx: fit.focalPx,
        residualPx: fit.residualPx,
        taps: taps.map((tap) => ({
          kind: tap.reference.kind,
          drawnPx: { xPx: tap.reference.drawnPx.xPx, yPx: tap.reference.drawnPx.yPx },
          tappedPx: { xPx: tap.tappedPx.xPx, yPx: tap.tappedPx.yPx },
        })),
      });
    },
    [calibrationFrame, calibrationStoreKey, recorder, trim.headingDeg, trim.pitchDeg],
  );

  const shareTarget = useMemo(
    () =>
      browserShareTarget(
        typeof navigator === 'undefined' ? undefined : navigator,
        typeof document === 'undefined' ? undefined : document,
      ),
    [],
  );

  /**
   * The Sun's magnetic azimuth here and now, with the position and the instant
   * thrown away. Only the three numbers cross into the recorder.
   */
  const knownBearingNow = useCallback(() => {
    if (fix === undefined) return undefined;
    return sunKnownBearing(new Date(), {
      lat: fix.lat,
      lon: fix.lon,
      heightM:
        scene === undefined
          ? (fix.altitudeM ?? 0)
          : scene.observer.groundElevationM + scene.observer.eyeHeightM,
    });
  }, [fix, scene]);

  const heightNote =
    scene === undefined ? undefined : groundHeightNote(scene.observer, scene.observerResolution);

  /**
   * The drag's current step size, and the roll the trials sample.
   *
   * The step size is stated for the mode in force rather than for both, because
   * what a person needs to know while dragging is how far this gesture moves the
   * labels. The roll goes into a ref: the trials sample it ten times a second,
   * and a state variable would re-render the whole screen at that rate.
   */
  const stepSize = useMemo(
    () =>
      pose === undefined
        ? undefined
        : dragStepSize(framePx, pose, dragGain(dragMode)),
    [pose, framePx.widthPx, dragMode],
  );
  rollRef.current = pose?.rollDeg;
  const readRollDeg = useCallback(() => rollRef.current, []);

  /* ── the field session's three seams ────────────────────────────────────── */
  /**
   * Encode the camera frame at the video track's OWN size, not the viewport's.
   *
   * The pre-registration stores each capture at the track's full width, at least
   * 1920 px, because truth is a pixel two people pick out of the frame by eye
   * (§ 2.0). Drawing the viewport instead would throw away half the precision
   * the verdicts are read at. The overlay is not drawn onto it: an annotator
   * works from the bare frame and must not see what the app claimed.
   */
  const captureCameraFrame = useCallback(async (): Promise<CapturedFrame | undefined> => {
    const video = videoRef.current;
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) return undefined;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const drawing = canvas.getContext('2d');
    if (drawing === null) return undefined;
    drawing.drawImage(video, 0, 0, canvas.width, canvas.height);
    const bytes = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', FRAME_QUALITY);
    });
    if (bytes === null) return undefined;
    return { widthPx: canvas.width, heightPx: canvas.height, bytes };
  }, []);

  const readTickTimesMs = useCallback((): readonly number[] => tickTimesRef.current, []);
  const readNowMs = useCallback(() => performance.now(), []);
  /**
   * Clear the drag, keeping any re-anchor.
   *
   * The field session's repeated drags start from the same place each time, and
   * that place is the anchored pose rather than the raw compass. The screen's
   * own undo button clears both; this one is the session's.
   */
  const resetTrim = useCallback(() => setTrim(NO_TRIM), []);

  const bundleShareTarget = useMemo(
    () =>
      browserBundleShareTarget(
        typeof navigator === 'undefined' ? undefined : navigator,
        typeof document === 'undefined' ? undefined : document,
      ),
    [],
  );

  /**
   * Everything a field capture records, as one value.
   *
   * Every field is named rather than an upstream object being handed over: the
   * overlay's peaks carry `bearingDeg` and the camera track carries `deviceId`,
   * and the bundle parser refuses both.
   */
  const fieldContext: FieldCaptureContext | undefined = useMemo(() => {
    if (
      poseResult?.ok !== true ||
      pose === undefined ||
      layout === undefined ||
      band === undefined ||
      scene === undefined ||
      fov === undefined ||
      framePx.widthPx === 0
    ) {
      return undefined;
    }
    const unmeasured: readonly UnmeasuredSummit[] = scene.unmeasured.map((peak) => ({
      id: peak.id,
      name: peak.name,
      distanceKm: peak.distanceKm,
    }));
    return {
      pose,
      headingBasis: poseResult.value.heading.basis,
      trim: { headingDeg: trim.headingDeg, pitchDeg: trim.pitchDeg },
      grossHeadingOffsetDeg,
      grossHeadingSource: anchor?.source ?? 'sensors',
      overlayPx: { widthPx: framePx.widthPx, heightPx: framePx.heightPx },
      band,
      layout,
      unmeasured,
      track: trackSettings,
      fovSource: fov.source,
      sweepRadiusKm: scene.config.sweep.maxRangeKm,
      ...(fix?.accuracyM === undefined ? {} : { horizontalAccuracyM: fix.accuracyM }),
      ...(sensorStatus?.compassAccuracyDeg === undefined
        ? {}
        : { compassAccuracyDeg: sensorStatus.compassAccuracyDeg }),
    };
  }, [
    poseResult,
    pose,
    layout,
    band,
    scene,
    fov,
    trim.headingDeg,
    trim.pitchDeg,
    grossHeadingOffsetDeg,
    anchor?.source,
    framePx.widthPx,
    framePx.heightPx,
    trackSettings,
    fix?.accuracyM,
    sensorStatus?.compassAccuracyDeg,
  ]);

  const manifestUrl =
    props.terrainManifestUrl ??
    resolveFromBase(import.meta.env.BASE_URL, DEFAULT_TERRAIN_MANIFEST_URL);

  /* ── which refusal, if any, stops the drawing ───────────────────────────── */
  const activeRefusal: LiveRefusalCode | undefined = (() => {
    // Ordered by what the user has to do FIRST, not by which check is cheapest.
    // An insecure origin is the one state no action of theirs can fix, so it
    // leads. Then turning the phone: nothing else on this screen is usable in
    // portrait, including the permission prompts, so it outranks even
    // "tap Start" and a camera that was refused.
    if (blockingRefusal === 'insecure-context') return blockingRefusal;
    if (!landscape) return 'portrait';
    if (blockingRefusal !== undefined) return blockingRefusal;
    if (phase !== 'running') return 'not-started';
    if (fov === undefined) return 'waiting-for-camera';
    if (poseResult === undefined) return 'no-orientation';
    if (!poseResult.ok) {
      // A heading route that refused for a reason of its own says more than the
      // fusion's "needs-declination", so it wins when there is one.
      const web = sensorStatus?.headingRefusal;
      return web === undefined ? poseResult.refusal : refusalForWebSample(web);
    }
    if (sceneError !== undefined) return 'no-terrain';
    if (fix === undefined) return 'waiting-for-fix';
    if (scene === undefined) return 'building-terrain';
    return undefined;
  })();

  const refusal = activeRefusal === undefined ? undefined : liveRefusal(activeRefusal);
  const bandHalfWidthPx = band === undefined ? 0 : horizontalBandHalfWidthPx(band, framePx);
  const movedM =
    fix === undefined || scene === undefined
      ? 0
      : metresFromFix({ lat: scene.observer.lat, lon: scene.observer.lon }, fix);

  return (
    <div className="live" data-testid="live-root" data-phase={phase}>
      {/* The probe the safe-area insets are measured off. */}
      <div ref={insetProbeRef} className="live__inset-probe" aria-hidden="true" />

      <video
        ref={videoRef}
        className="live__video"
        data-testid="live-video"
        playsInline
        muted
        autoPlay
        onLoadedMetadata={onVideoMetadata}
        onResize={onVideoMetadata}
      />

      {overlaySvg !== undefined && (
        <div
          className="live__layer"
          data-testid="live-overlay-svg"
          // Our own pure renderer's output, not user input and not the network.
          dangerouslySetInnerHTML={{ __html: overlaySvg }}
        />
      )}

      {pose !== undefined && framePx.widthPx > 0 && (
        <svg
          className="live__layer"
          data-testid="live-marks"
          viewBox={`0 0 ${framePx.widthPx} ${framePx.heightPx}`}
          width={framePx.widthPx}
          height={framePx.heightPx}
        >
          {bandHalfWidthPx > 0 && (
            <rect
              data-testid="live-band"
              data-half-width-px={bandHalfWidthPx}
              x={framePx.widthPx / 2 - bandHalfWidthPx}
              y={0}
              width={bandHalfWidthPx * 2}
              height={framePx.heightPx}
              className="live__band"
            />
          )}
          <line
            className="live__crosshair"
            x1={geometry.principalPointPx.xPx}
            y1={geometry.principalPointPx.yPx - 12}
            x2={geometry.principalPointPx.xPx}
            y2={geometry.principalPointPx.yPx + 12}
          />
          {marks
            .filter((mark) => mark.inFrame && !mark.belowHorizon)
            .map((mark) => (
              <circle
                key={mark.body}
                data-testid={`live-mark-${mark.body}`}
                data-radius-px={mark.radiusPx}
                data-azimuth-deg={mark.azimuthDeg}
                data-altitude-deg={mark.altitudeDeg}
                cx={mark.centrePx.xPx}
                cy={mark.centrePx.yPx}
                r={mark.radiusPx}
                className={`live__disc live__disc--${mark.body}`}
              />
            ))}
        </svg>
      )}

      {/* Above the drag layer while a re-anchor is armed: a finger on the
          picture then means "the real thing is here" rather than "push the
          labels", and the two cannot share one surface. */}
      {reanchorMode !== 'off' && (
        <div
          ref={reanchorLayerRef}
          className="live__session-taps"
          data-testid="live-reanchor-tap-layer"
          onPointerUp={onReanchorTap}
        />
      )}

      <div
        className="live__drag"
        data-testid="live-drag"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      />

      {/*
        The chrome is two strips pinned to the top and bottom edges, not one
        column. A landscape phone screen is about 400 px tall, and a column of
        readouts fills it: the first draft covered the horizon the labels are
        drawn on, which is the one part of the screen this app exists to show.
        So the middle stays clear, the bottom strip is capped and scrolls, and
        the prose that explains the numbers is behind a disclosure — everything
        except D9's own sentence, which stays on screen because a band the user
        never reads is a band that was not shown.
      */}
      <div className="live__chrome live__chrome--top">
        <header className="live__header">
          <h1 data-testid="live-title">Mountain Finder — live</h1>
          {phase === 'idle' && (
            <button type="button" data-testid="live-start" onClick={() => void start()}>
              Start
            </button>
          )}
        </header>

        {refusal !== undefined && (
          <section
            className={`live__refusal live__refusal--${refusal.transient ? 'wait' : 'stop'}`}
            data-testid="live-refusal"
            data-refusal-code={refusal.code}
            data-transient={String(refusal.transient)}
            role="status"
          >
            <h2 data-testid="live-refusal-headline">{refusal.headline}</h2>
            <p data-testid="live-refusal-why">{refusal.why}</p>
            <p data-testid="live-refusal-todo">
              <strong>{refusal.whatToDo}</strong>
            </p>
            <p className="live__detail" data-testid="live-refusal-detail">
              {refusal.detail}
            </p>
          </section>
        )}

        {homeSession && (
          <HomeSessionPanel
            recorder={recorder}
            ready={phase === 'running'}
            device={typeof navigator === 'undefined' ? 'unknown browser' : navigator.userAgent}
            canComputeBearing={fix !== undefined}
            computeKnownBearing={knownBearingNow}
            calibrationReferences={calibrationReferences}
            calibrationFrame={calibrationFrame}
            onCalibrated={applyFovFit}
            onPictureTap={notePictureTap}
            onPitchMeasured={applyPitchBias}
            shareTarget={shareTarget}
            completedDrag={completedDrag}
            dragMode={dragMode}
            setDragMode={setDragMode}
            readRollDeg={readRollDeg}
          />
        )}

        {fieldSession && (
          <FieldSessionPanel
            ready={phase === 'running'}
            device={typeof navigator === 'undefined' ? 'unknown browser' : navigator.userAgent}
            context={fieldContext}
            peakRegions={props.peakRegions ?? []}
            captureFrame={captureCameraFrame}
            nowMs={readNowMs}
            tickTimesMs={readTickTimesMs}
            shareTarget={bundleShareTarget}
            calibrationReferences={calibrationReferences}
            calibrationFrame={calibrationFrame}
            onCalibrated={applyFovFit}
            onPictureTap={notePictureTap}
            dragMode={dragMode}
            setDragMode={setDragMode}
            resetTrim={resetTrim}
            onAnchorSummit={setFieldAnchorSummitId}
          />
        )}

        {phase === 'idle' && activeRefusal === 'not-started' && (
          <ol className="live__steps" data-testid="live-steps">
            <li>Hold the phone sideways, like taking a landscape photo.</li>
            <li>Tap Start.</li>
            <li>Tap Allow when the phone asks to use the camera.</li>
            <li>Tap Allow when it asks about motion and orientation.</li>
            <li>Tap Allow when it asks for your location.</li>
            <li>Hold the phone up to the view. Push the labels with a finger to line them up.</li>
          </ol>
        )}
      </div>

      <div className="live__chrome live__chrome--bottom">
        {lensWarning !== undefined && (
          <p className="live__warn" data-testid="live-lens-warning">
            {lensWarning}
          </p>
        )}

        {lensSwitchWarning(lensLog) !== undefined && (
          <p className="live__warn" data-testid="live-lens-switch" data-switch-count={lensLog.switches.length}>
            {lensSwitchWarning(lensLog)}
          </p>
        )}

        {sceneError !== undefined && (
          <p className="live__warn" data-testid="live-scene-error">
            {sceneError}
          </p>
        )}

        {movedM > RESWEEP_DISTANCE_M && (
          <p className="live__warn" data-testid="live-moved">
            You have moved {movedM.toFixed(0)} m from where the skyline was worked out. The far
            summits are unaffected; the nearest ridges may be a little off.
          </p>
        )}

        {heightNote !== undefined && (
          <p
            className={heightNote.warn ? 'live__warn' : 'live__hidden-note'}
            data-testid="live-ground-height"
            data-ground-source={heightNote.source}
          >
            {heightNote.text}
          </p>
        )}

        {poseResult?.ok === true && pose !== undefined && (
          <section className="live__readout">
            <p
              className="live__status"
              data-testid="live-pose"
              data-heading-deg={pose.headingDeg}
              data-pitch-deg={pose.pitchDeg}
              data-roll-deg={pose.rollDeg}
              data-hfov-deg={pose.hFovDeg}
              data-vfov-deg={pose.vFovDeg}
              data-sensed-heading-deg={poseResult.value.sensedPose.headingDeg}
              data-principal-x-px={geometry.principalPointPx.xPx}
              data-principal-y-px={geometry.principalPointPx.yPx}
              data-visible-fraction-x={geometry.visibleFraction.x}
              data-visible-fraction-y={geometry.visibleFraction.y}
            >
              <strong>{formatDeg(pose.headingDeg)}</strong>{' '}
              <span
                className={`live__basis live__basis--${poseResult.value.heading.basis}`}
                data-testid="live-heading-basis"
                data-basis={poseResult.value.heading.basis}
              >
                {poseResult.value.heading.basis === 'true'
                  ? 'north from the phone'
                  : poseResult.value.heading.basis === 'true-model'
                    ? 'true north (WMM)'
                    : 'MAG'}
              </span>{' '}
              · {formatDeg(pose.pitchDeg)} up · field {formatDeg(pose.hFovDeg)} ×{' '}
              {formatDeg(pose.vFovDeg)}
              {fov !== undefined && fov.source === 'spec-sheet-guess' ? ' (uncalibrated)' : ''}
            </p>
            {/* D9's own sentence stays on screen. Everything that EXPLAINS it
                goes behind the disclosure below, because six paragraphs of
                prose on a 400 px screen hide the mountains they describe. */}
            {band !== undefined && (
              <p
                className="live__band-note"
                data-testid="live-uncertainty"
                data-frame-fraction={band.frameFraction.horizontal}
              >
                {band.summary}
              </p>
            )}
            <details className="live__why">
              <summary>Why the labels might be off</summary>
              <p data-testid="live-heading-caveat">{poseResult.value.heading.caveat}</p>
              {poseResult.value.rollAssumedLevel && (
                <p data-testid="live-roll-assumed">
                  The phone is too near straight up or down to read its sideways tilt, so the
                  overlay is drawn level.
                </p>
              )}
              {fov !== undefined && (
                <p data-testid="live-fov-label" data-fov-source={fov.source}>
                  {fov.label}
                </p>
              )}
              {/* Named one by one rather than left to the band's own "treat this
                  as a minimum" sentence. That sentence says some error has no
                  figure; it does not say which, and an unchecked tilt sensor is
                  a different problem from an unmeasured lens. */}
              {band?.terms.map((term, index) =>
                term.basis.kind === 'unquantified' ? (
                  <p
                    key={`${term.axis}-${index}`}
                    data-testid="live-unquantified-term"
                    data-axis={term.axis}
                  >
                    {term.label}. {term.basis.note}
                  </p>
                ) : null,
              )}
              {marks.map((mark) =>
                mark.inFrame && !mark.belowHorizon ? null : (
                  <p key={mark.body} data-testid={`live-mark-note-${mark.body}`}>
                    {offFrameDirection(mark, pose).text}
                  </p>
                ),
              )}
              <p data-testid="live-scene-state-note">
                {scene === undefined
                  ? 'The skyline around you has not been worked out yet.'
                  : `The skyline was swept ${scene.config.sweep.spanDeg}° around you in ` +
                    `${(sweepMs ?? 0).toFixed(0)} ms, so turning does not need it done again.`}
              </p>
            </details>
          </section>
        )}

        {/* The nudge and its undo stay out of Settings: dragging is the main
            interaction on this screen (D9), so putting its undo behind a
            disclosure would hide the control people reach for most. */}
        <p
          className="live__nudge"
          data-testid="live-trim"
          data-heading-deg={trim.headingDeg}
          data-pitch-deg={trim.pitchDeg}
          data-hfov-deg={trim.hFovDeg}
        >
          Your nudge: {formatDeg(trim.headingDeg, 2)} across, {formatDeg(trim.pitchDeg, 2)} up.{' '}
          <button
            type="button"
            data-testid="live-reset-trim"
            disabled={isUntrimmed(trim) && grossHeadingOffsetDeg === NO_GROSS_HEADING_OFFSET_DEG}
            onClick={clearAllTrim}
          >
            Put the labels back where the sensors say
          </button>
        </p>

        {/* Fixing the direction sits beside the nudge, not in Settings. A
            quarter-turn compass error makes every label on screen wrong, so the
            way out of it has to be where the person is already looking. */}
        {poseResult?.ok === true && (
          <section
            className="live__nudge"
            data-testid="live-reanchor"
            data-mode={reanchorMode}
            data-gross-offset-deg={grossHeadingOffsetDeg}
            data-still-ms={Math.round(stillMs)}
            data-anchor-source={anchor?.source ?? ''}
          >
            {grossWarning !== undefined && (
              <p className="live__warn" data-testid="live-gross-warning">
                {grossWarning}
              </p>
            )}

            {reanchorMode === 'off' && (
              <>
                <p>
                  Labels pointing the wrong way?{' '}
                  {stillEnoughToReanchor
                    ? 'Fix the direction by tapping something you can name.'
                    : `Hold the phone still for ${Math.max(
                        1,
                        Math.ceil((STILL_FOR_REANCHOR_MS - stillMs) / 1000),
                      )} more second(s) first.`}
                </p>
                <button
                  type="button"
                  data-testid="live-reanchor-sun"
                  disabled={!stillEnoughToReanchor || sunReference === undefined}
                  onClick={() => {
                    setReanchorNote(undefined);
                    setReanchorMode('sun');
                  }}
                >
                  Fix direction — tap the sun
                </button>{' '}
                <button
                  type="button"
                  data-testid="live-reanchor-summit"
                  disabled={!stillEnoughToReanchor || reanchorPeaks.length === 0}
                  onClick={() => {
                    setReanchorNote(undefined);
                    setReanchorMode('summit');
                  }}
                >
                  Fix direction — tap a summit you know
                </button>
              </>
            )}

            {reanchorMode === 'sun' && (
              <p data-testid="live-reanchor-prompt">
                Tap the middle of the real sun in the picture.{' '}
                <button type="button" data-testid="live-reanchor-cancel" onClick={() => setReanchorMode('off')}>
                  Cancel
                </button>
              </p>
            )}

            {reanchorMode === 'summit' && (
              <>
                <label data-testid="live-reanchor-summit-picker">
                  Which summit?{' '}
                  <select
                    data-testid="live-reanchor-summit-name"
                    value={summitId}
                    onChange={(event) => setSummitId(event.target.value)}
                  >
                    <option value="">Pick one by name</option>
                    {reanchorPeaks.map((peak) => (
                      <option key={peak.id} value={peak.id}>
                        {peak.name} ({peak.distanceKm.toFixed(0)} km)
                      </option>
                    ))}
                  </select>
                </label>
                <p data-testid="live-reanchor-prompt">
                  {summitReference === undefined
                    ? 'Pick the summit by name, then tap it in the picture.'
                    : `Now tap ${summitReference.name} in the picture.`}{' '}
                  <button type="button" data-testid="live-reanchor-cancel" onClick={() => setReanchorMode('off')}>
                    Cancel
                  </button>
                </p>
              </>
            )}

            {pendingReanchor !== undefined && (
              <p data-testid="live-reanchor-confirm" data-move-deg={pendingReanchor.value.moveDeg}>
                {pendingReanchor.value.sentence}{' '}
                <button
                  type="button"
                  data-testid="live-reanchor-confirm-yes"
                  onClick={() =>
                    applyReanchor(
                      pendingReanchor.value,
                      pendingReanchor.reference,
                      pendingReanchor.source,
                    )
                  }
                >
                  Yes, turn them
                </button>{' '}
                <button
                  type="button"
                  data-testid="live-reanchor-confirm-no"
                  onClick={() => setPendingReanchor(undefined)}
                >
                  No, leave them
                </button>
              </p>
            )}

            {reanchorNote !== undefined && <p data-testid="live-reanchor-note">{reanchorNote}</p>}

            {anchor !== undefined && drift !== undefined && (
              <p
                className={drift.beyondBand ? 'live__warn' : undefined}
                data-testid="live-anchor-drift"
                data-gap-deg={drift.gapDeg}
                data-turn-deg={drift.turnDeg ?? ''}
                data-drift-deg={drift.driftDeg ?? ''}
                data-beyond-band={String(drift.beyondBand)}
              >
                Direction fixed on {anchor.referenceName}, {Math.abs(anchor.offsetDeg).toFixed(0)}°{' '}
                {anchor.offsetDeg < 0 ? 'left' : 'right'} of what the compass said. {drift.text}
              </p>
            )}
          </section>
        )}

        {/* Fine drag sits beside the nudge rather than in Settings, for the same
            reason the undo does: it is part of the gesture, and the step size is
            only useful while someone is making it. */}
        <p className="live__nudge" data-testid="live-drag-mode" data-mode={dragMode}>
          <button
            type="button"
            data-testid="live-fine-drag"
            aria-pressed={dragMode === 'fine'}
            onClick={() => setDragMode((current) => (current === 'fine' ? 'normal' : 'fine'))}
          >
            {dragMode === 'fine'
              ? 'Fine drag is ON — tap for normal speed'
              : `Fine drag is OFF — tap for ${FINE_DRAG_FACTOR}× slower`}
          </button>{' '}
          {stepSize !== undefined && (
            <span
              data-testid="live-drag-step"
              data-per-px-deg={stepSize.perPxDeg}
              data-per-mm-deg={stepSize.perMmDeg}
            >
              {dragStepSentence(dragMode, stepSize)}
            </span>
          )}
        </p>

        {layout !== undefined && (
          <p
            className="live__labels"
            data-testid="live-labels"
            data-label-count={layout.markers.length}
            data-off-frame-count={layout.offFramePeaks.length}
            data-crowded-out-count={layout.crowdedOutSummits.length}
          >
            {layout.markers.length} summit{layout.markers.length === 1 ? '' : 's'} labelled
            {layout.markers.length > 0
              ? `: ${layout.markers.map((marker) => marker.peak.name).join(', ')}`
              : ''}
            .
          </p>
        )}

        <p
          className="live__hidden-note"
          data-testid="live-scene-state"
          data-scene={
            sceneError !== undefined ? 'error' : scene === undefined ? 'building' : 'ready'
          }
          data-sweep-ms={sweepMs ?? ''}
          data-sweep-span-deg={scene?.config.sweep.spanDeg ?? ''}
          data-rays-requested={scene?.sweep.raysRequested ?? ''}
          data-rays-with-terrain={scene?.sweep.raysWithTerrain ?? ''}
          data-max-range-km={scene?.config.sweep.maxRangeKm ?? ''}
        >
          {scene === undefined
            ? 'Skyline not worked out yet.'
            : `Skyline swept ${scene.config.sweep.spanDeg}° around you in ` +
              `${(sweepMs ?? 0).toFixed(0)} ms.`}
        </p>

        {/* The radius stays on screen rather than in the disclosure. A label 56 km
            away and a label 6 km away look the same, and how far the app looked
            is the difference between "that mountain is not drawn" and "that
            mountain is outside what this deployment measured". */}
        {scene !== undefined && (
          <p
            className="live__status"
            data-testid="live-sweep-range"
            data-max-range-km={scene.config.sweep.maxRangeKm}
          >
            {sweepRangeSentence(scene.config.sweep.maxRangeKm)}
          </p>
        )}

        <OfflinePanel
          at={fix === undefined ? undefined : { lat: fix.lat, lon: fix.lon }}
          manifestUrl={manifestUrl}
        />

        <p
          className="live__hidden-note"
          data-testid="live-session-log"
          data-entry-count={lensLog.entries.length}
          data-switch-count={lensLog.switches.length}
          data-orientation-events={sensorStatus?.counts.orientation ?? 0}
          data-motion-events={sensorStatus?.counts.motion ?? 0}
          data-heading-route={sensorStatus?.headingRoute ?? ''}
          data-screen-angle-deg={sensorStatus?.screenAngleDeg ?? 0}
        >
          Camera checked {lensLog.entries.length} time{lensLog.entries.length === 1 ? '' : 's'},{' '}
          {lensLog.switches.length} lens change{lensLog.switches.length === 1 ? '' : 's'}.
        </p>

        <details className="live__settings">
          <summary>Settings</summary>
          <label>
            Phone
            <select
              data-testid="live-model"
              value={modelName}
              onChange={(event) => {
                setModelName(event.target.value);
                setLensLabel(phoneModelPreset(event.target.value).lenses[0]?.label ?? DEFAULT_LENS_LABEL);
              }}
            >
              {PHONE_MODEL_PRESETS.map((preset) => (
                <option key={preset.modelName} value={preset.modelName}>
                  {preset.modelName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lens
            <select
              data-testid="live-lens"
              value={lensLabel}
              onChange={(event) => setLensLabel(event.target.value)}
            >
              {phoneModelPreset(modelName).lenses.map((lens) => (
                <option key={lens.label} value={lens.label}>
                  {lens.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            data-testid="live-flip-roll"
            onClick={() =>
              setRollHypothesis((current) =>
                current === 'add-screen-angle' ? 'subtract-screen-angle' : 'add-screen-angle',
              )
            }
            data-roll-hypothesis={rollHypothesis}
          >
            Overlay upside down? Tap to flip
          </button>
          <button type="button" data-testid="live-save-fov" onClick={storeCalibration}>
            Labels too far apart? Line them up, then save the width
          </button>
          {calibrationNote !== undefined && (
            <p data-testid="live-calibration-note">{calibrationNote}</p>
          )}
        </details>
      </div>
    </div>
  );
}
