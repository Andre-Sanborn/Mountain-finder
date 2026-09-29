/**
 * The browser → `sensors.ts` adapters, tested against the specifications they
 * claim to implement.
 *
 * Every expectation below is derived by hand, and most of them are derived
 * twice. Three independent references are used, and they are independent of
 * each other as well as of this code:
 *
 *   1. The W3C Device Orientation and Motion specification's own worked
 *      examples (Editor's Draft, 12 February 2025). Its § 1 states the angles
 *      for three named poses and the acceleration for two more; its § A.1 gives
 *      the compass heading of the rear camera and two consistency checks on it.
 *      Those are numbers this project did not choose.
 *   2. `calibration.ts`'s four holds, whose expected gravity vectors were
 *      derived from `sensors.ts`'s frame convention before this module existed.
 *      Web events built for those poses must reproduce them exactly, and the
 *      four-hold diagnosis must return `matches-convention`.
 *   3. Each browser's published arithmetic, quoted in `web-sensors.ts`'s
 *      header. A motion payload is BUILT by pushing a chosen gravity direction
 *      and a chosen user acceleration through the expression WebKit or Chromium
 *      actually evaluates, and the adapter must recover the direction that went
 *      in.
 *
 * The one test that matters most is the sign test. Reading a motion event in
 * the wrong browser's convention inverts every pitch, which passes a smoke
 * test and draws a plausible mountain overlay upside down. That inversion is
 * asserted here as a failure mode, not left to be discovered on a hillside.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CALIBRATION_HOLDS,
  describeAxisMap,
  diagnoseConvention,
  type CalibrationHold,
  type Observation,
} from './calibration';
import { fuseSensorPose, orientationFromGravity } from './sensors';
import {
  MAX_USEFUL_ACCURACY_DEG,
  STANDARD_GRAVITY_MS2,
  absoluteAlphaFromTopEdgeBearing,
  detectMotionGravityConvention,
  gravityFromOrientation,
  gravitySampleFromWebMotion,
  gravitySampleFromWebOrientation,
  headingSampleFromWebOrientation,
  normaliseScreenAngle,
  rearCameraBearing,
  rearCameraHeadingFromRelativeAlpha,
  rearCameraHeadingUnderHypothesis,
  replayWebSensorEvents,
  rotationMatrixFromOrientation,
  topEdgeBearing,
  webCompassReading,
  webMotionSample,
  webOrientationSample,
  type RecordedWebSensorEvent,
  type WebMotionEventLike,
  type WebOrientationEventLike,
} from './web-sensors';

const FIXTURE = fileURLToPath(
  new URL('../../fixtures/sensors/web/synthetic-events.json', import.meta.url),
);

/** Angles close enough that only a real error in the derivation shows. */
const TIGHT = 1e-9;

/** A Chromium `deviceorientationabsolute` event. */
function absoluteEvent(alpha: number, beta: number, gamma: number): WebOrientationEventLike {
  return { alpha, beta, gamma, absolute: true };
}

/** An iOS `deviceorientation` event: relative alpha plus the two webkit fields. */
function iosEvent(
  relativeAlpha: number,
  beta: number,
  gamma: number,
  compassHeading: number,
  compassAccuracy: number,
): WebOrientationEventLike {
  return {
    alpha: relativeAlpha,
    beta,
    gamma,
    webkitCompassHeading: compassHeading,
    webkitCompassAccuracy: compassAccuracy,
  };
}

/**
 * Build the `devicemotion` payload Chromium emits: the W3C specific force,
 * which is the NEGATION of gravity, plus the linear acceleration. Both in m/s².
 */
function chromiumMotion(
  gravityDown: { x: number; y: number; z: number },
  linearMs2: { x: number; y: number; z: number },
): WebMotionEventLike {
  const G = STANDARD_GRAVITY_MS2;
  return {
    acceleration: linearMs2,
    accelerationIncludingGravity: {
      x: linearMs2.x - gravityDown.x * G,
      y: linearMs2.y - gravityDown.y * G,
      z: linearMs2.z - gravityDown.z * G,
    },
  };
}

/**
 * Build the payload iOS Safari emits, from `WebCoreMotionManager.mm`:
 * `acceleration = userAcceleration · G` and
 * `accelerationIncludingGravity = (userAcceleration + gravity) · G`, with
 * CoreMotion's gravity pointing DOWN and user acceleration in g.
 */
function safariMotion(
  gravityDown: { x: number; y: number; z: number },
  userAccelG: { x: number; y: number; z: number },
): WebMotionEventLike {
  const G = STANDARD_GRAVITY_MS2;
  return {
    acceleration: { x: userAccelG.x * G, y: userAccelG.y * G, z: userAccelG.z * G },
    accelerationIncludingGravity: {
      x: (userAccelG.x + gravityDown.x) * G,
      y: (userAccelG.y + gravityDown.y) * G,
      z: (userAccelG.z + gravityDown.z) * G,
    },
  };
}

