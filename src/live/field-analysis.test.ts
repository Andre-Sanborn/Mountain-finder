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

import { croppedFovDeg, videoBoxGeometry } from '../app/live/video-box.js';
import { projectToImage } from '../core/projection.js';
import type { Peak } from '../core/types.js';
import {
  analyseFieldRun,
  angularOffsetDeg,
  bandFor,
  bandLimitsFor,
  bandSigmaFor,
  coverVisibleFraction,
  GROSS_HEADING_SOURCES,
  MAX_OBSERVER_ACCURACY_M,
  MAX_TRUTH_DISAGREEMENT_DEG,
  MAX_TWO_SIGMA_EXCEEDANCES,
  MIN_GRADED_PER_BAND,
  observerSigmaFromAccuracyM,
  overlayToFramePx,
  PAN_ANCHOR_EDGE_OFFSET,
  parseFieldBundle,
  parseFieldTruth,
  PREREGISTERED_THRESHOLDS,
  reduceTruth,
  renderFieldReport,
  residualOf,
  sensedHeadingDeg,
  solvePoseFromTruth,
  MIN_SUMMITS_FOR_POSE_SOLVE,
  SUPERSEDED_TRUTH_FORMAT,
  synthesiseFieldBundle,
  TRUTH_FORMAT,
  uncroppedFovDeg,
  withinThreshold,
  type AbsentReason,
  type ApexAnnotation,
  type BandId,
  type Capture,
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

/** One synthesised capture, for the geometry tests that need nothing else. */
function captureWith(
  geometry: Pick<SynthCapture, 'framePx' | 'overlayPx' | 'track'>,
): Capture {
  const { bundle } = synthesiseFieldBundle({
    captures: [
      { captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })], ...geometry },
    ],
  });
  const capture = bundle.captures[0];
  if (capture === undefined) throw new Error('the synthesiser produced no capture');
  return capture;
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

function gradedIn(
  analysis: ReturnType<typeof analyseFieldRun>,
  band: BandId,
): ReturnType<typeof analyseFieldRun>['graded'] {
  return analysis.graded.filter((row) => row.band === band);
}

function bandOf(band: BandId): (typeof PREREGISTERED_THRESHOLDS)[number] {
  const threshold = PREREGISTERED_THRESHOLDS.find((entry) => entry.band === band);
  if (threshold === undefined) throw new Error(`no ${band} band`);
  return threshold;
}

/**
 * Filler summits in the band `distanceKm` falls in, each drawn exactly on its
 * own apex.
 *
 * § 2.0's stop rule reports a band holding fewer than {@link MIN_GRADED_PER_BAND}
 * graded summits as `no-sample`, so a test whose subject is one summit's
 * residual pads that summit's band up to the floor. A filler adds no error and
 * no exceedance, so the band's verdict is still the subject summit's.
 */
function padBand(distanceKm: number, used: readonly string[]): readonly SynthSummit[] {
  const spare = [NEAR, MID, FAR, DISTANT, HORIZON].filter((id) => !used.includes(id));
  return spare.slice(0, MIN_GRADED_PER_BAND - 1).map((id, index) =>
    summit({
      summitId: id,
      distanceKm,
      truthPx: { xPx: 300 + index * 220, yPx: 300 + index * 60 },
      errorPx: { xPx: 0, yPx: 0 },
    }),
  );
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
    expect(residual).toBeDefined();
    if (residual === undefined) return;
    // Truth is the frame centre in x, so the horizontal residual is atan(30/f).
    expect(residual.horizontalDeg).toBeCloseTo(degreesAcross(0, 30), 9);
    expect(residual.horizontalDeg).toBeCloseTo(1.34263, 5);
    expect(residual.horizontalPx).toBeCloseTo(30, 9);
    expect(residual.verticalPx).toBeCloseTo(-12, 9);
  });
});

/**
 * THE CROP BETWEEN THE VIEWPORT AND THE STORED FRAME.
 *
 * The screen draws the camera at `object-fit: cover`: the frame is scaled by
 * `max(viewW/trackW, viewH/trackH)` and the overflow is cut evenly off the two
 * ends of the axis that overflows. Every expectation below is that arithmetic
 * done by hand, with the numbers written out, and the mapped point is checked
 * against the crop's own invariants — the two axes carry ONE scale factor, the
 * visible window is centred on the frame centre, and the corners of the
 * viewport land on the corners of that window.
 */
