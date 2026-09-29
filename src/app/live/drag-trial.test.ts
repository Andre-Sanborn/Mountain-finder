/**
 * The repeated-drag trials — the statistics, and the wrap the roll spread needs.
 *
 * Expectations are hand-arithmetic on small integer sets, so each one can be
 * checked by reading it. The standard deviation is the SAMPLE one (n − 1): three
 * attempts are a sample of a hand, not the whole of it.
 */

import { describe, expect, it } from 'vitest';

import {
  angularSpreadDeg,
  DRAG_TRIAL_PLAN,
  dragTrialInstruction,
  dragTrialSentence,
  meanAndSd,
  ROLL_SAMPLE_INTERVAL_MS,
  summariseDragTrials,
  type DragTrial,
} from './drag-trial';

function trial(
  index: number,
  mode: 'normal' | 'fine',
  headingDeg: number,
  dx: number,
  rollSpreadDeg: number,
): DragTrial {
  return {
    index,
    mode,
    offsetPx: { dx, dy: 0 },
    offsetDeg: { headingDeg, pitchDeg: 0 },
    rollSpreadDeg,
    rollSampleCount: 30,
    durationMs: 1200,
  };
}

describe('DRAG_TRIAL_PLAN', () => {
  it('is three normal attempts then three fine ones', () => {
    expect(DRAG_TRIAL_PLAN).toEqual(['normal', 'normal', 'normal', 'fine', 'fine', 'fine']);
    expect(ROLL_SAMPLE_INTERVAL_MS).toBe(100);
  });
});

describe('angularSpreadDeg', () => {
  it('is the range of the samples', () => {
    // −1, +2, 0 about the first sample of 3 → range 3.
    expect(angularSpreadDeg([3, 2, 5, 3])).toBe(3);
  });

  it('is 0 for fewer than two samples, rather than reporting the value itself', () => {
    expect(angularSpreadDeg([])).toBe(0);
    expect(angularSpreadDeg([17.5])).toBe(0);
  });

  it('folds across ±180, so a landscape hold near the seam reads its real spread', () => {
    // A phone held at −179° that moves 2° past the seam: the raw numbers span
    // 358°, the hold moved 2°.
    expect(angularSpreadDeg([-179, 179, -180])).toBeCloseTo(2, 9);
  });
});

describe('meanAndSd', () => {
  it('is the mean and the sample standard deviation', () => {
    // 2, 4, 6: mean 4, deviations −2, 0, +2, sum of squares 8, over n−1 = 2, so
    // the variance is 4 and the sd is 2.
    expect(meanAndSd([2, 4, 6])).toEqual({ mean: 4, sd: 2 });
  });

  it('has no spread from one value, and none from none', () => {
    expect(meanAndSd([9])).toEqual({ mean: 9, sd: 0 });
    expect(meanAndSd([])).toEqual({ mean: 0, sd: 0 });
  });
});

describe('summariseDragTrials', () => {
  const trials = [
    trial(0, 'normal', 0.4, 8, 0.5),
    trial(1, 'normal', 0.8, 16, 0.7),
    trial(2, 'normal', 1.2, 24, 0.9),
    trial(3, 'fine', 0.1, 8, 0.3),
    trial(4, 'fine', 0.2, 16, 0.4),
    trial(5, 'fine', 0.3, 24, 0.5),
  ];

  it('reports each mode separately, and the scatter rather than the bias', () => {
    const normal = summariseDragTrials(trials, 'normal');
    expect(normal.count).toBe(3);
    expect(normal.headingMeanDeg).toBeCloseTo(0.8, 12);
    // 0.4, 0.8, 1.2 → sd 0.4, the same arithmetic as 2, 4, 6 scaled by 0.2.
    expect(normal.headingSdDeg).toBeCloseTo(0.4, 12);
    expect(normal.pxSd).toBeCloseTo(8, 12);
    expect(normal.rollSpreadMeanDeg).toBeCloseTo(0.7, 12);

    const fine = summariseDragTrials(trials, 'fine');
    // The same pixels at a quarter of the gain, so a quarter of the degrees and a
    // quarter of the scatter, with the pixel scatter unchanged.
    expect(fine.headingSdDeg).toBeCloseTo(0.1, 12);
    expect(fine.pxSd).toBeCloseTo(8, 12);
  });

  it('reports a mode with no attempts as empty rather than as zero scatter', () => {
    const summary = summariseDragTrials([], 'fine');
    expect(summary.count).toBe(0);
    expect(dragTrialSentence(summary)).toContain('nothing recorded yet');
  });

  it('states the scatter in both units and the roll it was held at', () => {
    const sentence = dragTrialSentence(summariseDragTrials(trials, 'normal'));
    expect(sentence).toContain('3 attempts');
    expect(sentence).toContain('0.400°');
    expect(sentence).toContain('8.0 px');
    expect(sentence).toContain('0.70°');
  });
});

describe('dragTrialInstruction', () => {
  it('numbers the attempts within their own mode and names the speed', () => {
    expect(dragTrialInstruction(0)).toContain('Attempt 1 of 3, normal speed');
    expect(dragTrialInstruction(2)).toContain('Attempt 3 of 3, normal speed');
    expect(dragTrialInstruction(3)).toContain('Attempt 1 of 3, fine speed');
    expect(dragTrialInstruction(3)).toContain('quarter as far');
    expect(dragTrialInstruction(5)).toContain('Attempt 3 of 3');
  });

  it('tells the person to brace the phone in both hands', () => {
    expect(dragTrialInstruction(0)).toContain('both hands');
  });

  it('is empty past the end of the plan', () => {
    expect(dragTrialInstruction(DRAG_TRIAL_PLAN.length)).toBe('');
  });
});
