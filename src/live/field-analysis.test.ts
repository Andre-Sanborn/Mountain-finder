/**
 * Tests for the field-bundle grader.
 *
 * WHERE THE EXPECTATIONS COME FROM. Every angle in this file is written out
 * from the pinhole relation with the arithmetic beside it, never taken from a
 * run of `field-analysis.ts`. The synthesiser places apex pixels and displaces
 * the drawn marker by a stated pixel offset; the degrees those pixels are worth
 * are computed here, independently, and `src/core/projection.ts`'s own
 * `projectToImage` is used as a second instrument on the conversion itself.
 *
 * The frame is 1920 x 884 px at hFOV 73.74°, so the focal length in pixels is
 *
 *     f = (1920 / 2) / tan(73.74° / 2) = 960 / 0.75000279... = 1279.99524 px
 *
 * and a displacement d from the frame centre is worth atan(d / f).
 */

import { describe, expect, it } from 'vitest';

import { projectToImage } from '../core/projection.js';
import type { Peak } from '../core/types.js';
import {
  analyseFieldRun,
  angularOffsetDeg,
  bandFor,
  MAX_TRUTH_DISAGREEMENT_DEG,
  parseFieldBundle,
  parseFieldTruth,
  PREREGISTERED_THRESHOLDS,
  reduceTruth,
  renderFieldReport,
  residualOf,
  synthesiseFieldBundle,
  withinThreshold,
  type Criterion,
  type FieldBundle,
  type SynthCapture,
  type SynthSummit,
} from './field-analysis.js';

import alignedBundle from '../../fixtures/field/aligned-bundle.json';
import alignedTruth from '../../fixtures/field/aligned-truth.json';
import strayBundle from '../../fixtures/field/stray-bundle.json';
import strayTruth from '../../fixtures/field/stray-truth.json';

const FRAME_WIDTH_PX = 1920;
const FRAME_HEIGHT_PX = 884;
const HFOV_DEG = 73.74;
const VFOV_DEG = 38.088;

/** f = (W/2) / tan(hFov/2), written out rather than imported. */
const FOCAL_PX = (FRAME_WIDTH_PX / 2) / Math.tan(((HFOV_DEG / 2) * Math.PI) / 180);

/** What a horizontal displacement from the frame centre is worth, in degrees. */
function degreesAcross(fromCentrePx: number, toCentrePx: number): number {
  return (
    (Math.atan(toCentrePx / FOCAL_PX) - Math.atan(fromCentrePx / FOCAL_PX)) * (180 / Math.PI)
  );
}

/**
 * The committed peak data, as the grader sees it. Four summits, one per band
 * the tests exercise, with the heights the bundles must agree with.
 */
const PEAKS: readonly Peak[] = [
  {
    id: 'overture/bb7147e9-f16f-3d21-a0cb-a60a47cc8873',
    name: 'Deer Point',
    lat: 0,
    lon: 0,
    elevationM: 2150,
    elevationSource: 'osm',
  },
  {
    id: 'overture/f2a82749-a0cb-3cea-b08c-c3d2d6e87938',
    name: 'Mores Mountain',
    lat: 0,
    lon: 0,
    elevationM: 2202,
    elevationSource: 'osm',
  },
  {
    id: 'overture/daf0b989-7a13-36e1-b4d0-b4ebfecf1e4c',
    name: 'Shafer Butte',
    lat: 0,
    lon: 0,
    elevationM: 2308,
    elevationSource: 'osm',
  },
  {
    id: 'overture/c72b4af9-b589-392c-9a35-02880fb5bff9',
    name: 'Jackson Peak',
    lat: 0,
    lon: 0,
    elevationM: 2471,
    elevationSource: 'osm',
  },
  {
    id: 'overture/91830abb-987b-3e66-9c17-856ce9b0ca5e',
    name: 'Trinity Mountain',
    lat: 0,
    lon: 0,
    elevationM: 2880,
    elevationSource: 'osm',
  },
];


