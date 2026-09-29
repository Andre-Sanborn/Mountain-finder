/**
 * The recording schema, its parser, and the analyzer that scores it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE EXPECTATIONS COME FROM
 * ═══════════════════════════════════════════════════════════════════════════
 * Four references, none of them this code's own output:
 *
 *   1. The W3C Device Orientation and Motion specification's § A.2 matrix,
 *      reduced by hand. `recording.ts`'s Section 9 carries the three closed
 *      forms; the analyzer reads the same quantities through the adapter's
 *      transcription of the full matrix. The first tests below assert the two
 *      derivations agree, which is what stops a transposed matrix cancelling
 *      itself out between the thing under test and the thing testing it.
 *   2. `calibration.ts`'s four holds, whose gravity vectors were derived from
 *      `sensors.ts`'s frame convention before any of this existed.
 *   3. `fixtures/sensors/web/synthetic-events.json`, hand-built for the adapter.
 *      Its comment states that an upright portrait phone with its rear camera on
 *      magnetic east has alpha 270, beta 90, gamma 0. That is a number this
 *      module did not choose.
 *   4. Angles worked out by hand for each pose, written in the test that uses
 *      them: the landscape holds separate the hypotheses by exactly ±90°, and
 *      the tip past vertical by exactly 180°.
 *
 * A synthesised recording's right answer is therefore known before the analyzer
 * runs, which is the only arrangement in which "the analyzer named the right
 * hypothesis" means anything.
 */

import { describe, expect, it } from 'vitest';

import { CALIBRATION_HOLDS } from './calibration.js';
import {
  alphaForCameraAzimuth,
  analyseRecording,
  cameraAltitudeDeg,
  dragModeScatter,
  estimatePitchBias,
  expectedGravity,
  expectedTopEdgeMinusCameraDeg,
  fold360,
  meanAndSampleSd,
  MOTION_HEADING_FAULT_DEG,
  parseRecording,
  protocolSegments,
  PROTOCOL_SUN_ALTITUDE_DEG,
  signedDeltaDeg,
  synthesiseRecording,
  topEdgeMinusCameraDeg,
  type HomeSessionRecording,
  type PoseLabel,
  type SynthSegmentSpec,
  type SynthSpec,
  type Verdict,
} from './recording.js';
import { gravityFromOrientation } from './web-sensors.js';

/* ══════════════════════════════════════════════════════════════════════════
 * Shared helpers
 * ══════════════════════════════════════════════════════════════════════════ */

const KNOWN_BEARING_DEG = 137.5;

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';

function spec(overrides: Partial<SynthSpec> = {}): SynthSpec {
  return {
    hypothesis: 'device-top-edge',
    knownBearingDeg: KNOWN_BEARING_DEG,
    device: IOS_UA,
    segments: protocolSegments(),
    attitudeNoiseDeg: 0.3,
    compassNoiseDeg: 1.5,
    compassAccuracyDeg: 8,
    motionConvention: 'coremotion-gravity',
    seed: 11,
    ...overrides,
  };
}

/** A recording carrying only the poses named. */
function onlyPoses(poses: readonly PoseLabel[], overrides: Partial<SynthSpec> = {}): HomeSessionRecording {
  const wanted = new Set(poses);
  const segments: readonly SynthSegmentSpec[] = protocolSegments().filter((s) => wanted.has(s.pose));
  return synthesiseRecording(spec({ segments, ...overrides }));
}

/**
 * The same, with the portrait aim put back on the horizon — the blind spot.
 *
 * The protocol aims every step at a Sun {@link PROTOCOL_SUN_ALTITUDE_DEG} up,
 * which tips the portrait hold past vertical and separates the hypotheses by
 * 180°. A phone aimed at something on the horizon instead sits short of
 * vertical, where the top edge and the camera share an azimuth and neither
 * hypothesis can be told from the other. That is the case these tests are
 * about, so they build it rather than inherit it.
 */
function horizonAimedPortrait(
  poses: readonly PoseLabel[],
  overrides: Partial<SynthSpec> = {},
): HomeSessionRecording {
  const wanted = new Set(poses);
  const segments = protocolSegments()
    .filter((s) => wanted.has(s.pose))
    .map((s) =>
      s.pose === 'portrait-upright-known-bearing' ? { ...s, from: { betaDeg: 85, gammaDeg: 0 } } : s,
    );
  return synthesiseRecording(spec({ segments, ...overrides }));
}

function verdictFor(recording: HomeSessionRecording, id: string): Verdict {
  const found = analyseRecording(recording).verdicts.find((v) => v.id === id);
  if (!found) throw new Error(`no verdict with id ${id}`);
  return found;
}