function expectBearing(
  outcome: ReturnType<typeof rearCameraBearing>,
  expectedDeg: number,
  tolerance = TIGHT,
): void {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return;
  expect(outcome.value.headingDeg).toBeCloseTo(expectedDeg, -Math.log10(tolerance));
}

/**
 * The angles each `calibration.ts` hold produces, worked out by inverting
 * ĝ = (cos β · sin γ, −sin β, −cos β · cos γ):
 *
 *   flat-face-up      ĝ = (0, 0, −1)  needs sin β = 0, cos β cos γ = +1  → β 0,    γ 0
 *   upright-portrait  ĝ = (0, −1, 0)  needs sin β = 1                    → β 90,   γ 0
 *   flat-face-down    ĝ = (0, 0, +1)  needs cos β cos γ = −1, cos γ ≥ 0  → β −180, γ 0
 *   right-edge-down   ĝ = (1, 0, 0)   needs cos β sin γ = 1              → β 0,    γ 90
 *
 * gamma's stated range is [−90, 90), so `right-edge-down`'s γ = 90 sits on the
 * boundary. WebKit's own decoder resolves that pose to (β −180, γ −90) instead;
 * `HOLD_ALIASES` carries that second representation, and it must give the same
 * gravity vector.
 */
const HOLD_ANGLES: Readonly<Record<CalibrationHold, { beta: number; gamma: number }>> = {
  'flat-face-up': { beta: 0, gamma: 0 },
  'upright-portrait': { beta: 90, gamma: 0 },
  'flat-face-down': { beta: -180, gamma: 0 },
  'right-edge-down': { beta: 0, gamma: 90 },
};

const HOLD_ALIASES: Readonly<Partial<Record<CalibrationHold, { beta: number; gamma: number }>>> = {
  'right-edge-down': { beta: -180, gamma: -90 },
  'flat-face-down': { beta: 180, gamma: 0 },
};

function holdAngles(hold: CalibrationHold): { beta: number; gamma: number } {
  const angles = HOLD_ANGLES[hold];
  return angles;
}

describe('the rotation matrix, against the specification that defines it', () => {
  it('is the identity when all three angles are zero', () => {
    const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    rotationMatrixFromOrientation(0, 0, 0).forEach((value, index) => {
      expect(value).toBeCloseTo(identity[index] ?? Number.NaN, 15);
    });
  });

  it('is orthonormal, so it is a rotation rather than a shear', () => {
    for (const [a, b, g] of [
      [17, 43, -29],
      [250, -120, 61],
      [359, 179, -89],
    ] as const) {
      const m = rotationMatrixFromOrientation(a, b, g);
      const rows = [
        [m[0], m[1], m[2]],
        [m[3], m[4], m[5]],
        [m[6], m[7], m[8]],
      ] as const;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const ri = rows[i] ?? [0, 0, 0];
          const rj = rows[j] ?? [0, 0, 0];
          const dot = (ri[0] ?? 0) * (rj[0] ?? 0) + (ri[1] ?? 0) * (rj[1] ?? 0) + (ri[2] ?? 0) * (rj[2] ?? 0);
          expect(dot).toBeCloseTo(i === j ? 1 : 0, 9);
        }
      }
    }
  });

  it('puts the top edge west at alpha 90, the specification § 1 example', () => {
    // "A device lying flat on a horizontal surface with the top of the screen
    // pointing West has the following orientation: alpha: 90, beta: 0, gamma: 0"
    expectBearing(topEdgeBearing(90, 0, 0), 270);
  });

  it('gives the top edge bearing 360 − alpha for any flat device', () => {
    // "As the device is turned on the horizontal surface, the compass heading
    // is (360 - alpha)."
    for (const alpha of [0, 15, 90, 180, 271, 359]) {
      expectBearing(topEdgeBearing(alpha, 0, 0), (360 - alpha) % 360);
    }
  });
});

describe('gravity from beta and gamma', () => {
  it('reproduces every calibration hold that sensors.ts already documents', () => {
    for (const spec of CALIBRATION_HOLDS) {
      const { beta, gamma } = holdAngles(spec.hold);
      const g = gravityFromOrientation(beta, gamma);
      expect(g.x).toBeCloseTo(spec.expected.x, 9);
      expect(g.y).toBeCloseTo(spec.expected.y, 9);
      expect(g.z).toBeCloseTo(spec.expected.z, 9);
    }
  });

  it('gives the same vector for each pose written the other legal way', () => {
    for (const [hold, alias] of Object.entries(HOLD_ALIASES)) {
      if (!alias) continue;
      const primary = holdAngles(hold as CalibrationHold);
      const a = gravityFromOrientation(primary.beta, primary.gamma);
      const b = gravityFromOrientation(alias.beta, alias.gamma);
      expect(b.x).toBeCloseTo(a.x, 9);
      expect(b.y).toBeCloseTo(a.y, 9);
      expect(b.z).toBeCloseTo(a.z, 9);
    }
  });

  it('is a unit vector at every attitude, so the magnitude gate never fires on it', () => {
    for (let beta = -180; beta < 180; beta += 13) {
      for (let gamma = -90; gamma < 90; gamma += 7) {
        const g = gravityFromOrientation(beta, gamma);
        expect(Math.hypot(g.x, g.y, g.z)).toBeCloseTo(1, 12);
      }
    }
  });

  it('ignores alpha, which is what makes it usable on iOS', () => {
    const upright = gravityFromOrientation(90, 0);
    for (const alpha of [0, 90, 200, 359]) {
      const sample = gravitySampleFromWebOrientation(absoluteEvent(alpha, 90, 0), 0);
      expect(sample.ok).toBe(true);
      if (!sample.ok) continue;
      expect(sample.value.sample.y).toBeCloseTo(upright.y, 12);
      expect(sample.value.contaminated).toBe(false);
    }
  });

  it('refuses an event whose angles are null, the spec’s "no information" form', () => {
    const outcome = gravitySampleFromWebOrientation({ alpha: null, beta: null, gamma: null }, 0);
    expect(outcome).toEqual({ ok: false, refusal: 'no-orientation' });
  });
});