describe('overlay pixels through the cover crop', () => {
  it('crops the height of a 4:3 track in a 16:9 viewport, to three quarters', () => {
    // 800/450 = 1.77778 against 1920/1440 = 1.33333: the viewport is the wider
    // shape, so cover matches the widths and the height overflows.
    const fraction = coverVisibleFraction(
      { widthPx: 800, heightPx: 450 },
      { width: 1920, height: 1440 },
    );
    expect(fraction).toEqual({ x: 1, y: 0.75 });
  });

  it('crops the width of a 16:9 track in a portrait-ish viewport, to one half', () => {
    // 400/450 = 0.88889 against 1.77778: the viewport is the taller shape, so
    // cover matches the heights and the width overflows. 0.88889/1.77778 = 0.5.
    const fraction = coverVisibleFraction(
      { widthPx: 400, heightPx: 450 },
      { width: 1920, height: 1080 },
    );
    expect(fraction).toEqual({ x: 0.5, y: 1 });
  });

  it('leaves both axes whole when the viewport and the track share an aspect', () => {
    expect(
      coverVisibleFraction({ widthPx: 800, heightPx: 450 }, { width: 1920, height: 1080 }),
    ).toEqual({ x: 1, y: 1 });
  });

  it('refuses a capture that records no camera track size', () => {
    expect(
      coverVisibleFraction({ widthPx: 956, heightPx: 440 }, { width: 0, height: 0 }),
    ).toBeUndefined();
  });

  it('maps a 4:3 track in a 16:9 viewport onto the frame by hand', () => {
    // Stored frame 1920 x 1440, viewport 800 x 450, fraction (1, 0.75).
    //   x: 1920/800 = 2.4 across, nothing cropped, so xFrame = 2.4 x.
    //   y: (1440/450) x 0.75 = 2.4 down, and the strip cut off the top is
    //      1440 x 0.25 / 2 = 180 px, so yFrame = 2.4 y + 180.
    const capture = captureWith({
      framePx: { widthPx: 1920, heightPx: 1440 },
      overlayPx: { widthPx: 800, heightPx: 450 },
      track: { width: 1920, height: 1440 },
    });
    const fraction = { x: 1, y: 0.75 };
    const at = (xPx: number, yPx: number) => overlayToFramePx(capture, { xPx, yPx }, fraction);

    expect(at(0, 0)).toEqual({ xPx: 0, yPx: 180 });
    expect(at(800, 450)).toEqual({ xPx: 1920, yPx: 1260 });
    // The optical axis: the centre of the viewport is the centre of the frame.
    expect(at(400, 225)).toEqual({ xPx: 960, yPx: 720 });
    // One scale on both axes, which is what `cover` means.
    expect(at(100, 100).xPx).toBeCloseTo(240, 12);
    expect(at(100, 100).yPx).toBeCloseTo(2.4 * 100 + 180, 12);
    // The plain ratio the grader used before: 1440/450 = 3.2 down, no offset.
    expect(at(100, 100).yPx).not.toBeCloseTo(3.2 * 100, 6);
  });

  it('maps the phone case — a 16:9 stream in the registered 956 x 440 — by hand', () => {
    // 956/440 = 2.172727 against 1920/1080 = 1.777778, so the height is cropped
    // to 1.777778 / 2.172727 = (16 x 440) / (9 x 956) = 7040/8604 = 0.8182241.
    //   scale: (1080/440) x 0.8182241 = 2.0083682 = 1920/956, one factor for
    //          both axes.
    //   strip: 1080 x (1 - 0.8182241) / 2 = 98.15900 px off the top and bottom.
    const fractionY = 7040 / 8604;
    const fraction = coverVisibleFraction(
      { widthPx: 956, heightPx: 440 },
      { width: 1920, height: 1080 },
    );
    expect(fraction?.x).toBe(1);
    expect(fraction?.y).toBeCloseTo(fractionY, 15);
    expect(fraction?.y).toBeCloseTo(0.8182241, 7);

    const capture = captureWith({
      framePx: { widthPx: 1920, heightPx: 1080 },
      overlayPx: { widthPx: 956, heightPx: 440 },
      track: { width: 1920, height: 1080 },
    });
    const scale = 1920 / 956;
    const strip = (1080 * (1 - fractionY)) / 2;
    expect(scale).toBeCloseTo(2.0083682, 7);
    expect(strip).toBeCloseTo(98.15900, 5);

    const at = (xPx: number, yPx: number) =>
      overlayToFramePx(capture, { xPx, yPx }, fraction ?? { x: 1, y: 1 });
    expect(at(0, 0).xPx).toBeCloseTo(0, 12);
    expect(at(0, 0).yPx).toBeCloseTo(strip, 10);
    expect(at(478, 220).xPx).toBeCloseTo(960, 10);
    expect(at(478, 220).yPx).toBeCloseTo(540, 10);
    expect(at(956, 440).yPx).toBeCloseTo(1080 - strip, 10);
    expect(at(956, 440).yPx).toBeCloseTo(981.841, 3);
    // Scaling by the plain ratio of heights, 1080/440 = 2.4545, would put the
    // bottom of the viewport at the bottom of a frame it never reached.
    expect(at(956, 440).yPx).not.toBeCloseTo(1080, 3);
  });

  it('maps a 16:9 track in a taller viewport onto the frame by hand', () => {
    // Stored frame 1920 x 1080, viewport 400 x 450, fraction (0.5, 1).
    //   y: 1080/450 = 2.4 down, nothing cropped, so yFrame = 2.4 y.
    //   x: (1920/400) x 0.5 = 2.4 across, and the strip cut off the left is
    //      1920 x 0.5 / 2 = 480 px, so xFrame = 2.4 x + 480.
    const capture = captureWith({
      framePx: { widthPx: 1920, heightPx: 1080 },
      overlayPx: { widthPx: 400, heightPx: 450 },
      track: { width: 1920, height: 1080 },
    });
    const fraction = { x: 0.5, y: 1 };
    const at = (xPx: number, yPx: number) => overlayToFramePx(capture, { xPx, yPx }, fraction);

    expect(at(0, 0)).toEqual({ xPx: 480, yPx: 0 });
    expect(at(400, 450)).toEqual({ xPx: 1440, yPx: 1080 });
    expect(at(200, 225)).toEqual({ xPx: 960, yPx: 540 });
    // Without the strip the left edge of the screen would be read as the left
    // edge of the frame, 480 px from where the viewer was looking.
    expect(at(0, 0).xPx).not.toBeCloseTo(0, 6);
  });

  it('is the plain ratio, bit for bit, when the two share an aspect', () => {
    // 800 x 450 over a 1920 x 1080 frame: nothing is cropped, so the mapping is
    // the ratio of widths and of heights, and the same floating-point product
    // the grader computed before the crop was accounted for.
    const capture = captureWith({
      framePx: { widthPx: 1920, heightPx: 1080 },
      overlayPx: { widthPx: 800, heightPx: 450 },
      track: { width: 1920, height: 1080 },
    });
    const fraction = coverVisibleFraction(capture.overlayPx, capture.track);
    expect(fraction).toEqual({ x: 1, y: 1 });
    for (const point of [
      { xPx: 0, yPx: 0 },
      { xPx: 1, yPx: 1 },
      { xPx: 137.4, yPx: 299.6 },
      { xPx: 400, yPx: 225 },
      { xPx: 800, yPx: 450 },
    ]) {
      const mapped = overlayToFramePx(capture, point, fraction ?? { x: 1, y: 1 });
      expect(Object.is(mapped.xPx, point.xPx * (1920 / 800))).toBe(true);
      expect(Object.is(mapped.yPx, point.yPx * (1080 / 450))).toBe(true);
    }
  });

  it('uncrops the field of view by the tangent, not by the angle', () => {
    // The frame is 1920 x 1440 at f = 1279.99524 px, so it spans
    //   2 atan(720 / 1279.99524) = 58.71569° top to bottom,
    // and three quarters of that height spans 2 atan(540 / 1279.99524) =
    // 45.74748°. Read back through the same crop, 45.74748° is 58.71569° again.
    // Scaling the ANGLE instead would give 45.74748 / 0.75 = 60.99664°, 2.3°
    // out.
    const frameVFovDeg = 2 * Math.atan(720 / FOCAL_PX) * (180 / Math.PI);
    expect(frameVFovDeg).toBeCloseTo(58.71569, 5);
    const visibleVFovDeg = 2 * Math.atan(540 / FOCAL_PX) * (180 / Math.PI);
    expect(visibleVFovDeg).toBeCloseTo(45.74748, 5);
    expect(uncroppedFovDeg(visibleVFovDeg, 0.75)).toBeCloseTo(frameVFovDeg, 10);
    expect(uncroppedFovDeg(visibleVFovDeg, 0.75)).not.toBeCloseTo(visibleVFovDeg / 0.75, 3);
  });

  it('returns an uncropped axis unchanged, bit for bit', () => {
    expect(Object.is(uncroppedFovDeg(73.74, 1), 73.74)).toBe(true);
    expect(Object.is(uncroppedFovDeg(38.088, 1), 38.088)).toBe(true);
  });

  it('recovers a residual injected in frame pixels, through a cropped viewport', () => {
    // The frame is 1920 x 1440 at f = 1279.99524 px, shown in an 800 x 450
    // viewport that keeps three quarters of its height. The marker is drawn
    // 30 px right of and 30 px below the apex IN FRAME PIXELS, and the apex is
    // the frame centre, so each residual is atan(30 / 1279.99524) = 1.34263°.
    const visibleVFovDeg = 2 * Math.atan(540 / FOCAL_PX) * (180 / Math.PI);
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          framePx: { widthPx: 1920, heightPx: 1440 },
          overlayPx: { widthPx: 800, heightPx: 450 },
          track: { width: 1920, height: 1440 },
          vFovDeg: visibleVFovDeg,
          summits: [
            summit({
              summitId: FAR,
              truthPx: { xPx: 960, yPx: 720 },
              errorPx: { xPx: 30, yPx: 30 },
            }),
          ],
        },
      ],
    });
    const capture = bundle.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const residual = residualOf(capture, capture.overlay.drawn[0]?.summitPx ?? { xPx: 0, yPx: 0 }, {
      xPx: 960,
      yPx: 720,
    });
    expect(residual).toBeDefined();
    if (residual === undefined) return;
    expect(residual.horizontalPx).toBeCloseTo(30, 9);
    expect(residual.verticalPx).toBeCloseTo(30, 9);
    expect(residual.horizontalDeg).toBeCloseTo(1.34263, 5);
    expect(residual.verticalDeg).toBeCloseTo(1.34263, 5);
  });

  it('recovers a residual injected in frame pixels through a cropped WIDTH', () => {
    // The same 1920 x 1080 frame at f = 1279.99524 px, in a 400 x 450 viewport
    // that keeps half its width. On screen that half spans
    //   2 atan(480 / 1279.99524) = 41.11223°,
    // and the marker is drawn 30 px right of and below the apex in FRAME
    // pixels, so each residual is atan(30 / 1279.99524) = 1.34263° again.
    const visibleHFovDeg = 2 * Math.atan(480 / FOCAL_PX) * (180 / Math.PI);
    const visibleVFovDeg = 2 * Math.atan(540 / FOCAL_PX) * (180 / Math.PI);
    expect(visibleHFovDeg).toBeCloseTo(41.11223, 5);
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          framePx: { widthPx: 1920, heightPx: 1080 },
          overlayPx: { widthPx: 400, heightPx: 450 },
          track: { width: 1920, height: 1080 },
          hFovDeg: visibleHFovDeg,
          vFovDeg: visibleVFovDeg,
          summits: [
            summit({
              summitId: FAR,
              truthPx: { xPx: 960, yPx: 540 },
              errorPx: { xPx: 30, yPx: 30 },
            }),
          ],
        },
      ],
    });
    const capture = bundle.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    // The drawn marker sits in the viewport's own half-width space: 990 frame
    // px is (990 - 480) / 2.4 = 212.5 px from the left of the screen.
    expect(capture.overlay.drawn[0]?.summitPx.xPx).toBeCloseTo(212.5, 9);
    const residual = residualOf(capture, capture.overlay.drawn[0]?.summitPx ?? { xPx: 0, yPx: 0 }, {
      xPx: 960,
      yPx: 540,
    });
    expect(residual).toBeDefined();
    if (residual === undefined) return;
    expect(residual.horizontalPx).toBeCloseTo(30, 9);
    expect(residual.verticalPx).toBeCloseTo(30, 9);
    expect(residual.horizontalDeg).toBeCloseTo(1.34263, 5);
    expect(residual.verticalDeg).toBeCloseTo(1.34263, 5);
  });

  it('refuses to measure a residual it cannot place on the frame', () => {
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          track: { width: 0, height: 0 },
          summits: [summit({ summitId: FAR })],
        },
      ],
    });
    const capture = bundle.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    expect(residualOf(capture, { xPx: 100, yPx: 100 }, { xPx: 960, yPx: 442 })).toBeUndefined();
  });

  it('agrees with the geometry the screen lays the video out with', () => {
    // `src/app/live/video-box.ts` is what the AR screen measures the element box
    // with. The grader computes the same crop from the aspect ratios instead, so
    // the two are held together here on a grid of viewports and streams.
    const viewports = [
      { widthPx: 956, heightPx: 440 },
      { widthPx: 800, heightPx: 450 },
      { widthPx: 400, heightPx: 450 },
      { widthPx: 390, heightPx: 844 },
      { widthPx: 1024, heightPx: 768 },
      { widthPx: 844, heightPx: 390 },
    ];
    const streams = [
      { width: 1920, height: 1080 },
      { width: 1920, height: 1440 },
      { width: 1280, height: 720 },
      { width: 640, height: 480 },
      { width: 1080, height: 1920 },
    ];
    for (const viewport of viewports) {
      for (const stream of streams) {
        const mine = coverVisibleFraction(viewport, stream);
        expect(mine).toBeDefined();
        if (mine === undefined) continue;
        const theirs = videoBoxGeometry(viewport, {
          widthPx: stream.width,
          heightPx: stream.height,
        });
        expect(mine.x).toBeCloseTo(theirs.visibleFraction.x, 12);
        expect(mine.y).toBeCloseTo(theirs.visibleFraction.y, 12);
        // The strip cut off each side, in the stream's own pixels.
        expect((stream.width * (1 - mine.x)) / 2).toBeCloseTo(
          theirs.overflowPx.xPx / theirs.scale,
          9,
        );
        expect((stream.height * (1 - mine.y)) / 2).toBeCloseTo(
          theirs.overflowPx.yPx / theirs.scale,
          9,
        );
        // And the field of view: cropping and uncropping is a round trip.
        const cropped = croppedFovDeg({ hFovDeg: 73.74, vFovDeg: 58.71569 }, mine);
        expect(uncroppedFovDeg(cropped.hFovDeg, mine.x)).toBeCloseTo(73.74, 9);
        expect(uncroppedFovDeg(cropped.vFovDeg, mine.y)).toBeCloseTo(58.71569, 9);
      }
    }
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
        summits: [
          summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 29, yPx: 0 } }),
          ...padBand(12, [FAR]),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F3.far')?.n).toBe(MIN_GRADED_PER_BAND);
  });

  it('reports the same summit 30 px out as one 2σ exceedance, and tolerates it', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 30, yPx: 0 } }),
          ...padBand(12, [FAR]),
        ],
      },
    ]);
    expect(gradedIn(analysis, 'far')[0]?.axesOverTwoSigma).toBe(1);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F3.far')?.evidence.join('\n')).toContain('over 2σ');
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
            ...padBand(12, [FAR]),
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
    expect(residual).toBeDefined();
    if (residual === undefined) return;
    expect(residual.horizontalDeg).toBeCloseTo(1.3, 12);
    expect(analyseFieldRun(bundle, truth, lookup).criteria.find((c) => c.id === 'F3.far')?.outcome).toBe(
      'pass',
    );
  });

  it('uses the near band s looser threshold for a 2 km summit', () => {
    // near horizontal is 1.90°: 1279.9952 x tan(1.90°) = 42.462 px. 40 px is
    // inside the near band and past the far band's 1.30°, so the band choice is
    // tested rather than assumed.
    const nearLimitPx = FOCAL_PX * Math.tan((1.9 * Math.PI) / 180);
    expect(nearLimitPx).toBeCloseTo(42.4618, 4);
    const near = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: NEAR, distanceKm: 2, errorPx: { xPx: 40, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(near, 'near')[0]?.axesOverTwoSigma).toBe(0);
    const far = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 40, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(far, 'far')[0]?.axesOverTwoSigma).toBe(1);
  });

  it('grades the vertical axis on its own, tighter threshold', () => {
    // near vertical is 1.45°. On the 884 px axis at vFOV 38.088° the focal
    // length is (884/2)/tan(19.044°) = 1280.0 px, the same lens, so the limit is
    // 1280.0 x tan(1.45°) = 32.41 px. 34 px is past it while 29 px across is not,
    // so the exceedance must land on the vertical axis alone.
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
    const row = gradedIn(analysis, 'near')[0];
    expect(row?.exceedances[0]?.overTwoSigma).toBe(false);
    expect(row?.exceedances[1]?.overTwoSigma).toBe(true);
  });

  it('grades a 30 km summit in the distant band against the same 1.30°', () => {
    const inside = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: DISTANT, distanceKm: 30, errorPx: { xPx: 29, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(inside, 'distant')[0]?.axesOverTwoSigma).toBe(0);
    const over = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: DISTANT, distanceKm: 30, errorPx: { xPx: 30, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(over, 'distant')[0]?.axesOverTwoSigma).toBe(1);
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

describe('the band gate at 2σ and 3σ', () => {
  // The far band is registered at 2σ = 1.30° and 3σ = 1.95°, so its σ is 0.65°.
  // A residual of k·0.65° placed at the frame centre is f·tan(k·0.65°) px:
  //   2.5σ = 1.625° → 1279.99524 × tan(1.625°) = 36.312 px
  //   3.1σ = 2.015° → 1279.99524 × tan(2.015°) = 45.034 px
  const SIGMA_DEG = 1.3 / 2;
  const pxAtSigma = (k: number): number => FOCAL_PX * Math.tan(((k * SIGMA_DEG) * Math.PI) / 180);
  const CENTRE = { xPx: FRAME_WIDTH_PX / 2, yPx: FRAME_HEIGHT_PX / 2 };

  it('knows what 2.5σ and 3.1σ are worth in pixels on this frame', () => {
    expect(pxAtSigma(2.5)).toBeCloseTo(36.312, 3);
    expect(pxAtSigma(3.1)).toBeCloseTo(45.034, 3);
  });

  it('tolerates one 2σ exceedance per band and no more', () => {
    expect(MAX_TWO_SIGMA_EXCEEDANCES).toBe(1);
  });

  it('passes a band whose only exceedance is one summit-axis at 2.5σ', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({
            summitId: FAR,
            distanceKm: 12,
            truthPx: CENTRE,
            errorPx: { xPx: pxAtSigma(2.5), yPx: 0 },
          }),
          summit({ summitId: DISTANT, distanceKm: 15, truthPx: CENTRE, errorPx: { xPx: 0, yPx: 0 } }),
          ...padBand(12, [FAR, DISTANT]),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.n).toBe(MIN_GRADED_PER_BAND + 1);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
  });

  it('fails a band holding two summit-axes at 2.5σ', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({
            summitId: FAR,
            distanceKm: 12,
            truthPx: CENTRE,
            errorPx: { xPx: pxAtSigma(2.5), yPx: 0 },
          }),
          summit({
            summitId: DISTANT,
            distanceKm: 15,
            truthPx: CENTRE,
            errorPx: { xPx: pxAtSigma(2.5), yPx: 0 },
          }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F3.far')?.evidence.join('\n')).toContain('2 summit-axis/axes past 2σ');
  });

  it('fails a band on a single summit-axis at 3.1σ', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({
            summitId: FAR,
            distanceKm: 12,
            truthPx: CENTRE,
            errorPx: { xPx: pxAtSigma(3.1), yPx: 0 },
          }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F3.far')?.evidence.join('\n')).toContain('OVER 3σ');
  });

  it('counts the two axes of one summit separately', () => {
    // 2.5σ across and 2.5σ down on the same summit is two exceedances, so the
    // band fails although only one summit moved.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({
            summitId: FAR,
            distanceKm: 12,
            truthPx: CENTRE,
            errorPx: { xPx: pxAtSigma(2.5), yPx: pxAtSigma(2.5) },
          }),
        ],
      },
    ]);
    expect(gradedIn(analysis, 'far')[0]?.axesOverTwoSigma).toBe(2);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('fail');
  });

  it('sets every 3σ limit at 1.5 times the 2σ figure, rounded up to 0.05°', () => {
    // 1.5 × 1.90 = 2.85; 1.5 × 1.45 = 2.175 → 2.20; 1.5 × 1.40 = 2.10;
    // 1.5 × 1.30 = 1.95.
    const expected: Record<BandId, readonly [number, number]> = {
      near: [2.85, 2.2],
      mid: [2.1, 1.95],
      far: [1.95, 1.95],
      distant: [1.95, 1.95],
      horizon: [1.95, 1.95],
    };
    for (const threshold of PREREGISTERED_THRESHOLDS) {
      expect([threshold.horizontal3SigmaDeg, threshold.vertical3SigmaDeg]).toEqual(
        expected[threshold.band],
      );
    }
  });
});

