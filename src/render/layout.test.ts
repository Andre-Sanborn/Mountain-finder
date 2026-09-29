import { describe, expect, it } from 'vitest';

import type { CameraPose, HorizonPoint, HorizonProfile, VisiblePeak } from '../core/types';
import {
  formatPeakDetail,
  isPeakObscured,
  labelBlockHeightPx,
  layoutOverlay,
  rectsOverlap,
  resolveOverlayOptions,
  MARGINAL_DETAIL_SUFFIX,
} from './layout';
import type { OverlayOptions, OverlayScene, PeakMarker } from './types';

/**
 * ## How the expectations in this file are derived
 *
 * Independently of the renderer, from the projection model documented in
 * `src/core/projection.ts`. With pitch = 0 and roll = 0 the camera's `right`
 * axis is horizontal and its `up` axis is world-up, so for a target at bearing
 * offset Δ = bearing − heading and altitude α the perspective divide collapses
 * to a closed form:
 *
 *     across / depth = tan Δ
 *     up     / depth = tan α / cos Δ
 *
 *     x = 0.5 + tan Δ        / (2 · tan(hFOV/2))
 *     y = 0.5 − tan α / cosΔ / (2 · tan(vFOV/2))
 *
 * and the vertical field of view follows the aspect ratio through the tangents:
 * tan(vFOV/2) = tan(hFOV/2) · height / width.
 *
 * The fixture below is chosen so the horizontal answer is exact in closed form.
 * With hFOV = 60° and Δ = 15°:
 *
 *     x = 0.5 + tan15° / (2·tan30°)
 *       = 0.5 + (2 − √3) · (√3/2)
 *       = 0.5 + (2√3 − 3)/2
 *       = √3 − 1
 *       = 0.7320508075688772…
 *
 * so on a 1600 px-wide frame the flag stands at **1600·(√3 − 1) =
 * 1171.28129 px**. The vertical one, with α = 3°, is
 *
 *     y = 0.5 − (tan3° / cos15°) / (2 · tan30° · 3/4)
 *       = 0.5 − 0.05425652… / 0.86602540…
 *       = 0.43734996…
 *
 * → **524.81995 px** on a 1200 px-high frame.
 *
 * Neither number was produced by running the renderer.
 */
const WIDTH_PX = 1600;
const HEIGHT_PX = 1200;
const HFOV_DEG = 60;

/** tan(vFOV/2) = tan(hFOV/2) · height/width — the documented aspect relation. */
const TAN_HALF_V = Math.tan((HFOV_DEG / 2) * (Math.PI / 180)) * (HEIGHT_PX / WIDTH_PX);
const VFOV_DEG = 2 * Math.atan(TAN_HALF_V) * (180 / Math.PI);

const POSE: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: HFOV_DEG,
  vFovDeg: VFOV_DEG,
};

/** Hand-computed pixel position of a target at bearing offset Δ, altitude α. */
function expectedPx(deltaBearingDeg: number, altitudeDeg: number): { xPx: number; yPx: number } {
  const rad = (deg: number): number => (deg * Math.PI) / 180;
  const tanHalfH = Math.tan(rad(HFOV_DEG / 2));
  const x = 0.5 + Math.tan(rad(deltaBearingDeg)) / (2 * tanHalfH);
  const y = 0.5 - Math.tan(rad(altitudeDeg)) / Math.cos(rad(deltaBearingDeg)) / (2 * TAN_HALF_V);
  return { xPx: x * WIDTH_PX, yPx: y * HEIGHT_PX };
}

function peak(overrides: Partial<VisiblePeak> & Pick<VisiblePeak, 'id' | 'name'>): VisiblePeak {
  return {
    lat: 46,
    lon: 7.5,
    elevationM: 4478,
    elevationSource: 'osm',
    bearingDeg: 105,
    altitudeDeg: 3,
    distanceKm: 12.3,
    occludingAltitudeDeg: 1,
    clearanceDeg: 2,
    ...overrides,
  };
}

/** A skyline sitting at a constant altitude everywhere, sampled every 45°. */
function flatHorizon(altitudeDeg: number): HorizonProfile {
  const points: HorizonPoint[] = [];
  for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 45) {
    points.push({ bearingDeg, altitudeDeg, distanceKm: 20, elevationM: 2000 });
  }
  return points;
}

function scene(overrides: Partial<OverlayScene> = {}): OverlayScene {
  return {
    widthPx: WIDTH_PX,
    heightPx: HEIGHT_PX,
    pose: POSE,
    horizon: flatHorizon(0),
    peaks: [],
    ...overrides,
  };
}

/** Options pinned so a default tweak cannot silently change a layout assertion. */
const PINNED: OverlayOptions = {
  nameFontPx: 20,
  detailFontPx: 14,
  labelPaddingPx: 4,
  labelGapPx: 3,
  basePoleLengthPx: 60,
  frameMarginPx: 10,
  maxStackLevels: 6,
  summitDotRadiusPx: 5,
};

function markerNamed(markers: readonly PeakMarker[], name: string): PeakMarker {
  const found = markers.find((marker) => marker.peak.name === name);
  if (found === undefined) throw new Error(`no marker for ${name}`);
  return found;
}

describe('layoutOverlay — flag geometry', () => {
  it('plants the flag at the hand-computed pixel position', () => {
    const layout = layoutOverlay(
      scene({ peaks: [peak({ id: 'node/1', name: 'Matterhorn' })] }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'Matterhorn');

    // The literals are the derivation at the top of this file, carried out to
    // five decimals. P4.1's stated tolerance is ±0.5 % of the position; the
    // agreement is in fact better than a hundredth of a pixel.
    expect(marker.summitPx.xPx).toBeCloseTo(1171.28129, 4);
    expect(marker.summitPx.yPx).toBeCloseTo(524.81995, 4);

    // …and the same numbers again from the closed form, so a transcription
    // slip in the literals above cannot pass unnoticed.
    const expected = expectedPx(15, 3);
    expect(marker.summitPx.xPx).toBeCloseTo(expected.xPx, 9);
    expect(marker.summitPx.yPx).toBeCloseTo(expected.yPx, 9);

    // The ±0.5 % gate from archive/v2-docs-20260929/PLAN.md, stated explicitly.
    expect(Math.abs(marker.summitPx.xPx - 1171.28129)).toBeLessThan(0.005 * 1171.28129);
    expect(Math.abs(marker.summitPx.yPx - 524.81995)).toBeLessThan(0.005 * 524.81995);
  });

  it('puts a peak dead ahead in the exact centre of the frame', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [peak({ id: 'node/1', name: 'Ahead', bearingDeg: 90, altitudeDeg: 0 })],
      }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'Ahead');
    expect(marker.summitPx.xPx).toBeCloseTo(WIDTH_PX / 2, 9);
    expect(marker.summitPx.yPx).toBeCloseTo(HEIGHT_PX / 2, 9);
  });

  it('puts a peak at exactly half the hFOV on the frame edge', () => {
    // Δ = 30° = hFOV/2 → x = 0.5 + tan30/(2·tan30) = 1.0 → 1600 px, the very
    // last column. `inFrame` includes the boundary, so it is still drawn.
    const layout = layoutOverlay(
      scene({
        peaks: [peak({ id: 'node/1', name: 'Edge', bearingDeg: 120, altitudeDeg: 0 })],
      }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'Edge');
    expect(marker.summitPx.xPx).toBeCloseTo(WIDTH_PX, 9);
  });

  it('raises the pole by exactly basePoleLengthPx for an unstacked marker', () => {
    const layout = layoutOverlay(
      scene({ peaks: [peak({ id: 'node/1', name: 'Matterhorn' })] }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'Matterhorn');
    expect(marker.direction).toBe('up');
    expect(marker.stackLevel).toBe(0);
    expect(marker.summitPx.yPx - marker.poleTipPx.yPx).toBeCloseTo(60, 9);
    expect(marker.poleTipPx.xPx).toBeCloseTo(marker.summitPx.xPx, 9);
  });
});