describe('the four-hold convention check, driven from hand-built web events', () => {
  function observationsFrom(
    build: (hold: CalibrationHold) => { x: number; y: number; z: number },
  ): Observation[] {
    return CALIBRATION_HOLDS.map((spec) => ({ hold: spec.hold, measured: build(spec.hold) }));
  }

  it('returns matches-convention for gravity read out of orientation events', () => {
    const diagnosis = diagnoseConvention(
      observationsFrom((hold) => {
        const { beta, gamma } = holdAngles(hold);
        const sample = gravitySampleFromWebOrientation(absoluteEvent(0, beta, gamma), 0);
        if (!sample.ok) throw new Error(`hold ${hold} refused: ${sample.refusal}`);
        return sample.value.sample;
      }),
    );
    expect(diagnosis.verdict).toBe('matches-convention');
    expect(diagnosis.worstErrorDeg).toBeLessThan(1e-6);
    expect(diagnosis.constrainedAxes).toEqual(['x', 'y', 'z']);
  });

  it('names the all-axis sign flip when a Chromium event is read as CoreMotion', () => {
    // The wrong convention negates all three components, which is exactly the
    // mistake a reader of the W3C text alone would make on Safari, or a reader
    // of WebKit's source alone would make on Chromium.
    const diagnosis = diagnoseConvention(
      observationsFrom((hold) => {
        const { beta, gamma } = holdAngles(hold);
        const truth = gravityFromOrientation(beta, gamma);
        const event = chromiumMotion(truth, { x: 0, y: 0, z: 0.001 });
        const sample = gravitySampleFromWebMotion(event, 0, 'coremotion-gravity');
        if (!sample.ok) throw new Error(`hold ${hold} refused: ${sample.refusal}`);
        return sample.value.sample;
      }),
      2,
    );
    expect(diagnosis.verdict).toBe('systematic-remap');
    expect(diagnosis.bestMap && describeAxisMap(diagnosis.bestMap)).toBe('x←−x, y←−y, z←−z');
  });
});

describe('the two named poses', () => {
  it('flat, face up, top edge north: top edge bearing 0 and no camera bearing', () => {
    // alpha 0 follows from the specification's own rule that a flat device's
    // compass heading is 360 − alpha; north is 0, so alpha is 0.
    const event = absoluteEvent(0, 0, 0);
    expectBearing(topEdgeBearing(0, 0, 0), 0);

    const gravity = gravitySampleFromWebOrientation(event, 1_000);
    expect(gravity.ok).toBe(true);
    if (!gravity.ok) return;
    expect(gravity.value.sample.z).toBeCloseTo(-1, 12);

    // The camera looks out of the back, so flat and face up points it at the
    // floor. Its bearing has no meaning there and must be refused, not zeroed.
    expect(rearCameraBearing(0, 0, 0)).toEqual({ ok: false, refusal: 'camera-near-vertical' });
    expect(headingSampleFromWebOrientation(event, 1_000)).toEqual({
      ok: false,
      refusal: 'camera-near-vertical',
    });

    const pose = orientationFromGravity(gravity.value.sample);
    expect(pose.ok).toBe(true);
    if (!pose.ok) return;
    expect(pose.pitchDeg).toBeCloseTo(-90, 9);
    expect(pose.rollDeg).toBeUndefined();
  });

  it('upright portrait, rear camera east: alpha 270, beta 90, gamma 0', () => {
    // Derived from § A.1's formula with beta 90 and gamma 0:
    //   Vx = −sin α, Vy = cos α, so the bearing is atan2(−sin α, cos α) = −α.
    // East is 90, so alpha is 270.
    const event = absoluteEvent(270, 90, 0);
    const heading = headingSampleFromWebOrientation(event, 2_000);
    expect(heading.ok).toBe(true);
    if (!heading.ok) return;
    expect(heading.value.sample.magneticDeg).toBeCloseTo(90, 9);
    expect(heading.value.basis).toBe('magnetic');
    expect(heading.value.route).toBe('absolute-alpha');
    expect(heading.value.bearing.horizontalFraction).toBeCloseTo(1, 12);
    expect(heading.value.sample.trueDeg).toBeUndefined();
    expect(heading.value.sample.accuracyDeg).toBeUndefined();

    const gravity = gravitySampleFromWebOrientation(event, 2_000);
    expect(gravity.ok).toBe(true);
    if (!gravity.ok) return;
    const pose = orientationFromGravity(gravity.value.sample);
    expect(pose.ok).toBe(true);
    if (!pose.ok) return;
    expect(pose.pitchDeg).toBeCloseTo(0, 9);
    expect(pose.rollDeg).toBeCloseTo(0, 9);

    // The top edge points at the sky in this pose, which is the whole problem
    // with using CLHeading for it.
    expect(topEdgeBearing(270, 90, 0)).toEqual({
      ok: false,
      refusal: 'compass-reference-near-vertical',
    });
  });

  it('turns the whole camera bearing circle for an upright phone', () => {
    for (const bearing of [0, 30, 90, 137, 180, 270, 359]) {
      expectBearing(rearCameraBearing(normalise(-bearing), 90, 0), bearing, 1e-6);
    }
  });
});

