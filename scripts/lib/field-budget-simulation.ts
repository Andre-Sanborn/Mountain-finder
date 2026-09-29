/**
 * What the F3 and F4 gates do to a CORRECT app, with the budget's own sharing.
 *
 *   npx tsx scripts/lib/field-budget-simulation.ts
 *
 * § 2.3 of `docs/FIELD-TEST-PREREGISTRATION.md` first computed its pass rates
 * from `Σ_{j≤a} C(n,j)·p1^j·p0^(n−j)`, which treats every summit-axis unit as an
 * independent draw. The units in one band are not independent. They share the
 * drag anchor's own position error, the observer's position, the field-of-view
 * scale error, the roll of the hold, and — through the median — the same k drags.
 * Only the summit's own peak position is drawn per summit. So exceedances arrive
 * together: a band mostly passes with every unit inside, or fails with most of
 * them outside at once.
 *
 * This file draws the budget's terms with that structure and counts how often a
 * correct app clears the gate. It imports the registered terms and limits from
 * `src/live/field-analysis.ts` rather than restating them, so a change to the
 * budget moves these figures with it.
 *
 * ── WHAT IS MODELLED, AND WHAT IS NOT ──────────────────────────────────────
 * Each term is drawn at the 1σ § 1.5 or § 2.4 charges it, and shared exactly as
 * those sections say it is shared:
 *
 * | term | drawn | shared over |
 * |---|---|---|
 * | peak position (20 m) | per summit | every capture the summit appears in |
 * | observer position (15 m) | once | every summit, scaled by 1/D |
 * | the anchor's own error | once | every summit and capture |
 * | field-of-view scale | once | every summit and capture |
 * | roll | once per hold | every summit in that hold |
 * | drag | once per capture | every summit in that capture |
 *
 * The observer's error at the graded summit and at the anchor are drawn apart,
 * because § 1.5 charges them as two independent RSS terms. Modelling them as one
 * error read at two distances would partly cancel them and make the marginal
 * narrower than the registered one, which is a different budget rather than the
 * budget's own structure. That is stated because it is a choice: it makes this
 * simulation agree with the registered marginal by construction.
 *
 * Every term is charged at the frame edge, as § 1.5 charges them, so a summit
 * near the optical axis carries less than this model gives it.
 *
 * The generator is `mulberry32` from a seed written into this file, so every run
 * on every machine gives the same figures. It reads no file and opens no socket.
 */

import {
  BUDGET_TERMS,
  MOVEMENT_BUDGET_TERMS,
  PREREGISTERED_MOVEMENT_LIMITS,
  PREREGISTERED_THRESHOLDS,
  medianSigmaFactor,
  thresholdForCaptureCount,
  twoSigmaAllowanceFor,
  type BandId,
  type BandLimits,
} from '../../src/live/field-analysis.js';

/** Change this and every figure below changes. It is not a tuning knob. */
export const SIMULATION_SEED = 20_260_929;

/** Draws per scenario. 200 000 puts the standard error of a rate near 0.001. */
export const SIMULATION_TRIALS = 200_000;

const DEG_PER_RAD = 180 / Math.PI;