describe('layoutOverlay — peaks outside the frame', () => {
  it('drops a peak beyond the horizontal field of view', () => {
    // Δ = 40° → x = 0.5 + tan40/(2·tan30) = 1.2267, off the right edge.
    const off = peak({ id: 'node/2', name: 'Offscreen', bearingDeg: 130 });
    const layout = layoutOverlay(scene({ peaks: [off] }), PINNED);
    expect(layout.markers).toHaveLength(0);
    expect(layout.offFramePeaks.map((p) => p.name)).toEqual(['Offscreen']);
  });

  it('drops a peak behind the camera rather than mirroring it into frame', () => {
    // Δ = 180°: the perspective divide by a negative depth would land this at
    // x = 0.5 again — dead centre — if the sign were not checked.
    const behind = peak({ id: 'node/3', name: 'Behind', bearingDeg: 270, altitudeDeg: 0 });
    const layout = layoutOverlay(scene({ peaks: [behind] }), PINNED);
    expect(layout.markers).toHaveLength(0);
    expect(layout.offFramePeaks.map((p) => p.name)).toEqual(['Behind']);
  });

  it('drops a peak above the top of the frame', () => {
    // tan(vFOV/2) = 0.4330127 → the top edge is at α = atan(0.4330127) =
    // 23.4132°. 25° is above it.
    const above = peak({ id: 'node/4', name: 'Zenith', bearingDeg: 90, altitudeDeg: 25 });
    const layout = layoutOverlay(scene({ peaks: [above] }), PINNED);
    expect(layout.markers).toHaveLength(0);
    expect(layout.offFramePeaks.map((p) => p.name)).toEqual(['Zenith']);
  });

  it('keeps an in-frame peak and drops its off-frame neighbour in one pass', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Keep' }),
          peak({ id: 'node/2', name: 'Drop', bearingDeg: 130 }),
        ],
      }),
      PINNED,
    );
    expect(layout.markers.map((m) => m.peak.name)).toEqual(['Keep']);
    expect(layout.offFramePeaks.map((p) => p.name)).toEqual(['Drop']);
  });
});

