/**
 * The layout pass: scene → pixel geometry, with no strings involved.
 *
 * Splitting layout from serialisation is what makes the hard part of P4.1
 * testable. A test that wants to know where the Matterhorn's flag lands asks
 * {@link layoutOverlay} for a number and compares it against a hand-computed
 * one; it does not go fishing for a substring in an SVG document. The SVG
 * builder on the other side of this boundary has no geometry left in it worth
 * getting wrong.
 *
 * ## Label collision avoidance
 *
 * On a real skyline peaks cluster. A 60° frame over the Pennine Alps can put
 * six named summits inside 200 px, and the naive overlay — every label pinned
 * the same distance above its dot — renders them as one illegible smear. So
 * overlap is the default outcome, and avoiding it is a designed behaviour with
 * a stated rule rather than a lucky one:
 *
 * 1. Markers are placed in a **deterministic order**: by apparent height,
 *    highest first, ties broken by elevation and then by peak id (see
 *    {@link compareLabelPriority}). Deterministic ordering is the whole game —
 *    the same scene must lay out identically every run, or a snapshot test is
 *    worthless and a rendered PNG is unreproducible. Priority rather than
 *    left-to-right so that the summit dominating the view gets first claim on
 *    the space around it; the *returned* markers are then sorted left to right,
 *    which is the reading order of the picture.
 * 2. Each marker gets a **reserved box**: the label's estimated extent plus
 *    padding, centred on its pole and clamped inside the frame margins.
 * 3. A marker takes the **first free candidate placement** from a fixed list:
 *    pole lengths increasing by one `stackStepPx` at a time, first upward
 *    (levels 0…N−1), then downward. Upward is preferred because summits sit
 *    against sky and the space above them is usually empty; downward exists so
 *    that a peak near the top edge of the frame, where there is no room above,
 *    still gets a legible label instead of one jammed against the border.
 * 4. `stackStepPx` defaults to a full label height plus padding, so a level
 *    bump clears a neighbour **whose summit sits at the same height**. It does
 *    not clear every neighbour unconditionally: each pole is measured from its
 *    own summit, so where summits differ in y a bump can still land a label
 *    partly across a lower peak's. That is why step 3 tests the actual boxes
 *    instead of trusting the arithmetic — the search simply moves to the next
 *    level, and a level can be skipped. What is guaranteed is the *outcome*
 *    (disjoint boxes), never a particular level index.
 * 5. If nothing is free, the label is **withheld**: the summit keeps its dot,
 *    joins `crowdedOutSummits`, and is counted on the image. The overlay still
 *    never drops a peak — losing a summit silently would be a lie about what is
 *    in the photograph — but "not lost" now means *reported*, not *drawn on top
 *    of a neighbour*. Drawing it there costs the legible label underneath and
 *    buys nothing the count does not already give. `overlapped` survives for
 *    one case only, and it is not crowding: a frame with no room for the label
 *    ANYWHERE (a label taller than the photo), where withholding would empty an
 *    overlay that has peaks in it.
 *
 * The consequence is a visible signature that tests assert on directly: a
 * cluster of near-collinear peaks comes out as a staircase of pole lengths
 * ordered by apparent height (with the occasional skipped rung), and two peaks
 * far apart in x both stay at level 0.
 *
 * ## What real peak density did to that, and the two rules added for it
 *
 * The rules above were designed and tested against handfuls of peaks. Then the
 * peak database went from three summits to 1 786 for the Zermatt region alone,
 * and they met a distribution they had never seen. Measured, from the
 * Gornergrat platform on a 1600 × 1200 frame at hFOV 65°, heading 355°: **74**
 * summits projected inside the frame, 21 of them flagged `overlapped`, 24 label
 * boxes genuinely intersecting, and poles up to **467 px** long. Nothing
 * crashed. The export was simply unreadable — a wall of text with a dozen
 * crossing poles, which is a worse failure than an error, because it still
 * looks like an answer.
 *
 * Two rules were added, and neither of them changes what a frame that fits
 * already did:
 *
 * 6. **A pole may not exceed `maxPoleLengthPx`** (default 0.3 × frame height).
 *    Step 3's candidate list stops at the last level that fits inside it. A
 *    label further from its dot than that is not a label for that dot any more
 *    — with twenty poles in the frame the reader cannot tell which one it
 *    belongs to — so extending the ladder past this point buys nothing and
 *    costs legibility everywhere it crosses.
 * 7. **A frame has a label budget** (`maxLabels`, default derived — see
 *    {@link labelSlotCapacity}). When more summits are in frame than the budget,
 *    they are RANKED and only the top of the ranking is named. The rest keep
 *    their summit dot, are returned in `crowdedOutSummits`, and are counted on
 *    the image itself. Nothing is silently lost: a summit is either labelled,
 *    dotted-and-reported, off-frame-and-reported, or refused by D8 and
 *    reported, and the four lists partition the input exactly.
 *
 * 8. **`alwaysLabelPeakIds` exempts a peak from both.** A summit the person has
 *    named is placed before every other label and spends no slot of the budget,
 *    so asking for it by name always puts it on the picture. Everything else
 *    lays out around it, and one more label in a crowded frame costs one of the
 *    ranked names, never the one that was asked for.
 *
 * Rule 5 used to read "place it anyway and flag `overlapped`", and that was
 * right when it was written: there was no channel through which a withheld name
 * could be reported, so an overlapping label was the only alternative to a
 * silent disappearance. `crowdedOutSummits` and the count drawn on the image
 * are that channel, so the reason has gone and the rule now withholds — and it
 * withholds **uniformly**, not only above capacity. Making it conditional was
 * measurably worse than either alternative: on the Gornergrat sweep, a frame of
 * 30 summits at heading 40° came out with 9 mutually colliding labels while a
 * fuller frame of 43 at heading 35° came out clean, because only the fuller one
 * crossed the threshold. A slightly emptier view must not render worse than a
 * fuller one.
 *
 * The ranking (see {@link compareLabelPriority}) is **apparent height** — the
 * altitude angle the summit rides at, which is the one quantity that combines
 * height and distance the way an eye does, and which is already computed for
 * every peak. It deliberately ignores `visibility`: a self-occluded summit is
 * ranked by how big it looks, exactly like any other, because ranking greyed
 * labels down would quietly undo decision D8 under cover of decluttering.
 * Foreground-occluded peaks are refused *before* ranking, so no priority rule
 * can promote one back into the picture.
 */

