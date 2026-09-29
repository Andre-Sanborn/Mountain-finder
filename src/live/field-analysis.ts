/**
 * The field-capture bundle: its schema, its strict parser, and the grader that
 * reads the pre-registered verdicts out of it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * One field session produces a handful of camera frames, the pose each was
 * drawn at, and the overlay as it was actually drawn. Two independent agents
 * then locate each summit's apex in those frames. This module compares the two
 * and prints the criteria F2 to F5 from
 * `docs/FIELD-TEST-PREREGISTRATION.md`.
 *
 * It is pure: a parsed bundle and a parsed annotation set in, a table of
 * verdicts out. No clock, no filesystem, no DOM. `scripts/analyze-field.ts` is
 * the thin shell that loads two files and prints the table.
 *
 * ── THE THRESHOLDS ARE DATA, AND THEY ARE FIXED ─────────────────────────────
 * `PREREGISTERED_THRESHOLDS` is the table in § 2.3 of the pre-registration,
 * derived from the error budget in § 1.5 before any field number existed. The
 * grader takes no threshold argument, so a run cannot be graded against
 * anything else. Changing a number here changes it there, in the same commit,
 * with the reason.
 *
 * Each band carries a 2σ band and a 3σ limit, and the verdict is the band's
 * rather than the summit's: more than `MAX_TWO_SIGMA_EXCEEDANCES` summit-axes
 * past 2σ fails it, and one axis past 3σ fails it alone. Every summit is
 * reported against 2σ either way.
 *
 * A capture that reports its own fix accuracy is graded against the limits that
 * accuracy implies, by `bandLimitsFor` and the terms in `BUDGET_TERMS`. That can
 * only tighten a limit: a field number cannot buy itself more room than the
 * pre-registration allowed.
 *
 * ── PRIVACY: WHY NO POSITION, NO CLOCK, AND NO DISTANCES IN THE OUTPUT ──────
 * `AGENTS.md` § "Captures from the phone" allows orientation and motion events
 * only, with timestamps relative to the start of the capture. The parser here
 * goes further, because a field bundle holds more than sensor events.
 *
 * A distance and a bearing to a named summit IS a position fix. So:
 *   - the schema carries no bearings at all. The grader does not need them: the
 *     overlay's own pixel positions are what it compares, and the distance is
 *     needed only to choose a tolerance band.
 *   - `FieldReport` carries band labels, never distances, and a test asserts the
 *     rendered lines hold no distance and no bearing.
 *   - the camera frame is referenced by file name. The bytes stay beside the
 *     bundle, and the parser refuses an embedded image.
 *
 * What remains is stated rather than glossed: a set of distances to named
 * summits locates the observer, and the bundle holds those distances because
 * the tolerance depends on them. That is why a bundle travels only by the
 * human's own action to their own account, is never committed, and is never
 * attached to an issue.
 *
 * ── TRUTH HAS THREE ANSWERS, AND ONLY ONE OF THEM CONVICTS ─────────────────
 * Per summit per annotator: an apex pixel, `absent` with the reason the region
 * holds no summit, or `cannot-identify`. Only a summit both annotators call
 * `absent` counts against F5a's false-`visible` claim. One an annotator could
 * not identify is excluded from F3, F4 and F5a, and the count is reported.
 * Averaging a presence disagreement is never done: an `absent` against an apex
 * is `truth-disputed`.
 *
 * A summit whose committed position carries a sharp point feature may be marked
 * `landmark`, naming what the apex was taken from. The grader treats it as any
 * other apex and reports the landmark observations apart, because a mast is a
 * finer target than a rounded skyline.
 *
 * Each reading records what its annotator was given: the bare frame and the
 * names, or those plus the viewpoint and a topographic map. Neither method ever
 * includes the app's projection or the pose.
 *
 * ── THE COMPASS IS GRADED AT THE POSE AS WELL AS AT THE MARKERS ───────────
 * F2 on the drawn markers cannot see a gross compass error: a quarter-turn error
 * puts every summit where the annotators find nothing, and a re-anchor moves the
 * markers back onto the summits. So `F2.pose` compares the heading the compass
 * alone reported — the pose's heading less the fine trim and the gross re-anchor
 * offset, both of which every capture records — with the heading the located
 * summits solve for. It is graded whenever a before-drag capture holds two of
 * them, on the same displayed band the marker check is gated on.
 *
 * ── WHERE SUMMIT TRUTH COMES FROM ──────────────────────────────────────────
 * Not from the bundle. The bundle is written by the device under test, so
 * letting it supply the identity and height of a summit would let a wrong
 * import grade itself as correct. `PeakLookup` resolves each summit id against
 * the committed peak data, and a summit whose height in the bundle disagrees
 * with the committed value by more than a metre is a provenance failure
 * reported before any geometry is graded.
 *
 * ── TWO FRAMES, REGISTERED AND CHECKED SEPARATELY ──────────────────────────
 * A capture carries both. `overlayPx` is the viewport the overlay was drawn in,
 * and it is what the roll, field-of-view scale and drag terms were budgeted on
 * ({@link REGISTERED_VIEWPORT}, § 1.2). `framePx` is the stored camera frame,
 * and it decides only how finely two annotators can place an apex on it
 * ({@link REGISTERED_STORED_FRAME}, § 2.0), so it is checked for width and for
 * an aspect equal to the camera track's rather than against the viewport. The
 * two are different sizes on every real capture, because a phone letterboxes a
 * 16:9 stream into whatever viewport Safari leaves.
 *
 * ── AND THE SCREEN SHOWS PART OF ONE INSIDE THE OTHER ──────────────────────
 * The `<video>` is drawn at `object-fit: cover`, so the viewport holds a
 * CENTRED CROP of the camera frame: the frame is scaled by
 * `max(viewW/trackW, viewH/trackH)` and the overflow is cut evenly off the two
 * ends of whichever axis overflows. A 16:9 stream in the registered 956 × 440
 * viewport shows 81.8 % of the frame's height, and a 4:3 stream shows 75 % of
 * it. So a drawn marker goes through {@link overlayToFramePx} to reach the
 * space a truth apex is picked in, and the angles are taken with the whole
 * frame's field of view ({@link uncroppedFovDeg}) rather than the pose's, which
 * is the visible box's. Both steps reduce to the ratio of the two sizes when
 * the viewport and the frame share an aspect, which is the case a headless
 * rehearsal produces and no phone does.
 *
 * The crop is recoverable only from the camera track's size, so a capture that
 * records none is refused rather than graded on the guess that nothing was
 * cropped.
 *
 * ── THE SYNTHESISER IS AN INDEPENDENT INSTRUMENT ───────────────────────────
 * `synthesiseFieldBundle` builds bundles by placing a truth apex at a pixel and
 * displacing the drawn marker from it by a stated pixel offset. It never calls
 * the grader, and it does no angle arithmetic at all — the expected residual in
 * degrees is written out as a literal in the test, from the tangent relation.
 * `angularOffsetDeg` is cross-checked against `src/core`'s own `projectToImage`
 * in the test suite, so an inverted projection cannot cancel itself out between
 * the grader and the fixtures that grade it.
 */

import { cameraAxes, projectToImage } from '../core/projection';
import type { CameraPose, Peak } from '../core/types';

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 1 — The pre-registered thresholds
 * ══════════════════════════════════════════════════════════════════════════ */

/** The distance bands of the pre-registration's § 2.3 table, nearest first. */
export type BandId = 'near' | 'mid' | 'far' | 'distant' | 'horizon';

/** The two limits a residual is compared against, per axis. */
export interface BandLimits {
  readonly band: BandId;
  /** 2σ of the budget. A residual past it is one reportable exceedance. */
  readonly horizontalDeg: number;
  readonly verticalDeg: number;
  /** 3σ. One residual past it fails the band on its own. */
  readonly horizontal3SigmaDeg: number;
  readonly vertical3SigmaDeg: number;
}

export interface BandThreshold extends BandLimits {
  /** Inclusive lower bound, km. The `near` band starts at 0. */
  readonly fromKm: number;
  /** Exclusive upper bound, km. `Infinity` for `horizon`. */
  readonly toKm: number;
  /** The distance § 1.5 of the pre-registration computed this band's budget at. */
  readonly budgetDistanceKm: number;
}

/**
 * The F3 and F4 limits: 2σ of the error budget rounded to 0.05°, and 3σ at
 * 1.5 × that, rounded up to 0.05°.
 *
 * The last three bands carry the same figure because the budget is flat beyond
 * 7 km — the drag, the roll and the field-of-view scale do not care how far a
 * summit is, and beyond 7 km they are the whole budget. They stay separate rows
 * so the result reports how many summits each band actually held.
 */
export const PREREGISTERED_THRESHOLDS: readonly BandThreshold[] = [
  {
    band: 'near',
    fromKm: 0,
    toKm: 3,
    budgetDistanceKm: 2,
    horizontalDeg: 1.9,
    verticalDeg: 1.45,
    horizontal3SigmaDeg: 2.85,
    vertical3SigmaDeg: 2.2,
  },
  {
    band: 'mid',
    fromKm: 3,
    toKm: 7,
    budgetDistanceKm: 5,
    horizontalDeg: 1.4,
    verticalDeg: 1.3,
    horizontal3SigmaDeg: 2.1,
    vertical3SigmaDeg: 1.95,
  },
  {
    band: 'far',
    fromKm: 7,
    toKm: 20,
    budgetDistanceKm: 10,
    horizontalDeg: 1.3,
    verticalDeg: 1.3,
    horizontal3SigmaDeg: 1.95,
    vertical3SigmaDeg: 1.95,
  },
  {
    band: 'distant',
    fromKm: 20,
    toKm: 45,
    budgetDistanceKm: 30,
    horizontalDeg: 1.3,
    verticalDeg: 1.3,
    horizontal3SigmaDeg: 1.95,
    vertical3SigmaDeg: 1.95,
  },
  {
    band: 'horizon',
    fromKm: 45,
    toKm: Infinity,
    budgetDistanceKm: 60,
    horizontalDeg: 1.3,
    verticalDeg: 1.3,
    horizontal3SigmaDeg: 1.95,
    vertical3SigmaDeg: 1.95,
  },
];

/**
 * How many summit-axes in one band may sit past 2σ and the band still pass.
 *
 * One. At 2σ a correct budget puts 4.55 % of axis draws outside, so "every axis
 * inside 2σ" passes a correct budget with probability 0.9545^n — 0.225 at the
 * 32 axis draws two or three captures produce. A gate that a correct budget
 * fails three times in four measures the sample size. Tolerating one exceedance
 * while refusing any 3σ excursion passes 0.936 at n = 8 and 0.815 at n = 16
 * (pre-registration § 2.3).
 */
export const MAX_TWO_SIGMA_EXCEEDANCES = 1;

/**
 * Fewest graded summits a band needs before its verdict may be a pass.
 *
 * The stop rule of § 2.0. A band whose truth yields one or two graded summits is
 * reported `no-sample`, and the report says the truth instrument rather than the
 * app limited it — the app drew summits there and the annotators could not
 * settle enough of them. Three is the smallest count at which the exceedance
 * gate can distinguish "one draw was unlucky" from "the band is wrong": at n = 1
 * or 2 the gate tolerates every outcome short of a 3σ excursion, so a pass
 * reports the sample rather than the app.
 *
 * **A band that fails the gate still fails**, however few summits it holds. One
 * summit past 3σ refutes the budget on its own, and § 2.0 is explicit that this
 * session can refute the budget and cannot confirm it. The stop rule withholds
 * the confirmation, never the refutation.
 */
export const MIN_GRADED_PER_BAND = 3;

/**
 * Widest apex disagreement between the two annotators that still permits a
 * grade, degrees. A quarter of the tightest F3 threshold: truth four times
 * finer than the tolerance is the least that makes a verdict mean anything.
 */
export const MAX_TRUTH_DISAGREEMENT_DEG = 0.3;

/**
 * The 1σ terms of § 1.3, in the units the document states them in.
 *
 * They are here so a capture that reports its own fix accuracy can be graded
 * against the budget that accuracy implies, and so the registered table above is
 * reproducible from the terms rather than only asserted. A test rebuilds § 1.5's
 * 1σ column from them.
 */
export const BUDGET_TERMS = {
  /** Term 1, Overture cross-release RMS rounded up. */
  peakPositionM: 20,
  /** Term 2, RMS against 15 independently cited heights. */
  summitElevationM: 5.5,
  /** Term 3a when the capture reports none, from the Railroad Ridge n = 1. */
  observerPositionM: 15,
  /** Term 3b under the DEM-ground choice. */
  observerHeightM: 10,
  /** The band § 1.1 charges the drag anchor at. */
  anchorDistanceKm: 10,
  /** Term 6 at the frame edge, calibrated. */
  fovHorizontalDeg: 0.275,
  fovVerticalDeg: 0.039,
  /** Term 7 at the frame edge, braced. */
  rollHorizontalDeg: 0.034,
  rollVerticalDeg: 0.322,
  /** Term 9, 1 mm of finger. Both axes. */
  dragDeg: 0.543,
} as const;

/**
 * What a reported horizontal accuracy means, and the divisor that follows.
 *
 * The W3C position API defines the figure as a horizontal radius at a 95 %
 * confidence level. For a circular bivariate normal the radius holding 95 % of
 * draws is `σ·sqrt(−2·ln 0.05)`, about 2.45σ, so the per-axis 1σ is the reported
 * radius over that. Apple states no confidence level of its own, and iOS Safari
 * implements the W3C API, so a Safari capture is read under the W3C convention.
 * See § 1.3 term 3a of the pre-registration for the sources and the sensitivity.
 */
export const ACCURACY_CONFIDENCE = 'w3c-95-percent-horizontal-radius';

/** A 95 % circular radius to a per-axis 1σ. */
export const ACCURACY_SIGMA_DIVISOR = Math.sqrt(-2 * Math.log(0.05));

/** Reported fix accuracy above this refuses the capture, metres (term 3a). */
export const MAX_OBSERVER_ACCURACY_M = 30;

/** Per-axis 1σ of the observer's horizontal position from a reported radius. */
export function observerSigmaFromAccuracyM(accuracyM: number): number {
  return accuracyM / ACCURACY_SIGMA_DIVISOR;
}

const DEG_PER_RAD = 180 / Math.PI;

/** Rounded up to the next 0.05°, the granularity every registered limit uses. */
function roundUpToStep(deg: number): number {
  const steps = Math.ceil(deg / 0.05 - 1e-9);
  return Math.round(steps * 0.05 * 100) / 100;
}

function metresAsDeg(metres: number, distanceKm: number): number {
  return (metres / (distanceKm * 1000)) * DEG_PER_RAD;
}

/**
 * The band's per-summit 1σ, on both axes: § 1.5 of the pre-registration.
 *
 * Every term is charged at the frame edge, with the anchor's own error charged at
 * {@link BUDGET_TERMS}.anchorDistanceKm, and they are combined by RSS under the
 * independence argument of § 1.4.
 */
export function bandSigmaFor(
  threshold: BandThreshold,
  observerPositionM: number = BUDGET_TERMS.observerPositionM,
): { readonly horizontalDeg: number; readonly verticalDeg: number } {
  const t = BUDGET_TERMS;
  const geodesyHorizontalM = Math.hypot(t.peakPositionM, observerPositionM);
  const geodesyVerticalM = Math.hypot(t.summitElevationM, t.observerHeightM);
  return {
    horizontalDeg: Math.hypot(
      metresAsDeg(geodesyHorizontalM, threshold.budgetDistanceKm),
      metresAsDeg(geodesyHorizontalM, t.anchorDistanceKm),
      t.fovHorizontalDeg,
      t.rollHorizontalDeg,
      t.dragDeg,
    ),
    verticalDeg: Math.hypot(
      metresAsDeg(geodesyVerticalM, threshold.budgetDistanceKm),
      metresAsDeg(geodesyVerticalM, t.anchorDistanceKm),
      t.fovVerticalDeg,
      t.rollVerticalDeg,
      t.dragDeg,
    ),
  };
}

/**
 * The limits a band is graded against, given what is known about the fix.
 *
 * With no reported accuracy this returns the registered row unchanged. With one,
 * term 3a becomes the fix's own per-axis 1σ, the band's 1σ is recomputed and the
 * limits follow — but only where that **tightens** them. A measured accuracy can
 * narrow a tolerance and never widen one, so no field number can buy itself more
 * room than the pre-registration allowed.
 */
