/**
 * Build the annotator's topographic map — the second half of `frame-and-map`.
 *
 *   npm run annotator:map -- bogus-basin
 *   npm run annotator:map -- bogus-basin --out out/somewhere-else
 *
 * docs/FIELD-TEST-PREREGISTRATION.md § 2.0 registers two truth methods. The
 * `frame-and-map` annotator is given the captured frame, the candidate summits
 * by id, name and published height, and **the viewpoint plus a topographic
 * map**. This script draws that map, and nothing else.
 *
 * ── WHAT IT MUST NOT CONTAIN, AND WHY ──────────────────────────────────────
 * No camera heading. No field-of-view wedge. No pose. No overlay, no drawn
 * label position, no projection the app would use. § 2.0: "Neither annotator
 * ever sees the app's projection, the overlay as drawn, the pose, or the
 * other's picks." A map that carried any of those would hand the annotator the
 * app's answer, and the truth it produced would be a copy rather than a
 * measurement.
 *
 * That is a property of the inputs rather than a promise. The only things read
 * here are the site definition, the site package's terrain mosaic, and the peak
 * region. No capture, no bundle, no pose solution, and nothing under
 * `src/app/` or `src/live/` is opened.
 *
 * What the map is allowed to say is what a person standing there would know:
 * where they are, which way north is, what the ground does, and which named
 * summits lie in which direction at what range. That is the knowledge § 2.0
 * calls "what ought to be on the skyline and in what order".
 *
 * ── WHAT IT DRAWS ──────────────────────────────────────────────────────────
 * Two images per site, north up, each about 2400 px square:
 *
 *   <site>-map-<sweep>km.{svg,png}  the whole sweep disc
 *   <site>-map-10km.{svg,png}       the near band, where summits crowd together
 *
 * Both carry a hillshade of the site package's own mosaic, contour lines,
 * range rings, bearing ticks every 10° with north marked, the viewpoint, and
 * every named summit in the peak region that falls on the sheet, labelled with
 * its name and its published height.
 *
 * ── HOW IT GETS A PNG WITHOUT A NEW DEPENDENCY ─────────────────────────────
 * The repository has no PNG encoder and no 2D canvas. Two pieces fill the gap,
 * both already here:
 *
 * 1. The hillshade is an 8-bit greyscale raster, and `encodeGreyscalePng`
 *    writes one with `node:zlib` alone — a PNG is a CRC-32 framing around a
 *    deflate stream, which is about sixty lines.
 * 2. Everything vector — contours, rings, ticks, markers, text — is authored as
 *    SVG with the hillshade embedded as a data URI, and rasterised by the
 *    Playwright Chromium the container already holds. A browser is the one
 *    text layout engine available, and legible labels are the point.
 *
 * The `.svg` is kept beside the `.png`: it is self-contained, it is what the
 * `.png` was rendered from, and it is the copy worth re-rendering larger.
 *
 * ── THE PROJECTION ─────────────────────────────────────────────────────────
 * Pixels are a local equirectangular plane centred on the viewpoint: northing
 * and easting in metres, easting scaled by `cos(centre latitude)`. It is the
 * projection the terrain grid is already in, so the hillshade resamples with an
 * affine map and no interpolation error of its own.
 *
 * It is not equal-area and not conformal, and over a 121 km sheet the
 * east-west scale drifts by about 1 % between the north and south edges. So
 * every ring and every bearing tick is plotted by running `destinationPoint`
 * from the viewpoint and projecting the result, rather than by drawing a circle
 * of radius r. The rings then carry the same geodesy the sweep walks, and their
 * departure from circles is the projection telling the truth about itself.
 *
 * ACQUISITION-TIME TOOL. It reads local files and writes to a gitignored
 * directory. It never touches the network.
 */

import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { EARTH_RADIUS_M, destinationPoint, haversineDistanceM, toRadians } from '../src/core/geodesy.js';
import type { LatLng, Peak } from '../src/core/types.js';
import { parseGridWindow, type GridGeometry } from '../src/providers/hgt-tile.js';
import { loadPeakCellIndex } from '../src/providers/peak-directory.js';
import { parseTerrainManifest } from '../src/providers/terrain-manifest.js';
import {
  SITE_DEFINITION_DIR,
  SITE_PACKAGE_DIR,
  parseSiteDefinition,
  type SiteDefinition,
} from '../src/sites/site-package.js';

/** Where the maps land. Gitignored; a pair of sheets is tens of megabytes. */
export const ANNOTATOR_MAP_DIR = 'out/annotator-map';

// ───────────────────────────────────────────────────────────────────────────
// The projection
// ───────────────────────────────────────────────────────────────────────────

/**
 * A local equirectangular plane, north up, centred on a viewpoint.
 *
 * `latDegPerPx` and `lonDegPerPx` are constants rather than functions of
 * position, which is what makes the raster resample affine.
 */
export interface MapProjection {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly centre: LatLng;
  readonly metresPerPx: number;
  readonly latDegPerPx: number;
  readonly lonDegPerPx: number;
}

export interface MapPixel {
  readonly x: number;
  readonly y: number;
}

/**
 * A square sheet reaching `halfWidthKm` north, south, east and west of centre.
 *
 * The east-west scale is fixed at the centre latitude. A point one pixel east
 * of centre is therefore `metresPerPx` of ground away, and a point one pixel
 * east of the north edge is about 1 % less than that at this sheet's size.
 */
export function planMapProjection(
  centre: LatLng,
  halfWidthKm: number,
  sizePx: number,
): MapProjection {
  if (!(halfWidthKm > 0)) throw new Error(`halfWidthKm must be positive, got ${halfWidthKm}`);
  if (!Number.isInteger(sizePx) || sizePx < 2) {
    throw new Error(`sizePx must be an integer of at least 2, got ${sizePx}`);
  }
  const metresPerPx = (halfWidthKm * 2000) / sizePx;
  const latDegPerPx = (metresPerPx / EARTH_RADIUS_M) * (180 / Math.PI);
  const cosLat = Math.cos(toRadians(centre.lat));
  if (!(Math.abs(cosLat) > 1e-9)) {
    throw new Error('A pole has no east-west scale; this map is not for polar sites.');
  }
  return {
    widthPx: sizePx,
    heightPx: sizePx,
    centre,
    metresPerPx,
    latDegPerPx,
    lonDegPerPx: latDegPerPx / cosLat,
  };
}

/** Where a coordinate falls on the sheet. The sheet's centre is (w/2, h/2). */
export function projectLatLng(projection: MapProjection, point: LatLng): MapPixel {
  return {
    x: projection.widthPx / 2 + (point.lon - projection.centre.lon) / projection.lonDegPerPx,
    y: projection.heightPx / 2 - (point.lat - projection.centre.lat) / projection.latDegPerPx,
  };
}

