/**
 * The renderer's data contract: what a scene is, what knobs it exposes, and
 * what the layout pass produces.
 *
 * Nothing here has a method or a class. A scene is data, a layout is data, and
 * the SVG is a string — which is what makes the whole of P4.1 testable without
 * a browser, a canvas, or a screenshot.
 *
 * Units follow the project-wide rule from `src/core/types.ts`: pixel quantities
 * end in `Px`, metres in `M`, angles in `Deg`. Normalised [0,1] image space
 * never appears in this module's public surface — it is converted to pixels the
 * moment `projectToImage` returns, and the field names say so.
 */

import type { CameraPose, HorizonProfile, PeakVisibility, VisiblePeak } from '../core/types';

/**
 * A peak as the overlay receives it: the geometry `src/core` resolved, plus
 * what the pipeline decided about drawing it (decision D8).
 *
 * Additive by design — `VisiblePeak` is assignable to this, so every caller and
 * fixture that predates D8 keeps working and keeps meaning what it meant.
 * `visibility` is optional and DEFAULTS TO `'visible'`, which is the only safe
 * default: a caller that knows nothing about occlusion states is a caller
 * handing over peaks it has already decided to show.
 */
export interface OverlayPeak extends VisiblePeak {
  /**
   * `'visible'` (or absent) draws the marker at full strength.
   * `'self-occluded'` draws it de-emphasised — see {@link PeakMarker.obscured}.
   * `'foreground-occluded'` is NOT DRAWN: {@link layoutOverlay} moves it to
   * {@link OverlayLayout.foregroundOccludedPeaks} instead. The pipeline already
   * withholds these; the renderer refuses them again because "never name a
   * mountain that is not in the picture" is the one rule worth enforcing twice.
   */
  visibility?: PeakVisibility;
}

/** A point in image pixel space. x right, y down, origin at the top-left. */
export interface PointPx {
  xPx: number;
  yPx: number;
}

