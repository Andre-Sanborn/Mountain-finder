/**
 * Field sites — one viewpoint's terrain cut once, for the app and for a phone.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT A SITE PACKAGE IS
 * ═══════════════════════════════════════════════════════════════════════════
 * A site is a place someone actually stands: a coordinate, a 360° sweep radius,
 * and the peak region that names its summits (`sites/<id>.json`). A site PACKAGE
 * is the terrain that sweep reads, cut out of whole SRTM tiles once at
 * acquisition time and published in the format `HttpTerrainStore` already reads —
 * a `manifest.json` naming one grid, beside that grid's raw big-endian int16
 * samples.
 *
 * This is recommendation 3 of docs/DEPLOY.md, and the numbers still favour it at
 * this radius: the four whole 1° tiles around Bogus Basin are 103.74 MB, and the
 * 60 km disc inside them is 42.55 MB. The window is worth cutting, and it is
 * worth cutting only because it is cut to the SWEEP rather than to a case's
 * must-see list. A window smaller than the sweep produces false `visible`
 * verdicts, which `src/pipeline/testing/case-terrain.ts` spells out at length. So
 * the box here encloses the whole declared disc plus a stated margin, and
 * `ringCoverage` is what says so, rather than a comment.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY ONE MOSAIC AND NOT ONE WINDOW PER TILE
 * ═══════════════════════════════════════════════════════════════════════════
 * A 60 km disc at 43.77 N spans 1.09° of latitude and 1.49° of longitude, so it
 * crosses both a latitude and a longitude tile boundary and touches four tiles.
 * Four per-tile windows would parse — the index takes any number of grids — but
 * `selectTerrainGrid` hands a viewpoint ONE grid, the largest covering it, and
 * would therefore give the sweep a quarter of its own terrain. One mosaic is the
 * shape a single-grid store can read the whole disc out of.
 *
 * The mosaic is assembled by copying BYTES, never decoded samples: the target
 * spacing is the source spacing and both are big-endian int16, so a run of
 * columns inside one tile row is a `subarray` copy. That is why a seam is
 * testable as byte identity rather than against a tolerance.
 *
 * Adjacent SRTM tiles repeat their shared edge line, so every sample on a
 * boundary exists in two tiles. The mosaic takes it from exactly one of them —
 * the northern tile's south row, the eastern tile's west column — and the unit
 * tests assert it matches both, on synthetic tiles that agree by construction. An
 * off-by-one column at a seam changes the value and fails.
 *
 * Real tiles do not always agree with each other about that line. Around Bogus
 * Basin, 4 of 14 404 boundary samples differ between the two AWS skadi tiles that
 * hold them, every one by exactly 1 m. So which tile the line is read from is a
 * choice with a 1 m consequence, made here rather than left to chance, and
 * `scripts/make-site-package.ts` counts the disagreements it copies past.
 *
 * PURE. No fetch, no filesystem, no clock: tiles arrive as bytes and a package
 * leaves as bytes. `scripts/make-site-package.ts` is the I/O around it.
 */

import { EARTH_RADIUS_M, destinationPoint } from '../core/geodesy.js';
import type { LatLng } from '../core/types.js';
import { ProviderError } from '../providers/errors.js';
import { BYTES_PER_SAMPLE, SRTM1_GRID_SIZE, type GridGeometry } from '../providers/hgt-tile.js';
import {
  TERRAIN_MANIFEST_VERSION,
  gridContains,
  type TerrainGrid,
  type TerrainManifest,
} from '../providers/terrain-manifest.js';
import { tileNameForCorner } from '../providers/tile-store.js';

/** Postings per degree in SRTM1, whose tiles are 3601 × 3601 with both edges. */
export const SRTM1_SAMPLES_PER_DEG = SRTM1_GRID_SIZE - 1;

/** Where committed site definitions live, relative to the repository root. */
export const SITE_DEFINITION_DIR = 'sites';

