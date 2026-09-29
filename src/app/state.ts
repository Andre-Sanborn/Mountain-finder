/**
 * The app's session state and everything derived from it — pure functions only.
 *
 * No React, no DOM, no fetch, no clock. The component tree in `App.tsx` holds
 * one `AppState` and renders `deriveSession(state)`; every interesting rule in
 * the app is therefore unit-testable in Node without a browser, which is why
 * `npm run check` can prove the trim arithmetic and the provenance handling
 * before Playwright ever starts.
 *
 * The pose itself is NOT modelled here. `resolvePose` (src/exif) already models
 * it properly — resolved-with-provenance or needs-manual-with-a-reason — and
 * re-implementing that in the UI layer is exactly how a UI ends up quietly
 * disagreeing with its core. This module only assembles the inputs and hands
 * them over.
 */

import type { CameraPose } from '../core/types';
import {
  resolvePose,
  STANDARD_DEFAULTS,
  type PhotoExif,
  type PoseField,
  type PoseInputs,
  type PoseResolution,
  type ResolveOptions,
} from '../exif';
import type { OverlayRequest } from './seam';
import { applyTrim, NO_TRIM, type TrimState } from './trim';

/** A photo that has been read into the page: its bytes decoded and EXIF parsed. */
export interface LoadedPhoto {
  readonly fileName: string;
  /** Object URL for the <img> tag and for the PNG compositor. */
  readonly url: string;
  /** Pixel size measured from the DECODED image, not from any EXIF tag. */
  readonly widthPx: number;
  readonly heightPx: number;
  /** Exactly what the file's EXIF claims — `{}` for a stripped photo. */
  readonly exif: PhotoExif;
}

export type PhotoStatus = 'empty' | 'reading' | 'ready' | 'error';

export interface AppState {
  readonly status: PhotoStatus;
  readonly photo?: LoadedPhoto;
  /** Name shown while a file is being read, and in the error message. */
  readonly pendingFileName?: string;
  readonly errorMessage?: string;
  /**
   * Raw text of every override input, keyed by field. Text rather than numbers
   * so that half-typed input ("-", "45.") neither snaps back nor is silently
   * read as a value.
   */
  readonly drafts: Readonly<Partial<Record<PoseField, string>>>;
  readonly declinationDraft: string;
  /** Opt-in to STANDARD_DEFAULTS. Off by default: assumptions are never silent. */
  readonly useStandardAssumptions: boolean;
  /**
   * Draw summits that are hidden behind their OWN hill, de-emphasised
   * (decision D8). ON by default, which is the user's call: the hill is
   * unmistakably in the photograph, so naming it is information rather than
   * invention. Turning it off leaves only summits whose own point clears the
   * ground in front of it.
   *
   * It is deliberately NOT a switch for "show hidden peaks" in general. A
   * summit behind a DIFFERENT landform is never drawn in either position — that
   * is not a display preference, it is the difference between a label and a
   * fabrication, and the pipeline settles it before the UI sees it.
   */
  readonly showObscuredPeaks: boolean;
  readonly trim: TrimState;
}

export const INITIAL_STATE: AppState = {
  status: 'empty',
  drafts: {},
  declinationDraft: '',
  useStandardAssumptions: false,
  showObscuredPeaks: true,
  trim: NO_TRIM,
};

export type Action =
  | { readonly type: 'photo-reading'; readonly fileName: string }
  | { readonly type: 'photo-loaded'; readonly photo: LoadedPhoto }
  | { readonly type: 'photo-failed'; readonly message: string }
  | { readonly type: 'photo-cleared' }
  | { readonly type: 'draft-changed'; readonly field: PoseField; readonly text: string }
  | { readonly type: 'draft-reverted'; readonly field: PoseField }
  | { readonly type: 'declination-changed'; readonly text: string }
  | { readonly type: 'assumptions-toggled'; readonly enabled: boolean }
  | { readonly type: 'obscured-peaks-toggled'; readonly enabled: boolean }
  | { readonly type: 'trim-changed'; readonly axis: keyof TrimState; readonly valueDeg: number }
  | { readonly type: 'trim-reset' };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'photo-reading':
      return { ...state, status: 'reading', pendingFileName: action.fileName };
    case 'photo-loaded':
      // A new photo resets the overrides and the trim: they described the old
      // photo, and carrying them over would silently attach one photo's
      // corrections to another's metadata.
      return {
        ...INITIAL_STATE,
        status: 'ready',
        photo: action.photo,
        useStandardAssumptions: state.useStandardAssumptions,
        showObscuredPeaks: state.showObscuredPeaks,
      };
    case 'photo-failed':
      return { ...state, status: 'error', errorMessage: action.message };
    case 'photo-cleared':
      return {
        ...INITIAL_STATE,
        useStandardAssumptions: state.useStandardAssumptions,
        showObscuredPeaks: state.showObscuredPeaks,
      };
    case 'draft-changed':
      return { ...state, drafts: { ...state.drafts, [action.field]: action.text } };
    case 'draft-reverted': {
      // Removing the key is NOT the same as setting it to '': an empty box is
      // still a box the user is editing, whereas reverting hands the field back
      // to whatever EXIF (or an assumption) had to say about it.
      const drafts = { ...state.drafts };
      delete drafts[action.field];
      return { ...state, drafts };
    }
    case 'declination-changed':
      return { ...state, declinationDraft: action.text };
    case 'assumptions-toggled':
      return { ...state, useStandardAssumptions: action.enabled };
    case 'obscured-peaks-toggled':
      return { ...state, showObscuredPeaks: action.enabled };
    case 'trim-changed':
      return { ...state, trim: { ...state.trim, [action.axis]: action.valueDeg } };
    case 'trim-reset':
      return { ...state, trim: NO_TRIM };
  }
}