import { interpolateHorizonAltitudeDeg } from '../core/horizon';
import { cameraAxes, projectToImage } from '../core/projection';
import { isLabelled } from '../core/visibility';
import { clipPolylineToFrame, isInFrontOfCamera } from './geometry';
import { estimateTextWidthPx } from './text-metrics';
import type {
  LabelDirection,
  OverlayLayout,
  OverlayOptions,
  OverlayPeak,
  OverlayScene,
  PeakMarker,
  PointPx,
  RectPx,
  ResolvedOverlayOptions,
  UnlabelledSummit,
} from './types';

/** Line height as a multiple of font size. */
const LINE_HEIGHT_EM = 1.15;
/** Baseline offset from the top of a line, as a multiple of font size. */
const BASELINE_EM = 0.9;

/**
 * Half-width of the bearing window swept for the horizon line, as a multiple of
 * the horizontal field of view.
 *
 * Bigger than the obvious 0.5 because the frame's horizontal extent is only the
 * hFOV along the optical axis. Tilt the camera up and the top corners reach
 * *outside* that bearing range — a rectilinear frame is a rectangle on a plane,
 * not a wedge of bearings — so sweeping exactly the hFOV would leave the
 * skyline stopping short of the corners on any pitched shot. Sweeping half as
 * wide again and clipping to the frame costs a few dozen samples and removes
 * the whole class of problem.
 */
const HORIZON_SWEEP_FACTOR = 0.75;

/** Hard cap on the sweep half-width. Beyond this the tangent blows up. */
const HORIZON_SWEEP_MAX_HALF_DEG = 85;

/**
 * Default ceiling on pole length, as a fraction of the frame height.
 *
 * Chosen against the picture rather than against the arithmetic: at 0.3 a label
 * on a 1200 px frame is at most 360 px from its dot, which is still close
 * enough that the eye follows the pole in a frame holding a dozen of them.
 * The measured dense frame reached 467 px before this cap existed, and at that
 * length the association is gone.
 */
const MAX_POLE_HEIGHT_FRACTION = 0.3;

