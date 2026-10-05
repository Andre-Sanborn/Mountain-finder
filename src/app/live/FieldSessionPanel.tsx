/**
 * The guided field session, on screen — one step at a time, then Share.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS COMPONENT OWNS
 * ═══════════════════════════════════════════════════════════════════════════
 * The sequence and nothing else. The script and the capture builder are in
 * `field-session.ts`, the bundle schema and its parser are in
 * `src/live/field-analysis.ts`, the field of view comes from
 * `fov-calibration.ts`, and the two ways off the phone are in `field-share.ts`.
 * What is left here is a step index, a list of captures, and the three screens a
 * person sees: what is about to be recorded, the step they are on, and the
 * finished bundle.
 *
 * ── THE ORDER OF THE THREE SCREENS ─────────────────────────────────────────
 * What is stored comes BEFORE the first capture, because consent given
 * afterwards is not consent. The field statement has a line the home session
 * does not need: a capture keeps the camera frame, and a photograph of a skyline
 * shows where it was taken. Then the steps. Then Share, and only Share.
 *
 * ── THE PAN TARGET IS A NUMBER THE PERSON WATCHES ──────────────────────────
 * F4 asks for a pan "until the anchor summit sits at the frame edge", and the
 * target is `u ≥ 0.8` of the half-frame, read from the overlay as drawn. So the
 * screen shows u as the person turns and says when it is reached. Gating on the
 * pan ANGLE would gate the sensors' account of the motion inside a criterion
 * whose subject is the drag.
 *
 * ── WHY THE ANCHOR IS CHOSEN BY TAPPING, NOT GUESSED ───────────────────────
 * An after-drag capture must name the summit it was anchored on, and only the
 * person knows which one they were certain of. Guessing it from where the finger
 * went down would be wrong in exactly the crowded frames where it matters, so
 * the screen asks once and reuses the answer for the repeats.
 *
 * ── NOTHING HERE UPLOADS ANYTHING ──────────────────────────────────────────
 * There is no `fetch` and no URL on this screen. The bundle and its frames leave
 * only through the share sheet the person taps.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import {
  MAX_OBSERVER_ACCURACY_M,
  PAN_ANCHOR_EDGE_OFFSET,
  parseFieldBundle,
  signedFrameOffset,
  type BundleProblem,
  type Capture,
  type FieldBundle,
} from '../../live/field-analysis';
import { anchorChoices, findAnchorChoice } from './anchor-choices';
import {
  BRACE_HOLD_MS,
  FIELD_BUNDLE_FILE_NAME,
  FIELD_CAPTURE_COUNT,
  FIELD_SESSION_PRIVACY_STATEMENT,
  MIN_STORED_FRAME_WIDTH_PX,
  REPEATED_DRAG_COUNT,
  TILT_TARGET_DEG,
  anchorOffsetU,
  anchorSide,
  buildFieldBundle,
  buildFieldCapture,
  captureShortfalls,
  fieldRunPlan,
  frameFileNameFor,
  panTargetReached,
  stillForMs,
  summariseTrace,
  type CaptureShortfall,
  type FieldCaptureContext,
  type PoseSample,
} from './field-session';
import { BUNDLE_MIME, FRAME_MIME, shareFieldFiles, type BundleShareTarget, type ShareableFile } from './field-share';
import type { DragMode } from './fine-drag';
import {
  MAX_TAP_DISTANCE_PX,
  fitFovCalibration,
  pickReference,
  type CalibrationFrame,
  type CalibrationReference,
  type CalibrationTap,
} from './fov-calibration';
import type { FovFit } from './fov-calibration';
import type { ShareResult } from './home-session-share';
import { REANCHOR_STRIP_LINE } from './reanchor';

/** How often the pose is sampled into the trace buffer, milliseconds. */
const SAMPLE_INTERVAL_MS = 50;

/** How much of the trace is kept, milliseconds. Two capture windows of margin. */
const TRACE_MEMORY_MS = 4000;