/** mulberry32: 32 bits of state, uniform on [0, 1). */
function uniformStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Standard normal by Box–Muller, one value per call. */
function normalStream(uniform: () => number): () => number {
  return () => {
    const u = Math.max(uniform(), Number.MIN_VALUE);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function metresAsDeg(metres: number, distanceKm: number): number {
  return (metres / (distanceKm * 1000)) * DEG_PER_RAD;
}

/** Whether a group of units clears the § 2.3 gate. */
function passes(units: readonly { readonly h: number; readonly v: number }[], limits: BandLimits): boolean {
  let overTwo = 0;
  let overThree = 0;
  for (const unit of units) {
    for (const [value, two, three] of [
      [unit.h, limits.horizontalDeg, limits.horizontal3SigmaDeg],
      [unit.v, limits.verticalDeg, limits.vertical3SigmaDeg],
    ] as const) {
      if (Math.abs(value) > three) overThree += 1;
      else if (Math.abs(value) > two) overTwo += 1;
    }
  }
  return overThree === 0 && overTwo <= twoSigmaAllowanceFor(units.length * 2);
}

/**
 * The standard deviation of the median of k standard normals, by simulation.
 *
 * § 1.5 needs this for k = 1, 2 and 3, and has closed forms for all three:
 * 1, 1/√2 and √(1 − √3/π). It quotes k = 4 for one purpose only — to say that
 * charging a median of four at the k = 3 factor is the permissive direction —
 * and there is no closed form in the document for it. This is the second
 * instrument on both: the three closed forms and the k = 4 figure come out of
 * the same draws.
 */
export function medianSdOfKNormals(k: number, trials = 2_000_000, seed = SIMULATION_SEED): number {
  const normal = normalStream(uniformStream(seed));
  let sumOfSquares = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    const draws: number[] = [];
    for (let i = 0; i < k; i += 1) draws.push(normal());
    const value = median(draws);
    sumOfSquares += value * value;
  }
  return Math.sqrt(sumOfSquares / trials);
}

/* ══════════════════════════════════════════════════════════════════════════
 * F3 — one band, k after-drag captures
 * ══════════════════════════════════════════════════════════════════════════ */

export interface BandScenario {
  readonly band: BandId;
  /** Distances of the graded summits, km. One unit pair per entry. */
  readonly distancesKm: readonly number[];
  /** After-drag captures each summit was settled in. */
  readonly k: number;
  /**
   * What the drag term is really worth, as a multiple of the budget's figure.
   *
   * 1 is a correct app. Above 1 the draws come from a wider term while the
   * limits stay registered, which is what a budget understating one term looks
   * like: it is how the gate's power is read.
   */
  readonly dragInflation?: number;
}

/**
 * How often a correct app clears one band's gate, with the terms shared.
 *
 * The residual of summit i in capture c is
 *
 *     peak_i + observer_i + anchor + fov + roll + drag_c
 *
 * and the unit is the median over the k captures, which touches `drag_c` alone.
 */
export function f3PassRate(
  scenario: BandScenario,
  trials = SIMULATION_TRIALS,
  seed = SIMULATION_SEED,
): number {
  const normal = normalStream(uniformStream(seed));
  const threshold = PREREGISTERED_THRESHOLDS.find((row) => row.band === scenario.band);
  if (threshold === undefined) throw new Error(`no band ${scenario.band}`);
  const limits = thresholdForCaptureCount(threshold, scenario.k);
  const t = BUDGET_TERMS;
  const dragDeg =
    t.dragDeg * medianSigmaFactor(scenario.k) * (scenario.dragInflation ?? 1);
  const anchorH = metresAsDeg(Math.hypot(t.peakPositionM, t.observerPositionM), t.anchorDistanceKm);
  const anchorV = metresAsDeg(Math.hypot(t.summitElevationM, t.observerHeightM), t.anchorDistanceKm);

  let passed = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    // Shared across every summit and every capture in the band.
    const anchor = { h: anchorH * normal(), v: anchorV * normal() };
    const fov = { h: t.fovHorizontalDeg * normal(), v: t.fovVerticalDeg * normal() };
    const roll = { h: t.rollHorizontalDeg * normal(), v: t.rollVerticalDeg * normal() };
    const observerM = t.observerPositionM * normal();
    // One drag per capture; the unit's median of k of them is one number, and
    // it is the same number for every summit in the band.
    const drags: number[] = [];
    const dragsV: number[] = [];
    for (let capture = 0; capture < scenario.k; capture += 1) {
      drags.push(dragDeg * normal());
      dragsV.push(dragDeg * normal());
    }
    const dragH = median(drags);
    const dragV = median(dragsV);

    const units = scenario.distancesKm.map((distanceKm) => ({
      h:
        metresAsDeg(t.peakPositionM * normal(), distanceKm) +
        metresAsDeg(observerM, distanceKm) +
        anchor.h +
        fov.h +
        roll.h +
        dragH,
      v:
        metresAsDeg(t.summitElevationM * normal(), distanceKm) +
        metresAsDeg(t.observerHeightM * normal(), distanceKm) +
        anchor.v +
        fov.v +
        roll.v +
        dragV,
    }));
    if (passes(units, limits)) passed += 1;
  }
  return passed / trials;
}

/* ══════════════════════════════════════════════════════════════════════════
 * F4 — the four movements from one after-drag capture
 * ══════════════════════════════════════════════════════════════════════════ */

const MOVEMENT_LIMITS: BandLimits = { band: 'far', ...PREREGISTERED_MOVEMENT_LIMITS };

/**
 * How often a correct app clears the four movements' gates, with the terms shared.
 *
 * Inside one movement everything but the truth read is one draw: one calibration
 * error, one roll per hold, one settle of the sensors. So a movement's units move
 * as a block, and the allowance schedule buys almost nothing. Across the four
 * movements the calibration error and the reference frame's hold are shared
 * again, which is why the four are not four independent 0.9-odd chances.
 *
 * The roll enters a pair as `ρ·(a·moved − b·reference)` with a and b the
 * offsets in the two frames; here the paired term is split evenly between them,
 * which keeps the marginal exact and shares the reference hold. The one place
 * the two offsets differ is a tilt's horizontal roll, which is 0.169° against a
 * 0.493° row, so the split moves nothing that shows at the 0.05° rounding.
 *
 * Returns the rate for one movement and the rate for all four together.
 */
