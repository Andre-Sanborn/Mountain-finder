/**
 * Committed inputs for the IMG_7270 heading derivation.
 *
 * `docs/IMG-7270-HEADING.md` cites numbers; this directory prints them, so the
 * document can be checked rather than trusted. Everything here is loaded from
 * files that are in the repository:
 *
 *   fixtures/photos/real/hdr-gainmap-7270.heic        position, time, lens, frame
 *   fixtures/peaks/regions/idaho-bogus-basin/cells/   summit id, coordinate, height
 *
 * The one input that is not committed is the terrain. SRTM tiles are 25 MB each
 * and `.gitignore` keeps them out, so `loadGroundElevationM` returns `undefined`
 * when `data/tiles/` is empty and the caller prints the command that fills it.
 *
 * ── WHAT THESE SCRIPTS WILL NOT DO ─────────────────────────────────────────
 * They write nothing, anywhere. They report to the terminal.
 *
 * No coordinate is written in this source. The viewpoint is read out of the
 * photograph's EXIF at run time and the summits out of the peak cells, which
 * keeps the position out of the file and out of `git grep`. It is a public site
 * coordinate either way — `AGENTS.md` § Privacy records the standing consent
 * for these frames — but a coordinate that is never typed cannot drift from the
 * file it came from.
 */

import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import exifr from 'exifr';

import { findHeifExif, isHeif } from '../../../src/exif/heif.js';
import { DirectoryTileStore } from '../../../src/providers/tile-directory.js';
import { TileElevationProvider } from '../../../src/providers/tile-elevation.js';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PHOTO_DIR = join(REPO_ROOT, 'fixtures', 'photos', 'real');
export const PHOTO_NAME = 'hdr-gainmap-7270.heic';
export const PEAK_CELL_DIR = join(
  REPO_ROOT,
  'fixtures',
  'peaks',
  'regions',
  'idaho-bogus-basin',
  'cells',
);
export const TILE_DIR = join(REPO_ROOT, 'data', 'tiles');

/** What to run when `data/tiles/` has no tile covering the viewpoint. */
export const TILE_HINT =
  'no SRTM tile under data/tiles/ — run: npm run fetch:tiles -- --bbox 43.2,-116.9,44.4,-115.3';

/**
 * Eye above ground. 1.6 m is the project's standing default for a hand-held
 * frame and is not measured; `geometry.ts` reports what changing it costs.
 */
export const EYE_HEIGHT_M = 1.6;

/** Long side of the stored frame, asserted against the EXIF rather than assumed. */
export const ORIGINAL_WIDTH_PX = 8064;
export const ORIGINAL_HEIGHT_PX = 6048;

/**
 * The working frame the annotators read: the 4:3 original centre-cropped to
 * 16:9 and scaled down. The crop takes rows off the top and bottom and keeps
 * the full width, so the horizontal field of view is the original's and only
 * the vertical one changes.
 */
export const WORKING_WIDTH_PX = 1920;
export const WORKING_HEIGHT_PX = 1080;

/**
 * Where two annotators independently put Deer Point's summit in the working
 * frame: the ground crest directly under the mast cluster, not a mast top,
 * which stands about 30 px higher.
 *
 * One agreed pixel is what the record carries. The two readings were never
 * written down separately, so `READ_PRECISION_PX` is a read precision rather
 * than a measured spread, and the error budget says so.
 */
export const ANNOTATED_X_PX = 1335;
export const ANNOTATED_Y_PX = 535;
export const READ_PRECISION_PX = 5;

/**
 * How far a summit node may sit from the ground high point. Overture carries
 * the OpenStreetMap node, which on a summit with buildings on it is placed by
 * eye; 30 m is the project's working figure and the budget is linear in it.
 */
export const SUMMIT_NODE_UNCERTAINTY_M = 30;

/** A point on the ground, in signed decimal degrees. */
export interface Site {
  readonly lat: number;
  readonly lon: number;
}

/** One summit as the committed peak cells carry it. */
export interface Summit extends Site {
  readonly id: string;
  readonly name: string;
  readonly elevationM: number;
  readonly elevationSourceKind?: string;
  readonly cell: string;
}

/** Every EXIF tag `exifr` reports, untranslated values, keys as written. */
export type RawTags = Readonly<Record<string, unknown>>;

/**
 * EXIF out of a HEIC the way `src/exif` does it: walk the container for the
 * `Exif` item, then hand the TIFF block to exifr. exifr's own HEIC detection
 * refuses this file — see `src/exif/heif.ts` for the 50-byte limit that does it.
 */
