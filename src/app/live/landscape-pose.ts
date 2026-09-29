/**
 * The landscape camera pose, from the browser's sensor traces.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY LANDSCAPE, AND WHAT THAT BUYS
 * ═══════════════════════════════════════════════════════════════════════════
 * Held upright in portrait, the iPhone's compass reference edge — the portrait
 * top edge — points at the sky, and no public source says what
 * `webkitCompassHeading` reports there. Held upright in LANDSCAPE, that edge is
 * horizontal and the reading is usable with no stored alpha offset
 * (IMPLEMENTATION.md, "The field pose is landscape"). So this screen refuses
 * portrait outright rather than drawing something it cannot defend.
 *
 * The chain this module completes:
 *
 *     raw browser events
 *       → webOrientationSample         src/live/web-sensors.ts  (pure, tested)
 *       → fuseSensorPose               src/live/sensors.ts      (pitch, roll)
 *       → resolveHeadingForDrawing     src/live/heading-policy.ts (WMM2025)
 *       → CameraPose + applyTrim       here
 *
 * Nothing in the chain is re-derived here. What this module adds is the two
 * things that are specific to a rotated screen: deciding landscape, and turning
 * the DEVICE roll the sensors report into the SCREEN roll the overlay is drawn
 * at.
 *
 * ── THE ONE SIGN THIS PROJECT HAS NOT MEASURED ─────────────────────────────
 * `screen.orientation.angle` does not move the device's coordinate frame, so a
 * phone rotated into landscape reports a device roll near ±90° while its screen
 * shows a level horizon. Converting one to the other needs the sign of the
 * screen rotation, and TODO.md still carries "Settle the device-roll to
 * screen-roll sign from the home recording" as open work.
 *
 * So it is not guessed silently. Both readings are named
 * {@link ScreenRollHypothesis}, the screen says which one is in use, and the
 * user can flip it — the same treatment `web-sensors.ts` gives the compass
 * reference question. The wrong choice is not subtle: in landscape the two
 * differ by 180°, so the overlay is plainly upside down and one tap fixes it.
 * A screen whose natural orientation is already landscape reports angle 0,
 * where the two hypotheses agree and the question does not arise.
 */

import { normaliseBearingDeg } from '../../core/geodesy';
import type { CameraPose } from '../../core/types';
import {
  resolveHeadingForDrawing,
  type DrawableHeading,
  type ModelDeclinationInput,
} from '../../live/heading-policy';
import { fuseSensorPose, type GravitySample, type HeadingSample } from '../../live/sensors';
import type { WebScreenAngle } from '../../live/web-sensors';
import { applyTrim, type TrimState } from '../trim';
import { refusalForSensorFusion, type LiveRefusalCode } from './refusals';
import type { FieldOfViewDeg } from './video-box';

/**
 * Which way `screen.orientation.angle` turns the device frame into the screen
 * frame.
 *
 * `'add-screen-angle'` reads the angle as the clockwise rotation the content
 * receives, so a device rolled to −90° with the screen at 90° shows a level
 * horizon. `'subtract-screen-angle'` is the opposite reading. Unsettled; see
 * the module header.
 */
export type ScreenRollHypothesis = 'add-screen-angle' | 'subtract-screen-angle';

export const DEFAULT_SCREEN_ROLL_HYPOTHESIS: ScreenRollHypothesis = 'add-screen-angle';