describe('layoutOverlay — label collision avoidance', () => {
  const blockHeightPx = labelBlockHeightPx(20, 14, 4);

  it('reserves a box one label high', () => {
    // 2·4 padding + 1.15·(20 + 14) = 8 + 39.1 = 47.1 px.
    expect(blockHeightPx).toBeCloseTo(47.1, 9);
  });

  it('leaves two well-separated peaks both unstacked', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Left', bearingDeg: 75 }),
          peak({ id: 'node/2', name: 'Right', bearingDeg: 105 }),
        ],
      }),
      PINNED,
    );
    expect(layout.markers.map((m) => m.stackLevel)).toEqual([0, 0]);
    expect(
      rectsOverlap(
        markerNamed(layout.markers, 'Left').labelBoxPx,
        markerNamed(layout.markers, 'Right').labelBoxPx,
      ),
    ).toBe(false);
  });

  it('stacks a cluster of coincident peaks in order of apparent height', () => {
    // Four peaks within 0.3° of bearing and 0.3° of altitude — the tight
    // clustering a real skyline produces. Their labels are ~122 px wide and
    // their summits only ~2.6 px apart in x, so every box overlaps every other
    // horizontally: the whole problem is vertical.
    //
    // Summit y from the closed form at the top of this file:
    //     Alpha  (Δ15.0°, α3.0°) → 524.820
    //     Bravo  (Δ15.1°, α3.2°) → 519.760
    //     Charlie(Δ15.2°, α2.9°) → 527.262
    //     Delta  (Δ15.3°, α3.1°) → 522.199
    //
    // A candidate box at level L spans, top to bottom:
    //     top = summitY − 60 (pole) − 51·L (stack) − 3 (gap) − 47.1 (height)
    //
    // Placement runs in PRIORITY order — apparent height, highest first — so
    // the sequence is Bravo (3.2°), Delta (3.1°), Alpha (3.0°), Charlie (2.9°),
    // and the biggest thing in the view gets first claim on the space:
    //
    //     Bravo   L0 → 409.66…456.76   free            → level 0
    //     Delta   L0 → 412.10…459.20   hits Bravo
    //             L1 → 361.10…408.20   free            → level 1
    //     Alpha   L0 → 414.72…461.82   hits Bravo
    //             L1 → 363.72…410.82   hits Delta and Bravo
    //             L2 → 312.72…359.82   free by 1.28 px  → level 2
    //     Charlie L0 → 417.16…464.26   hits Bravo
    //             L1 → 366.16…413.26   hits Delta
    //             L2 → 315.16…362.26   hits Alpha
    //             L3 → 264.16…311.26   free by 1.46 px  → level 3
    //
    // Markers are REPORTED left to right (ties by id), which is the reading
    // order of the picture; that is a presentation decision and is independent
    // of the placement order above, which is a resource-allocation decision.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0, altitudeDeg: 3.0 }),
          peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.1, altitudeDeg: 3.2 }),
          peak({ id: 'node/3', name: 'Charlie', bearingDeg: 105.2, altitudeDeg: 2.9 }),
          peak({ id: 'node/4', name: 'Delta', bearingDeg: 105.3, altitudeDeg: 3.1 }),
        ],
      }),
      PINNED,
    );

    expect(layout.markers).toHaveLength(4);
    expect(layout.markers.map((m) => m.peak.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
      'Delta',
    ]);
    expect(layout.markers.map((m) => m.stackLevel)).toEqual([2, 0, 3, 1]);
    expect(layout.markers.every((m) => m.overlapped)).toBe(false);
    expect(layout.markers.map((m) => Math.round(m.labelBoxPx.yPx * 100) / 100)).toEqual([
      312.72, 409.66, 264.16, 361.1,
    ]);

    // The behaviour that matters, whatever the levels turn out to be: no two
    // reserved boxes intersect.
    for (let i = 0; i < layout.markers.length; i += 1) {
      for (let j = i + 1; j < layout.markers.length; j += 1) {
        const a = layout.markers[i];
        const b = layout.markers[j];
        if (a === undefined || b === undefined) throw new Error('missing marker');
        expect(rectsOverlap(a.labelBoxPx, b.labelBoxPx)).toBe(false);
      }
    }
  });

  it('skips a level that a lower neighbour has already spoiled', () => {
    // A level bump clears a neighbour whose summit sits at the SAME height. It
    // does not clear a lower one, because each pole is measured from its own
    // summit — so the search has to test the real boxes rather than increment
    // a counter, and a level index can be skipped entirely.
    //
    // Both peaks at Δ = 15.0°, so their boxes coincide horizontally.
    //     Alpha (α 3.0°) → y 524.820,  L0 → 414.72…461.82   free  → level 0
    //     Beta  (α 2.5°) → y 537.36747, L0 → 427.27…474.37  hits Alpha
    //                                   L1 → 376.27…423.37  hits Alpha by 8.65 px
    //                                   L2 → 325.27…372.37  free  → level 2
    // Level 1 is skipped.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0, altitudeDeg: 3.0 }),
          peak({ id: 'node/2', name: 'Beta', bearingDeg: 105.0, altitudeDeg: 2.5 }),
        ],
      }),
      PINNED,
    );

    expect(markerNamed(layout.markers, 'Alpha').stackLevel).toBe(0);
    // tan2.5° / cos15° / (2·tan30°·0.75) = 0.052193773 → y = 0.447806227.
    expect(markerNamed(layout.markers, 'Beta').summitPx.yPx).toBeCloseTo(537.36747, 4);
    expect(markerNamed(layout.markers, 'Beta').stackLevel).toBe(2);
    expect(
      rectsOverlap(
        markerNamed(layout.markers, 'Alpha').labelBoxPx,
        markerNamed(layout.markers, 'Beta').labelBoxPx,
      ),
    ).toBe(false);
  });

  it('lengthens the pole by exactly one stackStepPx per level', () => {
    const options = { ...PINNED, stackStepPx: 55 };
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0 }),
          peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.1 }),
        ],
      }),
      options,
    );
    const alpha = markerNamed(layout.markers, 'Alpha');
    const bravo = markerNamed(layout.markers, 'Bravo');
    expect(alpha.stackLevel).toBe(0);
    expect(bravo.stackLevel).toBe(1);
    expect(alpha.summitPx.yPx - alpha.poleTipPx.yPx).toBeCloseTo(60, 9);
    expect(bravo.summitPx.yPx - bravo.poleTipPx.yPx).toBeCloseTo(60 + 55, 9);
  });

  it('is independent of the order the peaks arrive in', () => {
    const peaks = [
      peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0 }),
      peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.1 }),
      peak({ id: 'node/3', name: 'Charlie', bearingDeg: 105.2 }),
    ];
    const forward = layoutOverlay(scene({ peaks }), PINNED);
    const reversed = layoutOverlay(scene({ peaks: [...peaks].reverse() }), PINNED);
    expect(reversed.markers).toEqual(forward.markers);
  });

  it('breaks an exact tie by peak id, not by input order', () => {
    // Identical bearing, identical altitude, identical elevation: neither the
    // x sort nor the priority sort can separate these two, so the id tie-break
    // is the ONLY thing deciding who gets level 0 — and it must not be
    // "whoever the provider listed first". (Previously this fixture gave the
    // two peaks different altitudes, which under priority placement would have
    // let apparent height decide and left the tie-break untested.)
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/9', name: 'Nine', altitudeDeg: 3.0 }),
          peak({ id: 'node/2', name: 'Two', altitudeDeg: 3.0 }),
        ],
      }),
      PINNED,
    );
    expect(markerNamed(layout.markers, 'Two').stackLevel).toBe(0);
    expect(markerNamed(layout.markers, 'Nine').stackLevel).toBe(1);
  });

  it('hangs a blocked label below its summit when nothing above is free', () => {
    // Only one level up is allowed, and Alpha has taken it, so Bravo's search
    // moves on to the downward candidates rather than giving up: its label
    // ends up under its own summit, well clear of Alpha's box above.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0 }),
          peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.05 }),
        ],
      }),
      { ...PINNED, maxStackLevels: 1 },
    );
    const alpha = markerNamed(layout.markers, 'Alpha');
    const bravo = markerNamed(layout.markers, 'Bravo');
    expect(alpha.direction).toBe('up');
    expect(bravo.direction).toBe('down');
    expect(bravo.overlapped).toBe(false);
    expect(bravo.poleTipPx.yPx - bravo.summitPx.yPx).toBeCloseTo(60, 9);
    expect(rectsOverlap(alpha.labelBoxPx, bravo.labelBoxPx)).toBe(false);
  });

  it('accounts for a peak it cannot place rather than burying a neighbour', () => {
    // Three coincident peaks with one level in each direction: the third has
    // nowhere left to go.
    //
    // This test formerly asserted the opposite — that the third was DRAWN, on
    // top of its neighbour, and flagged `overlapped`. That was the right answer
    // when it was written, because there was no channel through which a
    // withheld name could be reported, and a name that silently vanishes is a
    // lie about what is in the photograph. `crowdedOutSummits` and the count
    // drawn on the image are that channel, so the reason for drawing an
    // illegible label has gone: it now costs the legible label underneath it
    // and buys nothing that the count does not.
    //
    // What the old test was protecting — nothing disappears unaccounted for —
    // is asserted here in full, and more strictly than before.
    const peaks = [
      peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0 }),
      peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.05 }),
      peak({ id: 'node/3', name: 'Charlie', bearingDeg: 105.1 }),
    ];
    const layout = layoutOverlay(scene({ peaks }), { ...PINNED, maxStackLevels: 1 });

    expect(layout.markers.map((m) => m.nameText)).toEqual(['Alpha', 'Bravo']);
    expect(layout.markers.every((m) => !m.overlapped)).toBe(true);
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['Charlie']);
    // Nothing lost: every peak is in exactly one of the four exit lists.
    expect(
      layout.markers.length +
        layout.crowdedOutSummits.length +
        layout.offFramePeaks.length +
        layout.foregroundOccludedPeaks.length,
    ).toBe(peaks.length);
    // …and the summit that lost its name still has its dot, at its own
    // projected position (Δ = 15.1°, α = 3°, from the closed form at the top of
    // this file), so the picture does not pretend it is not there.
    const charlie = expectedPx(15.1, 3);
    expect(layout.crowdedOutSummits[0]?.summitPx.xPx).toBeCloseTo(charlie.xPx, 6);
    expect(layout.crowdedOutSummits[0]?.summitPx.yPx).toBeCloseTo(charlie.yPx, 6);
  });

  it('hangs the label below a summit that sits too near the top edge', () => {
    // α = 22.7° → y = 0.5 − tan22.7°/0.8660254 = 0.016978 → 20.37 px. A
    // level-0 label above it would start at 20.37 − 60 − 3 − 47.1 = −89.7 px,
    // outside the frame, so the placement flips downward.
    const layout = layoutOverlay(
      scene({
        peaks: [peak({ id: 'node/1', name: 'HighUp', bearingDeg: 90, altitudeDeg: 22.7 })],
      }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'HighUp');
    expect(marker.summitPx.yPx).toBeCloseTo(20.374, 3);
    expect(marker.direction).toBe('down');
    expect(marker.stackLevel).toBe(0);
    expect(marker.poleTipPx.yPx - marker.summitPx.yPx).toBeCloseTo(60, 9);
    expect(marker.labelBoxPx.yPx).toBeGreaterThan(marker.summitPx.yPx);
  });

  it('keeps every label box inside the frame margins', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          // Hard against the left and right edges of the frame.
          peak({ id: 'node/1', name: 'Westmost', bearingDeg: 60.2, altitudeDeg: 0 }),
          peak({ id: 'node/2', name: 'Eastmost', bearingDeg: 119.8, altitudeDeg: 0 }),
        ],
      }),
      PINNED,
    );
    for (const marker of layout.markers) {
      expect(marker.labelBoxPx.xPx).toBeGreaterThanOrEqual(10);
      expect(marker.labelBoxPx.xPx + marker.labelBoxPx.widthPx).toBeLessThanOrEqual(
        WIDTH_PX - 10 + 1e-9,
      );
      expect(marker.labelBoxPx.yPx).toBeGreaterThanOrEqual(10);
    }
  });

  it('centres the label on its pole when there is room on both sides', () => {
    const layout = layoutOverlay(
      scene({ peaks: [peak({ id: 'node/1', name: 'Matterhorn' })] }),
      PINNED,
    );
    const marker = markerNamed(layout.markers, 'Matterhorn');
    expect(marker.labelCentreXPx).toBeCloseTo(marker.summitPx.xPx, 9);
  });
});