export function bandLimitsFor(
  threshold: BandThreshold,
  observerAccuracyM?: number,
): BandLimits {
  if (observerAccuracyM === undefined) return threshold;
  const sigma = bandSigmaFor(threshold, observerSigmaFromAccuracyM(observerAccuracyM));
  const horizontalDeg = Math.min(roundUpToStep(2 * sigma.horizontalDeg), threshold.horizontalDeg);
  const verticalDeg = Math.min(roundUpToStep(2 * sigma.verticalDeg), threshold.verticalDeg);
  return {
    band: threshold.band,
    horizontalDeg,
    verticalDeg,
    horizontal3SigmaDeg: Math.min(
      roundUpToStep(1.5 * horizontalDeg),
      threshold.horizontal3SigmaDeg,
    ),
    vertical3SigmaDeg: Math.min(roundUpToStep(1.5 * verticalDeg), threshold.vertical3SigmaDeg),
  };
}

/**
 * How far into the half-frame the anchor summit must sit for an F4 pan.
 *
 * The registered movement is "pan until the anchor summit is at the frame edge",
 * which a person can see on screen; 0.8 of the half-frame is what counts as the
 * edge. At u = 0.8 the field-of-view scale term is 0.253° of the 0.275°
 * available at u = 1, so the pan exercises 92 % of it.
 */
export const PAN_ANCHOR_EDGE_OFFSET = 0.8;

/** How far a tilt may stray from the registered ±10° and still be graded. */
export const TILT_ENVELOPE_DEG = { min: 5, max: 15 } as const;

/**
 * The viewport the budget was computed on, § 1.2 of the pre-registration.
 *
 * Two frames matter and they are different sizes. This is the one the overlay is
 * DRAWN in, and it is what the roll and field-of-view terms were budgeted on:
 * both scale with the drawn offset from the optical axis, and the drag's own
 * precision is a finger against this frame's px-per-degree.
 * {@link REGISTERED_STORED_FRAME} is the other one.
 */
export const REGISTERED_VIEWPORT = { hFovDeg: 73.74, aspectRatio: 956 / 440 } as const;

/** Fractional deviation from {@link REGISTERED_VIEWPORT} that is worth reporting. */
export const FRAME_DEVIATION_TOLERANCE = 0.1;

/**
 * The stored camera frame, § 2.0 of the pre-registration.
 *
 * The stored frame carries no budget term. It decides one thing: how finely two
 * annotators can place an apex on it. So it is registered as a floor on width
 * and as an aspect that must match the camera track's, which is what says the
 * frame was stored whole rather than cropped or stretched.
 *
 * The aspect tolerance is 2 % because a stored height is a whole number of
 * pixels: at 1920 px wide the rounding is at most 0.5/1080, under 0.05 %. Any
 * real crop is far larger — 4:3 against 16:9 is 33 % — so 2 % separates rounding
 * from a changed frame without pretending to a precision the rounding denies.
 */
export const REGISTERED_STORED_FRAME = { minWidthPx: 1920, aspectTolerance: 0.02 } as const;

/** How many of the most prominent predicted summits F5b requires a name on. */
export const PROMINENT_LABEL_COUNT = 3;

/** Largest height disagreement between bundle and committed peak data, metres. */
export const MAX_ELEVATION_DISAGREEMENT_M = 1;

/**
 * The band a distance falls in. Lower bound inclusive, upper bound exclusive,
 * so a summit exactly 3 km away is graded against `mid` rather than `near` —
 * the tighter of the two, which is the safe direction for a boundary.
 */
export function bandFor(distanceKm: number): BandThreshold | undefined {
  return PREREGISTERED_THRESHOLDS.find(
    (threshold) => distanceKm >= threshold.fromKm && distanceKm < threshold.toKm,
  );
}

/**
 * Whether a residual is inside a band's 2σ band, on both axes.
 *
 * One implementation, called by every criterion that grades a position, so the
 * boundary cannot be `<=` in one place and `<` in another. The comparison is
 * inclusive: a residual exactly at the limit is inside, because the limit is a
 * stated bound rather than a value the budget excludes.
 */
export function withinThreshold(residual: Residual, threshold: BandLimits): boolean {
  return (
    Math.abs(residual.horizontalDeg) <= threshold.horizontalDeg &&
    Math.abs(residual.verticalDeg) <= threshold.verticalDeg
  );
}

/** One axis of one summit, against the 2σ band and the 3σ limit. */
export interface AxisExceedance {
  readonly axis: 'across' | 'up/down';
  readonly errorDeg: number;
  readonly twoSigmaDeg: number;
  readonly threeSigmaDeg: number;
  readonly overTwoSigma: boolean;
  readonly overThreeSigma: boolean;
}

/**
 * Both axes of one summit, classified.
 *
 * The band's verdict counts these: more than {@link MAX_TWO_SIGMA_EXCEEDANCES}
 * axes past 2σ fails it, and one axis past 3σ fails it alone.
 */
export function exceedancesOf(
  residual: Residual,
  limits: BandLimits,
): readonly AxisExceedance[] {
  const axes: readonly {
    readonly axis: 'across' | 'up/down';
    readonly errorDeg: number;
    readonly twoSigmaDeg: number;
    readonly threeSigmaDeg: number;
  }[] = [
    {
      axis: 'across',
      errorDeg: Math.abs(residual.horizontalDeg),
      twoSigmaDeg: limits.horizontalDeg,
      threeSigmaDeg: limits.horizontal3SigmaDeg,
    },
    {
      axis: 'up/down',
      errorDeg: Math.abs(residual.verticalDeg),
      twoSigmaDeg: limits.verticalDeg,
      threeSigmaDeg: limits.vertical3SigmaDeg,
    },
  ];
  return axes.map((axis) => ({
    ...axis,
    overTwoSigma: axis.errorDeg > axis.twoSigmaDeg,
    overThreeSigma: axis.errorDeg > axis.threeSigmaDeg,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 2 — The bundle schema
 * ══════════════════════════════════════════════════════════════════════════ */

/** Format tag. Bumped when a reader would misread an older file. */
export const BUNDLE_FORMAT = 'mountain-finder/field-bundle@1';

/** Format tag of the separate truth-annotation document. */
export const TRUTH_FORMAT = 'mountain-finder/field-apex-truth@2';

/**
 * The format that wrote `apexPx: null` for everything an annotator did not
 * locate. It is refused rather than read, and the refusal says what to write
 * instead: `null` conflated "the summit is not there" with "I cannot tell",
 * and those two answers grade in opposite directions.
 */
export const SUPERSEDED_TRUTH_FORMAT = 'mountain-finder/field-apex-truth@1';

/** The only timestamp basis either format permits. */
export const TIMESTAMP_BASIS = 'ms-since-session-start';

/** What a capture is for, which decides which criteria grade it. */
export const CAPTURE_ROLES = ['before-drag', 'after-drag', 'moved'] as const;
export type CaptureRole = (typeof CAPTURE_ROLES)[number];

/** A pixel in the stored camera frame. Origin top-left, x right, y down. */
export interface PixelPoint {
  readonly xPx: number;
  readonly yPx: number;
}

/**
 * A summit as the overlay drew it.
 *
 * `summitPx` is in the overlay's own drawing space, which is the CSS viewport
 * rather than the stored frame; `Capture.overlayPx`, `Capture.framePx` and
 * `Capture.track` are what the grader maps between them with. No bearing is
 * carried; see this file's header.
 */
export interface DrawnSummit {
  readonly summitId: string;
  readonly name: string;
  readonly elevationM: number;
  readonly distanceKm: number;
  /** Apparent height above the horizontal, degrees. F5b ranks on this. */
  readonly altitudeDeg: number;
  readonly visibility: 'visible' | 'marginal' | 'self-occluded';
  readonly summitPx: PixelPoint;
  /** False for a summit that got a dot but no name, i.e. crowded out. */
  readonly labelled: boolean;
}

/**
 * A summit the overlay held back, and why.
 *
 * `unmeasured` is the one F5c grades: a summit beyond the swept terrain gets no
 * verdict at all. The others are carried so the report can say what happened to
 * a summit an annotator found but the overlay never drew.
 */
export interface WithheldSummit {
  readonly summitId: string;
  readonly name: string;
  readonly distanceKm: number;
  readonly reason: 'unmeasured' | 'off-frame' | 'foreground-occluded';
}

/** The overlay as drawn, reduced to what a grader needs. */
export interface DrawnOverlay {
  readonly drawn: readonly DrawnSummit[];
  readonly withheld: readonly WithheldSummit[];
}

/**
 * The uncertainty band the screen displayed, in the app's own terms.
 *
 * `hasUnquantifiedHorizontal` and its vertical twin are what make F2's gate
 * conditional: a band with an unquantified term is a floor, which `summarise`
 * already says on screen, and a floor cannot be exceeded.
 */
export interface DisplayedBand {
  readonly horizontalDeg: number;
  readonly verticalDeg: number;
  readonly hasUnquantifiedHorizontal: boolean;
  readonly hasUnquantifiedVertical: boolean;
}

/**
 * What set a capture's gross heading offset.
 *
 * `'sensors'` means nobody re-anchored and the offset is zero. The other two
 * name the reference the person tapped, which is what tells a reader whether a
 * quarter-turn correction came from the Sun's computed azimuth or from a summit
 * they picked by name.
 */
export const GROSS_HEADING_SOURCES = ['sensors', 'sun', 'summit'] as const;
export type GrossHeadingSource = (typeof GROSS_HEADING_SOURCES)[number];

/**
 * The pose the overlay was drawn at, plus the trim the user had dragged in.
 *
 * `headingDeg` is what the overlay was drawn with: the compass reading plus
 * `trimHeadingDeg` plus `grossHeadingOffsetDeg`. Subtracting the last two gives
 * the raw sensed heading back, which is what {@link gradeF2Pose} grades. Both
 * gross fields are required rather than optional, because a capture that omits
 * them is one where a 92° re-anchor cannot be told from a compass that was
 * right, and that is the difference the pose-level check exists to measure.
 */
export interface CapturePose {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
  readonly hFovDeg: number;
  readonly vFovDeg: number;
  readonly headingBasis: 'true' | 'true-model' | 'magnetic';
  readonly trimHeadingDeg: number;
  readonly trimPitchDeg: number;
  /** The re-anchor's heading correction, degrees. Zero when none was made. */
  readonly grossHeadingOffsetDeg: number;
  readonly grossHeadingSource: GrossHeadingSource;
}

/**
 * What the sensor trace did over the capture second.
 *
 * `stillForMs` is what earns the exclusion of the heading-smoothing lag from
 * the budget: the 400 ms smoothing time constant decays to under 0.06° after
 * 2 s of stillness, and a capture that was not still for that long is graded
 * with the shortfall reported.
 */
export interface CaptureTrace {
  readonly headingSpreadDeg: number;
  readonly pitchSpreadDeg: number;
  readonly rollSpreadDeg: number;
  readonly sampleCount: number;
  readonly stillForMs: number;
  readonly compassAccuracyDeg?: number;
  /** Overlay re-projection ticks in the capture second, for F1's rate floor. */
  readonly tickCount?: number;
  readonly longestTickGapMs?: number;
}

/** A `MediaStreamTrack.getSettings()` snapshot, with the identifiers removed. */
export interface TrackGeometry {
  readonly width: number;
  readonly height: number;
  readonly frameRate?: number;
  readonly facingMode?: string;
  readonly resizeMode?: string;
  readonly zoom?: number;
}

/** One camera frame, and everything the app knew when it drew over it. */
export interface Capture {
  readonly captureId: string;
  readonly role: CaptureRole;
  /** Milliseconds since the start of the session. Never a wall clock. */
  readonly tMs: number;
  /**
   * File name of the camera frame, beside the bundle. A plain relative name:
   * no directory, no traversal, and never the bytes themselves.
   */
  readonly framePath: string;
  /** Stored frame size. The truth apexes are in this space. */
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
  /** The overlay's drawing space, i.e. the CSS viewport. */
  readonly overlayPx: { readonly widthPx: number; readonly heightPx: number };
  readonly pose: CapturePose;
  readonly trace: CaptureTrace;
  readonly track: TrackGeometry;
  readonly fovSource: 'calibrated' | 'spec-sheet-guess';
  /** Radius of the terrain sweep behind this overlay, km. F5c needs it. */
  readonly sweepRadiusKm: number;
  readonly band: DisplayedBand;
  readonly overlay: DrawnOverlay;
  /** The summit the drag was anchored on. Absent on a before-drag capture. */
  readonly dragAnchorSummitId?: string;
  /** For a `moved` capture: which after-drag capture it moved from. */
  readonly movedFromCaptureId?: string;
  readonly panFromReferenceDeg?: number;
  readonly tiltFromReferenceDeg?: number;
  /**
   * The platform's own horizontal accuracy for the fix this capture was drawn
   * at, metres, as reported. Read under the bundle's `accuracyConvention`, which
   * is required whenever this is present: a radius without its confidence level
   * is not a σ. Above {@link MAX_OBSERVER_ACCURACY_M} the capture is refused.
   *
   * It is a single number and it names no place. The parser still refuses
   * `accuracy` inside any `coords` or `position` wrapper, which is the shape
   * that would carry a fix.
   */
  readonly horizontalAccuracyM?: number;
  readonly note?: string;
}

/** A whole field session. */
export interface FieldBundle {
  readonly format: typeof BUNDLE_FORMAT;
  readonly timestampBasis: typeof TIMESTAMP_BASIS;
  /**
   * What every `horizontalAccuracyM` in this bundle means. Only
   * {@link ACCURACY_CONFIDENCE} is accepted, so the budget's conversion to 1σ
   * cannot be applied to a number that meant something else.
   */
  readonly accuracyConvention?: typeof ACCURACY_CONFIDENCE;
  /** `navigator.userAgent`, verbatim. Names the browser the verdicts apply to. */
  readonly device: string;
  /** Which committed peak regions the app had loaded. Public identifiers. */
  readonly peakRegions: readonly string[];
  readonly captures: readonly Capture[];
  readonly note?: string;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 3 — The truth-annotation schema
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Why an annotator says a summit is not in the frame.
 *
 * Both are claims about a region of the picture the annotator looked at and
 * found summit-free, which is what F5a needs. `clear-sky` is the region showing
 * sky; `foreground-blocked` is a nearer object standing in front of it. An
 * annotator who cannot make either claim reports `cannotIdentify` instead.
 */
export const ABSENT_REASONS = ['clear-sky', 'foreground-blocked'] as const;
export type AbsentReason = (typeof ABSENT_REASONS)[number];

/** What an annotator was given before they looked at the frame. */
export const ANNOTATOR_METHODS = ['bare-frame', 'frame-and-map'] as const;
export type AnnotatorMethod = (typeof ANNOTATOR_METHODS)[number];

/** What each method means, for the report. */
export const ANNOTATOR_METHOD_DESCRIPTIONS: Readonly<Record<AnnotatorMethod, string>> = {
  'bare-frame': 'the bare frame and the candidate summit names, nothing else',
  'frame-and-map':
    'the bare frame, the candidate summit names, the viewpoint and a topographic map — never the app’s projection and never the pose',
};

/**
 * One annotator's reading of one summit in one frame. Exactly one of three
 * answers, and each is a positive claim.
 *
 * `apex` locates the summit. `absent` says the region where the summit would sit
 * holds no summit, and names which of {@link ABSENT_REASONS} it holds instead.
 * `cannot-identify` says the annotator could not decide either way — a haze, a
 * crowded ridge line, an unresolvable foothill.
 *
 * Only `absent` can convict the app of a false `visible`. Separating the two is
 * what stops an unidentifiable foothill being graded as a mountain that is not
 * there.
 */
export type ApexAnnotation =
  | {
      readonly summitId: string;
      readonly apexPx: PixelPoint;
      /**
       * The point feature the apex was taken from, when the brief named one —
       * a mast, a lookout, a notch. Present only when the annotator marked it.
       */
      readonly landmark?: string;
      readonly note?: string;
    }
  | {
      readonly summitId: string;
      readonly absent: true;
      readonly reason: AbsentReason;
      readonly note?: string;
    }
  | {
      readonly summitId: string;
      readonly cannotIdentify: true;
      readonly note?: string;
    };

/** Which of the three answers an annotation is. */
export function apexAnswer(
  annotation: ApexAnnotation,
): 'apex' | 'absent' | 'cannot-identify' {
  if ('apexPx' in annotation) return 'apex';
  if ('absent' in annotation) return 'absent';
  return 'cannot-identify';
}

export interface AnnotatorReading {
  /** Stable annotator id, e.g. `agent-a`. Never a person's name. */
  readonly annotatorId: string;
  /** What this annotator was given. Both methods are allowed; the report says which. */
  readonly method: AnnotatorMethod;
  readonly apexes: readonly ApexAnnotation[];
}

export interface CaptureTruth {
  readonly captureId: string;
  readonly readings: readonly AnnotatorReading[];
}

/** The apex truth for a whole session, from two independent annotators. */
export interface FieldTruth {
  readonly format: typeof TRUTH_FORMAT;
  /** How the annotation was run, in prose. Each annotator's own method is on its reading. */
  readonly procedure: string;
  readonly captures: readonly CaptureTruth[];
}

/** Exactly two independent readings per capture, per § 2.0 of the prereg. */
export const REQUIRED_ANNOTATORS = 2;

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 4 — The strict parser
 * ══════════════════════════════════════════════════════════════════════════ */

/** One reason a document was rejected, with the path that carries it. */
export interface BundleProblem {
  readonly path: string;
  readonly message: string;
}

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly problems: readonly BundleProblem[] };

/**
 * Keys that convict a document outright, whatever else is in it.
 *
 * The exact-key whitelists below already reject every one of these as unknown.
 * The list is here anyway for two reasons: it names the rule that was broken
 * instead of saying "unexpected key", and it keeps holding if a later revision
 * widens a whitelist by accident.
 */
const FORBIDDEN_KEYS: Readonly<Record<string, string>> = {
  geolocation: 'geolocation data has no place in a field bundle',
  coords: 'a GeolocationPosition.coords wrapper',
  position: 'a position fix',
  latitude: 'a coordinate',
  longitude: 'a coordinate',
  lat: 'a coordinate',
  lon: 'a coordinate',
  lng: 'a coordinate',
  gps: 'a position fix',
  altitudeaccuracy: 'a position fix',
  bearingdeg: 'a bearing to a named summit, which with its distance is a position fix',
  bearing: 'a bearing to a named summit, which with its distance is a position fix',
  azimuthdeg: 'a bearing to a named summit',
  observer: 'the observer position',
  viewpoint: 'the observer position',
  siteid: 'the committed site definition names a viewpoint',
  deviceid: 'an identifier for one handset',
  groupid: 'an identifier for one handset',
  label: "a camera device's label identifies one handset",
  timestamp: 'a timestamp key; relative offsets are named tMs',
  time: 'a timestamp key; relative offsets are named tMs',
  date: 'a wall-clock date',
  utc: 'a wall clock',
  image: 'a camera frame',
  frame: 'a camera frame',
  photo: 'a camera frame',
  dataurl: 'an embedded camera frame',
  base64: 'an embedded camera frame',
  bytes: 'an embedded camera frame',
};

/** Key shapes that carry a wall clock whatever their prefix. */
const FORBIDDEN_KEY_PATTERNS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /epoch/i, why: 'an epoch timestamp' },
  { pattern: /unix/i, why: 'an epoch timestamp' },
  { pattern: /wallclock/i, why: 'a wall clock' },
  // `capturedAt`, `startedAt`, `recordedAt`. Case-sensitive, so `format` is safe.
  { pattern: /At$/, why: 'a wall-clock instant' },
  {
    pattern: /^accuracy$/i,
    why: "a fix's own accuracy field; a capture names its figure horizontalAccuracyM, under the bundle-level convention",
  },
];

/**
 * Smallest magnitude treated as an epoch rather than an offset. 1e9 ms is 12
 * days and 1e9 s is 2001, so every epoch in seconds or milliseconds from 2001
 * onward is caught, while the longest plausible session — an hour, 3.6e6 ms —
 * is two orders of magnitude below it.
 */
export const EPOCH_FLOOR = 1e9;

/** An ISO 8601 date, with or without a time of day. */
const ISO_DATE = /\d{4}-[01]\d-[0-3]\d/;

/**
 * Longest string the document may hold. A base64 frame smuggled into a free-text
 * field would pass every key rule, and 4 kB is far more than any note needs.
 */
export const MAX_STRING_LENGTH = 4096;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walk the raw document and collect every forbidden key, every absolute-time
 * value and every string long enough to hide an image.
 *
 * This runs BEFORE the structural parse, over the document as written, so a
 * banned key nested inside something the structural parse would have ignored is
 * still reported.
 */
export function findForbiddenContent(raw: unknown): readonly BundleProblem[] {
  const problems: BundleProblem[] = [];

  const visit = (value: unknown, path: string): void => {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        problems.push({ path, message: 'not a finite number' });
      } else if (Math.abs(value) >= EPOCH_FLOOR) {
        problems.push({
          path,
          message: `${value} is at least ${EPOCH_FLOOR}, the shape of an absolute epoch timestamp; timestamps are relative to the start of the session`,
        });
      }
      return;
    }
    if (typeof value === 'string') {
      if (ISO_DATE.test(value)) {
        problems.push({ path, message: 'holds an ISO 8601 date, which is a wall clock' });
      }
      if (value.length > MAX_STRING_LENGTH) {
        problems.push({
          path,
          message: `${value.length} characters, over the ${MAX_STRING_LENGTH} limit; a string this long can hide an encoded camera frame`,
        });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isRecord(value)) return;
    for (const [key, child] of Object.entries(value)) {
      const childPath = path === '' ? key : `${path}.${key}`;
      const banned = FORBIDDEN_KEYS[key.toLowerCase()];
      if (banned !== undefined) {
        problems.push({ path: childPath, message: `forbidden key: ${banned}` });
      }
      for (const { pattern, why } of FORBIDDEN_KEY_PATTERNS) {
        if (pattern.test(key)) {
          problems.push({ path: childPath, message: `forbidden key shape: ${why}` });
        }
      }
      visit(child, childPath);
    }
  };

  visit(raw, '');
  return problems;
}

/** Collects problems while the structural parse walks the document. */
class Problems {
  readonly list: BundleProblem[] = [];

  add(path: string, message: string): undefined {
    this.list.push({ path, message });
    return undefined;
  }
}

function checkKeys(
  p: Problems,
  path: string,
  obj: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      p.add(
        path === '' ? key : `${path}.${key}`,
        `unknown key; allowed here: ${allowed.join(', ')}`,
      );
    }
  }
}

