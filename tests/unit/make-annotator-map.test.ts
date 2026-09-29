/**
 * `scripts/make-annotator-map.ts` — the pure parts, against hand arithmetic.
 *
 * WHERE THE EXPECTATIONS COME FROM. Every number below is derived from the
 * definition in the script's own documentation, on paper, before the code ran.
 * None of them is the script's output pasted back (AGENTS.md § Evidence,
 * "Independent expectations").
 *
 *   Projection — the equirectangular relation `north metres = Δlat × R × π/180`
 *     with R = 6 371 008.8 m, and its inverse.
 *   Hillshade — the Lambertian dot product the script documents:
 *     `(−gE·sinA·cosα − gN·cosA·cosα + sinα) / sqrt(gE² + gN² + 1)`, evaluated
 *     on three fields whose gradients are exact by construction.
 *   Contours — marching squares' interpolation `t = (level − low)/(high − low)`
 *     on single cells small enough to read off the page.
 *   Label placement — rectangle overlap, worked through by hand.
 *   PNG — the format's own byte layout: the 8-byte signature and the IHDR
 *     chunk, from the PNG specification.
 *
 * These are the four places an off-by-one would produce a map that looks right
 * and is wrong: a projection that mislocates a summit, a hillshade lit from the
 * wrong quarter, a contour a cell out, and a label attached to its neighbour.
 */

import { describe, expect, it } from 'vitest';

import { EARTH_RADIUS_M } from '../../src/core/geodesy.js';
import {
  NO_DATA_SHADE,
  chooseContourIntervalM,
  contourSegments,
  decimateField,
  encodeGreyscalePng,
  findChromiumExecutable,
  hillshade,
  labelRect,
  parseArgs,
  placeLabels,
  planMapProjection,
  postingMetres,
  projectLatLng,
  ringsForHalfWidth,
  sampleElevationField,
  stitchSegments,
  unprojectPixel,
  type ContourSegment,
} from '../../scripts/make-annotator-map.js';

const CENTRE = { lat: 40, lon: -110 };

describe('planMapProjection', () => {
  it('splits the sheet evenly across the declared half-width', () => {
    const projection = planMapProjection(CENTRE, 60, 2400);
    // 120 km across 2400 px.
    expect(projection.metresPerPx).toBeCloseTo(50, 12);
    // One pixel of northing in degrees: 50 / 6 371 008.8 rad = 4.4966e-4 deg.
    expect(projection.latDegPerPx).toBeCloseTo((50 / EARTH_RADIUS_M) * (180 / Math.PI), 15);
    // East-west is stretched by 1/cos(40 deg) = 1.305407.
    expect(projection.lonDegPerPx / projection.latDegPerPx).toBeCloseTo(1 / Math.cos(Math.PI / 4.5), 12);
  });

  it('refuses a sheet too small to hold a 3x3 window', () => {
    expect(() => planMapProjection(CENTRE, 60, 1)).toThrow(/at least 2/);
  });
});

describe('projectLatLng', () => {
  const projection = planMapProjection(CENTRE, 60, 2400);

  it('puts the centre at the middle of the sheet', () => {
    expect(projectLatLng(projection, CENTRE)).toEqual({ x: 1200, y: 1200 });
  });

  it('places a point 50 km north exactly 1000 px up', () => {
    // 50 km north is 50 000 / 50 = 1000 px, so y = 1200 - 1000 = 200.
    const latDeg = CENTRE.lat + (50_000 / EARTH_RADIUS_M) * (180 / Math.PI);
    const at = projectLatLng(projection, { lat: latDeg, lon: CENTRE.lon });
    expect(at.x).toBeCloseTo(1200, 9);
    expect(at.y).toBeCloseTo(200, 6);
  });

  it('places a point 25 km east exactly 500 px right', () => {
    // 25 km east at 40 N is 25 000 / (R cos40) rad of longitude.
    const lonDeg =
      CENTRE.lon + (25_000 / (EARTH_RADIUS_M * Math.cos(Math.PI / 4.5))) * (180 / Math.PI);
    const at = projectLatLng(projection, { lat: CENTRE.lat, lon: lonDeg });
    expect(at.x).toBeCloseTo(1700, 6);
    expect(at.y).toBeCloseTo(1200, 9);
  });

  it('round-trips through unprojectPixel', () => {
    const point = unprojectPixel(projection, 317.5, 2081.25);
    const back = projectLatLng(projection, point);
    expect(back.x).toBeCloseTo(317.5, 9);
    expect(back.y).toBeCloseTo(2081.25, 9);
  });
});