export async function readRawTags(name: string): Promise<RawTags> {
  const bytes = new Uint8Array(await readFile(join(PHOTO_DIR, name)));
  let tiff: Uint8Array = bytes;
  if (isHeif(bytes)) {
    const found = findHeifExif(bytes);
    if (found.tiff === undefined) {
      throw new Error(`${name}: no EXIF item in the container (${found.failure ?? 'unknown'})`);
    }
    tiff = found.tiff;
  }
  // `reviveValues: false` keeps GPSLatitude as its degree/minute/second triple
  // and DateTimeOriginal as the string EXIF stores, which is what the probes
  // convert themselves. `ifd0` cannot be switched off in exifr and takes format
  // options rather than a boolean, so an empty object means "defaults".
  const tags: unknown = await exifr.parse(tiff, {
    tiff: true,
    exif: true,
    gps: true,
    ifd0: {},
    ifd1: false,
    interop: false,
    mergeOutput: true,
    reviveValues: false,
    translateKeys: true,
    translateValues: false,
  });
  if (typeof tags !== 'object' || tags === null) throw new Error(`${name}: EXIF parsed to nothing`);
  return tags as RawTags;
}

export function numberTag(tags: RawTags, key: string): number | undefined {
  const value = tags[key];
  return typeof value === 'number' ? value : undefined;
}

export function stringTag(tags: RawTags, key: string): string | undefined {
  const value = tags[key];
  return typeof value === 'string' ? value : undefined;
}

function degreesFromSexagesimal(value: unknown, ref: unknown): number | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const [d, m, s] = value as readonly unknown[];
  if (typeof d !== 'number' || typeof m !== 'number' || typeof s !== 'number') return undefined;
  const magnitude = d + m / 60 + s / 3600;
  return ref === 'S' || ref === 'W' ? -magnitude : magnitude;
}

/**
 * The viewpoint, from the photograph's own GPS IFD.
 *
 * The degree/minute/second triple is converted here rather than taken from
 * exifr's derived decimal fields, so the arithmetic is visible in the one place
 * the rest of the derivation depends on.
 */
export function viewpointFrom(tags: RawTags): Site {
  const lat = degreesFromSexagesimal(tags['GPSLatitude'], tags['GPSLatitudeRef']);
  const lon = degreesFromSexagesimal(tags['GPSLongitude'], tags['GPSLongitudeRef']);
  if (lat === undefined || lon === undefined) throw new Error('photograph carries no GPS position');
  return { lat, lon };
}

interface PeakCellFile {
  readonly cell?: unknown;
  readonly peaks?: unknown;
}

/** Every summit in the committed Bogus Basin peak cells. */
export async function loadSummits(): Promise<readonly Summit[]> {
  const names = (await readdir(PEAK_CELL_DIR)).filter((name) => name.endsWith('.json')).sort();
  const summits: Summit[] = [];
  for (const name of names) {
    const parsed: unknown = JSON.parse(await readFile(join(PEAK_CELL_DIR, name), 'utf8'));
    const file = parsed as PeakCellFile;
    const cell = typeof file.cell === 'string' ? file.cell : name.replace(/\.json$/, '');
    if (!Array.isArray(file.peaks)) continue;
    for (const entry of file.peaks as readonly unknown[]) {
      const peak = entry as Partial<Summit>;
      if (
        typeof peak.id !== 'string' ||
        typeof peak.name !== 'string' ||
        typeof peak.lat !== 'number' ||
        typeof peak.lon !== 'number' ||
        typeof peak.elevationM !== 'number'
      ) {
        continue;
      }
      summits.push({
        id: peak.id,
        name: peak.name,
        lat: peak.lat,
        lon: peak.lon,
        elevationM: peak.elevationM,
        elevationSourceKind: peak.elevationSourceKind,
        cell,
      });
    }
  }
  return summits;
}

/** The one summit with this name, or a thrown error naming what was found instead. */
export function summitNamed(summits: readonly Summit[], name: string): Summit {
  const matches = summits.filter((summit) => summit.name === name);
  const only = matches[0];
  if (only === undefined || matches.length !== 1) {
    throw new Error(`expected exactly one summit named ${name}, found ${matches.length}`);
  }
  return only;
}

/** What the terrain reads at a point, or `undefined` when no tile covers it. */
export async function loadGroundElevationM(site: Site): Promise<number | undefined> {
  const elevation = new TileElevationProvider(new DirectoryTileStore(TILE_DIR), {
    interpolation: 'bilinear',
  });
  const sample = await elevation.sampleTerrain(site);
  return sample.status === 'ok' && sample.elevationM !== null ? sample.elevationM : undefined;
}
