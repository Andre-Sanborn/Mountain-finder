/**
 * A backdrop for the demo image — and an honest one (archive/v2-docs-20260929/TODO.md Q3).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS AND WHAT IT IS ALLOWED TO CLAIM
 * ═══════════════════════════════════════════════════════════════════════════
 * `npm run demo -- <case>` runs a real viewpoint through the real pipeline and
 * writes `out/annotated.png`. There is no photograph for these viewpoints — the
 * ground-truth case files cite images on Wikimedia Commons but deliberately do
 * not vendor them — so the overlay has to be composited onto something.
 *
 * That something must not look like a photograph. A convincing fake sky with a
 * fake mountain in it, carrying real labels, is exactly the artifact that could
 * be mistaken for a working end-to-end product later, and this project has been
 * burned by plausible-looking output before. So the backdrop is:
 *
 *   • **the run's own terrain silhouette** — the computed skyline, filled to the
 *     bottom of the frame — rather than an invented mountain;
 *   • **flat, hatched and captioned**, so nobody can mistake it for a camera
 *     image at a glance;
 *   • **absent where the horizon is absent.** No skyline computed, no
 *     silhouette drawn. The backdrop never fills in for missing terrain.
 *
 * ── WHAT THE PICTURE THEREFORE PROVES, AND WHAT IT DOES NOT ────────────────
 * The silhouette and the overlay's horizon line come from the SAME horizon
 * profile, so their agreement is TAUTOLOGICAL and proves nothing. Say it out
 * loud; do not let a reader infer registration from it.
 *
 * What the picture does prove is independent: the peak markers are computed
 * from the peak database and the camera projection, with no reference to the
 * terrain sweep at all. A summit dot landing on its own bump in the SRTM
 * silhouette is two separate computations agreeing — and a dot floating over a
 * valley would be a real, visible failure.
 */

import type { PointPx } from './types';
import { attributes, escapeXml, formatCoordinate } from './xml';

/** Stamped on every backdrop. Non-negotiable — see the module docs. */
export const SYNTHETIC_BACKDROP_CAPTION =
  'SYNTHETIC BACKDROP — computed SRTM terrain silhouette, not a photograph';

export interface SyntheticBackdropInput {
  widthPx: number;
  heightPx: number;
  /** The layout's `horizonPolylinesPx` — pixel space, already clipped. */
  ridgePolylinesPx: readonly (readonly PointPx[])[];
  /** Case-specific second line: viewpoint, terrain provenance, framing. */
  caption: string;
}

const SKY_TOP = '#12263a';
const SKY_HORIZON = '#5c7f9e';
const ROCK = '#20262b';
const HATCH = '#7f8c99';

function points(list: readonly PointPx[]): string {
  return list.map((p) => `${formatCoordinate(p.xPx)},${formatCoordinate(p.yPx)}`).join(' ');
}

/**
 * One skyline segment, closed into a filled silhouette.
 *
 * Closing happens at the segment's OWN end columns, not at the frame edges, so
 * a horizon that leaves and re-enters the frame leaves a gap in the silhouette
 * — which is the truth about the data, and visible as such.
 */
function silhouette(line: readonly PointPx[], heightPx: number): string | undefined {
  if (line.length < 2) return undefined;
  const first = line[0];
  const last = line[line.length - 1];
  if (first === undefined || last === undefined) return undefined;
  const closed = [
    ...line,
    { xPx: last.xPx, yPx: heightPx },
    { xPx: first.xPx, yPx: heightPx },
  ];
  return `<polygon${attributes({ points: points(closed), fill: ROCK })}/>`;
}

/** Build the backdrop as a standalone SVG document. Pure: string in, string out. */
export function buildSyntheticBackdropSvg(input: SyntheticBackdropInput): string {
  const { widthPx, heightPx } = input;
  const captionFontPx = Math.max(11, Math.round(heightPx * 0.018));
  const lines: string[] = [];

  lines.push(
    `<svg${attributes({
      xmlns: 'http://www.w3.org/2000/svg',
      width: widthPx,
      height: heightPx,
      viewBox: `0 0 ${formatCoordinate(widthPx)} ${formatCoordinate(heightPx)}`,
    })}>`,
    '<defs>',
    '<linearGradient id="mf-sky" x1="0" y1="0" x2="0" y2="1">',
    `<stop offset="0" stop-color="${SKY_TOP}"/>`,
    `<stop offset="1" stop-color="${SKY_HORIZON}"/>`,
    '</linearGradient>',
    '<pattern id="mf-synthetic-hatch" width="24" height="24" patternUnits="userSpaceOnUse"' +
      ' patternTransform="rotate(45)">',
    `<line x1="0" y1="0" x2="0" y2="24" stroke="${HATCH}" stroke-width="2" stroke-opacity="0.10"/>`,
    '</pattern>',
    '</defs>',
    `<rect${attributes({ x: 0, y: 0, width: widthPx, height: heightPx, fill: 'url(#mf-sky)' })}/>`,
  );

  for (const line of input.ridgePolylinesPx) {
    const polygon = silhouette(line, heightPx);
    if (polygon !== undefined) lines.push(polygon);
  }

  // The hatch goes over everything, including the terrain: it is a watermark on
  // the whole backdrop, not a texture on the rock.
  lines.push(
    `<rect${attributes({
      x: 0,
      y: 0,
      width: widthPx,
      height: heightPx,
      fill: 'url(#mf-synthetic-hatch)',
    })}/>`,
  );

  const captionY = heightPx - captionFontPx * 1.6;
  lines.push(
    `<text${attributes({
      x: captionFontPx,
      y: captionY,
      'font-family': 'Helvetica Neue, Helvetica, Arial, sans-serif',
      'font-size': captionFontPx,
      'font-weight': '700',
      fill: '#ffffff',
      stroke: '#000000',
      'stroke-opacity': 0.7,
      'stroke-width': formatCoordinate(Math.max(2, captionFontPx * 0.18)),
      'paint-order': 'stroke',
    })}>${escapeXml(SYNTHETIC_BACKDROP_CAPTION)}</text>`,
    `<text${attributes({
      x: captionFontPx,
      y: captionY + captionFontPx * 1.35,
      'font-family': 'Helvetica Neue, Helvetica, Arial, sans-serif',
      'font-size': captionFontPx * 0.85,
      fill: '#e8eef4',
      stroke: '#000000',
      'stroke-opacity': 0.7,
      'stroke-width': formatCoordinate(Math.max(2, captionFontPx * 0.15)),
      'paint-order': 'stroke',
    })}>${escapeXml(input.caption)}</text>`,
    '</svg>',
  );

  return lines.join('');
}
