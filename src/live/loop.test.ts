/**
 * P8.3's bar, from archive/v2-docs-20260929/PLAN.md: "N poses through the projection produce the
 * labels the still pipeline produces for the same poses." Asserted as a
 * PROPERTY over the ring-ridge scene: the live loop re-projects a stored
 * scene, the still pipeline is re-run at each pose, and the two layouts must
 * agree marker for marker, pixel for pixel.
 *
 * The scene and its closed forms are the ones documented at length in
 * src/pipeline/annotate.test.ts; nothing here re-derives them — this file's
 * subject is the EQUALITY, not the geometry.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../core/geodesy';
import type { CameraPose, Peak } from '../core/types';
import { greatCircleDistanceM } from '../../fixtures/scenes';
import { annotateScene } from '../pipeline/annotate';
import {
  FunctionElevationSource,
  StaticPeakSource,
  type TerrainFunctionM,
} from '../pipeline/testing/elevation-sources';
import type { AnnotateSceneRequest } from '../pipeline/types';
import { layoutOverlay } from '../render';

import { liveOverlayScene, uncoveredSpanDeg } from './loop';

const METRES_PER_DEG = (EARTH_RADIUS_M * Math.PI) / 180;
const ORIGIN = { lat: 0, lon: 0 };

const ringRidge: TerrainFunctionM = (point) => {
  const distanceM = greatCircleDistanceM(ORIGIN, point);
  return distanceM >= 4900 && distanceM <= 5100 ? 900 : 0;
};

const peaks: readonly Peak[] = [
  { id: 't/high', name: 'High', lat: 0, lon: 10_000 / METRES_PER_DEG, elevationM: 4478, elevationSource: 'unknown' },
  { id: 't/hidden', name: 'Hidden', lat: 0, lon: 20_000 / METRES_PER_DEG, elevationM: 1500, elevationSource: 'unknown' },
];

const FRAME = { widthPx: 1200, heightPx: 900 };

function poseAt(headingDeg: number, pitchDeg: number): CameraPose {
  return { headingDeg, pitchDeg, rollDeg: 0, hFovDeg: 60, vFovDeg: 40 };
}

function request(camera: CameraPose, spanDeg = 360, startBearingDeg = 0): AnnotateSceneRequest {
  return {
    observer: { lat: 0, lon: 0, eyeHeightM: 100 },
    camera,
    elevation: new FunctionElevationSource(ringRidge, 'ring-ridge'),
    peaks: new StaticPeakSource(peaks),
    config: {
      sweep: { bearingStepDeg: 1, rangeStepM: 250, maxRangeKm: 30, spanDeg, startBearingDeg },
      peakRadiusKm: 50,
      clock: () => new Date('2026-08-17T12:00:00.000Z'),
    },
  };
}

describe('liveOverlayScene — the P8.3 invariance', () => {
  it('re-projects one stored scene identically to re-running the pipeline, over 9 poses', async () => {
    const stored = await annotateScene(request(poseAt(90, 0)));

    for (const headingDeg of [70, 90, 110]) {
      for (const pitchDeg of [-5, 0, 5]) {
        const pose = poseAt(headingDeg, pitchDeg);
        const frame = liveOverlayScene(stored, pose, FRAME);
        expect(frame.ok).toBe(true);
        if (!frame.ok) continue;

        const still = await annotateScene(request(pose));
        const liveLayout = layoutOverlay(frame.overlay);
        const stillLayout = layoutOverlay({
          widthPx: FRAME.widthPx,
          heightPx: FRAME.heightPx,
          pose,
          horizon: still.horizon,
          peaks: still.labelled,
        });

        // Marker for marker, pixel for pixel: the loop and the pipeline are
        // the same projection of the same verdicts.
        expect(liveLayout.markers.map((m) => m.peak.name)).toEqual(
          stillLayout.markers.map((m) => m.peak.name),
        );
        for (const [index, marker] of liveLayout.markers.entries()) {
          const other = stillLayout.markers[index];
          expect(other).toBeDefined();
          expect(marker.summitPx.xPx).toBeCloseTo(other?.summitPx.xPx ?? NaN, 9);
          expect(marker.summitPx.yPx).toBeCloseTo(other?.summitPx.yPx ?? NaN, 9);
        }
      }
    }
  });

  it('refuses a pose whose drawn span leaves the swept sector, with the overshoot measured', async () => {
    // Sector [30°, 150°]: 120° wide. The drawn span is 1.5·60 = 90° wide, so
    // headings inside [75°, 105°] are fully covered and 120° is not:
    // right edge = 120 + 45 = 165°, overshooting the sector end by 15°.
    const stored = await annotateScene(request(poseAt(90, 0), 120, 30));

    const covered = liveOverlayScene(stored, poseAt(90, 0), FRAME);
    expect(covered.ok).toBe(true);

    const turned = liveOverlayScene(stored, poseAt(120, 0), FRAME);
    expect(turned.ok).toBe(false);
    if (turned.ok) return;
    expect(turned.reason).toBe('resweep-needed');
    expect(turned.uncoveredDeg).toBeCloseTo(15, 9);
    expect(turned.detail).toContain('re-run the pipeline');

    // The exported measure agrees, and a full-circle sweep never refuses.
    expect(uncoveredSpanDeg(stored, poseAt(120, 0))).toBeCloseTo(15, 9);
    const fullCircle = await annotateScene(request(poseAt(90, 0)));
    expect(uncoveredSpanDeg(fullCircle, poseAt(300, 0))).toBe(0);
  });

  it('refuses even a heading OPPOSITE the sector rather than wrapping into it', async () => {
    const stored = await annotateScene(request(poseAt(90, 0), 120, 30));
    const behind = liveOverlayScene(stored, poseAt(270, 0), FRAME);
    expect(behind.ok).toBe(false);
    if (behind.ok) return;
    // Drawn span [225°, 315°], sector [30°, 150°]: nothing overlaps — the
    // whole 90° drawn span is uncovered.
    expect(behind.uncoveredDeg).toBeCloseTo(90, 9);
  });
});
