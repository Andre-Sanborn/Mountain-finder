import { describe, expect, it } from 'vitest';

import { toDegrees, toRadians } from './geodesy';
import {
  FULL_FRAME_WIDTH_MM,
  cameraPoseFromFocalLength,
  focalLength35mmFromHFovDeg,
  fovDegFromFocalLength35mm,
  hFovDegFromFocalLength35mm,
  longSideFovDegFromFocalLength35mm,
  projectToImage,
  vFovDegFromHFovDeg,
} from './projection';
import type { CameraPose } from './types';

describe('hFovDegFromFocalLength35mm', () => {
  it('gives exactly 90° at 18 mm, where the half-frame equals the focal length', () => {
    // tan(hFOV/2) = 18/18 = 1 ⟹ hFOV/2 = 45°.
    expect(hFovDegFromFocalLength35mm(18)).toBeCloseTo(90, 10);
  });

  it('matches the standard published figures for common focal lengths', () => {
    // 2·atan(18/f), evaluated independently:
    //   24 mm → 2·atan(0.75)    = 73.73980°   (the usual "73.7°" wide angle)
    //   28 mm → 2·atan(0.642857)= 65.47045°
    //   36 mm → 2·atan(0.5)     = 53.13010°
    //   50 mm → 2·atan(0.36)    = 39.59775°   (the usual "39.6°" normal lens)
    expect(hFovDegFromFocalLength35mm(24)).toBeCloseTo(73.7398, 3);
    expect(hFovDegFromFocalLength35mm(28)).toBeCloseTo(65.47045, 4);
    expect(hFovDegFromFocalLength35mm(36)).toBeCloseTo(53.1301, 3);
    expect(hFovDegFromFocalLength35mm(50)).toBeCloseTo(39.59775, 4);
  });

  it('agrees with the symbolic form 2·atan(w/2f)', () => {
    for (const focal of [14, 24, 35, 50, 85, 200]) {
      const expected = 2 * toDegrees(Math.atan(FULL_FRAME_WIDTH_MM / (2 * focal)));
      expect(hFovDegFromFocalLength35mm(focal)).toBeCloseTo(expected, 12);
    }
  });

  it('narrows monotonically as the lens gets longer', () => {
    let previous = 180;
    for (const focal of [14, 24, 35, 50, 85, 200]) {
      const fov = hFovDegFromFocalLength35mm(focal);
      expect(fov).toBeLessThan(previous);
      previous = fov;
    }
  });

  it('rejects non-positive focal lengths', () => {
    expect(() => hFovDegFromFocalLength35mm(0)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(-24)).toThrow(RangeError);
    expect(() => hFovDegFromFocalLength35mm(Number.NaN)).toThrow(RangeError);
  });
});

describe('focalLength35mmFromHFovDeg', () => {
  it('inverts hFovDegFromFocalLength35mm', () => {
    for (const focal of [14, 24, 35, 50, 85, 200]) {
      expect(focalLength35mmFromHFovDeg(hFovDegFromFocalLength35mm(focal))).toBeCloseTo(focal, 9);
    }
  });

  it('returns 18 mm for a 90° frame', () => {
    expect(focalLength35mmFromHFovDeg(90)).toBeCloseTo(18, 10);
  });

  it('rejects fields of view outside (0, 180)', () => {
    expect(() => focalLength35mmFromHFovDeg(0)).toThrow(RangeError);
    expect(() => focalLength35mmFromHFovDeg(180)).toThrow(RangeError);
    expect(() => focalLength35mmFromHFovDeg(-10)).toThrow(RangeError);
  });
});

