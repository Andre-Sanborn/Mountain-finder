/**
 * The wiring between the app, the pipeline and the renderer (archive/v2-docs-20260929/TODO.md Q1).
 *
 * Everything here is offline and analytic: terrain is a function (a flat plane
 * at 0 m), peaks are a fixed list, and the expectations are derived from the
 * geometry rather than from the pipeline's own output.
 *
 * The scene used by the end-to-end cases:
 *
 *   observer  0°N 0°E, ground 0 m, eye 1.6 m, camera heading 90° (due east),
 *             hFOV 60°, vFOV 45°
 *   EAST      a 1000 m summit at 0°N 0.09°E — bearing 90°, ~10.0 km away, so
 *             it sits dead centre of the frame and stands far above a plane
 *             that is level with the observer's feet. It must be labelled.
 *   WEST      an identical summit at 0°N −0.09°E — bearing 270°, directly
 *             BEHIND the camera. It must never be labelled, whatever the
 *             pipeline thinks of it.
 */

import { describe, expect, it } from 'vitest';

import type { Peak } from '../core/types';
import { FunctionElevationSource, StaticPeakSource } from '../pipeline/testing/elevation-sources';
import type { TerrainCoverage } from '../providers/http-terrain-store';
import {
  createOverlayBuilder,
  noTerrainMessage,
  selectOverlayPeaks,
  sweepForPose,
  type TerrainSource,
} from './overlay-builder';
import type { OverlayRequest } from './seam';

const EAST_PEAK: Peak = {
  id: 'test/east',
  name: 'East Summit',
  lat: 0,
  lon: 0.09,
  elevationM: 1000,
  elevationSource: 'osm',
};

const WEST_PEAK: Peak = { ...EAST_PEAK, id: 'test/west', name: 'West Summit', lon: -0.09 };

const REQUEST: OverlayRequest = {
  frame: { widthPx: 1600, heightPx: 1200 },
  observer: { lat: 0, lon: 0, groundElevationM: 0, eyeHeightM: 1.6 },
  pose: { headingDeg: 90, pitchDeg: 0, rollDeg: 0, hFovDeg: 60, vFovDeg: 45 },
  showObscuredPeaks: true,
};

/** A terrain source that is flat, complete, and knows it. */
function flatTerrain(covered = true): TerrainSource {
  return {
    elevation: new FunctionElevationSource(() => 0, 'flat-plane'),
    coverage: (): Promise<TerrainCoverage> =>
      Promise.resolve({
        covered,
        tileName: 'N00E000',
        available: covered ? ['N00E000'] : ['N45E007'],
        ...(covered
          ? {
              grid: {
                name: 'N00E000',
                url: 'tiles/N00E000.hgt',
                dataset: 'srtm1',
                geometry: {
                  northLat: 1,
                  westLon: 0,
                  rows: 3601,
                  cols: 3601,
                  latStepDeg: 1 / 3600,
                  lonStepDeg: 1 / 3600,
                },
              },
            }
          : {}),
      }),
  };
}

function builder(options: { covered?: boolean; peaks?: readonly Peak[] } = {}) {
  return createOverlayBuilder({
    terrain: flatTerrain(options.covered ?? true),
    peaks: new StaticPeakSource(options.peaks ?? [EAST_PEAK, WEST_PEAK]),
    // A short sweep — but not shorter than the summits it has to judge. It
    // used to stop at 5 km, on the grounds that 5 km of a plane settles the
    // horizon as conclusively as 30 would. True of THIS terrain, and not
    // something the pipeline can know from inside: since review 2's finding 2
    // it refuses to call a 10 km summit visible off 5 km of measured ground,
    // which is the whole point. 12 km covers both summits and still costs a
    // fraction of the default sweep's samples.
    config: { sweep: { maxRangeKm: 12, rangeStepM: 250, bearingStepDeg: 1 } },
  });
}

describe('sweepForPose', () => {
  it('sweeps twice the field of view, centred on the heading', () => {
    // hFOV 60 → span 120, so the sweep starts at 265.4 − 60 = 205.4°.
    const sweep = sweepForPose({
      headingDeg: 265.4,
      pitchDeg: 0,
      rollDeg: 0,
      hFovDeg: 60,
      vFovDeg: 45,
    });
    expect(sweep.spanDeg).toBeCloseTo(120, 12);
    expect(sweep.startBearingDeg).toBeCloseTo(205.4, 12);
  });

  it('wraps the start bearing into [0, 360) rather than going negative', () => {
    // Heading 10°, hFOV 60 → start at −50°, which is 310°.
    const sweep = sweepForPose({
      headingDeg: 10,
      pitchDeg: 0,
      rollDeg: 0,
      hFovDeg: 60,
      vFovDeg: 45,
    });
    expect(sweep.startBearingDeg).toBeCloseTo(310, 12);
  });

  it('never asks for more than a full circle', () => {
    const sweep = sweepForPose({
      headingDeg: 0,
      pitchDeg: 0,
      rollDeg: 0,
      hFovDeg: 200,
      vFovDeg: 120,
    });
    expect(sweep.spanDeg).toBe(360);
  });

  it('always covers more than the renderer draws', () => {
    // The overlay samples its horizon polyline across 1.5 × hFOV, so a sweep
    // of exactly hFOV would leave the ends of the drawn line unsupported.
    const hFovDeg = 65.47;
    const sweep = sweepForPose({ headingDeg: 180, pitchDeg: 0, rollDeg: 0, hFovDeg, vFovDeg: 50 });
    expect(sweep.spanDeg).toBeGreaterThan(1.5 * hFovDeg);
  });
});