function normalise(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

describe('the camera bearing, against § A.1’s own consistency checks', () => {
  it('reproduces the specification’s third § 1 example for every heading', () => {
    // "A user facing a compass heading of alpha degrees is holding the device
    // in their hand, with the screen in a vertical plane and the top of the
    // screen pointing to their right. The orientation of the device is:
    // alpha: 270 - alpha, beta: 0, gamma: 90."
    // The screen faces the user, so the camera looks the way the user faces.
    for (const facing of [0, 23, 90, 181, 300]) {
      expectBearing(rearCameraBearing(normalise(270 - facing), 0, 90), facing, 1e-6);
    }
  });

  it('equals the top edge bearing at gamma 0 with the phone tilted back', () => {
    // At gamma 0 both axes lie in the device's y–z plane, which is vertical, so
    // their horizontal projections point the same way. This is what lets a
    // CLHeading reading anchor the camera on a tilted phone.
    for (const beta of [5, 30, 60, 85]) {
      for (const alpha of [0, 47, 200, 333]) {
        const camera = rearCameraBearing(alpha, beta, 0);
        const top = topEdgeBearing(alpha, beta, 0);
        expect(camera.ok && top.ok).toBe(true);
        if (!camera.ok || !top.ok) continue;
        expect(camera.value.headingDeg).toBeCloseTo(top.value.headingDeg, 6);
      }
    }
  });

  it('measures the same vertical component that gravity gives as pitch', () => {
    // The camera's elevation and `sensors.ts`'s pitch are the same number by
    // two routes: asin of the matrix's −m33, and asin of ĝ_z. If these ever
    // disagree the two modules disagree about where the gimbal zone is.
    for (let beta = -170; beta < 180; beta += 11) {
      for (let gamma = -85; gamma < 90; gamma += 9) {
        const g = gravityFromOrientation(beta, gamma);
        const fromGravity = orientationFromGravity(g);
        expect(fromGravity.ok).toBe(true);
        if (!fromGravity.ok) continue;
        const m = rotationMatrixFromOrientation(0, beta, gamma);
        const fromMatrix = (Math.asin(Math.max(-1, Math.min(1, -(m[8] ?? 0)))) * 180) / Math.PI;
        expect(fromMatrix).toBeCloseTo(fromGravity.pitchDeg, 9);
      }
    }
  });

  it('refuses a camera within a degree of straight down', () => {
    // gamma 0, beta 0.5: the camera is 89.5° below horizontal.
    expect(rearCameraBearing(0, 0.5, 0)).toEqual({ ok: false, refusal: 'camera-near-vertical' });
    // beta 1.01 clears it, so the gate is where the constant says it is.
    expect(rearCameraBearing(0, 1.01, 0).ok).toBe(true);
  });
});

describe('motion events, in both browsers’ conventions', () => {
  const POSES: readonly { name: string; gravity: { x: number; y: number; z: number } }[] = [
    { name: 'face up', gravity: { x: 0, y: 0, z: -1 } },
    { name: 'upright portrait', gravity: { x: 0, y: -1, z: 0 } },
    { name: 'face down', gravity: { x: 0, y: 0, z: 1 } },
    { name: 'right edge down', gravity: { x: 1, y: 0, z: 0 } },
    { name: 'tilted 30° up', gravity: { x: 0, y: -Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) } },
  ];

  it('recovers the gravity that went in, on each browser, with its own sign', () => {
    for (const pose of POSES) {
      const chromium = gravitySampleFromWebMotion(
        chromiumMotion(pose.gravity, { x: 0.4, y: -0.2, z: 0.1 }),
        0,
        'w3c-specific-force',
      );
      const safari = gravitySampleFromWebMotion(
        safariMotion(pose.gravity, { x: 0.05, y: 0.02, z: -0.01 }),
        0,
        'coremotion-gravity',
      );
      expect(chromium.ok && safari.ok).toBe(true);
      if (!chromium.ok || !safari.ok) continue;
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(chromium.value.sample[axis]).toBeCloseTo(pose.gravity[axis], 9);
        expect(safari.value.sample[axis]).toBeCloseTo(pose.gravity[axis], 9);
      }
      expect(chromium.value.contaminated).toBe(false);
      expect(chromium.value.source).toBe('motion');
    }
  });

  it('inverts the pitch when the convention is wrong, which is the trap', () => {
    // Tilted 30° up: the honest pitch is +30. Read in the other browser's
    // convention it is −30 — a number that looks like a pose and points the
    // overlay at the ground.
    const gravity = { x: 0, y: -Math.cos(Math.PI / 6), z: Math.sin(Math.PI / 6) };
    const event = chromiumMotion(gravity, { x: 0, y: 0, z: 0 });
    const right = gravitySampleFromWebMotion(event, 0, 'w3c-specific-force');
    const wrong = gravitySampleFromWebMotion(event, 0, 'coremotion-gravity');
    expect(right.ok && wrong.ok).toBe(true);
    if (!right.ok || !wrong.ok) return;
    const rightPose = orientationFromGravity(right.value.sample);
    const wrongPose = orientationFromGravity(wrong.value.sample);
    expect(rightPose.ok && wrongPose.ok).toBe(true);
    if (!rightPose.ok || !wrongPose.ok) return;
    expect(rightPose.pitchDeg).toBeCloseTo(30, 9);
    expect(wrongPose.pitchDeg).toBeCloseTo(-30, 9);
  });

  it('decides the convention from a simultaneous orientation event', () => {
    for (const beta of [0, 35, 90, -140]) {
      for (const gamma of [0, 40, -70]) {
        const truth = gravityFromOrientation(beta, gamma);
        const orientation = absoluteEvent(123, beta, gamma);
        expect(
          detectMotionGravityConvention(chromiumMotion(truth, { x: 0, y: 0, z: 0 }), orientation),
        ).toBe('w3c-specific-force');
        expect(
          detectMotionGravityConvention(safariMotion(truth, { x: 0, y: 0, z: 0 }), orientation),
        ).toBe('coremotion-gravity');
      }
    }
  });

  it('declines to decide the convention in free fall or a hard shake', () => {
    const orientation = absoluteEvent(0, 0, 0);
    expect(
      detectMotionGravityConvention(
        { accelerationIncludingGravity: { x: 0, y: 0, z: 0 } },
        orientation,
      ),
    ).toBeUndefined();
    // A vector perpendicular to gravity decides nothing about its sign.
    expect(
      detectMotionGravityConvention(
        { accelerationIncludingGravity: { x: 9.8, y: 0, z: 0 } },
        orientation,
      ),
    ).toBeUndefined();
    expect(detectMotionGravityConvention({}, orientation)).toBeUndefined();
  });

  it('calls a sample contaminated when the linear channel is absent or zero', () => {
    const gravity = { x: 0, y: -1, z: 0 };
    const G = STANDARD_GRAVITY_MS2;
    const withoutLinear: WebMotionEventLike = {
      accelerationIncludingGravity: { x: 0, y: -gravity.y * G, z: 0 },
    };
    const absent = gravitySampleFromWebMotion(withoutLinear, 0, 'w3c-specific-force');
    expect(absent.ok && absent.value.contaminated).toBe(true);

    // WebKit's no-gyroscope path publishes literal zeros for `acceleration`
    // and the raw accelerometer for the other channel, so exact zeros mean the
    // vector was never cleaned.
    const zeroLinear = gravitySampleFromWebMotion(
      { acceleration: { x: 0, y: 0, z: 0 }, accelerationIncludingGravity: { x: 0, y: -G, z: 0 } },
      0,
      'coremotion-gravity',
    );
    expect(zeroLinear.ok && zeroLinear.value.contaminated).toBe(true);
    if (!zeroLinear.ok) return;
    expect(zeroLinear.value.sample.y).toBeCloseTo(-1, 12);
  });

  it('refuses a missing channel apart from a channel of nulls', () => {
    expect(gravitySampleFromWebMotion({}, 0, 'w3c-specific-force')).toEqual({
      ok: false,
      refusal: 'no-gravity-channel',
    });
    expect(
      gravitySampleFromWebMotion(
        { accelerationIncludingGravity: null },
        0,
        'w3c-specific-force',
      ),
    ).toEqual({ ok: false, refusal: 'no-gravity-channel' });
    expect(
      gravitySampleFromWebMotion(
        { accelerationIncludingGravity: { x: null, y: null, z: null } },
        0,
        'w3c-specific-force',
      ),
    ).toEqual({ ok: false, refusal: 'not-finite' });
    expect(
      gravitySampleFromWebMotion(
        { accelerationIncludingGravity: { x: Number.NaN, y: 0, z: 0 } },
        0,
        'w3c-specific-force',
      ),
    ).toEqual({ ok: false, refusal: 'not-finite' });
  });

  it('passes the reporting interval through and leaves it out when absent', () => {
    const event = chromiumMotion({ x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 });
    expect(webMotionSample({ ...event, interval: 16 }, 0, 'w3c-specific-force').intervalMs).toBe(16);
    expect(webMotionSample(event, 0, 'w3c-specific-force').intervalMs).toBeUndefined();
  });
});