/** A frame the camera has just delivered, already encoded. */
export interface CapturedFrame {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly bytes: Blob;
}

interface TakenCapture {
  readonly capture: Capture;
  readonly frame: CapturedFrame;
  readonly shortfalls: readonly CaptureShortfall[];
}

interface FinishedBundle {
  readonly bundle: FieldBundle;
  readonly json: string;
  readonly problems: readonly BundleProblem[];
}

export interface FieldSessionPanelProps {
  /** True once the camera and the sensors are running. */
  readonly ready: boolean;
  /** `navigator.userAgent`. Names the browser every verdict applies to. */
  readonly device: string;
  /** Everything the screen knows right now, or undefined before it knows it. */
  readonly context: FieldCaptureContext | undefined;
  /** Which committed peak regions the app had loaded. Public identifiers. */
  readonly peakRegions: readonly string[];
  /** Encode the camera frame at the video track's own size. */
  readonly captureFrame: () => Promise<CapturedFrame | undefined>;
  /** Milliseconds since this page started drawing, for the trace's own clock. */
  readonly nowMs: () => number;
  /** When the overlay was last re-projected, newest last. F1's rate floor. */
  readonly tickTimesMs: () => readonly number[];
  readonly shareTarget: BundleShareTarget;
  /** Every mark the screen is drawing that a tap could be about, read on demand. */
  readonly calibrationReferences: () => readonly CalibrationReference[];
  readonly calibrationFrame: () => CalibrationFrame | undefined;
  readonly onCalibrated: (fit: FovFit, taps: readonly CalibrationTap[]) => void;
  /** Tell the screen about a tap the Sun's mark claimed, so it can watch for a
      gross compass error no field-of-view fit can absorb. */
  readonly onPictureTap?: (
    tappedPx: { readonly xPx: number; readonly yPx: number },
    reference: CalibrationReference | undefined,
  ) => void;
  /** True while the screen's re-anchor wants a tap on the picture. This panel
      sits in a strip stacked above the screen's own tap surface, so its tap
      surface must step aside or it takes the re-anchor's tap. */
  readonly reanchorArmed: boolean;
  /** True while the screen warns that the compass is grossly off. */
  readonly compassWarning: boolean;
  /** Goes up by one each time a re-anchor is applied. */
  readonly reanchorCount: number;
  readonly dragMode: DragMode;
  readonly setDragMode: (mode: DragMode) => void;
  /** Put the labels back where the sensors say, before a repeated drag. */
  readonly resetTrim: () => void;
  /** Which summit is the drag anchor, so the screen keeps its name on. */
  readonly onAnchorSummit?: (peakId: string | undefined) => void;
}

type Phase = 'explaining' | 'running' | 'finished';