describe('layoutOverlay — horizon polyline', () => {
  it('draws a flat 0° skyline as a level line across the middle of the frame', () => {
    // α = 0 makes the up-component of every sample exactly zero, so y = 0.5
    // for every bearing regardless of Δ: the line is exactly horizontal at
    // 600 px. Nothing about that depends on the sampling density.
    const layout = layoutOverlay(scene({ horizon: flatHorizon(0) }), PINNED);
    expect(layout.horizonPolylinesPx).toHaveLength(1);
    const polyline = layout.horizonPolylinesPx[0];
    if (polyline === undefined) throw new Error('missing polyline');
    for (const point of polyline) {
      expect(point.yPx).toBeCloseTo(600, 9);
    }
  });

  it('clips the skyline exactly to the frame edges', () => {
    const layout = layoutOverlay(scene({ horizon: flatHorizon(0) }), PINNED);
    const polyline = layout.horizonPolylinesPx[0];
    if (polyline === undefined) throw new Error('missing polyline');
    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    if (first === undefined || last === undefined) throw new Error('empty polyline');
    expect(first.xPx).toBeCloseTo(0, 9);
    expect(last.xPx).toBeCloseTo(WIDTH_PX, 9);
    // Monotonic left to right, so nothing doubles back across the frame.
    for (let i = 1; i < polyline.length; i += 1) {
      const previous = polyline[i - 1];
      const current = polyline[i];
      if (previous === undefined || current === undefined) throw new Error('gap');
      expect(current.xPx).toBeGreaterThan(previous.xPx);
    }
  });

  it('bows a constant non-zero skyline upward toward the frame edges', () => {
    // A circle of constant altitude is not a straight line under gnomonic
    // projection: up/depth = tanα/cosΔ grows with |Δ|, so y falls (the line
    // rises) toward the edges. Hand-computed with α = 2°:
    //
    //   Δ = 0°:  y = 0.5 − (tan2°/1)      / 0.8660254 = 0.4596770 → 551.613 px
    //   Δ = 30°: y = 0.5 − (tan2°/cos30°) / 0.8660254 = 0.4534390 → 544.127 px
    //
    // and cos30° happens to equal 2·tan(vFOV/2) here, which is a coincidence of
    // this fixture's numbers, not a relationship.
    const layout = layoutOverlay(scene({ horizon: flatHorizon(2) }), PINNED);
    const polyline = layout.horizonPolylinesPx[0];
    if (polyline === undefined) throw new Error('missing polyline');

    expect(expectedPx(0, 2).yPx).toBeCloseTo(551.6124, 3);
    expect(expectedPx(30, 2).yPx).toBeCloseTo(544.1268, 3);

    // The clipped ends sit exactly on the frame edges, so they are exactly the
    // Δ = ±30° samples.
    const first = polyline[0];
    const last = polyline[polyline.length - 1];
    if (first === undefined || last === undefined) throw new Error('empty polyline');
    expect(first.xPx).toBeCloseTo(0, 9);
    expect(last.xPx).toBeCloseTo(WIDTH_PX, 9);
    expect(first.yPx).toBeCloseTo(544.1268, 3);
    expect(last.yPx).toBeCloseTo(544.1268, 3);

    // The lowest point of the drawn line (largest y) is the Δ = 0 sample. The
    // curve is flat there, so the nearest sample is within a thousandth of a
    // pixel of the exact value.
    const lowestYPx = polyline.reduce((max, point) => Math.max(max, point.yPx), -Infinity);
    expect(lowestYPx).toBeCloseTo(551.6124, 2);
  });

  it('draws nothing when the profile is empty', () => {
    expect(layoutOverlay(scene({ horizon: [] }), PINNED).horizonPolylinesPx).toEqual([]);
  });

  it('draws nothing when the horizon is switched off', () => {
    const layout = layoutOverlay(scene(), { ...PINNED, showHorizon: false });
    expect(layout.horizonPolylinesPx).toEqual([]);
  });

  it('honours the sample count', () => {
    const sparse = layoutOverlay(scene(), { ...PINNED, horizonSampleCount: 8 });
    const dense = layoutOverlay(scene(), { ...PINNED, horizonSampleCount: 400 });
    const sparseLine = sparse.horizonPolylinesPx[0];
    const denseLine = dense.horizonPolylinesPx[0];
    if (sparseLine === undefined || denseLine === undefined) throw new Error('no polyline');
    expect(denseLine.length).toBeGreaterThan(sparseLine.length);
  });
});