function asRecord(p: Problems, path: string, value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : p.add(path, 'expected an object');
}

function asArray(p: Problems, path: string, value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : p.add(path, 'expected an array');
}

interface NumberBounds {
  readonly min?: number;
  readonly max?: number;
}

function asNumber(
  p: Problems,
  path: string,
  value: unknown,
  bounds: NumberBounds = {},
): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return p.add(path, 'expected a finite number');
  }
  if (bounds.min !== undefined && value < bounds.min) {
    return p.add(path, `${value} is below the allowed minimum ${bounds.min}`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    return p.add(path, `${value} is above the allowed maximum ${bounds.max}`);
  }
  return value;
}

function asOptionalNumber(
  p: Problems,
  path: string,
  present: boolean,
  value: unknown,
  bounds: NumberBounds = {},
): number | undefined {
  if (!present) return undefined;
  return asNumber(p, path, value, bounds);
}

function asString(p: Problems, path: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return p.add(path, 'expected a non-empty string');
  }
  return value;
}

function asBoolean(p: Problems, path: string, value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') return p.add(path, 'expected true or false');
  return value;
}

function asMember<T extends string>(
  p: Problems,
  path: string,
  value: unknown,
  allowed: readonly T[],
): T | undefined {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    return p.add(path, `expected one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

const PIXEL_KEYS = ['xPx', 'yPx'] as const;

function asPixelPoint(p: Problems, path: string, value: unknown): PixelPoint | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, PIXEL_KEYS);
  const xPx = asNumber(p, `${path}.xPx`, obj.xPx);
  const yPx = asNumber(p, `${path}.yPx`, obj.yPx);
  if (xPx === undefined || yPx === undefined) return undefined;
  return { xPx, yPx };
}

const SIZE_KEYS = ['widthPx', 'heightPx'] as const;

function asSize(
  p: Problems,
  path: string,
  value: unknown,
): { readonly widthPx: number; readonly heightPx: number } | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, SIZE_KEYS);
  const widthPx = asNumber(p, `${path}.widthPx`, obj.widthPx, { min: 1 });
  const heightPx = asNumber(p, `${path}.heightPx`, obj.heightPx, { min: 1 });
  if (widthPx === undefined || heightPx === undefined) return undefined;
  return { widthPx, heightPx };
}

const DRAWN_KEYS = [
  'summitId',
  'name',
  'elevationM',
  'distanceKm',
  'altitudeDeg',
  'visibility',
  'summitPx',
  'labelled',
] as const;

const DRAWN_VISIBILITIES = ['visible', 'marginal', 'self-occluded'] as const;

function parseDrawnSummit(p: Problems, path: string, value: unknown): DrawnSummit | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, DRAWN_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  const name = asString(p, `${path}.name`, obj.name);
  const elevationM = asNumber(p, `${path}.elevationM`, obj.elevationM, { min: -500, max: 9000 });
  const distanceKm = asNumber(p, `${path}.distanceKm`, obj.distanceKm, { min: 0, max: 400 });
  const altitudeDeg = asNumber(p, `${path}.altitudeDeg`, obj.altitudeDeg, { min: -90, max: 90 });
  const visibility = asMember(p, `${path}.visibility`, obj.visibility, DRAWN_VISIBILITIES);
  const summitPx = asPixelPoint(p, `${path}.summitPx`, obj.summitPx);
  const labelled = asBoolean(p, `${path}.labelled`, obj.labelled);
  if (
    summitId === undefined ||
    name === undefined ||
    elevationM === undefined ||
    distanceKm === undefined ||
    altitudeDeg === undefined ||
    visibility === undefined ||
    summitPx === undefined ||
    labelled === undefined
  ) {
    return undefined;
  }
  return { summitId, name, elevationM, distanceKm, altitudeDeg, visibility, summitPx, labelled };
}

const WITHHELD_KEYS = ['summitId', 'name', 'distanceKm', 'reason'] as const;
const WITHHELD_REASONS = ['unmeasured', 'off-frame', 'foreground-occluded'] as const;

function parseWithheldSummit(p: Problems, path: string, value: unknown): WithheldSummit | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, WITHHELD_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  const name = asString(p, `${path}.name`, obj.name);
  const distanceKm = asNumber(p, `${path}.distanceKm`, obj.distanceKm, { min: 0, max: 400 });
  const reason = asMember(p, `${path}.reason`, obj.reason, WITHHELD_REASONS);
  if (
    summitId === undefined ||
    name === undefined ||
    distanceKm === undefined ||
    reason === undefined
  ) {
    return undefined;
  }
  return { summitId, name, distanceKm, reason };
}

const OVERLAY_KEYS = ['drawn', 'withheld'] as const;

function parseOverlay(p: Problems, path: string, value: unknown): DrawnOverlay | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, OVERLAY_KEYS);
  const rawDrawn = asArray(p, `${path}.drawn`, obj.drawn);
  const rawWithheld = asArray(p, `${path}.withheld`, obj.withheld);
  if (rawDrawn === undefined || rawWithheld === undefined) return undefined;
  const drawn: DrawnSummit[] = [];
  rawDrawn.forEach((item, index) => {
    const summit = parseDrawnSummit(p, `${path}.drawn[${index}]`, item);
    if (summit) drawn.push(summit);
  });
  const withheld: WithheldSummit[] = [];
  rawWithheld.forEach((item, index) => {
    const summit = parseWithheldSummit(p, `${path}.withheld[${index}]`, item);
    if (summit) withheld.push(summit);
  });
  return { drawn, withheld };
}

const BAND_KEYS = [
  'horizontalDeg',
  'verticalDeg',
  'hasUnquantifiedHorizontal',
  'hasUnquantifiedVertical',
] as const;

function parseBand(p: Problems, path: string, value: unknown): DisplayedBand | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, BAND_KEYS);
  const horizontalDeg = asNumber(p, `${path}.horizontalDeg`, obj.horizontalDeg, { min: 0, max: 90 });
  const verticalDeg = asNumber(p, `${path}.verticalDeg`, obj.verticalDeg, { min: 0, max: 90 });
  const hasUnquantifiedHorizontal = asBoolean(
    p,
    `${path}.hasUnquantifiedHorizontal`,
    obj.hasUnquantifiedHorizontal,
  );
  const hasUnquantifiedVertical = asBoolean(
    p,
    `${path}.hasUnquantifiedVertical`,
    obj.hasUnquantifiedVertical,
  );
  if (
    horizontalDeg === undefined ||
    verticalDeg === undefined ||
    hasUnquantifiedHorizontal === undefined ||
    hasUnquantifiedVertical === undefined
  ) {
    return undefined;
  }
  return { horizontalDeg, verticalDeg, hasUnquantifiedHorizontal, hasUnquantifiedVertical };
}

const POSE_KEYS = [
  'headingDeg',
  'pitchDeg',
  'rollDeg',
  'hFovDeg',
  'vFovDeg',
  'headingBasis',
  'trimHeadingDeg',
  'trimPitchDeg',
  'grossHeadingOffsetDeg',
  'grossHeadingSource',
] as const;

const HEADING_BASES = ['true', 'true-model', 'magnetic'] as const;

function parsePose(p: Problems, path: string, value: unknown): CapturePose | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, POSE_KEYS);
  const headingDeg = asNumber(p, `${path}.headingDeg`, obj.headingDeg, { min: 0, max: 360 });
  const pitchDeg = asNumber(p, `${path}.pitchDeg`, obj.pitchDeg, { min: -90, max: 90 });
  const rollDeg = asNumber(p, `${path}.rollDeg`, obj.rollDeg, { min: -180, max: 180 });
  const hFovDeg = asNumber(p, `${path}.hFovDeg`, obj.hFovDeg, { min: 1, max: 179 });
  const vFovDeg = asNumber(p, `${path}.vFovDeg`, obj.vFovDeg, { min: 1, max: 179 });
  const headingBasis = asMember(p, `${path}.headingBasis`, obj.headingBasis, HEADING_BASES);
  const trimHeadingDeg = asNumber(p, `${path}.trimHeadingDeg`, obj.trimHeadingDeg, {
    min: -180,
    max: 180,
  });
  const trimPitchDeg = asNumber(p, `${path}.trimPitchDeg`, obj.trimPitchDeg, { min: -90, max: 90 });
  const grossHeadingOffsetDeg = asNumber(
    p,
    `${path}.grossHeadingOffsetDeg`,
    obj.grossHeadingOffsetDeg,
    { min: -180, max: 180 },
  );
  const grossHeadingSource = asMember(
    p,
    `${path}.grossHeadingSource`,
    obj.grossHeadingSource,
    GROSS_HEADING_SOURCES,
  );
  if (
    headingDeg === undefined ||
    pitchDeg === undefined ||
    rollDeg === undefined ||
    hFovDeg === undefined ||
    vFovDeg === undefined ||
    headingBasis === undefined ||
    trimHeadingDeg === undefined ||
    trimPitchDeg === undefined ||
    grossHeadingOffsetDeg === undefined ||
    grossHeadingSource === undefined
  ) {
    return undefined;
  }
  return {
    headingDeg,
    pitchDeg,
    rollDeg,
    hFovDeg,
    vFovDeg,
    headingBasis,
    trimHeadingDeg,
    trimPitchDeg,
    grossHeadingOffsetDeg,
    grossHeadingSource,
  };
}

const TRACE_KEYS = [
  'headingSpreadDeg',
  'pitchSpreadDeg',
  'rollSpreadDeg',
  'sampleCount',
  'stillForMs',
  'compassAccuracyDeg',
  'tickCount',
  'longestTickGapMs',
] as const;

function parseTrace(p: Problems, path: string, value: unknown): CaptureTrace | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, TRACE_KEYS);
  const headingSpreadDeg = asNumber(p, `${path}.headingSpreadDeg`, obj.headingSpreadDeg, { min: 0 });
  const pitchSpreadDeg = asNumber(p, `${path}.pitchSpreadDeg`, obj.pitchSpreadDeg, { min: 0 });
  const rollSpreadDeg = asNumber(p, `${path}.rollSpreadDeg`, obj.rollSpreadDeg, { min: 0 });
  const sampleCount = asNumber(p, `${path}.sampleCount`, obj.sampleCount, { min: 1 });
  const stillForMs = asNumber(p, `${path}.stillForMs`, obj.stillForMs, { min: 0 });
  const compassAccuracyDeg = asOptionalNumber(
    p,
    `${path}.compassAccuracyDeg`,
    'compassAccuracyDeg' in obj,
    obj.compassAccuracyDeg,
    { min: 0 },
  );
  const tickCount = asOptionalNumber(p, `${path}.tickCount`, 'tickCount' in obj, obj.tickCount, {
    min: 0,
  });
  const longestTickGapMs = asOptionalNumber(
    p,
    `${path}.longestTickGapMs`,
    'longestTickGapMs' in obj,
    obj.longestTickGapMs,
    { min: 0 },
  );
  if (
    headingSpreadDeg === undefined ||
    pitchSpreadDeg === undefined ||
    rollSpreadDeg === undefined ||
    sampleCount === undefined ||
    stillForMs === undefined
  ) {
    return undefined;
  }
  return {
    headingSpreadDeg,
    pitchSpreadDeg,
    rollSpreadDeg,
    sampleCount,
    stillForMs,
    ...(compassAccuracyDeg !== undefined ? { compassAccuracyDeg } : {}),
    ...(tickCount !== undefined ? { tickCount } : {}),
    ...(longestTickGapMs !== undefined ? { longestTickGapMs } : {}),
  };
}

const TRACK_KEYS = ['width', 'height', 'frameRate', 'facingMode', 'resizeMode', 'zoom'] as const;

function parseTrack(p: Problems, path: string, value: unknown): TrackGeometry | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, TRACK_KEYS);
  const width = asNumber(p, `${path}.width`, obj.width, { min: 1 });
  const height = asNumber(p, `${path}.height`, obj.height, { min: 1 });
  const frameRate = asOptionalNumber(p, `${path}.frameRate`, 'frameRate' in obj, obj.frameRate, {
    min: 0,
  });
  const zoom = asOptionalNumber(p, `${path}.zoom`, 'zoom' in obj, obj.zoom, { min: 0 });
  const facingMode =
    'facingMode' in obj ? asString(p, `${path}.facingMode`, obj.facingMode) : undefined;
  const resizeMode =
    'resizeMode' in obj ? asString(p, `${path}.resizeMode`, obj.resizeMode) : undefined;
  if (width === undefined || height === undefined) return undefined;
  return {
    width,
    height,
    ...(frameRate !== undefined ? { frameRate } : {}),
    ...(facingMode !== undefined ? { facingMode } : {}),
    ...(resizeMode !== undefined ? { resizeMode } : {}),
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

const CAPTURE_KEYS = [
  'captureId',
  'role',
  'tMs',
  'framePath',
  'framePx',
  'overlayPx',
  'pose',
  'trace',
  'track',
  'fovSource',
  'sweepRadiusKm',
  'band',
  'overlay',
  'dragAnchorSummitId',
  'movedFromCaptureId',
  'panFromReferenceDeg',
  'tiltFromReferenceDeg',
  'horizontalAccuracyM',
  'note',
] as const;

const FOV_SOURCES = ['calibrated', 'spec-sheet-guess'] as const;

/** A plain relative file name: no directory, no traversal, no scheme. */
const FRAME_PATH = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:jpg|jpeg|png|webp)$/;

/** Longest session the format accepts, ms. An hour is generous for 25 minutes. */
const MAX_SESSION_MS = 3_600_000;

function parseCapture(p: Problems, path: string, value: unknown): Capture | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, CAPTURE_KEYS);

  const captureId = asString(p, `${path}.captureId`, obj.captureId);
  const role = asMember(p, `${path}.role`, obj.role, CAPTURE_ROLES);
  const tMs = asNumber(p, `${path}.tMs`, obj.tMs, { min: 0, max: MAX_SESSION_MS });
  const framePath = asString(p, `${path}.framePath`, obj.framePath);
  if (framePath !== undefined && !FRAME_PATH.test(framePath)) {
    p.add(
      `${path}.framePath`,
      'expected a plain image file name beside the bundle, with no directory and no traversal',
    );
  }
  const framePx = asSize(p, `${path}.framePx`, obj.framePx);
  const overlayPx = asSize(p, `${path}.overlayPx`, obj.overlayPx);
  const pose = parsePose(p, `${path}.pose`, obj.pose);
  const trace = parseTrace(p, `${path}.trace`, obj.trace);
  const track = parseTrack(p, `${path}.track`, obj.track);
  const fovSource = asMember(p, `${path}.fovSource`, obj.fovSource, FOV_SOURCES);
  const sweepRadiusKm = asNumber(p, `${path}.sweepRadiusKm`, obj.sweepRadiusKm, {
    min: 1,
    max: 400,
  });
  const band = parseBand(p, `${path}.band`, obj.band);
  const overlay = parseOverlay(p, `${path}.overlay`, obj.overlay);

  const dragAnchorSummitId =
    'dragAnchorSummitId' in obj
      ? asString(p, `${path}.dragAnchorSummitId`, obj.dragAnchorSummitId)
      : undefined;
  const movedFromCaptureId =
    'movedFromCaptureId' in obj
      ? asString(p, `${path}.movedFromCaptureId`, obj.movedFromCaptureId)
      : undefined;
  const panFromReferenceDeg = asOptionalNumber(
    p,
    `${path}.panFromReferenceDeg`,
    'panFromReferenceDeg' in obj,
    obj.panFromReferenceDeg,
    { min: -180, max: 180 },
  );
  const tiltFromReferenceDeg = asOptionalNumber(
    p,
    `${path}.tiltFromReferenceDeg`,
    'tiltFromReferenceDeg' in obj,
    obj.tiltFromReferenceDeg,
    { min: -90, max: 90 },
  );
  const horizontalAccuracyM = asOptionalNumber(
    p,
    `${path}.horizontalAccuracyM`,
    'horizontalAccuracyM' in obj,
    obj.horizontalAccuracyM,
    { min: 0, max: 100_000 },
  );
  const note = 'note' in obj ? asString(p, `${path}.note`, obj.note) : undefined;

  if (role === 'after-drag' && dragAnchorSummitId === undefined) {
    p.add(`${path}.dragAnchorSummitId`, 'an after-drag capture must name the summit it anchored on');
  }
  if (role === 'moved') {
    if (movedFromCaptureId === undefined) {
      p.add(`${path}.movedFromCaptureId`, 'a moved capture must name the capture it moved from');
    }
    if (panFromReferenceDeg === undefined && tiltFromReferenceDeg === undefined) {
      p.add(`${path}.panFromReferenceDeg`, 'a moved capture must record its pan or its tilt');
    }
  }

  if (
    captureId === undefined ||
    role === undefined ||
    tMs === undefined ||
    framePath === undefined ||
    framePx === undefined ||
    overlayPx === undefined ||
    pose === undefined ||
    trace === undefined ||
    track === undefined ||
    fovSource === undefined ||
    sweepRadiusKm === undefined ||
    band === undefined ||
    overlay === undefined
  ) {
    return undefined;
  }
  return {
    captureId,
    role,
    tMs,
    framePath,
    framePx,
    overlayPx,
    pose,
    trace,
    track,
    fovSource,
    sweepRadiusKm,
    band,
    overlay,
    ...(dragAnchorSummitId !== undefined ? { dragAnchorSummitId } : {}),
    ...(movedFromCaptureId !== undefined ? { movedFromCaptureId } : {}),
    ...(panFromReferenceDeg !== undefined ? { panFromReferenceDeg } : {}),
    ...(tiltFromReferenceDeg !== undefined ? { tiltFromReferenceDeg } : {}),
    ...(horizontalAccuracyM !== undefined ? { horizontalAccuracyM } : {}),
    ...(note !== undefined ? { note } : {}),
  };
}

const BUNDLE_KEYS = [
  'format',
  'timestampBasis',
  'device',
  'peakRegions',
  'captures',
  'accuracyConvention',
  'note',
] as const;

/**
 * Parse a bundle, or say everything that is wrong with it.
 *
 * Every problem is collected rather than the first one thrown, because a bundle
 * arrives once, from a person who has already driven somewhere, and a parser
 * that reports one typo per run wastes the trip.
 */
export function parseFieldBundle(raw: unknown): ParseResult<FieldBundle> {
  const p = new Problems();
  for (const problem of findForbiddenContent(raw)) p.list.push(problem);

  const obj = asRecord(p, '', raw);
  if (!obj) return { ok: false, problems: p.list };
  checkKeys(p, '', obj, BUNDLE_KEYS);

  if (obj.format !== BUNDLE_FORMAT) p.add('format', `expected exactly "${BUNDLE_FORMAT}"`);
  if (obj.timestampBasis !== TIMESTAMP_BASIS) {
    p.add('timestampBasis', `expected exactly "${TIMESTAMP_BASIS}"`);
  }
  const device = asString(p, 'device', obj.device);
  const note = 'note' in obj ? asString(p, 'note', obj.note) : undefined;
  const hasConvention = 'accuracyConvention' in obj;
  if (hasConvention && obj.accuracyConvention !== ACCURACY_CONFIDENCE) {
    p.add('accuracyConvention', `expected exactly "${ACCURACY_CONFIDENCE}"`);
  }

  const rawRegions = asArray(p, 'peakRegions', obj.peakRegions);
  const peakRegions: string[] = [];
  rawRegions?.forEach((item, index) => {
    const region = asString(p, `peakRegions[${index}]`, item);
    if (region !== undefined) peakRegions.push(region);
  });

  const rawCaptures = asArray(p, 'captures', obj.captures);
  const captures: Capture[] = [];
  if (rawCaptures !== undefined) {
    if (rawCaptures.length === 0) p.add('captures', 'a bundle with no captures says nothing');
    const seen = new Set<string>();
    rawCaptures.forEach((item, index) => {
      const capture = parseCapture(p, `captures[${index}]`, item);
      if (!capture) return;
      if (seen.has(capture.captureId)) {
        p.add(`captures[${index}].captureId`, `${capture.captureId} is used twice`);
        return;
      }
      seen.add(capture.captureId);
      captures.push(capture);
    });
  }

  const reportsAccuracy = captures.some((capture) => capture.horizontalAccuracyM !== undefined);
  if (reportsAccuracy && !hasConvention) {
    p.add(
      'accuracyConvention',
      `required once a capture reports horizontalAccuracyM: a radius without its confidence level is not a σ. Expected "${ACCURACY_CONFIDENCE}"`,
    );
  }

  if (p.list.length > 0) return { ok: false, problems: p.list };
  if (device === undefined) {
    return { ok: false, problems: [{ path: '', message: 'incomplete bundle' }] };
  }
  return {
    ok: true,
    value: {
      format: BUNDLE_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device,
      peakRegions,
      captures,
      ...(hasConvention ? { accuracyConvention: ACCURACY_CONFIDENCE } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  };
}

const APEX_KEYS = ['summitId', 'apexPx', 'landmark', 'absent', 'reason', 'cannotIdentify', 'note'] as const;
const READING_KEYS = ['annotatorId', 'method', 'apexes'] as const;
const CAPTURE_TRUTH_KEYS = ['captureId', 'readings'] as const;
const TRUTH_KEYS = ['format', 'procedure', 'captures'] as const;

/** The three answers, and what each one must carry. */
const APEX_SHAPES =
  '{ "apexPx": { "xPx": …, "yPx": … } } to locate it, { "absent": true, "reason": "clear-sky" | "foreground-blocked" } to say the region holds no summit, or { "cannotIdentify": true } to say you could not decide';

/**
 * One annotation, in exactly one of the three shapes.
 *
 * `apexPx: null` is refused by name. It was the previous format's way of
 * writing both "not there" and "cannot tell", and those grade in opposite
 * directions: only the first can convict the app of a false `visible`.
 */
function parseApex(p: Problems, path: string, value: unknown): ApexAnnotation | undefined {
  const obj = asRecord(p, path, value);
  if (!obj) return undefined;
  checkKeys(p, path, obj, APEX_KEYS);
  const summitId = asString(p, `${path}.summitId`, obj.summitId);
  const note = 'note' in obj ? asString(p, `${path}.note`, obj.note) : undefined;
  const extras = note !== undefined ? { note } : {};

  if (obj.apexPx === null) {
    p.add(
      `${path}.apexPx`,
      `null is no longer an answer: it meant both "the summit is not in this frame" and "I cannot identify it", and only the first can convict the app of a false visible. Write ${APEX_SHAPES}`,
    );
    return undefined;
  }

  for (const flag of ['absent', 'cannotIdentify'] as const) {
    if (flag in obj && obj[flag] !== true) {
      p.add(`${path}.${flag}`, 'expected true; leave the key out rather than writing false');
      return undefined;
    }
  }

  const claims = [
    'apexPx' in obj ? 'apexPx' : undefined,
    obj.absent === true ? 'absent' : undefined,
    obj.cannotIdentify === true ? 'cannotIdentify' : undefined,
  ].filter((claim): claim is string => claim !== undefined);
  if (claims.length !== 1) {
    p.add(
      path,
      claims.length === 0
        ? `no answer: write exactly one of ${APEX_SHAPES}`
        : `${claims.join(' and ')} together are ${claims.length} answers; write exactly one`,
    );
    return undefined;
  }

  if ('apexPx' in obj) {
    const apexPx = asPixelPoint(p, `${path}.apexPx`, obj.apexPx);
    const landmark =
      'landmark' in obj ? asString(p, `${path}.landmark`, obj.landmark) : undefined;
    if ('reason' in obj) p.add(`${path}.reason`, 'a reason belongs to an absent answer');
    if (summitId === undefined || apexPx === undefined) return undefined;
    return { summitId, apexPx, ...(landmark !== undefined ? { landmark } : {}), ...extras };
  }

  if ('landmark' in obj) {
    p.add(`${path}.landmark`, 'a landmark belongs to an apex answer');
  }

  if (obj.absent === true) {
    if (!('reason' in obj)) {
      p.add(
        `${path}.reason`,
        `an absent answer must say what the region holds instead: one of ${ABSENT_REASONS.join(', ')}`,
      );
      return undefined;
    }
    const reason = asMember(p, `${path}.reason`, obj.reason, ABSENT_REASONS);
    if (summitId === undefined || reason === undefined) return undefined;
    return { summitId, absent: true, reason, ...extras };
  }

  if ('reason' in obj) p.add(`${path}.reason`, 'a reason belongs to an absent answer');
  if (summitId === undefined) return undefined;
  return { summitId, cannotIdentify: true, ...extras };
}

/** Parse the truth document, or say everything that is wrong with it. */
export function parseFieldTruth(raw: unknown): ParseResult<FieldTruth> {
  const p = new Problems();
  for (const problem of findForbiddenContent(raw)) p.list.push(problem);

  const obj = asRecord(p, '', raw);
  if (!obj) return { ok: false, problems: p.list };
  checkKeys(p, '', obj, TRUTH_KEYS);
  if (obj.format === SUPERSEDED_TRUTH_FORMAT) {
    p.add(
      'format',
      `"${SUPERSEDED_TRUTH_FORMAT}" is not read. It wrote apexPx: null for everything an annotator did not locate, which conflated "the summit is not in this frame" with "I cannot identify it"; only the first can convict the app of a false visible. Re-annotate into "${TRUTH_FORMAT}", where each answer is ${APEX_SHAPES}, and each reading names the method it was made under: ${ANNOTATOR_METHODS.join(' or ')}`,
    );
  } else if (obj.format !== TRUTH_FORMAT) {
    p.add('format', `expected exactly "${TRUTH_FORMAT}"`);
  }
  const procedure = asString(p, 'procedure', obj.procedure);

  const rawCaptures = asArray(p, 'captures', obj.captures);
  const captures: CaptureTruth[] = [];
  rawCaptures?.forEach((item, index) => {
    const path = `captures[${index}]`;
    const captureObj = asRecord(p, path, item);
    if (!captureObj) return;
    checkKeys(p, path, captureObj, CAPTURE_TRUTH_KEYS);
    const captureId = asString(p, `${path}.captureId`, captureObj.captureId);
    const rawReadings = asArray(p, `${path}.readings`, captureObj.readings);
    if (rawReadings !== undefined && rawReadings.length !== REQUIRED_ANNOTATORS) {
      p.add(
        `${path}.readings`,
        `expected exactly ${REQUIRED_ANNOTATORS} independent readings, found ${rawReadings.length}`,
      );
    }
    const readings: AnnotatorReading[] = [];
    rawReadings?.forEach((rawReading, readingIndex) => {
      const readingPath = `${path}.readings[${readingIndex}]`;
      const readingObj = asRecord(p, readingPath, rawReading);
      if (!readingObj) return;
      checkKeys(p, readingPath, readingObj, READING_KEYS);
      const annotatorId = asString(p, `${readingPath}.annotatorId`, readingObj.annotatorId);
      const method = asMember(p, `${readingPath}.method`, readingObj.method, ANNOTATOR_METHODS);
      const rawApexes = asArray(p, `${readingPath}.apexes`, readingObj.apexes);
      const apexes: ApexAnnotation[] = [];
      rawApexes?.forEach((rawApex, apexIndex) => {
        const apex = parseApex(p, `${readingPath}.apexes[${apexIndex}]`, rawApex);
        if (apex) apexes.push(apex);
      });
      if (annotatorId === undefined || method === undefined) return;
      readings.push({ annotatorId, method, apexes });
    });
    if (captureId === undefined) return;
    if (new Set(readings.map((reading) => reading.annotatorId)).size !== readings.length) {
      p.add(`${path}.readings`, 'two readings share an annotator id, so they are not independent');
    }
    captures.push({ captureId, readings });
  });

  if (p.list.length > 0) return { ok: false, problems: p.list };
  if (procedure === undefined) {
    return { ok: false, problems: [{ path: '', message: 'incomplete truth document' }] };
  }
  return { ok: true, value: { format: TRUTH_FORMAT, procedure, captures } };
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 5 — Pixels to frame angles
 * ══════════════════════════════════════════════════════════════════════════ */

const RAD_PER_DEG = Math.PI / 180;

/**
 * The angle from the optical axis of a point `offsetPx` from the frame centre.
 *
 * The pinhole relation the renderer projects with, read backwards:
 * `px = (size/2) · tan θ / tan(fov/2)`, so
 * `θ = atan( (2·offsetPx / size) · tan(fov/2) )`. Exact, not a small-angle
 * approximation, because a label near the edge of a 74° frame covers fewer
 * degrees per pixel than one in the middle and a linear scale would understate
 * an edge residual by a fifth.
 *
 * These are FRAME angles — the tangent-plane angles about the optical axis,
 * which is exactly what a drag trims. For a label far above or below the
 * horizon the horizontal frame angle differs from the difference in azimuth by
 * a factor of 1/cos(elevation); summit labels sit within a few degrees of the
 * horizon, where that factor is under 1.002.
 */
export function angularOffsetDeg(offsetPx: number, sizePx: number, fovDeg: number): number {
  if (!(sizePx > 0) || !(fovDeg > 0)) return 0;
  return Math.atan(((2 * offsetPx) / sizePx) * Math.tan((fovDeg / 2) * RAD_PER_DEG)) / RAD_PER_DEG;
}

/** Pixels per degree at the frame centre. What a reader converts a residual with. */
export function pixelsPerDegreeAtCentre(fovDeg: number, sizePx: number): number {
  if (!(fovDeg > 0) || !(sizePx > 0)) return 0;
  return ((sizePx / 2) * RAD_PER_DEG) / Math.tan((fovDeg / 2) * RAD_PER_DEG);
}

/**
 * The fraction of each axis of the camera frame the viewport showed.
 *
 * One of the two is always 1: `object-fit: cover` crops one axis and shows the
 * other whole.
 */
export interface VisibleFraction {
  readonly x: number;
  readonly y: number;
}

/**
 * How much of the camera frame reached the screen, from the two aspect ratios.
 *
 * The AR screen draws the video at `object-fit: cover`, which scales the frame
 * by `max(viewW/trackW, viewH/trackH)` and throws away the overflow evenly on
 * both sides of the axis that overflows. A viewport relatively wider than the
 * track keeps the whole width and loses height; a relatively taller one loses
 * width. A 4:3 track in a 16:9 viewport keeps 75 % of the frame's height, and
 * the 16:9 track this session records keeps 81.8 % of it in the registered
 * 956 × 440 viewport.
 *
 * Read off the aspect ratios rather than off the two scale factors, so the
 * uncropped axis comes back as exactly 1 and the mapping and the field of view
 * below are left untouched on a capture whose viewport and frame share an
 * aspect. `src/app/live/video-box.ts` computes the same geometry for the screen
 * from the pixel sizes, and a test holds the two to agreement — the grader does
 * not import it, because the grader needs fractions of the STORED frame, which
 * is a recording of the track at another size, and because a capture is graded
 * from what the bundle says rather than from a module the app lays out with.
 *
 * `undefined` when the capture records no usable camera track size. The crop is
 * not recoverable from anything else in the bundle, so the capture is refused
 * rather than graded through a guess.
 */
export function coverVisibleFraction(
  viewportPx: { readonly widthPx: number; readonly heightPx: number },
  track: TrackGeometry,
): VisibleFraction | undefined {
  const viewAspect = viewportPx.widthPx / viewportPx.heightPx;
  const trackAspect = track.width / track.height;
  if (!(viewAspect > 0) || !Number.isFinite(viewAspect)) return undefined;
  if (!(trackAspect > 0) || !Number.isFinite(trackAspect)) return undefined;
  return viewAspect >= trackAspect
    ? { x: 1, y: trackAspect / viewAspect }
    : { x: viewAspect / trackAspect, y: 1 };
}

/**
 * An overlay pixel placed on the stored frame, through the crop the screen made.
 *
 * The overlay is drawn over the visible part of the frame only, so a viewport
 * pixel maps to the visible window of the stored frame and not to the whole of
 * it: the window is `fraction` of the frame, centred, and the offset is the
 * strip `cover` cut off the leading edge. The stored frame's aspect equals the
 * track's to within the 2 % of § 2.0, which is what lets the crop be computed
 * from the track and then applied to the frame's own pixel sizes.
 */
export function overlayToFramePx(
  capture: Capture,
  point: PixelPoint,
  fraction: VisibleFraction,
): PixelPoint {
  const { widthPx, heightPx } = capture.framePx;
  const xScale = widthPx / capture.overlayPx.widthPx;
  const yScale = heightPx / capture.overlayPx.heightPx;
  return {
    xPx: point.xPx * xScale * fraction.x + (widthPx * (1 - fraction.x)) / 2,
    yPx: point.yPx * yScale * fraction.y + (heightPx * (1 - fraction.y)) / 2,
  };
}

/**
 * The whole frame's field of view, from the visible box's.
 *
 * The pose carries the field of view of what is ON SCREEN — `LiveScreen` hands
 * `croppedFovDeg`'s answer to the pose, and the overlay is drawn with it — while
 * a truth apex is a pixel on the whole stored frame. The inverse of that crop is
 * the relation `croppedFovDeg` applies forwards, read the other way:
 *
 *     tan(full/2) = tan(visible/2) / fraction
 *
 * An uncropped axis is returned unchanged rather than passed through
 * `atan(tan(·))`, which is the identity in arithmetic but not in floating point.
 */
export function uncroppedFovDeg(visibleFovDeg: number, fraction: number): number {
  if (!(fraction > 0) || fraction >= 1) return visibleFovDeg;
  if (!(visibleFovDeg > 0) || visibleFovDeg >= 180) return visibleFovDeg;
  return (2 * Math.atan(Math.tan((visibleFovDeg / 2) * RAD_PER_DEG) / fraction)) / RAD_PER_DEG;
}

/** A signed residual on both axes, in frame angles and in stored-frame pixels. */
export interface Residual {
  readonly horizontalDeg: number;
  readonly verticalDeg: number;
  readonly horizontalPx: number;
  readonly verticalPx: number;
}

/**
 * Drawn minus truth, in frame angles, or `undefined` for a capture whose crop
 * cannot be recovered.
 *
 * The overlay is drawn in the CSS viewport over the part of the camera frame
 * `object-fit: cover` left visible, and the truth apex is read off the whole
 * stored frame. The two spaces share the optical axis — the overlay box is
 * centred on the principal point (`video-box.ts`) — but not their extent, so
 * the drawn point goes through the crop ({@link overlayToFramePx}) and the
 * angles are taken with the whole frame's field of view rather than the visible
 * box's ({@link uncroppedFovDeg}). Where the viewport and the frame share an
 * aspect, `cover` crops nothing and both steps reduce to the plain ratio of
 * widths and of heights.
 */
export function residualOf(
  capture: Capture,
  drawn: PixelPoint,
  truth: PixelPoint,
): Residual | undefined {
  const fraction = coverVisibleFraction(capture.overlayPx, capture.track);
  if (fraction === undefined) return undefined;
  const drawnFrame = overlayToFramePx(capture, drawn, fraction);
  const { widthPx, heightPx } = capture.framePx;
  const hFovDeg = uncroppedFovDeg(capture.pose.hFovDeg, fraction.x);
  const vFovDeg = uncroppedFovDeg(capture.pose.vFovDeg, fraction.y);
  const horizontalDeg =
    angularOffsetDeg(drawnFrame.xPx - widthPx / 2, widthPx, hFovDeg) -
    angularOffsetDeg(truth.xPx - widthPx / 2, widthPx, hFovDeg);
  const verticalDeg =
    angularOffsetDeg(drawnFrame.yPx - heightPx / 2, heightPx, vFovDeg) -
    angularOffsetDeg(truth.yPx - heightPx / 2, heightPx, vFovDeg);
  return {
    horizontalDeg,
    verticalDeg,
    horizontalPx: drawnFrame.xPx - truth.xPx,
    verticalPx: drawnFrame.yPx - truth.yPx,
  };
}

/**
 * The direction a stored-frame pixel points, under a camera pose.
 *
 * The inverse of `projectToImage`, which this file does not otherwise have. The
 * fields of view passed in are the WHOLE frame's ({@link uncroppedFovDeg}),
 * because a stored-frame pixel is a pixel of the whole frame.
 */
function directionAtFramePx(
  pose: CameraPose,
  framePx: { readonly widthPx: number; readonly heightPx: number },
  point: PixelPoint,
): { readonly bearingDeg: number; readonly altitudeDeg: number } {
  const axes = cameraAxes(pose);
  const ndcX =
    (point.xPx / framePx.widthPx - 0.5) * 2 * Math.tan((pose.hFovDeg / 2) * RAD_PER_DEG);
  const ndcY =
    (0.5 - point.yPx / framePx.heightPx) * 2 * Math.tan((pose.vFovDeg / 2) * RAD_PER_DEG);
  const e = axes.forward.e + ndcX * axes.right.e + ndcY * axes.up.e;
  const n = axes.forward.n + ndcX * axes.right.n + ndcY * axes.up.n;
  const u = axes.forward.u + ndcX * axes.right.u + ndcY * axes.up.u;
  const length = Math.hypot(e, n, u);
  return {
    bearingDeg: ((Math.atan2(e, n) / RAD_PER_DEG) % 360 + 360) % 360,
    altitudeDeg: Math.asin(length > 0 ? u / length : 0) / RAD_PER_DEG,
  };
}

/** The camera heading and pitch a set of located summits puts the camera at. */
export interface SolvedPose {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  /** How many located summits the solve used. */
  readonly summitCount: number;
}

/** How many summits it takes to solve a pose. Two fix a heading against a pitch. */
export const MIN_SUMMITS_FOR_POSE_SOLVE = 2;

/**
 * The camera heading and pitch that best place the located summits on the frame.
 *
 * Each summit's direction is read off the marker the app DREW, at the pose the
 * app drew it with. That direction is not a compass reading: the drawn pixel is
 * the summit's bearing minus the pose's heading, so putting the pose's heading
 * back in cancels the compass out and leaves the geometry the peak data and the
 * observer's fix give. The solve then moves the camera until those directions
 * land on the truth apexes, which is the heading the picture itself implies.
 *
 * Gauss-Newton on heading and pitch together, minimising the squared distance in
 * stored-frame pixels. Roll comes from the pose and is not solved: one capture's
 * summits sit within a few degrees of the horizon, so roll and pitch are nearly
 * degenerate there and a three-parameter solve would trade one for the other.
 *
 * `undefined` when the crop cannot be recovered, when fewer than
 * {@link MIN_SUMMITS_FOR_POSE_SOLVE} summits are located, or when the summits
 * are too close together to separate the two parameters.
 */
export function solvePoseFromTruth(
  capture: Capture,
  located: readonly { readonly drawnPx: PixelPoint; readonly truthPx: PixelPoint }[],
): SolvedPose | undefined {
  if (located.length < MIN_SUMMITS_FOR_POSE_SOLVE) return undefined;
  const fraction = coverVisibleFraction(capture.overlayPx, capture.track);
  if (fraction === undefined) return undefined;
  const framePx = capture.framePx;
  const wholeFrame = {
    headingDeg: capture.pose.headingDeg,
    pitchDeg: capture.pose.pitchDeg,
    rollDeg: capture.pose.rollDeg,
    hFovDeg: uncroppedFovDeg(capture.pose.hFovDeg, fraction.x),
    vFovDeg: uncroppedFovDeg(capture.pose.vFovDeg, fraction.y),
  };
  const targets = located.map((pair) => ({
    direction: directionAtFramePx(
      wholeFrame,
      framePx,
      overlayToFramePx(capture, pair.drawnPx, fraction),
    ),
    truthPx: pair.truthPx,
  }));

  /** Signed pixel misfits, x then y per summit, at one candidate pose. */
  const residualsAt = (headingDeg: number, pitchDeg: number): number[] => {
    const pose = { ...wholeFrame, headingDeg, pitchDeg };
    const out: number[] = [];
    for (const target of targets) {
      const image = projectToImage(pose, target.direction.bearingDeg, target.direction.altitudeDeg);
      out.push(image.x * framePx.widthPx - target.truthPx.xPx);
      out.push(image.y * framePx.heightPx - target.truthPx.yPx);
    }
    return out;
  };

  const STEP_DEG = 1e-3;
  let headingDeg = capture.pose.headingDeg;
  let pitchDeg = capture.pose.pitchDeg;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const base = residualsAt(headingDeg, pitchDeg);
    const byHeading = residualsAt(headingDeg + STEP_DEG, pitchDeg);
    const byPitch = residualsAt(headingDeg, pitchDeg + STEP_DEG);
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < base.length; i += 1) {
      const r = base[i] ?? 0;
      const jh = ((byHeading[i] ?? 0) - r) / STEP_DEG;
      const jp = ((byPitch[i] ?? 0) - r) / STEP_DEG;
      a11 += jh * jh;
      a12 += jh * jp;
      a22 += jp * jp;
      b1 += jh * r;
      b2 += jp * r;
    }
    const determinant = a11 * a22 - a12 * a12;
    if (!(Math.abs(determinant) > 1e-9)) return undefined;
    const dHeading = (-b1 * a22 + b2 * a12) / determinant;
    const dPitch = (-a11 * b2 + a12 * b1) / determinant;
    headingDeg += dHeading;
    pitchDeg += dPitch;
    if (Math.abs(dHeading) < 1e-10 && Math.abs(dPitch) < 1e-10) break;
  }
  if (!Number.isFinite(headingDeg) || !Number.isFinite(pitchDeg)) return undefined;
  return {
    headingDeg: ((headingDeg % 360) + 360) % 360,
    pitchDeg,
    summitCount: located.length,
  };
}

/** How far into the frame a point sits: 0 at the centre, 1 at the edge. */
export function frameOffsetFraction(xPx: number, widthPx: number): number {
  if (!(widthPx > 0)) return 0;
  return Math.abs(xPx - widthPx / 2) / (widthPx / 2);
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 6 — Truth, reduced
 * ══════════════════════════════════════════════════════════════════════════ */

/** What the two annotators, together, say about one summit in one frame. */
export type SummitTruth =
  | {
      /** Both annotators found it, and they agree closely enough to grade. */
      readonly kind: 'located';
      readonly apexPx: PixelPoint;
      readonly disagreementDeg: number;
      readonly disagreementPx: number;
      /**
       * The point feature both annotators took the apex from, when both named
       * one. A landmark observation is graded like any other and reported apart,
       * because its precision comes from a mast rather than from a skyline.
       */
      readonly landmark?: string;
    }
  | {
      /** Both annotators say the summit is not in this frame, and why. */
      readonly kind: 'absent';
      /** One per annotator, in reading order. They may differ and still agree it is absent. */
      readonly reasons: readonly AbsentReason[];
    }
  | {
      /** An annotator could not decide. The summit is graded by nothing. */
      readonly kind: 'excluded';
      readonly why: string;
    }
  | {
      /** They disagree, by distance or by presence. Reported, never averaged. */
      readonly kind: 'disputed';
      readonly why: string;
      readonly disagreementDeg?: number;
      readonly disagreementPx?: number;
    };

/**
 * Reduce two independent readings of one summit to one truth.
 *
 * The four outcomes follow the pre-registration's § 2.0 rules, in this order:
 * either annotator answering `cannot-identify` excludes the summit, whatever the
 * other said; two `absent` answers make it absent; an `absent` against an apex is
 * disputed; and two apexes are graded against the 0.30° agreement limit.
 *
 * A disagreement is never split: two annotators who disagree about whether a
 * summit is in the picture are not making a measurement with an error bar, they
 * are making two incompatible claims, and averaging them would manufacture a
 * truth neither of them reported.
 */
export function reduceTruth(
  capture: Capture,
  picks: readonly ApexAnnotation[],
): SummitTruth | undefined {
  if (picks.length !== REQUIRED_ANNOTATORS) return undefined;
  const [first, second] = picks;
  if (first === undefined || second === undefined) return undefined;

  const answers = [apexAnswer(first), apexAnswer(second)];
  const unidentifiable = answers.filter((answer) => answer === 'cannot-identify').length;
  if (unidentifiable > 0) {
    return {
      kind: 'excluded',
      why:
        unidentifiable === REQUIRED_ANNOTATORS
          ? 'neither annotator could identify this summit in the frame'
          : 'one annotator could not identify this summit in the frame',
    };
  }
  if ('absent' in first && 'absent' in second) {
    return { kind: 'absent', reasons: [first.reason, second.reason] };
  }
  if ('absent' in first || 'absent' in second) {
    return {
      kind: 'disputed',
      why: 'one annotator located the summit and the other says it is not in the frame',
    };
  }
  if (!('apexPx' in first) || !('apexPx' in second)) return undefined;

  const landmarks = [first.landmark, second.landmark];
  const landmark = landmarks.every((entry): entry is string => entry !== undefined)
    ? [...new Set(landmarks)].join(' / ')
    : undefined;
  const dxPx = first.apexPx.xPx - second.apexPx.xPx;
  const dyPx = first.apexPx.yPx - second.apexPx.yPx;
  const disagreementPx = Math.hypot(dxPx, dyPx);
  const { widthPx, heightPx } = capture.framePx;
  // Both picks are pixels on the whole stored frame, so they are converted with
  // the whole frame's field of view, as a residual is.
  const fraction = coverVisibleFraction(capture.overlayPx, capture.track);
  if (fraction === undefined) return undefined;
  const hFovDeg = uncroppedFovDeg(capture.pose.hFovDeg, fraction.x);
  const vFovDeg = uncroppedFovDeg(capture.pose.vFovDeg, fraction.y);
  const dxDeg =
    angularOffsetDeg(first.apexPx.xPx - widthPx / 2, widthPx, hFovDeg) -
    angularOffsetDeg(second.apexPx.xPx - widthPx / 2, widthPx, hFovDeg);
  const dyDeg =
    angularOffsetDeg(first.apexPx.yPx - heightPx / 2, heightPx, vFovDeg) -
    angularOffsetDeg(second.apexPx.yPx - heightPx / 2, heightPx, vFovDeg);
  const disagreementDeg = Math.hypot(dxDeg, dyDeg);
  if (disagreementDeg > MAX_TRUTH_DISAGREEMENT_DEG) {
    return {
      kind: 'disputed',
      why: `the two apex picks are ${disagreementDeg.toFixed(3)}° apart, over the ${MAX_TRUTH_DISAGREEMENT_DEG}° limit`,
      disagreementDeg,
      disagreementPx,
    };
  }
  return {
    kind: 'located',
    apexPx: {
      xPx: (first.apexPx.xPx + second.apexPx.xPx) / 2,
      yPx: (first.apexPx.yPx + second.apexPx.yPx) / 2,
    },
    disagreementDeg,
    disagreementPx,
    ...(landmark !== undefined ? { landmark } : {}),
  };
}

function truthIndex(truth: FieldTruth, captureId: string): Map<string, ApexAnnotation[]> {
  const index = new Map<string, ApexAnnotation[]>();
  const entry = truth.captures.find((capture) => capture.captureId === captureId);
  if (entry === undefined) return index;
  for (const reading of entry.readings) {
    for (const apex of reading.apexes) {
      const picks = index.get(apex.summitId) ?? [];
      picks.push(apex);
      index.set(apex.summitId, picks);
    }
  }
  return index;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 7 — The verdict vocabulary
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * What a criterion did.
 *
 * `no-sample` is a real outcome, not a failure: a band no summit fell into is
 * neither passed nor failed, and saying so is the honest report at this n.
 * `refused` means a precondition of the criterion was not met — an uncalibrated
 * field of view, for instance — so nothing was graded.
 */
export type Outcome = 'pass' | 'fail' | 'no-sample' | 'refused';

export interface Criterion {
  /** Stable id, e.g. `F3.far`. A script or a test can name one criterion. */
  readonly id: string;
  /** What was claimed, in one line. */
  readonly claim: string;
  readonly outcome: Outcome;
  /** How many summit-observations the criterion was graded on. */
  readonly n: number;
  /** The numbers behind the outcome. One claim per line, no coordinates. */
  readonly evidence: readonly string[];
}

/** One graded summit-observation. Carries a band label, never a distance. */
export interface GradedSummit {
  readonly captureId: string;
  readonly summitId: string;
  readonly name: string;
  readonly band: BandId;
  readonly residual: Residual;
  /** 0 at the frame centre, 1 at its edge. Separates the scale terms. */
  readonly frameOffset: number;
  readonly truthDisagreementDeg: number;
  /** The point feature both annotators took the apex from, when both named one. */
  readonly landmark?: string;
  /** Inside the 2σ band on both axes. */
  readonly withinThreshold: boolean;
  readonly exceedances: readonly AxisExceedance[];
  readonly axesOverTwoSigma: number;
  readonly axesOverThreeSigma: number;
}

/** Everything a run produced, ready to print. */
export interface FieldAnalysis {
  readonly device: string;
  readonly captureCount: number;
  readonly criteria: readonly Criterion[];
  readonly graded: readonly GradedSummit[];
  /**
   * What each annotator was given, one line each.
   *
   * Both registered methods are allowed and the report says which was used, so a
   * reader can tell a skyline read from the bare frame from one read with a
   * topographic map beside it.
   */
  readonly annotatorMethods: readonly string[];
  /**
   * Graded summits whose apex both annotators took from a named point feature.
   *
   * Reported apart from the rest. A mast is a sharper target than a rounded
   * summit, so these observations carry a finer truth than the others and saying
   * which they are keeps that from being read as the app doing better.
   */
  readonly landmarkObservations: readonly string[];
  /** Problems that stop a capture being graded at all. */
  readonly refusals: readonly string[];
  /**
   * Problems on a capture that WAS graded, and the caveat its verdicts carry.
   *
   * A deviation from a registered frame, or a summit whose height disagrees with
   * the committed peak data, does not stop the geometry being measured. It says
   * what the measurement is worth. Kept apart from the refusals because a reader
   * counting the captures a run lost cannot tell the two apart in one list.
   */
  readonly notes: readonly string[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 8 — Summit truth from the committed peak data
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Resolves a summit id against the committed peak data.
 *
 * The bundle is written by the device under test, so its own account of a
 * summit's identity and height cannot grade itself. `scripts/analyze-field.ts`
 * builds this from `fixtures/peaks/`; a test builds it from a literal.
 */
export type PeakLookup = (summitId: string) => Peak | undefined;

/**
 * Check the drawn summits against the committed peak data.
 *
 * Only the drawn ones. A withheld summit was never named to the user, so a
 * disagreement about its height claims nothing.
 */
function provenanceProblems(capture: Capture, peaks: PeakLookup): readonly string[] {
  const problems: string[] = [];
  for (const summit of capture.overlay.drawn) {
    const peak = peaks(summit.summitId);
    if (peak === undefined) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} (${summit.name}) is not in the committed peak data`,
      );
      continue;
    }
    if (peak.name !== summit.name) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} is drawn as "${summit.name}" and committed as "${peak.name}"`,
      );
    }
    const gapM = Math.abs(peak.elevationM - summit.elevationM);
    if (gapM > MAX_ELEVATION_DISAGREEMENT_M) {
      problems.push(
        `${capture.captureId}: ${summit.summitId} is drawn at ${summit.elevationM} m and committed at ${peak.elevationM} m, ${gapM.toFixed(0)} m apart`,
      );
    }
  }
  return problems;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 9 — The criteria
 * ══════════════════════════════════════════════════════════════════════════ */

function isGradable(capture: Capture): string | undefined {
  if (capture.fovSource !== 'calibrated') {
    return `${capture.captureId}: the field of view is a spec-sheet guess, so the scale term is unquantified and the capture is not graded (pre-registration § 1.3 term 6)`;
  }
  if (coverVisibleFraction(capture.overlayPx, capture.track) === undefined) {
    return `${capture.captureId}: the capture records no camera track size, so the crop the screen made cannot be recovered and an overlay pixel cannot be placed on the stored frame (pre-registration § 2.0)`;
  }
  const accuracyM = capture.horizontalAccuracyM;
  if (accuracyM !== undefined && accuracyM > MAX_OBSERVER_ACCURACY_M) {
    return `${capture.captureId}: the fix reports ${accuracyM.toFixed(1)} m of horizontal accuracy, over the ${MAX_OBSERVER_ACCURACY_M} m the protocol accepts, so the capture is not graded (pre-registration § 1.3 term 3a)`;
  }
  return undefined;
}

/**
 * Whether the overlay was drawn in the viewport the budget was computed on.
 *
 * Read from `overlayPx` and the pose, never from the stored frame: the stored
 * frame is a recording of the same scene at another size and carries none of
 * these terms.
 */
function viewportDeviation(capture: Capture): string | undefined {
  const hFovOff =
    Math.abs(capture.pose.hFovDeg - REGISTERED_VIEWPORT.hFovDeg) / REGISTERED_VIEWPORT.hFovDeg;
  const aspect = capture.overlayPx.widthPx / capture.overlayPx.heightPx;
  const aspectOff =
    Math.abs(aspect - REGISTERED_VIEWPORT.aspectRatio) / REGISTERED_VIEWPORT.aspectRatio;
  if (hFovOff <= FRAME_DEVIATION_TOLERANCE && aspectOff <= FRAME_DEVIATION_TOLERANCE) {
    return undefined;
  }
  return `${capture.captureId}: the overlay was drawn in a viewport ${(hFovOff * 100).toFixed(1)}% off the registered hFOV and ${(aspectOff * 100).toFixed(1)}% off its aspect, so the roll and scale terms were budgeted on a different viewport`;
}

/**
 * Whether the stored frame is one truth can be read off, § 2.0.
 *
 * Its aspect is checked against the camera track rather than against the
 * viewport, because the two are independent: a phone letterboxes a 16:9 stream
 * into whatever viewport Safari leaves, and the recording is still the whole
 * frame the track delivered.
 */
function storedFrameDeviations(capture: Capture): readonly string[] {
  const out: string[] = [];
  const { widthPx, heightPx } = capture.framePx;
  if (widthPx < REGISTERED_STORED_FRAME.minWidthPx) {
    out.push(
      `${capture.captureId}: the stored frame is ${widthPx} px across, under the registered ${REGISTERED_STORED_FRAME.minWidthPx} px, so an apex is placed more coarsely than the protocol registers`,
    );
  }
  const { width, height } = capture.track;
  // A capture with no track size never reaches here: `isGradable` refuses it,
  // because the crop the overlay was drawn over is unrecoverable without it.
  if (width <= 0 || height <= 0) return out;
  const trackAspect = width / height;
  const frameAspect = widthPx / heightPx;
  const off = Math.abs(frameAspect - trackAspect) / trackAspect;
  if (off > REGISTERED_STORED_FRAME.aspectTolerance) {
    out.push(
      `${capture.captureId}: the stored frame's aspect is ${(off * 100).toFixed(1)}% off the camera track's, so the frame was cropped or stretched on its way to the file and a truth pixel does not sit where the camera put it`,
    );
  }
  return out;
}

interface Observation {
  readonly capture: Capture;
  readonly summit: DrawnSummit;
  readonly truth: SummitTruth;
}

/**
 * One row of the graded table, or nothing when the summit's distance falls in no
 * band. The limits come from the capture, because a capture that reported its
 * own fix accuracy is graded against the budget that accuracy implies.
 */
function gradedSummitOf(
  capture: Capture,
  summit: DrawnSummit,
  truth: Extract<SummitTruth, { kind: 'located' }>,
): GradedSummit | undefined {
  const { apexPx, disagreementDeg: truthDisagreementDeg, landmark } = truth;
  const threshold = bandFor(summit.distanceKm);
  if (threshold === undefined) return undefined;
  const limits = bandLimitsFor(threshold, capture.horizontalAccuracyM);
  const residual = residualOf(capture, summit.summitPx, apexPx);
  if (residual === undefined) return undefined;
  const exceedances = exceedancesOf(residual, limits);
  return {
    captureId: capture.captureId,
    summitId: summit.summitId,
    name: summit.name,
    band: threshold.band,
    residual,
    frameOffset: frameOffsetFraction(apexPx.xPx, capture.framePx.widthPx),
    truthDisagreementDeg,
    ...(landmark !== undefined ? { landmark } : {}),
    withinThreshold: withinThreshold(residual, limits),
    exceedances,
    axesOverTwoSigma: exceedances.filter((axis) => axis.overTwoSigma).length,
    axesOverThreeSigma: exceedances.filter((axis) => axis.overThreeSigma).length,
  };
}

function observationsOf(
  captures: readonly Capture[],
  truth: FieldTruth,
): readonly Observation[] {
  const out: Observation[] = [];
  for (const capture of captures) {
    const index = truthIndex(truth, capture.captureId);
    for (const summit of capture.overlay.drawn) {
      const picks = index.get(summit.summitId);
      if (picks === undefined) continue;
      const reduced = reduceTruth(capture, picks);
      if (reduced === undefined) continue;
      out.push({ capture, summit, truth: reduced });
    }
  }
  return out;
}

/**
 * F2 — the raw error is a measurement, gated only on the displayed band.
 *
 * An axis whose band carries an unquantified term is a FLOOR, which the screen
 * already says, and a floor cannot be exceeded. Such an axis is recorded and
 * not gated, which is a pass for F2 and an open item in the report.
 */
function gradeF2(observations: readonly Observation[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let outside = 0;
  let notGated = 0;

  for (const { capture, summit, truth } of observations) {
    if (capture.role !== 'before-drag') continue;
    if (truth.kind !== 'located') continue;
    const residual = residualOf(capture, summit.summitPx, truth.apexPx);
    if (residual === undefined) continue;
    graded += 1;
    const band = capture.band;
    const axes: readonly {
      readonly name: string;
      readonly errorDeg: number;
      readonly bandDeg: number;
      readonly floor: boolean;
    }[] = [
      {
        name: 'across',
        errorDeg: Math.abs(residual.horizontalDeg),
        bandDeg: band.horizontalDeg,
        floor: band.hasUnquantifiedHorizontal,
      },
      {
        name: 'up/down',
        errorDeg: Math.abs(residual.verticalDeg),
        bandDeg: band.verticalDeg,
        floor: band.hasUnquantifiedVertical,
      },
    ];
    for (const axis of axes) {
      if (axis.floor) {
        notGated += 1;
        evidence.push(
          `${capture.captureId} ${summit.name} ${axis.name}: raw ${axis.errorDeg.toFixed(3)}° against a band of ${axis.bandDeg.toFixed(3)}° that carries an unquantified term — recorded, not gated`,
        );
        continue;
      }
      const inside = axis.errorDeg <= axis.bandDeg;
      if (!inside) outside += 1;
      evidence.push(
        `${capture.captureId} ${summit.name} ${axis.name}: raw ${axis.errorDeg.toFixed(3)}° against a band of ${axis.bandDeg.toFixed(3)}° — ${inside ? 'inside' : 'OUTSIDE'}`,
      );
    }
  }

  const claim = 'the band the app displays contains the error the app is making';
  if (graded === 0) {
    return {
      id: 'F2',
      claim,
      outcome: 'no-sample',
      n: 0,
      evidence: ['no before-drag capture carried a located summit'],
    };
  }
  return {
    id: 'F2',
    claim,
    outcome: outside === 0 ? 'pass' : 'fail',
    n: graded,
    evidence: [
      `${graded} summit-observation(s); ${outside} outside a band that carried only measured terms; ${notGated} axis-observation(s) recorded but not gated`,
      ...evidence,
    ],
  };
}

/** The smaller of the two ways round a circle, signed, in (−180, 180]. */
function signedHeadingDeltaDeg(fromDeg: number, toDeg: number): number {
  const delta = ((toDeg - fromDeg) % 360 + 540) % 360 - 180;
  return delta === -180 ? 180 : delta;
}

/**
 * What the compass alone said, before the person corrected it.
 *
 * The pose's heading is the compass reading plus the fine trim plus the gross
 * re-anchor offset, so subtracting the last two leaves the reading.
 */
export function sensedHeadingDeg(pose: CapturePose): number {
  const raw = pose.headingDeg - pose.trimHeadingDeg - pose.grossHeadingOffsetDeg;
  return ((raw % 360) + 360) % 360;
}

/**
 * F2 at the pose — the raw compass reading against the heading truth solves for.
 *
 * F2 on the drawn markers cannot see a gross compass error. A quarter-turn error
 * puts every summit somewhere the annotators find nothing, so the criterion has
 * no located summit to grade and reports `no-sample`; and once the person
 * re-anchors, the markers land on the summits and it passes, with the 92° the
 * compass was out of nowhere in the verdict. That error is the one the app most
 * needs to report honestly, so it is graded here instead, on the pose:
 *
 *   sensed  — the heading the compass alone gave ({@link sensedHeadingDeg}).
 *   solved  — the heading the located summits put the camera at
 *             ({@link solvePoseFromTruth}), which no compass reading enters.
 *
 * The gate is § 2.2's, on the horizontal axis alone: the displayed band's
 * horizontal half-width, and `recorded-not-gated` when that axis carries an
 * unquantified term, because a floor cannot be exceeded. The vertical axis is
 * not graded here — the solve reports the pitch it found, and the pitch zero
 * point is what the home session measures.
 */
function gradeF2Pose(observations: readonly Observation[]): Criterion {
  const claim =
    'the band the app displays contains the error in the heading the compass alone reported';
  const located = new Map<string, { capture: Capture; pairs: { drawnPx: PixelPoint; truthPx: PixelPoint }[] }>();
  for (const { capture, summit, truth } of observations) {
    if (capture.role !== 'before-drag') continue;
    if (truth.kind !== 'located') continue;
    const entry = located.get(capture.captureId) ?? { capture, pairs: [] };
    entry.pairs.push({ drawnPx: summit.summitPx, truthPx: truth.apexPx });
    located.set(capture.captureId, entry);
  }

  const evidence: string[] = [];
  let graded = 0;
  let outside = 0;
  let notGated = 0;
  let thin = 0;
  for (const [captureId, { capture, pairs }] of located) {
    if (pairs.length < MIN_SUMMITS_FOR_POSE_SOLVE) {
      thin += 1;
      evidence.push(
        `${captureId}: ${pairs.length} located summit(s), and it takes ${MIN_SUMMITS_FOR_POSE_SOLVE} to solve a heading — no sample`,
      );
      continue;
    }
    const solved = solvePoseFromTruth(capture, pairs);
    if (solved === undefined) {
      thin += 1;
      evidence.push(`${captureId}: the located summits do not separate a heading from a pitch`);
      continue;
    }
    const sensed = sensedHeadingDeg(capture.pose);
    const differenceDeg = Math.abs(signedHeadingDeltaDeg(solved.headingDeg, sensed));
    const bandDeg = capture.band.horizontalDeg;
    const offset = capture.pose.grossHeadingOffsetDeg;
    const shared =
      `${captureId}: compass alone ${sensed.toFixed(3)}°, solved from ${solved.summitCount} located summit(s) ` +
      `${solved.headingDeg.toFixed(3)}° (pitch ${solved.pitchDeg.toFixed(3)}°), apart by ${differenceDeg.toFixed(3)}°, ` +
      `with a gross offset of ${offset.toFixed(3)}° from ${capture.pose.grossHeadingSource}`;
    graded += 1;
    if (capture.band.hasUnquantifiedHorizontal) {
      notGated += 1;
      evidence.push(
        `${shared}, against a band of ${bandDeg.toFixed(3)}° that carries an unquantified term — recorded, not gated`,
      );
      continue;
    }
    const inside = differenceDeg <= bandDeg;
    if (!inside) outside += 1;
    evidence.push(
      `${shared}, against a band of ${bandDeg.toFixed(3)}° — ${inside ? 'inside' : 'OUTSIDE'}`,
    );
  }

  if (graded === 0) {
    return {
      id: 'F2.pose',
      claim,
      outcome: 'no-sample',
      n: 0,
      evidence:
        thin === 0
          ? ['no before-drag capture carried a located summit']
          : evidence,
    };
  }
  return {
    id: 'F2.pose',
    claim,
    outcome: outside === 0 ? 'pass' : 'fail',
    n: graded,
    evidence: [
      `${graded} capture(s); ${outside} whose compass sat outside a band that carried only measured terms; ${notGated} recorded but not gated`,
      ...evidence,
    ],
  };
}

/**
 * Grade the after-drag residuals of whichever captures `select` picks.
 *
 * The verdict is the band's, not the summit's. Every summit is reported against
 * the 2σ band it was budgeted for, and the band fails only when more than
 * {@link MAX_TWO_SIGMA_EXCEEDANCES} summit-axes sit past 2σ, or when any one
 * sits past 3σ. A single 2σ exceedance is what a correct budget produces at this
 * n, so treating it as a failure would grade the sample size.
 */
function gradePositional(
  id: string,
  claim: string,
  observations: readonly Observation[],
  select: (capture: Capture) => boolean,
): readonly Criterion[] {
  const rows: GradedSummit[] = [];
  const disputed: string[] = [];
  const excluded: string[] = [];
  /** Drawn summits per band, whatever their truth. The stop rule counts these. */
  const drawnPerBand = new Map<BandId, number>();

  for (const { capture, summit, truth } of observations) {
    if (!select(capture)) continue;
    const drawnBand = bandFor(summit.distanceKm);
    if (drawnBand !== undefined) {
      drawnPerBand.set(drawnBand.band, (drawnPerBand.get(drawnBand.band) ?? 0) + 1);
    }
    if (truth.kind === 'disputed') {
      disputed.push(`${capture.captureId} ${summit.name}: truth disputed — ${truth.why}`);
      continue;
    }
    if (truth.kind === 'excluded') {
      excluded.push(`${capture.captureId} ${summit.name}: ${truth.why}`);
      continue;
    }
    if (truth.kind !== 'located') continue;
    const row = gradedSummitOf(capture, summit, truth);
    if (row !== undefined) rows.push(row);
  }

  const criteria: Criterion[] = PREREGISTERED_THRESHOLDS.map((threshold) => {
    const band = rows.filter((row) => row.band === threshold.band);
    const drawn = drawnPerBand.get(threshold.band) ?? 0;
    const overTwoSigma = band.reduce((count, row) => count + row.axesOverTwoSigma, 0);
    const overThreeSigma = band.reduce((count, row) => count + row.axesOverThreeSigma, 0);
    const failed = overThreeSigma > 0 || overTwoSigma > MAX_TWO_SIGMA_EXCEEDANCES;
    const underStopRule = band.length < MIN_GRADED_PER_BAND;
    const evidence = band.map((row) => {
      const across = row.exceedances[0];
      const upDown = row.exceedances[1];
      const flag =
        row.axesOverThreeSigma > 0
          ? ' — OVER 3σ'
          : row.axesOverTwoSigma > 0
            ? ' — over 2σ'
            : '';
      const mark = row.landmark === undefined ? '' : ` [landmark: ${row.landmark}]`;
      return `${row.captureId} ${row.name}: ${Math.abs(row.residual.horizontalDeg).toFixed(3)}° across (2σ ${across?.twoSigmaDeg.toFixed(2) ?? '?'}°, 3σ ${across?.threeSigmaDeg.toFixed(2) ?? '?'}°), ${Math.abs(row.residual.verticalDeg).toFixed(3)}° up/down (2σ ${upDown?.twoSigmaDeg.toFixed(2) ?? '?'}°, 3σ ${upDown?.threeSigmaDeg.toFixed(2) ?? '?'}°), at ${(row.frameOffset * 100).toFixed(0)}% of the half-frame, truth ±${row.truthDisagreementDeg.toFixed(3)}°${mark}${flag}`;
    });
    // The stop rule withholds a pass, never a failure: one summit past 3σ
    // refutes the budget whatever the sample size (§ 2.0).
    const stopRuleLine =
      drawn === 0
        ? 'no summit was drawn in this band, so there was nothing for the truth instrument to settle'
        : `${band.length} of ${drawn} drawn summit-observation(s) in this band were graded, under the pre-registered floor of ${MIN_GRADED_PER_BAND}; the truth instrument limited this row, not the app (§ 2.0 stop rule)`;
    return {
      id: `${id}.${threshold.band}`,
      claim: `${claim} (${threshold.band}: ${threshold.fromKm}${Number.isFinite(threshold.toKm) ? `–${threshold.toKm}` : '+'} km)`,
      outcome: failed ? 'fail' : underStopRule ? 'no-sample' : 'pass',
      n: band.length,
      evidence:
        band.length === 0
          ? [stopRuleLine]
          : [
              band.length === 1 ? 'n = 1' : `n = ${band.length}`,
              ...(underStopRule ? [stopRuleLine] : []),
              `${overTwoSigma} summit-axis/axes past 2σ (${MAX_TWO_SIGMA_EXCEEDANCES} tolerated), ${overThreeSigma} past 3σ (none tolerated)`,
              ...evidence,
            ],
    };
  });

  if (disputed.length > 0) {
    criteria.push({
      id: `${id}.truth-disputed`,
      claim: 'summits the two annotators did not agree on, excluded from grading',
      outcome: 'no-sample',
      n: disputed.length,
      evidence: disputed,
    });
  }
  if (excluded.length > 0) {
    criteria.push({
      id: `${id}.truth-unidentifiable`,
      claim: 'summits an annotator could not identify, excluded from grading',
      outcome: 'no-sample',
      n: excluded.length,
      evidence: excluded,
    });
  }
  return criteria;
}

/**
 * Whether each moved capture performed the registered movement.
 *
 * A pan is registered as "pan until the anchor summit sits at the frame edge",
 * so what is checked is where the anchor was drawn: its normalised horizontal
 * offset must reach {@link PAN_ANCHOR_EDGE_OFFSET} of the half-frame. The offset
 * is read from the overlay as drawn, which is the same thing the person saw. The
 * pan in degrees is recorded in the bundle and not gated: how far the phone had
 * to turn depends on where the anchor started.
 */
function gradeF4Envelope(captures: readonly Capture[]): readonly string[] {
  const problems: string[] = [];
  const byId = new Map(captures.map((capture) => [capture.captureId, capture]));
  for (const capture of captures) {
    if (capture.role !== 'moved') continue;
    const pan = capture.panFromReferenceDeg;
    const tilt = capture.tiltFromReferenceDeg;
    if (pan !== undefined && pan !== 0) {
      const from =
        capture.movedFromCaptureId === undefined
          ? undefined
          : byId.get(capture.movedFromCaptureId);
      const anchorId = capture.dragAnchorSummitId ?? from?.dragAnchorSummitId;
      const anchor = capture.overlay.drawn.find((summit) => summit.summitId === anchorId);
      if (anchor === undefined) {
        problems.push(
          `${capture.captureId}: panned, but the drag anchor is not among the summits this capture drew, so the pan target cannot be read`,
        );
      } else {
        const offset = frameOffsetFraction(anchor.summitPx.xPx, capture.overlayPx.widthPx);
        if (offset < PAN_ANCHOR_EDGE_OFFSET) {
          problems.push(
            `${capture.captureId}: panned until the anchor sat at ${offset.toFixed(2)} of the half-frame, short of the registered ${PAN_ANCHOR_EDGE_OFFSET}`,
          );
        }
      }
    }
    if (tilt !== undefined && tilt !== 0) {
      const size = Math.abs(tilt);
      if (size < TILT_ENVELOPE_DEG.min || size > TILT_ENVELOPE_DEG.max) {
        problems.push(
          `${capture.captureId}: tilted ${size.toFixed(1)}°, outside the registered ${TILT_ENVELOPE_DEG.min}–${TILT_ENVELOPE_DEG.max}° envelope`,
        );
      }
    }
  }
  return problems;
}

/**
 * F5a — a summit drawn `visible` that both annotators say is not there.
 *
 * Only an agreed `absent` convicts. A summit an annotator could not identify is
 * excluded and counted, because "I cannot tell" is not evidence that the
 * mountain is missing: a hazy foothill nobody can name would otherwise be graded
 * as a fabricated label.
 */
function gradeF5a(observations: readonly Observation[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let falseVisible = 0;
  let unidentifiable = 0;

  for (const { capture, summit, truth } of observations) {
    if (summit.visibility !== 'visible') continue;
    if (truth.kind === 'excluded') {
      unidentifiable += 1;
      evidence.push(
        `${capture.captureId} ${summit.name}: drawn visible, ${truth.why}; excluded from F5a`,
      );
      continue;
    }
    graded += 1;
    if (truth.kind === 'absent') {
      falseVisible += 1;
      evidence.push(
        `${capture.captureId} ${summit.name}: drawn visible, and both annotators say it is not in the frame (${truth.reasons.join(', ')}) — FALSE VISIBLE`,
      );
    } else if (truth.kind === 'disputed') {
      evidence.push(
        `${capture.captureId} ${summit.name}: drawn visible, truth disputed — ${truth.why}; counted in neither direction`,
      );
    }
  }

  const excludedLine = `${unidentifiable} summit(s) drawn visible were excluded because an annotator could not identify them`;
  return {
    id: 'F5a',
    claim: 'no summit is drawn `visible` that is not in the picture',
    outcome: graded === 0 ? 'no-sample' : falseVisible === 0 ? 'pass' : 'fail',
    n: graded,
    evidence:
      graded === 0
        ? ['no summit was drawn visible in any capture with a truth that grades', excludedLine]
        : [`${graded} summit(s) drawn visible; ${falseVisible} false`, excludedLine, ...evidence],
  };
}

/** F5b — the three most prominent predicted summits each carry a name. */
function gradeF5b(captures: readonly Capture[]): Criterion {
  const evidence: string[] = [];
  let graded = 0;
  let failures = 0;

  for (const capture of captures) {
    const ranked = [...capture.overlay.drawn].sort(
      (a, b) =>
        b.altitudeDeg - a.altitudeDeg ||
        b.elevationM - a.elevationM ||
        (a.summitId < b.summitId ? -1 : a.summitId > b.summitId ? 1 : 0),
    );
    const top = ranked.slice(0, PROMINENT_LABEL_COUNT);
    if (top.length < PROMINENT_LABEL_COUNT) {
      evidence.push(
        `${capture.captureId}: only ${top.length} summit(s) predicted in frame, fewer than the ${PROMINENT_LABEL_COUNT} the criterion ranks`,
      );
      continue;
    }
    graded += 1;
    const unnamed = top.filter((summit) => !summit.labelled);
    if (unnamed.length > 0) failures += 1;
    // The apparent height itself is not printed: with a committed summit height
    // it gives the distance, and three distances to named summits are a fix.
    evidence.push(
      `${capture.captureId}: top ${PROMINENT_LABEL_COUNT} by apparent height are ${top.map((summit) => `${summit.name}${summit.labelled ? '' : ' (UNNAMED)'}`).join(', ')}`,
    );
  }

  return {
    id: 'F5b',
    claim: `the ${PROMINENT_LABEL_COUNT} most prominent predicted summits each carry a name`,
    outcome: graded === 0 ? 'no-sample' : failures === 0 ? 'pass' : 'fail',
    n: graded,
    evidence: graded === 0 ? evidence : [`${graded} capture(s); ${failures} failing`, ...evidence],
  };
}

/** F5c — every summit beyond the swept terrain is `unmeasured` and undrawn. */
function gradeF5c(captures: readonly Capture[]): Criterion {
  const evidence: string[] = [];
  let failures = 0;

  for (const capture of captures) {
    for (const summit of capture.overlay.drawn) {
      if (summit.distanceKm > capture.sweepRadiusKm) {
        failures += 1;
        evidence.push(
          `${capture.captureId} ${summit.name}: drawn with a verdict from beyond the swept terrain — FABRICATED`,
        );
      }
    }
    const beyond = capture.overlay.withheld.filter(
      (summit) => summit.distanceKm > capture.sweepRadiusKm,
    );
    for (const summit of beyond) {
      if (summit.reason !== 'unmeasured') {
        failures += 1;
        evidence.push(
          `${capture.captureId} ${summit.name}: beyond the swept terrain but withheld as "${summit.reason}" rather than unmeasured`,
        );
      }
    }
    evidence.push(
      `${capture.captureId}: ${beyond.length} summit(s) beyond the sweep, ${beyond.filter((summit) => summit.reason === 'unmeasured').length} reported unmeasured`,
    );
  }

  return {
    id: 'F5c',
    claim: 'every summit beyond the swept terrain is reported unmeasured and drawn nowhere',
    outcome: captures.length === 0 ? 'no-sample' : failures === 0 ? 'pass' : 'fail',
    n: captures.length,
    evidence,
  };
}

/**
 * Grade a run against the pre-registered criteria.
 *
 * F1 and F6 are stopwatch numbers recorded by the person on site and are not
 * computed here.
 */
export function analyseFieldRun(
  bundle: FieldBundle,
  truth: FieldTruth,
  peaks: PeakLookup,
): FieldAnalysis {
  const refusals: string[] = [];
  const notes: string[] = [];
  const gradable: Capture[] = [];
  for (const capture of bundle.captures) {
    const refusal = isGradable(capture);
    if (refusal !== undefined) {
      refusals.push(refusal);
      continue;
    }
    const deviation = viewportDeviation(capture);
    if (deviation !== undefined) notes.push(deviation);
    notes.push(...storedFrameDeviations(capture));
    notes.push(...provenanceProblems(capture, peaks));
    gradable.push(capture);
  }

  const observations = observationsOf(gradable, truth);
  const criteria: Criterion[] = [
    gradeF2(observations),
    gradeF2Pose(observations),
    ...gradePositional(
      'F3',
      'after one drag, every labelled summit sits within the budget',
      observations,
      (capture) => capture.role === 'after-drag',
    ),
    ...gradePositional(
      'F4',
      'the drag holds after a pan and a tilt',
      observations,
      (capture) => capture.role === 'moved',
    ),
    gradeF5a(observations),
    gradeF5b(gradable),
    gradeF5c(gradable),
  ];

  const envelope = gradeF4Envelope(gradable);
  if (envelope.length > 0) {
    criteria.push({
      id: 'F4.envelope',
      claim:
        'the movements performed were the registered pan to the anchor at the frame edge and ±10° tilt',
      outcome: 'fail',
      n: envelope.length,
      evidence: envelope,
    });
  }

  const graded: GradedSummit[] = [];
  for (const { capture, summit, truth: reduced } of observations) {
    if (capture.role === 'before-drag' || reduced.kind !== 'located') continue;
    const row = gradedSummitOf(capture, summit, reduced);
    if (row !== undefined) graded.push(row);
  }

  const landmarkObservations = graded.flatMap((row) =>
    row.landmark === undefined
      ? []
      : [`${row.captureId} ${row.name}: apex taken from ${row.landmark}`],
  );

  return {
    device: bundle.device,
    captureCount: bundle.captures.length,
    criteria,
    graded,
    annotatorMethods: annotatorMethodLines(truth),
    landmarkObservations,
    refusals,
    notes,
  };
}

/**
 * What each annotator was given, one line each.
 *
 * An annotator who worked under two methods across the session gets a line per
 * method, because the two readings are not the same instrument.
 */
function annotatorMethodLines(truth: FieldTruth): readonly string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const capture of truth.captures) {
    for (const reading of capture.readings) {
      const key = `${reading.annotatorId}\u0000${reading.method}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push(
        `${reading.annotatorId}: ${reading.method} — ${ANNOTATOR_METHOD_DESCRIPTIONS[reading.method]}`,
      );
    }
  }
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 10 — Reporting, with no coordinates in it
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Render the analysis as lines of text.
 *
 * Nothing here prints a distance or a bearing. A distance and a bearing to a
 * named summit is a position fix, and a report is the artefact most likely to be
 * pasted somewhere. Bands are named, not measured, and a test asserts the
 * rendered lines hold no distance.
 */