/**
 * Read one override input. Blank means "no override" — NOT zero. Anything that
 * is not a finite number is reported separately as invalid rather than being
 * rounded down to "no override" without telling anyone.
 */
export function parseDraft(text: string | undefined): number | undefined {
  if (text === undefined) return undefined;
  const trimmed = text.trim();
  if (trimmed === '') return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** True for text a person typed that is not a usable number. */
export function isInvalidDraft(text: string | undefined): boolean {
  if (text === undefined) return false;
  const trimmed = text.trim();
  return trimmed !== '' && !Number.isFinite(Number(trimmed));
}

/**
 * What the obscured-peak switch is currently promising, in one sentence.
 *
 * Lives here rather than in the component for the same reason the pose fields'
 * provenance copy lives in `pose-fields.ts`: what the UI claims about the
 * system is a rule, it can be wrong, and a rule that can be wrong gets a test.
 * Both positions state the limit as well as the effect, because a control that
 * says "show hidden peaks" when the app will never show most of them is a
 * control that lies.
 */
export function obscuredPeaksNote(showObscuredPeaks: boolean): string {
  return showObscuredPeaks
    ? 'A summit tucked just behind its own hill is labelled and greyed. A peak ' +
        'hidden behind a different, nearer hill is never labelled either way.'
    : 'Only summits that clear the ground in front of them are labelled; one ' +
        'hidden behind its own hill is left off. A peak hidden behind a ' +
        'different, nearer hill is never labelled either way.';
}

/** Where the pixel dimensions in play came from. */
export interface DimensionInfo {
  readonly widthPx: number;
  readonly heightPx: number;
  /**
   * Always 'decoded': the size of the image actually loaded into the page is a
   * measurement of the pixels being displayed and exported, whereas EXIF
   * PixelXDimension is a claim that can describe a pre-crop original. When they
   * disagree, `exifDisagrees` says so instead of hiding it.
   */
  readonly source: 'decoded';
  readonly exifDisagrees: boolean;
}

export interface DerivedSession {
  readonly photo: LoadedPhoto;
  readonly resolution: PoseResolution;
  /** The overrides handed to `resolvePose`, for display and for tests. */
  readonly overrides: PoseInputs;
  readonly declinationDeg?: number;
  readonly dimensions: DimensionInfo;
  /** Fields still needing manual input, in POSE_FIELDS order. */
  readonly missing: readonly PoseField[];
  /** The pose as resolved, before the trim sliders. Present iff complete. */
  readonly basePose?: CameraPose;
  /** The pose the overlay will actually consume: `basePose` + trim. */
  readonly effectivePose?: CameraPose;
  /** Everything the pipeline needs. Present iff the pose is complete. */
  readonly overlayRequest?: OverlayRequest;
}

/**
 * The identity of one overlay request: two requests share a key exactly when
 * the same overlay answers both.
 *
 * It is the app's rebuild trigger and its staleness test at once, which is the
 * point of having one function for it. The overlay carries the key it was
 * built for; while a rebuild is in flight the overlay on screen carries the
 * previous pose's key, and that is what stops the export writing the old
 * labels into a new pose's PNG.
 *
 * `JSON.stringify` is enough because the request is built field by field by
 * `deriveSession` — same construction order every time, numbers and booleans
 * only — and the AbortSignal is attached after this is taken.
 */
export function overlayRequestKey(request: OverlayRequest | undefined): string {
  if (request === undefined) return '';
  const { frame, observer, pose, showObscuredPeaks } = request;
  return JSON.stringify([frame, observer, pose, showObscuredPeaks]);
}

/** What the export control needs before it can do anything. */
export interface ExportReadiness {
  readonly hasPhoto: boolean;
  readonly missingFieldCount: number;
  readonly hasOverlay: boolean;
  readonly hasExporter: boolean;
  /**
   * Was the overlay on screen built for the pose now in effect?
   *
   * False from the moment the pose changes until the rebuild it triggers
   * lands. The overlay still displayed through that window belongs to the
   * previous pose, and a PNG written from it would carry labels in the old
   * places under a pose readout showing the new ones — a picture nothing ever
   * computed. The photograph and the labels must come from one pose.
   */
  readonly overlayIsCurrent: boolean;
}

/**
 * Why the export button is disabled, or `undefined` when it is genuinely
 * usable. Kept pure and tested so the button's disabled state is an honest
 * statement about the system rather than a hopeful guess: you cannot export an
 * annotated photo before anything has annotated it.
 */
export function exportDisabledReason(readiness: ExportReadiness): string | undefined {
  if (!readiness.hasPhoto) return 'Load a photo first.';
  if (readiness.missingFieldCount > 0) {
    const subject = readiness.missingFieldCount === 1 ? 'field still needs' : 'fields still need';
    return `${String(readiness.missingFieldCount)} pose ${subject} manual input.`;
  }
  if (!readiness.hasExporter) {
    return 'This build has no PNG compositor.';
  }
  if (!readiness.hasOverlay) {
    return 'There is no overlay to export: the skyline for this photo has not been computed.';
  }
  if (!readiness.overlayIsCurrent) {
    return 'The skyline is being recomputed for the pose you just changed. The overlay on ' +
      'screen is still the previous pose\u2019s, so exporting now would save labels that do not ' +
      'belong to it.';
  }
  return undefined;
}

/** Build the `PoseInputs` the panel is currently asserting. */
export function overridesFromState(state: AppState, photo: LoadedPhoto): PoseInputs {
  const overrides: PoseInputs = {
    // Measured from the decoded image; see DimensionInfo for why this outranks
    // the EXIF dimension tags. Neither is a pose field, so no provenance is
    // being invented here.
    imageWidthPx: photo.widthPx,
    imageHeightPx: photo.heightPx,
  };
  for (const [field, text] of Object.entries(state.drafts)) {
    const value = parseDraft(text);
    if (value !== undefined) overrides[field as PoseField] = value;
  }
  return overrides;
}

/**
 * Everything the UI renders, derived from state alone.
 *
 * Returns undefined when no photo is loaded — there is nothing to resolve, and
 * inventing an empty resolution would put nine "needs input" rows on screen
 * before the user has done anything.
 */
export function deriveSession(state: AppState): DerivedSession | undefined {
  const photo = state.photo;
  if (photo === undefined) return undefined;

  const overrides = overridesFromState(state, photo);
  const declinationDeg = parseDraft(state.declinationDraft);

  const options: ResolveOptions = {};
  if (declinationDeg !== undefined) options.magneticDeclinationDeg = declinationDeg;
  if (state.useStandardAssumptions) options.defaults = STANDARD_DEFAULTS;
  // `assumeDirectionRefWhenMissing` is deliberately never set. An EXIF
  // direction with no true/magnetic reference is genuinely unusable, and the
  // honest recovery is for the user to type a heading they stand behind — the
  // raw direction is shown in the "what this photo claims" panel so they can.

  const resolution = resolvePose(photo.exif, overrides, options);

  const dimensions: DimensionInfo = {
    widthPx: photo.widthPx,
    heightPx: photo.heightPx,
    source: 'decoded',
    exifDisagrees:
      (photo.exif.imageWidthPx !== undefined && photo.exif.imageWidthPx !== photo.widthPx) ||
      (photo.exif.imageHeightPx !== undefined && photo.exif.imageHeightPx !== photo.heightPx),
  };

  const base: DerivedSession = {
    photo,
    resolution,
    overrides,
    dimensions,
    missing: resolution.missing,
  };
  const session = declinationDeg === undefined ? base : { ...base, declinationDeg };

  const basePose: CameraPose | undefined = resolution.cameraPose;
  const observer = resolution.observer;
  if (basePose === undefined || observer === undefined) return session;

  const effectivePose = applyTrim(basePose, state.trim);
  return {
    ...session,
    basePose,
    effectivePose,
    overlayRequest: {
      frame: { widthPx: photo.widthPx, heightPx: photo.heightPx },
      observer,
      pose: effectivePose,
      showObscuredPeaks: state.showObscuredPeaks,
    },
  };
}