describe('sampleElevationField', () => {
  it('asks about pixel centres and keeps a refusal as NaN', () => {
    const projection = planMapProjection(CENTRE, 1, 4);
    const asked: { lat: number; lon: number }[] = [];
    const field = sampleElevationField(projection, (lat, lon) => {
      asked.push({ lat, lon });
      return lat > CENTRE.lat ? 100 : null;
    });
    expect(asked).toHaveLength(16);
    // Pixel (0,0)'s centre is (0.5, 0.5), which is 1.5 px north and west of the
    // sheet centre at (2,2). So the top two rows are north of centre.
    expect(Array.from(field.slice(0, 8))).toEqual([100, 100, 100, 100, 100, 100, 100, 100]);
    expect(field.slice(8).every((value) => Number.isNaN(value))).toBe(true);
  });
});

describe('decimateField', () => {
  it('averages each block and ignores missing samples', () => {
    // 4x4, decimated by 2. Block means: (1+2+5+6)/4 = 3.5, (3+4+7+8)/4 = 5.5,
    // the third block has one NaN so it averages the other three, and the
    // fourth is entirely NaN.
    const field = Float64Array.from([
      1, 2, 3, 4,
      5, 6, 7, 8,
      9, 10, Number.NaN, Number.NaN,
      11, 12, Number.NaN, Number.NaN,
    ]);
    const coarse = decimateField(field, 4, 4, 2);
    expect(coarse.cols).toBe(2);
    expect(coarse.rows).toBe(2);
    expect(coarse.field[0]).toBeCloseTo(3.5, 12);
    expect(coarse.field[1]).toBeCloseTo(5.5, 12);
    expect(coarse.field[2]).toBeCloseTo((9 + 10 + 11 + 12) / 4, 12);
    expect(Number.isNaN(coarse.field[3] ?? 0)).toBe(true);
  });
});

describe('hillshade', () => {
  const options = { cellSizeM: 1, azimuthDeg: 315, altitudeDeg: 45 };

  it('shades a flat field at sin(45 deg) everywhere, edges included', () => {
    // gE = gN = 0, so the dot product is sin(45) = 0.70710678 and the byte is
    // round(0.70710678 x 255) = round(180.31) = 180.
    const field = new Float64Array(16).fill(1234);
    const shade = hillshade(field, 4, 4, options);
    expect(Array.from(shade)).toEqual(new Array(16).fill(180));
  });

  it('gives 255 to the plane whose normal points straight at the sun', () => {
    // The sun unit vector at A = 315, alpha = 45 is (-0.5, 0.5, 0.70710678).
    // The normal (-gE, -gN, 1) is parallel to it when gE = +0.70710678 and
    // gN = -0.70710678, i.e. z rises to the east and falls to the north.
    // With row increasing southward that is z = k(col + row), k = 0.70710678.
    const k = Math.SQRT1_2;
    const cols = 5;
    const rows = 5;
    const field = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) field[row * cols + col] = k * (col + row);
    }
    const shade = hillshade(field, cols, rows, options);
    // The interior is the exact plane; edges replicate and are not.
    expect(shade[2 * cols + 2]).toBe(255);
  });

  it('shades a 45-degree east-facing slope at 37', () => {
    // z = -col, so gE = -1 and gN = 0.
    //   numerator = -(-1)(-0.70710678)(0.70710678) + 0 + 0.70710678
    //             = -0.5 + 0.70710678 = 0.20710678
    //   denominator = sqrt(1 + 0 + 1) = 1.41421356
    //   dot = 0.14644661, byte = round(37.34) = 37
    const cols = 5;
    const rows = 5;
    const field = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) field[row * cols + col] = -col;
    }
    const shade = hillshade(field, cols, rows, options);
    expect(shade[2 * cols + 2]).toBe(37);
  });

  it('scales with the cell size, because the gradient does', () => {
    // The same heights over 2 m cells halve both gradients. For z = -col with
    // cellSizeM 2: gE = -0.5, gN = 0.
    //   numerator = -0.25 + 0.70710678 = 0.45710678
    //   denominator = sqrt(1.25) = 1.11803399
    //   dot = 0.40884, byte = round(104.25) = 104
    const cols = 5;
    const rows = 5;
    const field = new Float64Array(cols * rows);
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) field[row * cols + col] = -col;
    }
    const shade = hillshade(field, cols, rows, { ...options, cellSizeM: 2 });
    expect(shade[2 * cols + 2]).toBe(104);
  });

  it('marks a window holding a missing sample rather than inventing a height', () => {
    const field = new Float64Array(9).fill(100);
    field[0] = Number.NaN;
    const shade = hillshade(field, 3, 3, options);
    expect(shade[4]).toBe(NO_DATA_SHADE);
    // The far corner's clamped 3x3 window never reaches (0,0), so it still shades.
    expect(shade[8]).toBe(180);
  });
});