describe('iOS’s two non-standard fields', () => {
  it('refuses heading 0 with accuracy −1, which is WebKit’s "no compass"', () => {
    expect(webCompassReading(iosEvent(10, 90, 0, 0, -1))).toEqual({
      ok: false,
      refusal: 'compass-uncalibrated',
    });
  });

  it('accepts heading 0 with a real accuracy, because north is a valid answer', () => {
    const reading = webCompassReading(iosEvent(10, 0, 0, 0, 12));
    expect(reading).toEqual({ ok: true, value: { headingDeg: 0, accuracyDeg: 12 } });
  });

  it('refuses a negative heading, which Apple documents as invalid', () => {
    expect(webCompassReading(iosEvent(10, 0, 0, -1, 12))).toEqual({
      ok: false,
      refusal: 'no-compass',
    });
  });

  it('separates a null accuracy from a negative one', () => {
    expect(
      webCompassReading({ alpha: 0, beta: 0, gamma: 0, webkitCompassHeading: 40, webkitCompassAccuracy: null }),
    ).toEqual({ ok: false, refusal: 'no-compass' });
  });

  it('refuses the Chromium route on an iOS event, whose alpha is relative', () => {
    // iOS has no `absolute` attribute at all, so an undefined one is treated as
    // "not absolute" rather than as "probably fine".
    expect(headingSampleFromWebOrientation(iosEvent(12.5, 90, 0, 40, 15), 0)).toEqual({
      ok: false,
      refusal: 'relative-alpha',
    });
    expect(headingSampleFromWebOrientation({ alpha: 10, beta: 90, gamma: 0 }, 0)).toEqual({
      ok: false,
      refusal: 'relative-alpha',
    });
  });

  it('refuses an event with no webkit fields at all, as Chromium sends', () => {
    expect(webCompassReading(absoluteEvent(10, 20, 30))).toEqual({
      ok: false,
      refusal: 'no-compass',
    });
  });
});