/** Where a built package lands. Gitignored: a package is tens of megabytes. */
export const SITE_PACKAGE_DIR = 'data/sites';

export interface SiteDefinition {
  /** Directory-safe id; `sites/<id>.json` and `data/sites/<id>/`. */
  readonly id: string;
  /** What a person calls the place. */
  readonly name: string;
  readonly observer: LatLng;
  /** Radius of the 360° sweep this package promises to cover, in km. */
  readonly sweepRadiusKm: number;
  /**
   * Terrain cut BEYOND the sweep, in km.
   *
   * A box snapped outward onto whole posting lines clears the sweep's own ray
   * ends by less than one posting, which is enough for those rays and nothing
   * else. So the margin is stated per site rather than assumed: it is the room an
   * auto-trim search or a corrected position has before it walks off the cut.
   */
  readonly terrainMarginKm: number;
  /** Region directory under `fixtures/peaks/regions/` that names this site's summits. */
  readonly peakRegion: string;
  /** The photograph this viewpoint was established from, if there is one. */
  readonly photo?: string;
  /** Why this site exists, and anything a reader of the package should know. */
  readonly note?: string;
}

function fail(label: string, detail: string): never {
  throw new ProviderError('bad-response', `${label}: ${detail}`);
}

function requireString(raw: Record<string, unknown>, field: string, label: string): string {
  const value = raw[field];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(label, `"${field}" must be a non-empty string`);
  }
  return value;
}

function requireNumber(raw: Record<string, unknown>, field: string, label: string): number {
  const value = raw[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(label, `"${field}" must be a finite number, got ${String(value)}`);
  }
  return value;
}

/**
 * Validate a site definition read off disk.
 *
 * A definition is data crossing a boundary, so it is checked rather than merely
 * typed — the rule `parseTerrainManifest` and `parsePeakCellIndex` both follow. A
 * wrong sign on a longitude cuts a package on the far side of the planet, and
 * every byte in it looks fine.
 */
export function parseSiteDefinition(value: unknown, label: string): SiteDefinition {
  if (typeof value !== 'object' || value === null) {
    fail(label, 'expected a site definition object');
  }
  const raw = value as Record<string, unknown>;
  const id = requireString(raw, 'id', label);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    fail(label, `"id" must be lower-case letters, digits and dashes, got "${id}"`);
  }
  const observerRaw = raw['observer'];
  if (typeof observerRaw !== 'object' || observerRaw === null) {
    fail(label, '"observer" must be an object with lat and lon');
  }
  const observer = observerRaw as Record<string, unknown>;
  const lat = requireNumber(observer, 'lat', `${label} observer`);
  const lon = requireNumber(observer, 'lon', `${label} observer`);
  if (lat < -90 || lat > 90) fail(label, `observer latitude ${lat} is outside [-90, 90]`);
  if (lon < -180 || lon > 180) fail(label, `observer longitude ${lon} is outside [-180, 180]`);

  const sweepRadiusKm = requireNumber(raw, 'sweepRadiusKm', label);
  if (sweepRadiusKm <= 0) fail(label, `"sweepRadiusKm" must be positive, got ${sweepRadiusKm}`);
  const terrainMarginKm = requireNumber(raw, 'terrainMarginKm', label);
  if (terrainMarginKm < 0) fail(label, `"terrainMarginKm" must be >= 0, got ${terrainMarginKm}`);

  let site: SiteDefinition = {
    id,
    name: requireString(raw, 'name', label),
    observer: { lat, lon },
    sweepRadiusKm,
    terrainMarginKm,
    peakRegion: requireString(raw, 'peakRegion', label),
  };
  const photo = raw['photo'];
  if (typeof photo === 'string') site = { ...site, photo };
  const note = raw['note'];
  return typeof note === 'string' ? { ...site, note } : site;
}

