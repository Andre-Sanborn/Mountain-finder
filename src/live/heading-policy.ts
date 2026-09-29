/**
 * What to DRAW when the compass cannot give true north.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT A WEAKENING OF THE MAGNETIC RULE
 * ═══════════════════════════════════════════════════════════════════════════
 * `sensors.ts` refuses a magnetic-only trace with `needs-declination`, and it
 * is right to: a magnetic bearing silently treated as true is worth 10–20° in
 * the mountains, and `src/exif/resolve.ts` refuses the same thing on the photo
 * path. The operative word in that rule has always been **silently**.
 *
 * The first mobile shell turned that refusal into "draw nothing", which is a
 * different and worse policy than the one D9 sets out. D9's whole finding is
 * that a label asserts a DIRECTION, not an identification, and that the right
 * answer to an uncertain pose is to draw the overlay, state the uncertainty,
 * and let the user drag it into place. Refusing to draw denies them the one
 * interaction that actually fixes the error — and it denies it hardest exactly
 * when the error is largest, which is backwards.
 *
 * So this module separates two questions that were wrongly fused:
 *
 *   "Is this heading TRUE?"          — the honesty question, still absolute
 *   "Is it good enough to draw?"     — the usefulness question
 *
 * A magnetic heading answers no to the first and yes to the second. It is
 * wrong by the local declination: a bounded, named, *systematic* quantity, not
 * an unknown one. In the contiguous US it runs from about 13° east on the west
 * coast to about 16° west in Maine, passing through zero somewhere near the
 * Mississippi; central Idaho, where this project's ground truth was
 * photographed, is near +12.8° east. Alaska reaches ~25° and high latitudes are
 * worse. Those magnitudes still sit inside the ±30° heading trim the user
 * already has, which is what makes dragging a fix rather than a workaround.
 *
 * What must never happen is the number reaching the user's eye *labelled* as
 * true north. Hence `basis`, which every caller has to look at to get the
 * heading out, and `caveat`, which is written for a screen rather than a log.
 *
 * ── THE FIELD MODEL, AND WHY IT IS A THIRD BASIS ───────────────────────────
 * The declination is computable. Given the observer's position and a date,
 * `src/core/declination.ts` evaluates WMM2025 and returns it to about half a
 * degree, which beats the 10–20° error of leaving a magnetic bearing alone by
 * more than an order of magnitude. So the policy converts when it can.
 *
 * A converted bearing is reported as `true-model`, not as `true`, because the
 * two are not the same claim. `true` means the platform resolved north itself
 * from the device's own model and whatever else Core Location knows. That
 * still wins: it is at least as good, and the app cannot see what went into
 * it. `true-model` means this repository added a modelled declination, and it
 * carries the number it added, the model's name, and whether the date fell
 * inside the model's fit window — so the screen can name the source and its
 * accuracy instead of presenting north as a bare fact.
 *
 * Outside the model's validity window, or with no position, there is nothing
 * to convert with and the bearing falls back to the labelled `magnetic` path.
 *
 * Pure: samples in, decision out. No clock, no device, no I/O. The date is an
 * argument, exactly as it is in `src/core/declination.ts`.
 */

import {
  WMM2025_NAME,
  WMM2025_VALID_FROM,
  WMM2025_VALID_UNTIL,
  geomagneticField,
  type GeomagneticSite,
} from '../core/declination.js';
import { smoothedHeading, type FuseOptions, type HeadingSample, type SensorRefusal } from './sensors.js';

/**
 * Where a drawable heading came from. Callers destructure on this, so adding a
 * basis is a compile error at every use site rather than a silent default.
 *
 * `true` is the platform's own true heading, or a declination the caller
 * supplied. `true-model` is a magnetic bearing this repository converted with
 * WMM2025. `magnetic` is unconverted.
 */
export type HeadingBasis = 'true' | 'true-model' | 'magnetic';

/** Where and when to evaluate the field model. The date is an input. */
export interface ModelDeclinationInput {
  readonly site: GeomagneticSite;
  /** A decimal year or a `Date`, per `geomagneticField`. */
  readonly when: number | Date;
}

/** What the model contributed, so a screen can name it rather than imply it. */
export interface ModelDeclinationUsed {
  /** The model's own name, e.g. `WMM-2025`. */
  readonly modelName: string;
  /** East-positive declination added to the magnetic bearing, degrees. */
  readonly declinationDeg: number;
  /** The decimal year the field was evaluated at. */
  readonly decimalYear: number;
  /** Always true on the `true-model` path; false is what sends it to `magnetic`. */
  readonly withinModelValidity: boolean;
}

/** `FuseOptions`, plus the position and date the field model needs. */
export interface HeadingPolicyOptions extends FuseOptions {
  readonly modelDeclination?: ModelDeclinationInput;
}

export interface DrawableHeading {
  readonly basis: HeadingBasis;
  readonly headingDeg: number;
  readonly spreadDeg: number | undefined;
  readonly sampleCount: number;
  /**
   * What the screen must say. Empty for a true heading; for a magnetic one it
   * names the error and the remedy, because a caveat the user cannot act on is
   * just an apology.
   */
  readonly caveat: string;
  /** Present only when `basis` is `true-model`. */
  readonly model?: ModelDeclinationUsed;
}

export type HeadingDecision =
  | { readonly ok: true; readonly heading: DrawableHeading }
  | { readonly ok: false; readonly refusal: SensorRefusal; readonly detail: string };

/**
 * Typical worst-case magnetic declination a user is likely to meet, degrees.
 *
 * Deliberately NOT presented as this location's declination — the app does not
 * know it without a position and a field model. It is a magnitude for the
 * caveat text, so the sentence reads "typically under 15°" rather than the
 * useless "some amount". Real values run from ~0° on the agonic line through
 * the eastern US to ~25° in Alaska and far more near the poles.
 */