/**
 * Fraction of the frame's theoretical label slots that are actually usable.
 *
 * **Calibrated, not derived, and the calibration is the argument for it.** A
 * label is centred on its summit, and summits sit where the mountains are, so
 * the slots never tile: a busy column exhausts its rungs while the column
 * beside it stands empty. At 1.0 the measured Gornergrat scene still produced
 * 2–9 mutually colliding labels at headings 40°, 45° and 115°–170° — frames
 * holding 19–30 summits, where the budget did not bind and the placement search
 * ran out of room anyway. At 0.75 the budget binds on those frames and they
 * come out clean. Frames of 15 or fewer summits never needed it either way.
 *
 * It errs toward naming fewer summits and counting the rest, which is the safe
 * side: an unnamed dot is reported, an illegible label is not.
 */
const LABEL_PACKING_RATIO = 0.75;

/** Height of a label's reserved box for the given fonts and padding. */
export function labelBlockHeightPx(
  nameFontPx: number,
  detailFontPx: number,
  labelPaddingPx: number,
): number {
  return 2 * labelPaddingPx + LINE_HEIGHT_EM * (nameFontPx + detailFontPx);
}

/**
 * Fill in every unset option. Defaults scale with the image so a 1200 px
 * preview and a 4000 px export are the same picture at different sizes.
 */
export function resolveOverlayOptions(
  scene: OverlayScene,
  options: OverlayOptions = {},
): ResolvedOverlayOptions {
  const nameFontPx = options.nameFontPx ?? Math.max(12, Math.round(scene.heightPx * 0.022));
  const detailFontPx = options.detailFontPx ?? Math.max(9, Math.round(nameFontPx * 0.72));
  const labelPaddingPx = options.labelPaddingPx ?? Math.max(2, Math.round(nameFontPx * 0.35));
  const blockHeightPx = labelBlockHeightPx(nameFontPx, detailFontPx, labelPaddingPx);
  const basePoleLengthPx =
    options.basePoleLengthPx ?? Math.max(18, Math.round(scene.heightPx * 0.06));

  return {
    horizonSampleCount: options.horizonSampleCount ?? 240,
    showHorizon: options.showHorizon ?? true,
    nameFontPx,
    detailFontPx,
    basePoleLengthPx,
    // One whole label plus padding: a level bump is guaranteed to clear a
    // same-column neighbour rather than merely nudge it.
    stackStepPx: options.stackStepPx ?? Math.round(blockHeightPx + labelPaddingPx),
    maxStackLevels: options.maxStackLevels ?? 6,
    // Never below one base pole: on a very small frame the fraction would
    // otherwise forbid even level 0, and a marker with no label at all is a
    // worse answer than a slightly long pole.
    maxPoleLengthPx:
      options.maxPoleLengthPx ??
      Math.max(basePoleLengthPx, Math.round(scene.heightPx * MAX_POLE_HEIGHT_FRACTION)),
    maxLabels: options.maxLabels ?? 'auto',
    alwaysLabelPeakIds: options.alwaysLabelPeakIds ?? [],
    labelPaddingPx,
    labelGapPx: options.labelGapPx ?? 3,
    frameMarginPx: options.frameMarginPx ?? Math.max(2, Math.round(scene.widthPx * 0.01)),
    summitDotRadiusPx: options.summitDotRadiusPx ?? Math.max(2.5, nameFontPx * 0.13),
  };
}

/**
 * The words appended to an obscured peak's detail line.
 *
 * The label carries the state in TEXT as well as in ink, because opacity and
 * colour are both invisible to somebody reading a printed copy, a screenshot at
 * low contrast, or a screen reader working off the SVG's text nodes.
 */
export const OBSCURED_DETAIL_SUFFIX = 'summit obscured';

/**
 * The words for a marginal summit (P1.6): the near ground the verdict was
 * measured against is unresolvable, so "may be hidden" is the whole claim.
 */
export const MARGINAL_DETAIL_SUFFIX = 'may be hidden';

/**
 * Whether a peak is to be drawn de-emphasised — dashed pole, hollow ring,
 * reduced opacity. Two states earn it for two different reasons: a summit
 * tucked behind its own hill's shoulder (D8) is definitely there but not
 * itself in view, and a marginal summit (P1.6) may or may not clear the
 * unresolvable ground in front of the camera. Both are claims weaker than a
 * solid flag, and the ink says so; the DETAIL TEXT is what distinguishes them,
 * because opacity cannot carry two meanings and text can.
 */
export function isPeakObscured(peak: OverlayPeak): boolean {
  return peak.visibility === 'self-occluded' || peak.visibility === 'marginal';
}