describe('vFovDegFromHFovDeg', () => {
  it('leaves a square frame alone', () => {
    expect(vFovDegFromHFovDeg(90, 1)).toBeCloseTo(90, 10);
    expect(vFovDegFromHFovDeg(53.13010235, 1)).toBeCloseTo(53.13010235, 8);
  });

  it('divides the half-frame tangent by the aspect ratio', () => {
    // A 24 mm lens on 3:2 film: tan(hFOV/2) = 0.75, so tan(vFOV/2) = 0.75/1.5
    // = 0.5 exactly, giving vFOV = 2·atan(0.5) = 53.13010°.
    const hFovDeg = hFovDegFromFocalLength35mm(24);
    expect(vFovDegFromHFovDeg(hFovDeg, 1.5)).toBeCloseTo(2 * toDegrees(Math.atan(0.5)), 10);
    expect(vFovDegFromHFovDeg(hFovDeg, 1.5)).toBeCloseTo(53.1301, 3);

    // The same lens on a 4:3 phone sensor: tan(vFOV/2) = 0.75/(4/3) = 0.5625,
    // vFOV = 2·atan(0.5625) = 58.71551°.
    expect(vFovDegFromHFovDeg(hFovDeg, 4 / 3)).toBeCloseTo(58.71551, 4);
  });

  it('is not simply hFOV divided by the aspect ratio', () => {
    // The naive angle-division answer for 24 mm on 3:2 would be
    // 73.7398/1.5 = 49.16°, a full four degrees short of the truth. This test
    // exists to catch exactly that mistake creeping back in.
    const hFovDeg = hFovDegFromFocalLength35mm(24);
    expect(vFovDegFromHFovDeg(hFovDeg, 1.5)).not.toBeCloseTo(hFovDeg / 1.5, 1);
  });

  it('rejects impossible inputs', () => {
    expect(() => vFovDegFromHFovDeg(0, 1.5)).toThrow(RangeError);
    expect(() => vFovDegFromHFovDeg(200, 1.5)).toThrow(RangeError);
    expect(() => vFovDegFromHFovDeg(60, 0)).toThrow(RangeError);
    expect(() => vFovDegFromHFovDeg(60, -1)).toThrow(RangeError);
  });
});

/**
 * Which axis gets the 36 mm-gate angle.
 *
 * Every expectation below is the closed form evaluated by hand, never this
 * code's output. The gate's long side is 36 mm, so its half-side is 18 mm and
 *
 *     long-side angle = 2·atan(18 / f35)
 *     short axis      = 2·atan( tan(long/2) · shortPx / longPx )
 *
 * with the second line reading straight off a flat sensor: half-frame
 * dimensions are proportional to half-angle tangents.
 *
 *   f35 = 24 -> 2·atan(18/24) = 2·atan(0.75)          = 73.739795°
 *   f35 = 26 -> 2·atan(18/26) = 2·atan(9/13)          = 69.390307°
 *
 * A phone screen 393 x 852 pt (the iPhone portrait layout) and the 4:3 sensor
 * frames both follow:
 *
 *   26 mm, 393 x 852 portrait
 *     vFov = 69.390307°,  tan(vFov/2) = 9/13
 *     tan(hFov/2) = (9/13)·(393/852) = 0.319287…
 *     hFov = 2·atan(0.319287…)                        = 35.420632°
 *   24 mm, 393 x 852 portrait
 *     vFov = 73.739795°,  tan(vFov/2) = 0.75
 *     tan(hFov/2) = 0.75·(393/852) = 0.345950…
 *     hFov = 2·atan(0.345950…)                        = 38.166195°
 *   26 mm, 3 x 4 portrait: tan(hFov/2) = (9/13)·0.75  -> 54.879456°
 *   24 mm, 3 x 4 portrait: tan(hFov/2) = 0.75·0.75    -> 58.715507°
 *
 * 852 x 393 and 4 x 3 are the same numbers with the two angles swapped.
 */