/** Fold a signed angle onto (−180, 180]. */
function foldSigned(deg: number): number {
  const wrapped = normaliseBearingDeg(deg);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * The roll of the drawn frame, from the roll of the device.
 *
 * Returns a signed angle in (−180, 180], matching `CameraPose.rollDeg`'s "+ =
 * clockwise rotation of the frame".
 */
export function screenRollDeg(
  deviceRollDeg: number,
  screenAngle: WebScreenAngle,
  hypothesis: ScreenRollHypothesis = DEFAULT_SCREEN_ROLL_HYPOTHESIS,
): number {
  const signed = hypothesis === 'add-screen-angle' ? screenAngle : -screenAngle;
  return foldSigned(deviceRollDeg + signed);
}

/**
 * Is the viewport wider than it is tall?
 *
 * The layout question, answered from the layout rather than from
 * `screen.orientation`: the viewport is what the overlay is drawn into, it is
 * what a desktop browser reports honestly, and on iOS it changes with the
 * rotation the user is being asked to perform. A square viewport counts as
 * portrait, because there is no long edge to hold level.
 */
export function isLandscapeViewport(widthPx: number, heightPx: number): boolean {
  return widthPx > heightPx;
}

export interface LandscapePoseInput {
  readonly gravity: readonly GravitySample[];
  readonly heading: readonly HeadingSample[];
  /** The instant the pose is wanted, on the same clock as the samples. */
  readonly atMs: number;
  /** Where and when, for WMM2025. Absent until the position fix arrives. */
  readonly modelDeclination?: ModelDeclinationInput | undefined;
  /** Field of view of the visible video box (see `video-box.ts`). */
  readonly visibleFov: FieldOfViewDeg;
  readonly screenAngle: WebScreenAngle;
  readonly screenRollHypothesis?: ScreenRollHypothesis;
  /** The user's drag, applied on top of the sensed pose (D9). */
  readonly trim: TrimState;
  /**
   * The re-anchor's heading correction, degrees. Unclamped, and untouched by
   * any drag — see `src/app/trim.ts`. Zero until a re-anchor sets one.
   */
  readonly grossHeadingOffsetDeg?: number | undefined;
}

export interface LandscapePose {
  /** The pose the overlay is drawn with — sensors plus the user's drag. */
  readonly pose: CameraPose;
  /** The same pose before the drag, so the screen can report both. */
  readonly sensedPose: CameraPose;
  readonly heading: DrawableHeading;
  /** Scatter of the gravity trace's pitch, degrees. Undefined for one sample. */
  readonly pitchSpreadDeg: number | undefined;
  /** Scatter of the trace's roll, degrees. Undefined for one sample. */
  readonly rollSpreadDeg: number | undefined;
  /** True when roll was refused and 0 was drawn instead. */
  readonly rollAssumedLevel: boolean;
}

export type LandscapePoseResult =
  | { readonly ok: true; readonly value: LandscapePose }
  | { readonly ok: false; readonly refusal: LiveRefusalCode; readonly detail: string };

/**
 * Assemble the pose, or say why not.
 *
 * Pitch and heading are both required: without pitch there is no vertical
 * placement and without a heading there is no horizontal one, so either
 * refusing refuses the frame. Roll is not required — `sensors.ts` withholds it
 * near the gimbal zone, and a level frame is a far smaller error there than no
 * frame at all — so a refused roll draws level and says so.
 */
export function landscapePose(input: LandscapePoseInput): LandscapePoseResult {
  const sensors = fuseSensorPose(
    { gravity: input.gravity, heading: input.heading },
    input.atMs,
  );

  if (!sensors.pitch.ok) {
    return {
      ok: false,
      refusal: refusalForSensorFusion(sensors.pitch.refusal),
      detail: `pitch refused: ${sensors.pitch.refusal}`,
    };
  }

  const decision = resolveHeadingForDrawing(input.heading, input.atMs, {
    ...(input.modelDeclination === undefined
      ? {}
      : { modelDeclination: input.modelDeclination }),
  });
  if (!decision.ok) {
    return {
      ok: false,
      refusal: refusalForSensorFusion(decision.refusal),
      detail: `heading refused: ${decision.refusal} — ${decision.detail}`,
    };
  }

  const rollAssumedLevel = !sensors.roll.ok;
  const deviceRollDeg = sensors.roll.ok ? sensors.roll.field.valueDeg : 0;

  const sensedPose: CameraPose = {
    headingDeg: normaliseBearingDeg(decision.heading.headingDeg),
    pitchDeg: sensors.pitch.field.valueDeg,
    rollDeg: screenRollDeg(
      deviceRollDeg,
      input.screenAngle,
      input.screenRollHypothesis ?? DEFAULT_SCREEN_ROLL_HYPOTHESIS,
    ),
    hFovDeg: input.visibleFov.hFovDeg,
    vFovDeg: input.visibleFov.vFovDeg,
  };

  return {
    ok: true,
    value: {
      sensedPose,
      // `applyTrim` re-derives vFov from hFov and the pose's aspect ratio, so
      // the trimmed pose keeps the visible box's shape rather than the camera
      // frame's.
      pose: applyTrim(sensedPose, input.trim, input.grossHeadingOffsetDeg ?? 0),
      heading: decision.heading,
      pitchSpreadDeg: sensors.pitch.field.spreadDeg,
      rollSpreadDeg: sensors.roll.ok ? sensors.roll.field.spreadDeg : undefined,
      rollAssumedLevel,
    },
  };
}
