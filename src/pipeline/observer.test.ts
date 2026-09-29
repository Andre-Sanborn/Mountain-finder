/**
 * Resolving the observer's ground height.
 *
 * The Zermatt figure below is not decoration: MISSION.md records that reading
 * the village from the correct tile (N46E007) gives 1608 m, its true
 * elevation — the evidence that terrain lookups for a VALLEY FLOOR are sound,
 * as opposed to summit heights, which SRTM under-reads by hundreds of metres.
 * This module is the place that distinction is enforced, so the test says so.
 */

import { describe, expect, it } from 'vitest';

import { PipelineError } from './errors';
import { eyeElevationM, resolveObserver } from './observer';
import { FunctionElevationSource } from './testing/elevation-sources';

const ZERMATT = { lat: 46.0207, lon: 7.7491 };

describe('resolveObserver', () => {
  it('uses a supplied ground elevation and never asks the terrain', async () => {
    const source = new FunctionElevationSource(() => 9999);
    const resolution = await resolveObserver(
      { ...ZERMATT, eyeHeightM: 1.6, groundElevationM: 1608 },
      source,
    );

    expect(resolution.groundElevationSource).toBe('supplied');
    expect(resolution.observer.groundElevationM).toBe(1608);
    expect(eyeElevationM(resolution.observer)).toBeCloseTo(1609.6, 10);
    expect(source.pointsRequested).toBe(0);
  });

  it('reads the ground height off the terrain when it is unknown', async () => {
    const source = new FunctionElevationSource(() => 1608, 'srtm1');
    const resolution = await resolveObserver({ ...ZERMATT, eyeHeightM: 1.6 }, source);

    expect(resolution.groundElevationSource).toBe('terrain');
    expect(resolution.observer.groundElevationM).toBe(1608);
    expect(resolution.terrainNote).toContain('srtm1');
    expect(source.pointsRequested).toBe(1);
  });

  it('falls back only when the terrain has no data, and says so', async () => {
    const source = new FunctionElevationSource(() => null, 'local-tiles(missing)');
    const resolution = await resolveObserver(
      { ...ZERMATT, eyeHeightM: 1.6, fallbackGroundElevationM: 1600 },
      source,
    );

    expect(resolution.groundElevationSource).toBe('fallback');
    expect(resolution.observer.groundElevationM).toBe(1600);
    expect(resolution.terrainNote).toContain('local-tiles(missing)');
  });

  it('throws rather than assuming sea level', async () => {
    const source = new FunctionElevationSource(() => null, 'local-tiles(missing)');
    // An observer placed at a fictitious 0 m in the Alps produces a horizon
    // that is wrong by kilometres and labels that all look plausible — the
    // worst available failure, so this path must be an error, not a default.
    await expect(resolveObserver({ ...ZERMATT, eyeHeightM: 1.6 }, source)).rejects.toBeInstanceOf(
      PipelineError,
    );
    await expect(resolveObserver({ ...ZERMATT, eyeHeightM: 1.6 }, source)).rejects.toMatchObject({
      code: 'observer-elevation-unknown',
    });
  });

  it('refuses a non-finite supplied ground elevation instead of measuring from NaN', async () => {
    // NaN does not throw anywhere downstream: it propagates through every
    // sight line, empties the horizon profile and leaves every peak unjudged,
    // so the run comes back as an empty overlay — "nothing is visible from
    // here" — rather than as a refusal.
    const source = new FunctionElevationSource(() => 1608, 'srtm1');
    for (const groundElevationM of [Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        resolveObserver({ ...ZERMATT, eyeHeightM: 1.6, groundElevationM }, source),
      ).rejects.toMatchObject({ code: 'observer-elevation-not-finite' });
    }
  });

  it('refuses a non-finite figure whichever of the three sources produced it', async () => {
    const nanTerrain = new FunctionElevationSource(() => Number.NaN, 'srtm1');
    await expect(resolveObserver({ ...ZERMATT, eyeHeightM: 1.6 }, nanTerrain)).rejects.toMatchObject(
      { code: 'observer-elevation-not-finite' },
    );
    const noTerrain = new FunctionElevationSource(() => null, 'local-tiles(missing)');
    await expect(
      resolveObserver(
        { ...ZERMATT, eyeHeightM: 1.6, fallbackGroundElevationM: Number.NaN },
        noTerrain,
      ),
    ).rejects.toMatchObject({ code: 'observer-elevation-not-finite' });
  });

  it('names the fetch command in the failure, so the fix is obvious', async () => {
    const source = new FunctionElevationSource(() => null);
    await expect(resolveObserver({ ...ZERMATT, eyeHeightM: 1.6 }, source)).rejects.toThrow(
      /npm run fetch:tiles/,
    );
  });
});
