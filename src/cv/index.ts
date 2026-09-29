/**
 * Public surface of the computer-vision skyline aligner (archive/v2-docs-20260929/PLAN.md Phase 7).
 *
 * Everything exported here is a deterministic function of its arguments —
 * pixels in, numbers out. No network, no DOM, no filesystem, no clock, no
 * `Math.random`. The same rule `src/core` lives by, for the same reason: a
 * function that cannot be run in a test is a function nobody has run.
 *
 * Decoding a JPEG is deliberately NOT part of this module. The caller hands
 * over an {@link RgbaImage} — which is exactly what `jpeg-js` and
 * `getImageData` both produce — so the same code runs in Node and in the
 * browser with no branch and no image library in the dependency graph.
 *
 * NOT wired into the app. The seam is `src/pipeline/cv-alignment.ts`; see
 * `README.md` in this directory for what integrating it would take and what
 * would have to be true first.
 */

export { extractSkyline } from './skyline.js';
export type { SkylineOptions } from './skyline.js';
export {
  CONTRAST_FLOOR,
  CONTRAST_REFERENCE,
  SNR_FLOOR,
  SNR_REFERENCE,
  READABLE_FLOOR,
  AGREEMENT_TOLERANCE_NORM,
  CONTINUITY_FREE_SLOPE,
  CONTINUITY_PENALTY,
} from './skyline.js';

export { alignSkyline } from './align.js';
export type { AlignOptions } from './align.js';
export {
  MIN_USED_FRACTION,
  GOOD_USED_FRACTION,
  MIN_RELIEF_DEG,
  GOOD_RELIEF_DEG,
  MIN_SCORE,
  GOOD_SCORE,
  MIN_MARGIN,
  GOOD_MARGIN,
  PEAK_EXCLUSION_DEG,
  MAX_RESIDUAL_DEG,
  GOOD_RESIDUAL_DEG,
} from './align.js';

export {
  applyPoseOffset,
  coversBearing,
  directionToSky,
  levelRightAxis,
  profileCoverage,
  rotateAboutAxis,
  rotateAboutVertical,
  unprojectFromImage,
} from './rays.js';
export type { ProfileCoverage, SkyDirection } from './rays.js';

export { assertImageShape, buildColumnSignals, skyAffinity } from './image.js';
export type { ColumnSignals } from './image.js';

export { isAligned } from './types.js';
export type {
  AlignmentDiagnostics,
  AlignmentFailureReason,
  RgbaImage,
  Skyline,
  SkylineAlignment,
  SkylineAlignmentFailure,
  SkylineAlignmentSolution,
  SkylineColumn,
} from './types.js';