describe('resolveOverlayOptions', () => {
  it('scales the defaults with the image height', () => {
    const small = resolveOverlayOptions(scene({ widthPx: 800, heightPx: 600 }));
    const large = resolveOverlayOptions(scene({ widthPx: 3200, heightPx: 2400 }));
    // 0.022 × height, rounded: 13 px at 600, 53 px at 2400.
    expect(small.nameFontPx).toBe(13);
    expect(large.nameFontPx).toBe(53);
    // 0.06 × height: 36 px at 600, 144 px at 2400.
    expect(small.basePoleLengthPx).toBe(36);
    expect(large.basePoleLengthPx).toBe(144);
  });

  it('never drops the name font below the legibility floor', () => {
    expect(resolveOverlayOptions(scene({ widthPx: 160, heightPx: 120 })).nameFontPx).toBe(12);
  });

  it('defaults the stack step to a whole label plus padding', () => {
    const resolved = resolveOverlayOptions(scene(), {
      nameFontPx: 20,
      detailFontPx: 14,
      labelPaddingPx: 4,
    });
    // 47.1 + 4 = 51.1 → 51. A step at least one label high is what guarantees
    // that going up a level clears a same-column neighbour.
    expect(resolved.stackStepPx).toBe(51);
    expect(resolved.stackStepPx).toBeGreaterThanOrEqual(labelBlockHeightPx(20, 14, 4));
  });

  it('leaves explicit options untouched', () => {
    const resolved = resolveOverlayOptions(scene(), PINNED);
    expect(resolved.nameFontPx).toBe(20);
    expect(resolved.basePoleLengthPx).toBe(60);
    expect(resolved.frameMarginPx).toBe(10);
  });
});

describe('formatPeakDetail', () => {
  it('rounds the elevation to a whole metre and the distance to 100 m', () => {
    expect(formatPeakDetail(peak({ id: 'n', name: 'x', elevationM: 4477.6, distanceKm: 12.34 })))
      .toBe('4478 m · 12.3 km');
  });

  it('keeps one decimal even when the distance is whole', () => {
    expect(formatPeakDetail(peak({ id: 'n', name: 'x', elevationM: 1000, distanceKm: 8 }))).toBe(
      '1000 m · 8.0 km',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D8 — obscured (self-occluded) peaks
 * ══════════════════════════════════════════════════════════════════════════ */

describe('layoutOverlay — obscured peaks (D8)', () => {
  it('lays out a self-occluded peak exactly where a visible one would go', () => {
    // The de-emphasis is a STYLE difference, never a position one: the summit
    // is at the same bearing and altitude whether or not its last few metres
    // are behind the hill's own shoulder, so it must land on the same pixel.
    const summit = peak({ id: 'node/1', name: 'Cow Hill', bearingDeg: 90, altitudeDeg: 0 });
    const visible = layoutOverlay(scene({ peaks: [summit] }), PINNED);
    const obscured = layoutOverlay(
      scene({ peaks: [{ ...summit, visibility: 'self-occluded' }] }),
      PINNED,
    );

    expect(obscured.markers).toHaveLength(1);
    expect(obscured.markers[0]?.summitPx).toEqual(visible.markers[0]?.summitPx);
    expect(obscured.markers[0]?.poleTipPx).toEqual(visible.markers[0]?.poleTipPx);
    expect(obscured.markers[0]?.obscured).toBe(true);
    expect(visible.markers[0]?.obscured).toBe(false);
  });

  it('says "obscured" in words, so the distinction is not carried by colour alone', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          {
            ...peak({ id: 'node/1', name: 'Cow Hill', bearingDeg: 90, altitudeDeg: 0 }),
            visibility: 'self-occluded',
          },
        ],
      }),
      PINNED,
    );
    expect(layout.markers[0]?.detailText).toContain('summit obscured');
    // The name itself is left alone: it is what the label is for.
    expect(layout.markers[0]?.nameText).toBe('Cow Hill');
  });

  it('never draws a foreground-occluded peak, and says it dropped it', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Cow Hill', bearingDeg: 90, altitudeDeg: 0 }),
          {
            ...peak({ id: 'node/2', name: 'Ben Nevis', bearingDeg: 92, altitudeDeg: 0 }),
            visibility: 'foreground-occluded',
          },
        ],
      }),
      PINNED,
    );

    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Cow Hill']);
    expect(layout.foregroundOccludedPeaks.map((peak) => peak.name)).toEqual(['Ben Nevis']);
    // Not confused with the off-frame bucket: this one was in frame and refused.
    expect(layout.offFramePeaks).toHaveLength(0);
  });

  it('treats a peak with no stated visibility as visible', () => {
    const layout = layoutOverlay(
      scene({ peaks: [peak({ id: 'node/1', name: 'Matterhorn', bearingDeg: 90, altitudeDeg: 0 })] }),
      PINNED,
    );
    expect(layout.markers[0]?.obscured).toBe(false);
    expect(layout.markers[0]?.detailText).not.toContain('obscured');
  });
});