/** Short names for the five committed summits, one per tolerance band. */
const NEAR = 'overture/bb7147e9-f16f-3d21-a0cb-a60a47cc8873';
const MID = 'overture/f2a82749-a0cb-3cea-b08c-c3d2d6e87938';
const FAR = 'overture/daf0b989-7a13-36e1-b4d0-b4ebfecf1e4c';
const DISTANT = 'overture/c72b4af9-b589-392c-9a35-02880fb5bff9';
const HORIZON = 'overture/91830abb-987b-3e66-9c17-856ce9b0ca5e';

const lookup = (id: string): Peak | undefined => PEAKS.find((peak) => peak.id === id);

function summit(overrides: Partial<SynthSummit> & Pick<SynthSummit, 'summitId'>): SynthSummit {
  const peak = lookup(overrides.summitId);
  return {
    name: peak?.name ?? 'Unknown',
    elevationM: peak?.elevationM ?? 0,
    distanceKm: 12,
    altitudeDeg: 3,
    truthPx: { xPx: 960, yPx: 442 },
    errorPx: { xPx: 0, yPx: 0 },
    ...overrides,
  };
}

function run(captures: readonly SynthCapture[]): ReturnType<typeof analyseFieldRun> {
  const { bundle, truth } = synthesiseFieldBundle({ captures });
  return analyseFieldRun(bundle, truth, lookup);
}

function criterion(
  analysis: ReturnType<typeof analyseFieldRun>,
  id: string,
): Criterion | undefined {
  return analysis.criteria.find((entry) => entry.id === id);
}

describe('pixels to frame angles', () => {
  it('matches the projection the renderer uses', () => {
    // Second instrument: src/core projects a bearing to a normalised x, and
    // this module reads a pixel back to an angle. Round-tripping through both
    // would hide a shared sign error, so the check is one-way: core places two
    // known bearings, and the grader must recover the angle between them.
    const pose = {
      headingDeg: 100,
      pitchDeg: 0,
      rollDeg: 0,
      hFovDeg: HFOV_DEG,
      vFovDeg: VFOV_DEG,
    };
    for (const offsetDeg of [1, 5, 12, 30]) {
      const centre = projectToImage(pose, pose.headingDeg, 0);
      const offset = projectToImage(pose, pose.headingDeg + offsetDeg, 0);
      const recovered =
        angularOffsetDeg(
          offset.x * FRAME_WIDTH_PX - FRAME_WIDTH_PX / 2,
          FRAME_WIDTH_PX,
          HFOV_DEG,
        ) -
        angularOffsetDeg(
          centre.x * FRAME_WIDTH_PX - FRAME_WIDTH_PX / 2,
          FRAME_WIDTH_PX,
          HFOV_DEG,
        );
      expect(recovered).toBeCloseTo(offsetDeg, 9);
    }
  });

  it('is not a linear scale: the same pixel step is worth less at the frame edge', () => {
    // 20 px either side of the centre: atan(20/1279.9952) = 0.89518°.
    const centre = angularOffsetDeg(20, FRAME_WIDTH_PX, HFOV_DEG);
    expect(centre).toBeCloseTo((Math.atan(20 / FOCAL_PX) * 180) / Math.PI, 12);
    expect(centre).toBeCloseTo(0.89518, 5);
    // 20 px at the frame edge: atan(960/f) − atan(940/f) = 0.57727°.
    const edge =
      angularOffsetDeg(960, FRAME_WIDTH_PX, HFOV_DEG) -
      angularOffsetDeg(940, FRAME_WIDTH_PX, HFOV_DEG);
    expect(edge).toBeCloseTo(0.57727, 5);
    expect(edge).toBeLessThan(centre);
  });

  it('converts an injected pixel error to the degrees the tangent relation gives', () => {
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          summits: [summit({ summitId: FAR, errorPx: { xPx: 30, yPx: -12 } })],
        },
      ],
    });
    const capture = bundle.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const residual = residualOf(
      capture,
      capture.overlay.drawn[0]?.summitPx ?? { xPx: 0, yPx: 0 },
      { xPx: 960, yPx: 442 },
    );
    // Truth is the frame centre in x, so the horizontal residual is atan(30/f).
    expect(residual.horizontalDeg).toBeCloseTo(degreesAcross(0, 30), 9);
    expect(residual.horizontalDeg).toBeCloseTo(1.34263, 5);
    expect(residual.horizontalPx).toBeCloseTo(30, 9);
    expect(residual.verticalPx).toBeCloseTo(-12, 9);
  });
});