/**
 * Elevation and distance, the second line of a label — plus, for a summit
 * hidden behind its own hill or one the near field leaves undecided, a note
 * saying which.
 */
export function formatPeakDetail(peak: OverlayPeak): string {
  const measurements = `${Math.round(peak.elevationM)} m · ${peak.distanceKm.toFixed(1)} km`;
  if (peak.visibility === 'marginal') return `${measurements} · ${MARGINAL_DETAIL_SUFFIX}`;
  return isPeakObscured(peak) ? `${measurements} · ${OBSCURED_DETAIL_SUFFIX}` : measurements;
}

/**
 * Which of two summits gets the label when only one of them can have it.
 *
 * **Apparent height first.** `altitudeDeg` is the angle the summit rides above
 * the observer's horizontal — the single number that combines elevation and
 * distance the way an eye does. A 4 500 m summit at 14 km outranks a 3 000 m
 * one at 42 km because it is genuinely the bigger thing in the frame, and a
 * near hill outranks a far one of the same height for the same reason. It is
 * already computed for every peak, needs no prominence figure (Overture carries
 * none) and no terrain, and it is the same quantity that decides the marker's y
 * position, so the ranking and the picture cannot disagree.
 *
 * Ties fall to the greater elevation, then to a plain code-unit comparison of
 * the id — never `localeCompare`, whose ordering depends on the host's locale
 * data and would make the same scene drop different summits on a different
 * machine.
 *
 * **What it deliberately does not look at: `visibility`.** Decision D8 says a
 * self-occluded summit is labelled, greyed. Ranking those below clear ones
 * whenever a frame is busy would repeal that decision by the back door, and
 * would do it invisibly, since a crowded frame is exactly when nobody notices
 * one more missing name. So a greyed summit competes on its height like any
 * other. Foreground-occluded peaks never reach this comparison at all — they
 * are refused in {@link layoutOverlay} before ranking begins.
 */
export function compareLabelPriority(a: OverlayPeak, b: OverlayPeak): number {
  if (a.altitudeDeg !== b.altitudeDeg) return b.altitudeDeg - a.altitudeDeg;
  if (a.elevationM !== b.elevationM) return b.elevationM - a.elevationM;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/**
 * How many stack levels the pole budget actually admits.
 *
 * A pole at level L is `basePoleLengthPx + L · stackStepPx` long, so the last
 * usable level is `⌊(maxPoleLengthPx − basePoleLengthPx) / stackStepPx⌋`, and
 * the count is one more than that. Never more than `maxStackLevels`, never less
 * than one — level 0 always exists, because a marker with nowhere to put its
 * label would be worse than a long pole.
 */
export function reachableStackLevels(options: ResolvedOverlayOptions): number {
  const declared = Math.max(1, Math.round(options.maxStackLevels));
  if (!(options.stackStepPx > 0)) return declared;
  const headroomPx = options.maxPoleLengthPx - options.basePoleLengthPx;
  if (!(headroomPx >= 0)) return 1;
  return Math.max(1, Math.min(declared, Math.floor(headroomPx / options.stackStepPx) + 1));
}

/**
 * How many labels this frame has room for.
 *
 * The frame is treated as a grid of label-sized slots: as many boxes as fit
 * side by side across the usable width, times as many rungs as the pole budget
 * admits (see {@link reachableStackLevels}). `meanLabelWidthPx` is measured
 * from the scene's own labels, so a frame full of long Swiss compound names
 * gets fewer slots than one full of short ones — which is the truth about how
 * much room there is.
 *
 * Two known inaccuracies pull in opposite directions and are stated rather than
 * hidden: the count ignores downward placements, which roughly halves it, and a
 * grid of slots is never fully usable, which {@link LABEL_PACKING_RATIO}
 * allows for. The residual is a deliberately conservative number — the failure
 * this exists to prevent is an unreadable frame, and erring toward "name fewer,
 * count the rest" is the safe side of that.
 */
export function labelSlotCapacity(
  frameWidthPx: number,
  meanLabelWidthPx: number,
  options: ResolvedOverlayOptions,
): number {
  const usableWidthPx = frameWidthPx - 2 * options.frameMarginPx;
  if (!(meanLabelWidthPx > 0) || !(usableWidthPx > 0)) return 1;
  const columns = Math.max(1, Math.floor(usableWidthPx / meanLabelWidthPx));
  const slots = columns * reachableStackLevels(options);
  return Math.max(1, Math.floor(LABEL_PACKING_RATIO * slots));
}

/** Strict rectangle intersection: rectangles that merely touch do not overlap. */
export function rectsOverlap(a: RectPx, b: RectPx): boolean {
  return (
    a.xPx < b.xPx + b.widthPx &&
    b.xPx < a.xPx + a.widthPx &&
    a.yPx < b.yPx + b.heightPx &&
    b.yPx < a.yPx + a.heightPx
  );
}

function clamp(value: number, low: number, high: number): number {
  if (high < low) return low;
  return Math.min(Math.max(value, low), high);
}

/**
 * Sample the terrain skyline across the frame and clip it to the image.
 *
 * The skyline is sampled uniformly in *bearing*, not in image column, because
 * bearing is what the horizon profile is a function of. Under roll or pitch the
 * projected curve is not a function of column at all, so a column-wise sweep
 * would have no well-defined answer to sample; a bearing sweep always does.
 */
export function buildHorizonPolylines(
  scene: OverlayScene,
  options: ResolvedOverlayOptions,
): readonly (readonly PointPx[])[] {
  if (!options.showHorizon || scene.horizon.length === 0) return [];
  const sampleCount = Math.max(2, Math.round(options.horizonSampleCount));

  const axes = cameraAxes(scene.pose);
  const halfWindowDeg = Math.min(
    scene.pose.hFovDeg * HORIZON_SWEEP_FACTOR,
    HORIZON_SWEEP_MAX_HALF_DEG,
  );
  const stepDeg = (2 * halfWindowDeg) / sampleCount;

  const samples: (PointPx | undefined)[] = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const bearingDeg = scene.pose.headingDeg - halfWindowDeg + index * stepDeg;
    const altitudeDeg = interpolateHorizonAltitudeDeg(scene.horizon, bearingDeg);
    if (!isInFrontOfCamera(scene.pose, bearingDeg, altitudeDeg, axes)) {
      samples.push(undefined);
      continue;
    }
    const point = projectToImage(scene.pose, bearingDeg, altitudeDeg);
    samples.push({ xPx: point.x * scene.widthPx, yPx: point.y * scene.heightPx });
  }

  return clipPolylineToFrame(samples, scene.widthPx, scene.heightPx);
}

