/**
 * The live terrain sweep — one full circle at the fix, D10 on.
 *
 * The scene runs against an analytic surface with no browser and no tiles, so
 * the expectations are exact. The surface is a flat plane at 1000 m with one
 * summit posted in the peak source at 2000 m, 10 km due east. A conical
 * mountain would let the horizon be checked in closed form, and
 * `tests/acceptance/analytic-scenes.test.ts` already does that; what this file
 * has to prove is different and narrower:
 *
 *   • the sweep is the whole circle, so `liveOverlayScene` never asks for a
 *     re-sweep however far the user turns
 *   • the near-field radius is on, so D10's "may be hidden" is reachable
 *   • coverage is settled before the pipeline runs, and its absence names the
 *     tile rather than producing an empty overlay
 */

import { describe, expect, it } from 'vitest';

import type { CameraPose, LatLng, Peak } from '../../core/types';
import { liveOverlayScene, uncoveredSpanDeg } from '../../live/loop';
import { FunctionElevationSource, StaticPeakSource } from '../../pipeline/testing/elevation-sources';
import type { TerrainCoverage } from '../../providers/http-terrain-store';
import {
  APP_NEAR_FIELD_RADIUS_M,
  APP_PEAK_RADIUS_KM,
  TerrainUnavailableError,
  type TerrainSource,
} from '../overlay-builder';
import {
  buildLiveScene,
  groundHeightNote,
  LIVE_SWEEP_SPAN_DEG,
  liveSweepConfig,
  metresFromFix,
  RESWEEP_DISTANCE_M,
} from './live-terrain';

const OBSERVER = { lat: 45, lon: 7, eyeHeightM: 1.6, fallbackGroundElevationM: 1000 };

/** 10 km due east of the observer, at 45° N: 1° of longitude is ~78.6 km. */
const SUMMIT: Peak = {
  id: 'analytic-summit',
  name: 'Analytic Summit',
  lat: 45,
  lon: 7 + 10 / (111.32 * Math.cos((45 * Math.PI) / 180)),
  elevationM: 2000,
  elevationSource: 'osm',
};

function terrainSource(covered: boolean, elevationM: number | null = 1000): TerrainSource {
  const coverage: TerrainCoverage = covered
    ? { covered: true, tileName: 'N45E007', available: ['N45E007'] }
    : { covered: false, tileName: 'N45E007', available: ['N46E007'] };
  return {
    elevation: new FunctionElevationSource(() => elevationM),
    coverage: () => Promise.resolve(coverage),
  };
}

describe('liveSweepConfig', () => {
  it('sweeps the whole circle from due north', () => {
    const config = liveSweepConfig();
    expect(config.sweep?.spanDeg).toBe(LIVE_SWEEP_SPAN_DEG);
    expect(LIVE_SWEEP_SPAN_DEG).toBe(360);
    expect(config.sweep?.startBearingDeg).toBe(0);
  });

  it('keeps the still app’s ray spacing, range and peak radius', () => {
    const config = liveSweepConfig();
    expect(config.sweep?.bearingStepDeg).toBe(0.5);
    expect(config.sweep?.rangeStepM).toBe(90);
    expect(config.sweep?.maxRangeKm).toBe(30);
    expect(config.peakRadiusKm).toBe(APP_PEAK_RADIUS_KM);
  });

  it('turns D10’s near field on, at the same 150 m the still app uses', () => {
    expect(liveSweepConfig().nearFieldRadiusM).toBe(APP_NEAR_FIELD_RADIUS_M);
    expect(APP_NEAR_FIELD_RADIUS_M).toBe(150);
  });
});