describe('the pre-registered bands', () => {
  it('covers every distance with exactly one band', () => {
    for (const km of [0, 1, 2.999, 3, 5, 6.999, 7, 10, 19.999, 20, 30, 44.999, 45, 60, 200]) {
      const matches = PREREGISTERED_THRESHOLDS.filter(
        (threshold) => km >= threshold.fromKm && km < threshold.toKm,
      );
      expect(matches).toHaveLength(1);
    }
  });

  it('takes the tighter band at a boundary, upper bound exclusive', () => {
    // 3 km is the near/mid boundary. Grading it as `near` would give it the
    // looser 1.90° instead of 1.40°, which is the wrong direction for a limit.
    expect(bandFor(2.999)?.band).toBe('near');
    expect(bandFor(3)?.band).toBe('mid');
    expect(bandFor(7)?.band).toBe('far');
    expect(bandFor(20)?.band).toBe('distant');
    expect(bandFor(45)?.band).toBe('horizon');
  });

  it('puts the budget distances in the bands the pre-registration names', () => {
    expect(bandFor(2)?.band).toBe('near');
    expect(bandFor(5)?.band).toBe('mid');
    expect(bandFor(10)?.band).toBe('far');
    expect(bandFor(30)?.band).toBe('distant');
    expect(bandFor(60)?.band).toBe('horizon');
  });
});

