/**
 * The landscape pose, from raw browser events through to a `CameraPose`.
 *
 * The orientation events here are built from `web-sensors.ts`'s own documented
 * geometry, and the expectations are derived from it by hand:
 *
 *   ĝ = (cos β·sin γ, −sin β, −cos β·cos γ)          gravity, device frame
 *   pitch = asin(ĝ_z) = asin(−cos β·cos γ)            `sensors.ts`
 *   roll  = atan2(ĝ_x, −ĝ_y) = atan2(cos β·sin γ, sin β)
 *
 * So β = 90°, γ = 0 is upright with the camera level: ĝ = (0, −1, 0), pitch 0,
 * roll 0. β = 90°, γ = 0 with the phone then rotated into landscape is a
 * different event, not the same one — the whole point of the landscape decision
 * is that the DEVICE frame does not rotate with the screen.
 *
 * The heading is a Chromium `deviceorientationabsolute` event, whose alpha is
 * earth-referenced, because that is the route this project can inject in
 * headless Chromium. `rearCameraBearing` is the spec's § A.1 quantity:
 *
 *   Vx = −cos α·sin γ − sin α·sin β·cos γ
 *   Vy = −sin α·sin γ + cos α·sin β·cos γ
 *   heading = atan2(Vx, Vy)
 *
 * With γ = 0 and β = 90° that is atan2(−sin α, cos α) = −α, so an alpha of
 * 94.6° is a camera bearing of 265.4° — the Gornergrat heading the e2e uses.
 */

import { describe, expect, it } from 'vitest';

import { webOrientationSample, type WebOrientationEventLike } from '../../live/web-sensors';
import { NO_TRIM } from '../trim';
import {
  isLandscapeViewport,
  landscapePose,
  screenRollDeg,
  type LandscapePoseInput,
} from './landscape-pose';

const FOV = { hFovDeg: 65.4704525442152, vFovDeg: 40 };

/** A Chromium absolute-orientation event: earth-referenced alpha. */
function absoluteEvent(alphaDeg: number, betaDeg: number, gammaDeg: number): WebOrientationEventLike {
  return { alpha: alphaDeg, beta: betaDeg, gamma: gammaDeg, absolute: true };
}

/** Convert one event into the traces `landscapePose` consumes. */
function tracesFrom(
  events: readonly { event: WebOrientationEventLike; tMs: number }[],
  screenAngleDeg = 0,
): Pick<LandscapePoseInput, 'gravity' | 'heading'> {
  const gravity = [];
  const heading = [];
  for (const { event, tMs } of events) {
    const sample = webOrientationSample(event, screenAngleDeg, tMs);
    if (sample.gravity.ok) gravity.push(sample.gravity.value.sample);
    if (sample.heading.ok) heading.push(sample.heading.value.sample);
  }
  return { gravity, heading };
}

describe('isLandscapeViewport', () => {
  it('is landscape only when the viewport is wider than it is tall', () => {
    expect(isLandscapeViewport(844, 390)).toBe(true);
    expect(isLandscapeViewport(390, 844)).toBe(false);
    // A square viewport has no long edge to hold level.
    expect(isLandscapeViewport(500, 500)).toBe(false);
  });
});

describe('screenRollDeg', () => {
  it('is the device roll unchanged on a screen whose natural orientation is used', () => {
    // Angle 0 — a desktop browser, and a phone in its natural orientation. The
    // two hypotheses agree here, which is why the e2e does not depend on the
    // unsettled sign.
    for (const hypothesis of ['add-screen-angle', 'subtract-screen-angle'] as const) {
      expect(screenRollDeg(-4.5, 0, hypothesis)).toBeCloseTo(-4.5, 12);
      expect(screenRollDeg(0, 0, hypothesis)).toBe(0);
    }
  });

  it('cancels a quarter turn under the default hypothesis', () => {
    // A phone rolled to −90° in the device frame, with the screen reporting 90°:
    // −90 + 90 = 0, a level horizon, which is what holding it sideways looks
    // like.
    expect(screenRollDeg(-90, 90, 'add-screen-angle')).toBe(0);
    expect(screenRollDeg(90, 270, 'add-screen-angle')).toBe(0);
  });

  it('is 180° out under the other hypothesis — visibly, not subtly', () => {
    // The whole argument for offering a toggle rather than guessing: the wrong
    // sign in landscape is an upside-down overlay, not a small drift.
    expect(Math.abs(screenRollDeg(-90, 90, 'subtract-screen-angle'))).toBe(180);
  });

  it('folds onto (−180, 180] so the sign always reads', () => {
    expect(screenRollDeg(-170, 270, 'add-screen-angle')).toBeCloseTo(100, 12);
    expect(screenRollDeg(90, 90, 'add-screen-angle')).toBe(180);
    expect(screenRollDeg(1, 180, 'add-screen-angle')).toBeCloseTo(-179, 12);
  });
});

