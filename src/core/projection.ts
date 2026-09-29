/**
 * Camera projection: turning a direction in the world (a compass bearing and a
 * vertical angle) into a position on the photograph.
 *
 * ## The model
 *
 * An ordinary camera lens is (close enough to) **rectilinear**: it maps the
 * world by gnomonic projection onto a flat sensor, which is why straight lines
 * in the scene stay straight in the photo. The consequence that matters here
 * is that image position is linear in the *tangent* of the off-axis angle, not
 * in the angle itself — a peak 20° off-axis in a 40° frame does not sit at the
 * frame edge, it sits at tan20°/tan20° … which is the edge only because the
 * half-FOV happens to match. Away from that coincidence the difference between
 * angle-linear and tangent-linear placement is several percent of frame width,
 * far more than the ±0.5 % the renderer is held to.
 *
 * ## Frames
 *
 * World vectors are East-North-Up. A direction of bearing β and altitude α is
 *
 *     d = ( cos α · sin β , cos α · cos β , sin α )
 *
 * The camera contributes an orthonormal triple: `forward` along the optical
 * axis (heading + pitch), `right` across the frame and `up` up the frame, the
 * latter two rotated about the optical axis by the roll angle. Projecting `d`
 * onto that triple and dividing by the forward component is the perspective
 * divide; scaling by the half-FOV tangents lands it in [0,1] image space.
 *
 * ## Field of view
 *
 * Focal lengths are quoted as 35 mm equivalents, meaning the focal length that
 * would give the same framing on a 36 × 24 mm gate. One number, two frame
 * dimensions — so turning it into a pair of angles needs a stated rule.
 *
 * The rule here: the 36 mm angle, 2·atan(36 / (2·f₃₅)), belongs to the LONGER
 * displayed axis of the frame, and the shorter axis follows through the
 * rectilinear tangent relation. {@link fovDegFromFocalLength35mm} is the only
 * implementation of it in the repository; `src/exif/fov.ts` re-exports this
 * one rather than keeping a second copy, because the two once disagreed about
 * portrait frames and the disagreement was invisible on landscape photographs.
 */

import { toRadians } from './geodesy';
import type { CameraPose, ImagePoint } from './types';

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/** Width of a 35 mm film frame in millimetres — the reference for "35 mm equivalent". */
export const FULL_FRAME_WIDTH_MM = 36;

/** Short side of the same gate. Present so the gate's shape is stated. */
export const FULL_FRAME_HEIGHT_MM = 24;

/**
 * The angle a 35 mm-equivalent focal length spans across the LONG side of the
 * frame — the 36 mm dimension of the gate.
 *
 *     2 · atan( 36 mm / (2 · f₃₅) )
 *
 * Sanity anchors: 24 mm → 73.7°, 50 mm → 39.6°, 28 mm → 65.5°.
 *
 * Which physical dimension of the gate f₃₅ was matched against is a
 * convention, not a fact in the file. This repository matches the 36 mm side.
 * Apple's own figures suggest Apple matches the DIAGONAL instead: it quotes
 * "13 mm, 120°" for the ultrawide, and 2·atan(43.267/26) = 118.0° across the
 * diagonal against 2·atan(36/26) = 108.3° across the long side. On a 4:3 frame
 * the two conventions differ by about 2° of long-side angle, some 3 % of
 * tangent scale. Which one the phones mean is unresolved and is to be settled
 * against the solved Railroad Ridge pose, where a measured field of view will
 * separate them. Until then the long side stands, because the tag names the
 * 35 mm FILM FORMAT whose gate is 36 × 24, and because the sensor diagonal the
 * other convention needs is not recorded anywhere in the photograph.
 */
export function longSideFovDegFromFocalLength35mm(focalLength35mm: number): number {
  if (!(focalLength35mm > 0)) {
    throw new RangeError(`focalLength35mm must be > 0, received ${focalLength35mm}`);
  }
  return 2 * Math.atan(FULL_FRAME_WIDTH_MM / (2 * focalLength35mm)) * DEG_PER_RAD;
}

/**
 * The field of view across the frame's other axis.
 *
 * On a flat sensor the half-frame *dimensions* scale with the aspect ratio, and
 * dimensions are proportional to the tangent of the half-angle — so it is the
 * tangents that scale, never the angles:
 *
 *     tan(otherFov/2) = tan(fov/2) · otherAxisPx / thisAxisPx
 *
 * Every field-of-view pair in the repository comes through here, so a 4:3 phone
 * frame and a 3:2 camera frame at the same equivalent focal length share their
 * long-side angle and differ on the short one.
 *
 * @throws RangeError on a fov outside (0, 180) or a non-positive extent.
 */
