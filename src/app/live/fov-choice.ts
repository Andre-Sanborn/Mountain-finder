/**
 * What field of view the overlay is scaled by, and how honestly it is labelled.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A LOOKED-UP FIGURE IS A GUESS HERE
 * ═══════════════════════════════════════════════════════════════════════════
 * "The field of view the overlay uses is measured, not looked up"
 * (IMPLEMENTATION.md, "The route to the field test"). Apple publishes a field
 * of view for each rear lens, but what `getUserMedia` delivers is a video crop
 * at a resolution Safari chooses, and that is not the still-photo field. Then
 * `object-fit: cover` crops it again (see `video-box.ts`). Two crops, neither
 * of them published.
 *
 * So there are exactly two states, and the screen always says which one it is
 * in:
 *
 *   `'calibrated'`        a value measured on this phone against the sun or a
 *                         landmark sweep, stored against the track settings it
 *                         was measured at
 *   `'spec-sheet-guess'`  a focal length off the spec sheet, labelled
 *                         "uncalibrated FOV" on screen
 *
 * There is no third kind of answer and no silent default. A guess drawn without
 * its label is the failure mode: the overlay would look authoritative at
 * whatever scale the guess happened to give.
 *
 * What there is, before the camera has delivered a frame, is NO answer:
 * {@link resolveFov} returns `undefined` for a frame with no extent rather than
 * inventing a field of view for a picture that does not exist yet.
 *
 * ── WHY THE PHONE MODEL IS CHOSEN, NOT DETECTED ────────────────────────────
 * iOS Safari's user-agent string says "iPhone" and nothing more; it does not
 * carry the model. A fingerprint built from screen size and pixel ratio would
 * need a table of logical resolutions per model, and this repository has not
 * verified one — inventing plausible numbers to look up a guess with is worse
 * than asking. So the model is a picker with a stated default, the presets are
 * the spec-sheet focal lengths recorded in IMPLEMENTATION.md, and every one of
 * them is reported as a guess.
 *
 * The stored calibration is keyed to the TRACK SETTINGS rather than to the
 * chosen model, because the track is what the value was measured against. A
 * phone that opens a different resolution gets no stored value and falls back
 * to the guess, which is the correct behaviour: the old measurement does not
 * describe the new crop.
 *
 * Pure, apart from {@link readStoredFovCalibration} and
 * {@link writeStoredFovCalibration}, which are the two functions that touch
 * `localStorage` and are the only ones in this module that can throw-and-be-caught.
 */

import { fovDegFromFocalLength35mm } from '../../core/projection';
import type { TrackSettingsLike } from './lens-log';
import { croppedFovDeg, type FieldOfViewDeg } from './video-box';

/** One rear lens of one phone: its 35 mm-equivalent focal length. */
export interface LensPreset {
  /** What the phone's own camera UI calls it, e.g. `'1x'`. */
  readonly label: string;
  readonly focalLength35mm: number;
}

export interface PhoneModelPreset {
  readonly modelName: string;
  readonly lenses: readonly LensPreset[];
}

/**
 * Spec-sheet focal lengths, transcribed from IMPLEMENTATION.md ("The fix: one
 * rule for focal length to field of view" and "The portrait field-of-view bug
 * on the phone").
 *
 * The human's current phone is the 17 Pro Max, per the EXIF of six of the nine
 * real photo fixtures, so it is first and is the default. `'Some other phone'`
 * is not a cop-out: a 26 mm main camera is the common case across phones this
 * app has no spec sheet for, and offering it as an explicit unknown is more
 * honest than silently applying one phone's numbers to another's.
 */
export const PHONE_MODEL_PRESETS: readonly PhoneModelPreset[] = [
  {
    modelName: 'iPhone 17 Pro Max',
    lenses: [
      { label: '0.5x ultrawide', focalLength35mm: 13 },
      { label: '1x main', focalLength35mm: 24 },
      { label: '2x', focalLength35mm: 48 },
      { label: '4x', focalLength35mm: 100 },
      { label: '8x', focalLength35mm: 200 },
    ],
  },
  {
    modelName: 'iPhone 15 Pro Max',
    lenses: [
      { label: '0.5x ultrawide', focalLength35mm: 13 },
      { label: '1x main', focalLength35mm: 24 },
      { label: '2x', focalLength35mm: 48 },
      { label: '5x', focalLength35mm: 120 },
    ],
  },
  {
    modelName: 'Some other phone',
    lenses: [{ label: '1x main', focalLength35mm: 26 }],
  },
];

