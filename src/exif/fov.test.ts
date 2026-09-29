import { describe, expect, it } from 'vitest';

import {
  cameraPoseFromFocalLength,
  fovDegFromFocalLength35mm as coreFovDegFromFocalLength35mm,
} from '../core/projection';

import {
  fovDegFromFocalLength35mm,
  hFovDegFromFocalLength35mm,
  longSideFovDegFromFocalLength35mm,
  vFovDegFromHFov,
} from './fov';

/**
 * Expectations are computed from the closed forms, not from this code:
 *
 *   hFov = 2*atan(36 / (2*f35))
 *   f35 = 18 -> 36/36 = 1        -> 2*atan(1)    = 90 deg exactly
 *   f35 = 24 -> 36/48 = 0.75     -> 2*atan(0.75) = 73.739795 deg
 *   f35 = 36 -> 36/72 = 0.5      -> 2*atan(0.5)  = 53.130102 deg
 *   f35 = 50 -> 36/100 = 0.36    -> 2*atan(0.36) = 39.597753 deg
 *
 * The 24 mm and 50 mm figures are the published horizontal angles of view for
 * those lenses on a 36x24 mm frame (73.7 deg and 39.6 deg).
 */
describe('hFovDegFromFocalLength35mm', () => {
  it('gives exactly 90 degrees when the focal length equals half the frame width', () => {
    expect(hFovDegFromFocalLength35mm(18)).toBeCloseTo(90, 12);
  });

  it('matches published angles of view for common lenses', () => {
    expect(hFovDegFromFocalLength35mm(24)).toBeCloseTo(73.739795, 6);
    expect(hFovDegFromFocalLength35mm(36)).toBeCloseTo(53.130102, 6);
    expect(hFovDegFromFocalLength35mm(50)).toBeCloseTo(39.597753, 6);
  });

  it('shrinks monotonically as focal length grows', () => {
    const wide = hFovDegFromFocalLength35mm(24);
    const normal = hFovDegFromFocalLength35mm(50);
    const long = hFovDegFromFocalLength35mm(200);
    expect(wide).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(long);
  });

  it('rejects non-positive or non-finite focal lengths', () => {
    expect(() => hFovDegFromFocalLength35mm(0)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(-24)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(Number.NaN)).toThrow(RangeError);
  });
});

/**
 * tan(vFov/2) = tan(hFov/2) * height/width. With hFov = 90 deg the tangent is
 * exactly 1, so the expectations reduce to 2*atan(height/width):
 *
 *   1:1  -> 2*atan(1)    = 90 deg
 *   2:1  -> 2*atan(0.5)  = 53.130102 deg
 *   4:3  -> 2*atan(0.75) = 73.739795 deg
 */