describe('F4', () => {
  it('grades a moved capture against the same thresholds, separately from F3', () => {
    // 50 px at the frame centre is atan(50/1279.9952) = 2.23699°, past the far
    // band's 1.95° 3σ limit, so the moved capture fails on its own.
    expect(degreesAcross(0, 50)).toBeCloseTo(2.23699, 5);
    const analysis = run([
      {
        captureId: 'c2',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, errorPx: { xPx: 5, yPx: 0 } }),
          ...padBand(12, [FAR]),
        ],
      },
      {
        captureId: 'c3',
        role: 'moved',
        tiltFromReferenceDeg: -10,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 50, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F4.far')?.outcome).toBe('fail');
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

describe('the drag anchor is not graded against itself', () => {
  // The drag aligned the overlay onto the anchor, so the anchor's residual is
  // the drag's own precision and nothing else (§ 1.1). A band whose only
  // observations are the anchor has nothing F3 or F4 can grade.

  it('reports no sample when the only located summit is the anchor', () => {
    // Three after-drag captures, each drawing the anchor alone. Three
    // observations is MIN_GRADED_PER_BAND, so a grader that graded the anchor
    // would clear the stop rule and pass the band on the anchor's own residual.
    const analysis = run(
      ['c2', 'c7', 'c8'].map((captureId) => ({
        captureId,
        role: 'after-drag' as const,
        dragAnchorSummitId: FAR,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 20, yPx: 0 } })],
      })),
    );
    expect(criterion(analysis, 'F3.far')?.n).toBe(0);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F3.far')?.evidence.join('\n')).toContain(
      'the only summit-observation(s) drawn in this band were the drag anchor',
    );
    expect(criterion(analysis, 'F3.anchor')?.n).toBe(3);
    expect(analysis.graded).toHaveLength(0);
  });

  it('reports the anchor’s residual for information', () => {
    // 20 px across at the frame centre is atan(20 / 1279.99524) = 0.895177°,
    // and the apex sits at x = 960, the frame centre, so its offset is 0 %.
    expect(degreesAcross(0, 20)).toBeCloseTo(0.895177, 6);
    const analysis = run([
      {
        captureId: 'c2',
        role: 'after-drag',
        dragAnchorSummitId: FAR,
        summits: [summit({ summitId: FAR, errorPx: { xPx: 20, yPx: 0 } })],
      },
    ]);
    const line = criterion(analysis, 'F3.anchor')?.evidence.join('\n') ?? '';
    expect(line).toContain('anchor, not graded');
    expect(line).toContain('0.895° across and 0.000° up/down, at 0% of the half-frame');
    expect(analysis.anchorObservations).toHaveLength(1);
  });

  it('grades the three summits beside the anchor, and not the anchor', () => {
    // One anchor and three others, all in the far band: n = 3, which is the
    // stop rule's floor, so the band returns a verdict on the three.
    const analysis = run([
      {
        captureId: 'c2',
        role: 'after-drag',
        dragAnchorSummitId: FAR,
        summits: [
          summit({ summitId: FAR, errorPx: { xPx: 20, yPx: 0 } }),
          ...padBand(12, [FAR]).map((padding) => ({ ...padding, distanceKm: 12 })),
          summit({
            summitId: DISTANT,
            distanceKm: 12,
            truthPx: { xPx: 1200, yPx: 500 },
            errorPx: { xPx: 0, yPx: 0 },
          }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.n).toBe(MIN_GRADED_PER_BAND);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F3.anchor')?.n).toBe(1);
    expect(gradedIn(analysis, 'far').map((row) => row.summitId)).not.toContain(FAR);
  });

  it('excludes the anchor a moved capture inherited from the capture it moved from', () => {
    // A moved capture carries no drag of its own, so its anchor is the one the
    // after-drag capture it moved from was dragged onto.
    const { bundle, truth } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c2',
          role: 'after-drag',
          dragAnchorSummitId: FAR,
          summits: [summit({ summitId: FAR })],
        },
        {
          captureId: 'c3',
          role: 'moved',
          tiltFromReferenceDeg: -10,
          summits: [summit({ summitId: FAR, errorPx: { xPx: 20, yPx: 0 } })],
        },
      ],
    });
    const raw = JSON.parse(JSON.stringify(bundle)) as {
      captures: { captureId: string; dragAnchorSummitId?: string }[];
    };
    const moved = raw.captures.find((capture) => capture.captureId === 'c3');
    expect(moved).toBeDefined();
    if (moved === undefined) return;
    delete moved.dragAnchorSummitId;
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.captures[1]?.dragAnchorSummitId).toBeUndefined();
    const analysis = analyseFieldRun(parsed.value, truth, lookup);
    expect(criterion(analysis, 'F4.far')?.n).toBe(0);
    expect(criterion(analysis, 'F4.anchor')?.n).toBe(1);
  });
});