export function FieldSessionPanel(props: FieldSessionPanelProps): JSX.Element {
  const plan = useMemo(() => fieldRunPlan(), []);
  const [phase, setPhase] = useState<Phase>('explaining');
  const [stepIndex, setStepIndex] = useState(0);
  const [taken, setTaken] = useState<readonly TakenCapture[]>([]);
  const [anchorSummitId, setAnchorSummitId] = useState<string | undefined>(undefined);
  const [taps, setTaps] = useState<readonly CalibrationTap[]>([]);
  const [tapNote, setTapNote] = useState<string | undefined>(undefined);
  const [calibrationNote, setCalibrationNote] = useState<string | undefined>(undefined);
  const [captureNote, setCaptureNote] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState<FinishedBundle | undefined>(undefined);
  const [shareResult, setShareResult] = useState<ShareResult | undefined>(undefined);
  /** Bumped on a timer so the still-hold bar and the pan reading redraw. */
  const [, setTick] = useState(0);

  const startedAtRef = useRef(0);
  const samplesRef = useRef<PoseSample[]>([]);
  const tapLayerRef = useRef<HTMLDivElement>(null);
  /**
   * The latest context, readable without re-arming the sampler.
   *
   * The live screen rebuilds this object twenty times a second. Listing it as a
   * dependency of the interval below would tear the interval down and rebuild it
   * before it ever fired, and the trace would be empty at the moment a capture
   * needs it.
   */
  const contextRef = useRef<FieldCaptureContext | undefined>(undefined);

  const entry = plan[stepIndex];
  const step = entry?.step;

  // Destructured rather than reached for through `props`: the live screen
  // re-renders twenty times a second, and a callback depending on the whole
  // props object would tear down this panel's own interval before it fired.
  const { context, captureFrame, nowMs, tickTimesMs, setDragMode, resetTrim, shareTarget, device } =
    props;

  contextRef.current = context;

  /* ── the trace buffer ───────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'running') return undefined;
    const handle = window.setInterval(() => {
      const pose = contextRef.current?.pose;
      if (pose !== undefined) {
        const tMs = nowMs() - startedAtRef.current;
        samplesRef.current.push({
          tMs,
          headingDeg: pose.headingDeg,
          pitchDeg: pose.pitchDeg,
          rollDeg: pose.rollDeg,
        });
        const oldest = tMs - TRACE_MEMORY_MS;
        while ((samplesRef.current[0]?.tMs ?? tMs) < oldest) samplesRef.current.shift();
      }
      setTick((value) => value + 1);
    }, SAMPLE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [phase, nowMs]);

  /**
   * Fine drag is on for every drag in this session.
   *
   * The budget's drag term is 0.543° at 1σ from 1 mm of finger, and the 4× gain
   * puts the same millimetre at 0.136° (term 9). The mode is set when a drag step
   * opens and then left alone, so a person who turns it off mid-drag stays off.
   */
  useEffect(() => {
    if (phase !== 'running' || step?.kind !== 'drag') return;
    setDragMode('fine');
  }, [phase, step?.kind, setDragMode]);

  const start = useCallback(() => {
    startedAtRef.current = nowMs();
    samplesRef.current = [];
    setTaken([]);
    setAnchorSummitId(undefined);
    setShareResult(undefined);
    setFinished(undefined);
    setStepIndex(0);
    setPhase('running');
  }, [nowMs]);

  const advance = useCallback(() => {
    setCaptureNote(undefined);
    setStepIndex((index) => {
      const next = index + 1;
      if (next >= plan.length) {
        setPhase('finished');
        return index;
      }
      return next;
    });
  }, [plan.length]);

  /* ── the anchor, and where it is drawn right now ────────────────────────── */
  /**
   * Every summit in the picture, named or not.
   *
   * A crowded-out summit is offered on the same footing as a labelled one. On a
   * phone-width frame the label budget is small enough to drop the summit the
   * protocol is anchored on, and a dot with no name cannot be picked.
   */
  const choices = useMemo(
    () => (context === undefined ? [] : anchorChoices(context.layout, context.overlayPx.widthPx)),
    [context],
  );

  const anchorChoice = findAnchorChoice(choices, anchorSummitId);

  const anchorU =
    anchorChoice === undefined || context === undefined
      ? undefined
      : anchorOffsetU(anchorChoice.summitPx.xPx, context.overlayPx.widthPx);
  const side =
    anchorChoice === undefined || context === undefined
      ? undefined
      : anchorSide(anchorChoice.summitPx.xPx, context.overlayPx.widthPx);

  /**
   * Tell the screen which summit is the anchor, so it forces that name on.
   *
   * A summit the person picked out of the crowded-out list has no label until
   * the layout is told to keep one for it.
   */
  const { onAnchorSummit } = props;
  useEffect(() => {
    onAnchorSummit?.(anchorSummitId);
  }, [onAnchorSummit, anchorSummitId]);

  /** The after-drag capture the pan and the tilt are measured from. */
  const reference = useMemo(
    () => taken.find((item) => item.capture.role === 'after-drag'),
    [taken],
  );

  const held = stillForMs(samplesRef.current);
  const braced = held >= BRACE_HOLD_MS;

  /* ── taking one capture ─────────────────────────────────────────────────── */
  const take = useCallback(
    async (role: Capture['role']): Promise<void> => {
      const snapshot = context;
      if (snapshot === undefined) {
        setCaptureNote('The camera and the labels are not both ready yet, so nothing was saved.');
        return;
      }
      if (role === 'after-drag' && anchorSummitId === undefined) {
        setCaptureNote('Tap the name of the summit you lined up first.');
        return;
      }
      // The pose is read BEFORE the frame is encoded, so the stored pose is the
      // one the picture was taken at rather than one a few frames later.
      const tMs = Math.max(0, nowMs() - startedAtRef.current);
      const trace = summariseTrace(
        samplesRef.current,
        tickTimesMs().map((tick) => tick - startedAtRef.current),
        tMs,
        snapshot.compassAccuracyDeg,
      );
      setBusy(true);
      const frame = await captureFrame().catch(() => undefined);
      setBusy(false);
      if (frame === undefined) {
        setCaptureNote('The camera gave no picture, so nothing was saved. Try the capture again.');
        return;
      }
      if (trace.sampleCount < 1) {
        setCaptureNote('No sensor readings arrived in the last second, so nothing was saved.');
        return;
      }

      const captureId = `c${taken.length + 1}`;
      const referenceCapture = reference?.capture;
      const capture = buildFieldCapture({
        captureId,
        role,
        tMs,
        framePx: { widthPx: frame.widthPx, heightPx: frame.heightPx },
        trace,
        context: snapshot,
        // A turned capture faces a direction nothing was dragged in, so it
        // names no anchor even though one is set for the first direction.
        ...((role !== 'after-drag' && role !== 'moved') || anchorSummitId === undefined
          ? {}
          : { dragAnchorSummitId: anchorSummitId }),
        ...(role === 'moved' && referenceCapture !== undefined
          ? {
              movedFromCaptureId: referenceCapture.captureId,
              ...(step?.kind === 'pan'
                ? {
                    panFromReferenceDeg: signedDeltaDeg(
                      snapshot.pose.headingDeg,
                      referenceCapture.pose.headingDeg,
                    ),
                  }
                : {
                    tiltFromReferenceDeg:
                      snapshot.pose.pitchDeg - referenceCapture.pose.pitchDeg,
                  }),
            }
          : {}),
      });
      // Where the anchor sat before the turn, signed. § 2.7 step 6 asks for it
      // near the middle, and § 2.4 will not grade a pan that started further
      // out — the person can still fix that while they are standing there.
      const referenceAnchor =
        referenceCapture === undefined || anchorSummitId === undefined
          ? undefined
          : referenceCapture.overlay.drawn.find(
              (summit) => summit.summitId === anchorSummitId,
            );
      const referenceAnchorSignedU =
        referenceAnchor === undefined
          ? undefined
          : signedFrameOffset(
              referenceAnchor.summitPx.xPx,
              referenceCapture?.overlayPx.widthPx ?? 0,
            );
      const shortfalls = captureShortfalls(capture, {
        ...(anchorU === undefined ? {} : { anchorU }),
        ...(referenceAnchorSignedU === undefined ? {} : { referenceAnchorSignedU }),
        ...(side === undefined ? {} : { anchorSide: side }),
        ...(step?.edge === undefined ? {} : { wantedEdge: step.edge }),
        ...(step?.tilt === undefined ? {} : { wantedTilt: step.tilt }),
      });
      setTaken((current) => [...current, { capture, frame, shortfalls }]);
      setCaptureNote(undefined);
      advance();
    },
    [
      context,
      anchorSummitId,
      anchorU,
      side,
      step?.edge,
      step?.tilt,
      step?.kind,
      nowMs,
      tickTimesMs,
      captureFrame,
      taken.length,
      reference,
      step?.id,
      advance,
    ],
  );

  /**
   * Drop the taps made before a re-anchor.
   *
   * Each tap is measured against the mark drawn when it was made, and a
   * re-anchor turns every mark. Without this, a fit held back for a gross
   * compass error would become usable the moment the direction was fixed,
   * still built from the taps the error spoiled.
   */
  const { reanchorCount } = props;
  const reanchorCountRef = useRef(reanchorCount);
  useEffect(() => {
    if (reanchorCount === reanchorCountRef.current) return;
    reanchorCountRef.current = reanchorCount;
    if (taps.length === 0) return;
    setTaps([]);
    setTapNote('The direction changed, so earlier taps were cleared. Tap again.');
  }, [reanchorCount, taps.length]);

  /* ── the field-of-view taps ─────────────────────────────────────────────── */
  const onTap = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const layer = tapLayerRef.current;
      const frame = props.calibrationFrame();
      if (layer === null || frame === undefined) {
        setTapNote('The camera has not delivered a picture yet, so there is nothing to measure.');
        return;
      }
      const box = layer.getBoundingClientRect();
      const tappedPx = { xPx: event.clientX - box.left, yPx: event.clientY - box.top };
      const references = props.calibrationReferences();
      const picked = pickReference(tappedPx, references, MAX_TAP_DISTANCE_PX);
      // Only the Sun's own claim: the sweep asks for landmarks, so a tap nothing
      // claimed is a missed landmark, and the screen reads an unclaimed tap as
      // a tap on the real Sun.
      if (picked?.kind === 'sun') props.onPictureTap?.(tappedPx, picked);
      if (picked === undefined) {
        setTapNote(
          references.length === 0
            ? 'Nothing is drawn on screen to compare against yet. Point the camera at the view.'
            : 'That tap was not near anything the app has drawn. If the labels are far off, fix ' +
              'the direction first.',
        );
        return;
      }
      setTapNote(undefined);
      setCalibrationNote(undefined);
      setTaps((current) => [...current, { reference: picked, tappedPx }]);
    },
    [props],
  );

  const tapFrame = phase === 'running' && step?.kind === 'tap' ? props.calibrationFrame() : undefined;
  const fit = useMemo(
    () => (tapFrame === undefined || taps.length === 0 ? undefined : fitFovCalibration(taps, tapFrame)),
    [taps, tapFrame],
  );

  const useFit = useCallback(() => {
    if (fit?.ok !== true) return;
    props.onCalibrated(fit.value, taps);
    setCalibrationNote(
      `Saved: the camera sees ${fit.value.frameHFovDeg.toFixed(2)}° across, and the labels were ` +
        `nudged ${fit.value.trim.headingDeg.toFixed(2)}° across and ` +
        `${fit.value.trim.pitchDeg.toFixed(2)}° up.`,
    );
  }, [fit, taps, props]);

  /* ── the finished bundle ────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'finished' || finished !== undefined) return;
    const bundle = buildFieldBundle({
      device,
      peakRegions: props.peakRegions,
      captures: taken.map((item) => item.capture),
    });
    const json = `${JSON.stringify(bundle, null, 2)}\n`;
    // Parsed from the TEXT, not the object, because the text is what gets shared
    // and what the grader on the other end will read.
    const parsed = parseFieldBundle(JSON.parse(json) as unknown);
    setFinished({ bundle, json, problems: parsed.ok ? [] : parsed.problems });
  }, [phase, finished, device, props.peakRegions, taken]);

  const doShare = useCallback(() => {
    if (finished === undefined) return;
    const files: ShareableFile[] = [
      { name: FIELD_BUNDLE_FILE_NAME, mime: BUNDLE_MIME, body: finished.json },
      ...taken.map((item) => ({
        name: frameFileNameFor(item.capture.captureId),
        mime: FRAME_MIME,
        body: item.frame.bytes,
      })),
    ];
    // No await before the share call: iOS only allows it inside the gesture.
    void shareFieldFiles(files, shareTarget).then(setShareResult);
  }, [finished, taken, shareTarget]);

  const accuracyM = context?.horizontalAccuracyM;
  const shortfallCount = taken.reduce((sum, item) => sum + item.shortfalls.length, 0);

  /**
   * A tap step, or an armed re-anchor, shrinks the panel to a strip at the top
   * edge. Both want a finger on the picture, and the full panel covers the
   * upper half of a landscape phone, where the skyline's dots sit.
   */
  const compact = phase === 'running' && (step?.kind === 'tap' || props.reanchorArmed);
  /** A fit made while the compass is grossly off is shown but cannot be used. */
  const fitHeld = fit?.ok === true && props.compassWarning;

  const primaryButton =
    step === undefined ? null : step.role !== undefined ? (
      <button
        type="button"
        data-testid="field-session-capture"
        data-role={step.role}
        disabled={busy}
        onClick={() => void take(step.role ?? 'before-drag')}
      >
        {step.id === 'capture-raw'
          ? 'Capture raw'
          : step.id === 'capture-drag'
            ? 'Capture after drag'
            : 'Capture'}
      </button>
    ) : (
      <button type="button" data-testid="field-session-next" onClick={advance}>
        Done — next step
      </button>
    );

  const captureNoteLine =
    captureNote === undefined ? null : (
      <p className="live__warn" data-testid="field-session-capture-note">
        {captureNote}
      </p>
    );

  return (
    <>
      <section
        className={compact ? 'live__session live__session--compact' : 'live__session'}
        data-compact={String(compact)}
        data-testid="field-session"
        data-phase={phase}
        data-step-index={stepIndex}
        data-step-id={step?.id ?? ''}
        data-capture-count={taken.length}
      >
        <h2 data-testid="field-session-title">Field session</h2>

        {phase === 'explaining' && (
          <>
            <div data-testid="field-session-privacy">
              {FIELD_SESSION_PRIVACY_STATEMENT.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <p data-testid="field-session-length">
              {plan.length} steps and {FIELD_CAPTURE_COUNT} captures, about half an hour. You
              can stop at any time by closing the page; nothing is kept if you do.
            </p>
            <button
              type="button"
              data-testid="field-session-start"
              disabled={!props.ready}
              onClick={start}
            >
              Start the field session
            </button>
            {!props.ready && (
              <p data-testid="field-session-not-ready">
                Tap Start at the top first, and allow the camera, the motion sensors and your
                location.
              </p>
            )}
          </>
        )}

        {phase === 'running' && step !== undefined && entry !== undefined && !compact && (
          <>
            <p data-testid="field-session-progress">
              Step {stepIndex + 1} of {plan.length} — {step.title}
              {entry.repeat > 0 ? ` (${entry.repeat} of ${REPEATED_DRAG_COUNT})` : ''}
            </p>
            <p className="live__session-instruction" data-testid="field-session-instruction">
              {step.instruction}
            </p>

            {(step.kind === 'brace' || step.role !== undefined) && (
              <p
                data-testid="field-session-still"
                data-still-ms={Math.round(held)}
                data-braced={String(braced)}
              >
                {braced
                  ? `Held still for ${(held / 1000).toFixed(1)} s — that is enough.`
                  : `Held still for ${(held / 1000).toFixed(1)} s of the ${BRACE_HOLD_MS / 1000} s needed.`}
              </p>
            )}

            {step.id === 'fix' && (
              <p
                data-testid="field-session-accuracy"
                data-accuracy-m={accuracyM ?? ''}
                data-good={String(accuracyM !== undefined && accuracyM <= MAX_OBSERVER_ACCURACY_M)}
              >
                {accuracyM === undefined
                  ? 'The phone has not said how well it knows where it is yet.'
                  : accuracyM <= MAX_OBSERVER_ACCURACY_M
                    ? `The phone knows where it is to about ${accuracyM.toFixed(0)} m. That is good enough.`
                    : `The phone only knows where it is to about ${accuracyM.toFixed(0)} m. Wait for it to settle below ${MAX_OBSERVER_ACCURACY_M} m.`}
              </p>
            )}

            {step.kind === 'drag' && (
              <div data-testid="field-session-anchor" data-anchor-id={anchorSummitId ?? ''}>
                <p>
                  {anchorSummitId === undefined
                    ? 'Tap the name of the summit you lined up:'
                    : 'Lined up on:'}
                </p>
                {anchorSummitId === undefined ? (
                  choices.map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      data-testid="field-session-anchor-choice"
                      data-summit-id={choice.id}
                      data-crowded-out={String(choice.crowdedOut)}
                      onClick={() => setAnchorSummitId(choice.id)}
                    >
                      {choice.name}
                      {choice.crowdedOut ? ' (dot only)' : ''}
                    </button>
                  ))
                ) : (
                  <p data-testid="field-session-anchor-name">
                    {anchorChoice?.name ?? anchorSummitId}
                  </p>
                )}
                {entry.repeat > 1 && (
                  <button
                    type="button"
                    data-testid="field-session-reset-trim"
                    onClick={resetTrim}
                  >
                    Put the labels back and drag again
                  </button>
                )}
              </div>
            )}

            {(step.kind === 'pan' || step.kind === 'tilt') && (
              <p
                data-testid="field-session-pan"
                data-anchor-u={anchorU ?? ''}
                data-anchor-side={side ?? ''}
                data-reached={String(
                  anchorU !== undefined &&
                    panTargetReached(anchorU) &&
                    (step.edge === undefined || side === step.edge),
                )}
              >
                {anchorU === undefined
                  ? 'That summit is not on the picture at the moment, so how far it has travelled cannot be read.'
                  : step.edge !== undefined && side !== step.edge
                    ? `That summit is on the ${side} of the picture and this step wants it on the ${step.edge}. Turn the other way.`
                    : panTargetReached(anchorU)
                      ? `It has reached ${(anchorU * 100).toFixed(0)} % of the way to the ${side} edge. Far enough — hold still and capture.`
                      : `It is ${(anchorU * 100).toFixed(0)} % of the way to the ${side} edge. Keep turning until it passes ${(PAN_ANCHOR_EDGE_OFFSET * 100).toFixed(0)} %.`}
              </p>
            )}

            {step.kind === 'tilt' && (
              <p data-testid="field-session-tilt" data-tilt={step.tilt ?? ''}>
                About {TILT_TARGET_DEG}° {step.tilt ?? 'up or down'} is what is wanted.
              </p>
            )}

            {primaryButton}

            {captureNoteLine}

            <p data-testid="field-session-taken" data-count={taken.length}>
              {taken.length} of {FIELD_CAPTURE_COUNT} captures saved on this phone.
            </p>
          </>
        )}

        {phase === 'running' && step !== undefined && entry !== undefined && compact && (
          <>
            <div className="live__strip-text">
              <p className="live__strip-head" data-testid="field-session-progress">
                Step {stepIndex + 1} of {plan.length} — {step.title}
                {entry.repeat > 0 ? ` (${entry.repeat} of ${REPEATED_DRAG_COUNT})` : ''}
                {step.kind === 'tap' && (
                  <>
                    {' · '}
                    <span data-testid="field-session-taps" data-tap-count={taps.length}>
                      {taps.length} tap{taps.length === 1 ? '' : 's'} so far
                    </span>
                  </>
                )}
              </p>
              <p className="live__strip-instruction" data-testid="field-session-instruction">
                {props.reanchorArmed ? REANCHOR_STRIP_LINE : (step.stripInstruction ?? step.instruction)}
              </p>
              {step.kind === 'tap' && (
                <>
                  {tapNote !== undefined && (
                    <p className="live__warn" data-testid="field-session-tap-note">
                      {tapNote}
                    </p>
                  )}
                  {fit !== undefined && !fit.ok && (
                    <p data-testid="field-session-fit-refusal" data-refusal={fit.refusal}>
                      {fit.detail}
                    </p>
                  )}
                  {fit?.ok === true && calibrationNote === undefined && (
                    <p
                      data-testid="field-session-fit"
                      data-frame-hfov-deg={fit.value.frameHFovDeg}
                      data-visible-hfov-deg={fit.value.visibleHFovDeg}
                    >
                      The camera is seeing {fit.value.visibleHFovDeg.toFixed(2)}° across the screen.
                    </p>
                  )}
                  {fitHeld && (
                    // The fit's heading trim would absorb the compass error,
                    // and a Sun tap was measured against a misplaced mark.
                    <p className="live__warn" data-testid="field-session-fit-held">
                      Fix the direction first. This measurement was made with the compass off.
                    </p>
                  )}
                  {calibrationNote !== undefined && (
                    <p data-testid="field-session-calibration-note">{calibrationNote}</p>
                  )}
                </>
              )}
              {captureNoteLine}
            </div>
            <div className="live__strip-actions">
              {step.kind === 'tap' && fit?.ok === true && !fitHeld && (
                <button type="button" data-testid="field-session-use-fit" onClick={useFit}>
                  Use this measurement
                </button>
              )}
              {primaryButton}
            </div>
          </>
        )}

        {phase === 'finished' && (
          <>
            <p data-testid="field-session-done" data-shortfall-count={shortfallCount}>
              {taken.length} capture{taken.length === 1 ? '' : 's'}, each with its photograph.
              {shortfallCount === 0
                ? ' Every one of them follows the protocol.'
                : ` ${shortfallCount} thing${shortfallCount === 1 ? '' : 's'} about them fall short of the protocol, listed below.`}
            </p>
            {taken.map((item) =>
              item.shortfalls.map((shortfall) => (
                <p
                  className="live__warn"
                  key={`${item.capture.captureId}:${shortfall.code}`}
                  data-testid="field-session-shortfall"
                  data-code={shortfall.code}
                >
                  {item.capture.captureId}: {shortfall.text}
                </p>
              )),
            )}
            {finished !== undefined && (
              <>
                <p
                  data-testid="field-session-parse"
                  data-valid={String(finished.problems.length === 0)}
                  data-problem-count={finished.problems.length}
                  data-bytes={finished.json.length}
                >
                  {finished.problems.length === 0
                    ? `The readings file is complete and holds no location, no bearing and no clock time (${finished.json.length} bytes).`
                    : `The readings file has ${finished.problems.length} problem(s) and should not be sent as it is.`}
                </p>
                {finished.problems.slice(0, 5).map((problem) => (
                  <p className="live__warn" key={`${problem.path}:${problem.message}`}>
                    {problem.path === '' ? '(top level)' : problem.path}: {problem.message}
                  </p>
                ))}
                <p data-testid="field-session-frames" data-frame-count={taken.length}>
                  {taken
                    .map(
                      (item) =>
                        `${frameFileNameFor(item.capture.captureId)} ${item.frame.widthPx}×${item.frame.heightPx}`,
                    )
                    .join(', ')}
                  {taken.some((item) => item.frame.widthPx < MIN_STORED_FRAME_WIDTH_PX)
                    ? ` — at least one is under ${MIN_STORED_FRAME_WIDTH_PX} px across.`
                    : '.'}
                </p>
                <button type="button" data-testid="field-session-share" onClick={doShare}>
                  Share the readings and the photographs
                </button>
                {shareResult !== undefined && (
                  <p data-testid="field-session-share-result" data-outcome={shareResult.outcome}>
                    {shareResult.message}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* The tap surface, above the drag layer, only while a step wants taps. A
          finger on the picture means "that is where the real thing is" during
          this step and "push the labels" at every other time, and the two cannot
          share one surface. */}
      {phase === 'running' && step?.kind === 'tap' && !props.reanchorArmed && (
        <div
          ref={tapLayerRef}
          className="live__session-taps"
          data-testid="field-session-tap-layer"
          onPointerUp={onTap}
        />
      )}
    </>
  );
}

/** `a − b` folded onto (−180, 180]. */
function signedDeltaDeg(a: number, b: number): number {
  const d = ((((a - b) % 360) + 360) % 360);
  return d > 180 ? d - 360 : d;
}