export function otherAxisFovDeg(fovDeg: number, thisAxisPx: number, otherAxisPx: number): number {
  if (!(fovDeg > 0) || fovDeg >= 180) {
    throw new RangeError(`fovDeg must be in (0, 180), received ${fovDeg}`);
  }
  if (!(thisAxisPx > 0) || !(otherAxisPx > 0)) {
    throw new RangeError(`frame extents must be > 0, received ${thisAxisPx} and ${otherAxisPx}`);
  }
  const halfTangent = Math.tan((fovDeg * RAD_PER_DEG) / 2);
  return 2 * Math.atan(halfTangent * (otherAxisPx / thisAxisPx)) * DEG_PER_RAD;
}

/**
 * The 36 mm-gate angle under its horizontal name, for callers that have a
 * focal length and no pixel dimensions to orient by.
 *
 * It is an hFOV only on a landscape frame. With dimensions in hand, call
 * {@link fovDegFromFocalLength35mm} — on a portrait frame this function
 * returns the angle across the picture's HEIGHT.
 */
export function hFovDegFromFocalLength35mm(focalLength35mm: number): number {
  return longSideFovDegFromFocalLength35mm(focalLength35mm);
}

/**
 * Inverse of {@link hFovDegFromFocalLength35mm} — useful when a user types a
 * field of view directly and the rest of the pipeline wants a focal length.
 */
export function focalLength35mmFromHFovDeg(hFovDeg: number): number {
  if (!(hFovDeg > 0) || hFovDeg >= 180) {
    throw new RangeError(`hFovDeg must be in (0, 180), received ${hFovDeg}`);
  }
  return FULL_FRAME_WIDTH_MM / (2 * Math.tan(toRadians(hFovDeg) / 2));
}

/**
 * Vertical field of view implied by a horizontal one and the image shape, for
 * callers holding a ratio rather than two pixel counts.
 *
 *     tan(vFOV/2) = tan(hFOV/2) / (width / height)
 *
 * See {@link otherAxisFovDeg}, which does the arithmetic.
 *
 * @param aspectRatio image width ÷ height (1.333 for 4:3, 1.5 for 3:2).
 */
export function vFovDegFromHFovDeg(hFovDeg: number, aspectRatio: number): number {
  if (!(hFovDeg > 0) || hFovDeg >= 180) {
    throw new RangeError(`hFovDeg must be in (0, 180), received ${hFovDeg}`);
  }
  if (!(aspectRatio > 0)) {
    throw new RangeError(`aspectRatio must be > 0, received ${aspectRatio}`);
  }
  return otherAxisFovDeg(hFovDeg, aspectRatio, 1);
}

/** Both fields of view of one frame. */
export interface FieldOfViewDeg {
  readonly hFovDeg: number;
  readonly vFovDeg: number;
}

/**
 * Both fields of view from a 35 mm-equivalent focal length and the frame's
 * DISPLAYED pixel dimensions. The single implementation of the long-axis rule.
 *
 * The 36 mm-gate angle goes to whichever displayed axis is longer and the
 * other axis follows through the tangent relation. A square frame is not a
 * special case: both sides are "the longer one" and the angles come out equal.
 *
 * "Displayed" is load-bearing, in two ways. A phone held upright stores its
 * sensor's landscape frame and sets EXIF Orientation 6, so a caller reading a
 * file must apply Orientation before calling this (`photoExifFromTags` does).
 * A live preview must pass the dimensions of the view it is drawing into, not
 * the sensor's.
 *
 * @throws RangeError on a non-positive focal length or non-positive dimensions.
 */
export function fovDegFromFocalLength35mm(
  focalLength35mm: number,
  displayedWidthPx: number,
  displayedHeightPx: number,
): FieldOfViewDeg {
  const longSideDeg = longSideFovDegFromFocalLength35mm(focalLength35mm);
  if (!(displayedWidthPx > 0) || !(displayedHeightPx > 0)) {
    throw new RangeError(
      `image dimensions must be > 0, received ${displayedWidthPx}×${displayedHeightPx}`,
    );
  }
  if (displayedWidthPx >= displayedHeightPx) {
    return {
      hFovDeg: longSideDeg,
      vFovDeg: otherAxisFovDeg(longSideDeg, displayedWidthPx, displayedHeightPx),
    };
  }
  return {
    hFovDeg: otherAxisFovDeg(longSideDeg, displayedHeightPx, displayedWidthPx),
    vFovDeg: longSideDeg,
  };
}

/** Everything needed to derive a {@link CameraPose} from photo metadata. */
export interface CameraPoseInput {
  headingDeg: number;
  pitchDeg?: number;
  rollDeg?: number;
  /** 35 mm-equivalent focal length in millimetres. */
  focalLength35mm: number;
  imageWidthPx: number;
  imageHeightPx: number;
}

/**
 * Assemble a {@link CameraPose} from the fields a photo actually carries:
 * a compass direction, a focal length and the pixel dimensions.
 *
 * Pitch and roll default to zero because EXIF rarely carries them; the app's
 * trim sliders adjust them afterwards.
 *
 * The two fields of view come from {@link fovDegFromFocalLength35mm}, so a
 * portrait frame gets the 36 mm angle on its height. Pass the dimensions of
 * the picture as displayed, not as stored.
 */
