import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { extractPhotoExif } from './extract';
import { cameraPoseFromPhotoExif } from './photo-pose';
import type { PhotoExif } from './types';

/**
 * The pose `npm run annotate` builds, on the orientation fixture that used to
 * expose the axis bug.
 *
 * `fixtures/photos/portrait-orientation-6.jpg` stores a 800 x 600 landscape
 * frame with EXIF Orientation 6, so it DISPLAYS as 600 x 800 at f35 = 26 mm.
 * Expectations are the closed form by hand, as in projection.test.ts:
 *
 *   vFov = 2·atan(18/26) = 2·atan(9/13)                 = 69.390307°
 *   tan(hFov/2) = (9/13)·(600/800) = 0.519230769…
 *   hFov = 2·atan(0.519230769…)                         = 54.879456°
 *
 * Giving the gate angle to the displayed width instead would report hFov
 * 69.390307° and vFov 85.418780°, a frame a third too wide in tangent — every
 * bearing drawn at three quarters of its distance from the frame's centre.
 */
describe('cameraPoseFromPhotoExif on a portrait photograph', () => {
  it('orients the field of view by the DISPLAYED frame', async () => {
    const bytes = await readFile('fixtures/photos/portrait-orientation-6.jpg');
    const exif = await extractPhotoExif(new Uint8Array(bytes));

    expect(exif.orientation).toBe(6);
    expect(exif.imageWidthPx).toBe(600);
    expect(exif.imageHeightPx).toBe(800);
    expect(exif.focalLength35mmMm).toBe(26);

    const pose = cameraPoseFromPhotoExif(exif, { headingDeg: 210 });
    expect(pose.headingDeg).toBe(210);
    expect(pose.hFovDeg).toBeCloseTo(54.879456, 6);
    expect(pose.vFovDeg).toBeCloseTo(69.390307, 6);
    expect(pose.hFovDeg).not.toBeCloseTo(69.390307, 3);
  });
});

const LANDSCAPE_4X3: PhotoExif = {
  imgDirectionDeg: 137,
  imageWidthPx: 4032,
  imageHeightPx: 3024,
  focalLength35mmMm: 24,
};

describe('cameraPoseFromPhotoExif', () => {
  it('derives the fields of view from the focal length when EXIF states none', () => {
    const pose = cameraPoseFromPhotoExif(LANDSCAPE_4X3);
    expect(pose.headingDeg).toBe(137);
    expect(pose.pitchDeg).toBe(0);
    expect(pose.rollDeg).toBe(0);
    // 2·atan(0.75) across the width, 2·atan(0.75·0.75) down the height.
    expect(pose.hFovDeg).toBeCloseTo(73.739795, 6);
    expect(pose.vFovDeg).toBeCloseTo(58.715507, 6);
  });

  it('prefers a field of view the extractor already derived', () => {
    const pose = cameraPoseFromPhotoExif({ ...LANDSCAPE_4X3, hFovDeg: 60, vFovDeg: 45 });
    expect(pose.hFovDeg).toBe(60);
    expect(pose.vFovDeg).toBe(45);
  });

  it('completes a lone hFov through the tangent relation, not by ratio', () => {
    const pose = cameraPoseFromPhotoExif({ ...LANDSCAPE_4X3, hFovDeg: 90 });
    // tan(45°) = 1, so vFov = 2·atan(3024/4032) = 2·atan(0.75) = 73.739795°.
    expect(pose.vFovDeg).toBeCloseTo(73.739795, 6);
  });

  it('takes the heading override over GPSImgDirection', () => {
    expect(cameraPoseFromPhotoExif(LANDSCAPE_4X3, { headingDeg: 12 }).headingDeg).toBe(12);
  });

  it('refuses rather than defaulting when the photo states too little', () => {
    const { imgDirectionDeg: _heading, ...noHeading } = LANDSCAPE_4X3;
    expect(() => cameraPoseFromPhotoExif(noHeading)).toThrow(RangeError);

    const { imageHeightPx: _height, ...noDimensions } = LANDSCAPE_4X3;
    expect(() => cameraPoseFromPhotoExif(noDimensions)).toThrow(RangeError);

    const { focalLength35mmMm: _lens, ...noLens } = LANDSCAPE_4X3;
    expect(() => cameraPoseFromPhotoExif(noLens)).toThrow(RangeError);
  });
});