describe('the F4 pan target', () => {
  // The registered movement is "pan until the anchor summit sits at the frame
  // edge", read as the anchor's drawn offset reaching 0.8 of the half-frame. On
  // a 1920 px frame that is |x − 960| >= 768 px, so a truth apex at x = 150 is
  // 0.844 of the half-frame and one at x = 400 is 0.583. Each capture below
  // names FAR as its anchor, because the anchor is what the pan is aimed at.
  it('registers the target at 0.8 of the half-frame', () => {
    expect(PAN_ANCHOR_EDGE_OFFSET).toBe(0.8);
    expect(Math.abs(150 - 960) / 960).toBeCloseTo(0.84375, 5);
    expect(Math.abs(400 - 960) / 960).toBeCloseTo(0.58333, 5);
  });

  it('accepts a pan that carried the anchor to the frame edge', () => {
    const analysis = run([
      {
        captureId: 'c3',
        role: 'moved',
        dragAnchorSummitId: FAR,
        panFromReferenceDeg: 26,
        summits: [summit({ summitId: FAR, truthPx: { xPx: 150, yPx: 442 } })],
      },
    ]);
    expect(criterion(analysis, 'F4.envelope')).toBeUndefined();
  });

  it('reports a pan that stopped short of the frame edge', () => {
    const analysis = run([
      {
        captureId: 'c3',
        role: 'moved',
        dragAnchorSummitId: FAR,
        panFromReferenceDeg: 26,
        summits: [summit({ summitId: FAR, truthPx: { xPx: 400, yPx: 442 } })],
      },
    ]);
    expect(criterion(analysis, 'F4.envelope')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F4.envelope')?.evidence[0]).toContain('0.58');
  });

  it('does not gate how far the phone turned', () => {
    // A 40° pan is off the old ±20° envelope and fine here: how far the phone
    // must turn depends on where the anchor started in the frame.
    const analysis = run([
      {
        captureId: 'c3',
        role: 'moved',
        dragAnchorSummitId: FAR,
        panFromReferenceDeg: 40,
        summits: [summit({ summitId: FAR, truthPx: { xPx: 150, yPx: 442 } })],
      },
    ]);
    expect(criterion(analysis, 'F4.envelope')).toBeUndefined();
  });

  it('reports a pan whose anchor the capture never drew', () => {
    const { bundle, truth } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c3',
          role: 'moved',
          dragAnchorSummitId: FAR,
          panFromReferenceDeg: 26,
          summits: [summit({ summitId: FAR, truthPx: { xPx: 150, yPx: 442 } })],
        },
      ],
    });
    const raw = JSON.parse(JSON.stringify(bundle)) as {
      captures: { dragAnchorSummitId: string }[];
    };
    const capture = raw.captures[0];
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    capture.dragAnchorSummitId = HORIZON;
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const analysis = analyseFieldRun(parsed.value, truth, lookup);
    expect(criterion(analysis, 'F4.envelope')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F4.envelope')?.evidence[0]).toContain('not among the summits');
  });
});