describe('fovDegFromFocalLength35mm — the long-axis rule', () => {
  it('gives the gate angle to the height of a portrait phone frame', () => {
    const at26 = fovDegFromFocalLength35mm(26, 393, 852);
    expect(at26.vFovDeg).toBeCloseTo(69.390307, 6);
    expect(at26.hFovDeg).toBeCloseTo(35.420632, 6);

    const at24 = fovDegFromFocalLength35mm(24, 393, 852);
    expect(at24.vFovDeg).toBeCloseTo(73.739795, 6);
    expect(at24.hFovDeg).toBeCloseTo(38.166195, 6);
  });

  it('gives it to the width of the same frame rotated', () => {
    const at26 = fovDegFromFocalLength35mm(26, 852, 393);
    expect(at26.hFovDeg).toBeCloseTo(69.390307, 6);
    expect(at26.vFovDeg).toBeCloseTo(35.420632, 6);

    const at24 = fovDegFromFocalLength35mm(24, 852, 393);
    expect(at24.hFovDeg).toBeCloseTo(73.739795, 6);
    expect(at24.vFovDeg).toBeCloseTo(38.166195, 6);
  });

  it('does the same for the 4:3 frames a phone actually stores', () => {
    const portrait26 = fovDegFromFocalLength35mm(26, 3024, 4032);
    expect(portrait26.vFovDeg).toBeCloseTo(69.390307, 6);
    expect(portrait26.hFovDeg).toBeCloseTo(54.879456, 6);

    const landscape24 = fovDegFromFocalLength35mm(24, 4032, 3024);
    expect(landscape24.hFovDeg).toBeCloseTo(73.739795, 6);
    expect(landscape24.vFovDeg).toBeCloseTo(58.715507, 6);
  });

  it('is the long-side angle on whichever axis is longer, and only there', () => {
    for (const f35 of [13, 24, 26, 48, 100, 120]) {
      const longSide = longSideFovDegFromFocalLength35mm(f35);
      expect(fovDegFromFocalLength35mm(f35, 852, 393).hFovDeg).toBe(longSide);
      expect(fovDegFromFocalLength35mm(f35, 393, 852).vFovDeg).toBe(longSide);
      expect(fovDegFromFocalLength35mm(f35, 393, 852).hFovDeg).toBeLessThan(longSide);
    }
  });

  it('gives a square frame two equal angles', () => {
    const fov = fovDegFromFocalLength35mm(50, 1000, 1000);
    expect(fov.hFovDeg).toBeCloseTo(fov.vFovDeg, 12);
    expect(fov.hFovDeg).toBeCloseTo(39.597753, 6);
  });

  it('rejects impossible inputs rather than assuming a shape', () => {
    expect(() => fovDegFromFocalLength35mm(0, 800, 600)).toThrow(RangeError);
    expect(() => fovDegFromFocalLength35mm(26, 0, 600)).toThrow(RangeError);
    expect(() => fovDegFromFocalLength35mm(26, 800, Number.NaN)).toThrow(RangeError);
  });
});

describe('cameraPoseFromFocalLength — portrait frames', () => {
  it('carries the long-axis rule into the pose', () => {
    const pose = cameraPoseFromFocalLength({
      headingDeg: 12,
      focalLength35mm: 26,
      imageWidthPx: 393,
      imageHeightPx: 852,
    });
    expect(pose.vFovDeg).toBeCloseTo(69.390307, 6);
    expect(pose.hFovDeg).toBeCloseTo(35.420632, 6);
    expect(pose.vFovDeg).toBeGreaterThan(pose.hFovDeg);
  });
});

describe('cameraPoseFromFocalLength', () => {
  it('derives both fields of view from focal length and pixel dimensions', () => {
    const pose = cameraPoseFromFocalLength({
      headingDeg: 137,
      focalLength35mm: 24,
      imageWidthPx: 3000,
      imageHeightPx: 2000,
    });
    expect(pose.headingDeg).toBe(137);
    expect(pose.pitchDeg).toBe(0);
    expect(pose.rollDeg).toBe(0);
    expect(pose.hFovDeg).toBeCloseTo(73.7398, 3);
    expect(pose.vFovDeg).toBeCloseTo(53.1301, 3);
  });

  it('keeps hFOV but changes vFOV when the sensor shape changes', () => {
    const landscape3x2 = cameraPoseFromFocalLength({
      headingDeg: 0,
      focalLength35mm: 28,
      imageWidthPx: 6000,
      imageHeightPx: 4000,
    });
    const landscape4x3 = cameraPoseFromFocalLength({
      headingDeg: 0,
      focalLength35mm: 28,
      imageWidthPx: 4032,
      imageHeightPx: 3024,
    });
    expect(landscape4x3.hFovDeg).toBeCloseTo(landscape3x2.hFovDeg, 12);
    expect(landscape4x3.vFovDeg).toBeGreaterThan(landscape3x2.vFovDeg);
  });

  it('rejects degenerate image dimensions', () => {
    expect(() =>
      cameraPoseFromFocalLength({
        headingDeg: 0,
        focalLength35mm: 24,
        imageWidthPx: 0,
        imageHeightPx: 100,
      }),
    ).toThrow(RangeError);
  });
});