describe('vFovDegFromHFov', () => {
  it('equals hFov on a square image', () => {
    expect(vFovDegFromHFov(90, 100, 100)).toBeCloseTo(90, 12);
    expect(vFovDegFromHFov(43.5, 512, 512)).toBeCloseTo(43.5, 12);
  });

  it('follows the tangent relation, not a linear scaling', () => {
    expect(vFovDegFromHFov(90, 200, 100)).toBeCloseTo(53.130102, 6);
    expect(vFovDegFromHFov(90, 800, 600)).toBeCloseTo(73.739795, 6);
    // The naive hFov * height/width would have said 45 and 67.5 respectively.
    expect(vFovDegFromHFov(90, 200, 100)).not.toBeCloseTo(45, 2);
  });

  it('depends only on the aspect ratio, not the absolute pixel count', () => {
    expect(vFovDegFromHFov(60, 800, 600)).toBeCloseTo(vFovDegFromHFov(60, 4000, 3000), 12);
  });

  it('exceeds hFov on a portrait image', () => {
    expect(vFovDegFromHFov(60, 600, 800)).toBeGreaterThan(60);
  });

  it('rejects impossible inputs', () => {
    expect(() => vFovDegFromHFov(0, 800, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(180, 800, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(60, 0, 600)).toThrow(RangeError);
    expect(() => vFovDegFromHFov(60, 800, -600)).toThrow(RangeError);
  });
});

/**
 * The axis question (adversarial review 2, finding 3).
 *
 * 36 mm is the LONG side of the 35 mm gate, so the angle it spans belongs to
 * the longer side of the photograph — the width in landscape, the HEIGHT in
 * portrait. Hand-derived closed forms, from the tangent relation:
 *
 *   f35 = 50, frame 600x800 (portrait)
 *     long side is the height: vFov = 2*atan(0.36)         = 39.597753 deg
 *     tan(hFov/2) = 0.36*(600/800) = 0.27
 *     hFov = 2*atan(0.27)                                  = 30.219150 deg
 *
 *   f35 = 26, frame 600x800 (portrait)
 *     vFov = 2*atan(9/13)                                  = 69.390307 deg
 *     tan(hFov/2) = (9/13)*0.75 = 0.519230769…
 *     hFov = 2*atan(0.519230769…)                          = 54.879456 deg
 *
 *   f35 = 26, frame 800x600 (landscape) — the mirror image of the above.
 */
describe('fovDegFromFocalLength35mm — which axis gets the 36 mm angle', () => {
  it('gives it to the width on a landscape frame', () => {
    const fov = fovDegFromFocalLength35mm(26, 800, 600);
    expect(fov.hFovDeg).toBeCloseTo(69.390307, 6);
    expect(fov.vFovDeg).toBeCloseTo(54.879456, 6);
    expect(fov.hFovDeg).toBeGreaterThan(fov.vFovDeg);
  });

  it('gives it to the HEIGHT on a portrait frame', () => {
    const fov = fovDegFromFocalLength35mm(26, 600, 800);
    expect(fov.vFovDeg).toBeCloseTo(69.390307, 6);
    expect(fov.hFovDeg).toBeCloseTo(54.879456, 6);
    // The old model returned 69.39 deg of HORIZONTAL view for this frame.
    expect(fov.hFovDeg).not.toBeCloseTo(69.390307, 3);
  });

  it('reproduces the review\'s dead-sea numbers', () => {
    const fov = fovDegFromFocalLength35mm(50, 600, 800);
    expect(fov.hFovDeg).toBeCloseTo(30.219150, 6);
    expect(fov.vFovDeg).toBeCloseTo(39.597753, 6);
  });

  it('is a transpose of itself: rotating the frame swaps the two angles', () => {
    const landscape = fovDegFromFocalLength35mm(35, 1600, 1200);
    const portrait = fovDegFromFocalLength35mm(35, 1200, 1600);
    expect(portrait.hFovDeg).toBeCloseTo(landscape.vFovDeg, 12);
    expect(portrait.vFovDeg).toBeCloseTo(landscape.hFovDeg, 12);
  });

  it('gives a square frame two equal angles', () => {
    const fov = fovDegFromFocalLength35mm(50, 1000, 1000);
    expect(fov.hFovDeg).toBeCloseTo(fov.vFovDeg, 12);
    expect(fov.hFovDeg).toBeCloseTo(39.597753, 6);
  });

  it('agrees with the long-side helper, which is the honest name for the 36 mm angle', () => {
    for (const f35 of [18, 24, 26, 35, 50, 200]) {
      expect(longSideFovDegFromFocalLength35mm(f35)).toBe(hFovDegFromFocalLength35mm(f35));
      expect(fovDegFromFocalLength35mm(f35, 1600, 1200).hFovDeg).toBeCloseTo(
        longSideFovDegFromFocalLength35mm(f35),
        12,
      );
    }
  });

  it('rejects impossible inputs rather than assuming a shape', () => {
    expect(() => fovDegFromFocalLength35mm(0, 800, 600)).toThrow(RangeError);
    expect(() => fovDegFromFocalLength35mm(50, 0, 600)).toThrow(RangeError);
    expect(() => fovDegFromFocalLength35mm(50, 800, Number.NaN)).toThrow(RangeError);
  });
});

/**
 * The still path and the live path must agree.
 *
 * `cameraPoseFromFocalLength` (core, used by the phone screen, the demo script
 * and the CV tests) and `fovDegFromFocalLength35mm` (this module, used by the
 * extractor and the web app) once disagreed on portrait frames: core gave the
 * 36 mm-gate angle to the width whatever the orientation. Landscape
 * photographs hid it completely, which is why the agreement is asserted on both
 * orientations and to the last bit rather than to six places.
 */
describe('agreement with the core pose builder', () => {
  it('is literally the same function, so the two cannot drift apart', () => {
    expect(fovDegFromFocalLength35mm).toBe(coreFovDegFromFocalLength35mm);
  });

  it('matches on portrait and landscape frames, exactly', () => {
    const frames = [
      [393, 852],
      [852, 393],
      [3024, 4032],
      [4032, 3024],
      [600, 800],
      [800, 600],
      [1000, 1000],
    ] as const;
    for (const f35 of [13, 24, 26, 48, 77, 100, 120]) {
      for (const [widthPx, heightPx] of frames) {
        const still = fovDegFromFocalLength35mm(f35, widthPx, heightPx);
        const pose = cameraPoseFromFocalLength({
          headingDeg: 0,
          focalLength35mm: f35,
          imageWidthPx: widthPx,
          imageHeightPx: heightPx,
        });
        expect(pose.hFovDeg).toBe(still.hFovDeg);
        expect(pose.vFovDeg).toBe(still.vFovDeg);
      }
    }
  });

  it('puts the wider angle on the longer displayed axis, both ways round', () => {
    const portrait = fovDegFromFocalLength35mm(26, 393, 852);
    expect(portrait.vFovDeg).toBeGreaterThan(portrait.hFovDeg);
    const landscape = fovDegFromFocalLength35mm(26, 852, 393);
    expect(landscape.hFovDeg).toBeGreaterThan(landscape.vFovDeg);
  });
});
