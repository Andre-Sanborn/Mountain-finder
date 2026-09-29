/**
 * The real-world ground-truth cases (archive/v2-docs-20260929/PLAN.md P6.2).
 *
 * Four viewpoints, chosen so that between them they stress different parts of
 * the pipeline rather than four times the same part:
 *
 *   gornergrat         short range, high angles — geodesy and sign conventions
 *   mount-diablo       very long range, all NEGATIVE angles — curvature and k
 *   kerry-park-seattle near-field occlusion with a 6 deg margin — the easy block
 *   fort-william       near-field occlusion with a 1 deg margin — the hard block
 *
 * ───────────────────────────────────────────────────────────────────────────
 * AND, SEPARATELY, THE PHOTO CASES
 * ───────────────────────────────────────────────────────────────────────────
 * `photoCases` holds the two supplied Idaho photographs. They are a DIFFERENT
 * type — `PhotoCase`, not `GroundTruthCase` — because neither has a measured
 * view bearing and neither has a confirmed list of summits in frame, and
 * `GroundTruthCase` requires both (`view.bearingDeg: number`, and a non-empty
 * `mustBeVisible` that the suite gates on). They assert position, elevation,
 * terrain coverage and peak-dataset coverage; visibility is recorded as
 * unverified and asserted in NEITHER direction. See photo-case-types.ts.
 *
 * Keeping them out of `groundTruthCases` is deliberate: every gate that applies
 * to the four viewpoints above still applies to exactly those four, unweakened.
 */

import { fortWilliamCase } from './fort-william';
import { gornergratCase } from './gornergrat';
import { kerryParkSeattleCase } from './kerry-park-seattle';
import { mountDiabloSummitCase } from './mount-diablo-summit';
import { railroadRidgeCase } from './railroad-ridge';
import { sunsetMountainLookoutCase } from './sunset-mountain-lookout';
import type { GroundTruthCase } from './case-types';
import type { PhotoCase } from './photo-case-types';

export * from './case-types';
export * from './photo-case-types';
export { fortWilliamCase, gornergratCase, kerryParkSeattleCase, mountDiabloSummitCase };
export { railroadRidgeCase, sunsetMountainLookoutCase };

export const groundTruthCases: readonly GroundTruthCase[] = [
  gornergratCase,
  mountDiabloSummitCase,
  kerryParkSeattleCase,
  fortWilliamCase,
];

/** The supplied real photographs. Position asserted, frame unverified. */
export const photoCases: readonly PhotoCase[] = [
  sunsetMountainLookoutCase,
  railroadRidgeCase,
];