describe('F3 against the registered thresholds', () => {
  // The `far` band's horizontal threshold is 1.30°. At the frame centre that is
  //   1279.9952 x tan(1.30°) = 29.047 px
  // so 29 px must pass and 30 px must fail. Both numbers are hand-computed here
  // and the synthesiser injects the pixels directly.
  const FAR_LIMIT_PX = FOCAL_PX * Math.tan((1.3 * Math.PI) / 180);

  it('knows the far band s limit is a shade over 29 px on this frame', () => {
    expect(FAR_LIMIT_PX).toBeCloseTo(29.0472, 4);
  });

  it('passes a summit 29 px out in the far band', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 29, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F3.far')?.n).toBe(1);
  });

  it('fails the same summit 30 px out', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 30, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('fail');
  });

  it('passes a residual exactly at the threshold, and fails one a hair over', () => {
    // The mutation this pins: `<=` to `<` in the one threshold comparison. No
    // test with a residual strictly inside or strictly outside can see it, so
    // the limit is fed in exactly, as a literal, rather than through the atan
    // chain where floating point would land just under it.
    const far = PREREGISTERED_THRESHOLDS.find((entry) => entry.band === 'far');
    expect(far).toBeDefined();
    if (far === undefined) return;
    const at = { horizontalDeg: 1.3, verticalDeg: 1.3, horizontalPx: 0, verticalPx: 0 };
    expect(withinThreshold(at, far)).toBe(true);
    expect(withinThreshold({ ...at, horizontalDeg: -1.3 }, far)).toBe(true);
    expect(withinThreshold({ ...at, horizontalDeg: 1.3000000001 }, far)).toBe(false);
    expect(withinThreshold({ ...at, verticalDeg: 1.3000000001 }, far)).toBe(false);
  });

  it('holds exactly at the threshold, which is what a flipped comparison breaks', () => {
    // The mutation this pins: `<=` to `<` in the threshold comparison, which no
    // test with a residual strictly inside or strictly outside can see. The
    // drawn marker is placed so the residual is 1.30000000° to twelve places.
    const exactPx = FOCAL_PX * Math.tan((1.3 * Math.PI) / 180);
    const { bundle, truth } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          summits: [
            summit({
              summitId: FAR,
              distanceKm: 12,
              truthPx: { xPx: FRAME_WIDTH_PX / 2, yPx: FRAME_HEIGHT_PX / 2 },
              errorPx: { xPx: exactPx, yPx: 0 },
            }),
          ],
        },
      ],
    });
    const capture = bundle.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const residual = residualOf(capture, capture.overlay.drawn[0]?.summitPx ?? { xPx: 0, yPx: 0 }, {
      xPx: FRAME_WIDTH_PX / 2,
      yPx: FRAME_HEIGHT_PX / 2,
    });
    expect(residual.horizontalDeg).toBeCloseTo(1.3, 12);
    expect(analyseFieldRun(bundle, truth, lookup).criteria.find((c) => c.id === 'F3.far')?.outcome).toBe(
      'pass',
    );
  });

  it('uses the near band s looser threshold for a 2 km summit', () => {
    // near horizontal is 1.90°: 1279.9952 x tan(1.90°) = 42.462 px. 40 px passes
    // in the near band and fails in the far one, so the band choice is tested
    // rather than assumed.
    const nearLimitPx = FOCAL_PX * Math.tan((1.9 * Math.PI) / 180);
    expect(nearLimitPx).toBeCloseTo(42.4618, 4);
    const near = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: NEAR, distanceKm: 2, errorPx: { xPx: 40, yPx: 0 } })],
      },
    ]);
    expect(criterion(near, 'F3.near')?.outcome).toBe('pass');
    const far = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 40, yPx: 0 } })],
      },
    ]);
    expect(criterion(far, 'F3.far')?.outcome).toBe('fail');
  });

  it('grades the vertical axis on its own, tighter threshold', () => {
    // near vertical is 1.45°. On the 884 px axis at vFOV 38.088° the focal
    // length is (884/2)/tan(19.044°) = 1280.0 px, the same lens, so the limit is
    // 1280.0 x tan(1.45°) = 32.41 px. 34 px must fail while 29 px across passes.
    const verticalFocalPx = (FRAME_HEIGHT_PX / 2) / Math.tan(((VFOV_DEG / 2) * Math.PI) / 180);
    expect(verticalFocalPx).toBeCloseTo(1280, 0);
    expect(verticalFocalPx * Math.tan((1.45 * Math.PI) / 180)).toBeCloseTo(32.41, 1);
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: NEAR, distanceKm: 2, errorPx: { xPx: 29, yPx: 34 } }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.near')?.outcome).toBe('fail');
  });

  it('grades a 30 km summit in the distant band against the same 1.30°', () => {
    const pass = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: DISTANT, distanceKm: 30, errorPx: { xPx: 29, yPx: 0 } })],
      },
    ]);
    expect(criterion(pass, 'F3.distant')?.outcome).toBe('pass');
    const fail = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: DISTANT, distanceKm: 30, errorPx: { xPx: 30, yPx: 0 } })],
      },
    ]);
    expect(criterion(fail, 'F3.distant')?.outcome).toBe('fail');
  });

  it('reports a band no summit fell into as no-sample, never as a pass', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12 })],
      },
    ]);
    expect(criterion(analysis, 'F3.horizon')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F3.horizon')?.n).toBe(0);
  });

  it('labels a single-summit band n = 1', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: HORIZON, distanceKm: 55 })],
      },
    ]);
    expect(criterion(analysis, 'F3.horizon')?.evidence[0]).toBe('n = 1');
  });
});