describe('projectToImage — identity cases', () => {
  /** A 90° × 90° square frame: tan of both half-FOVs is exactly 1. */
  const square90: CameraPose = {
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: 90,
    vFovDeg: 90,
  };

  /** A realistic 24 mm frame on 3:2, pointed east. */
  const wide: CameraPose = {
    headingDeg: 90,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: hFovDegFromFocalLength35mm(24),
    vFovDeg: vFovDegFromHFovDeg(hFovDegFromFocalLength35mm(24), 1.5),
  };

  it('puts a peak dead ahead at the centre of the frame', () => {
    for (const pose of [square90, wide]) {
      const image = projectToImage(pose, pose.headingDeg, pose.pitchDeg);
      expect(image.x).toBeCloseTo(0.5, 12);
      expect(image.y).toBeCloseTo(0.5, 12);
      expect(image.inFrame).toBe(true);
    }
  });

  it('puts a peak at heading + hFOV/2 on the right edge', () => {
    for (const pose of [square90, wide]) {
      const image = projectToImage(pose, pose.headingDeg + pose.hFovDeg / 2, 0);
      expect(image.x).toBeCloseTo(1, 12);
      expect(image.y).toBeCloseTo(0.5, 12);
    }
  });

  it('puts a peak at heading − hFOV/2 on the left edge', () => {
    for (const pose of [square90, wide]) {
      const image = projectToImage(pose, pose.headingDeg - pose.hFovDeg / 2, 0);
      expect(image.x).toBeCloseTo(0, 12);
      expect(image.y).toBeCloseTo(0.5, 12);
    }
  });

  it('puts altitude ±vFOV/2 on the top and bottom edges', () => {
    for (const pose of [square90, wide]) {
      const top = projectToImage(pose, pose.headingDeg, pose.vFovDeg / 2);
      const bottom = projectToImage(pose, pose.headingDeg, -pose.vFovDeg / 2);
      expect(top.y).toBeCloseTo(0, 12);
      expect(bottom.y).toBeCloseTo(1, 12);
      expect(top.x).toBeCloseTo(0.5, 12);
      expect(bottom.x).toBeCloseTo(0.5, 12);
    }
  });

  it('is rectilinear, not equiangular', () => {
    // Half of the half-FOV in *angle* is not half of it in image space.
    // For the 90° frame: x = 0.5 + tan(22.5°)/(2·tan(45°)) = 0.5 + 0.207107.
    const image = projectToImage(square90, 22.5, 0);
    expect(image.x).toBeCloseTo(0.5 + Math.tan(toRadians(22.5)) / 2, 12);
    expect(image.x).toBeCloseTo(0.7071068, 6);
    expect(image.x).not.toBeCloseTo(0.75, 3);

    // Conversely, the *tangent* midpoint does land at three-quarters width:
    // tan δ = 0.5 · tan 45° ⟹ δ = 26.5651°.
    const tangentMidpoint = toDegrees(Math.atan(0.5));
    expect(projectToImage(square90, tangentMidpoint, 0).x).toBeCloseTo(0.75, 12);
  });

  it('wraps the bearing difference across north', () => {
    // Camera on heading 350°, peak at bearing 10° — 20° to the right, not 340°.
    const pose: CameraPose = { ...square90, headingDeg: 350 };
    const image = projectToImage(pose, 10, 0);
    expect(image.x).toBeCloseTo(0.5 + Math.tan(toRadians(20)) / 2, 12);
    expect(image.inFrame).toBe(true);
  });
});

