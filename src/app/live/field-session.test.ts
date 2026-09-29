/**
 * The field-session script and its capture builder, checked against the parser
 * the bundle has to satisfy.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE EXPECTATIONS COME FROM
 * ═══════════════════════════════════════════════════════════════════════════
 * Four references, none of them this code's own output:
 *
 *   1. `docs/FIELD-TEST-PREREGISTRATION.md`. § 2.0 registers the 1920 px stored
 *      frame; § 2.4 registers the pan target `u ≥ 0.8` of the half-frame and
 *      the 5–15° tilt envelope; § 2.7 lists the steps and the three repeated
 *      drags; Part 3 lists what the bundle may not carry.
 *   2. `src/live/field-analysis.ts`'s parser, which is the contract. Every
 *      built capture is put through it rather than inspected by eye.
 *   3. The pan arithmetic, worked by hand. On a 956 px overlay the half-frame
 *      is 478 px, so u = 0.8 is 382.4 px from the centre: a marker at x = 860.4
 *      is exactly on target and one at x = 800 is 0.6736 of the way there.
 *   4. The still-hold rule from term 8: 2 s of stillness is what excuses the
 *      heading-smoothing lag, and the trace's own `stillForMs` is measured
 *      against that.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_OBSERVER_ACCURACY_M,
  PAN_ANCHOR_EDGE_OFFSET,
  findForbiddenContent,
  parseFieldBundle,
  type Capture,
} from '../../live/field-analysis';
import type { OverlayLayout, OverlayPeak, PeakMarker, UnlabelledSummit } from '../../render/types';
import type { PoseUncertainty } from '../uncertainty';
import {
  BRACE_HOLD_MS,
  CAPTURE_WINDOW_MS,
  FIELD_CAPTURE_COUNT,
  FIELD_SESSION_PRIVACY_STATEMENT,
  MIN_STORED_FRAME_WIDTH_PX,
  MOVEMENT_STEP_COUNT,
  POSE_CARRIES_GROSS_OFFSET,
  REPEATED_DRAG_COUNT,
  TURNED_CAPTURE_COUNT,
  STILL_MOVE_DEG,
  anchorOffsetU,
  anchorSide,
  buildFieldBundle,
  buildFieldCapture,
  captureShortfalls,
  drawnOverlayFrom,
  displayedBandFrom,
  fieldRunPlan,
  frameFileNameFor,
  isFieldSessionRequested,
  panTargetReached,
  stillForMs,
  summariseTrace,
  tiltWithinEnvelope,
  trackGeometryFrom,
  type FieldCaptureContext,
  type PoseSample,
} from './field-session';

/* ══════════════════════════════════════════════════════════════════════════
 * A scene to build captures from
 * ══════════════════════════════════════════════════════════════════════════ */

const OVERLAY_PX = { widthPx: 956, heightPx: 440 };

/**
 * A peak carrying every field an upstream type puts on one — including the two
 * the bundle may never hold. `bearingDeg` plus `distanceKm` is a position fix,
 * so a capture that carried it would place the session.
 */
function peak(id: string, name: string, overrides: Partial<OverlayPeak> = {}): OverlayPeak {
  return {
    id,
    name,
    lat: 43.76,
    lon: -116.1,
    elevationM: 2287,
    elevationSource: 'osm',
    bearingDeg: 284.5,
    altitudeDeg: 1.42,
    distanceKm: 12.5,
    occludingAltitudeDeg: -0.4,
    clearanceDeg: 1.82,
    ...overrides,
  };
}

function marker(peakValue: OverlayPeak, xPx: number, yPx: number): PeakMarker {
  return {
    peak: peakValue,
    summitPx: { xPx, yPx },
    poleTipPx: { xPx, yPx: yPx - 40 },
    labelCentreXPx: xPx,
    nameBaselineYPx: yPx - 50,
    detailBaselineYPx: yPx - 38,
    labelBoxPx: { xPx: xPx - 40, yPx: yPx - 62, widthPx: 80, heightPx: 28 },
    stackLevel: 0,
    direction: 'up',
    overlapped: false,
    obscured: false,
    nameText: peakValue.name,
    detailText: `${peakValue.elevationM} m`,
  };
}