describe('the observer fix accuracy', () => {
  const near = bandOf('near');

  it('reads a reported radius as a 95 % circle and returns a per-axis 1σ', () => {
    // The W3C position API states the figure at 95 % confidence. For a circular
    // bivariate normal, P(r <= kσ) = 1 − exp(−k²/2), so 0.95 gives
    // k = sqrt(−2·ln 0.05) = 2.44775 and σ = r / 2.44775.
    expect(observerSigmaFromAccuracyM(10)).toBeCloseTo(10 / Math.sqrt(-2 * Math.log(0.05)), 12);
    expect(observerSigmaFromAccuracyM(10)).toBeCloseTo(4.0854, 4);
  });

  it('rebuilds the 1σ column of the pre-registration from the budget terms', () => {
    // § 1.5 of docs/FIELD-TEST-PREREGISTRATION.md, horizontal then vertical.
    const expected: Record<BandId, readonly [number, number]> = {
      near: [0.951, 0.715],
      mid: [0.689, 0.649],
      far: [0.642, 0.639],
      distant: [0.628, 0.636],
      horizon: [0.627, 0.636],
    };
    for (const threshold of PREREGISTERED_THRESHOLDS) {
      const sigma = bandSigmaFor(threshold);
      const [horizontal, vertical] = expected[threshold.band];
      expect(sigma.horizontalDeg).toBeCloseTo(horizontal, 3);
      expect(sigma.verticalDeg).toBeCloseTo(vertical, 3);
    }
  });

  it('tightens the near band when the fix is a good one', () => {
    // σ = 10 / 2.44775 = 4.0854 m, so the horizontal geodesy is
    // hypot(20, 4.0854) = 20.413 m: 0.58482° at 2 km and 0.11696° at the
    // anchor's 10 km. RSS with the 0.275° scale, 0.034° roll and 0.543° drag is
    // 0.85281°, so 2σ is 1.70562° and the limit rounds up to 1.75°. The vertical
    // terms do not move, because the observer's height comes from the DEM.
    const limits = bandLimitsFor(near, 10);
    expect(limits.horizontalDeg).toBe(1.75);
    expect(limits.verticalDeg).toBe(1.45);
    // 1.5 × 1.75 = 2.625, up to 2.65.
    expect(limits.horizontal3SigmaDeg).toBe(2.65);
  });

  it('never widens a registered limit, however bad the fix', () => {
    expect(bandLimitsFor(near, 100).horizontalDeg).toBe(near.horizontalDeg);
    expect(bandLimitsFor(near, 100).horizontal3SigmaDeg).toBe(near.horizontal3SigmaDeg);
  });

  it('leaves the registered row alone when no accuracy was reported', () => {
    expect(bandLimitsFor(near)).toBe(near);
  });

  it('grades a capture against the limits its own fix implies', () => {
    // 41 px at the frame centre is 1.83463°: inside the registered 1.90° near
    // band, past the 1.75° a 10 m fix derives.
    expect(degreesAcross(0, 41)).toBeCloseTo(1.83463, 5);
    const loose = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: NEAR, distanceKm: 2, errorPx: { xPx: 41, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(loose, 'near')[0]?.axesOverTwoSigma).toBe(0);
    const tight = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        horizontalAccuracyM: 10,
        summits: [summit({ summitId: NEAR, distanceKm: 2, errorPx: { xPx: 41, yPx: 0 } })],
      },
    ]);
    expect(gradedIn(tight, 'near')[0]?.axesOverTwoSigma).toBe(1);
  });

  it('refuses a capture whose fix is worse than the protocol accepts', () => {
    expect(MAX_OBSERVER_ACCURACY_M).toBe(30);
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        horizontalAccuracyM: 30.5,
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('no-sample');
    expect(analysis.refusals.join('\n')).toContain('over the 30 m');
  });

  it('grades a fix exactly at the 30 m limit', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        horizontalAccuracyM: 30,
        summits: [summit({ summitId: FAR }), ...padBand(12, [FAR])],
      },
    ]);
    expect(analysis.refusals).toEqual([]);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
  });

  it('refuses an accuracy figure with no convention declared', () => {
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          horizontalAccuracyM: 8.4,
          summits: [summit({ summitId: FAR })],
        },
      ],
    });
    expect(parseFieldBundle(JSON.parse(JSON.stringify(bundle))).ok).toBe(true);
    const raw = JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>;
    delete raw['accuracyConvention'];
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((problem) => problem.message.includes('is not a σ'))).toBe(true);
  });

  it('refuses a convention it does not know', () => {
    const { bundle } = synthesiseFieldBundle({
      captures: [
        {
          captureId: 'c1',
          role: 'after-drag',
          horizontalAccuracyM: 8.4,
          summits: [summit({ summitId: FAR })],
        },
      ],
    });
    const raw = JSON.parse(JSON.stringify(bundle)) as Record<string, unknown>;
    raw['accuracyConvention'] = 'one-sigma';
    expect(parseFieldBundle(raw).ok).toBe(false);
  });

  it('still refuses a bare accuracy key', () => {
    const { bundle } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(bundle)) as {
      captures: Record<string, unknown>[];
    };
    const capture = raw.captures[0];
    if (capture !== undefined) capture['accuracy'] = 12;
    expect(parseFieldBundle(raw).ok).toBe(false);
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

  it('gates each axis on its own term, so an unquantified vertical leaves the horizontal gated', () => {
    // The live band carries "Tilt zero point never checked" on the vertical axis
    // until the home session measures the tilt bias, and it will do so on every
    // capture. A whole-band flag would take the horizontal gate down with it and
    // F2 would pass whatever the heading did.
    // 250 px across is 11.05150°, outside the 8.7° horizontal band; 20 px down
    // is atan(20/1280.0) = 0.89522°, inside the 1.5° vertical band either way.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: { ...wideBand, hasUnquantifiedVertical: true },
        summits: [summit({ summitId: FAR, errorPx: { xPx: 250, yPx: 20 } })],
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('fail');
    const evidence = criterion(analysis, 'F2')?.evidence.join('\n') ?? '';
    expect(evidence).toContain('across: raw 11.051° against a band of 8.700° — OUTSIDE');
    expect(evidence).toContain('up/down: raw 0.895° against a band of 1.500° that carries an unquantified term — recorded, not gated');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F2 at the pose — the raw compass reading against the heading truth solves
 * ══════════════════════════════════════════════════════════════════════════ */

describe('F2 at the pose', () => {
  const wideBand = {
    horizontalDeg: 8.5,
    verticalDeg: 1.5,
    hasUnquantifiedHorizontal: false,
    hasUnquantifiedVertical: false,
  };

  /** Where a frame angle from the optical axis lands, in pixels from the centre. */
  function pixelsAtAngle(deg: number): number {
    return FOCAL_PX * Math.tan((deg * Math.PI) / 180);
  }

  /** The synthesiser's own pose heading, which the captures below are built at. */
  const POSE_HEADING_DEG = 280;

  it('reads the compass reading back out of the pose', () => {
    // The pose's heading is the reading plus the fine trim plus the re-anchor:
    // 188 + 0.62 + 92 = 280.62, so the reading is 188 again.
    expect(
      sensedHeadingDeg({
        headingDeg: 280.62,
        pitchDeg: 0,
        rollDeg: 0,
        hFovDeg: HFOV_DEG,
        vFovDeg: VFOV_DEG,
        headingBasis: 'true-model',
        trimHeadingDeg: 0.62,
        trimPitchDeg: 0,
        grossHeadingOffsetDeg: 92,
        grossHeadingSource: 'sun',
      }),
    ).toBeCloseTo(188, 12);
  });

  it('solves the heading a pair of markers drawn 5° off implies', () => {
    // Two summits on the frame's horizontal centreline, 200 px either side of
    // the centre, on a capture with no pitch. There the camera's own up axis is
    // the world's, so a change of heading slides a point along the centreline
    // and the pixel offset of each is f·tan θ with the same θ change.
    //
    //   truth:  ∓200 px  →  θ = ∓atan(200/1279.99524) = ∓8.88069°
    //   drawn:  the same summits at θ + 5°, i.e. −3.88069° and +13.88069°
    //
    // So the camera that puts those directions on the truth apexes sits 5° to
    // the right of the pose, at 285°, and level.
    const truthOffsets = [-200, 200];
    const summits = [FAR, MID].map((summitId, index) => {
      const truthOffsetPx = truthOffsets[index] ?? 0;
      const truthAngleDeg = (Math.atan(truthOffsetPx / FOCAL_PX) * 180) / Math.PI;
      return summit({
        summitId,
        truthPx: { xPx: FRAME_WIDTH_PX / 2 + truthOffsetPx, yPx: FRAME_HEIGHT_PX / 2 },
        errorPx: {
          xPx: pixelsAtAngle(truthAngleDeg + 5) - truthOffsetPx,
          yPx: 0,
        },
      });
    });
    expect(truthOffsets.map((px) => (Math.atan(px / FOCAL_PX) * 180) / Math.PI)).toEqual([
      expect.closeTo(-8.88069, 5),
      expect.closeTo(8.88069, 5),
    ]);

    const { bundle } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'before-drag', pitchDeg: 0, summits }],
    });
    const capture = bundle.captures[0];
    if (capture === undefined) throw new Error('the synthesiser produced no capture');
    const solved = solvePoseFromTruth(
      capture,
      capture.overlay.drawn.map((drawn, index) => ({
        drawnPx: drawn.summitPx,
        truthPx: summits[index]?.truthPx ?? { xPx: 0, yPx: 0 },
      })),
    );
    expect(solved?.summitCount).toBe(2);
    expect(solved?.headingDeg).toBeCloseTo(POSE_HEADING_DEG + 5, 6);
    expect(solved?.pitchDeg).toBeCloseTo(0, 6);
  });

  /** Two summits drawn exactly on their apexes, so the solve returns the pose. */
  function onTheirApexes(): readonly SynthSummit[] {
    return [
      summit({ summitId: FAR, truthPx: { xPx: 660, yPx: 400 }, errorPx: { xPx: 0, yPx: 0 } }),
      summit({ summitId: MID, truthPx: { xPx: 1260, yPx: 470 }, errorPx: { xPx: 0, yPx: 0 } }),
    ];
  }

  it('fails a 92° compass error that a re-anchor has already hidden from the markers', () => {
    // The person re-anchored on the Sun, so the pose heading is right and every
    // marker sits on its summit: F2 on the markers has nothing to report. The
    // compass alone said 280 − 92 = 188°, which is 92° from the 280° the two
    // located summits solve for, against a band of 8.5°.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: wideBand,
        grossHeadingOffsetDeg: 92,
        grossHeadingSource: 'sun',
        summits: onTheirApexes(),
      },
    ]);
    expect(criterion(analysis, 'F2')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F2.pose')?.outcome).toBe('fail');
    const evidence = criterion(analysis, 'F2.pose')?.evidence.join('\n') ?? '';
    expect(evidence).toContain('compass alone 188.000°');
    expect(evidence).toContain('solved from 2 located summit(s) 280.000°');
    expect(evidence).toContain('apart by 92.000°');
    expect(evidence).toContain('gross offset of 92.000° from sun');
    expect(evidence).toContain('against a band of 8.500° — OUTSIDE');
  });

  it('passes a 3° compass error inside a 10° band', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: { ...wideBand, horizontalDeg: 10 },
        grossHeadingOffsetDeg: 3,
        grossHeadingSource: 'summit',
        summits: onTheirApexes(),
      },
    ]);
    expect(criterion(analysis, 'F2.pose')?.outcome).toBe('pass');
    const evidence = criterion(analysis, 'F2.pose')?.evidence.join('\n') ?? '';
    expect(evidence).toContain('compass alone 277.000°');
    expect(evidence).toContain('apart by 3.000°');
    expect(evidence).toContain('against a band of 10.000° — inside');
  });

  it('reports no sample when one summit is located, whatever the compass did', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: wideBand,
        grossHeadingOffsetDeg: 92,
        summits: [summit({ summitId: FAR, truthPx: { xPx: 660, yPx: 400 } })],
      },
    ]);
    expect(criterion(analysis, 'F2.pose')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F2.pose')?.n).toBe(0);
    expect(criterion(analysis, 'F2.pose')?.evidence.join('\n')).toContain(
      `it takes ${MIN_SUMMITS_FOR_POSE_SOLVE} to solve a heading`,
    );
  });

  it('records but does not gate a horizontal band that carries an unquantified term', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'before-drag',
        band: { ...wideBand, hasUnquantifiedHorizontal: true },
        grossHeadingOffsetDeg: 92,
        summits: onTheirApexes(),
      },
    ]);
    expect(criterion(analysis, 'F2.pose')?.outcome).toBe('pass');
    expect(criterion(analysis, 'F2.pose')?.evidence.join('\n')).toContain('recorded, not gated');
  });

  it('ignores after-drag captures', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        band: wideBand,
        grossHeadingOffsetDeg: 92,
        summits: onTheirApexes(),
      },
    ]);
    expect(criterion(analysis, 'F2.pose')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F2.pose')?.evidence.join('\n')).toContain(
      'no before-drag capture carried a located summit',
    );
  });
});

