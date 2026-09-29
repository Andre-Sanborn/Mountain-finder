/**
 * The demo's stand-in for a photograph (archive/v2-docs-20260929/TODO.md Q3).
 *
 * Expectations are structural and hand-written: a 400 × 300 frame with one
 * two-point ridge at y = 120 must close its silhouette down the frame, i.e.
 * the polygon runs (0,120) → (400,120) → (400,300) → (0,300).
 */

import { describe, expect, it } from 'vitest';

import { buildSyntheticBackdropSvg, SYNTHETIC_BACKDROP_CAPTION } from './synthetic-backdrop';

const RIDGE = [
  [
    { xPx: 0, yPx: 120 },
    { xPx: 400, yPx: 120 },
  ],
];

describe('buildSyntheticBackdropSvg', () => {
  const svg = buildSyntheticBackdropSvg({
    widthPx: 400,
    heightPx: 300,
    ridgePolylinesPx: RIDGE,
    caption: 'Gornergrat — synthetic',
  });

  it('is an SVG document at the frame size', () => {
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg.endsWith('</svg>')).toBe(true);
  });

  it('closes the terrain silhouette down to the bottom of the frame', () => {
    expect(svg).toContain('0,120 400,120 400,300 0,300');
  });

  it('says on the image itself that it is not a photograph', () => {
    // The single most important property of this module: whatever else it
    // draws, an artifact produced from it can never be mistaken for a photo.
    expect(svg).toContain(SYNTHETIC_BACKDROP_CAPTION);
    expect(SYNTHETIC_BACKDROP_CAPTION.toLowerCase()).toContain('not a photograph');
    expect(svg).toContain('Gornergrat — synthetic');
  });

  it('escapes a caption rather than letting it break the document', () => {
    const escaped = buildSyntheticBackdropSvg({
      widthPx: 400,
      heightPx: 300,
      ridgePolylinesPx: RIDGE,
      caption: 'a & b <c>',
    });
    expect(escaped).toContain('a &amp; b &lt;c&gt;');
    expect(escaped).not.toContain('<c>');
  });

  it('still produces a frame when the run found no skyline at all', () => {
    const empty = buildSyntheticBackdropSvg({
      widthPx: 400,
      heightPx: 300,
      ridgePolylinesPx: [],
      caption: 'no horizon',
    });
    expect(empty).toContain('viewBox="0 0 400 300"');
    // No terrain was computed, so no terrain is drawn — the backdrop must not
    // invent a ridge to make the picture look finished.
    expect(empty).not.toContain('<polygon');
  });

  it('draws one silhouette per polyline, so a clipped skyline stays clipped', () => {
    const split = buildSyntheticBackdropSvg({
      widthPx: 400,
      heightPx: 300,
      ridgePolylinesPx: [
        [
          { xPx: 0, yPx: 100 },
          { xPx: 100, yPx: 100 },
        ],
        [
          { xPx: 300, yPx: 200 },
          { xPx: 400, yPx: 200 },
        ],
      ],
      caption: 'two segments',
    });
    expect(split.match(/<polygon/g)).toHaveLength(2);
  });
});