describe('F4', () => {
  it('grades a moved capture against the same thresholds, separately from F3', () => {
    const analysis = run([
      {
        captureId: 'c2',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, errorPx: { xPx: 5, yPx: 0 } })],
      },
      {
        captureId: 'c3',
        role: 'moved',
        panFromReferenceDeg: 20,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 40, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F4.far')?.outcome).toBe('fail');
  });

  it('refuses a movement outside the registered envelope', () => {
    const analysis = run([
      {
        captureId: 'c3',
        role: 'moved',
        panFromReferenceDeg: 45,
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(criterion(analysis, 'F4.envelope')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F4.envelope')?.evidence[0]).toContain('45.0');
  });

  it('accepts a tilt inside the envelope without complaint', () => {
    const analysis = run([
      {
        captureId: 'c3',
        role: 'moved',
        tiltFromReferenceDeg: -10,
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(criterion(analysis, 'F4.envelope')).toBeUndefined();
  });
});

describe('F2', () => {
  const wideBand = {
    horizontalDeg: 8.7,
    verticalDeg: 1.5,
    hasUnquantifiedHorizontal: false,
    hasUnquantifiedVertical: false,
  };

  it('passes a raw error inside a fully measured band', () => {
    // 100 px across is atan(100/1279.9952) = 4.46718°, inside 8.7°.
    expect(degreesAcross(0, 100)).toBeCloseTo(4.46718, 5);
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: wideBand,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 100, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('pass');
  });

  it('fails a raw error outside a fully measured band', () => {
    // 250 px across is atan(250/1279.9952) = 11.05150°, outside 8.7°.
    expect(degreesAcross(0, 250)).toBeCloseTo(11.0515, 4);
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: wideBand,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 250, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F2')?.evidence.join('\n')).toContain('OUTSIDE');
  });

  it('records but does not gate an axis whose band is a floor', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: { ...wideBand, hasUnquantifiedHorizontal: true },
        summits: [summit({ summitId: FAR, errorPx: { xPx: 250, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F2')?.evidence.join('\n')).toContain('recorded, not gated');
  });

  it('ignores after-drag captures', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        band: wideBand,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 250, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('no-sample');
  });
});

describe('F5', () => {
  it('fails a summit drawn visible that both annotators say is absent', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, truthAbsent: true }),
          summit({ summitId: MID, distanceKm: 5 }),
          summit({ summitId: NEAR, distanceKm: 2 }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5a')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F5a')?.evidence.join('\n')).toContain('FALSE VISIBLE');
  });

  it('does not count a marginal summit against F5a', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, truthAbsent: true, visibility: 'marginal' }),
          summit({ summitId: MID, distanceKm: 5 }),
          summit({ summitId: NEAR, distanceKm: 2 }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5a')?.outcome).toBe('pass');
  });

  it('counts a disputed summit in neither direction', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, truthOnlyFirst: true }),
          summit({ summitId: MID, distanceKm: 5 }),
          summit({ summitId: NEAR, distanceKm: 2 }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5a')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F3.truth-disputed')?.n).toBe(1);
  });

  it('fails when one of the three most prominent summits carries no name', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: HORIZON, altitudeDeg: 6, distanceKm: 55 }),
          summit({ summitId: FAR, altitudeDeg: 4 }),
          summit({ summitId: MID, altitudeDeg: 3, distanceKm: 5, labelled: false }),
          summit({ summitId: NEAR, altitudeDeg: 1, distanceKm: 2 }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5b')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F5b')?.evidence.join('\n')).toContain('UNNAMED');
  });

  it('passes when the unnamed summit is the fourth', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: HORIZON, altitudeDeg: 6, distanceKm: 55 }),
          summit({ summitId: FAR, altitudeDeg: 4 }),
          summit({ summitId: MID, altitudeDeg: 3, distanceKm: 5 }),
          summit({ summitId: NEAR, altitudeDeg: 1, distanceKm: 2, labelled: false }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5b')?.outcome).toBe('pass');
  });

  it('fails a summit drawn with a verdict from beyond the swept terrain', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        sweepRadiusKm: 30,
        summits: [summit({ summitId: HORIZON, distanceKm: 55 })],
      },
    ]);
    expect(criterion(analysis, 'F5c')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F5c')?.evidence.join('\n')).toContain('FABRICATED');
  });

  it('fails a beyond-sweep summit withheld for the wrong reason', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        sweepRadiusKm: 30,
        summits: [summit({ summitId: FAR })],
        withheld: [
          {
            summitId: HORIZON,
            name: 'Trinity Mountain',
            distanceKm: 55,
            reason: 'foreground-occluded',
          },
        ],
      },
    ]);
    expect(criterion(analysis, 'F5c')?.outcome).toBe('fail');
  });

  it('passes a beyond-sweep summit reported unmeasured', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        sweepRadiusKm: 30,
        summits: [summit({ summitId: FAR })],
        withheld: [
          {
            summitId: HORIZON,
            name: 'Trinity Mountain',
            distanceKm: 55,
            reason: 'unmeasured',
          },
        ],
      },
    ]);
    expect(criterion(analysis, 'F5c')?.outcome).toBe('pass');
  });
});

