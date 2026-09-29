/**
 * The repeated-drag trials — what the home session measures the drag term with.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS BEING MEASURED, AND WHY IT IS MEASURED RATHER THAN ARGUED
 * ═══════════════════════════════════════════════════════════════════════════
 * The field-test budget's largest term is drag precision, 0.543° at 1σ, derived
 * from 1 mm of finger placement (docs/FIELD-TEST-PREREGISTRATION.md, term 9).
 * That figure is an assumption about a hand, not a measurement of one. These
 * trials replace it: the person puts one drawn mark onto the feature it belongs
 * to, three times over in normal mode and three times in fine mode, and each
 * attempt's final offset is kept. The scatter of the six numbers is the term.
 *
 * ── WHAT IS RECORDED, AND WHAT CANNOT BE ───────────────────────────────────
 * A trial holds pixels and degrees RELATIVE to where the drag started, the
 * spread of the phone's roll while it was held, and how long it took. No
 * absolute position on screen, no coordinate, no clock: an offset from the start
 * of a gesture says nothing about where the phone was pointed.
 *
 * ── THE ROLL SPREAD IS PART OF THE SAME MEASUREMENT ────────────────────────
 * A drag is only as repeatable as the hold under it. The budget carries roll at
 * 0.322° of vertical error, assumed from a braced two-hand landscape grip, and
 * the spread of the roll over each attempt is what says whether that grip held.
 * It is recorded per trial rather than once, because a hand tires.
 *
 * Pure: samples in, statistics out. No clock of its own — durations arrive as
 * numbers.
 */

import type { TrimState } from '../trim';
import type { DragMode } from './fine-drag';

/**
 * A drag that has just finished, as the live screen reports it.
 *
 * `serial` counts finished drags so a second attempt that happens to land on the
 * same offset is still a new one. Nothing here is absolute: the offset is from
 * where the finger went down, and the degrees are what this attempt added to the
 * nudge rather than the nudge in force.
 */
export interface CompletedDrag {
  readonly serial: number;
  readonly mode: DragMode;
  readonly offsetPx: { readonly dx: number; readonly dy: number };
  readonly offsetDeg: Pick<TrimState, 'headingDeg' | 'pitchDeg'>;
  readonly durationMs: number;
}

/** The six attempts, in the order the session runs them. */
export const DRAG_TRIAL_PLAN: readonly DragMode[] = ['normal', 'normal', 'normal', 'fine', 'fine', 'fine'];

/** How often the roll is sampled during a trial, milliseconds. */
export const ROLL_SAMPLE_INTERVAL_MS = 100;

export interface DragTrial {
  /** 0-based position in {@link DRAG_TRIAL_PLAN}. */
  readonly index: number;
  readonly mode: DragMode;
  /** Where the finger finished, relative to where it went down. CSS pixels. */
  readonly offsetPx: { readonly dx: number; readonly dy: number };
  /** What that did to the nudge, in degrees, relative to the nudge before it. */
  readonly offsetDeg: { readonly headingDeg: number; readonly pitchDeg: number };
  /** Max minus min of the phone's roll while this trial was open, degrees. */
  readonly rollSpreadDeg: number;
  readonly rollSampleCount: number;
  readonly durationMs: number;
}

/**
 * The spread of a run of angles, degrees.
 *
 * Differences are taken from the FIRST sample and folded onto ±180 before the
 * range is measured, so a hold sitting near ±180° reports the few degrees it
 * actually moved instead of the 360 the raw numbers straddle. A braced landscape
 * hold near −180 is not hypothetical: it is which way up the person turned the
 * phone.
 *
 * 0 for fewer than two samples — one reading has no spread, and reporting the
 * value itself would be a number that looks like a measurement.
 */
export function angularSpreadDeg(samples: readonly number[]): number {
  const first = samples[0];
  if (first === undefined || samples.length < 2) return 0;
  let lowest = 0;
  let highest = 0;
  for (const sample of samples) {
    const folded = ((((sample - first) % 360) + 540) % 360) - 180;
    if (folded < lowest) lowest = folded;
    if (folded > highest) highest = folded;
  }
  return highest - lowest;
}

/** Mean, and the sample standard deviation (n − 1), of a run of numbers. */
export function meanAndSd(values: readonly number[]): { mean: number; sd: number } {
  if (values.length === 0) return { mean: 0, sd: 0 };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length < 2) return { mean, sd: 0 };
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return { mean, sd: Math.sqrt(variance) };
}

export interface DragTrialSummary {
  readonly mode: DragMode;
  readonly count: number;
  /** Mean and 1σ scatter of the signed heading offset, degrees. */
  readonly headingMeanDeg: number;
  readonly headingSdDeg: number;
  /** Mean and 1σ scatter of the signed horizontal offset, CSS pixels. */
  readonly pxMean: number;
  readonly pxSd: number;
  /** Mean roll spread over the attempts in this mode, degrees. */
  readonly rollSpreadMeanDeg: number;
}

/**
 * The statistics one mode's attempts support.
 *
 * The SCATTER is the number the budget wants, not the mean: a person who is
 * consistently 2° off has a bias the drag is there to remove, and what limits the
 * result is how far apart their three attempts land. The sample standard
 * deviation (n − 1) is used because three attempts are a sample of a hand, not
 * the whole of it.
 */
export function summariseDragTrials(
  trials: readonly DragTrial[],
  mode: DragMode,
): DragTrialSummary {
  const mine = trials.filter((trial) => trial.mode === mode);
  const heading = meanAndSd(mine.map((trial) => trial.offsetDeg.headingDeg));
  const px = meanAndSd(mine.map((trial) => trial.offsetPx.dx));
  const roll = meanAndSd(mine.map((trial) => trial.rollSpreadDeg));
  return {
    mode,
    count: mine.length,
    headingMeanDeg: heading.mean,
    headingSdDeg: heading.sd,
    pxMean: px.mean,
    pxSd: px.sd,
    rollSpreadMeanDeg: roll.mean,
  };
}

/** What the screen says about one mode's attempts. */
export function dragTrialSentence(summary: DragTrialSummary): string {
  if (summary.count === 0) return `${summary.mode === 'fine' ? 'Fine' : 'Normal'}: nothing recorded yet.`;
  const which = summary.mode === 'fine' ? 'Fine' : 'Normal';
  return (
    `${which}: ${summary.count} attempt${summary.count === 1 ? '' : 's'}, ` +
    `spread ${summary.headingSdDeg.toFixed(3)}° (${summary.pxSd.toFixed(1)} px), ` +
    `roll held to ${summary.rollSpreadMeanDeg.toFixed(2)}°.`
  );
}

/** The instruction for one attempt, naming the mode it runs in. */
export function dragTrialInstruction(index: number): string {
  const mode = DRAG_TRIAL_PLAN[index];
  if (mode === undefined) return '';
  const attempt = DRAG_TRIAL_PLAN.slice(0, index).filter((entry) => entry === mode).length + 1;
  const speed =
    mode === 'fine'
      ? 'Fine drag is on, so the labels move a quarter as far'
      : 'Normal drag is on';
  return (
    `Attempt ${attempt} of 3, ${mode} speed. Brace the phone in both hands, pick one label, and ` +
    `drag it onto the thing it names. ${speed}. Lift your finger when it is as close as you can get.`
  );
}
