/**
 * The data contract for computer-vision skyline alignment (archive/v2-docs-20260929/PLAN.md Phase 7).
 *
 * Naming follows `src/core/types.ts`, which is frozen: angles end in `Deg`,
 * heights in `M`, pixel quantities in `Px`. Two additions specific to this
 * module:
 *
 *   `…Norm`   a normalised image coordinate in [0,1], the same space
 *             `projectToImage` returns — x: 0 left, 1 right; y: 0 top, 1 bottom.
 *   `…01`     a unitless score clamped to [0,1].
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE HONESTY RULE THIS FILE ENFORCES IN THE TYPE SYSTEM
 * ─────────────────────────────────────────────────────────────────────────
 * The whole premise of this project is that it does not invent values. An
 * aligner that quietly returns `headingOffsetDeg: 0` when it failed is worse
 * than no aligner at all: it would leave every label exactly where the wrong
 * EXIF put it while claiming the photo had been checked. So the failure state
 * is a *different shape*, not a flag on the same shape — a caller that wants
 * `headingOffsetDeg` has to narrow the union first, and there is no member of
 * the failed variant that could be mistaken for an answer.
 */

import type { CameraPose } from '../core/types.js';

/**
 * A decoded image: 8-bit RGBA, row-major, top row first. Exactly the shape
 * `jpeg-js`'s `decode(bytes, { useTArray: true })` returns and exactly what
 * `CanvasRenderingContext2D.getImageData` returns, so neither a Node caller
 * nor a browser caller has to convert anything.
 *
 * `data.length` must be `width * height * 4`. Nothing in this module decodes
 * anything: `src/cv` is pixels in, numbers out (see README.md).
 */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

/**
 * What one image column reports about where the sky stops.
 *
 * `rowNorm` is `undefined` when the column is unreadable. That is a deliberate
 * gap rather than a best guess: a column of fog, or of blown-out sun, carries
 * no evidence about the skyline, and a plausible-looking row there would be
 * pure fabrication that the aligner would then weight and average in. The four
 * diagnostic factors are kept because when the extractor does badly the useful
 * question is always *which* factor collapsed.
 */
export interface SkylineColumn {
  /** Column centre in normalised image space, 0 = left edge, 1 = right edge. */
  readonly xNorm: number;
  /** Sky/terrain boundary, normalised (0 = top). `undefined` = unreadable. */
  readonly rowNorm: number | undefined;
  /** 0 = no evidence at all, 1 = an unambiguous, sharp, locally consistent edge. */
  readonly confidence01: number;
  /** Mean sky-affinity above the split minus mean below. Kills uniform columns. */
  readonly contrast: number;
  /** That contrast divided by the within-segment scatter. Kills noise and fog. */
  readonly snr: number;
  /** Local contrast across the chosen row ÷ global contrast. Kills soft gradients. */
  readonly edge01: number;
  /** Agreement with the robust local median row. Kills isolated cloud locks. */
  readonly agreement01: number;
}

/** The extracted skyline: one entry per sampled image column, left to right. */
export interface Skyline {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly columns: readonly SkylineColumn[];
  /** Fraction of columns that produced a row at all. */
  readonly coverage01: number;
  /** Mean confidence over the columns that produced a row. 0 when none did. */
  readonly meanConfidence01: number;
  /**
   * Confidence-weighted standard deviation of the skyline row, in normalised
   * image units. This is the "is there anything to lock onto" number on the
   * photograph's side: a dead-flat sea horizon reads ~0 here however crisp it
   * is, and no amount of correlation can recover a heading from it.
   */
  readonly reliefNorm: number;
}