/**
 * The cut, in whole postings from the equator and the prime meridian.
 *
 * Integers, because a 1/3600° grid line is not representable in binary floating
 * point: the arithmetic mapping a mosaic sample back to its source tile has to be
 * exact, and `northLat − row × step` is not.
 */
export interface SiteCut {
  readonly northAs: number;
  readonly southAs: number;
  readonly westAs: number;
  readonly eastAs: number;
}

/** Which tile sample a mosaic cell is a copy of. */
export interface MosaicSampleSource {
  readonly tileName: string;
  readonly rowInTile: number;
  readonly colInTile: number;
}

/** One bearing's answer to "does the package hold the ground the sweep reads?". */
export interface RingCoverage {
  readonly bearingDeg: number;
  readonly point: LatLng;
  readonly covered: boolean;
}

export interface SiteMosaicOptions {
  /**
   * Postings per degree of the source tiles. Defaults to SRTM1's 3600.
   *
   * A parameter so unit tests can exercise the seam arithmetic on tiles small
   * enough to reason about by hand. Production packages are cut at the source
   * posting and never resampled: a smoothed ridge crest is a false `visible`.
   */
  readonly samplesPerDeg?: number;
}

/**
 * Everything derived from a site and a posting, computed once.
 *
 * One object rather than a dozen functions that each recompute the cut, because
 * the row, column and tile arithmetic all have to agree — `tileNames` listing a
 * tile `assemble` never opens would be a silent hole in the mosaic.
 */
export interface SiteMosaicPlan {
  readonly site: SiteDefinition;
  readonly samplesPerDeg: number;
  /** Tile width in samples, both edges included. */
  readonly tileGridSize: number;
  readonly stepDeg: number;
  /** How far out terrain is cut: the sweep plus its stated margin. */
  readonly cutRadiusKm: number;
  readonly cut: SiteCut;
  readonly geometry: GridGeometry;
  /** Raw bytes the assembled mosaic occupies. */
  readonly byteLength: number;
  /** Whole tiles the cut draws on, sorted. */
  readonly tileNames: readonly string[];
  /** Where one mosaic cell is copied from. */
  sampleSource(row: number, col: number): MosaicSampleSource;
  /** Copy the mosaic out of whole tile bytes, keyed by tile name. */
  assemble(tiles: ReadonlyMap<string, Uint8Array>): Uint8Array;
  /** The one index entry this package publishes. */
  grid(url: string): TerrainGrid;
  /** The index `HttpTerrainStore` reads. */
  manifest(url: string): TerrainManifest;
  /** Whether a 360° sweep's ray ends at `radiusKm` land inside the cut. */
  ringCoverage(radiusKm: number, bearingCount: number): readonly RingCoverage[];
}

/**
 * The smallest posting-aligned box enclosing the cut disc, and the mosaic in it.
 *
 * North and south come from `destinationPoint` on the same sphere the sweep
 * walks, so "the ray end at the declared radius is inside the cut" is a fact
 * about the geodesy that produced the ray. A kilometres-per-degree constant
 * disagrees with that sphere by ~70 m at this radius.
 *
 * East and west come from the closed form for the extreme longitude of a
 * spherical circle. The easternmost point is where the circle runs due north,
 * which puts a right angle there in the triangle pole–centre–point; the spherical
 * rule for a right triangle gives `sin Δλ = sin δ / cos φ`, with δ the angular
 * radius. Sampling bearings only approaches that value from below, and a box that
 * misses the extreme by a posting is a sweep that runs off the data at one
 * bearing in 720.
 */