function crowdedOut(peakValue: OverlayPeak, xPx: number, yPx: number): UnlabelledSummit {
  return { peak: peakValue, summitPx: { xPx, yPx }, obscured: false };
}

const SHAFER = peak('overture/shafer', 'Shafer Butte');
const MORES = peak('overture/mores', 'Mores Mountain', { distanceKm: 4.2, altitudeDeg: 0.6 });
const TRINITY = peak('overture/trinity', 'Trinity Mountain', { distanceKm: 56.4 });
const HIDDEN = peak('overture/hidden', 'Hidden Peak', { visibility: 'foreground-occluded' });

function layoutOf(overrides: Partial<OverlayLayout> = {}): OverlayLayout {
  return {
    widthPx: OVERLAY_PX.widthPx,
    heightPx: OVERLAY_PX.heightPx,
    horizonPolylinesPx: [],
    markers: [marker(SHAFER, 478, 210)],
    offFramePeaks: [],
    foregroundOccludedPeaks: [],
    crowdedOutSummits: [],
    options: {} as OverlayLayout['options'],
    ...overrides,
  };
}

const BAND: PoseUncertainty = {
  terms: [
    {
      axis: 'horizontal',
      label: 'compass',
      basis: { kind: 'measured', deg: 8.7, sampleCount: 40, note: 'reported accuracy' },
    },
    {
      axis: 'vertical',
      label: 'pitch',
      basis: { kind: 'measured', deg: 1.5, sampleCount: 40, note: 'gravity spread' },
    },
  ],
  measuredDeg: { horizontal: 8.7, vertical: 1.5 },
  hasUnquantified: false,
  frameFraction: { horizontal: 0.12, vertical: 0.04 },
  pixelsPerDegree: { horizontal: 11.1235, vertical: 11.1235 },
  summary: 'about 8.7° across',
};

function contextOf(overrides: Partial<FieldCaptureContext> = {}): FieldCaptureContext {
  return {
    pose: { headingDeg: 284.2, pitchDeg: 1.1, rollDeg: -0.4, hFovDeg: 73.74, vFovDeg: 38.088 },
    headingBasis: 'true-model',
    trim: { headingDeg: 0.62, pitchDeg: -0.18 },
    grossHeadingOffsetDeg: 0,
    grossHeadingSource: 'sensors',
    overlayPx: OVERLAY_PX,
    band: BAND,
    layout: layoutOf(),
    unmeasured: [{ id: 'overture/far', name: 'Far Peak', distanceKm: 71.3 }],
    track: { deviceId: 'a-handset', width: 1920, height: 1080, frameRate: 30, facingMode: 'environment' },
    fovSource: 'calibrated',
    sweepRadiusKm: 60,
    horizontalAccuracyM: 8.4,
    compassAccuracyDeg: 8,
    ...overrides,
  };
}

const TRACE = {
  headingSpreadDeg: 0.2,
  pitchSpreadDeg: 0.15,
  rollSpreadDeg: 0.3,
  sampleCount: 20,
  stillForMs: 2400,
  compassAccuracyDeg: 8,
  tickCount: 20,
  longestTickGapMs: 60,
} as const;

function captureOf(overrides: Partial<Parameters<typeof buildFieldCapture>[0]> = {}): Capture {
  return buildFieldCapture({
    captureId: 'c1',
    role: 'before-drag',
    tMs: 61_000,
    framePx: { widthPx: 1920, heightPx: 1080 },
    trace: TRACE,
    context: contextOf(),
    ...overrides,
  });
}