/**
 * ## Real peak density (Phase 9)
 *
 * ### Why these tests exist
 *
 * The collision code above was designed against handfuls of peaks. The Overture
 * import put 1 786 named summits into the Zermatt region alone, and a measured
 * run from the Gornergrat platform (45.98333 N, 7.78222 E, 3 089 m) at heading
 * 355°, hFOV 65°, on a 1600 × 1200 frame, projected **74** of them inside the
 * frame. The old layout drew all 74: 21 flagged `overlapped`, 24 label boxes
 * genuinely intersecting, poles up to 467 px long in a 1200 px frame. The
 * export was unreadable. See `src/render/README.md` for the full measurement.
 *
 * ### How the expectations below are derived
 *
 * Arithmetic only, from the option values, never from running the layout.
 *
 * **Label width.** Every peak built by the `peak()` helper carries
 * `elevationM: 4478` and `distanceKm: 12.3`, so its detail line is the 16
 * characters `4478 m · 12.3 km`. In the advance-width table of
 * `text-metrics.ts` that is
 *
 *     4·0.556 (digits 4478) + 0.28 (space) + 0.87 (m) + 0.28 (space)
 *   + 0.55 (·) + 0.28 (space) + 2·0.556 (digits 12) + 0.28 (.)
 *   + 0.556 (digit 3) + 0.28 (space) + 0.55 (k) + 0.87 (m)
 *   = 8.132 em
 *
 * → 8.132 × 14 px = **113.848 px**. Every name used below is short enough that
 * the detail line is the wider of the two lines, so with `labelPaddingPx: 4`
 * every reserved box is exactly **121.848 px** wide.
 *
 * **Rows.** A pole at level L is `basePoleLengthPx + L · stackStepPx` long. With
 * `basePoleLengthPx: 60`, `stackStepPx: 51` (PINNED's implied default) and a
 * cap of 200 px, `60 + 51 L ≤ 200` gives L ≤ 2.745, i.e. levels 0, 1, 2 — three
 * rows.
 *
 * **Columns.** The usable width is `1600 − 2 × 10 = 1580` px, and
 * `⌊1580 / 121.848⌋ = 12` (12 boxes span 1462.2 px, 13 would need 1584.0 px).
 *
 * **Packing.** Labels are centred on summits, which sit where the mountains
 * are, so a grid's worth of slots is never fully usable. `LABEL_PACKING_RATIO`
 * allows for that: ⌊0.75 × 12 × 3⌋ = **27**.
 */