export function f4PassRates(
  summits: number,
  trials = SIMULATION_TRIALS,
  seed = SIMULATION_SEED,
): { readonly perMovement: number; readonly allFour: number } {
  const normal = normalStream(uniformStream(seed));
  const pan = MOVEMENT_BUDGET_TERMS.pan;
  const tilt = MOVEMENT_BUDGET_TERMS.tilt;
  const rows = [pan, pan, tilt, tilt] as const;

  let movementsPassed = 0;
  let runsPassed = 0;
  for (let trial = 0; trial < trials; trial += 1) {
    // One calibration error and one reference hold for the whole session. The
    // roll enters a pair as the difference of two holds, so the shared half is
    // drawn once and the moved half per movement.
    const fovShared = normal();
    const rollReference = { h: normal(), v: normal() };
    const truthReference = Array.from({ length: summits }, () => ({ h: normal(), v: normal() }));

    let allFour = true;
    for (const terms of rows) {
      const rollMoved = { h: normal(), v: normal() };
      const sensor = { h: normal(), v: normal() };
      const units = Array.from({ length: summits }, (_unused, index) => {
        const reference = truthReference[index] ?? { h: 0, v: 0 };
        // The truth read is charged once per frame; the pair carries both, and
        // the reference frame's read is the same one every movement differences
        // against.
        const truthH = (terms.truthReadDeg / Math.SQRT2) * (normal() - reference.h);
        const truthV = (terms.truthReadDeg / Math.SQRT2) * (normal() - reference.v);
        return {
          h:
            terms.fovHorizontalDeg * fovShared +
            (terms.rollHorizontalDeg / Math.SQRT2) * (rollMoved.h - rollReference.h) +
            terms.sensorHoldDeg * sensor.h +
            truthH,
          v:
            terms.fovVerticalDeg * fovShared +
            (terms.rollVerticalDeg / Math.SQRT2) * (rollMoved.v - rollReference.v) +
            terms.sensorHoldDeg * sensor.v +
            truthV,
        };
      });
      const ok = passes(units, MOVEMENT_LIMITS);
      if (ok) movementsPassed += 1;
      else allFour = false;
    }
    if (allFour) runsPassed += 1;
  }
  return { perMovement: movementsPassed / (trials * rows.length), allFour: runsPassed / trials };
}

/* ══════════════════════════════════════════════════════════════════════════
 * The scenarios § 2.3 and § 2.4 quote
 * ══════════════════════════════════════════════════════════════════════════ */

/** Band sizes the session can produce, all in the flat `far` band beyond 7 km. */
export const REPORTED_BAND_SIZES = [3, 4, 5, 6, 12] as const;

/** Summits per movement § 2.4 quotes. */
export const REPORTED_MOVEMENT_SIZES = [3, 5] as const;

function farBand(summits: number, k: number): BandScenario {
  // Spread over the band rather than piled at one distance: the peak-position
  // term is the only per-summit one and it shrinks with distance.
  const distances = [8, 10, 12, 14, 16, 18, 9, 11, 13, 15, 17, 19];
  return {
    band: 'far',
    distancesKm: Array.from({ length: summits }, (_unused, index) => distances[index % 12] ?? 10),
    k,
  };
}

function main(): void {
  process.stdout.write('F3, far band, shared terms (a correct app)\n');
  for (const k of [1, 2, 3]) {
    for (const summits of REPORTED_BAND_SIZES) {
      const rate = f3PassRate(farBand(summits, k));
      process.stdout.write(
        `  k=${k} ${summits} summits (n=${summits * 2}): ${rate.toFixed(3)}\n`,
      );
    }
  }
  process.stdout.write('\nF3, far band, a drag term understated by 1.5x\n');
  for (const summits of REPORTED_BAND_SIZES) {
    const rate = f3PassRate({ ...farBand(summits, 1), dragInflation: 1.5 });
    process.stdout.write(`  k=1 ${summits} summits (n=${summits * 2}): ${rate.toFixed(3)}\n`);
  }

  process.stdout.write('\nF4, shared terms (a correct app)\n');
  for (const summits of REPORTED_MOVEMENT_SIZES) {
    const rates = f4PassRates(summits);
    process.stdout.write(
      `  ${summits} summits (n=${summits * 2}): one movement ${rates.perMovement.toFixed(3)}, all four ${rates.allFour.toFixed(3)}\n`,
    );
  }
}

if (process.argv[1]?.endsWith('field-budget-simulation.ts') === true) main();
