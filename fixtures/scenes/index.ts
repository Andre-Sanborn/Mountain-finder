/**
 * Registry of the synthetic analytic scenes (archive/v2-docs-20260929/PLAN.md P6.1).
 *
 * Every scene here has a closed-form answer derived by hand in its own module.
 * Nothing in this directory imports src/core except the frozen type contract,
 * so these expectations remain an independent check on the pipeline rather
 * than a mirror of it.
 */

export * from './scene';
export * from './scene-geometry';

export {
  flatPlaneScene,
  bruteForceSkylineAltitudeDeg as flatPlaneBruteForceSkyline,
  EXPECTED_DIP_DEG as FLAT_PLANE_EXPECTED_DIP_DEG,
  EXPECTED_DIP_SMALL_ANGLE_DEG as FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG,
  EXPECTED_HORIZON_DISTANCE_M as FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M,
  EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M as FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M,
  NON_SAMPLED_EXPECTATION_BEARING_DEG as FLAT_PLANE_NON_SAMPLED_BEARING_DEG,
} from './flat-plane';

export {
  twinRidgesFarVisibleScene,
  twinRidgesFarHiddenScene,
  NEAR_RIDGE_CREST_M,
  NEAR_RIDGE_DISTANCE_M,
  FAR_RIDGE_DISTANCE_M,
  FAR_RIDGE_CREST_VISIBLE_M,
  FAR_RIDGE_CREST_HIDDEN_M,
  PLAIN_ELEVATION_M as TWIN_RIDGES_PLAIN_ELEVATION_M,
  PRIMARY_BEARING_DEG as TWIN_RIDGES_PRIMARY_BEARING_DEG,
} from './twin-ridges';

export {
  conicalPeakScene,
  bruteForceRayMaximum as conicalPeakBruteForceRayMaximum,
  APEX_BEARING_DEG as CONE_APEX_BEARING_DEG,
  APEX_DISTANCE_M as CONE_APEX_DISTANCE_M,
  APEX_ELEVATION_M as CONE_APEX_ELEVATION_M,
  CONE_ANGULAR_HALF_WIDTH_DEG,
  EXPECTED_APEX_ALTITUDE_DEG as CONE_EXPECTED_APEX_ALTITUDE_DEG,
  EXPECTED_APEX_ALTITUDE_PLANE_DROP_DEG as CONE_EXPECTED_APEX_ALTITUDE_PLANE_DROP_DEG,
  APEX_OCCLUDER as CONE_APEX_OCCLUDER,
  EXPECTED_APEX_OCCLUDING_ALTITUDE_DEG as CONE_EXPECTED_APEX_OCCLUDING_ALTITUDE_DEG,
  EXPECTED_APEX_OCCLUDING_ALTITUDE_PLANE_DROP_DEG as CONE_EXPECTED_APEX_OCCLUDING_PLANE_DROP_DEG,
  BASE_RADIUS_M as CONE_BASE_RADIUS_M,
  EXPECTED_PLAIN_DIP_DEG as CONE_EXPECTED_PLAIN_DIP_DEG,
  PLAIN_BEARING_DEG as CONE_PLAIN_BEARING_DEG,
} from './conical-peak';

import { conicalPeakScene } from './conical-peak';
import { flatPlaneScene } from './flat-plane';
import { twinRidgesFarHiddenScene, twinRidgesFarVisibleScene } from './twin-ridges';
import type { SyntheticScene } from './scene';

/** All analytic scenes, in the order a reader should meet them. */
export const analyticScenes: readonly SyntheticScene[] = [
  flatPlaneScene,
  twinRidgesFarVisibleScene,
  twinRidgesFarHiddenScene,
  conicalPeakScene,
];