/** The model and lens the screen starts on. */
export const DEFAULT_MODEL_NAME = 'iPhone 17 Pro Max';
export const DEFAULT_LENS_LABEL = '1x main';

/** Look a preset up by name, or the default when the name is unknown. */
export function phoneModelPreset(modelName: string): PhoneModelPreset {
  const found = PHONE_MODEL_PRESETS.find((preset) => preset.modelName === modelName);
  if (found !== undefined) return found;
  const fallback = PHONE_MODEL_PRESETS.find((preset) => preset.modelName === DEFAULT_MODEL_NAME);
  // PHONE_MODEL_PRESETS is a literal with at least one entry, so the last
  // branch is unreachable; it exists because the index type says otherwise.
  return fallback ?? { modelName, lenses: [{ label: '1x main', focalLength35mm: 26 }] };
}

/** Look a lens up within a model, or that model's first lens. */
export function lensPreset(preset: PhoneModelPreset, lensLabel: string): LensPreset {
  const found = preset.lenses.find((lens) => lens.label === lensLabel);
  if (found !== undefined) return found;
  return preset.lenses[0] ?? { label: '1x main', focalLength35mm: 26 };
}

/**
 * The key a calibration is stored under.
 *
 * The track's own identity and the frame it delivers, because those are what
 * the measurement describes. A missing field becomes the literal `'unknown'`
 * rather than being dropped, so two different gaps cannot collide on one key.
 */
export function fovCalibrationKey(settings: TrackSettingsLike): string {
  const part = (value: string | number | undefined): string =>
    value === undefined || value === '' ? 'unknown' : String(value);
  return `${part(settings.deviceId)}|${part(settings.width)}x${part(settings.height)}`;
}

/** `localStorage` key holding every calibration this origin has stored. */
export const FOV_STORE_KEY = 'mountain-finder.live.fov-calibration.v1';

/** One measured field of view, and what it was measured against. */
export interface FovCalibration {
  /** Horizontal field of view of the WHOLE decoded frame, degrees. */
  readonly frameHFovDeg: number;
  /** Decoded frame the measurement applies to. */
  readonly frameWidthPx: number;
  readonly frameHeightPx: number;
  /** How it was measured, in the operator's own words. */
  readonly method: string;
}

/**
 * Parse the stored blob.
 *
 * Every field is checked, because the store is a string a previous version of
 * this app wrote and a user's browser may hold anything. An entry that fails a
 * check is dropped rather than repaired: a half-understood calibration is
 * indistinguishable from a guess, and a guess must be labelled as one.
 */
export function parseFovCalibrations(raw: unknown): Readonly<Record<string, FovCalibration>> {
  if (typeof raw !== 'string' || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, FovCalibration> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    const frameHFovDeg = entry.frameHFovDeg;
    const frameWidthPx = entry.frameWidthPx;
    const frameHeightPx = entry.frameHeightPx;
    const method = entry.method;
    if (
      typeof frameHFovDeg !== 'number' ||
      !Number.isFinite(frameHFovDeg) ||
      frameHFovDeg <= 0 ||
      frameHFovDeg >= 180 ||
      typeof frameWidthPx !== 'number' ||
      !(frameWidthPx > 0) ||
      typeof frameHeightPx !== 'number' ||
      !(frameHeightPx > 0) ||
      typeof method !== 'string'
    ) {
      continue;
    }
    out[key] = { frameHFovDeg, frameWidthPx, frameHeightPx, method };
  }
  return out;
}

/** Where the field of view in use came from. */
export type FovSource = 'calibrated' | 'spec-sheet-guess';

export interface ResolvedFov {
  readonly source: FovSource;
  /** Field of view of the whole decoded camera frame. */
  readonly frameFov: FieldOfViewDeg;
  /** Field of view of the visible box, after the `cover` crop. */
  readonly visibleFov: FieldOfViewDeg;
  /** What the screen prints beside the numbers. */
  readonly label: string;
  /** Present on the guess path: which spec sheet the guess came from. */
  readonly guessedFrom?: { readonly modelName: string; readonly lensLabel: string; readonly focalLength35mm: number };
  /** Present on the calibrated path. */
  readonly calibration?: FovCalibration;
}