/** Why an alignment could not be trusted. Every value is a distinct diagnosis. */
export type AlignmentFailureReason =
  /** Too few columns produced a readable skyline — fog, night, blown-out sky. */
  | 'insufficient-skyline'
  /** The photograph's skyline is essentially a straight line: nothing to lock onto. */
  | 'featureless-photo-skyline'
  /** The computed terrain profile is essentially flat over the frame: same problem. */
  | 'featureless-terrain-profile'
  /** The correlation landscape has no clear winner — several offsets fit equally. */
  | 'ambiguous-correlation'
  /** Nothing in the search range fits at all. The true offset may lie outside it. */
  | 'no-correlation'
  /** The best offset sits at the edge of the search window, so the peak may be outside. */
  | 'search-range-exhausted'
  /** An offset was found but the terrain does not actually lie on the photo's skyline. */
  | 'residual-too-large'
  /** The profile does not cover the bearings the frame sees. Terrain data, not CV. */
  | 'profile-does-not-cover-frame';

/**
 * Everything the search learned, reported whether it succeeded or not.
 *
 * These are the numbers to look at when asking "why did it say that", and they
 * are populated identically in both variants of {@link SkylineAlignment} — a
 * failure is not allowed to be a black box.
 */
export interface AlignmentDiagnostics {
  /** Columns that had a readable skyline AND a bearing the profile covers. */
  readonly usedColumnCount: number;
  /** …as a fraction of all sampled columns. */
  readonly usedFraction01: number;
  /** Weighted normalised cross-correlation at the reported offset, −1…1. */
  readonly score: number;
  /**
   * Best score minus the best score at least `peakExclusionDeg` away in
   * heading. A sharp, unique lock scores high here; fog and self-similar
   * ridgelines score near zero however good the peak value looks. This is the
   * measure that separates "found it" from "found something".
   */
  readonly margin: number;
  /** Weighted RMS of (photo skyline altitude − terrain profile altitude), degrees. */
  readonly residualRmsDeg: number;
  /** Weighted angular relief of the extracted skyline over the frame, degrees. */
  readonly photoReliefDeg: number;
  /** Weighted angular relief of the terrain profile over the same columns, degrees. */
  readonly profileReliefDeg: number;
  /** The heading window that was searched, degrees relative to the supplied pose. */
  readonly searchRangeDeg: readonly [number, number];
  /** True when the winning heading sat within one coarse step of a window edge. */
  readonly atSearchEdge: boolean;
}

/**
 * A successful — or successful-but-shaky — alignment.
 *
 * Both offsets are *additive corrections to the supplied pose*:
 *
 *     trueHeading = suppliedPose.headingDeg + headingOffsetDeg
 *     truePitch   = suppliedPose.pitchDeg   + pitchOffsetDeg
 *
 * `'low-confidence'` means the numbers are the best fit found but at least one
 * quality gate was not met; a caller should offer them as a suggestion, never
 * apply them silently.
 */
export interface SkylineAlignmentSolution {
  readonly status: 'aligned' | 'low-confidence';
  readonly headingOffsetDeg: number;
  readonly pitchOffsetDeg: number;
  /** The supplied pose with both offsets applied. Nothing else is changed. */
  readonly correctedCamera: CameraPose;
  /** Single summary number, the product of the individual quality gates. */
  readonly confidence01: number;
  /** Populated when `status` is `'low-confidence'`: which gates were missed. */
  readonly concerns: readonly AlignmentFailureReason[];
  readonly diagnostics: AlignmentDiagnostics;
}

/**
 * No trustworthy alignment. Deliberately carries **no offsets at all** — see
 * the honesty note at the top of this file.
 */
export interface SkylineAlignmentFailure {
  readonly status: 'failed';
  readonly reason: AlignmentFailureReason;
  /** Human-readable detail naming the number that failed and its threshold. */
  readonly detail: string;
  readonly diagnostics: AlignmentDiagnostics;
}

export type SkylineAlignment = SkylineAlignmentSolution | SkylineAlignmentFailure;

/** Narrowing helper so call sites never test the string literal themselves. */
export function isAligned(
  alignment: SkylineAlignment,
): alignment is SkylineAlignmentSolution {
  return alignment.status !== 'failed';
}