/** An axis-aligned rectangle in image pixel space. */
export interface RectPx {
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Everything the overlay is drawn from: how big the photograph is, where the
 * camera was pointing, what the terrain skyline does, and which summits
 * survived the visibility filter.
 *
 * The scene deliberately does not carry the photograph itself. The overlay is
 * an SVG that is composited over the image later (P4.2), which keeps this pass
 * pure and lets the same overlay be drawn over a photo, over a blank canvas for
 * a test, or over nothing at all for a snapshot.
 */
export interface OverlayScene {
  /** Photograph width in pixels. */
  widthPx: number;
  /** Photograph height in pixels. */
  heightPx: number;
  pose: CameraPose;
  /** Terrain skyline. May be empty — then no horizon line is drawn. */
  horizon: HorizonProfile;
  peaks: readonly OverlayPeak[];
}

/**
 * Tunable overlay parameters. Every field is optional; the defaults scale with
 * the image so that a 1200 px preview and a 4000 px export look the same.
 *
 * They are all exposed because the layout tests need to pin them: a test that
 * asserts "these two labels stack" must not silently change meaning when a
 * default font size is nudged.
 */
export interface OverlayOptions {
  /** Number of bearings sampled across the frame for the horizon polyline. */
  horizonSampleCount?: number;
  /** Draw the terrain skyline at all. Default true. */
  showHorizon?: boolean;
  /** Font size of the peak name line, px. Default `0.022 × heightPx`, min 12. */
  nameFontPx?: number;
  /** Font size of the elevation/distance line, px. Default `0.72 × nameFontPx`. */
  detailFontPx?: number;
  /** Length of an unstacked flag pole, px. Default `0.06 × heightPx`. */
  basePoleLengthPx?: number;
  /** Extra pole length added per stack level, px. Default: one label height. */
  stackStepPx?: number;
  /** How many stack levels are tried in each direction before giving up. Default 6. */
  maxStackLevels?: number;
  /**
   * Longest a flag pole may get, px. Default `0.3 × heightPx`, never less than
   * `basePoleLengthPx`.
   *
   * A hard ceiling on the *distance between a label and the summit it names*.
   * Stack levels alone do not bound that: six levels at a default step is more
   * than a third of the frame, and a measured dense frame (74 summits from the
   * Gornergrat) reached 467 px of pole in a 1200 px image. At that separation
   * the label has stopped naming anything — the reader cannot follow which of
   * a dozen crossing poles ends at which dot. The cap turns crowding into a
   * reported shortage of room instead of an unreadable ladder.
   */
  maxPoleLengthPx?: number;
  /**
   * How many labels this frame gets at most. Default `'auto'`.
   *
   * `'auto'` derives the budget from the frame itself — see
   * {@link labelSlotCapacity}. A number pins it; `0` labels nothing and reports
   * everything, which is a legitimate way to ask for markers with no names.
   *
   * Peaks beyond the budget are NOT lost: they keep a summit dot, they are
   * listed in {@link OverlayLayout.crowdedOutSummits}, and the SVG says how
   * many there are. Which peaks make the cut is decided by
   * {@link compareLabelPriority}, on apparent height alone — never on
   * visibility, so this cannot become a back door that quietly drops the greyed
   * labels of decision D8.
   */
  maxLabels?: number | 'auto';
  /**
   * Peaks that must be named whatever the budget says. Default none.
   *
   * A caller names a peak here when the person has asked for that summit by
   * name — the field session's drag anchor is the case this exists for. A
   * forced peak is exempt from the budget cut and is placed before every other
   * label, so it takes the space it needs and the rest lay out around it. It is
   * still subject to D8: a peak the pipeline refuses is never drawn.
   */
  alwaysLabelPeakIds?: readonly string[];
  /** Padding inside a label's reserved box, px. Default `0.35 × nameFontPx`. */
  labelPaddingPx?: number;
  /** Gap between the top of a pole and the bottom of its label, px. Default 3. */
  labelGapPx?: number;
  /** Keep-out margin at the frame edge for label boxes, px. Default `0.01 × widthPx`. */
  frameMarginPx?: number;
  /** Radius of the summit dot, px. Default `0.13 × nameFontPx`, min 2.5. */
  summitDotRadiusPx?: number;
}

/** {@link OverlayOptions} with every default filled in. */
export type ResolvedOverlayOptions = Required<OverlayOptions>;

/** Which way a label was pushed off its summit to find free space. */
export type LabelDirection = 'up' | 'down';

/**
 * A summit that is in the picture and gets a dot, but no name, because the
 * frame's label budget ran out.
 *
 * It carries a pixel position — unlike `offFramePeaks` and
 * `foregroundOccludedPeaks`, which are not drawn at all — precisely because
 * this one IS drawn. Dropping the name while keeping the dot is the honest
 * middle: the overlay still says "there is a named summit here", and the count
 * of unnamed dots is what makes an over-full frame look over-full instead of
 * looking like a view with twenty peaks in it.
 */
export interface UnlabelledSummit {
  peak: OverlayPeak;
  /** Projected summit position — where the dot goes. */
  summitPx: PointPx;
  /** True for a self-occluded summit (D8): drawn as a ring, not a disc. */
  obscured: boolean;
}

/**
 * One laid-out peak marker: a dot on the summit, a pole, and a label box.
 *
 * `stackLevel` and `direction` are part of the public shape on purpose. Label
 * collision avoidance is a *behaviour* this renderer promises, so the tests
 * assert on the decision itself ("the second-highest peak in this cluster went
 * to level 1") and not merely on the pixel side effects of it.
 */
export interface PeakMarker {
  peak: OverlayPeak;
  /** Projected summit position — where the dot goes. */
  summitPx: PointPx;
  /** Far end of the flag pole; the label sits just beyond it. */
  poleTipPx: PointPx;
  /** Horizontal centre of the label text, clamped inside the frame margins. */
  labelCentreXPx: number;
  /** Baseline of the name line. */
  nameBaselineYPx: number;
  /** Baseline of the elevation/distance line. */
  detailBaselineYPx: number;
  /** The box reserved against other labels. */
  labelBoxPx: RectPx;
  /** 0 for an unstacked marker; each level adds `stackStepPx` of pole. */
  stackLevel: number;
  direction: LabelDirection;
  /**
   * True when the frame had no room for this label ANYWHERE — a label taller
   * than the photograph, or margins that swallow it — so it was placed at the
   * clamped level-0 position and may sit on another.
   *
   * **This is no longer how crowding is reported.** A label that lost to a
   * neighbour is withheld, not overlapped: see
   * {@link OverlayLayout.crowdedOutSummits}. What remains here is degenerate
   * geometry, where withholding would empty an overlay that has peaks in it.
   * For every frame of a real photograph this is `false`.
   */
  overlapped: boolean;
  /**
   * True for a summit whose own hill hides it (D8) — drawn de-emphasised:
   * dashed pole, hollow summit ring, a "summit obscured" note in the detail
   * line, and reduced opacity on the bright marks only. Four channels, three of
   * them not colour, because a viewer who cannot separate the two colours must
   * still be able to separate the two states.
   */
  obscured: boolean;
  /** Peak name, unescaped. */
  nameText: string;
  /** Elevation and distance, e.g. `4478 m · 12.3 km`, unescaped. */
  detailText: string;
}

/** The complete result of the layout pass: pure geometry, no strings of SVG. */
export interface OverlayLayout {
  widthPx: number;
  heightPx: number;
  /**
   * The terrain skyline as one or more pixel-space polylines. More than one
   * when the line leaves and re-enters the frame, or crosses behind the camera.
   */
  horizonPolylinesPx: readonly (readonly PointPx[])[];
  /** Markers for the peaks that landed inside the frame, in draw order. */
  markers: readonly PeakMarker[];
  /**
   * Peaks that were dropped because they project outside the frame (or behind
   * the camera). Reported so the caller can say "3 peaks are off-frame to the
   * left" rather than silently losing them.
   */
  offFramePeaks: readonly OverlayPeak[];
  /**
   * Peaks refused because they are `'foreground-occluded'` — hidden behind a
   * different landform entirely. Reported rather than silently dropped, and
   * kept apart from `offFramePeaks` because the two say completely different
   * things: one is "outside the picture", the other is "inside the picture and
   * behind something else".
   */
  foregroundOccludedPeaks: readonly OverlayPeak[];
  /**
   * Summits inside the frame that got a dot but no label, because the frame's
   * label budget was already spent. Ordered by the priority that decided it —
   * highest apparent summit first — so a caller naming a few of them names the
   * ones a viewer is most likely to be asking about.
   *
   * Empty for every scene that fits, which is every scene the renderer handled
   * before real peak density arrived.
   */
  crowdedOutSummits: readonly UnlabelledSummit[];
  options: ResolvedOverlayOptions;
}