/** A summit that projected inside the frame, before any label placement. */
interface Sighting {
  peak: OverlayPeak;
  summitPx: PointPx;
  nameText: string;
  detailText: string;
  labelWidthPx: number;
  labelHeightPx: number;
}

/** Mean reserved-box width across the scene's own labels. Zero for none. */
function meanLabelWidthPx(sightings: readonly Sighting[]): number {
  if (sightings.length === 0) return 0;
  let total = 0;
  for (const sighting of sightings) total += sighting.labelWidthPx;
  return total / sightings.length;
}

/** One placement being considered for a label. */
interface Candidate {
  direction: LabelDirection;
  level: number;
  boxPx: RectPx;
  poleTipPx: PointPx;
  /** False when the box had to be clamped vertically to stay inside the frame. */
  fitsVertically: boolean;
}

function makeCandidate(
  sighting: Sighting,
  direction: LabelDirection,
  level: number,
  scene: OverlayScene,
  options: ResolvedOverlayOptions,
): Candidate {
  const poleLengthPx = options.basePoleLengthPx + level * options.stackStepPx;
  const sign = direction === 'up' ? -1 : 1;
  const desiredTipYPx = sighting.summitPx.yPx + sign * poleLengthPx;

  const desiredBoxTopYPx =
    direction === 'up'
      ? desiredTipYPx - options.labelGapPx - sighting.labelHeightPx
      : desiredTipYPx + options.labelGapPx;

  const minTopYPx = options.frameMarginPx;
  const maxTopYPx = Math.max(
    minTopYPx,
    scene.heightPx - options.frameMarginPx - sighting.labelHeightPx,
  );
  const boxTopYPx = clamp(desiredBoxTopYPx, minTopYPx, maxTopYPx);

  const minLeftXPx = options.frameMarginPx;
  const maxLeftXPx = Math.max(
    minLeftXPx,
    scene.widthPx - options.frameMarginPx - sighting.labelWidthPx,
  );
  const boxLeftXPx = clamp(
    sighting.summitPx.xPx - sighting.labelWidthPx / 2,
    minLeftXPx,
    maxLeftXPx,
  );

  // When the box was clamped, the pole follows the label rather than the other
  // way round, so the flag stays visually attached to what it names.
  const tipYPx =
    direction === 'up'
      ? boxTopYPx + sighting.labelHeightPx + options.labelGapPx
      : boxTopYPx - options.labelGapPx;

  return {
    direction,
    level,
    boxPx: {
      xPx: boxLeftXPx,
      yPx: boxTopYPx,
      widthPx: sighting.labelWidthPx,
      heightPx: sighting.labelHeightPx,
    },
    poleTipPx: { xPx: sighting.summitPx.xPx, yPx: tipYPx },
    fitsVertically: Math.abs(boxTopYPx - desiredBoxTopYPx) < 1e-9,
  };
}