export interface ResolveFovInput {
  /** The decoded camera frame, `videoWidth × videoHeight`. */
  readonly decodedFrame: { readonly widthPx: number; readonly heightPx: number };
  /** Visible fraction per axis, from {@link videoBoxGeometry}. */
  readonly visibleFraction: { readonly x: number; readonly y: number };
  readonly modelName: string;
  readonly lensLabel: string;
  /** The stored calibration for this track, when there is one. */
  readonly calibration?: FovCalibration | undefined;
}

/**
 * The field of view to draw with, labelled — or `undefined` when there is no
 * frame to have one.
 *
 * A stored calibration is used only when it was measured on a frame of the same
 * size as the one now arriving. A calibration from a 1920×1080 stream says
 * nothing about a 1280×720 one, and quietly reusing it would put a measured
 * label on a number that is not a measurement of this crop.
 *
 * A component renders before `getUserMedia` resolves and again before the first
 * frame is decoded, so `videoWidth` is 0 twice. `undefined` is the honest answer
 * there: the caller shows "waiting for the camera" and draws nothing, where a
 * zero or a guessed field would put labels over a black rectangle.
 */
export function resolveFov(input: ResolveFovInput): ResolvedFov | undefined {
  const { decodedFrame, visibleFraction, calibration } = input;
  if (
    !(decodedFrame.widthPx > 0) ||
    !(decodedFrame.heightPx > 0) ||
    !Number.isFinite(decodedFrame.widthPx) ||
    !Number.isFinite(decodedFrame.heightPx)
  ) {
    return undefined;
  }
  const matches =
    calibration !== undefined &&
    calibration.frameWidthPx === decodedFrame.widthPx &&
    calibration.frameHeightPx === decodedFrame.heightPx;

  if (calibration !== undefined && matches) {
    const frameFov: FieldOfViewDeg = {
      hFovDeg: calibration.frameHFovDeg,
      vFovDeg: otherAxis(calibration.frameHFovDeg, decodedFrame.widthPx, decodedFrame.heightPx),
    };
    return {
      source: 'calibrated',
      frameFov,
      visibleFov: croppedFovDeg(frameFov, visibleFraction),
      label: `Calibrated field of view — ${calibration.method}`,
      calibration,
    };
  }

  const preset = phoneModelPreset(input.modelName);
  const lens = lensPreset(preset, input.lensLabel);
  const frameFov = fovDegFromFocalLength35mm(
    lens.focalLength35mm,
    decodedFrame.widthPx,
    decodedFrame.heightPx,
  );
  return {
    source: 'spec-sheet-guess',
    frameFov,
    visibleFov: croppedFovDeg(frameFov, visibleFraction),
    label:
      `Uncalibrated FOV — a guess from the ${preset.modelName}'s ${lens.label} lens ` +
      `(${lens.focalLength35mm} mm equivalent). A browser video stream is a crop of the ` +
      'photo frame, so the real field is not the published one. Label spacing is unproven ' +
      'until it is calibrated.',
    guessedFrom: {
      modelName: preset.modelName,
      lensLabel: lens.label,
      focalLength35mm: lens.focalLength35mm,
    },
  };
}

/** The vertical field of a frame from its horizontal one, tangent relation. */
function otherAxis(hFovDeg: number, widthPx: number, heightPx: number): number {
  const RAD = Math.PI / 180;
  return (2 * Math.atan(Math.tan((hFovDeg * RAD) / 2) * (heightPx / widthPx))) / RAD;
}

/** Structurally what `localStorage` offers, so a test can pass a fake. */
export interface WebStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Read the stored calibrations.
 *
 * Every access is wrapped: `localStorage` throws outright in a Safari private
 * window and when a browser is set to block site data, and a thrown getter must
 * not take the AR screen down with it. An unreadable store is the same state as
 * an empty one — no calibration, so the guess is used and labelled.
 */
export function readStoredFovCalibration(
  storage: WebStorageLike | undefined,
  key: string,
): FovCalibration | undefined {
  if (storage === undefined) return undefined;
  try {
    return parseFovCalibrations(storage.getItem(FOV_STORE_KEY))[key];
  } catch {
    return undefined;
  }
}

/** Store one calibration, leaving the others alone. Failures are swallowed. */
export function writeStoredFovCalibration(
  storage: WebStorageLike | undefined,
  key: string,
  calibration: FovCalibration,
): boolean {
  if (storage === undefined) return false;
  try {
    const all = parseFovCalibrations(storage.getItem(FOV_STORE_KEY));
    storage.setItem(FOV_STORE_KEY, JSON.stringify({ ...all, [key]: calibration }));
    return true;
  } catch {
    return false;
  }
}
