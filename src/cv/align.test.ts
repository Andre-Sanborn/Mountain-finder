/**
 * archive/v2-docs-20260929/PLAN.md Phase 7 self-check:
 *
 *   "synthetic rendered silhouettes with known injected offset → recovered
 *    within 0.5°"
 *
 * plus the refusals, which are the part that decides whether this feature is
 * safe to switch on at all.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHERE THE EXPECTATIONS COME FROM
 * ───────────────────────────────────────────────────────────────────────────
 * Every expectation is the offset **the test injected**, decided before
 * anything ran. The picture is drawn by projecting a closed-form horizon
 * profile through a stated true pose; the aligner is then handed that same
 * profile and a pose deliberately wrong by (Δh, Δp); the assertion is that it
 * recovers (Δh, Δp). No number in this file was obtained by running the
 * aligner and writing down what came out.
 *
 * The suite is deliberately split in two, because "the round trip failed"
 * otherwise names two very different bugs:
 *
 *   • `the aligner alone` feeds it a skyline computed straight from the
 *     projection, with the extractor bypassed entirely. A failure here is a
 *     geometry or search bug.
 *   • `the full round trip` goes through the rasteriser and the extractor. A
 *     failure only here is an image-processing bug, and the gap between the two
 *     is exactly the extractor's contribution to the error.
 */

import { describe, expect, it } from 'vitest';

import { cameraPoseFromFocalLength } from '../core/projection.js';
import type { CameraPose, HorizonProfile } from '../core/types.js';
import { alignSkyline } from './align.js';
import { extractSkyline } from './skyline.js';
import type { Skyline, SkylineAlignment } from './types.js';
import { ambiguousProfile, flatProfile, signatureProfile } from './testing/profiles.js';
import { projectRidgeRows, renderFog, renderSkylinePhoto } from './testing/raster.js';

const WIDTH_PX = 1200;
const HEIGHT_PX = 900;

/** The Gornergrat fixture's framing: 28 mm-equivalent on a 4:3 frame, hFOV 65.47°. */
const TRUE_POSE: CameraPose = cameraPoseFromFocalLength({
  headingDeg: 265.4,
  pitchDeg: 4.5,
  focalLength35mm: 28,
  imageWidthPx: WIDTH_PX,
  imageHeightPx: HEIGHT_PX,
});

/** The pose the aligner is given: wrong by exactly the offsets being injected. */
function nominalPose(headingOffsetDeg: number, pitchOffsetDeg: number): CameraPose {
  return {
    ...TRUE_POSE,
    headingDeg: TRUE_POSE.headingDeg - headingOffsetDeg,
    pitchDeg: TRUE_POSE.pitchDeg - pitchOffsetDeg,
  };
}

/**
 * A skyline computed straight from the projection — the extractor's answer if
 * the extractor were perfect. Confidence 1 everywhere, because it is exact.
 */
function geometricSkyline(profile: HorizonProfile, columnCount = 512): Skyline {
  const rows = projectRidgeRows(TRUE_POSE, profile, columnCount);
  const columns = rows.map((rowNorm, index) => ({
    xNorm: (index + 0.5) / columnCount,
    rowNorm: rowNorm !== undefined && rowNorm >= 0 && rowNorm <= 1 ? rowNorm : undefined,
    confidence01: rowNorm !== undefined && rowNorm >= 0 && rowNorm <= 1 ? 1 : 0,
    contrast: 1,
    snr: 100,
    edge01: 1,
    agreement01: 1,
  }));
  const readable = columns.filter((column) => column.rowNorm !== undefined);
  const mean =
    readable.reduce((total, column) => total + (column.rowNorm ?? 0), 0) /
    Math.max(1, readable.length);
  const variance =
    readable.reduce((total, column) => total + ((column.rowNorm ?? 0) - mean) ** 2, 0) /
    Math.max(1, readable.length);
  return {
    widthPx: columnCount,
    heightPx: HEIGHT_PX,
    columns,
    coverage01: readable.length / columns.length,
    meanConfidence01: readable.length === 0 ? 0 : 1,
    reliefNorm: Math.sqrt(variance),
  };
}