/** The inverse of `projectLatLng`, exact. */
export function unprojectPixel(projection: MapProjection, x: number, y: number): LatLng {
  return {
    lat: projection.centre.lat - (y - projection.heightPx / 2) * projection.latDegPerPx,
    lon: projection.centre.lon + (x - projection.widthPx / 2) * projection.lonDegPerPx,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// The elevation field
// ───────────────────────────────────────────────────────────────────────────

/** An elevation at a coordinate, or `null` where the source has none. */
export type ElevationSampler = (lat: number, lon: number) => number | null;

/**
 * Ground distance between two postings of a grid, north to south, in metres.
 *
 * North-south rather than east-west because that spacing is the same
 * everywhere, while a degree of longitude shrinks toward the pole. It answers
 * one question: whether a sheet's pixel is finer or coarser than the data.
 */
export function postingMetres(geometry: GridGeometry): number {
  return toRadians(geometry.latStepDeg) * EARTH_RADIUS_M;
}

/**
 * Resample an elevation source onto the sheet, one value per pixel centre.
 *
 * `NaN` marks a pixel the source cannot answer for. Every consumer below
 * propagates it rather than substituting a height, because an invented sea-level
 * pixel draws a coastline that is not there.
 */
export function sampleElevationField(
  projection: MapProjection,
  sampler: ElevationSampler,
): Float64Array {
  const field = new Float64Array(projection.widthPx * projection.heightPx);
  for (let row = 0; row < projection.heightPx; row += 1) {
    for (let col = 0; col < projection.widthPx; col += 1) {
      const point = unprojectPixel(projection, col + 0.5, row + 0.5);
      const value = sampler(point.lat, point.lon);
      field[row * projection.widthPx + col] = value === null ? Number.NaN : value;
    }
  }
  return field;
}

/**
 * Shrink a field by averaging `step × step` blocks, ignoring `NaN`.
 *
 * Contours are traced from a decimated field rather than the full raster. At
 * 50 m per pixel the mosaic's own 30 m posting noise crosses a contour level
 * repeatedly along a gentle slope, which yields thousands of one-cell squiggles
 * that are not landforms. Averaging first is a low-pass filter with an honest
 * name.
 */
export function decimateField(
  field: Float64Array,
  cols: number,
  rows: number,
  step: number,
): { readonly field: Float64Array; readonly cols: number; readonly rows: number } {
  if (!Number.isInteger(step) || step < 1) throw new Error(`step must be >= 1, got ${step}`);
  const outCols = Math.floor(cols / step);
  const outRows = Math.floor(rows / step);
  if (outCols < 2 || outRows < 2) {
    throw new Error(`decimating ${cols}x${rows} by ${step} leaves ${outCols}x${outRows}`);
  }
  const out = new Float64Array(outCols * outRows);
  for (let outRow = 0; outRow < outRows; outRow += 1) {
    for (let outCol = 0; outCol < outCols; outCol += 1) {
      let total = 0;
      let count = 0;
      for (let dy = 0; dy < step; dy += 1) {
        for (let dx = 0; dx < step; dx += 1) {
          const value = field[(outRow * step + dy) * cols + (outCol * step + dx)] ?? Number.NaN;
          if (!Number.isNaN(value)) {
            total += value;
            count += 1;
          }
        }
      }
      out[outRow * outCols + outCol] = count === 0 ? Number.NaN : total / count;
    }
  }
  return { field: out, cols: outCols, rows: outRows };
}

// ───────────────────────────────────────────────────────────────────────────
// Hillshade
// ───────────────────────────────────────────────────────────────────────────

/** What a hillshade pixel holds where the field has no elevation. */
export const NO_DATA_SHADE = 0;

export interface HillshadeOptions {
  /** Ground size of one pixel, in metres. */
  readonly cellSizeM: number;
  /** Sun bearing, degrees clockwise from north. Cartography's default is 315. */
  readonly azimuthDeg?: number;
  /** Sun height above the horizon, in degrees. */
  readonly altitudeDeg?: number;
  /** Vertical exaggeration applied to both gradients. */
  readonly zFactor?: number;
}

/**
 * Lambertian shading of a height field, 0 (black) to 255 (facing the sun).
 *
 * The gradients are Horn's 3 × 3 weighted differences, in ground axes: `gE` is
 * `dz/dEast`, `gN` is `dz/dNorth`. The unnormalised surface normal is then
 * `(−gE, −gN, 1)`, the unit vector toward the sun is
 * `(sin A cos α, cos A cos α, sin α)`, and the shade is their dot product with
 * the normal normalised — the usual hillshade written as the geometry it is,
 * rather than as an aspect-minus-azimuth cosine.
 *
 * Edges replicate: a 3 × 3 window at the border clamps its indices, so a flat
 * field shades uniformly all the way to the rim instead of ringing.
 *
 * Any `NaN` in the window yields `NO_DATA_SHADE`, never a shade computed from a
 * substituted height.
 */
export function hillshade(
  field: Float64Array,
  cols: number,
  rows: number,
  options: HillshadeOptions,
): Uint8Array {
  const { cellSizeM } = options;
  if (!(cellSizeM > 0)) throw new Error(`cellSizeM must be positive, got ${cellSizeM}`);
  const azimuthDeg = options.azimuthDeg ?? 315;
  const altitudeDeg = options.altitudeDeg ?? 45;
  const zFactor = options.zFactor ?? 1;

  const cosAlt = Math.cos(toRadians(altitudeDeg));
  const sunEast = Math.sin(toRadians(azimuthDeg)) * cosAlt;
  const sunNorth = Math.cos(toRadians(azimuthDeg)) * cosAlt;
  const sunUp = Math.sin(toRadians(altitudeDeg));

  const out = new Uint8Array(cols * rows);
  const clampRow = (row: number): number => (row < 0 ? 0 : row >= rows ? rows - 1 : row);
  const clampCol = (col: number): number => (col < 0 ? 0 : col >= cols ? cols - 1 : col);

  for (let row = 0; row < rows; row += 1) {
    const north = clampRow(row - 1) * cols;
    const middle = row * cols;
    const south = clampRow(row + 1) * cols;
    for (let col = 0; col < cols; col += 1) {
      const west = clampCol(col - 1);
      const east = clampCol(col + 1);
      const a = field[north + west] ?? Number.NaN;
      const b = field[north + col] ?? Number.NaN;
      const c = field[north + east] ?? Number.NaN;
      const d = field[middle + west] ?? Number.NaN;
      const f = field[middle + east] ?? Number.NaN;
      const g = field[south + west] ?? Number.NaN;
      const h = field[south + col] ?? Number.NaN;
      const i = field[south + east] ?? Number.NaN;

      const gradEast = (zFactor * (c + 2 * f + i - (a + 2 * d + g))) / (8 * cellSizeM);
      const gradNorth = (zFactor * (a + 2 * b + c - (g + 2 * h + i))) / (8 * cellSizeM);
      if (Number.isNaN(gradEast) || Number.isNaN(gradNorth)) {
        out[middle + col] = NO_DATA_SHADE;
        continue;
      }
      const norm = Math.sqrt(gradEast * gradEast + gradNorth * gradNorth + 1);
      const dot = (-gradEast * sunEast - gradNorth * sunNorth + sunUp) / norm;
      out[middle + col] = dot <= 0 ? 0 : Math.min(255, Math.round(dot * 255));
    }
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// Contours
// ───────────────────────────────────────────────────────────────────────────

/** A contour crossing, in field cell coordinates: x is a column, y is a row. */
export interface ContourSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/** Intervals a contour map is allowed to use, in metres. */
const CONTOUR_INTERVALS_M: readonly number[] = [10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * The coarsest interval that still draws at least `minLines` contours.
 *
 * Picking by count rather than by relief keeps a 300 m sheet and a 2 000 m
 * sheet equally readable. The list is the ordinary cartographic ladder, so the
 * legend always states a round number.
 */
export function chooseContourIntervalM(reliefM: number, minLines = 12): number {
  for (let index = CONTOUR_INTERVALS_M.length - 1; index >= 0; index -= 1) {
    const interval = CONTOUR_INTERVALS_M[index] ?? 0;
    if (interval > 0 && reliefM / interval >= minLines) return interval;
  }
  return CONTOUR_INTERVALS_M[0] ?? 10;
}

/**
 * Marching squares at one level, one segment per crossed cell.
 *
 * A cell's corners are `(col, row)`, `(col+1, row)`, `(col+1, row+1)`,
 * `(col, row+1)`, and a corner counts as inside when it is strictly above the
 * level. A cell with any `NaN` corner is skipped: a contour drawn against a
 * missing height is a coastline the data never claimed.
 *
 * The two ambiguous cases are resolved by the cell's own mean, which is the
 * standard rule and the only one that keeps neighbouring cells consistent.
 */
export function contourSegments(
  field: Float64Array,
  cols: number,
  rows: number,
  level: number,
): ContourSegment[] {
  const segments: ContourSegment[] = [];
  const cross = (low: number, high: number): number => (level - low) / (high - low);

  for (let row = 0; row + 1 < rows; row += 1) {
    for (let col = 0; col + 1 < cols; col += 1) {
      const tl = field[row * cols + col] ?? Number.NaN;
      const tr = field[row * cols + col + 1] ?? Number.NaN;
      const br = field[(row + 1) * cols + col + 1] ?? Number.NaN;
      const bl = field[(row + 1) * cols + col] ?? Number.NaN;
      if (Number.isNaN(tl) || Number.isNaN(tr) || Number.isNaN(br) || Number.isNaN(bl)) continue;

      const mask =
        (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (mask === 0 || mask === 15) continue;

      const top = { x: col + cross(tl, tr), y: row };
      const right = { x: col + 1, y: row + cross(tr, br) };
      const bottom = { x: col + cross(bl, br), y: row + 1 };
      const left = { x: col, y: row + cross(tl, bl) };
      const push = (from: MapPixel, to: MapPixel): void => {
        segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
      };

      switch (mask) {
        case 1: push(left, bottom); break;
        case 2: push(bottom, right); break;
        case 3: push(left, right); break;
        case 4: push(top, right); break;
        case 5:
          if ((tl + tr + br + bl) / 4 > level) {
            push(left, top);
            push(bottom, right);
          } else {
            push(left, bottom);
            push(top, right);
          }
          break;
        case 6: push(top, bottom); break;
        case 7: push(left, top); break;
        case 8: push(top, left); break;
        case 9: push(top, bottom); break;
        case 10:
          if ((tl + tr + br + bl) / 4 > level) {
            push(top, right);
            push(left, bottom);
          } else {
            push(left, top);
            push(bottom, right);
          }
          break;
        case 11: push(top, right); break;
        case 12: push(left, right); break;
        case 13: push(bottom, right); break;
        case 14: push(left, bottom); break;
        default: break;
      }
    }
  }
  return segments;
}

/** A stitched contour: `[x0, y0, x1, y1, …]` in field cell coordinates. */
export type Polyline = readonly number[];

/** Round an endpoint to a key, so two cells' shared crossing is one vertex. */
function endpointKey(x: number, y: number): string {
  return `${Math.round(x * 4096)},${Math.round(y * 4096)}`;
}

/**
 * Join segments that share an endpoint into polylines.
 *
 * Marching squares emits one segment per cell, and an SVG holding a quarter of
 * a million two-point paths is neither small nor fast to render. Chaining them
 * first cuts the element count by roughly the average contour length.
 *
 * Each endpoint belongs to at most two segments on a clean grid, so a greedy
 * walk out of both ends of a seed segment recovers the whole line. Where a
 * saddle puts more than two on one vertex the walk takes whichever is still
 * unused, which splits that contour into pieces rather than mis-joining it.
 */
export function stitchSegments(segments: readonly ContourSegment[]): Polyline[] {
  const byEndpoint = new Map<string, number[]>();
  const add = (key: string, index: number): void => {
    const list = byEndpoint.get(key);
    if (list === undefined) byEndpoint.set(key, [index]);
    else list.push(index);
  };
  segments.forEach((segment, index) => {
    add(endpointKey(segment.x1, segment.y1), index);
    add(endpointKey(segment.x2, segment.y2), index);
  });

  const used = new Uint8Array(segments.length);
  /** The far end of an unused segment at `key`, consuming it. */
  const takeFrom = (key: string): MapPixel | null => {
    for (const index of byEndpoint.get(key) ?? []) {
      if (used[index] === 1) continue;
      const segment = segments[index];
      if (segment === undefined) continue;
      used[index] = 1;
      return endpointKey(segment.x1, segment.y1) === key
        ? { x: segment.x2, y: segment.y2 }
        : { x: segment.x1, y: segment.y1 };
    }
    return null;
  };

  const polylines: Polyline[] = [];
  for (let seed = 0; seed < segments.length; seed += 1) {
    if (used[seed] === 1) continue;
    const segment = segments[seed];
    if (segment === undefined) continue;
    used[seed] = 1;

    const points: MapPixel[] = [
      { x: segment.x1, y: segment.y1 },
      { x: segment.x2, y: segment.y2 },
    ];
    for (;;) {
      const tail = points[points.length - 1];
      if (tail === undefined) break;
      const next = takeFrom(endpointKey(tail.x, tail.y));
      if (next === null) break;
      points.push(next);
    }
    for (;;) {
      const head = points[0];
      if (head === undefined) break;
      const previous = takeFrom(endpointKey(head.x, head.y));
      if (previous === null) break;
      points.unshift(previous);
    }
    polylines.push(points.flatMap((point) => [point.x, point.y]));
  }
  return polylines;
}

// ───────────────────────────────────────────────────────────────────────────
// Label placement
// ───────────────────────────────────────────────────────────────────────────

export interface LabelCandidate {
  /** Offset of the text's anchor point from the marker, in pixels. */
  readonly dx: number;
  readonly dy: number;
  /** SVG `text-anchor`: the text runs right from the point, or left to it. */
  readonly textAnchor: 'start' | 'end';
}

export interface LabelRequest {
  readonly id: string;
  readonly at: MapPixel;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Higher wins a contested spot. Ties break on id, so the result is stable. */
  readonly priority: number;
}

export interface LabelRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface LabelPlacement {
  readonly id: string;
  /** Where the text's anchor point goes; the baseline is centred on it. */
  readonly at: MapPixel;
  readonly textAnchor: 'start' | 'end';
  readonly rect: LabelRect;
  /** False when every candidate collided and the first was used anyway. */
  readonly placed: boolean;
}

/** The box a candidate would occupy. Text is vertically centred on the point. */
export function labelRect(
  request: LabelRequest,
  candidate: LabelCandidate,
): LabelRect {
  const x = request.at.x + candidate.dx;
  const y = request.at.y + candidate.dy;
  const left = candidate.textAnchor === 'start' ? x : x - request.widthPx;
  const top = y - request.heightPx / 2;
  return { left, top, right: left + request.widthPx, bottom: top + request.heightPx };
}

function overlaps(a: LabelRect, b: LabelRect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function inside(rect: LabelRect, bounds: LabelRect): boolean {
  return (
    rect.left >= bounds.left &&
    rect.right <= bounds.right &&
    rect.top >= bounds.top &&
    rect.bottom <= bounds.bottom
  );
}

/**
 * Greedy label placement: highest priority first, first free candidate wins.
 *
 * `reserved` holds the boxes labels must dodge but never occupy — the summit
 * markers themselves, and the viewpoint. A request whose every candidate
 * collides is still placed, at its first candidate, and reported `placed:
 * false`. Dropping the name would be worse: an annotator resolving a summit by
 * id needs every name on the sheet, and a caller that wants the crowding
 * counted has the flag.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  candidates: readonly LabelCandidate[],
  bounds: LabelRect,
  reserved: readonly LabelRect[] = [],
): LabelPlacement[] {
  const first = candidates[0];
  if (first === undefined) throw new Error('placeLabels needs at least one candidate');

  const order = [...requests].sort(
    (a, b) => b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const taken: LabelRect[] = [...reserved];
  const placements: LabelPlacement[] = [];

  for (const request of order) {
    let chosen: { candidate: LabelCandidate; rect: LabelRect } | null = null;
    for (const candidate of candidates) {
      const rect = labelRect(request, candidate);
      if (!inside(rect, bounds)) continue;
      if (taken.some((other) => overlaps(rect, other))) continue;
      chosen = { candidate, rect };
      break;
    }
    const candidate = chosen?.candidate ?? first;
    const rect = chosen?.rect ?? labelRect(request, first);
    taken.push(rect);
    placements.push({
      id: request.id,
      at: { x: request.at.x + candidate.dx, y: request.at.y + candidate.dy },
      textAnchor: candidate.textAnchor,
      rect,
      placed: chosen !== null,
    });
  }
  return placements;
}

// ───────────────────────────────────────────────────────────────────────────
// PNG
// ───────────────────────────────────────────────────────────────────────────

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  for (let index = 0; index < 4; index += 1) body[index] = type.charCodeAt(index);
  body.set(data, 4);
  const out = new Uint8Array(body.length + 8);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(body, 4);
  view.setUint32(out.length - 4, crc32(body));
  return out;
}

/**
 * An 8-bit greyscale PNG, colour type 0, every scanline filtered "none".
 *
 * Filter 0 throughout because the payload is a hillshade: neighbouring pixels
 * differ by the terrain's own noise, so a Sub or Paeth filter costs a pass over
 * five million bytes and saves little. The deflate stream is what compresses it.
 */
export function encodeGreyscalePng(
  pixels: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  if (pixels.length !== width * height) {
    throw new Error(`${width}x${height} needs ${width * height} pixels, got ${pixels.length}`);
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 0; // colour type: greyscale
  header[10] = 0; // compression: deflate
  header[11] = 0; // filter method: adaptive
  header[12] = 0; // interlace: none

  const raw = new Uint8Array((width + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (width + 1)] = 0;
    raw.set(pixels.subarray(row * width, (row + 1) * width), row * (width + 1) + 1);
  }

  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const parts = [
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', new Uint8Array(deflateSync(raw, { level: 6 }))),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// ───────────────────────────────────────────────────────────────────────────
// The sheet
// ───────────────────────────────────────────────────────────────────────────

/** How a hillshade byte becomes paper ink: light enough to draw on top of. */
function shadeToPaper(shade: number): number {
  return Math.round(92 + shade * 0.62);
}

/** Room around the map for the title and the legend. */
const HEADER_PX = 170;
const FOOTER_PX = 190;
const GUTTER_PX = 8;

const LABEL_FONT_PX = 17;
const LABEL_LINE_PX = 21;
/** DejaVu Sans is about 0.56 em wide per character at this size, averaged. */
const LABEL_CHAR_PX = LABEL_FONT_PX * 0.56;

const MARKER_PX = 9;

/**
 * Vertical exaggeration in the hillshade.
 *
 * A reading aid, and stated on every sheet because it is a lie about the
 * gradient. At 1 the Boise Front's 15° slopes shade within a few percent of
 * each other and the ridge lines an annotator is trying to count disappear. No
 * number on the map is derived from the shading, so the exaggeration costs
 * nothing measurable and buys the relief a person needs to match a skyline.
 */
const HILLSHADE_Z_FACTOR = 1.5;

const LABEL_CANDIDATES: readonly LabelCandidate[] = [
  { dx: MARKER_PX + 5, dy: 0, textAnchor: 'start' },
  { dx: -(MARKER_PX + 5), dy: 0, textAnchor: 'end' },
  { dx: MARKER_PX + 5, dy: -LABEL_LINE_PX, textAnchor: 'start' },
  { dx: -(MARKER_PX + 5), dy: -LABEL_LINE_PX, textAnchor: 'end' },
  { dx: MARKER_PX + 5, dy: LABEL_LINE_PX, textAnchor: 'start' },
  { dx: -(MARKER_PX + 5), dy: LABEL_LINE_PX, textAnchor: 'end' },
  { dx: 0, dy: -(MARKER_PX + LABEL_LINE_PX * 0.7), textAnchor: 'start' },
  { dx: 0, dy: MARKER_PX + LABEL_LINE_PX * 0.7, textAnchor: 'start' },
  { dx: MARKER_PX + 5, dy: -LABEL_LINE_PX * 2, textAnchor: 'start' },
  { dx: -(MARKER_PX + 5), dy: LABEL_LINE_PX * 2, textAnchor: 'end' },
];

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function round(value: number): string {
  return (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, '');
}

interface SheetOptions {
  readonly site: SiteDefinition;
  readonly observerGroundM: number | null;
  readonly halfWidthKm: number;
  readonly sizePx: number;
  readonly ringsKm: readonly number[];
  readonly peaks: readonly Peak[];
  readonly sampler: ElevationSampler;
  readonly contourDecimation: number;
  readonly generatedLabel: string;
}

interface SheetResult {
  readonly svg: string;
  readonly hillshadePng: Uint8Array;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly metresPerPx: number;
  readonly contourIntervalM: number;
  readonly summits: number;
  readonly crowdedLabels: number;
  readonly reliefM: { readonly min: number; readonly max: number };
  readonly noDataPx: number;
}

/**
 * Draw one sheet.
 *
 * The order of the layers is the order of the SVG: hillshade, contours, rings,
 * ticks, then markers and text. Nothing above the hillshade encodes a
 * direction the camera was pointed, because nothing here has ever seen one.
 */
function buildSheet(options: SheetOptions): SheetResult {
  const { site, halfWidthKm, sizePx } = options;
  const projection = planMapProjection(site.observer, halfWidthKm, sizePx);

  const field = sampleElevationField(projection, options.sampler);
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let noDataPx = 0;
  for (const value of field) {
    if (Number.isNaN(value)) {
      noDataPx += 1;
      continue;
    }
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('The terrain mosaic answered for no pixel of this sheet.');
  }

  const shade = hillshade(field, sizePx, sizePx, {
    cellSizeM: projection.metresPerPx,
    zFactor: HILLSHADE_Z_FACTOR,
  });
  const paper = new Uint8Array(shade.length);
  for (let index = 0; index < shade.length; index += 1) {
    const value = shade[index] ?? NO_DATA_SHADE;
    const source = field[index] ?? Number.NaN;
    paper[index] = Number.isNaN(source) ? 236 : shadeToPaper(value);
  }
  const hillshadePng = encodeGreyscalePng(paper, sizePx, sizePx);

  const coarse = decimateField(field, sizePx, sizePx, options.contourDecimation);
  const contourIntervalM = chooseContourIntervalM(max - min);
  const indexEvery = 5;
  const contourLayers: { readonly level: number; readonly index: boolean; readonly lines: Polyline[] }[] =
    [];
  for (
    let level = Math.ceil(min / contourIntervalM) * contourIntervalM;
    level <= max;
    level += contourIntervalM
  ) {
    const lines = stitchSegments(contourSegments(coarse.field, coarse.cols, coarse.rows, level));
    contourLayers.push({
      level,
      index: Math.round(level / contourIntervalM) % indexEvery === 0,
      lines,
    });
  }

  const mapX = GUTTER_PX;
  const mapY = HEADER_PX;
  const widthPx = sizePx + GUTTER_PX * 2;
  const heightPx = sizePx + HEADER_PX + FOOTER_PX;
  const bounds: LabelRect = { left: 2, top: 2, right: sizePx - 2, bottom: sizePx - 2 };

  const centre = projectLatLng(projection, site.observer);

  // Rings and ticks are walked with the sweep's own geodesy, then projected.
  const ringPath = (radiusKm: number): string => {
    const points: string[] = [];
    for (let bearing = 0; bearing <= 360; bearing += 2) {
      const point = projectLatLng(
        projection,
        destinationPoint(site.observer, bearing, radiusKm * 1000),
      );
      points.push(`${round(point.x)},${round(point.y)}`);
    }
    return points.join(' ');
  };

  const outerRingKm = options.ringsKm[options.ringsKm.length - 1] ?? halfWidthKm;
  const alongBearing = (bearingDeg: number, radiusKm: number): MapPixel =>
    projectLatLng(projection, destinationPoint(site.observer, bearingDeg, radiusKm * 1000));

  /** A box around text that is centred on its anchor point, both ways. */
  const centredBox = (at: MapPixel, text: string, fontPx: number): LabelRect => {
    const width = text.length * fontPx * 0.56;
    return {
      left: at.x - width / 2,
      top: at.y - fontPx * 0.75,
      right: at.x + width / 2,
      bottom: at.y + fontPx * 0.75,
    };
  };

  // The map furniture is placed first and reserved, so a summit name never
  // lands on a range or a bearing. The furniture answers "where am I looking",
  // which is the whole point of handing an annotator a map.
  const ringLabels = options.ringsKm.map((radiusKm) => {
    const at = alongBearing(45, radiusKm);
    const text = `${round(radiusKm)} km`;
    return { at, text, rect: centredBox(at, text, 22) };
  });
  const bearingLabels: { at: MapPixel; text: string; rect: LabelRect }[] = [];
  for (let bearing = 30; bearing < 360; bearing += 30) {
    const at = alongBearing(bearing, outerRingKm * 0.915);
    const text = `${bearing}°`;
    bearingLabels.push({ at, text, rect: centredBox(at, text, 26) });
  }
  const northAt = alongBearing(0, outerRingKm * 0.9);
  const northRect: LabelRect = {
    left: northAt.x - 40,
    top: northAt.y - 40,
    right: northAt.x + 40,
    bottom: northAt.y + 92,
  };

  // Summits: everything the peak region holds that lands on this sheet.
  const onSheet = options.peaks
    .map((peak) => ({ peak, at: projectLatLng(projection, peak) }))
    .filter(
      ({ at }) =>
        at.x >= 0 && at.x <= sizePx && at.y >= 0 && at.y <= sizePx,
    );

  const requests: LabelRequest[] = onSheet.map(({ peak, at }) => {
    const text = `${peak.name} ${peak.elevationM} m`;
    return {
      id: peak.id,
      at,
      widthPx: text.length * LABEL_CHAR_PX,
      heightPx: LABEL_LINE_PX,
      priority: peak.elevationM,
    };
  });
  const reserved: LabelRect[] = [
    ...onSheet.map(({ at }) => ({
      left: at.x - MARKER_PX,
      top: at.y - MARKER_PX,
      right: at.x + MARKER_PX,
      bottom: at.y + MARKER_PX,
    })),
    { left: centre.x - 26, top: centre.y - 26, right: centre.x + 26, bottom: centre.y + 26 },
    ...ringLabels.map((label) => label.rect),
    ...bearingLabels.map((label) => label.rect),
    northRect,
  ];
  const placements = placeLabels(requests, LABEL_CANDIDATES, bounds, reserved);
  const placementById = new Map(placements.map((placement) => [placement.id, placement]));
  const crowdedLabels = placements.filter((placement) => !placement.placed).length;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" ` +
      `viewBox="0 0 ${widthPx} ${heightPx}" font-family="DejaVu Sans, Liberation Sans, sans-serif">`,
  );
  parts.push(`<rect width="${widthPx}" height="${heightPx}" fill="#ffffff"/>`);

  // ── header ──
  parts.push(
    `<text x="${GUTTER_PX + 6}" y="60" font-size="42" font-weight="700" fill="#111111">` +
      `${escapeXml(site.name)} — annotator reference map</text>`,
  );
  parts.push(
    `<text x="${GUTTER_PX + 6}" y="102" font-size="24" fill="#333333">` +
      `Top-down, north up. Half-width ${round(halfWidthKm)} km, ` +
      `${round(projection.metresPerPx)} m per pixel. ` +
      `Contours every ${contourIntervalM} m (heavier every ${contourIntervalM * indexEvery} m).` +
      `</text>`,
  );
  parts.push(
    `<text x="${GUTTER_PX + 6}" y="138" font-size="24" font-weight="700" fill="#8a1c1c">` +
      'This sheet carries no camera heading, no field of view, no pose and no overlay.' +
      '</text>',
  );

  parts.push(`<g transform="translate(${mapX} ${mapY})">`);
  parts.push(
    `<image x="0" y="0" width="${sizePx}" height="${sizePx}" ` +
      `image-rendering="pixelated" href="data:image/png;base64,` +
      `${Buffer.from(hillshadePng).toString('base64')}"/>`,
  );

  // ── contours ──
  const scale = options.contourDecimation;
  const half = scale / 2;
  for (const layer of contourLayers) {
    const paths = layer.lines
      .filter((line) => line.length >= 6)
      .map((line) => {
        const points: string[] = [];
        for (let index = 0; index + 1 < line.length; index += 2) {
          const x = (line[index] ?? 0) * scale + half;
          const y = (line[index + 1] ?? 0) * scale + half;
          points.push(`${round(x)},${round(y)}`);
        }
        return `<polyline points="${points.join(' ')}"/>`;
      });
    if (paths.length === 0) continue;
    parts.push(
      `<g fill="none" stroke="#6b4a2f" stroke-opacity="${layer.index ? 0.75 : 0.5}" ` +
        `stroke-width="${layer.index ? 2.1 : 1.2}" stroke-linejoin="round">${paths.join('')}</g>`,
    );
  }

  // ── range rings ──
  parts.push('<g fill="none" stroke="#0b4f8a" stroke-opacity="0.75" stroke-width="2.2">');
  for (const radiusKm of options.ringsKm) {
    parts.push(
      `<polyline points="${ringPath(radiusKm)}" stroke-dasharray="${
        radiusKm === outerRingKm ? 'none' : '14 10'
      }"/>`,
    );
  }
  parts.push('</g>');
  for (const label of ringLabels) {
    parts.push(
      `<text x="${round(label.at.x)}" y="${round(label.at.y)}" font-size="22" font-weight="700" ` +
        `fill="#0b4f8a" text-anchor="middle" dominant-baseline="middle" ` +
        `stroke="#ffffff" stroke-width="4" paint-order="stroke">${label.text}</text>`,
    );
  }

  // ── bearing ticks, every 10 degrees ──
  parts.push('<g stroke="#222222" stroke-width="2">');
  for (let bearing = 0; bearing < 360; bearing += 10) {
    const major = bearing % 30 === 0;
    const from = alongBearing(bearing, outerRingKm * (major ? 0.955 : 0.975));
    const to = alongBearing(bearing, outerRingKm * 1.006);
    parts.push(
      `<line x1="${round(from.x)}" y1="${round(from.y)}" x2="${round(to.x)}" ` +
        `y2="${round(to.y)}" stroke-width="${major ? 3.2 : 1.8}"/>`,
    );
  }
  parts.push('</g>');
  for (const label of bearingLabels) {
    parts.push(
      `<text x="${round(label.at.x)}" y="${round(label.at.y)}" font-size="26" font-weight="700" ` +
        `fill="#222222" text-anchor="middle" dominant-baseline="middle" ` +
        `stroke="#ffffff" stroke-width="5" paint-order="stroke">${label.text}</text>`,
    );
  }
  parts.push(
    `<polygon points="${round(northAt.x)},${round(northAt.y - 34)} ` +
      `${round(northAt.x - 15)},${round(northAt.y + 8)} ` +
      `${round(northAt.x + 15)},${round(northAt.y + 8)}" fill="#111111" ` +
      'stroke="#ffffff" stroke-width="3" paint-order="stroke"/>',
  );
  parts.push(
    `<text x="${round(northAt.x)}" y="${round(northAt.y + 42)}" font-size="40" ` +
      'font-weight="700" fill="#111111" text-anchor="middle" dominant-baseline="hanging" ' +
      'stroke="#ffffff" stroke-width="6" paint-order="stroke">N</text>',
  );

  // ── the viewpoint ──
  parts.push(
    `<g stroke="#0b4f8a" stroke-width="3.4" fill="none">` +
      `<circle cx="${round(centre.x)}" cy="${round(centre.y)}" r="15"/>` +
      `<line x1="${round(centre.x - 26)}" y1="${round(centre.y)}" x2="${round(centre.x + 26)}" y2="${round(centre.y)}"/>` +
      `<line x1="${round(centre.x)}" y1="${round(centre.y - 26)}" x2="${round(centre.x)}" y2="${round(centre.y + 26)}"/>` +
      `</g>` +
      `<circle cx="${round(centre.x)}" cy="${round(centre.y)}" r="5" fill="#0b4f8a"/>`,
  );

  // ── summits ──
  parts.push('<g fill="#8a1c1c" stroke="#ffffff" stroke-width="2.2" paint-order="stroke">');
  for (const { at } of onSheet) {
    parts.push(
      `<polygon points="${round(at.x)},${round(at.y - MARKER_PX)} ` +
        `${round(at.x - MARKER_PX)},${round(at.y + MARKER_PX * 0.72)} ` +
        `${round(at.x + MARKER_PX)},${round(at.y + MARKER_PX * 0.72)}"/>`,
    );
  }
  parts.push('</g>');

  for (const { peak } of onSheet) {
    const placement = placementById.get(peak.id);
    if (placement === undefined) continue;
    parts.push(
      `<text x="${round(placement.at.x)}" y="${round(placement.at.y)}" ` +
        `font-size="${LABEL_FONT_PX}" font-weight="600" fill="#1a1a1a" ` +
        `text-anchor="${placement.textAnchor}" dominant-baseline="middle" ` +
        'stroke="#ffffff" stroke-width="4" paint-order="stroke">' +
        `${escapeXml(peak.name)} ${peak.elevationM} m</text>`,
    );
  }

  parts.push(`<rect x="0" y="0" width="${sizePx}" height="${sizePx}" fill="none" stroke="#222222" stroke-width="2"/>`);
  parts.push('</g>');

  // ── footer: legend, scale bar, provenance ──
  const footerY = mapY + sizePx;
  const barKm = halfWidthKm >= 30 ? 10 : 2;
  const barPx = (barKm * 1000) / projection.metresPerPx;
  parts.push(
    `<g transform="translate(${GUTTER_PX + 6} ${footerY + 44})">` +
      `<rect x="0" y="-13" width="${round(barPx)}" height="13" fill="#111111"/>` +
      `<rect x="${round(barPx / 2)}" y="-13" width="${round(barPx / 2)}" height="13" fill="#ffffff" stroke="#111111" stroke-width="1.5"/>` +
      `<text x="0" y="26" font-size="22" fill="#111111">0</text>` +
      `<text x="${round(barPx)}" y="26" font-size="22" fill="#111111" text-anchor="middle">${barKm} km</text>` +
      '</g>',
  );

  const legendX = GUTTER_PX + 6 + barPx + 120;
  const legend = [
    `Viewpoint ${site.observer.lat}, ${site.observer.lon}` +
      (options.observerGroundM === null
        ? ''
        : ` — mosaic ground ${round(options.observerGroundM)} m`),
    `${onSheet.length} named summits on this sheet, from peak region "${site.peakRegion}" ` +
      '(heights are OpenStreetMap tags carried through Overture, never DEM samples).',
    `Hillshade: sun from 315° at 45° above the horizon, slopes exaggerated ` +
      `×${HILLSHADE_Z_FACTOR} for legibility. ` +
      `Relief on this sheet ${Math.round(min)}–${Math.round(max)} m.`,
    `Rings and bearing ticks are geodesic from the viewpoint; ticks every 10°, ` +
      'labelled every 30°. Bearings are true, not magnetic.',
    options.generatedLabel,
  ];
  legend.forEach((textLine, index) => {
    parts.push(
      `<text x="${round(legendX)}" y="${footerY + 26 + index * 30}" font-size="21" ` +
        `fill="#333333">${escapeXml(textLine)}</text>`,
    );
  });

  parts.push('</svg>');

  return {
    svg: parts.join('\n'),
    hillshadePng,
    widthPx,
    heightPx,
    metresPerPx: projection.metresPerPx,
    contourIntervalM,
    summits: onSheet.length,
    crowdedLabels,
    reliefM: { min, max },
    noDataPx,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Rasterising
// ───────────────────────────────────────────────────────────────────────────

/**
 * The Chromium Playwright installed, found by directory rather than by version.
 *
 * The container's browser directory holds a build whose revision does not match
 * the `@playwright/test` in `node_modules`, so `chromium.launch()` on its own
 * looks for a headless shell that is not there. Returning `undefined` leaves
 * Playwright to resolve it, which is right on a machine where the versions
 * agree.
 */
export function findChromiumExecutable(browsersPath: string | undefined): string | undefined {
  if (browsersPath === undefined || browsersPath === '') return undefined;
  let entries: readonly string[];
  try {
    entries = readdirSync(browsersPath);
  } catch {
    return undefined;
  }
  const builds = entries
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)));
  for (const name of builds) {
    const executable = join(browsersPath, name, 'chrome-linux', 'chrome');
    if (existsSync(executable)) return executable;
  }
  return undefined;
}

async function rasterise(
  sheets: readonly { readonly svgPath: string; readonly pngPath: string; readonly width: number; readonly height: number }[],
): Promise<void> {
  const { chromium } = await import('@playwright/test');
  const executablePath = findChromiumExecutable(process.env['PLAYWRIGHT_BROWSERS_PATH']);
  const browser = await chromium.launch(executablePath === undefined ? {} : { executablePath });
  try {
    for (const sheet of sheets) {
      const page = await browser.newPage({
        viewport: { width: sheet.width, height: sheet.height },
        deviceScaleFactor: 1,
      });
      await page.goto(`file://${sheet.svgPath}`);
      await page.screenshot({ path: sheet.pngPath, type: 'png' });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

// ───────────────────────────────────────────────────────────────────────────
// The command
// ───────────────────────────────────────────────────────────────────────────

export interface Options {
  readonly siteId: string;
  readonly sitesDir: string;
  readonly packageDir: string | null;
  readonly outDir: string | null;
  readonly sizePx: number;
  readonly nearRadiusKm: number;
  readonly rasterise: boolean;
}

const USAGE = `
Usage: npm run annotator:map -- <site-id> [options]

  --out <dir>        where to write the sheets (default ${ANNOTATOR_MAP_DIR}/<site-id>)
  --package <dir>    the built site package (default ${SITE_PACKAGE_DIR}/<site-id>)
  --sites-dir <dir>  where the definitions live (default ${SITE_DEFINITION_DIR})
  --size <px>        pixels along each side of the map square (default 2400)
  --near-km <km>     half-width of the near sheet (default 10)
  --no-png           write only the SVG, do not rasterise
`;

export function parseArgs(argv: readonly string[]): Options {
  let siteId: string | null = null;
  let sitesDir = SITE_DEFINITION_DIR;
  let packageDir: string | null = null;
  let outDir: string | null = null;
  let sizePx = 2400;
  let nearRadiusKm = 10;
  let rasterisePng = true;

  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined) throw new Error(`${flag} needs a value`);
    return next;
  };
  const positive = (text: string, flag: string): number => {
    const parsed = Number(text);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${flag} needs a positive number`);
    return parsed;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--out': outDir = value(index + 1, arg); index += 1; break;
      case '--package': packageDir = value(index + 1, arg); index += 1; break;
      case '--sites-dir': sitesDir = value(index + 1, arg); index += 1; break;
      case '--size':
        sizePx = Math.round(positive(value(index + 1, arg), arg));
        index += 1;
        break;
      case '--near-km':
        nearRadiusKm = positive(value(index + 1, arg), arg);
        index += 1;
        break;
      case '--no-png': rasterisePng = false; break;
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown option ${arg}${USAGE}`);
        if (siteId !== null) throw new Error('Name one site at a time');
        siteId = arg;
    }
  }
  if (siteId === null) throw new Error(`Name a site.${USAGE}`);
  return { siteId, sitesDir, packageDir, outDir, sizePx, nearRadiusKm, rasterise: rasterisePng };
}

/**
 * Rings for a sheet: the standard ladder, trimmed to what fits and what reads.
 *
 * The lower bound matters as much as the upper one. On a 60 km sheet a 1 km
 * ring is twenty pixels across, so it draws as a smudge on the viewpoint marker
 * and its label lands on top of the next ring's. Rings under 3 % of the
 * half-width are dropped rather than drawn illegibly.
 */
export function ringsForHalfWidth(
  halfWidthKm: number,
  ladderKm: readonly number[] = [1, 2, 5, 10, 20, 40, 60, 100, 150],
): number[] {
  const rings = ladderKm.filter(
    (radiusKm) => radiusKm <= halfWidthKm * 0.995 && radiusKm >= halfWidthKm * 0.03,
  );
  const largest = rings[rings.length - 1];
  if (largest === undefined) return [Math.round(halfWidthKm * 0.9 * 10) / 10];
  return rings;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const definitionPath = join(options.sitesDir, `${options.siteId}.json`);
  const site = parseSiteDefinition(
    JSON.parse(await readFile(definitionPath, 'utf8')) as unknown,
    definitionPath,
  );

  const packageDir = resolve(options.packageDir ?? join(SITE_PACKAGE_DIR, site.id));
  const outDir = resolve(options.outDir ?? join(ANNOTATOR_MAP_DIR, site.id));
  await mkdir(outDir, { recursive: true });

  const line = (text = ''): void => {
    process.stdout.write(`${text}\n`);
  };

  line(`Annotator map — ${site.name} (${site.id})`);
  line(`  method          frame-and-map (docs/FIELD-TEST-PREREGISTRATION.md § 2.0)`);
  line(`  viewpoint       ${site.observer.lat}, ${site.observer.lon}`);
  line(`  package         ${relative(process.cwd(), packageDir) || packageDir}`);
  line();

  // ── terrain ──
  const manifestPath = join(packageDir, 'terrain', 'manifest.json');
  let manifestText: string;
  try {
    manifestText = await readFile(manifestPath, 'utf8');
  } catch {
    throw new Error(
      `${manifestPath} is not there. Build the site package first:\n` +
        `  npm run site:package -- ${site.id}`,
    );
  }
  const manifest = parseTerrainManifest(JSON.parse(manifestText) as unknown, manifestPath);
  const grid = manifest.grids[0];
  if (grid === undefined) throw new Error(`${manifestPath} lists no grid`);
  if (manifest.grids.length > 1) {
    throw new Error(
      `${manifestPath} lists ${manifest.grids.length} grids. This map draws one mosaic; a ` +
        'multi-grid package would need a rule for which grid a pixel comes from.',
    );
  }
  const mosaicPath = join(packageDir, 'terrain', grid.url.replace(/^\//, ''));
  const tile = parseGridWindow(await readFile(mosaicPath), grid.geometry, grid.name);

  const { northLat, westLon, latStepDeg, lonStepDeg, rows, cols } = grid.geometry;
  const nearestSampler: ElevationSampler = (lat, lon) => {
    const row = Math.round((northLat - lat) / latStepDeg);
    const col = Math.round((lon - westLon) / lonStepDeg);
    if (row < 0 || col < 0 || row >= rows || col >= cols) return null;
    return tile.sampleAt(row, col);
  };
  const bilinearSampler: ElevationSampler = (lat, lon) => {
    const reading = tile.read(lat, lon, { interpolation: 'bilinear' });
    return reading.elevationM;
  };

  /**
   * Which interpolation a sheet reads the mosaic with depends on its scale.
   *
   * Under-sampling — a 50 m pixel over a 30 m posting — takes the nearest
   * posting, because interpolating first would smooth the ridge crests the
   * hillshade is drawn to show.
   *
   * Over-sampling — an 8 m pixel over the same posting — must interpolate.
   * Nearest neighbour there turns the grid into 3.6 px terraces, and the
   * hillshade's 3 × 3 differences light every terrace edge: the sheet comes out
   * ruled in corduroy stripes that hide the landform underneath.
   */
  const samplerFor = (metresPerPx: number): ElevationSampler =>
    metresPerPx < postingMetres(grid.geometry) ? bilinearSampler : nearestSampler;

  const observerGroundM = nearestSampler(site.observer.lat, site.observer.lon);

  // ── summits ──
  const peakIndexPath = join(packageDir, 'peaks', site.peakRegion, 'index.json');
  const peakStore = await loadPeakCellIndex(peakIndexPath);
  const peaks = await peakStore.peaksWithin(site.observer, site.sweepRadiusKm);
  line('SUMMITS');
  line(
    `  ${peaks.length} named summits within ${site.sweepRadiusKm} km, from ` +
      `peaks/${site.peakRegion}/`,
  );
  const nearest = [...peaks].sort(
    (a, b) =>
      haversineDistanceM(site.observer, a) - haversineDistanceM(site.observer, b),
  );
  const closest = nearest[0];
  if (closest !== undefined) {
    line(
      `  nearest: ${closest.name} ${closest.elevationM} m at ` +
        `${round(haversineDistanceM(site.observer, closest) / 1000)} km`,
    );
  }
  line();

  const generatedLabel =
    `Terrain: ${grid.name} mosaic from the ${site.id} site package. ` +
    `Rebuild: npm run annotator:map -- ${site.id}`;

  // The near sheet's half-width overshoots its outermost ring by 6 %, so the
  // ring and its bearing ticks are drawn inside the sheet rather than on its rim.
  const sheets: {
    readonly name: string;
    readonly halfWidthKm: number;
    readonly decimation: number;
  }[] = [
    {
      name: `${site.id}-map-${site.sweepRadiusKm}km`,
      halfWidthKm: site.sweepRadiusKm + site.terrainMarginKm,
      decimation: 4,
    },
    {
      name: `${site.id}-map-${options.nearRadiusKm}km`,
      halfWidthKm: options.nearRadiusKm * 1.06,
      decimation: 3,
    },
  ];

  const rendered: {
    readonly svgPath: string;
    readonly pngPath: string;
    readonly width: number;
    readonly height: number;
  }[] = [];

  line('SHEETS');
  for (const sheet of sheets) {
    const result = buildSheet({
      site,
      observerGroundM,
      halfWidthKm: sheet.halfWidthKm,
      sizePx: options.sizePx,
      ringsKm: ringsForHalfWidth(sheet.halfWidthKm),
      peaks,
      sampler: samplerFor((sheet.halfWidthKm * 2000) / options.sizePx),
      contourDecimation: sheet.decimation,
      generatedLabel,
    });
    const svgPath = join(outDir, `${sheet.name}.svg`);
    await writeFile(svgPath, result.svg, 'utf8');
    rendered.push({
      svgPath,
      pngPath: join(outDir, `${sheet.name}.png`),
      width: result.widthPx,
      height: result.heightPx,
    });
    line(
      `  ${sheet.name}: ${result.widthPx} x ${result.heightPx} px, ` +
        `${round(result.metresPerPx)} m/px, contours every ${result.contourIntervalM} m, ` +
        `relief ${Math.round(result.reliefM.min)}–${Math.round(result.reliefM.max)} m`,
    );
    line(
      `    ${result.summits} summits labelled, ${result.crowdedLabels} labels had no free spot, ` +
        `${result.noDataPx} pixels outside the mosaic`,
    );
  }

  if (options.rasterise) {
    line();
    line('RASTERISING with the container\'s Playwright Chromium');
    await rasterise(rendered);
  }

  line();
  line('WROTE');
  for (const sheet of rendered) {
    line(`  ${relative(process.cwd(), sheet.svgPath)}`);
    if (options.rasterise) line(`  ${relative(process.cwd(), sheet.pngPath)}`);
  }
  line();
  line(
    'These sheets hold no camera heading, no field of view, no pose and no overlay, so they ' +
      'are the frame-and-map annotator\'s half of § 2.0.',
  );
  line(`${relative(process.cwd(), outDir)} is gitignored. Rebuild it; never commit it.`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