export function planSiteMosaic(
  site: SiteDefinition,
  options: SiteMosaicOptions = {},
): SiteMosaicPlan {
  const samplesPerDeg = options.samplesPerDeg ?? SRTM1_SAMPLES_PER_DEG;
  if (!Number.isInteger(samplesPerDeg) || samplesPerDeg < 1) {
    throw new ProviderError(
      'bad-tile',
      `samplesPerDeg must be a positive integer, got ${samplesPerDeg}`,
    );
  }
  const tileGridSize = samplesPerDeg + 1;
  const stepDeg = 1 / samplesPerDeg;
  const cutRadiusKm = site.sweepRadiusKm + site.terrainMarginKm;
  const radiusM = cutRadiusKm * 1000;

  const angularRadius = radiusM / EARTH_RADIUS_M;
  const sinDeltaLon = Math.sin(angularRadius) / Math.cos((site.observer.lat * Math.PI) / 180);
  if (!(sinDeltaLon < 1)) {
    throw new ProviderError(
      'bad-tile',
      `A ${cutRadiusKm} km circle around ${site.observer.lat} N reaches around a pole, so it ` +
        'has no longitude box. Package a polar site as whole tiles instead.',
    );
  }
  const deltaLonDeg = (Math.asin(sinDeltaLon) * 180) / Math.PI;

  const cut: SiteCut = {
    northAs: Math.ceil(destinationPoint(site.observer, 0, radiusM).lat * samplesPerDeg),
    southAs: Math.floor(destinationPoint(site.observer, 180, radiusM).lat * samplesPerDeg),
    westAs: Math.floor((site.observer.lon - deltaLonDeg) * samplesPerDeg),
    eastAs: Math.ceil((site.observer.lon + deltaLonDeg) * samplesPerDeg),
  };

  const rows = cut.northAs - cut.southAs + 1;
  const cols = cut.eastAs - cut.westAs + 1;
  const geometry: GridGeometry = {
    northLat: cut.northAs / samplesPerDeg,
    westLon: cut.westAs / samplesPerDeg,
    rows,
    cols,
    latStepDeg: stepDeg,
    lonStepDeg: stepDeg,
  };

  // Both bands are a floor, which is also how `sampleSource` reads a boundary
  // line: from the tile whose interior lies north or east of it. Any other rule
  // here would list a tile `assemble` never opens, or omit one it does.
  const tileNames: string[] = [];
  for (
    let lat = Math.floor(cut.southAs / samplesPerDeg);
    lat <= Math.floor(cut.northAs / samplesPerDeg);
    lat += 1
  ) {
    for (
      let lon = Math.floor(cut.westAs / samplesPerDeg);
      lon <= Math.floor(cut.eastAs / samplesPerDeg);
      lon += 1
    ) {
      tileNames.push(tileNameForCorner({ southLat: lat, westLon: lon }));
    }
  }
  tileNames.sort();

  const gridName = `${site.id}-${site.sweepRadiusKm}km`;

  const plan: SiteMosaicPlan = {
    site,
    samplesPerDeg,
    tileGridSize,
    stepDeg,
    cutRadiusKm,
    cut,
    geometry,
    byteLength: rows * cols * BYTES_PER_SAMPLE,
    tileNames,

    sampleSource(row, col) {
      if (
        !Number.isInteger(row) ||
        !Number.isInteger(col) ||
        row < 0 ||
        col < 0 ||
        row >= rows ||
        col >= cols
      ) {
        throw new ProviderError(
          'bad-tile',
          `Mosaic cell (${row}, ${col}) is outside the ${rows}x${cols} cut for ${site.id}`,
        );
      }
      const latAs = cut.northAs - row;
      const lonAs = cut.westAs + col;
      const latBand = Math.floor(latAs / samplesPerDeg);
      const lonBand = Math.floor(lonAs / samplesPerDeg);
      return {
        tileName: tileNameForCorner({ southLat: latBand, westLon: lonBand }),
        rowInTile: (latBand + 1) * samplesPerDeg - latAs,
        colInTile: lonAs - lonBand * samplesPerDeg,
      };
    },

    assemble(tiles) {
      const expectedTileBytes = tileGridSize * tileGridSize * BYTES_PER_SAMPLE;
      const sources = new Map<string, Uint8Array>();
      for (const name of tileNames) {
        const bytes = tiles.get(name);
        if (bytes === undefined) {
          throw new ProviderError(
            'bad-tile',
            `${site.id} needs tile ${name}, which was not supplied. Fetch them: ` +
              `npm run fetch:tiles -- ${tileNames.join(' ')}`,
          );
        }
        if (bytes.length !== expectedTileBytes) {
          throw new ProviderError(
            'bad-tile',
            `${name} is ${bytes.length} bytes; this cut is made at ${samplesPerDeg} postings ` +
              `per degree and needs exactly ${expectedTileBytes} ` +
              `(${tileGridSize}x${tileGridSize}). Resampling a coarser tile would smooth the ` +
              'ridge crests the occlusion rule turns on.',
          );
        }
        sources.set(name, bytes);
      }

      const out = new Uint8Array(rows * cols * BYTES_PER_SAMPLE);
      const tileRowBytes = tileGridSize * BYTES_PER_SAMPLE;
      for (let row = 0; row < rows; row += 1) {
        const latAs = cut.northAs - row;
        const latBand = Math.floor(latAs / samplesPerDeg);
        const rowInTile = (latBand + 1) * samplesPerDeg - latAs;
        let col = 0;
        while (col < cols) {
          const lonAs = cut.westAs + col;
          const lonBand = Math.floor(lonAs / samplesPerDeg);
          const colInTile = lonAs - lonBand * samplesPerDeg;
          // The run ends where the next tile starts, or where the cut does.
          const runCols = Math.min(cols - col, samplesPerDeg - colInTile);
          // A run of no columns cannot happen from correct band arithmetic, and it
          // would spin here forever rather than produce a wrong mosaic. Raising is
          // how a broken index becomes a build failure instead of a hung build.
          if (runCols < 1) {
            throw new ProviderError(
              'bad-tile',
              `${site.id}: mosaic column ${col} produced a run of ${runCols} samples ` +
                `(tile column ${colInTile} of ${samplesPerDeg}), which is not possible from ` +
                'the cut. The band arithmetic is wrong.',
            );
          }
          const name = tileNameForCorner({ southLat: latBand, westLon: lonBand });
          const bytes = sources.get(name);
          if (bytes === undefined) {
            throw new ProviderError('bad-tile', `${site.id}: mosaic run needs untracked ${name}`);
          }
          const from = rowInTile * tileRowBytes + colInTile * BYTES_PER_SAMPLE;
          out.set(
            bytes.subarray(from, from + runCols * BYTES_PER_SAMPLE),
            (row * cols + col) * BYTES_PER_SAMPLE,
          );
          col += runCols;
        }
      }
      return out;
    },

    grid(url) {
      return {
        name: gridName,
        url,
        dataset: 'srtm1',
        geometry,
        source:
          `${site.name} field site — a ${site.sweepRadiusKm} km sweep disc plus ` +
          `${site.terrainMarginKm} km of margin, mosaicked byte-for-byte from ` +
          `${tileNames.join(', ')}`,
      };
    },

    manifest(url) {
      return {
        version: TERRAIN_MANIFEST_VERSION,
        note:
          `Terrain for the ${site.name} field site, built by scripts/make-site-package.ts. ` +
          `One grid covering a ${site.sweepRadiusKm} km 360-degree sweep around ` +
          `${site.observer.lat}, ${site.observer.lon}. Serve this file and the directory beside ` +
          "it from the app's own origin (MISSION.md decision D7); the grid url is relative to " +
          'this file, so any path prefix works.',
        grids: [plan.grid(url)],
      };
    },

    ringCoverage(radiusKm, bearingCount) {
      return Array.from({ length: bearingCount }, (_unused, index): RingCoverage => {
        const bearingDeg = (index * 360) / bearingCount;
        const point = destinationPoint(site.observer, bearingDeg, radiusKm * 1000);
        return { bearingDeg, point, covered: gridContains(geometry, point.lat, point.lon) };
      });
    },
  };
  return plan;
}