/** A grid of attitudes that keeps clear of both gimbals. */
function attitudeGrid(): readonly { beta: number; gamma: number }[] {
  const out: { beta: number; gamma: number }[] = [];
  for (let beta = -170; beta <= 170; beta += 17) {
    for (let gamma = -80; gamma <= 80; gamma += 13) {
      out.push({ beta, gamma });
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The two derivations of the same geometry
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the forward model and the adapter derive the same geometry', () => {
  it('agrees with the adapter on the top-edge-minus-camera offset at every attitude', () => {
    let compared = 0;
    for (const { beta, gamma } of attitudeGrid()) {
      const throughMatrix = topEdgeMinusCameraDeg(beta, gamma);
      // The adapter refuses within a degree of either axis being vertical; the
      // closed form has no such guard, so only the poses it answers are compared.
      if (throughMatrix === undefined) continue;
      compared += 1;
      expect(Math.abs(signedDeltaDeg(throughMatrix, expectedTopEdgeMinusCameraDeg(beta, gamma)))).toBeLessThan(1e-6);
    }
    expect(compared).toBeGreaterThan(100);
  });

  it('agrees with the adapter on gravity at every attitude', () => {
    for (const { beta, gamma } of attitudeGrid()) {
      const adapter = gravityFromOrientation(beta, gamma);
      const closedForm = expectedGravity(beta, gamma);
      expect(closedForm.x).toBeCloseTo(adapter.x, 12);
      expect(closedForm.y).toBeCloseTo(adapter.y, 12);
      expect(closedForm.z).toBeCloseTo(adapter.z, 12);
    }
  });

  it('reproduces the four calibration holds gravity vectors', () => {
    // Attitudes for the four holds, read off the frame convention: upright
    // portrait is a pitch of a quarter turn, face down is a half turn, and right
    // edge down is a quarter turn of roll.
    const attitudes: Readonly<Record<string, { beta: number; gamma: number }>> = {
      'flat-face-up': { beta: 0, gamma: 0 },
      'upright-portrait': { beta: 90, gamma: 0 },
      'flat-face-down': { beta: 180, gamma: 0 },
      'right-edge-down': { beta: 0, gamma: 90 },
    };
    for (const hold of CALIBRATION_HOLDS) {
      const attitude = attitudes[hold.hold];
      expect(attitude).toBeDefined();
      if (!attitude) continue;
      const g = expectedGravity(attitude.beta, attitude.gamma);
      expect(g.x).toBeCloseTo(hold.expected.x, 12);
      expect(g.y).toBeCloseTo(hold.expected.y, 12);
      expect(g.z).toBeCloseTo(hold.expected.z, 12);
    }
  });

  it('puts an upright portrait phone with its camera on magnetic east at alpha 270', () => {
    // fixtures/sensors/web/synthetic-events.json states this pose and this
    // alpha, hand-built for the adapter before this module existed.
    expect(alphaForCameraAzimuth(90, 0, 90)).toBeCloseTo(270, 9);
  });

  it('separates the hypotheses by exactly the angles each pose was chosen for', () => {
    // Landscape upright with the portrait top edge to the right of the target:
    // the camera faces west at alpha 0, the top edge faces north, so the top
    // edge leads the camera by a quarter turn.
    expect(expectedTopEdgeMinusCameraDeg(0, 90)).toBeCloseTo(90, 9);
    // The other landscape direction is the mirror of it.
    expect(expectedTopEdgeMinusCameraDeg(0, -90)).toBeCloseTo(-90, 9);
    // Portrait, short of vertical: the two axes share an azimuth, which is the
    // blind spot the landscape holds exist to cover.
    expect(expectedTopEdgeMinusCameraDeg(85, 0)).toBeCloseTo(0, 9);
    // Past vertical the top edge has tipped over and points backwards.
    expect(Math.abs(expectedTopEdgeMinusCameraDeg(95, 0))).toBeCloseTo(180, 9);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The protocol's aim at the Sun
 * ══════════════════════════════════════════════════════════════════════════
 * Four steps of the script say "keep the sun in the middle", and the Sun is
 * 15° to 50° up when the session can be run at all. The attitudes they are
 * synthesised at have to put the camera there, because `estimatePitchBias`
 * reads the gap between a sensed camera altitude and the Sun's as a tilt-sensor
 * fault: a step aimed at the horizon while the Sun is 30° up reports 30° of
 * bias, which is twice the largest figure the estimator will call credible.
 *
 * Two closed forms, both from `asin(−cos β · cos γ)`:
 *   portrait,  γ = 0:    altitude = β − 90
 *   landscape, β = 180:  altitude = 90 − |γ|
 */

describe("the protocol's aim at the Sun", () => {
  /** The steps whose instruction is to keep the Sun in the middle. */
  const SUN_AIMED: readonly PoseLabel[] = [
    'portrait-upright-known-bearing',
    'landscape-upright-known-bearing-top-right',
    'landscape-upright-known-bearing-top-left',
    'landscape-walking-known-bearing',
  ];

  it('aims at an altitude the field and home guides ask the session to be run at', () => {
    expect(PROTOCOL_SUN_ALTITUDE_DEG).toBeGreaterThanOrEqual(15);
    expect(PROTOCOL_SUN_ALTITUDE_DEG).toBeLessThanOrEqual(50);
  });

  it('centres every sun-aimed hold on that altitude', () => {
    const aimed = protocolSegments().filter((segment) => SUN_AIMED.includes(segment.pose));
    expect(aimed.map((segment) => segment.pose)).toEqual(SUN_AIMED);
    for (const segment of aimed) {
      const to = segment.to ?? segment.from;
      const start = cameraAltitudeDeg(segment.from.betaDeg, segment.from.gammaDeg);
      const end = cameraAltitudeDeg(to.betaDeg, to.gammaDeg);
      // The hold sweeps evenly, so its midpoint is the aim and its median is
      // the same number.
      expect((start + end) / 2).toBeCloseTo(PROTOCOL_SUN_ALTITUDE_DEG, 9);
      expect(Math.abs(end - start)).toBeLessThanOrEqual(3);
    }
  });

  it('states every attitude in angles a browser can report', () => {
    for (const segment of protocolSegments()) {
      for (const attitude of [segment.from, segment.to ?? segment.from]) {
        expect(Math.abs(attitude.gammaDeg)).toBeLessThanOrEqual(90);
        expect(Math.abs(attitude.betaDeg)).toBeLessThanOrEqual(180);
      }
    }
  });

  it('keeps the quarter turn in landscape and tips the portrait aim past vertical', () => {
    // β = 180, γ = a − 90: the top edge is horizontal and points backwards, so
    // its azimuth is 180°, while the camera's is atan2(sin(90 − a), 0) = 90°.
    expect(expectedTopEdgeMinusCameraDeg(180, PROTOCOL_SUN_ALTITUDE_DEG - 90)).toBeCloseTo(90, 9);
    expect(expectedTopEdgeMinusCameraDeg(180, 90 - PROTOCOL_SUN_ALTITUDE_DEG)).toBeCloseTo(-90, 9);
    // Portrait at β = 90 + a is past vertical, so the two axes are opposed
    // rather than aligned: this hold is no longer the blind spot.
    expect(Math.abs(expectedTopEdgeMinusCameraDeg(90 + PROTOCOL_SUN_ALTITUDE_DEG, 0))).toBeCloseTo(180, 9);
  });

  it('leaves an honest phone with no tilt bias to report', () => {
    const recording = withSunBearing(
      synthesiseRecording(spec({ attitudeNoiseDeg: 0, compassNoiseDeg: 0 })),
    );
    const estimate = estimatePitchBias(recording);
    expect(estimate?.perSegment.map((segment) => segment.pose)).toEqual([
      'portrait-upright-known-bearing',
      'landscape-upright-known-bearing-top-right',
      'landscape-upright-known-bearing-top-left',
    ]);
    // Every sensed altitude is the aim, and every aim is the Sun's altitude.
    expect(estimate?.biasDeg).toBeCloseTo(0, 9);
    expect(estimate?.spreadDeg).toBeCloseTo(0, 9);
    expect(estimate?.credible).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The compass reference verdict
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the compass reference hypothesis', () => {
  const injected = {
    alphaDriftDegPerMinute: 2.4,
    alphaBiasDeg: 213,
    // Inside the still-drift hold, which starts at 68 s of the synthetic
    // protocol. A re-base during a discriminating pose would be a different
    // test: it would move the reading mid-segment.
    alphaRebase: { atMs: 80_000, byDeg: 77 },
  } as const;

  it('names device-top-edge for a phone that obeys it', () => {
    const analysis = analyseRecording(synthesiseRecording(spec({ hypothesis: 'device-top-edge', ...injected })));
    expect(analysis.compassReference.verdict).toBe('device-top-edge');
    expect(analysis.compassReference.confidence).toBe('high');
  });

  it('names rear-camera-axis for a phone that obeys it', () => {
    const analysis = analyseRecording(synthesiseRecording(spec({ hypothesis: 'rear-camera-axis', ...injected })));
    expect(analysis.compassReference.verdict).toBe('rear-camera-axis');
    expect(analysis.compassReference.confidence).toBe('high');
  });

  for (const direction of ['top-left', 'top-right'] as const) {
    const pose: PoseLabel = `landscape-upright-known-bearing-${direction}`;
    for (const hypothesis of ['device-top-edge', 'rear-camera-axis'] as const) {
      it(`decides ${hypothesis} from the ${direction} landscape hold alone`, () => {
        const analysis = analyseRecording(onlyPoses([pose], { hypothesis, ...injected }));
        expect(analysis.compassReference.verdict).toBe(hypothesis);
        const score = analysis.compassReference.perSegment.find((s) => s.pose === pose);
        expect(score?.separationDeg).toBeCloseTo(90, 0);
      });
    }
  }

  it('is inconclusive on a portrait recording with no roll — the blind spot', () => {
    const recording = horizonAimedPortrait(
      ['flat-face-up', 'upright-portrait', 'flat-face-down', 'right-edge-down', 'portrait-upright-known-bearing', 'still-drift'],
      injected,
    );
    const analysis = analyseRecording(recording);
    expect(analysis.compassReference.verdict).toBe('inconclusive');
    expect(analysis.compassReference.confidence).toBe('none');
    const score = analysis.compassReference.perSegment.find((s) => s.pose === 'portrait-upright-known-bearing');
    expect(score?.verdict).toBe('inconclusive');
    // The hypotheses agree to within the compass noise at this pose, which is
    // the reason the recording cannot separate them.
    expect(score?.separationDeg ?? 99).toBeLessThan(2);
    // The other verdicts still land: a blind spot in one question is not a
    // failed recording.
    expect(verdictFor(recording, 'calibration-holds').answer).toBe('matches-convention');
  });

  it('reports the sign of the landscape offset in both directions under device-top-edge', () => {
    const answer = verdictFor(synthesiseRecording(spec({ hypothesis: 'device-top-edge' })), 'landscape-sign');
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer).toContain('+90');
    expect(answer.answer).toContain('−90');
  });

  it('claims no landscape offset when the reading follows the camera', () => {
    const answer = verdictFor(synthesiseRecording(spec({ hypothesis: 'rear-camera-axis' })), 'landscape-sign');
    expect(answer.inconclusive).toBe(true);
  });

  it('refuses to conclude when the poses disagree', () => {
    // One landscape hold obeying each hypothesis is a physically impossible
    // phone, so the right answer is to refuse rather than take a majority.
    const left = onlyPoses(['landscape-upright-known-bearing-top-left'], { hypothesis: 'device-top-edge' });
    const right = onlyPoses(['landscape-upright-known-bearing-top-right'], { hypothesis: 'rear-camera-axis' });
    const mixed: HomeSessionRecording = {
      ...left,
      segments: [...left.segments, ...right.segments.map((s) => ({ ...s, startMs: s.startMs + 100_000, endMs: s.endMs + 100_000, events: s.events.map((e) => ({ ...e, tMs: e.tMs + 100_000 })) }))],
    };
    const analysis = analyseRecording(mixed);
    expect(analysis.compassReference.verdict).toBe('inconclusive');
    expect(analysis.compassReference.detail).toContain('disagree');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Mutation check on the discriminator
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the discriminator is sensitive to the sign of the offset', () => {
  /**
   * Rewrite every compass reading as `bearing − offset` in place of
   * `bearing + offset`.
   *
   * This is the one sign error that would make the analyzer answer confidently
   * and wrongly, so it is mutated in the data rather than argued about. The
   * rewrite uses the closed form only, so it does not inherit the adapter's
   * reading of the matrix.
   */
  function negateOffset(recording: HomeSessionRecording): HomeSessionRecording {
    return {
      ...recording,
      segments: recording.segments.map((segment) => ({
        ...segment,
        events: segment.events.map((event) => {
          if (event.kind !== 'orientation') return event;
          const { beta, gamma } = event.event;
          if (beta === null || gamma === null) return event;
          const offset = expectedTopEdgeMinusCameraDeg(beta, gamma);
          return {
            ...event,
            event: { ...event.event, webkitCompassHeading: fold360(KNOWN_BEARING_DEG - offset) },
          };
        }),
      })),
    };
  }

  it('does not report device-top-edge once the offset is applied the other way', () => {
    const clean = synthesiseRecording(spec({ hypothesis: 'device-top-edge', compassNoiseDeg: 0, attitudeNoiseDeg: 0 }));
    expect(analyseRecording(clean).compassReference.verdict).toBe('device-top-edge');
    expect(analyseRecording(negateOffset(clean)).compassReference.verdict).not.toBe('device-top-edge');
  });

  it('refuses the mutant outright rather than naming the other hypothesis', () => {
    const mutant = negateOffset(
      synthesiseRecording(spec({ hypothesis: 'device-top-edge', compassNoiseDeg: 0, attitudeNoiseDeg: 0 })),
    );
    const analysis = analyseRecording(mutant);
    expect(analysis.compassReference.verdict).toBe('inconclusive');
    // The landscape holds are where a sign error shows: a reading a quarter turn
    // the wrong way fits neither hypothesis.
    const landscape = analysis.compassReference.perSegment.filter((s) => s.pose.startsWith('landscape-'));
    expect(landscape).toHaveLength(2);
    for (const score of landscape) {
      expect(score.verdict).toBe('inconclusive');
      expect(Math.min(score.topEdgeResidualDeg, score.cameraAxisResidualDeg)).toBeGreaterThan(12);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The remaining questions
 * ══════════════════════════════════════════════════════════════════════════ */

describe('alpha drift', () => {
  it('recovers the injected still drift across an injected re-base', () => {
    const recording = synthesiseRecording(
      spec({ alphaDriftDegPerMinute: 2.4, alphaBiasDeg: 213, alphaRebase: { atMs: 120_000, byDeg: 77 } }),
    );
    const answer = verdictFor(recording, 'alpha-drift-still');
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer).toContain('re-base');
    // The sign is asserted apart from the magnitude: a drift reported the wrong
    // way round would send a correction the wrong way round too.
    expect(answer.answer.startsWith('+')).toBe(true);
    expect(Number(/(\d+\.\d+) °\/min/.exec(answer.answer)?.[1] ?? NaN)).toBeCloseTo(2.4, 1);
  });

  it('recovers a drift of the opposite sign', () => {
    const recording = synthesiseRecording(spec({ alphaDriftDegPerMinute: -1.8, alphaBiasDeg: 40 }));
    const answer = verdictFor(recording, 'alpha-drift-still');
    expect(answer.answer.startsWith('−')).toBe(true);
    expect(Number(/(\d+\.\d+) °\/min/.exec(answer.answer)?.[1] ?? NaN)).toBeCloseTo(1.8, 1);
  });

  it('reports no drift as no drift', () => {
    const answer = verdictFor(synthesiseRecording(spec({ alphaDriftDegPerMinute: 0 })), 'alpha-drift-still');
    expect(Number(/(\d+\.\d+) °\/min/.exec(answer.answer)?.[1] ?? NaN)).toBeLessThan(0.2);
  });

  it('measures the handling minute against the compass, and says the figure is an upper bound', () => {
    const recording = synthesiseRecording(spec({ alphaDriftDegPerMinute: 3, alphaBiasDeg: 10 }));
    const answer = verdictFor(recording, 'alpha-drift-handling');
    expect(answer.inconclusive).toBe(false);
    expect(answer.evidence.join(' ')).toContain('compass-referenced-bias');
    expect(answer.evidence.join(' ')).toContain('upper bound');
    expect(answer.answer.startsWith('+')).toBe(true);
    expect(Number(/(\d+\.\d+) °\/min/.exec(answer.answer)?.[1] ?? NaN)).toBeCloseTo(3, 0);
  });

  it('will not measure handling drift while the compass reference is unsettled', () => {
    const recording = horizonAimedPortrait(['portrait-upright-known-bearing', 'handling'], {
      alphaDriftDegPerMinute: 3,
    });
    expect(analyseRecording(recording).compassReference.verdict).toBe('inconclusive');
    expect(verdictFor(recording, 'alpha-drift-handling').inconclusive).toBe(true);
  });
});

describe('the platform questions', () => {
  it('reports a fixed compass accuracy as not growing with tilt', () => {
    const answer = verdictFor(synthesiseRecording(spec()), 'accuracy-growth');
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer.startsWith('no')).toBe(true);
  });

  it('reports an accuracy inflated by 1/|cos beta| as growing with tilt', () => {
    const answer = verdictFor(synthesiseRecording(spec({ accuracyGrowsWithTilt: true })), 'accuracy-growth');
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer.startsWith('yes')).toBe(true);
    expect(answer.answer).toContain('double-count');
  });

  it("says 'absolute' is absent when no event carries it", () => {
    const answer = verdictFor(synthesiseRecording(spec({ omitAbsolute: true })), 'absolute-presence');
    expect(answer.answer.startsWith('absent')).toBe(true);
    expect(answer.confidence).toBe('high');
  });

  it("says 'absolute' is present and true when every event carries it", () => {
    const answer = verdictFor(synthesiseRecording(spec({ omitAbsolute: false })), 'absolute-presence');
    expect(answer.answer).toContain('present and true');
  });

  for (const convention of ['w3c-specific-force', 'coremotion-gravity'] as const) {
    it(`detects the ${convention} gravity sign`, () => {
      const answer = verdictFor(synthesiseRecording(spec({ motionConvention: convention })), 'motion-gravity-sign');
      expect(answer.answer.startsWith(convention)).toBe(true);
      expect(answer.confidence).toBe('high');
    });
  }

  it('flags a phone whose linear acceleration is always exactly zero', () => {
    const answer = verdictFor(synthesiseRecording(spec({ noGyroscope: true })), 'zero-acceleration');
    expect(answer.answer.startsWith('yes')).toBe(true);
    expect(answer.evidence.join(' ')).toContain('rotationRate absent or null');
  });

  it('reports a usable linear acceleration when the phone has a gyroscope', () => {
    const answer = verdictFor(synthesiseRecording(spec()), 'zero-acceleration');
    expect(answer.answer.startsWith('no')).toBe(true);
  });

  it('returns matches-convention for the four holds', () => {
    const answer = verdictFor(synthesiseRecording(spec()), 'calibration-holds');
    expect(answer.answer).toBe('matches-convention');
    expect(answer.confidence).toBe('high');
  });

  it('cannot judge the convention from two flat holds alone', () => {
    const answer = verdictFor(onlyPoses(['flat-face-up', 'flat-face-down']), 'calibration-holds');
    expect(answer.inconclusive).toBe(true);
  });

  it('measures the event rate and says what the stream cannot answer', () => {
    const answer = verdictFor(synthesiseRecording(spec()), 'event-rate');
    expect(answer.inconclusive).toBe(false);
    expect(answer.evidence.join('\n')).toContain('orientation: ');
    expect(answer.evidence.join('\n')).toContain('10.0 Hz');
    expect(answer.evidence.join(' ')).toContain('airplane mode');
  });

  it('finds the device frame fixed to the device when the roll follows the rotation', () => {
    const answer = verdictFor(synthesiseRecording(spec()), 'screen-frame');
    expect(answer.answer).toContain('only the screen');
  });

  it('finds the device frame re-based when the roll does not move', () => {
    // A phone whose beta and gamma are re-based to the rotated layout reports
    // the same attitude before and after, while the screen angle still turns.
    const segments = protocolSegments().map((s) =>
      s.pose === 'rotate-to-landscape' ? { ...s, to: s.from, screenAngleDeg: 0, screenAngleToDeg: 90 } : s,
    );
    const answer = verdictFor(synthesiseRecording(spec({ segments })), 'screen-frame');
    expect(answer.answer).toContain('followed the screen');
  });

  for (const [label, screenAngleToDeg, expected] of [
    ['the same way', 90, 'the same way'],
    ['the opposite way', 270, 'the opposite way'],
  ] as const) {
    it(`reads the device-roll to screen-angle mapping as ${label}`, () => {
      const segments = protocolSegments().map((s) =>
        s.pose === 'rotate-to-landscape' ? { ...s, screenAngleDeg: 0, screenAngleToDeg } : s,
      );
      const answer = verdictFor(synthesiseRecording(spec({ segments })), 'screen-roll-sign');
      expect(answer.answer.startsWith(expected)).toBe(true);
    });
  }

  it('names the poses the protocol asks for and the recording lacks', () => {
    const analysis = analyseRecording(onlyPoses(['flat-face-up']));
    expect(analysis.missingPoses).toContain('sun-capture');
    expect(analysis.missingPoses).not.toContain('flat-face-up');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The strict parser
 * ══════════════════════════════════════════════════════════════════════════ */

/** A round trip through JSON, which is how a recording actually arrives. */
function throughJson(recording: HomeSessionRecording): unknown {
  return JSON.parse(JSON.stringify(recording));
}

function problemsOf(document: unknown): readonly string[] {
  const result = parseRecording(document);
  if (result.ok) return [];
  return result.problems.map((p) => `${p.path}: ${p.message}`);
}

describe('the strict parser', () => {
  const sound = synthesiseRecording(spec());

  it('accepts a synthesised recording unchanged', () => {
    const result = parseRecording(throughJson(sound));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments).toHaveLength(sound.segments.length);
    expect(result.value.device).toBe(IOS_UA);
  });

  it('rejects a geolocation reading wherever it hides', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    expect(first).toBeDefined();
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const event = events[0];
    expect(event).toBeDefined();
    if (!event) return;
    event.coords = { latitude: 1, longitude: 2 };
    const problems = problemsOf(document);
    expect(problems.join('\n')).toContain('forbidden key');
    expect(problems.some((p) => p.includes('coords'))).toBe(true);
  });

  it('rejects a coordinate key even under a name the schema would ignore', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.knownBearing = { ...(document.knownBearing as object), latitude: 1 };
    expect(problemsOf(document).join('\n')).toContain('a coordinate');
  });

  it('rejects an absolute epoch timestamp', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const event = events[0];
    if (!event) return;
    event.tMs = 1793500000000;
    const problems = problemsOf(document).join('\n');
    expect(problems).toContain('absolute epoch timestamp');
  });

  it('rejects a wall-clock string', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.note = 'recorded on 2026-09-29 at the kitchen window';
    expect(problemsOf(document).join('\n')).toContain('ISO 8601 date');
  });

  it('rejects a key named after a wall-clock instant', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.startedAt = 1;
    expect(problemsOf(document).join('\n')).toContain('a wall-clock instant');
  });

  it('rejects any unknown key', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.hunch = 'it is probably the camera axis';
    expect(problemsOf(document).join('\n')).toContain('unknown key');
  });

  it('rejects a camera identifier in a track settings snapshot', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    first.trackSettings = [{ tMs: 0, width: 1920, height: 1080, deviceId: 'abc' }];
    expect(problemsOf(document).join('\n')).toContain('an identifier for one handset');
  });

  it('accepts a track settings snapshot of geometry alone', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    first.trackSettings = [{ tMs: 0, width: 1920, height: 1080, frameRate: 30, facingMode: 'environment' }];
    expect(parseRecording(document).ok).toBe(true);
  });

  it('rejects a wrong format tag', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.format = 'something-else@1';
    expect(problemsOf(document).join('\n')).toContain('expected exactly');
  });

  it('rejects a timestamp basis that is not relative', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.timestampBasis = 'epoch-milliseconds';
    expect(problemsOf(document).join('\n')).toContain('timestampBasis');
  });

  it('rejects events that go backwards in time', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const third = events[2];
    if (!third) return;
    third.tMs = 0;
    const events0 = events[0] as Record<string, unknown>;
    events0.tMs = 50;
    expect(problemsOf(document).join('\n')).toContain('goes backwards');
  });

  it('rejects an event outside its own segment', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    first.endMs = 10;
    expect(problemsOf(document).join('\n')).toContain('outside the segment');
  });

  it('rejects overlapping segments', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const second = segments[1];
    if (!second) return;
    second.startMs = 0;
    expect(problemsOf(document).join('\n')).toContain('overlaps the previous segment');
  });

  it('rejects a beta outside the range a browser reports', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const event = events[0] as Record<string, unknown>;
    (event.event as Record<string, unknown>).beta = 400;
    expect(problemsOf(document).join('\n')).toContain('above the allowed maximum');
  });

  it('rejects a missing euler angle rather than reading it as zero', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const event = events[0] as Record<string, unknown>;
    delete (event.event as Record<string, unknown>).gamma;
    expect(problemsOf(document).join('\n')).toContain('required key is missing');
  });

  it('accepts a null euler angle, which is what a browser sends before permission', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    const segments = document.segments as Record<string, unknown>[];
    const first = segments[0];
    if (!first) return;
    const events = first.events as Record<string, unknown>[];
    const event = events[0] as Record<string, unknown>;
    (event.event as Record<string, unknown>).alpha = null;
    expect(parseRecording(document).ok).toBe(true);
  });

  it('collects every problem rather than stopping at the first', () => {
    const document = throughJson(sound) as Record<string, unknown>;
    document.hunch = 'one';
    document.guess = 'two';
    expect(problemsOf(document).length).toBeGreaterThanOrEqual(2);
  });
});