describe('layoutOverlay — real peak density', () => {
  /** A row of peaks spread across the frame, altitude rising with the index. */
  function spread(count: number, altitudeStepDeg = 0.05): VisiblePeak[] {
    const peaks: VisiblePeak[] = [];
    for (let index = 0; index < count; index += 1) {
      const deltaDeg = -25 + (50 * index) / (count - 1);
      peaks.push(
        peak({
          id: `node/${String(index)}`,
          name: `P${String(index)}`,
          bearingDeg: 90 + deltaDeg,
          altitudeDeg: 1 + index * altitudeStepDeg,
        }),
      );
    }
    return peaks;
  }

  it('never stands a label further from its summit than the pole budget', () => {
    // Eight peaks within 0.14° of bearing — one column. The budget allows
    // levels 0, 1 and 2 only (60 + 51 L ≤ 200), so no pole may exceed
    // 60 + 2 × 51 = 162 px, and certainly not the 60 + 5 × 51 = 315 px the
    // six-level search would otherwise reach.
    const peaks: VisiblePeak[] = [];
    for (let index = 0; index < 8; index += 1) {
      peaks.push(
        peak({
          id: `node/${String(index)}`,
          name: `P${String(index)}`,
          bearingDeg: 105 + index * 0.02,
          altitudeDeg: 3.7 - index * 0.1,
        }),
      );
    }
    const layout = layoutOverlay(scene({ peaks }), {
      ...PINNED,
      maxPoleLengthPx: 200,
      maxLabels: 8,
    });

    // Three levels up plus three down is six slots for eight peaks, so two are
    // dotted rather than stacked past the budget. Nothing is lost either way.
    expect(layout.markers).toHaveLength(6);
    expect(layout.crowdedOutSummits).toHaveLength(2);
    for (const marker of layout.markers) {
      expect(marker.stackLevel).toBeLessThanOrEqual(2);
      expect(60 + marker.stackLevel * 51).toBeLessThanOrEqual(200);
    }
    // The two that lost are the two lowest in the view, because placement runs
    // highest-first: α 3.7 … 3.0 descending with the index.
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['P6', 'P7']);
  });

  it('derives a label budget from how many boxes the frame holds', () => {
    // ⌊0.75 × 12 columns × 3 rows⌋ = 27, from the arithmetic in this block's
    // header. The peaks are spread evenly, so all 27 place without colliding
    // and the budget is the only thing that decides the count.
    const layout = layoutOverlay(scene({ peaks: spread(40) }), {
      ...PINNED,
      maxPoleLengthPx: 200,
    });

    expect(layout.markers).toHaveLength(27);
    expect(layout.crowdedOutSummits).toHaveLength(13);
    expect(layout.markers.every((marker) => !marker.overlapped)).toBe(true);
  });

  it('accounts for every peak it was given', () => {
    const peaks = [
      ...spread(40),
      // Off frame to the right: Δ = 40° with hFOV 60°.
      peak({ id: 'node/off', name: 'Off', bearingDeg: 130 }),
      {
        ...peak({ id: 'node/hidden', name: 'Hidden', bearingDeg: 88 }),
        visibility: 'foreground-occluded' as const,
      },
    ];
    const layout = layoutOverlay(scene({ peaks }), { ...PINNED, maxPoleLengthPx: 200 });

    expect(
      layout.markers.length +
        layout.crowdedOutSummits.length +
        layout.offFramePeaks.length +
        layout.foregroundOccludedPeaks.length,
    ).toBe(peaks.length);
    expect(layout.offFramePeaks.map((entry) => entry.name)).toEqual(['Off']);
    expect(layout.foregroundOccludedPeaks.map((entry) => entry.name)).toEqual(['Hidden']);
  });

  it('keeps the summits that ride highest in the view, not the first four given', () => {
    // Five well-separated peaks, altitudes 1°…5°, handed over in an order that
    // is neither the priority order nor its reverse. With room for three, the
    // three highest angles survive — the mountains that dominate the frame.
    const peaks = [
      peak({ id: 'node/1', name: 'One', bearingDeg: 70, altitudeDeg: 1 }),
      peak({ id: 'node/5', name: 'Five', bearingDeg: 80, altitudeDeg: 5 }),
      peak({ id: 'node/2', name: 'Two', bearingDeg: 90, altitudeDeg: 2 }),
      peak({ id: 'node/4', name: 'Four', bearingDeg: 100, altitudeDeg: 4 }),
      peak({ id: 'node/3', name: 'Three', bearingDeg: 110, altitudeDeg: 3 }),
    ];
    const layout = layoutOverlay(scene({ peaks }), { ...PINNED, maxLabels: 3 });

    expect(layout.markers.map((marker) => marker.nameText).sort()).toEqual([
      'Five',
      'Four',
      'Three',
    ]);
    // The two that lost are reported by name and in priority order, so a caller
    // can say which summits it could not fit rather than only how many.
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['Two', 'One']);
  });

  it('names a summit the caller asked for, however low it rides', () => {
    // The same five peaks and the same room for three. 'One' rides lowest and
    // loses on every ranking, so asking for it by name is the only way it gets
    // a label — and it must not cost one of the three the budget bought.
    const peaks = [
      peak({ id: 'node/1', name: 'One', bearingDeg: 70, altitudeDeg: 1 }),
      peak({ id: 'node/5', name: 'Five', bearingDeg: 80, altitudeDeg: 5 }),
      peak({ id: 'node/2', name: 'Two', bearingDeg: 90, altitudeDeg: 2 }),
      peak({ id: 'node/4', name: 'Four', bearingDeg: 100, altitudeDeg: 4 }),
      peak({ id: 'node/3', name: 'Three', bearingDeg: 110, altitudeDeg: 3 }),
    ];
    const layout = layoutOverlay(scene({ peaks }), {
      ...PINNED,
      maxLabels: 3,
      alwaysLabelPeakIds: ['node/1'],
    });

    expect(layout.markers.map((marker) => marker.nameText).sort()).toEqual([
      'Five',
      'Four',
      'One',
      'Three',
    ]);
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['Two']);
  });

  it('gives the summit it was asked for first claim on the space around it', () => {
    // Two peaks 4 px apart in bearing terms cannot both hold a level-0 label.
    // The higher one wins by ranking; naming the lower one flips that, and the
    // higher is the one that has to climb.
    const peaks = [
      peak({ id: 'node/high', name: 'High', bearingDeg: 90, altitudeDeg: 5 }),
      peak({ id: 'node/low', name: 'Low', bearingDeg: 90.4, altitudeDeg: 4.9 }),
    ];
    const options: OverlayOptions = { ...PINNED, maxLabels: 8 };
    const ranked = layoutOverlay(scene({ peaks }), options);
    expect(markerNamed(ranked.markers, 'High').stackLevel).toBe(0);
    expect(markerNamed(ranked.markers, 'Low').stackLevel).toBeGreaterThan(0);

    const asked = layoutOverlay(scene({ peaks }), {
      ...options,
      alwaysLabelPeakIds: ['node/low'],
    });
    expect(markerNamed(asked.markers, 'Low').stackLevel).toBe(0);
    expect(markerNamed(asked.markers, 'High').stackLevel).toBeGreaterThan(0);
  });

  it('cannot name a peak D8 refused, whatever the caller asks for', () => {
    const layout = layoutOverlay(
      scene({
        peaks: [
          {
            ...peak({ id: 'node/1', name: 'Ben Nevis', bearingDeg: 90, altitudeDeg: 9 }),
            visibility: 'foreground-occluded' as const,
          },
          peak({ id: 'node/2', name: 'Cow Hill', bearingDeg: 100, altitudeDeg: 1 }),
        ],
      }),
      { ...PINNED, maxLabels: 5, alwaysLabelPeakIds: ['node/1'] },
    );
    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Cow Hill']);
    expect(layout.foregroundOccludedPeaks.map((entry) => entry.name)).toEqual(['Ben Nevis']);
  });

  it('leaves a frame alone when the id it is given is not in it', () => {
    const peaks = spread(40);
    const options: OverlayOptions = { ...PINNED, maxPoleLengthPx: 200 };
    const plain = layoutOverlay(scene({ peaks }), options);
    const named = layoutOverlay(scene({ peaks }), {
      ...options,
      alwaysLabelPeakIds: ['node/not-here'],
    });
    expect(named.markers).toEqual(plain.markers);
    expect(named.crowdedOutSummits).toEqual(plain.crowdedOutSummits);
  });

  it('is still independent of the order the peaks arrive in when the frame is full', () => {
    const peaks = spread(40);
    const options: OverlayOptions = { ...PINNED, maxPoleLengthPx: 200 };
    const forward = layoutOverlay(scene({ peaks }), options);
    const reversed = layoutOverlay(scene({ peaks: [...peaks].reverse() }), options);
    expect(reversed.markers).toEqual(forward.markers);
    expect(reversed.crowdedOutSummits).toEqual(forward.crowdedOutSummits);
  });

  it('ranks a greyed summit by its height, never below the peaks that are clear (D8)', () => {
    // The crowding rule must not become a quiet way of dropping the greyed
    // labels the user asked for. Priority is apparent height and nothing else,
    // so a self-occluded summit riding at 5° outranks visible ones at 1° and 2°.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Low Ridge', bearingDeg: 80, altitudeDeg: 1 }),
          {
            ...peak({ id: 'node/2', name: 'Shoulder', bearingDeg: 90, altitudeDeg: 5 }),
            visibility: 'self-occluded' as const,
          },
          peak({ id: 'node/3', name: 'Knoll', bearingDeg: 100, altitudeDeg: 2 }),
        ],
      }),
      { ...PINNED, maxLabels: 1 },
    );

    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Shoulder']);
    expect(layout.markers[0]?.obscured).toBe(true);
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['Knoll', 'Low Ridge']);
  });

  it('never lets priority resurrect a foreground-occluded summit (D8)', () => {
    // The highest-riding peak in the scene is one that is hidden behind a
    // different hill. Ranking happens after the D8 refusal, so it cannot be
    // ranked back into the picture — not as a label, and not as a dot.
    const layout = layoutOverlay(
      scene({
        peaks: [
          {
            ...peak({ id: 'node/1', name: 'Ben Nevis', bearingDeg: 90, altitudeDeg: 9 }),
            visibility: 'foreground-occluded' as const,
          },
          peak({ id: 'node/2', name: 'Cow Hill', bearingDeg: 100, altitudeDeg: 1 }),
        ],
      }),
      { ...PINNED, maxLabels: 5 },
    );

    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Cow Hill']);
    expect(layout.foregroundOccludedPeaks.map((entry) => entry.name)).toEqual(['Ben Nevis']);
    expect(layout.crowdedOutSummits).toHaveLength(0);
  });

  it('marks a crowded-out summit at its projected position', () => {
    // A dropped name is still a summit that is in the picture, so it keeps its
    // dot. The position is the same closed form the labelled markers use.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Big', bearingDeg: 80, altitudeDeg: 5 }),
          peak({ id: 'node/2', name: 'Small', bearingDeg: 105, altitudeDeg: 3 }),
        ],
      }),
      { ...PINNED, maxLabels: 1 },
    );

    const dropped = layout.crowdedOutSummits[0];
    expect(dropped?.peak.name).toBe('Small');
    expect(dropped?.summitPx.xPx).toBeCloseTo(1171.28129, 4);
    expect(dropped?.summitPx.yPx).toBeCloseTo(524.81995, 4);
    expect(dropped?.obscured).toBe(false);
  });

  it('leaves an uncrowded scene exactly as it was', () => {
    // The budget must not change anything for the frames the renderer already
    // handled: two well-separated peaks stay unstacked and nothing is dropped.
    const layout = layoutOverlay(
      scene({
        peaks: [
          peak({ id: 'node/1', name: 'Left', bearingDeg: 75 }),
          peak({ id: 'node/2', name: 'Right', bearingDeg: 105 }),
        ],
      }),
      PINNED,
    );
    expect(layout.markers.map((marker) => marker.stackLevel)).toEqual([0, 0]);
    expect(layout.crowdedOutSummits).toHaveLength(0);
  });
});