/** Narrow, with the failure detail surfaced in the assertion message. */
function expectAligned(
  result: SkylineAlignment,
): asserts result is Extract<SkylineAlignment, { status: 'aligned' | 'low-confidence' }> {
  if (result.status === 'failed') {
    throw new Error(`expected an alignment, got failure [${result.reason}]: ${result.detail}`);
  }
}

/** The offsets under test. Chosen to bracket the 5–15° EXIF error decision D3 cites. */
const INJECTED: readonly (readonly [number, number])[] = [
  [0, 0],
  [7.3, 1.4],
  [-11.75, 0],
  [3.25, -2.6],
  [-18.5, 3.1],
  [20, 0],
];

describe('the aligner alone (extractor bypassed)', () => {
  const profile = signatureProfile(265, 60);

  it.each(INJECTED)('recovers an injected (%s°, %s°) to within 0.05°', (heading, pitch) => {
    const skyline = geometricSkyline(profile);
    const result = alignSkyline(skyline, nominalPose(heading, pitch), profile);
    expectAligned(result);
    // A tolerance twenty times tighter than the 0.5° the plan demands: with a
    // perfect skyline the only error left is the search's own discretisation,
    // and if that ever exceeds 0.05° something has changed in the geometry.
    expect(result.headingOffsetDeg).toBeCloseTo(heading, 1);
    expect(Math.abs(result.headingOffsetDeg - heading)).toBeLessThan(0.05);
    expect(Math.abs(result.pitchOffsetDeg - pitch)).toBeLessThan(0.05);
    expect(result.status).toBe('aligned');
  });

  it('reports a corrected camera that equals the true pose', () => {
    const skyline = geometricSkyline(profile);
    const result = alignSkyline(skyline, nominalPose(7.3, 1.4), profile);
    expectAligned(result);
    expect(result.correctedCamera.headingDeg).toBeCloseTo(TRUE_POSE.headingDeg, 1);
    expect(result.correctedCamera.pitchDeg).toBeCloseTo(TRUE_POSE.pitchDeg, 1);
    // Nothing else about the pose may be touched.
    expect(result.correctedCamera.hFovDeg).toBe(TRUE_POSE.hFovDeg);
    expect(result.correctedCamera.vFovDeg).toBe(TRUE_POSE.vFovDeg);
    expect(result.correctedCamera.rollDeg).toBe(TRUE_POSE.rollDeg);
  });

  it('holds pitch at zero when told not to search it', () => {
    const skyline = geometricSkyline(profile);
    const result = alignSkyline(skyline, nominalPose(6, 0), profile, { searchPitch: false });
    expectAligned(result);
    expect(result.pitchOffsetDeg).toBe(0);
    expect(Math.abs(result.headingOffsetDeg - 6)).toBeLessThan(0.05);
  });

  it('still recovers heading when pitch is wrong and pitch search is off', () => {
    // The point of the offset-blind score. With `searchPitch: false` there is
    // no parameter to absorb the 1° pitch error, so if the correlation were
    // sensitive to a constant vertical offset the heading would have to bend to
    // soak it up. It does not: normalised cross-correlation subtracts both
    // means before correlating, and all that is left is the cosine modulation
    // across the frame, which is second order.
    const skyline = geometricSkyline(profile);
    const result = alignSkyline(skyline, nominalPose(6, -1), profile, { searchPitch: false });
    expectAligned(result);
    expect(Math.abs(result.headingOffsetDeg - 6)).toBeLessThan(0.2);
  });

  it('refuses when an uncorrectable pitch error leaves the terrain off the skyline', () => {
    // Same setup, 2.6° of pitch error and still no pitch search. The heading is
    // fine — but the terrain now sits 2.5° RMS off the extracted skyline, and
    // handing back a "correct" heading alongside a pose that visibly does not
    // fit the photograph would be a half-truth. The residual gate is what
    // stops it.
    const skyline = geometricSkyline(profile);
    const result = alignSkyline(skyline, nominalPose(6, -2.6), profile, { searchPitch: false });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('residual-too-large');
    expect(result.diagnostics.residualRmsDeg).toBeGreaterThan(1.5);
    // …and the correlation was excellent all along, which is why the score
    // alone can never be the whole quality measure.
    expect(result.diagnostics.score).toBeGreaterThan(0.99);
  });
});