describe('landscapePose', () => {
  /** Upright, camera level, looking along 265.4° magnetic. */
  const UPRIGHT = absoluteEvent(94.6, 90, 0);

  it('reads heading, pitch and roll from one absolute-orientation event', () => {
    const traces = tracesFrom([{ event: UPRIGHT, tMs: 1000 }]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // heading = −alpha = −94.6 → 265.4 after folding onto [0, 360).
    expect(result.value.pose.headingDeg).toBeCloseTo(265.4, 9);
    // pitch = asin(−cos 90°·cos 0°) = asin(0) = 0.
    expect(result.value.pose.pitchDeg).toBeCloseTo(0, 9);
    // roll = atan2(cos 90°·sin 0°, sin 90°) = atan2(0, 1) = 0.
    expect(result.value.pose.rollDeg).toBeCloseTo(0, 9);
    expect(result.value.pose.hFovDeg).toBe(FOV.hFovDeg);
    // `applyTrim` re-derives vFov from hFov and the pose's aspect ratio even
    // for a zero trim, so it round-trips through the tangent relation.
    expect(result.value.pose.vFovDeg).toBeCloseTo(FOV.vFovDeg, 9);
  });

  it('reads a camera tilted 20° up', () => {
    // β = 70°, γ = 0: pitch = asin(−cos 70°·cos 0°) = asin(−0.342) = −20°.
    // A smaller beta is the phone leaning BACK from upright, which points the
    // rear camera DOWN — so 110° is the 20°-up pose.
    const traces = tracesFrom([{ event: absoluteEvent(94.6, 110, 0), tMs: 500 }]);
    const result = landscapePose({
      ...traces,
      atMs: 500,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // asin(−cos 110°) = asin(0.34202) = 20°.
    expect(result.value.pose.pitchDeg).toBeCloseTo(20, 9);
  });

  it('reports the platform’s heading as `true` when the samples carry one', () => {
    // A Chromium absolute-alpha sample is magnetic and carries no trueDeg, so
    // the policy has to convert or label it. With no position it labels it MAG.
    const traces = tracesFrom([{ event: UPRIGHT, tMs: 1000 }]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.heading.basis).toBe('magnetic');
    expect(result.value.heading.caveat).toContain('Magnetic north, not true north');
  });

  it('converts with WMM2025 once a position is known, and says so', () => {
    // Bogus Basin, 2026-09-29: IMPLEMENTATION.md's live heading policy records
    // 100.00° magnetic becoming 112.605° true there. Same site and date here,
    // so the conversion is the one the NOAA-verified module already produced.
    const traces = tracesFrom([{ event: absoluteEvent(260, 90, 0), tMs: 1000 }]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      modelDeclination: {
        site: { latitudeDeg: 43.77, longitudeDeg: -116.09, heightM: 2000 },
        when: new Date('2026-09-29T12:00:00Z'),
      },
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.heading.basis).toBe('true-model');
    expect(result.value.heading.model?.modelName).toBe('WMM-2025');
    // heading = −260 → 100° magnetic, plus the model's declination.
    // IMPLEMENTATION.md's live heading policy cites this site and date: the
    // NOAA-verified module turns 100.00° magnetic into 112.605° true.
    const declination = result.value.heading.model?.declinationDeg ?? 0;
    expect(declination).toBeCloseTo(12.605, 2);
    expect(result.value.pose.headingDeg).toBeCloseTo(100 + declination, 6);
    expect(result.value.heading.caveat).toContain('WMM-2025');
  });

  it('applies the user’s drag on top of the sensed pose, and keeps both', () => {
    const traces = tracesFrom([{ event: UPRIGHT, tMs: 1000 }]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: { headingDeg: -7.5, pitchDeg: 2.25, hFovDeg: 0 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sensedPose.headingDeg).toBeCloseTo(265.4, 9);
    expect(result.value.pose.headingDeg).toBeCloseTo(257.9, 9);
    expect(result.value.pose.pitchDeg).toBeCloseTo(2.25, 9);
  });

  it('keeps the visible box’s shape when the drag changes the field of view', () => {
    // `applyTrim` re-derives vFov from hFov and the pose's own aspect ratio, so
    // widening by 10° must keep tan(v/2)/tan(h/2) fixed — the visible box's
    // shape, not the camera frame's.
    const traces = tracesFrom([{ event: UPRIGHT, tMs: 1000 }]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      visibleFov: { hFovDeg: 60, vFovDeg: 40 },
      screenAngle: 0,
      trim: { headingDeg: 0, pitchDeg: 0, hFovDeg: 10 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const DEG = Math.PI / 180;
    const shapeBefore = Math.tan(20 * DEG) / Math.tan(30 * DEG);
    const shapeAfter =
      Math.tan((result.value.pose.vFovDeg / 2) * DEG) /
      Math.tan((result.value.pose.hFovDeg / 2) * DEG);
    expect(result.value.pose.hFovDeg).toBeCloseTo(70, 9);
    expect(shapeAfter).toBeCloseTo(shapeBefore, 9);
  });

  it('draws level and says so when roll is refused, rather than refusing the frame', () => {
    // β = 5°, γ = 0: pitch = asin(−cos 5°) = −85.0°, inside the 80° gimbal
    // band, so `sensors.ts` withholds roll. A level frame is a much smaller
    // error there than no frame at all.
    const traces = tracesFrom([{ event: absoluteEvent(94.6, 5, 0), tMs: 100 }]);
    const result = landscapePose({
      ...traces,
      atMs: 100,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.rollAssumedLevel).toBe(true);
    expect(result.value.pose.rollDeg).toBe(0);
    expect(result.value.pose.pitchDeg).toBeCloseTo(-85, 6);
  });

  it('refuses with a remedy when nothing has arrived', () => {
    const result = landscapePose({
      gravity: [],
      heading: [],
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('no-orientation');
    expect(result.detail).toContain('no-samples');
  });

  it('refuses stale samples rather than drawing a pose from a second ago', () => {
    const traces = tracesFrom([{ event: UPRIGHT, tMs: 0 }]);
    const result = landscapePose({
      ...traces,
      // 3 s later: past `sensors.ts`'s 1.5 s default maxAgeMs.
      atMs: 3000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('sensors-stale');
  });

  it('smooths a trace and reports its scatter', () => {
    // Three events one hand-wobble apart in alpha: 94.1, 94.6, 95.1 → headings
    // 265.9, 265.4, 264.9. The circular mean is 265.4 and the scatter is
    // non-zero, which is what the uncertainty band reads.
    const traces = tracesFrom([
      { event: absoluteEvent(94.1, 90, 0), tMs: 900 },
      { event: absoluteEvent(94.6, 90, 0), tMs: 950 },
      { event: absoluteEvent(95.1, 90, 0), tMs: 1000 },
    ]);
    const result = landscapePose({
      ...traces,
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pose.headingDeg).toBeGreaterThan(265);
    expect(result.value.pose.headingDeg).toBeLessThan(266);
    expect(result.value.heading.sampleCount).toBe(3);
    expect(result.value.heading.spreadDeg ?? 0).toBeGreaterThan(0);
  });

  it('moves the labels’ heading by exactly the heading change injected', () => {
    // The property the e2e asserts in pixels: a 10° turn moves the pose's
    // heading by 10°, no more and no less.
    const before = landscapePose({
      ...tracesFrom([{ event: absoluteEvent(94.6, 90, 0), tMs: 1000 }]),
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    const after = landscapePose({
      ...tracesFrom([{ event: absoluteEvent(84.6, 90, 0), tMs: 1000 }]),
      atMs: 1000,
      visibleFov: FOV,
      screenAngle: 0,
      trim: NO_TRIM,
    });
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value.pose.headingDeg - before.value.pose.headingDeg).toBeCloseTo(10, 9);
  });
});