describe('F5', () => {
  it('fails a summit drawn visible that both annotators say is absent', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, truthAbsent: 'clear-sky' }),
          summit({ summitId: MID, distanceKm: 5 }),
          summit({ summitId: NEAR, distanceKm: 2 }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F5a')?.outcome).toBe('fail');
    expect(criterion(analysis, 'F5a')?.evidence.join('\n')).toContain('FALSE VISIBLE');
    expect(criterion(analysis, 'F5a')?.evidence.join('\n')).toContain('clear-sky');
  });

  it('does not count a marginal summit against F5a', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, truthAbsent: 'clear-sky', visibility: 'marginal' }),
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
          summit({ summitId: FAR, truthSecondAbsent: 'foreground-blocked' }),
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

  const apex = (xPx: number, yPx: number, landmark?: string): ApexAnnotation => ({
    summitId: FAR,
    apexPx: { xPx, yPx },
    ...(landmark !== undefined ? { landmark } : {}),
  });
  const absent = (reason: AbsentReason): ApexAnnotation => ({
    summitId: FAR,
    absent: true,
    reason,
  });
  const cannot: ApexAnnotation = { summitId: FAR, cannotIdentify: true };

  it('takes the midpoint and records the disagreement', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const reduced = reduceTruth(capture, [apex(900, 400), apex(905, 400)]);
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
    const reduced = reduceTruth(capture, [apex(956.5, 442), apex(963.5, 442)]);
    expect(reduced?.kind).toBe('disputed');
  });

  it('never averages an apex against an absent', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const reduced = reduceTruth(capture, [apex(900, 400), absent('clear-sky')]);
    expect(reduced?.kind).toBe('disputed');
    if (reduced?.kind !== 'disputed') return;
    expect(reduced.why).toContain('not in the frame');
  });

  it('calls a summit absent only when both annotators say so, and keeps both reasons', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const reduced = reduceTruth(capture, [absent('clear-sky'), absent('foreground-blocked')]);
    expect(reduced?.kind).toBe('absent');
    if (reduced?.kind !== 'absent') return;
    expect(reduced.reasons).toEqual(['clear-sky', 'foreground-blocked']);
  });

  it('excludes a summit either annotator could not identify, whatever the other said', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    for (const other of [apex(900, 400), absent('clear-sky'), cannot]) {
      expect(reduceTruth(capture, [cannot, other])?.kind).toBe('excluded');
      expect(reduceTruth(capture, [other, cannot])?.kind).toBe('excluded');
    }
  });

  it('separates "not there" from "cannot tell", which the old null form could not', () => {
    // The distinction the redesign exists for, checked on the reduction itself:
    // two annotators saying the region holds no summit is `absent`, and two
    // saying they cannot tell is `excluded`. Collapsing the two — the mutation
    // that returns `absent` for a pair of cannot-identify answers — would make
    // an unidentifiable foothill a false `visible`.
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    expect(reduceTruth(capture, [absent('clear-sky'), absent('clear-sky')])?.kind).toBe('absent');
    expect(reduceTruth(capture, [cannot, cannot])?.kind).toBe('excluded');
  });

  it('carries a landmark only when both annotators named one', () => {
    expect(capture).toBeDefined();
    if (capture === undefined) return;
    const both = reduceTruth(capture, [
      apex(900, 400, 'the crest under the tallest mast'),
      apex(904, 400, 'the crest under the tallest mast'),
    ]);
    expect(both?.kind === 'located' ? both.landmark : undefined).toBe(
      'the crest under the tallest mast',
    );
    const one = reduceTruth(capture, [apex(900, 400, 'the crest under the tallest mast'), apex(904, 400)]);
    expect(one?.kind === 'located' ? one.landmark : undefined).toBeUndefined();
  });
});