describe('projectToImage — pitch and roll', () => {
  const square90: CameraPose = {
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: 90,
    vFovDeg: 90,
  };

  it('recentres on the optical axis when the camera is pitched up', () => {
    const pose: CameraPose = { ...square90, pitchDeg: 15 };
    const centre = projectToImage(pose, 0, 15);
    expect(centre.x).toBeCloseTo(0.5, 12);
    expect(centre.y).toBeCloseTo(0.5, 12);

    // vFOV/2 above the optical axis is still the top edge: the projection
    // depends on the angle *relative to the axis*, i.e. cos(α−pitch) and
    // sin(α−pitch), so 15° + 45° = 60° altitude lands at y = 0.
    const top = projectToImage(pose, 0, 15 + 45);
    expect(top.y).toBeCloseTo(0, 12);
  });

  it('rotates the frame clockwise, so the scene rotates counter-clockwise', () => {
    // In a square 90° frame the right-edge point sits at bearing +45°.
    // Rolling the camera +90° (clockwise, seen from behind) sends that point
    // to the top edge; rolling −90° sends it to the bottom.
    const rolledCw: CameraPose = { ...square90, rollDeg: 90 };
    const rolledCcw: CameraPose = { ...square90, rollDeg: -90 };

    const cw = projectToImage(rolledCw, 45, 0);
    expect(cw.x).toBeCloseTo(0.5, 10);
    expect(cw.y).toBeCloseTo(0, 10);

    const ccw = projectToImage(rolledCcw, 45, 0);
    expect(ccw.x).toBeCloseTo(0.5, 10);
    expect(ccw.y).toBeCloseTo(1, 10);
  });

  it('mirrors the frame at 180° of roll', () => {
    const upsideDown: CameraPose = { ...square90, rollDeg: 180 };
    const image = projectToImage(upsideDown, 45, 0);
    expect(image.x).toBeCloseTo(0, 10);
    expect(image.y).toBeCloseTo(0.5, 10);
  });

  it('leaves the optical axis fixed under any roll', () => {
    for (const rollDeg of [-180, -37, 0, 12.5, 90, 179]) {
      const image = projectToImage({ ...square90, rollDeg }, 0, 0);
      expect(image.x).toBeCloseTo(0.5, 12);
      expect(image.y).toBeCloseTo(0.5, 12);
    }
  });
});

describe('projectToImage — framing', () => {
  const square90: CameraPose = {
    headingDeg: 0,
    pitchDeg: 0,
    rollDeg: 0,
    hFovDeg: 90,
    vFovDeg: 90,
  };

  it('reports comfortably interior points as in frame', () => {
    const image = projectToImage(square90, 20, -10);
    expect(image.x).toBeGreaterThan(0);
    expect(image.x).toBeLessThan(1);
    expect(image.inFrame).toBe(true);
  });

  it('reports points beyond the frame edge as out of frame', () => {
    // 60° off-axis in a 90° frame: x = 0.5 + tan60°/2 = 1.366.
    const image = projectToImage(square90, 60, 0);
    expect(image.x).toBeCloseTo(0.5 + Math.tan(toRadians(60)) / 2, 12);
    expect(image.inFrame).toBe(false);
  });

  it('never claims a target behind the camera is in frame', () => {
    for (const bearingDeg of [180, 135, 225, 91, 269]) {
      expect(projectToImage(square90, bearingDeg, 0).inFrame).toBe(false);
    }
  });

  it('rejects a target too high for the frame', () => {
    const image = projectToImage(square90, 0, 60);
    expect(image.y).toBeCloseTo(0.5 - Math.tan(toRadians(60)) / 2, 12);
    expect(image.inFrame).toBe(false);
  });
});