describe('truth from two annotators', () => {
  const capture = synthesiseFieldBundle({
    captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
  }).bundle.captures[0];

  it('takes the midpoint and records the disagreement', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const reduced = reduceTruth(capture, [
      { xPx: 900, yPx: 400 },
      { xPx: 905, yPx: 400 },
    ]);
    expect(reduced?.kind).toBe('located');
    if (reduced?.kind !== 'located') return;
    expect(reduced.apexPx).toEqual({ xPx: 902.5, yPx: 400 });
    // 5 px straddling x = 902.5, i.e. atan(-60/f) to atan(-55/f): 0.22336°.
    expect(reduced.disagreementPx).toBeCloseTo(5, 9);
    expect(reduced.disagreementDeg).toBeCloseTo(
      Math.abs(degreesAcross(900 - 960, 905 - 960)),
      12,
    );
    expect(reduced.disagreementDeg).toBeCloseTo(0.22336, 5);
  });

  it('disputes a disagreement over the registered limit', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    // 0.30° at the frame centre is 1279.9952 x tan(0.30°) = 6.702 px, so a 7 px
    // split straddling the centre is 0.3132° and must be refused.
    expect(FOCAL_PX * Math.tan((MAX_TRUTH_DISAGREEMENT_DEG * Math.PI) / 180)).toBeCloseTo(6.7, 1);
    const reduced = reduceTruth(capture, [
      { xPx: 956.5, yPx: 442 },
      { xPx: 963.5, yPx: 442 },
    ]);
    expect(reduced?.kind).toBe('disputed');
  });

  it('never averages a presence disagreement', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const reduced = reduceTruth(capture, [{ xPx: 900, yPx: 400 }, null]);
    expect(reduced?.kind).toBe('disputed');
    if (reduced?.kind !== 'disputed') return;
    expect(reduced.why).toContain('could not identify');
  });

  it('calls a summit absent only when both annotators say so', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    expect(reduceTruth(capture, [null, null])?.kind).toBe('absent');
  });
});

describe('preconditions', () => {
  it('refuses to grade an uncalibrated field of view', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        fovSource: 'spec-sheet-guess',
        summits: [summit({ summitId: FAR, errorPx: { xPx: 200, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('no-sample');
    expect(analysis.refusals.join('\n')).toContain('spec-sheet guess');
  });

  it('reports a frame geometry the budget was not computed on', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        hFovDeg: 40,
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.refusals.join('\n')).toContain('frame geometry');
  });

  it('reports a summit the committed peak data does not hold', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          { ...summit({ summitId: FAR }), summitId: 'overture/invented', name: 'Invented Peak' },
        ],
      },
    ]);
    expect(analysis.refusals.join('\n')).toContain('not in the committed peak data');
  });

  it('reports a height the bundle and the committed data disagree on', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [{ ...summit({ summitId: FAR }), elevationM: 2338 }],
      },
    ]);
    expect(analysis.refusals.join('\n')).toContain('30 m apart');
  });
});