export const TYPICAL_DECLINATION_BOUND_DEG = 15;

/**
 * The field model's own declination error, degrees RMS, as NOAA states it for
 * WMM2025. It describes the main and long-wavelength crustal field only, so
 * local anomalies sit on top of it and reach several degrees over iron-rich
 * rock. Both numbers go in the caveat: the second is the one that matters to a
 * user standing on a granite ridge.
 */
export const MODEL_DECLINATION_RMS_DEG = 0.5;

const REFUSAL_DETAIL: Readonly<Record<SensorRefusal, string>> = {
  'no-samples': 'the compass has not reported yet',
  stale: 'no compass reading in the last second and a half — the sensor may be off or blocked',
  'needs-declination': 'a magnetic heading is available but has not been converted to true north',
  'not-gravity': 'the phone is not being held steadily enough to read',
  'gimbal-degenerate': 'the camera is pointing too near straight up or down',
};

/** Signed degrees for prose: `+12.6°`, so east and west read at a glance. */
function signedDeg(valueDeg: number): string {
  return `${valueDeg >= 0 ? '+' : '−'}${Math.abs(valueDeg).toFixed(1)}°`;
}

/**
 * The heading to draw with, and what to say about it.
 *
 * Order matters, and each step is a weaker claim than the one above it:
 *
 *   1. the platform's own true heading, or a declination the caller supplied
 *   2. a magnetic bearing this repository converted with WMM2025
 *   3. the magnetic bearing, unconverted and labelled
 *
 * Step 1 wins over step 2 even when both are available. Core Location resolves
 * true north from its own field model plus whatever else it knows about the
 * fix, and the app cannot inspect that, so replacing it with this model would
 * trade a possibly better answer for one whose error is merely known.
 */
export function resolveHeadingForDrawing(
  samples: readonly HeadingSample[],
  atMs: number,
  options: HeadingPolicyOptions = {},
): HeadingDecision {
  const { modelDeclination, ...fuse } = options;
  const asTrue = smoothedHeading(samples, atMs, fuse);
  if (asTrue.ok) {
    return {
      ok: true,
      heading: {
        basis: 'true',
        headingDeg: asTrue.field.valueDeg,
        spreadDeg: asTrue.field.spreadDeg,
        sampleCount: asTrue.field.sampleCount,
        caveat: '',
      },
    };
  }

  // Only `needs-declination` is recoverable here. A stale or empty trace has
  // no bearing to draw at all, and inventing one is the failure this
  // repository exists to prevent.
  if (asTrue.refusal !== 'needs-declination') {
    return { ok: false, refusal: asTrue.refusal, detail: REFUSAL_DETAIL[asTrue.refusal] };
  }

  // The field model, when the caller knows where and when the observer is.
  let modelUnavailableNote = '';
  if (modelDeclination !== undefined) {
    const field = geomagneticField(modelDeclination.site, modelDeclination.when);
    if (field.withinModelValidity) {
      const converted = smoothedHeading(samples, atMs, {
        ...fuse,
        declinationDeg: field.declinationDeg,
      });
      if (!converted.ok) {
        return { ok: false, refusal: converted.refusal, detail: REFUSAL_DETAIL[converted.refusal] };
      }
      return {
        ok: true,
        heading: {
          basis: 'true-model',
          headingDeg: converted.field.valueDeg,
          spreadDeg: converted.field.spreadDeg,
          sampleCount: converted.field.sampleCount,
          model: {
            modelName: WMM2025_NAME,
            declinationDeg: field.declinationDeg,
            decimalYear: field.decimalYear,
            withinModelValidity: field.withinModelValidity,
          },
          caveat:
            `True north from the ${WMM2025_NAME} magnetic model, not from the phone — the ` +
            `compass gave a magnetic bearing and the model's ${signedDeg(field.declinationDeg)} ` +
            `of local declination was added. The model is good to about ` +
            `${MODEL_DECLINATION_RMS_DEG}° RMS, and local rock can shift the field by several ` +
            'degrees more. Drag the overlay sideways if it looks off.',
        },
      };
    }
    // Outside the fit window the coefficients extrapolate, and the drift is
    // unbounded rather than merely larger. Say why the model went unused, so
    // the fallback does not look like the app forgetting the position.
    modelUnavailableNote =
      ` The ${WMM2025_NAME} model could not convert it: the date given ` +
      `(${field.decimalYear.toFixed(1)}) is outside its ${WMM2025_VALID_FROM.toFixed(1)}–` +
      `${WMM2025_VALID_UNTIL.toFixed(1)} validity window.`;
  }

  // Re-run with an explicit zero declination. That is NOT a claim that the
  // declination is zero — it is the arithmetic that leaves the magnetic
  // bearing untouched, and the result is labelled `magnetic` precisely so the
  // number is never mistaken for the true one.
  const asMagnetic = smoothedHeading(samples, atMs, { ...fuse, declinationDeg: 0 });
  if (!asMagnetic.ok) {
    return { ok: false, refusal: asMagnetic.refusal, detail: REFUSAL_DETAIL[asMagnetic.refusal] };
  }

  return {
    ok: true,
    heading: {
      basis: 'magnetic',
      headingDeg: asMagnetic.field.valueDeg,
      spreadDeg: asMagnetic.field.spreadDeg,
      sampleCount: asMagnetic.field.sampleCount,
      caveat:
        'Magnetic north, not true north — the overlay is offset by the local magnetic ' +
        `declination (typically under ${TYPICAL_DECLINATION_BOUND_DEG}°, larger at high ` +
        'latitudes). Drag the overlay sideways to line it up.' +
        modelUnavailableNote,
    },
  };
}