describe('resolveOverlayOptions — crowding', () => {
  it('bounds the pole at 30 % of the frame height', () => {
    // A label further from its dot than that is no longer readable as a label
    // FOR that dot: 0.3 × 1200 = 360 px, 0.3 × 2400 = 720 px.
    expect(resolveOverlayOptions(scene()).maxPoleLengthPx).toBe(360);
    expect(
      resolveOverlayOptions(scene({ widthPx: 3200, heightPx: 2400 })).maxPoleLengthPx,
    ).toBe(720);
  });

  it('never bounds the pole below one base pole length', () => {
    // 0.3 × 120 = 36 px, shorter than the 18 px floor... but on a tiny frame
    // the base pole is 18 px and the cap must still admit level 0.
    const resolved = resolveOverlayOptions(scene({ widthPx: 160, heightPx: 120 }), {
      basePoleLengthPx: 90,
    });
    expect(resolved.maxPoleLengthPx).toBe(90);
  });

  it('leaves the label budget on "auto" unless it is asked for a number', () => {
    expect(resolveOverlayOptions(scene()).maxLabels).toBe('auto');
    expect(resolveOverlayOptions(scene(), { maxLabels: 12 }).maxLabels).toBe(12);
  });
});

/**
 * ## Two ways to lose a name, one rule
 *
 * A summit can fail to get a label either because the frame's budget was spent
 * before its turn came, or because its own neighbourhood was full when it was
 * placed. Both outcomes are the same outcome — a dot, a place in
 * `crowdedOutSummits`, and a line on the image — and the rule does not care
 * which happened or whether the budget was binding at the time. That uniformity
 * is the point: a frame of 20 summits and a frame of 74 obey the same
 * guarantee, so a slightly emptier view cannot come out worse than a fuller one.
 *
 * The fixture: four peaks within 0.15° of bearing, one stack level in each
 * direction, and a budget of three.
 *
 *   • Priority (altitude 3.0 > 2.9 > 2.8 > 2.7) drops Delta before placement.
 *   • Alpha takes level 0 up: 524.820 − 60 − 3 − 47.1 → box 414.72…461.82.
 *   • Bravo's level-0 up box (527.315 − 110.1 → 417.22…464.32) hits Alpha's, so
 *     it hangs below: 527.315 + 60 + 3 → box 590.32…637.42.
 *   • Charlie's two candidates are 419.72…466.82 (hits Alpha) and
 *     592.82…639.92 (hits Bravo). Nothing is free, so Charlie joins the dotted
 *     summits — the same place Delta went, by the other route.
 */
describe('layoutOverlay — summits that lose their name', () => {
  const CROWDED_PEAKS: readonly VisiblePeak[] = [
    peak({ id: 'node/1', name: 'Alpha', bearingDeg: 105.0, altitudeDeg: 3.0 }),
    peak({ id: 'node/2', name: 'Bravo', bearingDeg: 105.05, altitudeDeg: 2.9 }),
    peak({ id: 'node/3', name: 'Charlie', bearingDeg: 105.1, altitudeDeg: 2.8 }),
    peak({ id: 'node/4', name: 'Delta', bearingDeg: 105.15, altitudeDeg: 2.7 }),
  ];

  it('reports a budget loss and a placement loss in the same list', () => {
    const layout = layoutOverlay(scene({ peaks: [...CROWDED_PEAKS] }), {
      ...PINNED,
      maxStackLevels: 1,
      maxLabels: 3,
    });

    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Alpha', 'Bravo']);
    expect(layout.markers.every((marker) => !marker.overlapped)).toBe(true);
    // Charlie lost during placement, Delta before it — reported together, in
    // priority order rather than in the order they happened to lose.
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual([
      'Charlie',
      'Delta',
    ]);
  });

  it('applies the same rule with the budget nowhere near binding', () => {
    // The same three peaks with a budget of 32 that cannot possibly bind. The
    // outcome is identical to the crowded case: Charlie is dotted and counted,
    // never drawn over Bravo. A frame is not allowed to behave one way at 3
    // summits and another at 30.
    const layout = layoutOverlay(scene({ peaks: CROWDED_PEAKS.slice(0, 3) }), {
      ...PINNED,
      maxStackLevels: 1,
      maxLabels: 32,
    });
    expect(layout.markers.map((marker) => marker.nameText)).toEqual(['Alpha', 'Bravo']);
    expect(layout.markers.every((marker) => !marker.overlapped)).toBe(true);
    expect(layout.crowdedOutSummits.map((entry) => entry.peak.name)).toEqual(['Charlie']);
  });

  it('still draws a label when the frame is too small to place one properly', () => {
    // The one surviving use of `overlapped`, and it is not about crowding: a
    // frame so short that NO candidate fits without being clamped. Withholding
    // here would empty the overlay of a scene that has one peak in it, so the
    // marker is drawn at the clamped level-0 placement and flagged.
    const layout = layoutOverlay(
      scene({ widthPx: 400, heightPx: 90, peaks: [peak({ id: 'node/1', name: 'Alpha' })] }),
      PINNED,
    );
    expect(layout.markers).toHaveLength(1);
    expect(layout.markers[0]?.overlapped).toBe(true);
    expect(layout.crowdedOutSummits).toHaveLength(0);
  });
});

describe('marginal peaks (P1.6)', () => {
  it('draws a marginal summit de-emphasised, like an obscured one', () => {
    expect(isPeakObscured({ ...peak({ id: 'm', name: 'x' }), visibility: 'marginal' })).toBe(true);
  });

  it('says "may be hidden", not "summit obscured" — different claim, different words', () => {
    expect(
      formatPeakDetail({
        ...peak({ id: 'm', name: 'x', elevationM: 3600, distanceKm: 11.07 }),
        visibility: 'marginal',
      }),
    ).toBe(`3600 m · 11.1 km · ${MARGINAL_DETAIL_SUFFIX}`);
    expect(MARGINAL_DETAIL_SUFFIX).toBe('may be hidden');
  });
});
