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
  expectedGravity,
  expectedTopEdgeMinusCameraDeg,
  fold360,
  parseRecording,
  protocolSegments,
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

/** A recording carrying only the poses named, so a blind spot can be built. */
function onlyPoses(poses: readonly PoseLabel[], overrides: Partial<SynthSpec> = {}): HomeSessionRecording {
  const wanted = new Set(poses);
  const segments: readonly SynthSegmentSpec[] = protocolSegments().filter((s) => wanted.has(s.pose));
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
 * The compass reference verdict
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the compass reference hypothesis', () => {
  const injected = {
    alphaDriftDegPerMinute: 2.4,
    alphaBiasDeg: 213,
    alphaRebase: { atMs: 60_000, byDeg: 77 },
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
    const recording = onlyPoses(
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
    const recording = onlyPoses(['portrait-upright-known-bearing', 'handling'], { alphaDriftDegPerMinute: 3 });
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
      expect(analysis.verdicts.filter((v) => v.inconclusive)).toHaveLength(expected === 'device-top-edge' ? 0 : 1);
    });
  }
});