describe('the known bearing', () => {
  const sunBearing = {
    kind: 'sun-azimuth',
    magneticAzimuthDeg: 200,
    altitudeDeg: 31,
    ephemeris: 'src/core/celestial.ts sunPosition',
    trueAzimuthDeg: 212,
    declinationDeg: 12,
  } as const;

  function withBearing(bearing: unknown): unknown {
    const document = throughJson(synthesiseRecording(spec())) as Record<string, unknown>;
    document.knownBearing = bearing;
    return document;
  }

  it('accepts a sun capture carrying an azimuth but no position and no clock', () => {
    const result = parseRecording(withBearing(sunBearing));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.knownBearing.kind).toBe('sun-azimuth');
    expect(result.value.knownBearing.magneticAzimuthDeg).toBe(200);
  });

  it('rejects a sun capture with no ephemeris named', () => {
    const { ephemeris: _ephemeris, ...rest } = sunBearing;
    expect(problemsOf(withBearing(rest)).join('\n')).toContain('ephemeris');
  });

  it('catches a declination applied with the wrong sign', () => {
    // 212 true with 12 east declination is 200 magnetic. Subtracting the other
    // way gives 224, which is the mistake this check exists for.
    const problems = problemsOf(withBearing({ ...sunBearing, magneticAzimuthDeg: 224 }));
    expect(problems.join('\n')).toContain('magnetic = true − declination');
  });

  it('accepts a surveyed bearing with no true azimuth at all', () => {
    const result = parseRecording(
      withBearing({ kind: 'surveyed-bearing', magneticAzimuthDeg: 200, source: 'a fence line off a paper map' }),
    );
    expect(result.ok).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The repeated-drag trials
 * ══════════════════════════════════════════════════════════════════════════
 * WHERE THE EXPECTATIONS COME FROM
 * The six attempts below are chosen so every statistic is an exact decimal,
 * worked out by hand before the analyzer runs:
 *
 *   normal heading offsets 1.0, 1.6, 2.2 → mean 1.6; deviations ∓0.6, 0, ±0.6;
 *     Σd² = 0.72; sample variance 0.72/2 = 0.36; sd = 0.6
 *   fine   heading offsets 0.10, 0.14, 0.18 → mean 0.14; Σd² = 0.0032;
 *     sample variance 0.0016; sd = 0.04
 *   normal dx 10, 16, 22 → sd 6;   fine dx 2, 3, 4 → sd 1
 *   normal roll spreads 0.2, 0.3, 0.4 → mean 0.3, sd 0.1
 *   fine   roll spreads 0.1, 0.1, 0.1 → mean 0.1, sd 0
 *
 * 0.6° is deliberately ABOVE the budget's assumed 0.543° and 0.04° below it, so
 * the verdict's comparison is exercised in both directions in one recording.
 */

const TRIAL_SPECS = [
  { index: 0, mode: 'normal', headingDeg: 1.0, dx: 10, rollSpreadDeg: 0.2 },
  { index: 1, mode: 'normal', headingDeg: 1.6, dx: 16, rollSpreadDeg: 0.3 },
  { index: 2, mode: 'normal', headingDeg: 2.2, dx: 22, rollSpreadDeg: 0.4 },
  { index: 3, mode: 'fine', headingDeg: 0.1, dx: 2, rollSpreadDeg: 0.1 },
  { index: 4, mode: 'fine', headingDeg: 0.14, dx: 3, rollSpreadDeg: 0.1 },
  { index: 5, mode: 'fine', headingDeg: 0.18, dx: 4, rollSpreadDeg: 0.1 },
] as const;

function trialDocuments(): Record<string, unknown>[] {
  return TRIAL_SPECS.map((t) => ({
    index: t.index,
    mode: t.mode,
    offsetPx: { dx: t.dx, dy: -4 },
    offsetDeg: { headingDeg: t.headingDeg, pitchDeg: 0.05 },
    rollSpreadDeg: t.rollSpreadDeg,
    rollSampleCount: 20,
    durationMs: 1800,
    gain: t.mode === 'fine' ? 0.25 : 1,
  }));
}

/** A sound recording with the six attempts appended. */
function withTrials(trials: unknown = trialDocuments()): Record<string, unknown> {
  const document = throughJson(synthesiseRecording(spec())) as Record<string, unknown>;
  document.dragTrials = trials;
  return document;
}

describe('the drag trials in the recording', () => {
  it('accepts the six attempts and keeps every field', () => {
    const result = parseRecording(withTrials());
    expect(result.ok ? [] : result.problems).toEqual([]);
    if (!result.ok) return;
    expect(result.value.dragTrials).toHaveLength(6);
    const first = result.value.dragTrials?.[0];
    expect(first).toEqual({
      index: 0,
      mode: 'normal',
      offsetPx: { dx: 10, dy: -4 },
      offsetDeg: { headingDeg: 1.0, pitchDeg: 0.05 },
      rollSpreadDeg: 0.2,
      rollSampleCount: 20,
      durationMs: 1800,
      gain: 1,
    });
  });

  it('parses a recording that carries no trials at all', () => {
    const document = throughJson(synthesiseRecording(spec())) as Record<string, unknown>;
    expect('dragTrials' in document).toBe(false);
    const result = parseRecording(document);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.dragTrials).toBeUndefined();
  });

  it('refuses a key the whitelist does not name', () => {
    const trials = trialDocuments();
    const first = trials[0];
    expect(first).toBeDefined();
    if (!first) return;
    first.startedAtMs = 4000;
    expect(problemsOf(withTrials(trials)).join('\n')).toContain('dragTrials[0].startedAtMs');
  });

  it('refuses a coordinate smuggled into a trial', () => {
    const trials = trialDocuments();
    const first = trials[0];
    if (!first) return;
    first.latitude = 45.98;
    const problems = problemsOf(withTrials(trials)).join('\n');
    expect(problems).toContain('forbidden key: a coordinate');
  });

  it('refuses a wall clock on a trial, whatever it is called', () => {
    const trials = trialDocuments();
    const first = trials[0];
    if (!first) return;
    first.capturedAt = 1_762_000_000_000;
    const problems = problemsOf(withTrials(trials)).join('\n');
    expect(problems).toContain('forbidden key shape: a wall-clock instant');
    expect(problems).toContain('absolute epoch timestamp');
  });

  it('refuses a gain that is not one of the two modes', () => {
    const trials = trialDocuments();
    const first = trials[0];
    if (!first) return;
    first.mode = 'coarse';
    expect(problemsOf(withTrials(trials)).join('\n')).toContain('dragTrials[0].mode');
  });

  it('refuses the same attempt index twice', () => {
    const trials = trialDocuments();
    const second = trials[1];
    if (!second) return;
    second.index = 0;
    expect(problemsOf(withTrials(trials)).join('\n')).toContain('0 is used twice');
  });

  it('reduces each mode to the statistics worked out by hand', () => {
    const result = parseRecording(withTrials());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const trials = result.value.dragTrials ?? [];

    const normal = dragModeScatter(trials, 'normal');
    expect(normal.count).toBe(3);
    expect(normal.headingMeanDeg).toBeCloseTo(1.6, 12);
    expect(normal.headingSdDeg).toBeCloseTo(0.6, 12);
    expect(normal.pxSdPx).toBeCloseTo(6, 12);
    expect(normal.rollSpreadMeanDeg).toBeCloseTo(0.3, 12);
    expect(normal.rollSpreadSdDeg).toBeCloseTo(0.1, 12);
    expect(normal.rollSampleCount).toBe(60);

    const fine = dragModeScatter(trials, 'fine');
    expect(fine.headingMeanDeg).toBeCloseTo(0.14, 12);
    expect(fine.headingSdDeg).toBeCloseTo(0.04, 12);
    expect(fine.pxSdPx).toBeCloseTo(1, 12);
    expect(fine.rollSpreadMeanDeg).toBeCloseTo(0.1, 12);
    expect(fine.rollSpreadSdDeg).toBeCloseTo(0, 12);
  });

  it('reports the scatter per mode and the roll spread as one verdict', () => {
    const result = parseRecording(withTrials());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = analyseRecording(result.value).verdicts.find((v) => v.id === 'drag-scatter');
    expect(found).toBeDefined();
    if (!found) return;
    expect(found.inconclusive).toBe(false);
    expect(found.confidence).toBe('moderate');
    // The winner is the smaller scatter, and it is under the budget's 0.543°.
    expect(found.answer).toContain('fine drag scatters 0.040°');
    expect(found.answer).toContain('under the 0.543°');
    expect(found.answer).toContain('0.10°');
    const evidence = found.evidence.join('\n');
    expect(evidence).toContain('normal: 3 attempt(s), heading scatter 0.600° (mean +1.600°, 6.0 px)');
    expect(evidence).toContain('roll spread 0.30° ± 0.10° over 60 roll sample(s)');
    expect(evidence).toContain('fine: 3 attempt(s), heading scatter 0.040°');
  });

  it('says so, and stays low confidence, when a mode has too few attempts', () => {
    const result = parseRecording(withTrials(trialDocuments().slice(0, 4)));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = analyseRecording(result.value).verdicts.find((v) => v.id === 'drag-scatter');
    expect(found?.confidence).toBe('low');
    expect(found?.answer).toContain('normal drag scatters 0.600°');
    expect(found?.answer).toContain('over the 0.543°');
  });

  it('is inconclusive rather than silent when there are no trials', () => {
    const result = parseRecording(withTrials([]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = analyseRecording(result.value).verdicts.find((v) => v.id === 'drag-scatter');
    expect(found?.inconclusive).toBe(true);
    expect(found?.evidence.join('\n')).toContain('no drag trials');
  });

  it('computes a sample standard deviation, not a population one', () => {
    // Two draws 1 apart: the sample sd is 1/√2 = 0.70710678…, the population
    // sd 0.5. Worked out by hand, and the two differ by 41 %.
    expect(meanAndSampleSd([0, 1]).sd).toBeCloseTo(Math.SQRT1_2, 12);
    expect(meanAndSampleSd([7]).sd).toBe(0);
    expect(meanAndSampleSd([]).mean).toBe(0);
  });
});

describe('the committed fixtures', () => {
  // The two recordings in fixtures/sensors/web/ are what scripts/analyze-recording.ts
  // is demonstrated on, so a change that breaks them breaks the self-check too.
  for (const [file, expected] of [
    ['synthetic-home-session-top-edge.json', 'device-top-edge'],
    ['synthetic-home-session-camera-axis.json', 'rear-camera-axis'],
  ] as const) {
    it(`parses ${file} and scores it as ${expected}`, async () => {
      const { readFileSync } = await import('node:fs');
      const { fileURLToPath } = await import('node:url');
      const path = fileURLToPath(new URL(`../../fixtures/sensors/web/${file}`, import.meta.url));
      const result = parseRecording(JSON.parse(readFileSync(path, 'utf8')));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const analysis = analyseRecording(result.value);
      expect(analysis.compassReference.verdict).toBe(expected);
      // Neither fixture carries drag trials — they are recordings of the sensor
      // protocol alone — so `drag-scatter` is inconclusive on both. Neither
      // carries a Sun bearing either, so `pitch-bias` has no altitude to score
      // against and `motion-heading` has no fixed reference. Both lists are
      // named here rather than counted, so a new inconclusive verdict shows up.
      const unresolved = analysis.verdicts.filter((v) => v.inconclusive).map((v) => v.id);
      expect(unresolved).toEqual(
        expected === 'device-top-edge'
          ? ['drag-scatter', 'pitch-bias', 'motion-heading']
          : ['landscape-sign', 'drag-scatter', 'pitch-bias', 'motion-heading'],
      );
      expect(result.value.dragTrials).toBeUndefined();
    });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * The tilt zero point, and the compass's own honesty
 * ══════════════════════════════════════════════════════════════════════════
 * Every expectation here comes from two attitudes whose camera altitude is an
 * elementary consequence of the specification's matrix, not from running the
 * estimator:
 *
 *   γ = 0, β = 90 + a    the camera's earth vector has z = −cos β cos γ
 *                        = −cos(90 + a) = sin a, so its altitude is a
 *   β = 180, γ = ±(90 − a)  the same product with cos β = −1: cos(90 − a)
 *                        = sin a again, so its altitude is a
 *
 * The second family is a phone held sideways rather than upright, so the two
 * are different poses with the same answer. It is stated at β = 180 rather than
 * at β = 0 because a browser reports gamma within ±90°, and a sideways phone
 * looking ABOVE the horizon is outside that range on the β = 0 branch. Both are
 * stated in § A.2's row 3: the earth's up in device coordinates is
 * (−cos β sin γ, sin β, cos β cos γ).
 */

/** The altitude the estimator is scored against: the protocol's own aim. */
const SUN_ALTITUDE_DEG = PROTOCOL_SUN_ALTITUDE_DEG;

/** The synthetic bearing, restated as the Sun so an altitude is on file. */
function withSunBearing(recording: HomeSessionRecording): HomeSessionRecording {
  return {
    ...recording,
    knownBearing: {
      kind: 'sun-azimuth',
      magneticAzimuthDeg: recording.knownBearing.magneticAzimuthDeg,
      altitudeDeg: SUN_ALTITUDE_DEG,
      ephemeris: 'synthetic: the altitude this recording was built around',
    },
  };
}

/**
 * Three aiming steps whose sensed camera altitudes miss the Sun by the biases
 * given, with no attitude noise so each median is exactly its bias.
 */
function aimedRecording(
  biasesDeg: readonly number[],
  attitudeNoiseDeg = 0,
): HomeSessionRecording {
  const poses: readonly PoseLabel[] = [
    'portrait-upright-known-bearing',
    'landscape-upright-known-bearing-top-left',
    'landscape-upright-known-bearing-top-right',
  ];
  const segments: SynthSegmentSpec[] = [];
  biasesDeg.forEach((bias, index) => {
    const pose = poses[index];
    if (pose === undefined) return;
    const aimDeg = SUN_ALTITUDE_DEG + bias;
    const from =
      index === 0
        ? { betaDeg: 90 + aimDeg, gammaDeg: 0 }
        : index === 1
          ? { betaDeg: 180, gammaDeg: 90 - aimDeg }
          : { betaDeg: 180, gammaDeg: -(90 - aimDeg) };
    segments.push({ pose, durationMs: 4000, orientationHz: 10, from });
  });
  return withSunBearing(
    synthesiseRecording(spec({ segments, attitudeNoiseDeg, compassNoiseDeg: 0 })),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * The walking aim
 * ══════════════════════════════════════════════════════════════════════════
 * The measured quantity is `compass reading − the Sun's magnetic azimuth`,
 * taken over the still landscape step and over the walking one. Both steps hold
 * the phone the same way round, so a difference between them is a change in the
 * reading and nothing else. The synthetic camera azimuth is what is injected,
 * so the expected change is the injection itself, to the compass noise.
 */

/** The protocol with the walking step aimed somewhere other than the Sun. */
function walkingAimedOffBy(offsetDeg: number): HomeSessionRecording {
  const segments = protocolSegments().map((segment) =>
    segment.pose === 'landscape-walking-known-bearing'
      ? { ...segment, cameraAzimuthDeg: fold360(KNOWN_BEARING_DEG + offsetDeg) }
      : segment,
  );
  return withSunBearing(synthesiseRecording(spec({ segments, compassNoiseDeg: 0 })));
}

describe('the walking aim', () => {
  it('reports no fault when the reading follows the Sun in both steps', () => {
    const answer = verdictFor(walkingAimedOffBy(0), 'motion-heading');
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer).toContain('no — the reading stayed within');
    expect(answer.evidence.join('\n')).toContain(`against a ${MOTION_HEADING_FAULT_DEG}° threshold`);
  });

  it('flags a quarter-turn change between the still step and the walking one', () => {
    const answer = verdictFor(walkingAimedOffBy(90), 'motion-heading');
    expect(answer.answer).toContain('motion-dependent heading fault');
    expect(answer.answer).toContain('90.0°');
  });

  it('stays quiet just inside the threshold and speaks just outside it', () => {
    expect(verdictFor(walkingAimedOffBy(MOTION_HEADING_FAULT_DEG - 1), 'motion-heading').answer).toContain(
      'no — the reading stayed',
    );
    expect(verdictFor(walkingAimedOffBy(MOTION_HEADING_FAULT_DEG + 1), 'motion-heading').answer).toContain(
      'motion-dependent heading fault',
    );
  });

  it('is inconclusive, not clean, when the walking step was never recorded', () => {
    const answer = verdictFor(
      withSunBearing(onlyPoses(['landscape-upright-known-bearing-top-left'], { compassNoiseDeg: 0 })),
      'motion-heading',
    );
    expect(answer.inconclusive).toBe(true);
    expect(answer.evidence.join('\n')).toContain('landscape-walking-known-bearing');
  });

  it('is inconclusive when the reference the two steps share is not the Sun', () => {
    const recording = walkingAimedOffBy(90);
    const answer = verdictFor(
      {
        ...recording,
        knownBearing: {
          kind: 'surveyed-bearing',
          magneticAzimuthDeg: recording.knownBearing.magneticAzimuthDeg,
          source: 'a church spire, taken off a map',
        },
      },
      'motion-heading',
    );
    expect(answer.inconclusive).toBe(true);
    expect(answer.evidence.join('\n')).toContain('not the Sun');
  });
});

describe('the camera altitude', () => {
  it('reads an upright phone’s tilt straight off beta', () => {
    // γ = 0 leaves altitude = asin(−cos β). β = 90 is level, β = 115 is 25° up.
    expect(cameraAltitudeDeg(90, 0)).toBeCloseTo(0, 12);
    expect(cameraAltitudeDeg(115, 0)).toBeCloseTo(25, 12);
    expect(cameraAltitudeDeg(78, 0)).toBeCloseTo(-12, 12);
  });

  it('reads a sideways phone’s tilt off gamma, either way round', () => {
    expect(cameraAltitudeDeg(0, 90)).toBeCloseTo(0, 12);
    expect(cameraAltitudeDeg(0, 115)).toBeCloseTo(25, 12);
    expect(cameraAltitudeDeg(0, -115)).toBeCloseTo(25, 12);
  });

  it('points straight down when the phone lies face up, and up when face down', () => {
    expect(cameraAltitudeDeg(0, 0)).toBeCloseTo(-90, 12);
    expect(cameraAltitudeDeg(180, 0)).toBeCloseTo(90, 12);
  });
});

describe('the pitch bias', () => {
  it('recovers the bias as the mean of the per-step medians', () => {
    // Biases 1, 2 and 3 have mean 2 and sample sd sqrt(((1)²+0+(1)²)/2) = 1.
    const estimate = estimatePitchBias(aimedRecording([1, 2, 3]));
    expect(estimate?.biasDeg).toBeCloseTo(2, 6);
    expect(estimate?.spreadDeg).toBeCloseTo(1, 6);
    expect(estimate?.perSegment.map((s) => s.medianDeg)).toHaveLength(3);
    expect(estimate?.perSegment[0]?.medianDeg).toBeCloseTo(1, 6);
    expect(estimate?.perSegment[2]?.medianDeg).toBeCloseTo(3, 6);
  });

  it('keeps the sign: a phone reading high reports a positive bias', () => {
    expect(estimatePitchBias(aimedRecording([-2, -2, -2]))?.biasDeg).toBeCloseTo(-2, 6);
    expect(estimatePitchBias(aimedRecording([2, 2, 2]))?.biasDeg).toBeCloseTo(2, 6);
  });

  it('applies a recorded tap offset, because the Sun was not where the aim assumed', () => {
    const base = aimedRecording([1, 2, 3]);
    // The Sun sat 0.5° ABOVE centre on every step, so the camera axis was 0.5°
    // below it and every sensed altitude is 0.5° low.
    const shifted: HomeSessionRecording = {
      ...base,
      segments: base.segments.map((segment) => ({
        ...segment,
        aimOffsetDeg: { headingDeg: 0, pitchDeg: 0.5 },
      })),
    };
    expect(estimatePitchBias(shifted)?.biasDeg).toBeCloseTo(2.5, 6);
    expect(estimatePitchBias(shifted)?.aimOffsetsMeasured).toBe(true);
    expect(estimatePitchBias(base)?.aimOffsetsMeasured).toBe(false);
  });

  it('falls back to one step’s own scatter when only one step was aimed', () => {
    // A portrait hold at γ = 0 has altitude β − 90, so the residual scatter is
    // exactly the injected beta noise: strictly positive, and bounded by the
    // 1.0° peak the generator is given. The sample sd of ONE median is zero, so
    // a spread that is not zero can only have come from the fallback.
    const estimate = estimatePitchBias(aimedRecording([1.5], 1));
    expect(estimate?.perSegment).toHaveLength(1);
    expect(Math.abs((estimate?.biasDeg ?? 0) - 1.5)).toBeLessThanOrEqual(1);
    expect(estimate?.spreadDeg).toBeGreaterThan(0);
    expect(estimate?.spreadDeg).toBeLessThanOrEqual(1);
    expect(estimate?.spreadDeg).toBe(estimate?.perSegment[0]?.scatterDeg);
    expect(verdictFor(aimedRecording([1.5], 1), 'pitch-bias').confidence).toBe('low');
  });

  it('takes the median of a hold, so the seconds spent settling do not drag it', () => {
    // The portrait step is 4 s at 10 Hz, so 41 samples. The first 10 are moved
    // 20° off, as a phone still being lined up is. With 10 of 41 displaced, the
    // middle value is untouched and the median still reads the 2° bias, while
    // the mean would read 2 + 20 × 10/41 = 6.878°.
    const base = aimedRecording([2]);
    const settling: HomeSessionRecording = {
      ...base,
      segments: base.segments.map((segment) => ({
        ...segment,
        events: segment.events.map((event, index) =>
          event.kind === 'orientation' && index < 10
            ? { ...event, event: { ...event.event, beta: (event.event.beta ?? 0) + 20 } }
            : event,
        ),
      })),
    };
    expect(settling.segments[0]?.events).toHaveLength(41);
    expect(estimatePitchBias(settling)?.biasDeg).toBeCloseTo(2, 6);
  });

  it('prints the bias at three decimals, so a tenth-degree term is not rounded away', () => {
    const answer = verdictFor(aimedRecording([0.04, 0.04, 0.04]), 'pitch-bias');
    expect(answer.answer).toContain('+0.040°');
  });

  it('refuses a bias no tilt sensor could have, because the aim missed', () => {
    // 40° past the Sun is a camera pointing somewhere else, not a gravity zero.
    const estimate = estimatePitchBias(aimedRecording([40, 40, 40]));
    expect(estimate?.biasDeg).toBeCloseTo(40, 6);
    expect(estimate?.credible).toBe(false);
    expect(estimatePitchBias(aimedRecording([1, 2, 3]))?.credible).toBe(true);
    const answer = verdictFor(aimedRecording([40, 40, 40]), 'pitch-bias');
    expect(answer.inconclusive).toBe(true);
    expect(answer.evidence.join(' ')).toContain('not pointing at the Sun');
  });

  it('says nothing when the reference is not the Sun', () => {
    const surveyed = synthesiseRecording(spec({ attitudeNoiseDeg: 0 }));
    expect(estimatePitchBias(surveyed)).toBeUndefined();
    const answer = verdictFor(surveyed, 'pitch-bias');
    expect(answer.inconclusive).toBe(true);
    expect(answer.evidence.join(' ')).toContain('not the Sun');
  });

  it('ignores the sun-capture step, where the Sun is deliberately off centre', () => {
    const base = aimedRecording([1, 2, 3]);
    const offCentre: HomeSessionRecording = {
      ...base,
      segments: base.segments.map((segment, index) =>
        index === 0 ? { ...segment, pose: 'sun-capture' as PoseLabel } : segment,
      ),
    };
    // Dropping the 1° step leaves 2 and 3: mean 2.5, sample sd sqrt(0.5) ≈ 0.7071.
    expect(estimatePitchBias(offCentre)?.biasDeg).toBeCloseTo(2.5, 6);
    expect(estimatePitchBias(offCentre)?.spreadDeg).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('carries the estimate on the analysis, so the screen can store it', () => {
    expect(analyseRecording(aimedRecording([1, 2, 3])).pitchBias?.biasDeg).toBeCloseTo(2, 6);
    expect(analyseRecording(synthesiseRecording(spec())).pitchBias).toBeUndefined();
  });
});

/** Every compass reading shifted by a constant, as a biased magnetometer is. */
function withCompassOffset(recording: HomeSessionRecording, offsetDeg: number): HomeSessionRecording {
  return {
    ...recording,
    segments: recording.segments.map((segment) => ({
      ...segment,
      events: segment.events.map((event) =>
        event.kind === 'orientation' && typeof event.event.webkitCompassHeading === 'number'
          ? {
              ...event,
              event: {
                ...event.event,
                webkitCompassHeading: fold360(event.event.webkitCompassHeading + offsetDeg),
              },
            }
          : event,
      ),
    })),
  };
}

describe('the compass heading bias', () => {
  it('reports the bias against the Sun and the accuracy the phone claimed', () => {
    const answer = verdictFor(
      withSunBearing(
        synthesiseRecording(
          spec({ hypothesis: 'device-top-edge', attitudeNoiseDeg: 0, compassNoiseDeg: 0, compassAccuracyDeg: 8 }),
        ),
      ),
      'heading-bias',
    );
    // A noise-free synthetic phone obeys its hypothesis exactly, so the bias is
    // zero and the 8° it claims covers it.
    expect(answer.inconclusive).toBe(false);
    expect(answer.answer).toContain('covers the bias');
    expect(answer.evidence.join(' ')).toContain('8.0°');
  });

  it('calls the claim out when the reading is further off than the phone admits', () => {
    // A constant offset on the reading itself, which is what an uncorrected
    // magnetometer bias looks like. 8° leaves the winning hypothesis inside the
    // 12° a segment may leave and still win, so the reference stays decided and
    // the bias is what changes.
    const built = synthesiseRecording(
      spec({ attitudeNoiseDeg: 0, compassNoiseDeg: 0, compassAccuracyDeg: 5 }),
    );
    const answer = verdictFor(withSunBearing(withCompassOffset(built, 8)), 'heading-bias');
    expect(answer.answer).toContain('8.0°');
    expect(answer.answer).toContain('understates it');
    expect(answer.evidence.join(' ')).toContain('5.0°');
  });

  it('withholds a bias while the compass reference is undecided', () => {
    const portraitOnly = horizonAimedPortrait(['portrait-upright-known-bearing']);
    const answer = verdictFor(withSunBearing(portraitOnly), 'heading-bias');
    expect(answer.inconclusive).toBe(true);
    expect(answer.evidence.join(' ')).toContain('undecided');
  });
});
