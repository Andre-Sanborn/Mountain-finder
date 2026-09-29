/**
 * The guided home session, on screen — one pose at a time, then Share.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS COMPONENT OWNS
 * ═══════════════════════════════════════════════════════════════════════════
 * The sequence and nothing else. The script is in `home-session.ts`, the event
 * conversion is in `home-session-recorder.ts`, the fit is in
 * `fov-calibration.ts`, the two ways off the phone are in
 * `home-session-share.ts`, and the verdicts come from `src/live/recording.ts`.
 * What is left here is a step index, a countdown, a list of taps, and the three
 * screens a person sees: what is about to be recorded, the step they are on, and
 * the finished file.
 *
 * ── THE ORDER OF THE THREE SCREENS ─────────────────────────────────────────
 * What the file contains comes BEFORE the first step, because consent to a
 * capture given afterwards is not consent. Then the steps. Then Share, and only
 * Share: there is no upload on this screen and no button that could become one.
 *
 * ── WHY EVERY STEP HAS A COUNTDOWN AND A WAY PAST IT ───────────────────────
 * The countdown is what makes "hold still" actionable: a person holding a phone
 * against a wall needs to know whether it is two seconds or two minutes. It runs
 * out on its own and the session moves on, so a phone left flat on a table gets
 * through its four holds untouched. "Move on now" is there because two of the
 * steps are minutes long and a person who has finished early should not have to
 * wait out a timer.
 *
 * ── THE BEARING IS TAKEN ONCE, AT THE FIRST AIM ────────────────────────────
 * `computeKnownBearing` is called when the first sun-aiming step opens, not at
 * the start and not at the end. The three aiming steps run inside about twenty
 * seconds of each other, over which the Sun's azimuth moves about 0.08° — two
 * orders below the analyzer's own 12° residual threshold — so one bearing serves
 * all three. What it returns is three numbers; the position and the instant
 * behind them never reach this component.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import {
  analyseRecording,
  KNOWN_BEARING_POSES,
  parseRecording,
  type HomeSessionRecording,
  type KnownBearing,
  type RecordingAnalysis,
  type RecordingProblem,
} from '../../live/recording';
import {
  MAX_TAP_DISTANCE_PX,
  calibrationFromFit,
  fitFovCalibration,
  pickReference,
  type CalibrationFrame,
  type CalibrationReference,
  type CalibrationTap,
  type FovFit,
} from './fov-calibration';
import {
  HOME_SESSION_PRIVACY_STATEMENT,
  HOME_SESSION_STEPS,
  RECORDING_FILE_NAME,
  sunIsUsable,
} from './home-session';
import type { HomeSessionRecorder } from './home-session-recorder';
import { shareRecording, type ShareResult, type ShareTarget } from './home-session-share';

/** How often the countdown is redrawn, milliseconds. */
const TICK_MS = 250;

export interface HomeSessionPanelProps {
  /** The sink the live screen already feeds. */
  readonly recorder: HomeSessionRecorder;
  /** True once the camera and the sensors are running. */
  readonly ready: boolean;
  /** `navigator.userAgent`. Names the browser every verdict applies to. */
  readonly device: string;
  /** True once a position fix exists, so the Sun's bearing can be worked out. */
  readonly canComputeBearing: boolean;
  /** The Sun's magnetic azimuth now, with the position and the clock discarded. */
  readonly computeKnownBearing: () => KnownBearing | undefined;
  /** Every mark the screen is drawing that a tap could be about, read on demand. */
  readonly calibrationReferences: () => readonly CalibrationReference[];
  /** The frame the taps are measured in, or undefined before the first frame. */
  readonly calibrationFrame: () => CalibrationFrame | undefined;
  /** Hand a finished measurement to the screen, which stores and applies it. */
  readonly onCalibrated: (fit: FovFit, references: readonly CalibrationReference[]) => void;
  readonly shareTarget: ShareTarget;
}

type Phase = 'explaining' | 'recording' | 'finished';

interface Finished {
  readonly recording: HomeSessionRecording;
  readonly json: string;
  readonly problems: readonly RecordingProblem[];
  readonly analysis: RecordingAnalysis | undefined;
}