describe('chooseContourIntervalM', () => {
  it('takes the coarsest interval that still draws twelve lines', () => {
    // 2400 m of relief: 2400/200 = 12 exactly, and 2400/250 = 9.6 is too few.
    expect(chooseContourIntervalM(2400)).toBe(200);
    // 300 m: 300/25 = 12, and 300/50 = 6.
    expect(chooseContourIntervalM(300)).toBe(25);
    // Less relief than twelve of the finest interval falls back to that.
    expect(chooseContourIntervalM(50)).toBe(10);
  });
});

describe('contourSegments', () => {
  it('cuts a north-south step across the middle of the cell', () => {
    // Corners tl=0 tr=0 br=100 bl=100 at level 50: the bottom pair is above, so
    // the crossings are on the left and right edges, both halfway down.
    const field = Float64Array.from([0, 0, 100, 100]);
    expect(contourSegments(field, 2, 2, 50)).toEqual([{ x1: 0, y1: 0.5, x2: 1, y2: 0.5 }]);
  });

  it('cuts the corner off the one raised vertex', () => {
    // tl=0 tr=100 br=0 bl=0 at level 50: only the top right is above, so the
    // crossings are the top edge at t = 0.5 and the right edge at t = 0.5.
    const field = Float64Array.from([0, 100, 0, 0]);
    expect(contourSegments(field, 2, 2, 50)).toEqual([{ x1: 0.5, y1: 0, x2: 1, y2: 0.5 }]);
  });

  it('interpolates the crossing rather than halving the edge', () => {
    // Row-major, so the array is tl, tr, bl, br: bl=100 and br=200. At level 50
    // the left edge crosses at 50/100 = 0.5 and the right edge at 50/200 = 0.25.
    const field = Float64Array.from([0, 0, 100, 200]);
    expect(contourSegments(field, 2, 2, 50)).toEqual([{ x1: 0, y1: 0.5, x2: 1, y2: 0.25 }]);
  });

  it('draws two lines through a saddle, on the side the cell mean says', () => {
    // Row-major tl, tr, bl, br: the two raised corners are tl and br, which is
    // the ambiguous case. Mean 50 is not above the level, so the pair is
    // left-top and bottom-right. Every edge crosses at 0.5.
    const field = Float64Array.from([100, 0, 0, 100]);
    expect(contourSegments(field, 2, 2, 50)).toEqual([
      { x1: 0, y1: 0.5, x2: 0.5, y2: 0 },
      { x1: 0.5, y1: 1, x2: 1, y2: 0.5 },
    ]);
  });

  it('draws nothing through a cell with a missing corner', () => {
    const field = Float64Array.from([0, 0, 100, Number.NaN]);
    expect(contourSegments(field, 2, 2, 50)).toEqual([]);
  });

  it('draws nothing where every corner is on one side', () => {
    expect(contourSegments(Float64Array.from([0, 1, 2, 3]), 2, 2, 50)).toEqual([]);
    expect(contourSegments(Float64Array.from([60, 70, 80, 90]), 2, 2, 50)).toEqual([]);
  });
});