describe('recovering an earth-referenced alpha from a CLHeading reading', () => {
  it('round-trips through the top edge bearing for a well-conditioned pose', () => {
    for (const beta of [-170, -90.5, -30, 0, 40, 89, 120, 179]) {
      if (Math.abs(Math.cos((beta * Math.PI) / 180)) < 0.05) continue;
      for (const trueAlpha of [0, 61, 150, 300]) {
        const measured = topEdgeBearing(trueAlpha, beta, 0);
        expect(measured.ok).toBe(true);
        if (!measured.ok) continue;
        const recovered = absoluteAlphaFromTopEdgeBearing(measured.value.headingDeg, beta);
        expect(recovered.ok).toBe(true);
        if (!recovered.ok) continue;
        expect(recovered.value.alphaDeg).toBeCloseTo(trueAlpha, 6);
      }
    }
  });

  it('reports |cos beta| as the conditioning, and refuses at the singularity', () => {
    const tilted = absoluteAlphaFromTopEdgeBearing(40, 60);
    expect(tilted.ok).toBe(true);
    if (tilted.ok) expect(tilted.value.horizontalFraction).toBeCloseTo(0.5, 12);
    expect(absoluteAlphaFromTopEdgeBearing(40, 90)).toEqual({
      ok: false,
      refusal: 'compass-reference-near-vertical',
    });
  });

  it('gives the camera bearing and an inflated accuracy on a tilted iOS phone', () => {
    // Top edge at 40° magnetic, tilted 60° back from flat. At gamma 0 the
    // camera shares the top edge's bearing, and cos 60 = 0.5 doubles the
    // reported 15° accuracy.
    const outcome = rearCameraHeadingUnderHypothesis(
      iosEvent(12.5, 60, 0, 40, 15),
      'device-top-edge',
      500,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.sample.magneticDeg).toBeCloseTo(40, 6);
    expect(outcome.value.sample.accuracyDeg).toBeCloseTo(30, 9);
    expect(outcome.value.route).toBe('compass-top-edge');
    expect(outcome.value.basis).toBe('magnetic');
  });

  it('refuses once the inflated accuracy passes what is worth drawing', () => {
    // The gate is accuracy / |cos beta| > 90, so with accuracy 15 it falls at
    // |cos beta| = 1/6, which is beta = 80.4059°.
    const boundaryDeg = (Math.acos(1 / 6) * 180) / Math.PI;
    expect(boundaryDeg).toBeCloseTo(80.4059, 3);
    expect(rearCameraHeadingUnderHypothesis(iosEvent(0, 80, 0, 40, 15), 'device-top-edge', 0).ok).toBe(
      true,
    );
    expect(rearCameraHeadingUnderHypothesis(iosEvent(0, 81, 0, 40, 15), 'device-top-edge', 0)).toEqual(
      { ok: false, refusal: 'compass-reference-near-vertical' },
    );
    // A tighter platform accuracy moves the gate, which is the point of scaling
    // it rather than fixing a beta limit.
    expect(rearCameraHeadingUnderHypothesis(iosEvent(0, 85, 0, 40, 5), 'device-top-edge', 0).ok).toBe(
      true,
    );
    expect(MAX_USEFUL_ACCURACY_DEG).toBe(90);
  });

  it('takes the reading as the camera bearing under the other hypothesis', () => {
    const outcome = rearCameraHeadingUnderHypothesis(
      iosEvent(12.5, 90, 0, 40, 15),
      'rear-camera-axis',
      500,
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.sample.magneticDeg).toBe(40);
    expect(outcome.value.sample.accuracyDeg).toBe(15);
    expect(outcome.value.route).toBe('compass-camera-axis');
    // The documented hypothesis refuses the same event, which is the
    // disagreement the home recording has to settle.
    expect(
      rearCameraHeadingUnderHypothesis(iosEvent(12.5, 90, 0, 40, 15), 'device-top-edge', 500),
    ).toEqual({ ok: false, refusal: 'compass-reference-near-vertical' });
  });

  it('still refuses under the camera-axis hypothesis when the camera is vertical', () => {
    expect(
      rearCameraHeadingUnderHypothesis(iosEvent(12.5, 0, 0, 40, 15), 'rear-camera-axis', 0),
    ).toEqual({ ok: false, refusal: 'camera-near-vertical' });
  });
});