export function HomeSessionPanel(props: HomeSessionPanelProps): JSX.Element {
  const [phase, setPhase] = useState<Phase>('explaining');
  const [stepIndex, setStepIndex] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);
  const [taps, setTaps] = useState<readonly CalibrationTap[]>([]);
  const [tapNote, setTapNote] = useState<string | undefined>(undefined);
  const [calibrationNote, setCalibrationNote] = useState<string | undefined>(undefined);
  const [finished, setFinished] = useState<Finished | undefined>(undefined);
  const [shareResult, setShareResult] = useState<ShareResult | undefined>(undefined);

  const bearingRef = useRef<KnownBearing | undefined>(undefined);
  const stepStartedRef = useRef(0);
  const tapLayerRef = useRef<HTMLDivElement>(null);

  const step = HOME_SESSION_STEPS[stepIndex];

  // Destructured rather than reached for through `props`. The live screen
  // re-renders twenty times a second, so a callback that depended on the whole
  // props object would be a new function every 50 ms — and the countdown's own
  // 250 ms interval would be torn down before it ever fired.
  const { recorder, computeKnownBearing, device, shareTarget } = props;

  /** Open a step, taking the Sun's bearing the first time one needs it. */
  const openStep = useCallback(
    (index: number) => {
      const next = HOME_SESSION_STEPS[index];
      if (next === undefined) return;
      if (bearingRef.current === undefined && KNOWN_BEARING_POSES.includes(next.pose)) {
        bearingRef.current = computeKnownBearing();
      }
      recorder.beginSegment(next.pose, next.title);
      stepStartedRef.current = Date.now();
      setStepIndex(index);
      setRemainingMs(next.holdMs);
    },
    [recorder, computeKnownBearing],
  );

  const finish = useCallback(() => {
    const bearing = bearingRef.current ?? computeKnownBearing();
    recorder.endSegment();
    setPhase('finished');
    if (bearing === undefined) {
      // No bearing means no recording: the schema requires one and most of the
      // verdicts are scored against it. Saying so beats writing a file the
      // analyzer would refuse on the other side of the share sheet.
      setFinished(undefined);
      return;
    }
    const recording = recorder.build({ device, knownBearing: bearing });
    const json = `${JSON.stringify(recording, null, 2)}\n`;
    // Parsed from the TEXT, not from the object, because the text is what gets
    // shared and what the analyzer on the other end will read.
    const parsed = parseRecording(JSON.parse(json) as unknown);
    setFinished({
      recording,
      json,
      problems: parsed.ok ? [] : parsed.problems,
      analysis: parsed.ok ? analyseRecording(parsed.value) : undefined,
    });
  }, [recorder, computeKnownBearing, device]);

  const advance = useCallback(() => {
    if (stepIndex + 1 < HOME_SESSION_STEPS.length) {
      openStep(stepIndex + 1);
      return;
    }
    finish();
  }, [stepIndex, openStep, finish]);

  const start = useCallback(() => {
    recorder.begin();
    setPhase('recording');
    setShareResult(undefined);
    openStep(0);
  }, [recorder, openStep]);

  /* ── the countdown ──────────────────────────────────────────────────────── */
  useEffect(() => {
    if (phase !== 'recording' || step === undefined) return undefined;
    const handle = window.setInterval(() => {
      const left = step.holdMs - (Date.now() - stepStartedRef.current);
      setRemainingMs(Math.max(0, left));
      if (left <= 0) advance();
    }, TICK_MS);
    return () => window.clearInterval(handle);
  }, [phase, step, advance]);

  /* ── the tap, on the sun step ───────────────────────────────────────────── */
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
      const reference = pickReference(tappedPx, references, MAX_TAP_DISTANCE_PX);
      if (reference === undefined) {
        setTapNote(
          references.length === 0
            ? 'Nothing is drawn on screen to compare against yet. Point the camera at the sun.'
            : 'That tap was not near anything the app has drawn. Tap the middle of the real sun, ' +
              'close to the circle the app drew.',
        );
        return;
      }
      setTapNote(undefined);
      setTaps((current) => [...current, { reference, tappedPx }]);
    },
    [props],
  );

  const frame = phase === 'recording' && step?.kind === 'tap' ? props.calibrationFrame() : undefined;
  const fit = useMemo(
    () => (frame === undefined || taps.length === 0 ? undefined : fitFovCalibration(taps, frame)),
    [taps, frame],
  );

  const useFit = useCallback(() => {
    const currentFrame = props.calibrationFrame();
    if (fit?.ok !== true || currentFrame === undefined) return;
    props.onCalibrated(
      fit.value,
      taps.map((tap) => tap.reference),
    );
    const stored = calibrationFromFit(
      fit.value,
      currentFrame,
      taps.map((tap) => tap.reference),
    );
    setCalibrationNote(
      `Saved: the camera sees ${stored.frameHFovDeg.toFixed(2)}° across, and the labels were ` +
        `nudged ${fit.value.trim.headingDeg.toFixed(2)}° across and ` +
        `${fit.value.trim.pitchDeg.toFixed(2)}° up.`,
    );
  }, [fit, taps, props]);

  const doShare = useCallback(() => {
    if (finished === undefined) return;
    // No await before the share call: iOS only allows it inside the gesture.
    void shareRecording({ name: RECORDING_FILE_NAME, json: finished.json }, shareTarget).then(
      setShareResult,
    );
  }, [finished, shareTarget]);

  const bearingWarning = (() => {
    const bearing = bearingRef.current;
    if (bearing === undefined) return undefined;
    const usable = sunIsUsable(bearing);
    return usable.usable ? undefined : usable.why;
  })();

  const counts = recorder.counts;

  return (
    <>
      <section
        className="live__session"
        data-testid="home-session"
        data-phase={phase}
        data-step-index={stepIndex}
        data-step-pose={step?.pose ?? ''}
        data-event-count={counts.events}
      >
        <h2 data-testid="home-session-title">Home session</h2>

        {phase === 'explaining' && (
          <>
            <div data-testid="home-session-privacy">
              {HOME_SESSION_PRIVACY_STATEMENT.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
            <p data-testid="home-session-length">
              {HOME_SESSION_STEPS.length} short steps, about five minutes. You can stop at any time
              by closing the page; nothing is kept if you do.
            </p>
            <button
              type="button"
              data-testid="home-session-start"
              disabled={!props.ready || !props.canComputeBearing}
              onClick={start}
            >
              Start recording
            </button>
            {!props.ready && (
              <p data-testid="home-session-not-ready">
                Tap Start at the top first, and allow the camera, the motion sensors and your
                location.
              </p>
            )}
            {props.ready && !props.canComputeBearing && (
              <p data-testid="home-session-waiting-fix">
                Waiting for your location. It is needed once, to work out which way the sun is from
                here. It is not saved.
              </p>
            )}
          </>
        )}

        {phase === 'recording' && step !== undefined && (
          <>
            <p data-testid="home-session-progress">
              Step {stepIndex + 1} of {HOME_SESSION_STEPS.length} — {step.title}
            </p>
            <p className="live__session-instruction" data-testid="home-session-instruction">
              {step.instruction}
            </p>
            <p data-testid="home-session-remaining" data-remaining-ms={Math.round(remainingMs)}>
              {step.kind === 'hold' ? 'Hold still' : 'Keep going'} —{' '}
              {Math.ceil(remainingMs / 1000)} s left.
            </p>
            <button type="button" data-testid="home-session-next" onClick={advance}>
              {stepIndex + 1 === HOME_SESSION_STEPS.length ? 'Finish' : 'Move on now'}
            </button>
            {bearingWarning !== undefined && (
              <p className="live__warn" data-testid="home-session-sun-warning">
                {bearingWarning}
              </p>
            )}

            {step.kind === 'tap' && (
              <>
                <p data-testid="home-session-taps" data-tap-count={taps.length}>
                  {taps.length} tap{taps.length === 1 ? '' : 's'} so far.
                </p>
                {tapNote !== undefined && (
                  <p className="live__warn" data-testid="home-session-tap-note">
                    {tapNote}
                  </p>
                )}
                {fit !== undefined && !fit.ok && (
                  <p data-testid="home-session-fit-refusal" data-refusal={fit.refusal}>
                    {fit.detail}
                  </p>
                )}
                {fit?.ok === true && (
                  <>
                    <p
                      data-testid="home-session-fit"
                      data-frame-hfov-deg={fit.value.frameHFovDeg}
                      data-visible-hfov-deg={fit.value.visibleHFovDeg}
                      data-scale={fit.value.scale}
                      data-heading-offset-deg={fit.value.trim.headingDeg}
                      data-pitch-offset-deg={fit.value.trim.pitchDeg}
                      data-residual-px={fit.value.residualPx}
                    >
                      The camera is seeing {fit.value.visibleHFovDeg.toFixed(2)}° across the screen,
                      and is aimed {Math.abs(fit.value.trim.headingDeg).toFixed(2)}°{' '}
                      {fit.value.trim.headingDeg < 0 ? 'right' : 'left'} of where it thought.
                    </p>
                    <button type="button" data-testid="home-session-use-fit" onClick={useFit}>
                      Use this measurement
                    </button>
                  </>
                )}
                {calibrationNote !== undefined && (
                  <p data-testid="home-session-calibration-note">{calibrationNote}</p>
                )}
              </>
            )}
          </>
        )}

        {phase === 'finished' && (
          <>
            <p data-testid="home-session-done">
              Recording finished: {recorder.completedSegments.length} steps,{' '}
              {counts.events} sensor readings.
            </p>
            {finished === undefined ? (
              <p className="live__warn" data-testid="home-session-no-bearing">
                No location arrived, so the sun&apos;s direction could not be worked out and the
                recording has nothing to be checked against. Run it again outdoors.
              </p>
            ) : (
              <>
                <p
                  data-testid="home-session-parse"
                  data-valid={String(finished.problems.length === 0)}
                  data-problem-count={finished.problems.length}
                  data-bytes={finished.json.length}
                >
                  {finished.problems.length === 0
                    ? `The file is complete and holds no location and no clock time (${finished.json.length} bytes).`
                    : `The file has ${finished.problems.length} problem(s) and should not be sent as it is.`}
                </p>
                {finished.problems.slice(0, 5).map((problem) => (
                  <p className="live__warn" key={`${problem.path}:${problem.message}`}>
                    {problem.path === '' ? '(top level)' : problem.path}: {problem.message}
                  </p>
                ))}
                <button type="button" data-testid="home-session-share" onClick={doShare}>
                  Share the file
                </button>
                {shareResult !== undefined && (
                  <p data-testid="home-session-share-result" data-outcome={shareResult.outcome}>
                    {shareResult.message}
                  </p>
                )}
                {finished.analysis !== undefined && (
                  <details className="live__session-analysis" open>
                    <summary>What the recording says</summary>
                    <ul data-testid="home-session-analysis">
                      {finished.analysis.verdicts.map((verdict) => (
                        <li
                          key={verdict.id}
                          data-verdict-id={verdict.id}
                          data-confidence={verdict.confidence}
                          data-inconclusive={String(verdict.inconclusive)}
                        >
                          <strong>{verdict.question}</strong> {verdict.answer}
                        </li>
                      ))}
                    </ul>
                    {finished.analysis.missingPoses.length > 0 && (
                      <p data-testid="home-session-missing-poses">
                        Steps with nothing recorded: {finished.analysis.missingPoses.join(', ')}.
                      </p>
                    )}
                  </details>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* The tap surface, above the drag layer, only while a step wants taps. A
          finger on the picture means "that is where the real sun is" during this
          step and "push the labels" at every other time, and the two cannot
          share one surface. */}
      {phase === 'recording' && step?.kind === 'tap' && (
        <div
          ref={tapLayerRef}
          className="live__session-taps"
          data-testid="home-session-tap-layer"
          onPointerUp={onTap}
        />
      )}
    </>
  );
}