describe('the full round trip (rendered photograph, extracted skyline)', () => {
  const profile = signatureProfile(265, 60);

  it.each(INJECTED)(
    'renders a known skyline, injects (%s°, %s°) and recovers it within 0.5°',
    (heading, pitch) => {
      const image = renderSkylinePhoto({
        widthPx: WIDTH_PX,
        heightPx: HEIGHT_PX,
        pose: TRUE_POSE,
        profile,
      });
      const result = alignSkyline(extractSkyline(image), nominalPose(heading, pitch), profile);
      expectAligned(result);
      expect(result.status).toBe('aligned');
      expect(Math.abs(result.headingOffsetDeg - heading)).toBeLessThan(0.5);
      expect(Math.abs(result.pitchOffsetDeg - pitch)).toBeLessThan(0.5);
    },
  );

  it('recovers the offset through cloud, sun flare and sensor noise', () => {
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
      noise01: 0.03,
      seed: 20260816,
      clouds: [
        { xNorm: 0.2, yNorm: 0.25, radiusNorm: 0.18, strength: 0.85 },
        { xNorm: 0.7, yNorm: 0.15, radiusNorm: 0.22, strength: -0.5 },
      ],
      sun: { xNorm: 0.85, yNorm: 0.12, radiusNorm: 0.15 },
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(7.3, 1.4), profile);
    expectAligned(result);
    expect(Math.abs(result.headingOffsetDeg - 7.3)).toBeLessThan(0.5);
    expect(Math.abs(result.pitchOffsetDeg - 1.4)).toBeLessThan(0.5);
  });

  it('recovers the offset with 60 % of the frame unreadable, and says the coverage was thin', () => {
    // Fog over columns 0–30 % and 45–75 % leaves 40 % of the frame. That is
    // above the 25 % floor, so an answer is allowed — but it must come back
    // flagged, not presented as if the whole photograph had been used.
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
      fogBands: [
        [0, 0.3],
        [0.45, 0.75],
      ],
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(7.3, 1.4), profile);
    expectAligned(result);
    expect(Math.abs(result.headingOffsetDeg - 7.3)).toBeLessThan(0.5);
    expect(result.status).toBe('low-confidence');
    expect(result.concerns).toContain('insufficient-skyline');
    expect(result.diagnostics.usedFraction01).toBeLessThan(0.5);

    // The confidence must actually *move* — the same photograph without the
    // fog is the control, and a quality number that reads the same either way
    // would be decoration rather than a measurement.
    const clear = alignSkyline(
      extractSkyline(
        renderSkylinePhoto({
          widthPx: WIDTH_PX,
          heightPx: HEIGHT_PX,
          pose: TRUE_POSE,
          profile,
        }),
      ),
      nominalPose(7.3, 1.4),
      profile,
    );
    expectAligned(clear);
    expect(clear.status).toBe('aligned');
    expect(result.confidence01).toBeLessThan(clear.confidence01 - 0.2);
  });

  it('works on a sector profile that covers only the frame, not the whole compass', () => {
    // What a real single-photo run produces: `SweepConfig.spanDeg` limits the
    // sweep to a sector, and the aligner must not interpolate across the hole.
    const sector = signatureProfile(265, 45);
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile: sector,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(5, 1), sector);
    expectAligned(result);
    expect(Math.abs(result.headingOffsetDeg - 5)).toBeLessThan(0.5);
  });
});