describe('the stored-offset route, which works where the compass does not', () => {
  it('answers exactly at the upright pose the compass route refuses', () => {
    // Relative alpha 12.5 with an offset of 257.5 is an earth-referenced alpha
    // of 270, the pose that points the camera east.
    const event = iosEvent(12.5, 90, 0, 40, 15);
    const outcome = rearCameraHeadingFromRelativeAlpha(event, 257.5, 900, 8);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.value.sample.magneticDeg).toBeCloseTo(90, 9);
    expect(outcome.value.sample.accuracyDeg).toBe(8);
    expect(outcome.value.route).toBe('absolute-alpha');
  });

  it('refuses a non-finite offset rather than producing a bearing from it', () => {
    expect(
      rearCameraHeadingFromRelativeAlpha(iosEvent(0, 90, 0, 40, 15), Number.NaN, 0),
    ).toEqual({ ok: false, refusal: 'relative-alpha' });
  });

  it('moves the bearing one for one with the offset', () => {
    const event = iosEvent(0, 90, 0, 40, 15);
    for (const offset of [0, 17, 90, 250]) {
      const outcome = rearCameraHeadingFromRelativeAlpha(event, offset, 0);
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) continue;
      expect(outcome.value.sample.magneticDeg).toBeCloseTo(normalise(-offset), 6);
      expect(outcome.value.sample.accuracyDeg).toBeUndefined();
    }
  });
});

describe('the screen angle, which is carried and not applied', () => {
  it('accepts the four quarter turns and normalises a negative one', () => {
    expect(normaliseScreenAngle(0)).toBe(0);
    expect(normaliseScreenAngle(90)).toBe(90);
    expect(normaliseScreenAngle(180)).toBe(180);
    expect(normaliseScreenAngle(270)).toBe(270);
    expect(normaliseScreenAngle(-90)).toBe(270);
  });

  it('rejects anything else', () => {
    for (const angle of [45, 1, 89.9, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normaliseScreenAngle(angle)).toBeUndefined();
    }
  });

  it('leaves gravity and heading untouched across all four rotations', () => {
    // The orientation specification fixes the device frame to the device: "If
    // the orientation of the screen changes when the device is rotated … this
    // does not affect the orientation of the coordinate frame relative to the
    // device."
    const event = absoluteEvent(270, 90, 0);
    const reference = webOrientationSample(event, 0, 0);
    for (const angle of [90, 180, 270]) {
      const rotated = webOrientationSample(event, angle, 0);
      expect(rotated.gravity).toEqual(reference.gravity);
      expect(rotated.heading).toEqual(reference.heading);
      expect(rotated.screenAngle).toEqual({ ok: true, value: angle });
    }
  });

  it('refuses a screen angle it does not recognise without losing the pose', () => {
    const sample = webOrientationSample(absoluteEvent(270, 90, 0), 45, 0);
    expect(sample.screenAngle).toEqual({ ok: false, refusal: 'bad-screen-angle' });
    expect(sample.gravity.ok).toBe(true);
    expect(sample.heading.ok).toBe(true);
  });
});