describe('the truth instrument stop rule', () => {
  it('registers the floor at three graded summits per band', () => {
    expect(MIN_GRADED_PER_BAND).toBe(3);
  });

  it('reports a band with two graded summits as no-sample and names the truth instrument', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12 }),
          summit({ summitId: DISTANT, distanceKm: 15, truthPx: { xPx: 600, yPx: 400 } }),
        ],
      },
    ]);
    const far = criterion(analysis, 'F3.far');
    expect(far?.n).toBe(2);
    expect(far?.outcome).toBe('no-sample');
    expect(far?.evidence.join('\n')).toContain('the truth instrument limited this row, not the app');
  });

  it('passes the same band once a third summit is graded', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12 }),
          summit({ summitId: DISTANT, distanceKm: 15, truthPx: { xPx: 600, yPx: 400 } }),
          summit({ summitId: HORIZON, distanceKm: 18, truthPx: { xPx: 1300, yPx: 500 } }),
        ],
      },
    ]);
    const far = criterion(analysis, 'F3.far');
    expect(far?.n).toBe(3);
    expect(far?.outcome).toBe('pass');
    expect(far?.evidence.join('\n')).not.toContain('the truth instrument limited this row');
  });

  it('still fails a thin band that holds a 3σ excursion', () => {
    // 50 px at the frame centre is 2.23699°, past the far band's 1.95° 3σ limit.
    // One draw refutes the budget whatever the sample size, so the stop rule
    // withholds a pass and never a failure.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 50, yPx: 0 } })],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.n).toBe(1);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('fail');
  });

  it('tells a band the app never drew from one the annotators could not settle', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12, truthCannotIdentify: 'both' }),
          summit({ summitId: DISTANT, distanceKm: 30, truthPx: { xPx: 600, yPx: 400 } }),
        ],
      },
    ]);
    // The `far` band held a drawn summit and graded none of it.
    expect(criterion(analysis, 'F3.far')?.evidence.join('\n')).toContain(
      '0 of 1 drawn summit-observation(s)',
    );
    // The `mid` band held nothing at all, and says so differently.
    expect(criterion(analysis, 'F3.mid')?.evidence.join('\n')).toContain(
      'no summit was drawn in this band',
    );
  });
});

describe('a summit an annotator cannot identify', () => {
  it('is not a false visible, where an agreed absent is', () => {
    const cannotIdentify = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, truthCannotIdentify: 'both' })],
      },
    ]);
    expect(criterion(cannotIdentify, 'F5a')?.outcome).not.toBe('fail');
    expect(criterion(cannotIdentify, 'F5a')?.evidence.join('\n')).toContain(
      '1 summit(s) drawn visible were excluded',
    );

    const notThere = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, truthAbsent: 'clear-sky' })],
      },
    ]);
    expect(criterion(notThere, 'F5a')?.outcome).toBe('fail');
  });

  it('is excluded from F3 and counted, not silently dropped', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12, truthCannotIdentify: 'second' }),
          summit({ summitId: DISTANT, distanceKm: 30, truthPx: { xPx: 600, yPx: 400 } }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.far')?.n).toBe(0);
    expect(criterion(analysis, 'F3.truth-unidentifiable')?.n).toBe(1);
    expect(criterion(analysis, 'F3.truth-unidentifiable')?.evidence.join('\n')).toContain(
      'one annotator could not identify',
    );
  });

  it('is kept apart from a summit the two annotators disagree about', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12, truthCannotIdentify: 'both' }),
          summit({
            summitId: DISTANT,
            distanceKm: 15,
            truthPx: { xPx: 600, yPx: 400 },
            truthSecondAbsent: 'clear-sky',
          }),
        ],
      },
    ]);
    expect(criterion(analysis, 'F3.truth-unidentifiable')?.n).toBe(1);
    expect(criterion(analysis, 'F3.truth-disputed')?.n).toBe(1);
  });
});

describe('landmark truth', () => {
  const LANDMARK = 'the crest under the tallest mast, not its tip';

  it('grades a landmark observation like any other apex', () => {
    const plain = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [summit({ summitId: FAR, distanceKm: 12, errorPx: { xPx: 12, yPx: 0 } })],
      },
    ]);
    const marked = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({
            summitId: FAR,
            distanceKm: 12,
            errorPx: { xPx: 12, yPx: 0 },
            landmark: LANDMARK,
          }),
        ],
      },
    ]);
    expect(marked.graded[0]?.residual.horizontalDeg).toBe(plain.graded[0]?.residual.horizontalDeg);
  });

  it('reports the landmark observations apart from the rest', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [
          summit({ summitId: FAR, distanceKm: 12, landmark: LANDMARK }),
          summit({ summitId: DISTANT, distanceKm: 30, truthPx: { xPx: 600, yPx: 400 } }),
        ],
      },
    ]);
    expect(analysis.landmarkObservations).toHaveLength(1);
    expect(analysis.landmarkObservations[0]).toContain(LANDMARK);
    expect(analysis.graded.filter((row) => row.landmark !== undefined)).toHaveLength(1);
    const text = renderFieldReport(analysis).join('\n');
    expect(text).toContain('located from a named point feature, reported apart:');
    expect(text).toContain(LANDMARK);
  });
});