describe('stitchSegments', () => {
  it('chains segments that share endpoints into one polyline', () => {
    const segments: ContourSegment[] = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 2, y1: 0, x2: 3, y2: 0 },
      { x1: 1, y1: 0, x2: 2, y2: 0 },
    ];
    expect(stitchSegments(segments)).toEqual([[0, 0, 1, 0, 2, 0, 3, 0]]);
  });

  it('extends backwards from the seed as well as forwards', () => {
    // The seed is the middle segment, so the walk has to go both ways.
    const segments: ContourSegment[] = [
      { x1: 1, y1: 0, x2: 2, y2: 0 },
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 2, y1: 0, x2: 3, y2: 0 },
    ];
    expect(stitchSegments(segments)).toEqual([[0, 0, 1, 0, 2, 0, 3, 0]]);
  });

  it('keeps disjoint runs apart', () => {
    const segments: ContourSegment[] = [
      { x1: 0, y1: 0, x2: 1, y2: 0 },
      { x1: 5, y1: 5, x2: 6, y2: 5 },
    ];
    expect(stitchSegments(segments)).toEqual([
      [0, 0, 1, 0],
      [5, 5, 6, 5],
    ]);
  });
});

describe('labelRect', () => {
  it('centres the box on the anchor point and runs it the way the text does', () => {
    const request = { id: 'a', at: { x: 100, y: 100 }, widthPx: 60, heightPx: 20, priority: 0 };
    expect(labelRect(request, { dx: 10, dy: 0, textAnchor: 'start' })).toEqual({
      left: 110,
      top: 90,
      right: 170,
      bottom: 110,
    });
    expect(labelRect(request, { dx: -10, dy: 0, textAnchor: 'end' })).toEqual({
      left: 30,
      top: 90,
      right: 90,
      bottom: 110,
    });
  });
});

describe('placeLabels', () => {
  const candidates = [
    { dx: 10, dy: 0, textAnchor: 'start' as const },
    { dx: -10, dy: 0, textAnchor: 'end' as const },
  ];
  const bounds = { left: 0, top: 0, right: 400, bottom: 400 };

  it('gives the taller summit the first candidate and moves the shorter one', () => {
    // Both want the box 110..170 at y 90..110. The 3000 m summit takes it, so
    // the 1000 m one falls to the left candidate at 30..90.
    const requests = [
      { id: 'low', at: { x: 100, y: 100 }, widthPx: 60, heightPx: 20, priority: 1000 },
      { id: 'high', at: { x: 100, y: 100 }, widthPx: 60, heightPx: 20, priority: 3000 },
    ];
    const placements = placeLabels(requests, candidates, bounds);
    expect(placements.map((placement) => placement.id)).toEqual(['high', 'low']);
    expect(placements[0]?.rect.left).toBe(110);
    expect(placements[1]?.rect.left).toBe(30);
    expect(placements.every((placement) => placement.placed)).toBe(true);
  });

  it('refuses a candidate that would hang off the sheet', () => {
    // At x = 395 the first candidate's box runs 405..465, outside the bounds.
    const requests = [
      { id: 'edge', at: { x: 395, y: 100 }, widthPx: 60, heightPx: 20, priority: 1 },
    ];
    const placements = placeLabels(requests, candidates, bounds);
    expect(placements[0]?.rect).toEqual({ left: 325, top: 90, right: 385, bottom: 110 });
    expect(placements[0]?.textAnchor).toBe('end');
  });

  it('dodges a reserved box', () => {
    const requests = [
      { id: 'a', at: { x: 100, y: 100 }, widthPx: 60, heightPx: 20, priority: 1 },
    ];
    const placements = placeLabels(requests, candidates, bounds, [
      { left: 105, top: 95, right: 115, bottom: 105 },
    ]);
    expect(placements[0]?.rect.left).toBe(30);
  });

  it('still places a label with nowhere to go, and says it did not fit', () => {
    const requests = [
      { id: 'a', at: { x: 100, y: 100 }, widthPx: 60, heightPx: 20, priority: 1 },
    ];
    const placements = placeLabels(requests, candidates, bounds, [
      { left: 0, top: 0, right: 400, bottom: 400 },
    ]);
    expect(placements[0]?.placed).toBe(false);
    expect(placements[0]?.rect.left).toBe(110);
  });
});