describe('the one call the loop makes', () => {
  it('refuses a relative alpha with no compass and no offset', () => {
    const sample = webOrientationSample({ alpha: 100, beta: 90, gamma: 0 }, 0, 0);
    expect(sample.heading).toEqual({ ok: false, refusal: 'no-compass' });
    expect(sample.gravity.ok).toBe(true);
  });

  it('prefers a stored offset over the compass when one is supplied', () => {
    const sample = webOrientationSample(iosEvent(12.5, 90, 0, 40, 15), 0, 0, {
      alphaOffsetDeg: 257.5,
    });
    expect(sample.heading.ok).toBe(true);
    if (!sample.heading.ok) return;
    expect(sample.heading.value.sample.magneticDeg).toBeCloseTo(90, 9);
  });

  it('keeps pitch and roll when the heading refuses', () => {
    const sample = webOrientationSample({ alpha: null, beta: 90, gamma: 15 }, 0, 0);
    expect(sample.heading.ok).toBe(false);
    expect(sample.gravity.ok).toBe(true);
    if (!sample.gravity.ok) return;
    const pose = orientationFromGravity(sample.gravity.value.sample);
    expect(pose.ok).toBe(true);
  });
});

describe('replaying a recording', () => {
  interface FixtureFile {
    readonly events: readonly (RecordedWebSensorEvent & { readonly comment?: string })[];
  }

  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as FixtureFile;

  it('holds no geolocation and no wall-clock time', () => {
    const text = readFileSync(FIXTURE, 'utf8');
    expect(text).not.toMatch(/latitude|longitude|coords|geolocation/i);
    // Every timestamp is a small number of milliseconds from the start, so no
    // epoch stamp can hide in the file.
    for (const event of fixture.events) {
      expect(event.tMs).toBeLessThan(60_000);
      expect(event.tMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('yields the gravity trace from orientation events alone by default', () => {
    const replay = replayWebSensorEvents(fixture.events);
    // Six of the nine events are orientation events, and five carry angles.
    expect(replay.gravity).toHaveLength(5);
    expect(replay.screenAngles).toEqual([0, 90]);
    expect(replay.refusals['no-orientation']).toBe(2);
    expect(replay.refusals['camera-near-vertical']).toBe(2);
    expect(replay.refusals['compass-uncalibrated']).toBe(1);
    // Motion events contribute nothing without a stated convention, so their
    // sign cannot leak in.
    expect(replay.refusals['not-finite']).toBeUndefined();
  });

  it('recovers the two headings the recording can support', () => {
    const replay = replayWebSensorEvents(fixture.events);
    expect(replay.heading).toHaveLength(2);
    const [east, tilted] = replay.heading;
    expect(east?.timestampMs).toBe(200);
    expect(east?.magneticDeg).toBeCloseTo(90, 9);
    expect(east?.accuracyDeg).toBeUndefined();
    expect(tilted?.timestampMs).toBe(400);
    expect(tilted?.magneticDeg).toBeCloseTo(40, 6);
    expect(tilted?.accuracyDeg).toBeCloseTo(30, 9);
    expect(replay.heading.every((sample) => sample.trueDeg === undefined)).toBe(true);
  });

  it('adds the motion events’ gravity when a convention is stated', () => {
    const chromium = replayWebSensorEvents(fixture.events, {
      motionConvention: 'w3c-specific-force',
    });
    expect(chromium.gravity).toHaveLength(7);
    expect(chromium.refusals['not-finite']).toBe(1);
    const fromMotion = chromium.gravity.find((sample) => sample.timestampMs === 100);
    // The face-up Chromium payload, read in Chromium's own convention.
    expect(fromMotion?.z).toBeCloseTo(-1, 9);

    const safari = replayWebSensorEvents(fixture.events, {
      motionConvention: 'coremotion-gravity',
    });
    const uprightMotion = safari.gravity.find((sample) => sample.timestampMs === 450);
    // The upright Safari payload, read in Safari's own convention.
    expect(uprightMotion?.y).toBeCloseTo(-1, 9);
  });

  it('feeds fuseSensorPose a pose at the upright instant', () => {
    const replay = replayWebSensorEvents(fixture.events);
    const pose = fuseSensorPose(replay, 200, { maxAgeMs: 100, declinationDeg: 12.6 });
    expect(pose.heading.ok).toBe(true);
    if (pose.heading.ok) {
      // 90° magnetic plus the Bogus Basin declination, applied explicitly.
      expect(pose.heading.field.valueDeg).toBeCloseTo(102.6, 6);
    }
    expect(pose.pitch.ok).toBe(true);
    if (pose.pitch.ok) expect(pose.pitch.field.valueDeg).toBeCloseTo(0, 6);
    expect(pose.roll.ok).toBe(true);
    if (pose.roll.ok) expect(pose.roll.field.valueDeg).toBeCloseTo(0, 6);
  });

  it('refuses a true heading from a magnetic-only trace, as the rule requires', () => {
    const replay = replayWebSensorEvents(fixture.events);
    const pose = fuseSensorPose(replay, 200, { maxAgeMs: 100 });
    expect(pose.heading).toEqual({ ok: false, refusal: 'needs-declination' });
  });
});