/** A bundle the parser will either accept or explain. */
function bundleOf(captures: readonly Capture[]): unknown {
  return JSON.parse(
    JSON.stringify(
      buildFieldBundle({
        device: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Safari/604.1',
        peakRegions: ['idaho-bogus-basin'],
        captures,
      }),
    ),
  ) as unknown;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Getting into the mode
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the field session mode', () => {
  it('is asked for by ?session=field and by nothing else', () => {
    expect(isFieldSessionRequested('?session=field')).toBe(true);
    expect(isFieldSessionRequested('?a=1&session=field&b=2')).toBe(true);
    expect(isFieldSessionRequested('?session=home')).toBe(false);
    expect(isFieldSessionRequested('?session=FIELD')).toBe(false);
    expect(isFieldSessionRequested('')).toBe(false);
  });

  it('says what a capture keeps before any capture is taken', () => {
    const text = FIELD_SESSION_PRIVACY_STATEMENT.join('\n');
    // The four facts § "Captures from the phone" turns on, in plain words.
    expect(text).toContain('photographs');
    expect(text).toContain('shows where it was taken');
    expect(text).toContain('no date and no time of day');
    expect(text).toContain('Nothing is uploaded');
    expect(text).toContain('goes only where you send it');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The script
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the run plan', () => {
  it('follows § 2.7: stand, check, fix, brace, raw, drag, four movements, repeat, then north-east', () => {
    expect(fieldRunPlan().map((entry) => entry.step.id)).toEqual([
      'stand',
      'fov-check',
      'fix-direction',
      'fix',
      'brace',
      'capture-raw',
      'drag',
      'capture-drag',
      'pan-left',
      'pan-right',
      'tilt-up',
      'tilt-down',
      'drag',
      'capture-drag',
      'drag',
      'capture-drag',
      'face-north-east',
      'capture-north-east',
      'capture-north-east-again',
    ]);
  });

  it('asks for the four movements § 2.4 registers, by name', () => {
    const moves = fieldRunPlan().filter((entry) => entry.step.role === 'moved');
    expect(moves).toHaveLength(MOVEMENT_STEP_COUNT);
    expect(moves.map((entry) => entry.step.edge ?? entry.step.tilt)).toEqual([
      'left',
      'right',
      'up',
      'down',
    ]);
  });

  it('drags onto the same summit three times, numbered', () => {
    const drags = fieldRunPlan().filter((entry) => entry.step.id === 'drag');
    expect(drags).toHaveLength(REPEATED_DRAG_COUNT);
    expect(drags.map((entry) => entry.repeat)).toEqual([1, 2, 3]);
  });

  it('produces one capture per capture step, and that is the declared count', () => {
    const captures = fieldRunPlan().filter((entry) => entry.step.role !== undefined);
    expect(captures).toHaveLength(FIELD_CAPTURE_COUNT);
    expect(captures.map((entry) => entry.step.role)).toEqual([
      'before-drag',
      'after-drag',
      'moved',
      'moved',
      'moved',
      'moved',
      'after-drag',
      'after-drag',
      'turned',
      'turned',
    ]);
  });

  it('takes the second direction after every drag, and drags nothing in it', () => {
    const ids = fieldRunPlan().map((entry) => entry.step.id);
    expect(ids.lastIndexOf('capture-drag')).toBeLessThan(ids.indexOf('face-north-east'));
    expect(ids.indexOf('face-north-east')).toBeLessThan(ids.indexOf('capture-north-east'));
    const turned = fieldRunPlan().filter((entry) => entry.step.role === 'turned');
    expect(turned).toHaveLength(TURNED_CAPTURE_COUNT);
    expect(turned.every((entry) => entry.step.kind === 'capture')).toBe(true);
  });

  it('moves the phone from an after-drag capture, never from the raw one', () => {
    const ids = fieldRunPlan().map((entry) => entry.step.id);
    expect(ids.indexOf('capture-drag')).toBeLessThan(ids.indexOf('pan-left'));
    expect(ids.indexOf('pan-left')).toBeLessThan(ids.indexOf('tilt-down'));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The pan target
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the pan target, read off the overlay', () => {
  it('is 0 at the centre and 1 at either edge', () => {
    expect(anchorOffsetU(478, 956)).toBe(0);
    expect(anchorOffsetU(956, 956)).toBe(1);
    expect(anchorOffsetU(0, 956)).toBe(1);
  });

  it('puts u = 0.8 at 382.4 px from the centre of a 956 px overlay', () => {
    // half-frame 478 px; 0.8 × 478 = 382.4; 478 + 382.4 = 860.4.
    expect(anchorOffsetU(860.4, 956)).toBeCloseTo(PAN_ANCHOR_EDGE_OFFSET, 12);
    expect(panTargetReached(PAN_ANCHOR_EDGE_OFFSET)).toBe(true);
    expect(panTargetReached(anchorOffsetU(861, 956))).toBe(true);
    // 800 px is 322 px out, and 322/478 = 0.67364…, short of the target.
    expect(anchorOffsetU(800, 956)).toBeCloseTo(322 / 478, 12);
    expect(panTargetReached(anchorOffsetU(800, 956))).toBe(false);
  });

  it('says which half of the frame the anchor is in, so the two pans differ', () => {
    expect(anchorSide(100, 956)).toBe('left');
    expect(anchorSide(900, 956)).toBe('right');
    expect(anchorSide(478, 956)).toBe('centre');
  });

  it('grades a tilt against the registered 5–15° envelope', () => {
    expect(tiltWithinEnvelope(10)).toBe(true);
    expect(tiltWithinEnvelope(-10)).toBe(true);
    expect(tiltWithinEnvelope(5)).toBe(true);
    expect(tiltWithinEnvelope(15)).toBe(true);
    expect(tiltWithinEnvelope(4.9)).toBe(false);
    expect(tiltWithinEnvelope(15.1)).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The trace
 * ══════════════════════════════════════════════════════════════════════════ */

function samplesEvery(stepMs: number, count: number, move: (index: number) => Partial<PoseSample>): PoseSample[] {
  return Array.from({ length: count }, (_unused, index) => ({
    tMs: index * stepMs,
    headingDeg: 100,
    pitchDeg: 2,
    rollDeg: 0,
    ...move(index),
  }));
}

describe('the sensor trace over a capture', () => {
  it('reports the spread of exactly the last second', () => {
    // 41 samples 50 ms apart span 2000 ms. Only those from 1000 ms on are in the
    // window, and the heading over that half is 100 to 100.4.
    const samples = samplesEvery(50, 41, (index) => ({ headingDeg: 100 + index * 0.02 }));
    const trace = summariseTrace(samples, [], 2000);
    expect(trace.sampleCount).toBe(21);
    expect(trace.headingSpreadDeg).toBeCloseTo(0.4, 9);
    expect(trace.pitchSpreadDeg).toBe(0);
  });

  it('measures how long the pose has been still, ending at the newest sample', () => {
    // The first ten samples wander by a degree each; the last eleven sit still.
    // 11 samples 50 ms apart span 500 ms.
    const samples = samplesEvery(50, 21, (index) => ({
      headingDeg: index < 10 ? 100 + index : 110,
    }));
    expect(stillForMs(samples)).toBe(500);
  });

  it('treats a hold near due north as still, not as a 360° swing', () => {
    // 359.95 and 0.05 are a tenth of a degree apart, and the raw difference is
    // 359.9. Folding is what makes this a still hold.
    const samples: PoseSample[] = [
      { tMs: 0, headingDeg: 359.95, pitchDeg: 0, rollDeg: 0 },
      { tMs: 100, headingDeg: 0.05, pitchDeg: 0, rollDeg: 0 },
    ];
    expect(STILL_MOVE_DEG).toBeGreaterThan(0.1);
    expect(stillForMs(samples)).toBe(100);
    expect(summariseTrace(samples, [], 100).headingSpreadDeg).toBeCloseTo(0.1, 9);
  });

  it('counts the overlay ticks in the window and the longest gap between them', () => {
    // Ticks at 1000, 1050, 1100, 1400, 1450 — one 300 ms gap, four others of 50.
    const trace = summariseTrace(samplesEvery(50, 41, () => ({})), [200, 1000, 1050, 1100, 1400, 1450], 2000);
    expect(trace.tickCount).toBe(5);
    expect(trace.longestTickGapMs).toBe(300);
  });

  it('reports a full window of silence when no tick arrived', () => {
    expect(summariseTrace(samplesEvery(50, 41, () => ({})), [], 2000).longestTickGapMs).toBe(
      CAPTURE_WINDOW_MS,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The overlay, the band and the track
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the overlay as the bundle records it', () => {
  it('keeps labelled markers and crowded-out dots apart by a flag, not a list', () => {
    const overlay = drawnOverlayFrom(
      layoutOf({ markers: [marker(SHAFER, 478, 210)], crowdedOutSummits: [crowdedOut(MORES, 300, 240)] }),
      [],
    );
    expect(overlay.drawn.map((summit) => [summit.summitId, summit.labelled])).toEqual([
      ['overture/shafer', true],
      ['overture/mores', false],
    ]);
  });

  it('separates the three reasons a summit was withheld', () => {
    const overlay = drawnOverlayFrom(
      layoutOf({ offFramePeaks: [MORES], foregroundOccludedPeaks: [HIDDEN] }),
      [{ id: 'overture/trinity', name: 'Trinity Mountain', distanceKm: 56.4 }],
    );
    expect(overlay.withheld.map((summit) => [summit.summitId, summit.reason])).toEqual([
      ['overture/mores', 'off-frame'],
      ['overture/hidden', 'foreground-occluded'],
      ['overture/trinity', 'unmeasured'],
    ]);
  });

  it('withholds a foreground-occluded peak that reached the markers anyway', () => {
    // The renderer never draws one. If one arrives it is reported as withheld
    // rather than given a visibility the schema does not have.
    const overlay = drawnOverlayFrom(layoutOf({ markers: [marker(HIDDEN, 400, 200)] }), []);
    expect(overlay.drawn).toEqual([]);
    expect(overlay.withheld).toEqual([
      { summitId: 'overture/hidden', name: 'Hidden Peak', distanceKm: 12.5, reason: 'foreground-occluded' },
    ]);
  });

  it('carries no bearing to any summit', () => {
    const overlay = drawnOverlayFrom(layoutOf({ offFramePeaks: [MORES] }), []);
    const text = JSON.stringify(overlay);
    for (const banned of ['bearingDeg', 'lat', 'lon', 'occludingAltitudeDeg', 'clearanceDeg']) {
      expect(text, banned).not.toContain(`"${banned}":`);
    }
  });

  it('splits the unquantified flag per axis, because F2 gates per axis', () => {
    const band: PoseUncertainty = {
      ...BAND,
      hasUnquantified: true,
      terms: [
        ...BAND.terms,
        { axis: 'vertical', label: 'lens', basis: { kind: 'unquantified', note: 'not measured' } },
      ],
    };
    expect(displayedBandFrom(band)).toEqual({
      horizontalDeg: 8.7,
      verticalDeg: 1.5,
      hasUnquantifiedHorizontal: false,
      hasUnquantifiedVertical: true,
    });
  });

  it('drops every identifier off the camera track', () => {
    const track = trackGeometryFrom({
      deviceId: 'a-handset',
      width: 1920,
      height: 1080,
      frameRate: 30,
      aspectRatio: 1.777,
      facingMode: 'environment',
    });
    expect(track).toEqual({ width: 1920, height: 1080, frameRate: 30, facingMode: 'environment' });
    expect(trackGeometryFrom({ width: 1920 })).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A capture, against the parser
 * ══════════════════════════════════════════════════════════════════════════ */

describe('a built capture', () => {
  it('parses, and names its frame by a bare file name', () => {
    const capture = captureOf();
    expect(capture.framePath).toBe('c1.jpg');
    expect(frameFileNameFor('c4')).toBe('c4.jpg');
    const result = parseFieldBundle(bundleOf([capture]));
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it('carries the pose, the trim and the band the screen drew with', () => {
    const capture = captureOf();
    expect(capture.pose).toEqual({
      headingDeg: 284.2,
      pitchDeg: 1.1,
      rollDeg: -0.4,
      hFovDeg: 73.74,
      vFovDeg: 38.088,
      headingBasis: 'true-model',
      trimHeadingDeg: 0.62,
      trimPitchDeg: -0.18,
      grossHeadingOffsetDeg: 0,
      grossHeadingSource: 'sensors',
    });
    expect(capture.band.horizontalDeg).toBe(8.7);
    expect(capture.sweepRadiusKm).toBe(60);
  });

  it('folds a heading that came back negative onto [0, 360)', () => {
    // The parser bounds headingDeg to [0, 360]; −4° is the same direction as
    // 356°, not a corrupt reading.
    const capture = captureOf({
      context: contextOf({
        pose: { headingDeg: -4, pitchDeg: 0, rollDeg: 0, hFovDeg: 73.74, vFovDeg: 38.088 },
      }),
    });
    expect(capture.pose.headingDeg).toBeCloseTo(356, 12);
    expect(parseFieldBundle(bundleOf([capture])).ok).toBe(true);
  });

  it('holds no coordinate, no bearing, no wall clock and no camera identifier', () => {
    const capture = captureOf();
    const document = bundleOf([capture]);
    expect(findForbiddenContent(document)).toEqual([]);
    const text = JSON.stringify(document);
    // Key-shaped, because `labelled` is a legitimate field and `label` is not.
    for (const banned of [
      'latitude',
      'longitude',
      'coords',
      'geolocation',
      'bearingDeg',
      'deviceId',
      'groupId',
      'label',
      'dataUrl',
      'base64',
    ]) {
      expect(text, banned).not.toContain(`"${banned}":`);
    }
    // Every number is small, so none of them can be an epoch.
    const numbers = [...text.matchAll(/-?\d+(\.\d+)?/g)].map((match) => Math.abs(Number(match[0])));
    expect(Math.max(...numbers)).toBeLessThan(1e9);
  });

  it('records the fix accuracy and declares what the number means', () => {
    const parsed = parseFieldBundle(bundleOf([captureOf()]));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.captures[0]?.horizontalAccuracyM).toBe(8.4);
    expect(parsed.value.accuracyConvention).toBe('w3c-95-percent-horizontal-radius');
  });

  it('declares no convention when no capture reported an accuracy', () => {
    const capture = captureOf({ context: contextOf({ horizontalAccuracyM: undefined }) });
    const bundle = bundleOf([capture]);
    expect((bundle as Record<string, unknown>).accuracyConvention).toBeUndefined();
    expect(parseFieldBundle(bundle).ok).toBe(true);
  });

  it('names the anchor on an after-drag capture, and the source on a moved one', () => {
    const after = captureOf({ captureId: 'c2', role: 'after-drag', dragAnchorSummitId: SHAFER.id });
    const panned = captureOf({
      captureId: 'c3',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      panFromReferenceDeg: 31.4,
    });
    const tilted = captureOf({
      captureId: 'c4',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      tiltFromReferenceDeg: -10.2,
    });
    const result = parseFieldBundle(bundleOf([captureOf(), after, panned, tilted]));
    expect(result.ok ? [] : result.problems).toEqual([]);
  });

  it('is refused by the parser when an after-drag capture names no anchor', () => {
    const result = parseFieldBundle(bundleOf([captureOf({ captureId: 'c2', role: 'after-drag' })]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.path)).toContain(
      'captures[0].dragAnchorSummitId',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * What the screen says about an off-protocol capture
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the shortfalls a capture is reported with', () => {
  it('finds nothing wrong with a capture that follows the protocol', () => {
    expect(captureShortfalls(captureOf(), { anchorU: 0.84 })).toEqual([]);
  });

  it('names a frame under the registered 1920 px', () => {
    const capture = captureOf({ framePx: { widthPx: 1280, heightPx: 720 } });
    const codes = captureShortfalls(capture).map((shortfall) => shortfall.code);
    expect(codes).toEqual(['frame-too-small']);
    expect(MIN_STORED_FRAME_WIDTH_PX).toBe(1920);
  });

  it('names a hold shorter than the two seconds term 8 needs', () => {
    const capture = captureOf({ trace: { ...TRACE, stillForMs: BRACE_HOLD_MS - 1 } });
    expect(captureShortfalls(capture).map((shortfall) => shortfall.code)).toEqual(['not-still']);
  });

  it('names an uncalibrated capture, which F2 and F3 both refuse', () => {
    const capture = captureOf({ context: contextOf({ fovSource: 'spec-sheet-guess' }) });
    expect(captureShortfalls(capture).map((shortfall) => shortfall.code)).toEqual(['uncalibrated']);
  });

  it('names a fix looser than the 30 m term 3a allows', () => {
    const capture = captureOf({
      context: contextOf({ horizontalAccuracyM: MAX_OBSERVER_ACCURACY_M + 0.1 }),
    });
    expect(captureShortfalls(capture).map((shortfall) => shortfall.code)).toEqual(['fix-too-loose']);
  });

  it('names a pan that stopped short of the target, and passes one that did not', () => {
    const panned = captureOf({
      captureId: 'c3',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      panFromReferenceDeg: 12,
    });
    expect(captureShortfalls(panned, { anchorU: 0.67 }).map((s) => s.code)).toEqual(['pan-short']);
    expect(captureShortfalls(panned, { anchorU: 0.8 })).toEqual([]);
  });

  it('names a pan that reached the wrong edge', () => {
    const panned = captureOf({
      captureId: 'c3',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      panFromReferenceDeg: 31,
    });
    expect(
      captureShortfalls(panned, { anchorU: 0.9, anchorSide: 'right', wantedEdge: 'left' }).map(
        (s) => s.code,
      ),
    ).toEqual(['pan-wrong-side']);
    expect(
      captureShortfalls(panned, { anchorU: 0.9, anchorSide: 'left', wantedEdge: 'left' }),
    ).toEqual([]);
  });

  it('names a tilt that went the wrong way', () => {
    const tilted = captureOf({
      captureId: 'c5',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      tiltFromReferenceDeg: 10,
    });
    expect(captureShortfalls(tilted, { wantedTilt: 'down' }).map((s) => s.code)).toEqual([
      'tilt-wrong-way',
    ]);
    expect(captureShortfalls(tilted, { wantedTilt: 'up' })).toEqual([]);
  });

  it('names a tilt outside the 5–15° envelope', () => {
    const tilted = captureOf({
      captureId: 'c4',
      role: 'moved',
      dragAnchorSummitId: SHAFER.id,
      movedFromCaptureId: 'c2',
      tiltFromReferenceDeg: 2,
    });
    expect(captureShortfalls(tilted).map((shortfall) => shortfall.code)).toEqual(['tilt-outside']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * A whole session's bundle
 * ══════════════════════════════════════════════════════════════════════════ */

describe('a whole run', () => {
  it('parses as one bundle with every capture role in it', () => {
    const captures: Capture[] = [
      captureOf(),
      captureOf({ captureId: 'c2', role: 'after-drag', dragAnchorSummitId: SHAFER.id }),
      captureOf({
        captureId: 'c3',
        role: 'moved',
        dragAnchorSummitId: SHAFER.id,
        movedFromCaptureId: 'c2',
        panFromReferenceDeg: 31.4,
      }),
      captureOf({
        captureId: 'c4',
        role: 'moved',
        dragAnchorSummitId: SHAFER.id,
        movedFromCaptureId: 'c2',
        panFromReferenceDeg: -31.4,
      }),
      captureOf({
        captureId: 'c5',
        role: 'moved',
        dragAnchorSummitId: SHAFER.id,
        movedFromCaptureId: 'c2',
        tiltFromReferenceDeg: 10.2,
      }),
      captureOf({
        captureId: 'c6',
        role: 'moved',
        dragAnchorSummitId: SHAFER.id,
        movedFromCaptureId: 'c2',
        tiltFromReferenceDeg: -10.2,
      }),
      captureOf({ captureId: 'c7', role: 'after-drag', dragAnchorSummitId: SHAFER.id }),
      captureOf({ captureId: 'c8', role: 'after-drag', dragAnchorSummitId: SHAFER.id }),
      captureOf({ captureId: 'c9', role: 'turned' }),
      captureOf({ captureId: 'c10', role: 'turned' }),
    ];
    expect(captures).toHaveLength(FIELD_CAPTURE_COUNT);
    const result = parseFieldBundle(bundleOf(captures));
    expect(result.ok ? [] : result.problems).toEqual([]);
    if (!result.ok) return;
    expect(result.value.captures.map((capture) => capture.captureId)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
      'c5',
      'c6',
      'c7',
      'c8',
      'c9',
      'c10',
    ]);
    expect(result.value.peakRegions).toEqual(['idaho-bogus-basin']);
    // The withheld summit the sweep never reached is what F5c grades.
    expect(result.value.captures[0]?.overlay.withheld.map((summit) => summit.reason)).toEqual([
      'unmeasured',
    ]);
  });

  it('is refused when two captures share an id', () => {
    const result = parseFieldBundle(bundleOf([captureOf(), captureOf()]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((problem) => problem.message).join('\n')).toContain('used twice');
  });

  it('mentions Trinity Mountain nowhere unless the overlay drew it', () => {
    const text = JSON.stringify(bundleOf([captureOf()]));
    expect(text).not.toContain(TRINITY.name);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The gross heading offset the bundle carries
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the gross heading offset in a capture', () => {
  const context = contextOf({ grossHeadingOffsetDeg: -92, grossHeadingSource: 'sun' });
  const input = (): Parameters<typeof buildFieldCapture>[0] => ({
    captureId: 'c1',
    role: 'before-drag',
    tMs: 61_000,
    framePx: { widthPx: 1920, heightPx: 1080 },
    trace: TRACE,
    context: contextOf(),
  });

  it('is left out of the pose when a caller builds one without it', () => {
    expect(POSE_CARRIES_GROSS_OFFSET).toBe(true);
    const pose = buildFieldCapture({ ...input(), context }, false).pose as unknown as Record<
      string,
      unknown
    >;
    expect(pose.grossHeadingOffsetDeg).toBeUndefined();
    expect(pose.grossHeadingSource).toBeUndefined();
  });

  it('keeps a bundle the parser accepts, offset or no offset', () => {
    const parsed = parseFieldBundle(bundleOf([captureOf({ context })]));
    expect(parsed.ok, JSON.stringify(parsed.ok ? [] : parsed.problems)).toBe(true);
  });

  it('carries both fields, which the bundle schema takes', () => {
    const pose = buildFieldCapture({ ...input(), context }, true).pose as unknown as Record<
      string,
      unknown
    >;
    expect(pose.grossHeadingOffsetDeg).toBe(-92);
    expect(pose.grossHeadingSource).toBe('sun');
  });

  it('records the sensors as the source when nobody re-anchored', () => {
    const pose = buildFieldCapture(input(), true).pose as unknown as Record<string, unknown>;
    expect(pose.grossHeadingOffsetDeg).toBe(0);
    expect(pose.grossHeadingSource).toBe('sensors');
  });
});