describe('the strict parser', () => {
  function bundleWith(patch: Record<string, unknown>): unknown {
    const { bundle } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    return { ...(JSON.parse(JSON.stringify(bundle)) as object), ...patch };
  }

  it('accepts what the synthesiser produces', () => {
    const parsed = parseFieldBundle(bundleWith({}));
    expect(parsed.ok).toBe(true);
  });

  it('refuses a geolocation field wherever it hides', () => {
    const parsed = parseFieldBundle(bundleWith({ note: 'ok', geolocation: { x: 1 } }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.map((problem) => problem.path)).toContain('geolocation');
  });

  it('refuses a bearing, because a bearing with a distance is a position fix', () => {
    const raw = JSON.parse(JSON.stringify(bundleWith({}))) as {
      captures: { overlay: { drawn: Record<string, unknown>[] } }[];
    };
    const drawn = raw.captures[0]?.overlay.drawn[0];
    expect(drawn).toBeDefined();
    if (drawn === undefined) return;
    drawn.bearingDeg = 281.4;
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((problem) => problem.message.includes('position fix'))).toBe(true);
  });

  it('refuses an epoch-shaped number', () => {
    const parsed = parseFieldBundle(bundleWith({ note: 'x', peakRegions: [] }));
    expect(parsed.ok).toBe(true);
    const raw = JSON.parse(JSON.stringify(bundleWith({}))) as { captures: { tMs: number }[] };
    const capture = raw.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    capture.tMs = 1_790_000_000_000;
    const bad = parseFieldBundle(raw);
    expect(bad.ok).toBe(false);
  });

  it('refuses an ISO date anywhere in the document', () => {
    const parsed = parseFieldBundle(bundleWith({ note: 'captured 2026-10-15 at the site' }));
    expect(parsed.ok).toBe(false);
  });

  it('refuses a string long enough to hide an encoded frame', () => {
    const parsed = parseFieldBundle(bundleWith({ note: 'A'.repeat(5000) }));
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((problem) => problem.message.includes('camera frame'))).toBe(true);
  });

  it('refuses a frame path that is a directory or a traversal', () => {
    for (const framePath of ['../secret.jpg', 'frames/c1.jpg', 'https://x/y.jpg', 'c1.heic']) {
      const raw = JSON.parse(JSON.stringify(bundleWith({}))) as { captures: { framePath: string }[] };
      const capture = raw.captures[0];
      if (capture === undefined) continue;
      capture.framePath = framePath;
      expect(parseFieldBundle(raw).ok).toBe(false);
    }
  });

  it('refuses an unknown key rather than ignoring it', () => {
    const parsed = parseFieldBundle(bundleWith({ siteName: 'bogus-basin' }));
    expect(parsed.ok).toBe(false);
  });

  it('requires an after-drag capture to name its drag anchor', () => {
    const raw = JSON.parse(JSON.stringify(bundleWith({}))) as {
      captures: Record<string, unknown>[];
    };
    const capture = raw.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    delete capture.dragAnchorSummitId;
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((problem) => problem.message.includes('anchored on'))).toBe(true);
  });

  it('requires exactly two independent readings per capture', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    expect(parseFieldTruth(JSON.parse(JSON.stringify(truth))).ok).toBe(true);
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: unknown[] }[];
    };
    raw.captures[0]?.readings.pop();
    expect(parseFieldTruth(raw).ok).toBe(false);
  });

  it('refuses two readings from the same annotator', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: { annotatorId: string }[] }[];
    };
    const second = raw.captures[0]?.readings[1];
    if (second !== undefined) second.annotatorId = 'agent-a';
    expect(parseFieldTruth(raw).ok).toBe(false);
  });

  it('requires an explicit null rather than an absent apex', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: { apexes: Record<string, unknown>[] }[] }[];
    };
    const apex = raw.captures[0]?.readings[0]?.apexes[0];
    if (apex !== undefined) delete apex.apexPx;
    expect(parseFieldTruth(raw).ok).toBe(false);
  });
});