describe('selectOverlayPeaks', () => {
  const visible = { name: 'Clear', visibility: 'visible' as const };
  const selfOccluded = { name: 'Own hill', visibility: 'self-occluded' as const };

  it('passes the visibility state through so the renderer can grey a summit', () => {
    const peaks = selectOverlayPeaks(
      { visible: [visible], labelled: [visible, selfOccluded] },
      true,
    );
    expect(peaks.map((peak) => peak.visibility)).toEqual(['visible', 'self-occluded']);
  });

  it('drops obscured summits entirely when the switch is off', () => {
    const peaks = selectOverlayPeaks(
      { visible: [visible], labelled: [visible, selfOccluded] },
      false,
    );
    expect(peaks.map((peak) => peak.name)).toEqual(['Clear']);
  });
});

describe('noTerrainMessage', () => {
  const message = noTerrainMessage(
    { covered: false, tileName: 'N45E006', available: ['N45E007', 'N46E007'] },
    { lat: 45.9237, lon: 6.8694 },
  );

  it('names the position, the missing tile and how to get it', () => {
    expect(message).toContain('45.9237');
    expect(message).toContain('6.8694');
    expect(message).toContain('N45E006');
    expect(message).toContain('npm run fetch:tiles');
  });

  it('says what terrain the app does hold, so the absence is checkable', () => {
    expect(message).toContain('N45E007');
  });

  it('never suggests anything was drawn', () => {
    expect(message).toMatch(/no (horizon|terrain)/i);
  });

  it('speaks to a visitor first: the DEPLOYMENT lacks the tile', () => {
    // A member of the public looking at a published site cannot run npm and has
    // no data/tiles/ to serve. The claim they are shown has to be one about
    // this build, and it has to be scoped — the app is not broken everywhere.
    expect(message).toContain('this deployment does not hold');
    expect(message).toMatch(/terrain this build does ship are unaffected/i);
    // The visitor-facing sentences come first; nothing before the parenthesis
    // instructs anyone to type anything.
    const beforeAside = message.slice(0, message.indexOf('('));
    expect(beforeAside).not.toMatch(/npm run|Run "/);
  });

  it('keeps the developer instruction, scoped to someone who can run it', () => {
    const checkout = message.indexOf('source checkout');
    const command = message.indexOf('npm run fetch:tiles');
    expect(checkout).toBeGreaterThan(-1);
    // The condition is stated before the command, not after it.
    expect(command).toBeGreaterThan(checkout);
  });
});

describe('createOverlayBuilder', () => {
  it('labels the summit in front of the camera and returns real SVG', async () => {
    const result = await builder()(REQUEST);
    expect(result.peakNames).toEqual(['East Summit']);
    expect(result.svgMarkup.startsWith('<svg')).toBe(true);
    expect(result.svgMarkup).toContain('East Summit');
    // The frame the app hands over is the frame the overlay is drawn for.
    expect(result.svgMarkup).toContain('viewBox="0 0 1600 1200"');
  });

  it('never labels a summit behind the camera, and says it left it out', async () => {
    const result = await builder()(REQUEST);
    expect(result.svgMarkup).not.toContain('West Summit');
    expect(result.notes?.join(' ')).toContain('West Summit');
  });

  it('refuses to build anything where the app has no terrain', async () => {
    await expect(builder({ covered: false })(REQUEST)).rejects.toThrow(/N45E007/);
    // And it refuses BEFORE running the pipeline, so the message is about the
    // missing tile rather than about an empty sweep.
    await expect(builder({ covered: false })(REQUEST)).rejects.toThrow(/npm run fetch:tiles/);
  });

  it('says so when the peak database has nothing here, rather than drawing an empty frame', async () => {
    const result = await builder({ peaks: [] })(REQUEST);
    expect(result.peakNames).toEqual([]);
    expect(result.notes?.join(' ')).toMatch(/peak database/i);
    // The horizon is still drawn — that part IS a result.
    expect(result.svgMarkup).toContain('polyline');
  });

  it('honours an abort signal instead of finishing a run nobody wants', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(builder()({ ...REQUEST, signal: controller.signal })).rejects.toThrow();
  });
});

describe('selectOverlayPeaks — marginal summits (P1.6)', () => {
  const visible = { name: 'Clear', visibility: 'visible' as const };
  const selfOccluded = { name: 'Own hill', visibility: 'self-occluded' as const };
  const marginal = { name: 'Coin toss', visibility: 'marginal' as const };
  const scene = { visible: [visible], labelled: [visible, selfOccluded, marginal] };

  it('keeps a marginal summit when the obscured switch is on', () => {
    expect(selectOverlayPeaks(scene, true).map((peak) => peak.name)).toEqual([
      'Clear',
      'Own hill',
      'Coin toss',
    ]);
  });

  it('keeps a marginal summit even with the obscured switch OFF', () => {
    // The switch hides summits tucked behind their own hill. A marginal summit
    // may be in plain view — hiding it would promote "cannot decide" to
    // "hidden", the exact claim the state exists to refuse.
    expect(selectOverlayPeaks(scene, false).map((peak) => peak.name)).toEqual([
      'Clear',
      'Coin toss',
    ]);
  });
});