describe('what each annotator was given', () => {
  it('carries the method through to the report', () => {
    const { bundle, truth } = synthesiseFieldBundle({
      annotatorMethods: ['bare-frame', 'frame-and-map'],
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const analysis = analyseFieldRun(bundle, truth, lookup);
    expect(analysis.annotatorMethods).toEqual([
      'agent-a: bare-frame — the bare frame and the candidate summit names, nothing else',
      'agent-b: frame-and-map — the bare frame, the candidate summit names, the viewpoint and a topographic map — never the app’s projection and never the pose',
    ]);
    expect(renderFieldReport(analysis).join('\n')).toContain('what each annotator was given:');
  });

  it('refuses a reading that does not say which method it was made under', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: Record<string, unknown>[] }[];
    };
    const reading = raw.captures[0]?.readings[0];
    if (reading !== undefined) delete reading.method;
    expect(parseFieldTruth(raw).ok).toBe(false);
  });

  it('refuses a method it does not register', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: { method: string }[] }[];
    };
    const reading = raw.captures[0]?.readings[0];
    // The app's own projection is never an annotator input.
    if (reading !== undefined) reading.method = 'frame-and-overlay';
    expect(parseFieldTruth(raw).ok).toBe(false);
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

  it('reports an overlay viewport the budget was not computed on', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        hFovDeg: 40,
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.notes.join('\n')).toContain('viewport');
  });

  it('reads the viewport terms off the overlay, not off the stored frame', () => {
    // The stored frame is 16:9 and the drawn viewport is the registered
    // 956 x 440. The roll and scale terms were budgeted on the viewport, so a
    // stored frame of any shape is not a deviation from them.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        framePx: { widthPx: 1920, heightPx: 1080 },
        overlayPx: { widthPx: 956, heightPx: 440 },
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.notes.join('\n')).not.toContain('viewport');
  });

  it('reports a stored frame narrower than the registered 1920 px', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        framePx: { widthPx: 1280, heightPx: 720 },
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.notes.join('\n')).toContain('1280 px across');
  });

  it('reports a stored frame whose aspect is not the camera track’s', () => {
    // 1920 x 1440 stored from a 1920 x 1080 track is 4:3 against 16:9: the
    // frame aspect is 1.3333 where the track's is 1.7778, 25.0 % below it.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        framePx: { widthPx: 1920, heightPx: 1440 },
        track: { width: 1920, height: 1080 },
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.notes.join('\n')).toContain('25.0% off the camera track');
  });

  it('accepts a stored frame whose aspect is the track’s to within a rounded pixel', () => {
    // A 956/440 track stored at 1920 px wide rounds its height to 884 px:
    // 1920/884 = 2.17195 against 956/440 = 2.17273, 0.036 % apart.
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        framePx: { widthPx: 1920, heightPx: 884 },
        track: { width: 956, height: 440 },
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.notes.join('\n')).not.toContain('camera track');
  });

  it('says so when a capture records no camera track size to check against', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        track: { width: 0, height: 0 },
        summits: [summit({ summitId: FAR })],
      },
    ]);
    expect(analysis.refusals.join('\n')).toContain('records no camera track size');
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
    expect(analysis.notes.join('\n')).toContain('not in the committed peak data');
  });

  it('reports a height the bundle and the committed data disagree on', () => {
    const analysis = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        summits: [{ ...summit({ summitId: FAR }), elevationM: 2338 }],
      },
    ]);
    expect(analysis.notes.join('\n')).toContain('30 m apart');
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

  /** The parsed pose of the first capture, as a plain record to spoil. */
  function poseOf(raw: unknown): Record<string, unknown> {
    const document = raw as { captures: { pose: Record<string, unknown> }[] };
    const pose = document.captures[0]?.pose;
    if (pose === undefined) throw new Error('the synthesiser produced no capture');
    return pose;
  }

  it('refuses a pose that does not say what its gross heading offset was', () => {
    const raw = JSON.parse(JSON.stringify(bundleWith({})));
    delete poseOf(raw)['grossHeadingOffsetDeg'];
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.map((problem) => problem.path)).toContain(
      'captures[0].pose.grossHeadingOffsetDeg',
    );
  });

  it('refuses a gross heading offset outside half a turn either way', () => {
    const raw = JSON.parse(JSON.stringify(bundleWith({})));
    poseOf(raw)['grossHeadingOffsetDeg'] = 268;
    expect(parseFieldBundle(raw).ok).toBe(false);
  });

  it('refuses a gross heading source it does not know', () => {
    const raw = JSON.parse(JSON.stringify(bundleWith({})));
    poseOf(raw)['grossHeadingSource'] = 'guess';
    const parsed = parseFieldBundle(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems.some((problem) => problem.message.includes(GROSS_HEADING_SOURCES.join(', ')))).toBe(true);
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

  it('requires exactly one of the three answers', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const mutate = (change: (apex: Record<string, unknown>) => void): boolean => {
      const raw = JSON.parse(JSON.stringify(truth)) as {
        captures: { readings: { apexes: Record<string, unknown>[] }[] }[];
      };
      const apex = raw.captures[0]?.readings[0]?.apexes[0];
      if (apex !== undefined) change(apex);
      return parseFieldTruth(raw).ok;
    };
    // No answer at all.
    expect(mutate((apex) => delete apex.apexPx)).toBe(false);
    // Two answers at once.
    expect(mutate((apex) => { apex.cannotIdentify = true; })).toBe(false);
    // An absent answer that does not say what the region holds instead.
    expect(
      mutate((apex) => {
        delete apex.apexPx;
        apex.absent = true;
      }),
    ).toBe(false);
    expect(
      mutate((apex) => {
        delete apex.apexPx;
        apex.absent = true;
        apex.reason = 'clear-sky';
      }),
    ).toBe(true);
    // A reason the register does not hold.
    expect(
      mutate((apex) => {
        delete apex.apexPx;
        apex.absent = true;
        apex.reason = 'too hazy to tell';
      }),
    ).toBe(false);
    // A landmark belongs to an apex, not to an absence.
    expect(
      mutate((apex) => {
        delete apex.apexPx;
        apex.absent = true;
        apex.reason = 'clear-sky';
        apex.landmark = 'the tallest mast';
      }),
    ).toBe(false);
  });

  it('refuses apexPx: null, and says what to write instead', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    const raw = JSON.parse(JSON.stringify(truth)) as {
      captures: { readings: { apexes: Record<string, unknown>[] }[] }[];
    };
    const apex = raw.captures[0]?.readings[0]?.apexes[0];
    if (apex !== undefined) apex.apexPx = null;
    const parsed = parseFieldTruth(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const message = parsed.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('cannotIdentify');
    expect(message).toContain('absent');
  });

  it('refuses the superseded truth format outright', () => {
    const { truth } = synthesiseFieldBundle({
      captures: [{ captureId: 'c1', role: 'after-drag', summits: [summit({ summitId: FAR })] }],
    });
    expect(SUPERSEDED_TRUTH_FORMAT).not.toBe(TRUTH_FORMAT);
    const raw = JSON.parse(JSON.stringify(truth)) as Record<string, unknown>;
    raw.format = SUPERSEDED_TRUTH_FORMAT;
    const parsed = parseFieldTruth(raw);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    const message = parsed.problems.map((problem) => problem.message).join('\n');
    expect(message).toContain('is not read');
    expect(message).toContain(TRUTH_FORMAT);
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

  it('keeps a capture that was not graded apart from one graded with a caveat', () => {
    // Two captures, one problem each: c1's field of view is a guess, so it is
    // not graded at all; c2 is graded, and its stored frame is 640 px narrower
    // than § 2.0 registers.
    const mixed = run([
      {
        captureId: 'c1',
        role: 'after-drag',
        fovSource: 'spec-sheet-guess',
        summits: [summit({ summitId: FAR })],
      },
      {
        captureId: 'c2',
        role: 'after-drag',
        framePx: { widthPx: 1280, heightPx: 720 },
        track: { width: 1280, height: 720 },
        summits: [summit({ summitId: FAR, truthPx: { xPx: 640, yPx: 360 } })],
      },
    ]);
    expect(mixed.refusals.join('\n')).toContain('spec-sheet guess');
    expect(mixed.refusals.join('\n')).not.toContain('1280 px across');
    expect(mixed.notes.join('\n')).toContain('1280 px across');
    expect(mixed.notes.join('\n')).not.toContain('spec-sheet guess');

    const text = renderFieldReport(mixed).join('\n');
    expect(text).toContain('not graded:');
    expect(text).toContain('graded, with a caveat:');
    // The graded capture's caveat is not filed under "not graded", which is
    // what made a run of 8 notes read as 8 lost captures.
    const notGraded = text.slice(text.indexOf('not graded:'), text.indexOf('graded, with a caveat:'));
    expect(notGraded).not.toContain('1280 px across');
    expect(mixed.graded.map((row) => row.captureId)).toEqual(['c2']);
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

  it('grades the aligned far band on three summits, and the thin bands not at all', () => {
    const bundle = parseFieldBundle(alignedBundle);
    const truth = parseFieldTruth(alignedTruth);
    if (!bundle.ok || !truth.ok) throw new Error('the aligned fixture does not parse');
    const analysis = analyseFieldRun(bundle.value, truth.value, lookup);
    expect(criterion(analysis, 'F3.far')?.n).toBe(MIN_GRADED_PER_BAND);
    expect(criterion(analysis, 'F3.far')?.outcome).toBe('pass');
    // Deer Point is the one near summit, so the stop rule withholds a verdict.
    expect(criterion(analysis, 'F3.near')?.n).toBe(1);
    expect(criterion(analysis, 'F3.near')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F3.near')?.evidence.join('\n')).toContain(
      'the truth instrument limited this row, not the app',
    );
    // Trinity Mountain is the drag anchor and the one horizon summit, so the
    // horizon band holds nothing F3 grades.
    expect(criterion(analysis, 'F3.horizon')?.n).toBe(0);
    expect(criterion(analysis, 'F3.horizon')?.outcome).toBe('no-sample');
    expect(criterion(analysis, 'F3.horizon')?.evidence.join('\n')).toContain(
      'the only summit-observation(s) drawn in this band were the drag anchor',
    );
    expect(analysis.landmarkObservations).toHaveLength(1);
    expect(analysis.annotatorMethods).toHaveLength(2);
  });

  it('keeps the stray fixture’s unidentifiable summit out of F5a', () => {
    const bundle = parseFieldBundle(strayBundle);
    const truth = parseFieldTruth(strayTruth);
    if (!bundle.ok || !truth.ok) throw new Error('the stray fixture does not parse');
    const analysis = analyseFieldRun(bundle.value, truth.value, lookup);
    const f5a = criterion(analysis, 'F5a')?.evidence.join('\n') ?? '';
    // Mores Mountain is the injected false visible; Jackson Peak is the summit
    // neither annotator could identify, and it convicts nothing.
    expect(f5a).toContain('Mores Mountain: drawn visible, and both annotators say it is not in the frame');
    expect(f5a).toContain('Jackson Peak: drawn visible, neither annotator could identify');
    expect(f5a).not.toContain('Jackson Peak: drawn visible, and both annotators');
    expect(criterion(analysis, 'F3.truth-unidentifiable')?.n).toBe(1);
  });

  it('carries both registered geometries: the § 1.2 viewport and the § 2.0 stored frame', () => {
    const bundle = parseFieldBundle(alignedBundle) as { ok: true; value: FieldBundle };
    for (const capture of bundle.value.captures) {
      expect(capture.pose.hFovDeg).toBe(73.74);
      expect(capture.overlayPx).toEqual({ widthPx: 956, heightPx: 440 });
      expect(capture.framePx.widthPx).toBeGreaterThanOrEqual(1920);
      // Stored whole, so its aspect is the track's.
      expect(capture.framePx.widthPx / capture.framePx.heightPx).toBeCloseTo(
        capture.track.width / capture.track.height,
        6,
      );
      expect(capture.fovSource).toBe('calibrated');
    }
  });
});