describe('ringsForHalfWidth', () => {
  it('keeps the rungs between 3 per cent of the sheet and its edge', () => {
    // On a 60.5 km sheet the bounds are 1.815 km and 60.1975 km, so 1 km is too
    // small to read and 100 km is off the sheet.
    expect(ringsForHalfWidth(60.5)).toEqual([2, 5, 10, 20, 40, 60]);
    // On a 10.6 km sheet they are 0.318 km and 10.547 km.
    expect(ringsForHalfWidth(10.6)).toEqual([1, 2, 5, 10]);
    // 10 km does not fit a 10 km sheet: 10 > 10 x 0.995.
    expect(ringsForHalfWidth(10)).toEqual([1, 2, 5]);
  });

  it('invents one ring when no rung fits', () => {
    expect(ringsForHalfWidth(0.5)).toEqual([0.5]);
  });
});

describe('postingMetres', () => {
  it('measures a one-arc-second posting north to south', () => {
    // (1/3600) deg is 4.848137e-6 rad; x 6 371 008.8 m = 30.8875 m.
    const geometry = {
      northLat: 44,
      westLon: -117,
      rows: 3601,
      cols: 3601,
      latStepDeg: 1 / 3600,
      lonStepDeg: 1 / 3600,
    };
    expect(postingMetres(geometry)).toBeCloseTo(
      (Math.PI / 180 / 3600) * EARTH_RADIUS_M,
      12,
    );
    expect(postingMetres(geometry)).toBeCloseTo(30.8875, 3);
  });
});

describe('encodeGreyscalePng', () => {
  it('writes the signature and an IHDR the specification describes', () => {
    const png = encodeGreyscalePng(Uint8Array.from([0, 128, 255, 64, 32, 16]), 3, 2);
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
    // The first chunk: length 13, type "IHDR", then width, height, and the five
    // one-byte fields.
    expect(view.getUint32(8)).toBe(13);
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR');
    expect(view.getUint32(16)).toBe(3);
    expect(view.getUint32(20)).toBe(2);
    expect(Array.from(png.subarray(24, 29))).toEqual([8, 0, 0, 0, 0]);
    // IEND is the last twelve bytes: length 0, the type, and its CRC.
    expect(String.fromCharCode(...png.subarray(png.length - 8, png.length - 4))).toBe('IEND');
    expect(view.getUint32(png.length - 12)).toBe(0);
  });

  it('refuses a pixel count the dimensions do not explain', () => {
    expect(() => encodeGreyscalePng(new Uint8Array(5), 3, 2)).toThrow(/needs 6 pixels/);
  });
});

describe('parseArgs', () => {
  it('defaults to the gitignored output directory and a 2400 px sheet', () => {
    const options = parseArgs(['bogus-basin']);
    expect(options.siteId).toBe('bogus-basin');
    expect(options.outDir).toBeNull();
    expect(options.packageDir).toBeNull();
    expect(options.sizePx).toBe(2400);
    expect(options.nearRadiusKm).toBe(10);
    expect(options.rasterise).toBe(true);
  });

  it('reads the flags', () => {
    const options = parseArgs(['x', '--out', 'here', '--size', '800', '--near-km', '5', '--no-png']);
    expect(options.outDir).toBe('here');
    expect(options.sizePx).toBe(800);
    expect(options.nearRadiusKm).toBe(5);
    expect(options.rasterise).toBe(false);
  });

  it('refuses two sites, an unknown flag, and a missing value', () => {
    expect(() => parseArgs(['a', 'b'])).toThrow(/one site/);
    expect(() => parseArgs(['a', '--wedge'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['a', '--out'])).toThrow(/needs a value/);
    expect(() => parseArgs([])).toThrow(/Name a site/);
    expect(() => parseArgs(['a', '--size', '0'])).toThrow(/positive number/);
  });
});

describe('findChromiumExecutable', () => {
  it('reports nothing when there is no browser directory to look in', () => {
    expect(findChromiumExecutable(undefined)).toBeUndefined();
    expect(findChromiumExecutable('')).toBeUndefined();
    expect(findChromiumExecutable('/nonexistent-browsers-path')).toBeUndefined();
  });
});