describe('the refusals', () => {
  const profile = signatureProfile(265, 60);

  it('refuses a featureless flat horizon rather than returning a confident zero', () => {
    // The headline failure case. A dead-flat skyline fits every heading equally
    // well; the only correct output is "I cannot align this".
    const flat = flatProfile(265, 60);
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile: flat,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(6, 0), flat);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('featureless-terrain-profile');
    // And — the whole point — there is no offset in the result to misread.
    expect(result).not.toHaveProperty('headingOffsetDeg');
    expect(result).not.toHaveProperty('correctedCamera');
  });

  it('refuses a photograph of fog', () => {
    const result = alignSkyline(
      extractSkyline(renderFog(WIDTH_PX, HEIGHT_PX, 99)),
      nominalPose(6, 0),
      profile,
    );
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('insufficient-skyline');
    expect(result.diagnostics.usedFraction01).toBe(0);
  });

  it('refuses when the extractor loses 80 % of the columns', () => {
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
      fogBands: [
        [0, 0.4],
        [0.45, 0.85],
      ],
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(6, 0), profile);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('insufficient-skyline');
  });

  it('refuses a periodic ridgeline, where several headings fit equally', () => {
    const periodic = ambiguousProfile(265, 60);
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile: periodic,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(3, 0), periodic);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('ambiguous-correlation');
    // The correlation itself is near-perfect — which is exactly why the peak
    // value alone is not a safe measure of having found anything.
    expect(result.diagnostics.score).toBeGreaterThan(0.95);
    expect(result.diagnostics.margin).toBeLessThan(0.03);
  });

  it('refuses when the true offset lies outside the search window', () => {
    // 30° of heading error, searched over ±10°. There is no correct answer
    // inside the window and the aligner must not manufacture one.
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(30, 0), profile, {
      headingRangeDeg: 10,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(['no-correlation', 'search-range-exhausted']).toContain(result.reason);
  });

  it('refuses when the true offset sits exactly at the edge of the window', () => {
    // The subtler version: the peak IS in the window, right at its rim. The
    // score is excellent and the answer would even be right — but a peak at the
    // rim is indistinguishable from the shoulder of a peak just outside, so it
    // cannot be trusted and the window has to be widened instead.
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(12, 0), profile, {
      headingRangeDeg: 12,
    });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('search-range-exhausted');
    expect(result.diagnostics.atSearchEdge).toBe(true);
    expect(result.diagnostics.score).toBeGreaterThan(0.9);
  });

  it('refuses a snow-capped skyline under a muted sky — the extractor is wrong there', () => {
    // Sunlit snow is brighter than a hazy sky, so the sky/terrain step inverts
    // and the extractor locks onto the SNOWLINE, a horizontal edge with none of
    // the ridge's shape. The result is a flat extracted skyline that correlates
    // NEGATIVELY with the terrain, and the honest output is a refusal.
    //
    // This is a limitation of the extractor, recorded as a test rather than
    // hidden: what is being asserted is not that the extractor copes, but that
    // when it does not, nothing downstream is told a heading.
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
      skyTop: { r: 60, g: 90, b: 130 },
      skyHorizon: { r: 120, g: 140, b: 160 },
      snowRowNorm: 0.62,
      noise01: 0.02,
      seed: 7,
    });
    const result = alignSkyline(extractSkyline(image), nominalPose(6, 0), profile);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('featureless-photo-skyline');
  });

  it('refuses an empty or one-point profile instead of throwing', () => {
    const skyline = geometricSkyline(profile);
    for (const degenerate of [[], profile.slice(0, 1)]) {
      const result = alignSkyline(skyline, nominalPose(0, 0), degenerate);
      expect(result.status).toBe('failed');
      if (result.status !== 'failed') continue;
      expect(result.reason).toBe('profile-does-not-cover-frame');
    }
  });

  it('refuses when the frame points away from the sector the profile covers', () => {
    // The profile covers 220°–310°; the camera is pointing at 090°. Nothing in
    // the ±25° window brings the frame inside the covered arc, and interpolating
    // across the 270° hole would be terrain invented from nothing.
    const sector = signatureProfile(265, 45);
    const away: CameraPose = { ...TRUE_POSE, headingDeg: 90 };
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile: sector,
    });
    const result = alignSkyline(extractSkyline(image), away, sector);
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toBe('profile-does-not-cover-frame');
  });
});

describe('determinism', () => {
  it('gives byte-identical answers on repeated runs', () => {
    // `src/cv` takes no seed of its own and calls no clock. Asserted rather
    // than assumed, because a stray Math.random would still pass every other
    // test in this file most of the time.
    const profile = signatureProfile(265, 60);
    const image = renderSkylinePhoto({
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      pose: TRUE_POSE,
      profile,
      noise01: 0.02,
      seed: 5,
    });
    const first = alignSkyline(extractSkyline(image), nominalPose(4.5, 0.75), profile);
    const second = alignSkyline(extractSkyline(image), nominalPose(4.5, 0.75), profile);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
