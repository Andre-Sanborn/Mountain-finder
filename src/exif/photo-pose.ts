/**
 * A `CameraPose` from one photograph's own EXIF, for callers that want the
 * whole pose or nothing.
 *
 * `resolvePose` is the richer path: it merges EXIF with user overrides and
 * documented defaults and names every field it cannot fill. This function is
 * for the simple case — a photograph that already states its position, heading,
 * lens and pixel dimensions, where a missing field is an error rather than a
 * prompt.
 *
 * The fields of view come from `exif.hFovDeg` / `exif.vFovDeg` when the
 * extractor derived them, and from the focal length and displayed dimensions
 * otherwise. Both routes reach the same long-axis rule in
 * `src/core/projection.ts`, so the preference only matters when a caller has
 * supplied a measured field of view that no focal length would reproduce.
 *
 * Pure: metadata in, pose out.
 */

import { fovDegFromFocalLength35mm, vFovDegFromHFovDeg } from '../core/projection';
import type { CameraPose } from '../core/types';

import type { PhotoExif } from './types';

/** Pose angles a caller may supply instead of, or on top of, the EXIF. */
export interface PhotoPoseOverrides {
  /** True-north heading in degrees, replacing `GPSImgDirection`. */
  readonly headingDeg?: number;
  readonly pitchDeg?: number;
  readonly rollDeg?: number;
}

/**
 * The camera pose a photograph states.
 *
 * @throws RangeError naming the field, when the heading, the pixel dimensions
 *   or the lens data are missing. A caller that wants to report several gaps at
 *   once should check the fields itself first.
 */
export function cameraPoseFromPhotoExif(
  exif: PhotoExif,
  overrides: PhotoPoseOverrides = {},
): CameraPose {
  const headingDeg = overrides.headingDeg ?? exif.imgDirectionDeg;
  if (headingDeg === undefined) {
    throw new RangeError('photo states no heading: no GPSImgDirection and no override');
  }
  const { imageWidthPx, imageHeightPx } = exif;
  if (imageWidthPx === undefined || imageHeightPx === undefined) {
    throw new RangeError('photo states no pixel dimensions');
  }

  const fov = fieldsOfView(exif, imageWidthPx, imageHeightPx);
  return {
    headingDeg,
    pitchDeg: overrides.pitchDeg ?? 0,
    rollDeg: overrides.rollDeg ?? 0,
    hFovDeg: fov.hFovDeg,
    vFovDeg: fov.vFovDeg,
  };
}

function fieldsOfView(
  exif: PhotoExif,
  widthPx: number,
  heightPx: number,
): { hFovDeg: number; vFovDeg: number } {
  const { hFovDeg, vFovDeg, focalLength35mmMm } = exif;
  if (hFovDeg !== undefined) {
    return {
      hFovDeg,
      vFovDeg: vFovDeg ?? vFovDegFromHFovDeg(hFovDeg, widthPx / heightPx),
    };
  }
  if (focalLength35mmMm === undefined) {
    throw new RangeError('photo states no field of view and no FocalLengthIn35mmFormat');
  }
  return fovDegFromFocalLength35mm(focalLength35mmMm, widthPx, heightPx);
}
