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
 * Pure: samples in, decision out. No clock, no device, no I/O.
 */

import { smoothedHeading, type FuseOptions, type HeadingSample, type SensorRefusal } from './sensors.js';

/**
 * Where a drawable heading came from. Callers destructure on this, so adding a
 * basis is a compile error at every use site rather than a silent default.
 */
export type HeadingBasis = 'true' | 'magnetic';

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

const REFUSAL_DETAIL: Readonly<Record<SensorRefusal, string>> = {
  'no-samples': 'the compass has not reported yet',
  stale: 'no compass reading in the last second and a half — the sensor may be off or blocked',
  'needs-declination': 'a magnetic heading is available but has not been converted to true north',
  'not-gravity': 'the phone is not being held steadily enough to read',
  'gimbal-degenerate': 'the camera is pointing too near straight up or down',
};

/**
 * The heading to draw with, and what to say about it.
 *
 * Order matters. A true heading is always preferred, and a declination — from
 * the platform or supplied by the caller — always converts. Only when neither
 * is available does the magnetic bearing get drawn, and then it arrives
 * labelled `magnetic` with a caveat rather than as a bare number.
 */
export function resolveHeadingForDrawing(
  samples: readonly HeadingSample[],
  atMs: number,
  options: FuseOptions = {},
): HeadingDecision {
  const asTrue = smoothedHeading(samples, atMs, options);
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

  // Re-run with an explicit zero declination. That is NOT a claim that the
  // declination is zero — it is the arithmetic that leaves the magnetic
  // bearing untouched, and the result is labelled `magnetic` precisely so the
  // number is never mistaken for the true one.
  const asMagnetic = smoothedHeading(samples, atMs, { ...options, declinationDeg: 0 });
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
        'latitudes). Drag the overlay sideways to line it up.',
    },
  };
}