describe('the report', () => {
  const analysis = run([
    {
      captureId: 'c1',
      role: 'before-drag',
      band: {
        horizontalDeg: 8.7,
        verticalDeg: 1.5,
        hasUnquantifiedHorizontal: false,
        hasUnquantifiedVertical: false,
      },
      summits: [
        summit({ summitId: HORIZON, distanceKm: 55, altitudeDeg: 6 }),
        summit({ summitId: FAR, altitudeDeg: 4 }),
        summit({ summitId: MID, distanceKm: 5, altitudeDeg: 3 }),
      ],
    },
    {
      captureId: 'c2',
      role: 'after-drag',
      summits: [
        summit({ summitId: HORIZON, distanceKm: 55, altitudeDeg: 6, errorPx: { xPx: 8, yPx: 3 } }),
        summit({ summitId: FAR, altitudeDeg: 4, errorPx: { xPx: -11, yPx: 6 } }),
        summit({ summitId: MID, distanceKm: 5, altitudeDeg: 3, errorPx: { xPx: 4, yPx: -9 } }),
      ],
    },
  ]);

  it('prints no distance and no bearing', () => {
    const text = renderFieldReport(analysis).join('\n');
    expect(text).not.toMatch(/\bkm\b(?!\))/);
    expect(text).not.toContain('bearing');
    // The band names appear instead, which is what a reader needs.
    expect(text).toContain('F3.horizon');
  });

  it('says what a pass at this n does and does not mean', () => {
    const text = renderFieldReport(analysis).join('\n');
    expect(text).toContain('nothing here contradicts the error budget at this n');
  });

  it('brief mode drops the evidence and keeps the table', () => {
    const brief = renderFieldReport(analysis, { brief: true }).join('\n');
    expect(brief).toContain('F3.far');
    expect(brief).not.toContain('limit 1.3');
  });
});

describe('the committed synthetic fixtures', () => {
  it('parses the aligned bundle and passes every graded criterion', () => {
    const bundle = parseFieldBundle(alignedBundle);
    const truth = parseFieldTruth(alignedTruth);
    expect(bundle.ok).toBe(true);
    expect(truth.ok).toBe(true);
    if (!bundle.ok || !truth.ok) return;
    const analysis = analyseFieldRun(bundle.value, truth.value, lookup);
    expect(analysis.refusals).toEqual([]);
    expect(analysis.criteria.filter((entry) => entry.outcome === 'fail')).toEqual([]);
    expect(analysis.criteria.some((entry) => entry.outcome === 'pass')).toBe(true);
  });

  it('parses the stray bundle and fails exactly the criteria its errors were injected into', () => {
    const bundle = parseFieldBundle(strayBundle);
    const truth = parseFieldTruth(strayTruth);
    expect(bundle.ok).toBe(true);
    expect(truth.ok).toBe(true);
    if (!bundle.ok || !truth.ok) return;
    const analysis = analyseFieldRun(bundle.value, truth.value, lookup);
    const failed = analysis.criteria
      .filter((entry) => entry.outcome === 'fail')
      .map((entry) => entry.id)
      .sort();
    expect(failed).toEqual(['F3.far', 'F5a', 'F5c']);
  });

  it('carries the same frame geometry the pre-registration budgeted on', () => {
    const bundle = parseFieldBundle(alignedBundle) as { ok: true; value: FieldBundle };
    for (const capture of bundle.value.captures) {
      expect(capture.pose.hFovDeg).toBe(73.74);
      expect(capture.framePx.widthPx).toBeGreaterThanOrEqual(1920);
      expect(capture.fovSource).toBe('calibrated');
    }
  });
});
