/**
 * The live sweep's range, derived from the served grid.
 *
 * Two instruments, and they have to agree. {@link coveredRadiusKm} answers in
 * closed form; {@link ringIsInside} samples 720 bearings through
 * `destinationPoint` and `gridContains`, which is the same arithmetic the sweep
 * itself walks. A radius just inside the closed-form answer must have every ray
 * end inside the grid, and one just outside must not.
 *
 * The expectations for the closed form are written out here from the spherical
 * geometry rather than taken from a run: a meridian arc is the latitude gap in
 * radians times the Earth's radius, and the extreme longitude of a circle of
 * angular radius δ at latitude φ satisfies `sin Δλ = sin δ / cos φ`.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../../core/geodesy';
import type { GridGeometry } from '../../providers/hgt-tile';
import { APP_SWEEP } from '../overlay-builder';
import {
  coveredRadiusKm,
  DEFAULT_SWEEP_RANGE_KM,
  liveSweepRange,
  ringIsInside,
  SWEEP_RANGE_CAP_KM,
  SWEEP_RANGE_MARGIN_KM,
  sweepRangeSentence,
} from './sweep-range';

const RAD = Math.PI / 180;

/** A 1° × 1° grid at SRTM1 spacing whose south-west corner is (south, west). */
function degreeGrid(southLat: number, westLon: number): GridGeometry {
  return {
    northLat: southLat + 1,
    westLon,
    rows: 3601,
    cols: 3601,
    latStepDeg: 1 / 3600,
    lonStepDeg: 1 / 3600,
  };
}

/** Meridian arc for a latitude gap, km — the north and south bound. */
function meridianKm(gapDeg: number): number {
  return (gapDeg * RAD * EARTH_RADIUS_M) / 1000;
}

/** The angular radius whose circle just reaches `gapDeg` of longitude, km. */
function longitudeBoundKm(gapDeg: number, latDeg: number): number {
  const sinDelta = Math.sin(gapDeg * RAD) * Math.cos(latDeg * RAD);
  return (Math.asin(sinDelta) * EARTH_RADIUS_M) / 1000;
}

describe('coveredRadiusKm', () => {
  it('is the longitude bound at the centre of a square degree, because cos φ shrinks it', () => {
    // Centre of a 1° box: 0.5° to every edge. The two meridian gaps give
    // 55.5975 km; the two longitude gaps give slightly less, because a circle
    // has to be smaller to reach the same longitude offset away from the equator.
    const grid = degreeGrid(0, 0);
    const at = { lat: 0.5, lon: 0.5 };
    const north = meridianKm(0.5);
    const east = longitudeBoundKm(0.5, 0.5);
    expect(north).toBeCloseTo(55.5975, 3);
    expect(east).toBeLessThan(north);
    expect(coveredRadiusKm(grid, at)).toBeCloseTo(east, 9);
  });

  it('is the nearest edge for a viewpoint off centre', () => {
    // Gornergrat in N45E007: the north edge is 0.016667° away, which is the
    // tightest of the four by two orders of magnitude.
    const grid = degreeGrid(45, 7);
    const at = { lat: 45.983333, lon: 7.782222 };
    expect(coveredRadiusKm(grid, at)).toBeCloseTo(meridianKm(46 - 45.983333), 6);
    expect(coveredRadiusKm(grid, at)).toBeLessThan(2);
  });

  it('agrees with a 720-bearing ring walked through the real geodesy', () => {
    const grid = degreeGrid(43, -117);
    const at = { lat: 43.6, lon: -116.4 };
    const covered = coveredRadiusKm(grid, at);
    expect(covered).toBeGreaterThan(10);
    // Just inside: every ray end is on the grid. Just outside: at least one is
    // not. The step is 10 m, which is under a third of an SRTM1 posting.
    expect(ringIsInside(grid, at, covered - 0.01, 720)).toBe(true);
    expect(ringIsInside(grid, at, covered + 0.01, 720)).toBe(false);
  });

  it('is 0 outside the grid, so no range can be derived from terrain elsewhere', () => {
    const grid = degreeGrid(45, 7);
    expect(coveredRadiusKm(grid, { lat: 47.5, lon: 7.5 })).toBe(0);
    expect(coveredRadiusKm(grid, { lat: 45.5, lon: 9.5 })).toBe(0);
  });

  it('compares longitude modulo 360, so a coordinate on the other seam convention lands', () => {
    // W180 holds lon −180 to −179, and a position arriving as +180 is the same
    // meridian. `gridContains` already works this way; the radius must too.
    const grid = degreeGrid(0, -180);
    expect(coveredRadiusKm(grid, { lat: 0.5, lon: 180 })).toBe(0);
    expect(coveredRadiusKm(grid, { lat: 0.5, lon: -179.5 })).toBeGreaterThan(50);
  });
});