export function cameraPoseFromFocalLength(input: CameraPoseInput): CameraPose {
  const fov = fovDegFromFocalLength35mm(
    input.focalLength35mm,
    input.imageWidthPx,
    input.imageHeightPx,
  );
  return {
    headingDeg: input.headingDeg,
    pitchDeg: input.pitchDeg ?? 0,
    rollDeg: input.rollDeg ?? 0,
    hFovDeg: fov.hFovDeg,
    vFovDeg: fov.vFovDeg,
  };
}

/** A right-handed East-North-Up vector. */
export interface Vec3 {
  e: number;
  n: number;
  u: number;
}

function dot(a: Vec3, b: Vec3): number {
  return a.e * b.e + a.n * b.n + a.u * b.u;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    e: a.n * b.u - a.u * b.n,
    n: a.u * b.e - a.e * b.u,
    u: a.e * b.n - a.n * b.e,
  };
}

/** Unit direction vector for a compass bearing and vertical angle, in ENU. */
export function directionVector(bearingDeg: number, altitudeDeg: number): Vec3 {
  const bearing = toRadians(bearingDeg);
  const altitude = toRadians(altitudeDeg);
  const horizontal = Math.cos(altitude);
  return {
    e: horizontal * Math.sin(bearing),
    n: horizontal * Math.cos(bearing),
    u: Math.sin(altitude),
  };
}

/** The camera's orthonormal axes in world (ENU) coordinates. */
export interface CameraAxes {
  /** Along the optical axis, out of the lens. */
  forward: Vec3;
  /** Across the frame toward increasing image x. */
  right: Vec3;
  /** Up the frame toward decreasing image y. */
  up: Vec3;
}

/**
 * Build the camera's axis triple from its pose.
 *
 * Before roll, `right` is horizontal at heading + 90° (so the horizon runs
 * level across the frame) and `up` is `right × forward`, which tilts back as
 * the camera pitches up. Roll then spins both about the optical axis: a
 * positive (clockwise, viewed from behind the camera) roll of 90° sends the
 * camera's right axis to where its down axis was, which is what makes the
 * scene appear to rotate counter-clockwise in the frame.
 */
export function cameraAxes(pose: CameraPose): CameraAxes {
  const forward = directionVector(pose.headingDeg, pose.pitchDeg);

  const heading = toRadians(pose.headingDeg);
  // heading + 90°, level: (sin(h+90), cos(h+90), 0) = (cos h, −sin h, 0).
  const levelRight: Vec3 = { e: Math.cos(heading), n: -Math.sin(heading), u: 0 };
  const levelUp = cross(levelRight, forward);

  const roll = toRadians(pose.rollDeg);
  const cosRoll = Math.cos(roll);
  const sinRoll = Math.sin(roll);

  return {
    forward,
    right: {
      e: levelRight.e * cosRoll - levelUp.e * sinRoll,
      n: levelRight.n * cosRoll - levelUp.n * sinRoll,
      u: levelRight.u * cosRoll - levelUp.u * sinRoll,
    },
    up: {
      e: levelRight.e * sinRoll + levelUp.e * cosRoll,
      n: levelRight.n * sinRoll + levelUp.n * cosRoll,
      u: levelRight.u * sinRoll + levelUp.u * cosRoll,
    },
  };
}

/**
 * Project a world direction onto the photograph.
 *
 *     x = 0.5 + (d·right   / d·forward) / (2 · tan(hFOV/2))
 *     y = 0.5 − (d·up      / d·forward) / (2 · tan(vFOV/2))
 *
 * Dead ahead gives (0.5, 0.5); the horizontal half-FOV off-axis gives x = 1;
 * the vertical half-FOV above gives y = 0.
 *
 * When the target lies behind the camera (`d·forward ≤ 0`) there is no
 * rectilinear image of it at all — the perspective divide mirrors it back into
 * frame. Such points are always reported `inFrame: false`, and their x/y must
 * not be used for drawing.
 */
export function projectToImage(
  pose: CameraPose,
  bearingDeg: number,
  altitudeDeg: number,
): ImagePoint {
  const axes = cameraAxes(pose);
  const direction = directionVector(bearingDeg, altitudeDeg);

  const depth = dot(direction, axes.forward);
  const across = dot(direction, axes.right);
  const upward = dot(direction, axes.up);

  const halfWidth = Math.tan(toRadians(pose.hFovDeg) / 2);
  const halfHeight = Math.tan(toRadians(pose.vFovDeg) / 2);

  const x = 0.5 + across / depth / (2 * halfWidth);
  const y = 0.5 - upward / depth / (2 * halfHeight);

  const inFrame = depth > 0 && x >= 0 && x <= 1 && y >= 0 && y <= 1;
  return { x, y, inFrame };
}
