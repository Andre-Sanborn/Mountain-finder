import { describe, expect, it } from 'vitest';

import { anchorChoices, findAnchorChoice } from './anchor-choices';
import type { OverlayLayout, OverlayPeak, PeakMarker, UnlabelledSummit } from '../../render/types';

/**
 * The expectations here are the ordering rule read off the pixel positions by
 * hand: |x − 400| on an 800 px frame, ties by name and then by id. Nothing in
 * this file runs the renderer.
 */
const WIDTH_PX = 800;

function peak(id: string, name: string): OverlayPeak {
  return {
    id,
    name,
    lat: 46,
    lon: 7.5,
    elevationM: 3000,
    elevationSource: 'osm',
    bearingDeg: 90,
    altitudeDeg: 2,
    distanceKm: 12,
    occludingAltitudeDeg: 1,
    clearanceDeg: 1,
  };
}

function marker(id: string, name: string, xPx: number): PeakMarker {
  return {
    peak: peak(id, name),
    summitPx: { xPx, yPx: 200 },
    poleTipPx: { xPx, yPx: 140 },
    labelCentreXPx: xPx,
    nameBaselineYPx: 130,
    detailBaselineYPx: 116,
    labelBoxPx: { xPx: xPx - 40, yPx: 100, widthPx: 80, heightPx: 40 },
    stackLevel: 0,
    direction: 'up',
    overlapped: false,
    obscured: false,
    nameText: name,
    detailText: '3000 m · 12.0 km',
  };
}

function dotted(id: string, name: string, xPx: number): UnlabelledSummit {
  return { peak: peak(id, name), summitPx: { xPx, yPx: 220 }, obscured: false };
}

function layoutOf(
  markers: readonly PeakMarker[],
  crowdedOutSummits: readonly UnlabelledSummit[],
): OverlayLayout {
  return {
    widthPx: WIDTH_PX,
    heightPx: 450,
    horizonPolylinesPx: [],
    markers,
    offFramePeaks: [],
    foregroundOccludedPeaks: [],
    crowdedOutSummits,
    options: {} as OverlayLayout['options'],
  };
}

describe('anchorChoices', () => {
  it('offers a crowded-out summit on the same footing as a labelled one', () => {
    const choices = anchorChoices(
      layoutOf([marker('node/1', 'Named', 700)], [dotted('node/2', 'Dotted', 420)]),
      WIDTH_PX,
    );
    expect(choices.map((choice) => choice.name)).toEqual(['Dotted', 'Named']);
    expect(choices.map((choice) => choice.crowdedOut)).toEqual([true, false]);
  });

  it('puts the summits nearest the middle of the frame first', () => {
    // Distances from x = 400 are 380, 20, 200 and 130, so the order is
    // 420, 530, 780, 20.
    const choices = anchorChoices(
      layoutOf(
        [
          marker('node/a', 'Left Edge', 20),
          marker('node/b', 'Middle', 420),
          marker('node/c', 'Far Right', 600),
        ],
        [dotted('node/d', 'Right Of Middle', 530)],
      ),
      WIDTH_PX,
    );
    expect(choices.map((choice) => choice.name)).toEqual([
      'Middle',
      'Right Of Middle',
      'Far Right',
      'Left Edge',
    ]);
  });

  it('breaks a tie by name and then by id, so the list does not reshuffle', () => {
    // Both 100 px from the middle, one either side.
    const choices = anchorChoices(
      layoutOf(
        [marker('node/z', 'Same Name', 300), marker('node/a', 'Same Name', 500)],
        [dotted('node/m', 'Another', 500)],
      ),
      WIDTH_PX,
    );
    expect(choices.map((choice) => choice.id)).toEqual(['node/m', 'node/a', 'node/z']);
  });

  it('leaves out a summit with no name, because the list is read by name', () => {
    const choices = anchorChoices(
      layoutOf([marker('node/1', '   ', 400)], [dotted('node/2', '', 410)]),
      WIDTH_PX,
    );
    expect(choices).toHaveLength(0);
  });

  it('carries the dot position, which is what the pan reading is measured from', () => {
    const choices = anchorChoices(layoutOf([], [dotted('node/2', 'Dotted', 640)]), WIDTH_PX);
    expect(choices[0]?.summitPx).toEqual({ xPx: 640, yPx: 220 });
  });
});

describe('findAnchorChoice', () => {
  const choices = anchorChoices(
    layoutOf([marker('node/1', 'Named', 700)], [dotted('node/2', 'Dotted', 420)]),
    WIDTH_PX,
  );

  it('finds a choice by id', () => {
    expect(findAnchorChoice(choices, 'node/2')?.name).toBe('Dotted');
  });

  it('answers undefined for no id and for a summit that has left the frame', () => {
    expect(findAnchorChoice(choices, undefined)).toBeUndefined();
    expect(findAnchorChoice(choices, 'node/9')).toBeUndefined();
  });
});