export function renderFieldReport(analysis: FieldAnalysis, options: { brief?: boolean } = {}): readonly string[] {
  const lines: string[] = [];
  lines.push(`device:   ${analysis.device}`);
  lines.push(`captures: ${analysis.captureCount}`);
  lines.push(`graded:   ${analysis.graded.length} summit-observation(s)`);
  if (analysis.annotatorMethods.length > 0) {
    lines.push('');
    lines.push('what each annotator was given:');
    for (const line of analysis.annotatorMethods) lines.push(`  · ${line}`);
  }
  if (analysis.landmarkObservations.length > 0) {
    lines.push('');
    lines.push('located from a named point feature, reported apart:');
    for (const line of analysis.landmarkObservations) lines.push(`  △ ${line}`);
  }
  if (analysis.refusals.length > 0) {
    lines.push('');
    lines.push('not graded:');
    for (const refusal of analysis.refusals) lines.push(`  ! ${refusal}`);
  }
  if (analysis.notes.length > 0) {
    lines.push('');
    lines.push('graded, with a caveat:');
    for (const note of analysis.notes) lines.push(`  ~ ${note}`);
  }
  lines.push('');

  const widths = {
    id: Math.max(8, ...analysis.criteria.map((criterion) => criterion.id.length)),
    outcome: Math.max(7, ...analysis.criteria.map((criterion) => criterion.outcome.length)),
  };
  lines.push(`${'criterion'.padEnd(widths.id)}  ${'outcome'.padEnd(widths.outcome)}  n`);
  lines.push(`${'─'.repeat(widths.id)}  ${'─'.repeat(widths.outcome)}  ─`);
  for (const criterion of analysis.criteria) {
    lines.push(
      `${criterion.id.padEnd(widths.id)}  ${criterion.outcome.padEnd(widths.outcome)}  ${criterion.n}`,
    );
  }

  if (options.brief !== true) {
    for (const criterion of analysis.criteria) {
      lines.push('');
      lines.push(`${criterion.id} — ${criterion.claim}`);
      lines.push(`  outcome: ${criterion.outcome}  [n = ${criterion.n}]`);
      for (const line of criterion.evidence) lines.push(`  · ${line}`);
    }
  }

  const failed = analysis.criteria.filter((criterion) => criterion.outcome === 'fail');
  const noSample = analysis.criteria.filter((criterion) => criterion.outcome === 'no-sample');
  lines.push('');
  lines.push(
    `${analysis.criteria.length - failed.length - noSample.length} passed, ${failed.length} failed, ${noSample.length} without a sample` +
      (failed.length === 0 ? '' : `; failing: ${failed.map((criterion) => criterion.id).join(', ')}`),
  );
  lines.push(
    'A pass means nothing here contradicts the error budget at this n. One site, one session, one phone.',
  );
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SECTION 11 — The synthesiser
 * ══════════════════════════════════════════════════════════════════════════ */

/** One summit in a synthetic capture, with its error injected in pixels. */
export interface SynthSummit {
  readonly summitId: string;
  readonly name: string;
  readonly elevationM: number;
  readonly distanceKm: number;
  readonly altitudeDeg: number;
  /** Where the two annotators put the apex, in stored-frame pixels. */
  readonly truthPx: PixelPoint;
  /** The drawn marker's displacement from the truth, in stored-frame pixels. */
  readonly errorPx: PixelPoint;
  readonly visibility?: 'visible' | 'marginal' | 'self-occluded';
  readonly labelled?: boolean;
  /** How far the second annotator's pick sits from the first's, pixels. */
  readonly annotatorSplitPx?: PixelPoint;
  /** Both annotators report the summit absent, for this reason. */
  readonly truthAbsent?: AbsentReason;
  /** The first locates it and the second calls it absent, which disputes the truth. */
  readonly truthSecondAbsent?: AbsentReason;
  /** One annotator, or both, cannot identify it, which excludes it from grading. */
  readonly truthCannotIdentify?: 'both' | 'second';
  /** Both annotators name this point feature as what they took the apex from. */
  readonly landmark?: string;
}

export interface SynthCapture {
  readonly captureId: string;
  readonly role: CaptureRole;
  readonly summits: readonly SynthSummit[];
  readonly withheld?: readonly WithheldSummit[];
  readonly sweepRadiusKm?: number;
  readonly fovSource?: 'calibrated' | 'spec-sheet-guess';
  readonly band?: DisplayedBand;
  readonly panFromReferenceDeg?: number;
  readonly tiltFromReferenceDeg?: number;
  readonly framePx?: { readonly widthPx: number; readonly heightPx: number };
  readonly overlayPx?: { readonly widthPx: number; readonly heightPx: number };
  /** Defaults to the stored frame's own size, which is what a whole frame is. */
  readonly track?: TrackGeometry;
  readonly hFovDeg?: number;
  readonly vFovDeg?: number;
  readonly horizontalAccuracyM?: number;
  /** The pose's pitch. Defaults to {@link SYNTH_PITCH_DEG}. */
  readonly pitchDeg?: number;
  /** The re-anchor correction already inside the pose's heading. Defaults to 0. */
  readonly grossHeadingOffsetDeg?: number;
  /** Defaults to `'sensors'`, and to `'sun'` when an offset is given. */
  readonly grossHeadingSource?: GrossHeadingSource;
}

export interface SynthSpec {
  readonly device?: string;
  readonly captures: readonly SynthCapture[];
  /** What the two annotators were given. Defaults to the bare frame for both. */
  readonly annotatorMethods?: readonly [AnnotatorMethod, AnnotatorMethod];
  /** Emitted when any capture carries an accuracy, which the parser requires. */
  readonly accuracyConvention?: typeof ACCURACY_CONFIDENCE;
}

/** The § 2.0 stored frame and the § 1.2 viewport, as synthesiser defaults. */
const SYNTH_FRAME = { widthPx: 1920, heightPx: 884 } as const;
const SYNTH_OVERLAY = { widthPx: 956, heightPx: 440 } as const;
const SYNTH_HFOV = 73.74;
const SYNTH_VFOV = 38.088;
const SYNTH_PITCH_DEG = 0.5;

/**
 * Build a bundle and its truth document from injected pixel errors.
 *
 * It does no angle arithmetic at all: a truth apex is a pixel, the drawn marker
 * is that pixel plus a stated offset, and the expected residual in degrees is
 * written out as a literal in the test from the tangent relation. So the grader
 * is never graded against its own conversion.
 */
export function synthesiseFieldBundle(spec: SynthSpec): {
  readonly bundle: FieldBundle;
  readonly truth: FieldTruth;
} {
  const captures: Capture[] = [];
  const truthCaptures: CaptureTruth[] = [];

  spec.captures.forEach((synth, index) => {
    const framePx = synth.framePx ?? SYNTH_FRAME;
    const overlayPx = synth.overlayPx ?? SYNTH_OVERLAY;
    const track = synth.track ?? {
      width: framePx.widthPx,
      height: framePx.heightPx,
      frameRate: 30,
      facingMode: 'environment',
    };
    const xScale = overlayPx.widthPx / framePx.widthPx;
    const yScale = overlayPx.heightPx / framePx.heightPx;
    // A frame pixel put back where the screen would have drawn it: the inverse
    // of the grader's `overlayToFramePx`, so a marker placed `errorPx` from an
    // apex is `errorPx` from it when the grader reads the bundle back. The
    // synthesiser still does no angle arithmetic — what those pixels are worth
    // in degrees is written out in the tests.
    const fraction = coverVisibleFraction(overlayPx, track) ?? { x: 1, y: 1 };
    const toOverlayPx = (point: PixelPoint): PixelPoint => ({
      xPx: ((point.xPx - (framePx.widthPx * (1 - fraction.x)) / 2) / fraction.x) * xScale,
      yPx: ((point.yPx - (framePx.heightPx * (1 - fraction.y)) / 2) / fraction.y) * yScale,
    });

    const drawn: DrawnSummit[] = synth.summits.map((summit) => ({
      summitId: summit.summitId,
      name: summit.name,
      elevationM: summit.elevationM,
      distanceKm: summit.distanceKm,
      altitudeDeg: summit.altitudeDeg,
      visibility: summit.visibility ?? 'visible',
      summitPx: toOverlayPx({
        xPx: summit.truthPx.xPx + summit.errorPx.xPx,
        yPx: summit.truthPx.yPx + summit.errorPx.yPx,
      }),
      labelled: summit.labelled ?? true,
    }));

    const first: ApexAnnotation[] = [];
    const second: ApexAnnotation[] = [];
    for (const summit of synth.summits) {
      const { summitId } = summit;
      if (summit.truthCannotIdentify === 'both') {
        first.push({ summitId, cannotIdentify: true });
        second.push({ summitId, cannotIdentify: true });
        continue;
      }
      if (summit.truthAbsent !== undefined) {
        first.push({ summitId, absent: true, reason: summit.truthAbsent });
        second.push({ summitId, absent: true, reason: summit.truthAbsent });
        continue;
      }
      const split = summit.annotatorSplitPx ?? { xPx: 0, yPx: 0 };
      const landmark = summit.landmark !== undefined ? { landmark: summit.landmark } : {};
      // The two picks straddle the truth, so their midpoint is the truth exactly.
      first.push({
        summitId,
        apexPx: {
          xPx: summit.truthPx.xPx - split.xPx / 2,
          yPx: summit.truthPx.yPx - split.yPx / 2,
        },
        ...landmark,
      });
      if (summit.truthCannotIdentify === 'second') {
        second.push({ summitId, cannotIdentify: true });
      } else if (summit.truthSecondAbsent !== undefined) {
        second.push({ summitId, absent: true, reason: summit.truthSecondAbsent });
      } else {
        second.push({
          summitId,
          apexPx: {
            xPx: summit.truthPx.xPx + split.xPx / 2,
            yPx: summit.truthPx.yPx + split.yPx / 2,
          },
          ...landmark,
        });
      }
    }

    captures.push({
      captureId: synth.captureId,
      role: synth.role,
      tMs: (index + 1) * 60_000,
      framePath: `f${index + 1}.jpg`,
      framePx,
      overlayPx,
      pose: {
        headingDeg: 280,
        pitchDeg: synth.pitchDeg ?? SYNTH_PITCH_DEG,
        rollDeg: 0,
        hFovDeg: synth.hFovDeg ?? SYNTH_HFOV,
        vFovDeg: synth.vFovDeg ?? SYNTH_VFOV,
        headingBasis: 'true-model',
        trimHeadingDeg: synth.role === 'before-drag' ? 0 : -1.25,
        trimPitchDeg: synth.role === 'before-drag' ? 0 : 0.4,
        grossHeadingOffsetDeg: synth.grossHeadingOffsetDeg ?? 0,
        grossHeadingSource:
          synth.grossHeadingSource ??
          (synth.grossHeadingOffsetDeg === undefined || synth.grossHeadingOffsetDeg === 0
            ? 'sensors'
            : 'sun'),
      },
      trace: {
        headingSpreadDeg: 0.2,
        pitchSpreadDeg: 0.15,
        rollSpreadDeg: 0.3,
        sampleCount: 40,
        stillForMs: 2400,
        compassAccuracyDeg: 8,
        tickCount: 22,
        longestTickGapMs: 90,
      },
      track,
      fovSource: synth.fovSource ?? 'calibrated',
      sweepRadiusKm: synth.sweepRadiusKm ?? 60,
      band: synth.band ?? {
        horizontalDeg: 8.5,
        verticalDeg: 0.15,
        hasUnquantifiedHorizontal: false,
        hasUnquantifiedVertical: false,
      },
      overlay: { drawn, withheld: synth.withheld ?? [] },
      ...(synth.role === 'before-drag' ? {} : { dragAnchorSummitId: synth.summits[0]?.summitId ?? 'none' }),
      ...(synth.role === 'moved' ? { movedFromCaptureId: 'c2' } : {}),
      ...(synth.panFromReferenceDeg !== undefined
        ? { panFromReferenceDeg: synth.panFromReferenceDeg }
        : {}),
      ...(synth.tiltFromReferenceDeg !== undefined
        ? { tiltFromReferenceDeg: synth.tiltFromReferenceDeg }
        : {}),
      ...(synth.horizontalAccuracyM !== undefined
        ? { horizontalAccuracyM: synth.horizontalAccuracyM }
        : {}),
    });

    const [methodA, methodB] = spec.annotatorMethods ?? ['bare-frame', 'bare-frame'];
    truthCaptures.push({
      captureId: synth.captureId,
      readings: [
        { annotatorId: 'agent-a', method: methodA, apexes: first },
        { annotatorId: 'agent-b', method: methodB, apexes: second },
      ],
    });
  });

  return {
    bundle: {
      format: BUNDLE_FORMAT,
      timestampBasis: TIMESTAMP_BASIS,
      device: spec.device ?? 'synthetic/not-a-real-browser',
      peakRegions: ['idaho-bogus-basin'],
      captures,
      ...(captures.some((capture) => capture.horizontalAccuracyM !== undefined) ||
      spec.accuracyConvention !== undefined
        ? { accuracyConvention: ACCURACY_CONFIDENCE }
        : {}),
    },
    truth: {
      format: TRUTH_FORMAT,
      procedure:
        'Synthetic. Apex pixels were placed, not read; the two readings straddle the placed pixel so their midpoint is it exactly.',
      captures: truthCaptures,
    },
  };
}