describe('liveSweepRange', () => {
  it('keeps the still app’s range when no grid geometry is known', () => {
    const range = liveSweepRange(undefined, { lat: 45, lon: 7 });
    expect(range.maxRangeKm).toBe(APP_SWEEP.maxRangeKm);
    expect(range.source).toBe('default');
    expect(range.coveredRadiusKm).toBeUndefined();
    expect(DEFAULT_SWEEP_RANGE_KM).toBe(30);
  });

  it('keeps 30 km at a whole-tile viewpoint whose nearest edge is closer than that', () => {
    // The derived range is a floor, not a ceiling: cutting Gornergrat's sweep to
    // the 1.85 km of tile north of it would drop the occluders the tile holds in
    // the other three directions, and the pipeline already refuses a verdict on a
    // ray with a hole in it.
    const range = liveSweepRange(degreeGrid(45, 7), { lat: 45.983333, lon: 7.782222 });
    expect(range.maxRangeKm).toBe(30);
    expect(range.source).toBe('default');
    expect(range.coveredRadiusKm).toBeLessThan(2);
  });

  it('takes the site radius at a viewpoint inside a wide mosaic, and stops at the cap', () => {
    // A grid four degrees across, centred on the Bogus Basin viewpoint: covered
    // far beyond the cap, so the cap is what sets the range.
    const wide: GridGeometry = {
      northLat: 45.8,
      westLon: -118.1,
      rows: 4 * 3600 + 1,
      cols: 4 * 3600 + 1,
      latStepDeg: 1 / 3600,
      lonStepDeg: 1 / 3600,
    };
    const at = { lat: 43.8, lon: -116.1 };
    const range = liveSweepRange(wide, at);
    expect(range.maxRangeKm).toBe(SWEEP_RANGE_CAP_KM);
    expect(range.source).toBe('served-grid');
    expect(range.coveredRadiusKm ?? 0).toBeGreaterThan(SWEEP_RANGE_CAP_KM);
  });

  it('never claims a radius the grid does not cover', () => {
    // A grid covering a little over 40 km in the tightest direction must give a
    // range strictly inside that, by at least the stated margin, and the ring at
    // the range it gives must be inside the grid.
    const grid = degreeGrid(43, -117);
    const at = { lat: 43.4, lon: -116.5 };
    const range = liveSweepRange(grid, at);
    const covered = range.coveredRadiusKm ?? 0;
    expect(range.maxRangeKm).toBeLessThanOrEqual(covered - SWEEP_RANGE_MARGIN_KM);
    expect(ringIsInside(grid, at, range.maxRangeKm, 720)).toBe(true);
  });

  it('keeps the margin even where rounding down would not supply it', () => {
    // Rounding to whole kilometres hides the margin whenever the covered radius
    // has a fraction bigger than it. So the case that pins the margin is one
    // where the fraction is SMALLER: there, rounding alone would leave the ray
    // ends within a quarter kilometre of the edge, and the margin has to take
    // the range down another whole kilometre.
    const grid = degreeGrid(43, -117);
    const tight = (() => {
      for (let step = 0; step < 4000; step += 1) {
        const at = { lat: 43.5, lon: -117 + 0.2 + step * 0.0001 };
        const covered = coveredRadiusKm(grid, at);
        if (covered <= DEFAULT_SWEEP_RANGE_KM + 1) continue;
        if (covered - Math.floor(covered) < SWEEP_RANGE_MARGIN_KM) return { at, covered };
      }
      return undefined;
    })();
    expect(tight, 'no viewpoint with a small enough fraction was found').toBeDefined();
    if (tight === undefined) return;
    const range = liveSweepRange(grid, tight.at);
    expect(range.maxRangeKm).toBe(Math.floor(tight.covered) - 1);
    expect(tight.covered - range.maxRangeKm).toBeGreaterThanOrEqual(SWEEP_RANGE_MARGIN_KM);
  });

  it('rounds down to whole kilometres, so the label is the range that ran', () => {
    const grid = degreeGrid(43, -117);
    const at = { lat: 43.4, lon: -116.5 };
    expect(Number.isInteger(liveSweepRange(grid, at).maxRangeKm)).toBe(true);
  });
});

describe('sweepRangeSentence', () => {
  it('says "measured" only above the default, which is the only way the grid raises it', () => {
    expect(sweepRangeSentence(60)).toContain('measured out to 60 km');
    expect(sweepRangeSentence(60)).toContain("site's terrain covers");
    expect(sweepRangeSentence(30)).toContain('30 km');
    expect(sweepRangeSentence(30)).toContain('default range');
  });
});