function markerFromCandidate(
  sighting: Sighting,
  candidate: Candidate,
  overlapped: boolean,
  options: ResolvedOverlayOptions,
): PeakMarker {
  const textTopYPx = candidate.boxPx.yPx + options.labelPaddingPx;
  return {
    peak: sighting.peak,
    summitPx: sighting.summitPx,
    poleTipPx: candidate.poleTipPx,
    labelCentreXPx: candidate.boxPx.xPx + candidate.boxPx.widthPx / 2,
    nameBaselineYPx: textTopYPx + BASELINE_EM * options.nameFontPx,
    detailBaselineYPx:
      textTopYPx + LINE_HEIGHT_EM * options.nameFontPx + BASELINE_EM * options.detailFontPx,
    labelBoxPx: candidate.boxPx,
    stackLevel: candidate.level,
    direction: candidate.direction,
    overlapped,
    obscured: isPeakObscured(sighting.peak),
    nameText: sighting.nameText,
    detailText: sighting.detailText,
  };
}

/**
 * Lay a scene out into pixel geometry.
 *
 * Peaks that project outside the frame — or behind the camera, which
 * `projectToImage` also reports as out of frame — are never drawn. They are
 * returned in `offFramePeaks` so the caller can account for them.
 */
export function layoutOverlay(
  scene: OverlayScene,
  options: OverlayOptions = {},
): OverlayLayout {
  const resolved = resolveOverlayOptions(scene, options);

  const sightings: Sighting[] = [];
  const offFramePeaks: OverlayPeak[] = [];
  const foregroundOccludedPeaks: OverlayPeak[] = [];

  for (const peak of scene.peaks) {
    // D8, enforced a second time. The pipeline already withholds these, but a
    // renderer that would draw one if handed one is a renderer one wiring
    // mistake away from naming a mountain nobody can see.
    if (peak.visibility !== undefined && !isLabelled(peak.visibility)) {
      foregroundOccludedPeaks.push(peak);
      continue;
    }
    const point = projectToImage(scene.pose, peak.bearingDeg, peak.altitudeDeg);
    if (!point.inFrame) {
      offFramePeaks.push(peak);
      continue;
    }
    const nameText = peak.name;
    const detailText = formatPeakDetail(peak);
    const textWidthPx = Math.max(
      estimateTextWidthPx(nameText, resolved.nameFontPx),
      estimateTextWidthPx(detailText, resolved.detailFontPx),
    );
    sightings.push({
      peak,
      summitPx: { xPx: point.x * scene.widthPx, yPx: point.y * scene.heightPx },
      nameText,
      detailText,
      labelWidthPx: textWidthPx + 2 * resolved.labelPaddingPx,
      labelHeightPx: labelBlockHeightPx(
        resolved.nameFontPx,
        resolved.detailFontPx,
        resolved.labelPaddingPx,
      ),
    });
  }

  // How many of them this frame can name. Everything past the budget keeps its
  // dot and is reported; nothing is dropped without being counted.
  const budget =
    resolved.maxLabels === 'auto'
      ? labelSlotCapacity(scene.widthPx, meanLabelWidthPx(sightings), resolved)
      : Math.max(0, Math.floor(resolved.maxLabels));

  // A forced peak is named whatever the budget says, and spends no slot of it.
  const forcedIds = new Set(resolved.alwaysLabelPeakIds);
  const forced = sightings.filter((sighting) => forcedIds.has(sighting.peak.id));
  const optional = sightings.filter((sighting) => !forcedIds.has(sighting.peak.id));

  const crowdedOutSummits: UnlabelledSummit[] = [];
  let labelled = sightings;
  if (optional.length > budget) {
    const ranked = [...optional].sort((a, b) => compareLabelPriority(a.peak, b.peak));
    labelled = [...forced, ...ranked.slice(0, budget)];
    for (const sighting of ranked.slice(budget)) {
      crowdedOutSummits.push({
        peak: sighting.peak,
        summitPx: sighting.summitPx,
        obscured: isPeakObscured(sighting.peak),
      });
    }
  }

  // Placement order is PRIORITY order: the summit that dominates the view gets
  // first claim on the space around it. Left to right was the old order, and it
  // handed the space to whatever happened to sit further west — so a 4 219 m
  // peak could lose its label to a jammed column beside it while a 3 250 m bump
  // kept one. Which is not a defensible thing to tell someone about their
  // photograph.
  //
  // `compareLabelPriority` ends in a plain code-unit comparison of the id —
  // never `localeCompare`, whose ordering depends on the host's locale data —
  // so the order is total, is fixed by the peaks themselves, and cannot depend
  // on the order the database happened to return them in.
  // Forced peaks go first, so the space around a summit the person named is
  // claimed before any ranking gets a say in it.
  const placement = [...labelled].sort((a, b) => {
    const aForced = forcedIds.has(a.peak.id);
    const bForced = forcedIds.has(b.peak.id);
    if (aForced !== bForced) return aForced ? -1 : 1;
    return compareLabelPriority(a.peak, b.peak);
  });

  const levels = reachableStackLevels(resolved);
  const directions: readonly LabelDirection[] = ['up', 'down'];
  const placed: RectPx[] = [];
  const markers: PeakMarker[] = [];

  for (const sighting of placement) {
    let fallback: Candidate | undefined;
    let chosen: Candidate | undefined;

    for (const direction of directions) {
      for (let level = 0; level < levels && chosen === undefined; level += 1) {
        const candidate = makeCandidate(sighting, direction, level, scene, resolved);
        if (!candidate.fitsVertically) continue;
        fallback ??= candidate;
        if (!placed.some((box) => rectsOverlap(box, candidate.boxPx))) {
          chosen = candidate;
        }
      }
      if (chosen !== undefined) break;
    }

    if (chosen === undefined && fallback !== undefined) {
      // There was room in the frame, and it was taken. Withhold the name: the
      // summit keeps its dot, joins `crowdedOutSummits` and is counted on the
      // image, so nothing has gone missing — and the legible label already
      // occupying that space keeps being legible.
      crowdedOutSummits.push({
        peak: sighting.peak,
        summitPx: sighting.summitPx,
        obscured: isPeakObscured(sighting.peak),
      });
      continue;
    }

    // `fallback === undefined` is a different failure entirely: not a full
    // frame but a frame with no room for this label ANYWHERE — a label taller
    // than the photo, or margins that swallow it. Withholding here would empty
    // the overlay of a scene that has peaks in it, so the marker is drawn at
    // the clamped level-0 placement and flagged `overlapped`. That is now the
    // only thing the flag means: degenerate geometry, never crowding.
    const candidate =
      chosen ?? fallback ?? makeCandidate(sighting, 'up', 0, scene, resolved);
    markers.push(markerFromCandidate(sighting, candidate, chosen === undefined, resolved));
    placed.push(candidate.boxPx);
  }

  // One order for the whole withheld list, whether a summit lost at selection
  // or at placement: highest-riding first, so a caller naming a few names the
  // ones a viewer is most likely to be pointing at.
  crowdedOutSummits.sort((a, b) => compareLabelPriority(a.peak, b.peak));

  // Placement order was a resource-allocation decision; report order is a
  // presentation one. Markers come back left to right — the reading order of
  // the picture, and the order a caller's "which peaks are in this photo?" list
  // wants to be in — with the same locale-free id tie-break.
  markers.sort((a, b) => {
    if (a.summitPx.xPx !== b.summitPx.xPx) return a.summitPx.xPx - b.summitPx.xPx;
    if (a.peak.id < b.peak.id) return -1;
    if (a.peak.id > b.peak.id) return 1;
    return 0;
  });

  return {
    widthPx: scene.widthPx,
    heightPx: scene.heightPx,
    horizonPolylinesPx: buildHorizonPolylines(scene, resolved),
    markers,
    offFramePeaks,
    foregroundOccludedPeaks,
    crowdedOutSummits,
    options: resolved,
  };
}
