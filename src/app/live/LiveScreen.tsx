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
import { NO_TRIM, isUntrimmed, type TrimState } from '../trim';
import { BrowserSensorTraces, requestMotionPermission, type RawEventSink } from './browser-sensors';
import { CameraOpenError, openRearCamera, readTrackSettings, TRACK_POLL_INTERVAL_MS } from './camera-stream';
import { celestialMarks, offFrameDirection, type CelestialMark } from './celestial-markers';
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
import type { CalibrationFrame, CalibrationReference, FovFit } from './fov-calibration';
import { calibrationFromFit } from './fov-calibration';
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

  const landscape = isLandscapeViewport(viewport.widthPx, viewport.heightPx);

  /* ── the home session ───────────────────────────────────────────────────── */
  const homeSession =
    props.homeSession ??
    (typeof window === 'undefined' ? false : isHomeSessionRequested(window.location.search));
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
    const handle = window.setInterval(() => setTick((value) => value + 1), REDRAW_INTERVAL_MS);
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
    });
    // `tick` is what drives this: the traces are a mutable object the listeners
    // append to, so there is nothing else for a dependency array to notice.
  }, [tick, fix, fov, rollHypothesis, trim, phase]);

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
      { frameMarginPx: Math.max(geometry.labelMarginPx, framePx.widthPx * 0.01) },
    );
  }, [liveFrame, scene, geometry.labelMarginPx, framePx.widthPx]);

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
      pose,
      framePx,
    });
  }, [poseResult, pose, fov?.source, sensorStatus?.compassAccuracyDeg, framePx.widthPx]);

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
   * Every mark a tap could be about: the two discs, plus every summit the
   * renderer put a dot on. A summit is on the same footing as the Sun here —
   * that is the landmark sweep, and it needs no arithmetic of its own.
   */
  const calibrationReferences = useCallback(
    (): readonly CalibrationReference[] => [
      ...marks
        .filter((mark) => mark.inFrame && !mark.belowHorizon)
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
    [marks, layout],
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
    (fit: FovFit, references: readonly CalibrationReference[]) => {
      const frame = calibrationFrame();
      if (frame === undefined) return;
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
    },
    [calibrationFrame, calibrationStoreKey],
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
            shareTarget={shareTarget}
            completedDrag={completedDrag}
            dragMode={dragMode}
            setDragMode={setDragMode}
            readRollDeg={readRollDeg}
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
            disabled={isUntrimmed(trim)}
            onClick={() => setTrim(NO_TRIM)}
          >
            Put the labels back where the sensors say
          </button>
        </p>

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