describe('buildLiveScene', () => {
  it('sweeps the circle once and labels the summit', async () => {
    const scene = await buildLiveScene(OBSERVER, {
      terrain: terrainSource(true),
      peaks: new StaticPeakSource([SUMMIT]),
    });

    expect(scene.config.sweep.spanDeg).toBe(360);
    // 360° at a half-degree step is 720 rays, and the plane answers every one.
    expect(scene.sweep.raysRequested).toBe(720);
    expect(scene.sweep.raysWithTerrain).toBe(720);
    // A 1000 m summit standing 1000 m above a flat plane is plainly visible.
    expect(scene.labelled.map((peak) => peak.name)).toContain('Analytic Summit');
  });

  it('is enough terrain for EVERY heading — no re-sweep, ever', async () => {
    // The reason the live sweep is the full circle. `liveOverlayScene` refuses
    // a pose whose drawn span reaches outside the swept sector; with a 360°
    // sweep there is no such pose, so a user can turn all the way round
    // without the screen stalling.
    const scene = await buildLiveScene(OBSERVER, {
      terrain: terrainSource(true),
      peaks: new StaticPeakSource([SUMMIT]),
    });

    for (let headingDeg = 0; headingDeg < 360; headingDeg += 7) {
      const pose: CameraPose = {
        headingDeg,
        pitchDeg: 0,
        rollDeg: 0,
        hFovDeg: 65.4704525442152,
        vFovDeg: 40,
      };
      expect(uncoveredSpanDeg(scene, pose), `heading ${headingDeg}`).toBe(0);
      const frame = liveOverlayScene(scene, pose, { widthPx: 800, heightPx: 450 });
      expect(frame.ok, `heading ${headingDeg}`).toBe(true);
    }
  });

  it('would refuse the same headings after a sector sweep — the contrast', async () => {
    // Same scene, swept the way the still app sweeps it (twice the field of
    // view). Most headings then reach outside the sector and are correctly
    // refused, which is the behaviour the full circle exists to avoid.
    const scene = await buildLiveScene(OBSERVER, {
      terrain: terrainSource(true),
      peaks: new StaticPeakSource([SUMMIT]),
    });
    const sector = {
      ...scene,
      config: { ...scene.config, sweep: { ...scene.config.sweep, spanDeg: 131, startBearingDeg: 0 } },
    };
    const refused = [0, 90, 180, 270].filter((headingDeg) => {
      const pose: CameraPose = {
        headingDeg,
        pitchDeg: 0,
        rollDeg: 0,
        hFovDeg: 65.4704525442152,
        vFovDeg: 40,
      };
      return !liveOverlayScene(sector, pose, { widthPx: 800, heightPx: 450 }).ok;
    });
    expect(refused.length).toBeGreaterThan(0);
  });

  it('names the missing tile instead of drawing nothing', async () => {
    // An empty overlay reads as "no peaks are visible from here", which is a
    // claim, and a fabricated one.
    await expect(
      buildLiveScene(OBSERVER, {
        terrain: terrainSource(false),
        peaks: new StaticPeakSource([SUMMIT]),
      }),
    ).rejects.toThrow(TerrainUnavailableError);

    const error = await buildLiveScene(OBSERVER, {
      terrain: terrainSource(false),
      peaks: new StaticPeakSource([SUMMIT]),
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(TerrainUnavailableError);
    if (!(error instanceof TerrainUnavailableError)) return;
    expect(error.message).toContain('N45E007');
    expect(error.message).toContain('no peaks are visible');
  });

  it('settles coverage BEFORE the pipeline runs', async () => {
    // A source that would throw if sampled: reaching it means coverage was
    // checked too late, and a user standing outside the published terrain
    // would wait through a 720-ray sweep to be told there is none.
    const elevation = new FunctionElevationSource(() => {
      throw new Error('the pipeline sampled terrain the deployment does not hold');
    });
    await expect(
      buildLiveScene(OBSERVER, {
        terrain: {
          elevation,
          coverage: () =>
            Promise.resolve({ covered: false, tileName: 'N45E007', available: [] }),
        },
        peaks: new StaticPeakSource([SUMMIT]),
      }),
    ).rejects.toThrow(TerrainUnavailableError);
    expect(elevation.pointsRequested).toBe(0);
  });

  it('passes an abort signal through to the sweep', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      buildLiveScene(OBSERVER, {
        terrain: terrainSource(true),
        peaks: new StaticPeakSource([SUMMIT]),
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it('lets the pipeline sample the ground when the fix carried no altitude', async () => {
    const { fallbackGroundElevationM: _dropped, ...noAltitude } = OBSERVER;
    const scene = await buildLiveScene(noAltitude, {
      terrain: terrainSource(true),
      peaks: new StaticPeakSource([SUMMIT]),
    });
    // The plane reads 1000 m everywhere, so that is what the observer stands on.
    expect(scene.observer.groundElevationM).toBeCloseTo(1000, 6);
  });

  it('prefers the terrain’s ground over the GPS altitude, and says so', async () => {
    // The plane is at 1000 m and the phone claims 1400 m. The DEM answer wins.
    // Phone altitude is above the geoid while this pipeline is ellipsoidal, and
    // the gap reaches about 50 m; a phone's vertical error adds tens more.
    const scene = await buildLiveScene(
      { ...OBSERVER, fallbackGroundElevationM: 1400 },
      { terrain: terrainSource(true, 1000), peaks: new StaticPeakSource([SUMMIT]) },
    );
    expect(scene.observer.groundElevationM).toBeCloseTo(1000, 6);
    expect(scene.observerResolution.groundElevationSource).toBe('terrain');

    const note = groundHeightNote(scene.observer, scene.observerResolution);
    expect(note.source).toBe('terrain');
    expect(note.warn).toBe(false);
    // 1000 m of ground plus 1.6 m of eye height is 1001.6 m.
    expect(note.text).toContain('1000.0 m of ground');
    expect(note.text).toContain('1001.6 m');
  });

  it('uses the GPS altitude only where the terrain has a void, and warns', async () => {
    // Covered tile, no sample at the observer's own point: an SRTM void. The
    // rays still read 1000 m, so the sweep works and only the observer's own
    // height falls back.
    const voidAtObserver = (point: LatLng): number | null =>
      point.lat === 45 && point.lon === 7 ? null : 1000;
    const scene = await buildLiveScene(
      { ...OBSERVER, fallbackGroundElevationM: 1400 },
      {
        terrain: {
          elevation: new FunctionElevationSource(voidAtObserver),
          coverage: () =>
            Promise.resolve({ covered: true, tileName: 'N45E007', available: ['N45E007'] }),
        },
        peaks: new StaticPeakSource([SUMMIT]),
      },
    );
    expect(scene.observer.groundElevationM).toBeCloseTo(1400, 6);
    expect(scene.observerResolution.groundElevationSource).toBe('fallback');

    const note = groundHeightNote(scene.observer, scene.observerResolution);
    expect(note.source).toBe('fallback');
    expect(note.warn).toBe(true);
    expect(note.text).toContain('no ground height at this spot');
    expect(note.text).toContain('tens of metres');
    expect(note.text).toContain('1401.6 m');
  });

  it('refuses to invent a height when neither the terrain nor GPS has one', async () => {
    // No supplied figure, no fallback and a void under the observer. Standing at
    // a fictitious 0 m in the Alps produces a horizon wrong by kilometres and a
    // set of labels that all look about right, so the pipeline throws instead.
    const { fallbackGroundElevationM: _dropped, ...noAltitude } = OBSERVER;
    await expect(
      buildLiveScene(noAltitude, {
        terrain: {
          elevation: new FunctionElevationSource((point) =>
            point.lat === 45 && point.lon === 7 ? null : 1000,
          ),
          coverage: () =>
            Promise.resolve({ covered: true, tileName: 'N45E007', available: ['N45E007'] }),
        },
        peaks: new StaticPeakSource([SUMMIT]),
      }),
    ).rejects.toThrow(/ground elevation/i);
  });
});

describe('metresFromFix', () => {
  it('measures a degree of latitude against the standard figure', () => {
    // 0.001° of latitude is 111.132 m by the metres-per-degree constant.
    const fix: LatLng = { lat: 45, lon: 7 };
    expect(metresFromFix(fix, { lat: 45.001, lon: 7 })).toBeCloseTo(111.132, 3);
  });

  it('shrinks a degree of longitude by the cosine of the latitude', () => {
    // At 45° N, 0.001° of longitude is 111.132 · cos 45° = 78.583 m.
    const fix: LatLng = { lat: 45, lon: 7 };
    expect(metresFromFix(fix, { lat: 45, lon: 7.001 })).toBeCloseTo(
      111.132 * Math.cos((45 * Math.PI) / 180),
      3,
    );
  });

  it('is zero at the fix and symmetric either side of it', () => {
    const fix: LatLng = { lat: 45, lon: 7 };
    expect(metresFromFix(fix, fix)).toBe(0);
    expect(metresFromFix(fix, { lat: 44.999, lon: 7 })).toBeCloseTo(
      metresFromFix(fix, { lat: 45.001, lon: 7 }),
      9,
    );
  });

  it('crosses the re-sweep distance where the distance says it does', () => {
    const fix: LatLng = { lat: 45, lon: 7 };
    // 0.005° of latitude is 555.66 m, past the threshold; 0.004° is 444.5 m.
    expect(metresFromFix(fix, { lat: 45.005, lon: 7 })).toBeGreaterThan(RESWEEP_DISTANCE_M);
    expect(metresFromFix(fix, { lat: 45.004, lon: 7 })).toBeLessThan(RESWEEP_DISTANCE_M);
  });
});
