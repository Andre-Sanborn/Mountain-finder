/**
 * Build a field-site package — the terrain and summits for one viewpoint.
 *
 *   npm run site:package -- bogus-basin
 *   npm run site:package -- bogus-basin --gzip
 *   npm run site:package -- bogus-basin --fetch        # download missing tiles
 *
 * A site is a place someone stands (`sites/<id>.json`). Its package is the
 * terrain a 360° sweep from that spot reads, mosaicked out of whole SRTM tiles
 * and published in the format `HttpTerrainStore` already reads, beside the peak
 * region that names the summits:
 *
 *   data/sites/<id>/terrain/manifest.json          the index the app reads first
 *   data/sites/<id>/terrain/windows/<grid>.i16be   one mosaic, big-endian int16
 *   data/sites/<id>/terrain/windows/<grid>.json    its provenance, tile by tile
 *   data/sites/<id>/peaks/<region>/…               index.json + cells/, verbatim
 *   data/sites/<id>/site.json                      the definition and the measurements
 *
 * `data/sites/` is gitignored. A package is tens of megabytes of radar; it is
 * rebuilt from the committed definition and the tiles, never committed.
 *
 * ── WHY A CUT AND NOT WHOLE TILES ──────────────────────────────────────────
 * Recommendation 3 of docs/DEPLOY.md, with the bytes measured rather than
 * assumed. `scripts/package-deploy.ts` stages whole 1° tiles, which for Bogus
 * Basin is four of them — 103.74 MB — and the app then downloads only the ONE a
 * viewpoint falls in, so the sweep sees a quarter of its own terrain. The cut is
 * a single grid covering the whole disc, and the report below prints what it
 * costs raw and gzipped so the radius can be argued about with numbers.
 *
 * ── WHAT IT VERIFIES BEFORE IT CALLS ITSELF DONE ───────────────────────────
 * Every sample on a tile boundary the cut crosses is compared byte for byte with
 * the tile it was copied from, and with the neighbour holding the same line
 * (`verifySeams`).
 *
 * Then the package is read back the way a browser reads it, through
 * `HttpTerrainStore` over a `fetch` that serves the files just written: every ray
 * end of the declared 360° sweep must read real terrain, the observer must stand
 * on real ground, and one full `annotateScene` run must complete — timed, and
 * reported with the machine it ran on. Pass `--no-verify` to skip that, which
 * also skips the only evidence the package works.
 *
 * ACQUISITION-TIME TOOL. It reads local files. With `--fetch` it runs
 * `scripts/fetch-tiles.ts`, which is the one step that talks to the network.
 */

import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import { annotateScene } from '../src/pipeline/annotate.js';
import type { CameraPose } from '../src/core/types.js';
import { BYTES_PER_SAMPLE } from '../src/providers/hgt-tile.js';
import { loadPeakCellIndex } from '../src/providers/peak-directory.js';
import { HttpTerrainStore, type TerrainFetchResponse } from '../src/providers/http-terrain-store.js';
import { TileElevationProvider } from '../src/providers/tile-elevation.js';
import { tileNameForCorner } from '../src/providers/tile-store.js';
import {
  SITE_DEFINITION_DIR,
  SITE_PACKAGE_DIR,
  parseSiteDefinition,
  planSiteMosaic,
  type SiteDefinition,
  type SiteMosaicPlan,
} from '../src/sites/site-package.js';

/** Where whole tiles land — the same directory `npm run fetch:tiles` writes. */
const TILE_DIR = 'data/tiles';

/** Where imported peak regions live. */
const PEAK_REGION_DIR = 'fixtures/peaks/regions';

/** Ray ends checked around the sweep. 72 bearings is the acceptance suite's ring. */
const RING_BEARINGS = 72;

/**
 * The pose and sweep the verification run uses.
 *
 * A heading of 0 and a 60° frame are arbitrary and stated: this run measures
 * whether the package answers a whole sweep and how long that takes, and neither
 * depends on where the camera happens to point. `nearFieldRadiusM` is 150 m, the
 * figure docs/NEAR-FIELD.md derives and `npm run annotate` uses, so the timing
 * covers the near-field band as well as the sweep.
 */
const VERIFY_CAMERA: CameraPose = {
  headingDeg: 0,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: 60,
  vFovDeg: 45,
};
const VERIFY_EYE_HEIGHT_M = 1.6;
const VERIFY_BEARING_STEP_DEG = 0.5;
const VERIFY_RANGE_STEP_M = 90;
const VERIFY_NEAR_FIELD_RADIUS_M = 150;

interface Options {
  readonly siteId: string;
  readonly sitesDir: string;
  readonly tileDir: string;
  readonly outDir: string | null;
  readonly gzip: boolean;
  readonly includePeaks: boolean;
  readonly verify: boolean;
  readonly fetchTiles: boolean;
}

const USAGE = `
Usage: npm run site:package -- <site-id> [options]

  --out <dir>       where to write the package (default ${SITE_PACKAGE_DIR}/<site-id>)
  --sites-dir <dir> where the definitions live (default ${SITE_DEFINITION_DIR})
  --tiles-dir <dir> where whole .hgt tiles live (default ${TILE_DIR})
  --fetch           download any missing tile with npm run fetch:tiles
  --gzip            also write a .gz sibling of the mosaic
  --no-peaks        do not stage the peak region
  --no-verify       skip reading the package back and timing a sweep
`;

function parseArgs(argv: readonly string[]): Options {
  let siteId: string | null = null;
  let sitesDir = SITE_DEFINITION_DIR;
  let tileDir = TILE_DIR;
  let outDir: string | null = null;
  let gzip = false;
  let includePeaks = true;
  let verify = true;
  let fetchTiles = false;

  const value = (index: number, flag: string): string => {
    const next = argv[index];
    if (next === undefined) throw new Error(`${flag} needs a value`);
    return next;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--out': outDir = value(index + 1, arg); index += 1; break;
      case '--sites-dir': sitesDir = value(index + 1, arg); index += 1; break;
      case '--tiles-dir': tileDir = value(index + 1, arg); index += 1; break;
      case '--gzip': gzip = true; break;
      case '--no-peaks': includePeaks = false; break;
      case '--no-verify': verify = false; break;
      case '--fetch': fetchTiles = true; break;
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
  return { siteId, sitesDir, tileDir, outDir, gzip, includePeaks, verify, fetchTiles };
}

function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Run `npm run fetch:tiles` for the tiles that are not on disk yet. */
async function fetchMissingTiles(missing: readonly string[]): Promise<void> {
  process.stdout.write(`  fetching ${missing.join(', ')} …\n`);
  await new Promise<void>((done, failed) => {
    const child = spawn('npx', ['tsx', 'scripts/fetch-tiles.ts', ...missing], {
      stdio: 'inherit',
    });
    child.on('error', failed);
    child.on('exit', (code) => {
      if (code === 0) done();
      else failed(new Error(`fetch-tiles exited with code ${String(code)}`));
    });
  });
}

/** Read every tile the cut needs, fetching first when asked to. */
async function readTiles(
  plan: SiteMosaicPlan,
  options: Options,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const paths = new Map(
    plan.tileNames.map((name) => [name, join(options.tileDir, `${name}.hgt`)] as const),
  );
  const missing: string[] = [];
  for (const [name, path] of paths) if (!(await exists(path))) missing.push(name);

  if (missing.length > 0) {
    if (!options.fetchTiles) {
      throw new Error(
        `${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not in ${options.tileDir}/. ` +
          `Fetch first:\n  npm run fetch:tiles -- ${missing.join(' ')}\n` +
          'or re-run this with --fetch.',
      );
    }
    await fetchMissingTiles(missing);
  }

  const tiles = new Map<string, Uint8Array>();
  for (const [name, path] of paths) tiles.set(name, await readFile(path));
  return tiles;
}

/**
 * How far two tiles may disagree about the edge line they share, in metres.
 *
 * They should not disagree at all: both hold the same posting. In the AWS skadi
 * tiles around Bogus Basin, 4 of 14 404 boundary samples do, every one of them by
 * exactly 1 m — rounding somewhere upstream of the mirror, not a shift. 5 m keeps
 * room for that while still being far below what a mis-registered row would cost
 * in this terrain, where a 30 m step moves the surface tens of metres. The
 * load-bearing check is the byte comparison against the tile the mosaic actually
 * read; this bound is what stops that 1 m becoming a habit nobody measures.
 */
const SEAM_NEIGHBOUR_TOLERANCE_M = 5;

interface SeamReport {
  readonly latitudeSeams: number;
  readonly longitudeSeams: number;
  /** Boundary samples compared against their source tile, byte for byte. */
  readonly samples: number;
  /** Samples where the two tiles sharing the line disagree about it. */
  readonly neighbourDisagreements: number;
  readonly maxNeighbourDisagreementM: number;
}

/**
 * Check every boundary sample of the mosaic against the tile it was copied from,
 * and against the neighbour that holds the same line.
 *
 * Adjacent SRTM tiles repeat their shared edge line, so a boundary sample exists
 * in two files and the assembler reads it from one of them. An off-by-one row or
 * column there yields real elevations from the wrong ground, which is the failure
 * with no symptoms this project keeps designing against. So the comparison
 * against the tile the mosaic READ is exact and fatal, at the production posting
 * on the real data. The unit tests make the same comparison on tiles small enough
 * to check by hand.
 *
 * The neighbour is a second, weaker check, because the two tiles do not always
 * agree with each other — see `SEAM_NEIGHBOUR_TOLERANCE_M`. Its disagreements are
 * counted and reported rather than treated as this script's bug.
 */
function verifySeams(
  plan: SiteMosaicPlan,
  tiles: ReadonlyMap<string, Uint8Array>,
  mosaic: Uint8Array,
): SeamReport {
  const { samplesPerDeg, tileGridSize, cut } = plan;
  const { rows, cols } = plan.geometry;
  const mosaicView = new DataView(mosaic.buffer, mosaic.byteOffset, mosaic.byteLength);

  const tileSample = (southLat: number, westLon: number, row: number, col: number): number => {
    const name = tileNameForCorner({ southLat, westLon });
    const bytes = tiles.get(name);
    if (bytes === undefined) throw new Error(`Seam check needs tile ${name}, which is not loaded`);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getInt16(
      (row * tileGridSize + col) * BYTES_PER_SAMPLE,
    );
  };

  let samples = 0;
  let neighbourDisagreements = 0;
  let maxNeighbourDisagreementM = 0;

  /** Compare one boundary sample against its own tile, then against the neighbour. */
  const check = (
    row: number,
    col: number,
    own: number,
    neighbour: number,
    where: string,
  ): void => {
    const value = mosaicView.getInt16((row * cols + col) * BYTES_PER_SAMPLE);
    if (value !== own) {
      throw new Error(
        `${where}: the mosaic holds ${value} m where the tile it was cut from holds ${own} m. ` +
          'The cut is off by a row or a column at a tile boundary, which reads real elevations ' +
          'from the wrong ground.',
      );
    }
    samples += 1;
    const delta = Math.abs(own - neighbour);
    if (delta === 0) return;
    neighbourDisagreements += 1;
    maxNeighbourDisagreementM = Math.max(maxNeighbourDisagreementM, delta);
    if (delta > SEAM_NEIGHBOUR_TOLERANCE_M) {
      throw new Error(
        `${where}: the two tiles sharing this line disagree by ${delta} m (${own} against ` +
          `${neighbour}), which is more than the ${SEAM_NEIGHBOUR_TOLERANCE_M} m a rounding ` +
          'difference explains. One of the tiles is not the square degree its name claims.',
      );
    }
  };

  let latitudeSeams = 0;
  for (
    let band = Math.floor(cut.southAs / samplesPerDeg) + 1;
    band * samplesPerDeg <= cut.northAs;
    band += 1
  ) {
    const latAs = band * samplesPerDeg;
    if (latAs <= cut.southAs) continue;
    latitudeSeams += 1;
    const row = cut.northAs - latAs;
    for (let col = 0; col < cols; col += 1) {
      const lonAs = cut.westAs + col;
      const lon = Math.floor(lonAs / samplesPerDeg);
      const colInTile = lonAs - lon * samplesPerDeg;
      // The mosaic reads the line from the tile NORTH of it, as that tile's last row.
      check(
        row,
        col,
        tileSample(band, lon, samplesPerDeg, colInTile),
        tileSample(band - 1, lon, 0, colInTile),
        `latitude seam at ${latAs / samplesPerDeg} N, mosaic (${row}, ${col})`,
      );
    }
  }

  let longitudeSeams = 0;
  for (
    let band = Math.floor(cut.westAs / samplesPerDeg) + 1;
    band * samplesPerDeg <= cut.eastAs;
    band += 1
  ) {
    const lonAs = band * samplesPerDeg;
    if (lonAs <= cut.westAs) continue;
    longitudeSeams += 1;
    const col = lonAs - cut.westAs;
    for (let row = 0; row < rows; row += 1) {
      const latAs = cut.northAs - row;
      const lat = Math.floor(latAs / samplesPerDeg);
      const rowInTile = (lat + 1) * samplesPerDeg - latAs;
      // The mosaic reads the line from the tile EAST of it, as that tile's first column.
      check(
        row,
        col,
        tileSample(lat, band, rowInTile, 0),
        tileSample(lat, band - 1, rowInTile, samplesPerDeg),
        `longitude seam at ${lonAs / samplesPerDeg} E, mosaic (${row}, ${col})`,
      );
    }
  }

  return {
    latitudeSeams,
    longitudeSeams,
    samples,
    neighbourDisagreements,
    maxNeighbourDisagreementM,
  };
}

async function gzipTo(from: string, to: string): Promise<number> {
  await pipeline(createReadStream(from), createGzip({ level: 6 }), createWriteStream(to));
  return (await stat(to)).size;
}

/** Copy the peak region verbatim: index plus every cell, in `TiledPeakStore` layout. */
async function stagePeakRegion(
  region: string,
  outDir: string,
): Promise<{ readonly cells: number; readonly bytes: number }> {
  const from = join(PEAK_REGION_DIR, region);
  const to = join(outDir, 'peaks', region);
  await rm(to, { recursive: true, force: true });
  await mkdir(join(to, 'cells'), { recursive: true });

  // The index is copied WHOLE, bounds and peak count included. Trimming it to the
  // cells one site touches would restate the area the import was cut for, and
  // `coverageFor` reads that area to decide whether a query overflows the data.
  const index = await readFile(join(from, 'index.json'));
  await writeFile(join(to, 'index.json'), index);
  let bytes = index.length;
  let cells = 0;
  for (const cell of await readdir(join(from, 'cells'))) {
    if (!cell.endsWith('.json')) continue;
    const contents = await readFile(join(from, 'cells', cell));
    await writeFile(join(to, 'cells', cell), contents);
    bytes += contents.length;
    cells += 1;
  }
  return { cells, bytes };
}

/** A `fetch` that serves the package straight off disk, the way a host would. */
function packageFetch(outDir: string): (url: string) => Promise<TerrainFetchResponse> {
  // Root-relative URLs are served from the package root, exactly as a static
  // host would serve them — so `/terrain/windows/x.i16be` is a path, not a hint.
  return async (url: string): Promise<TerrainFetchResponse> => {
    const path = resolve(outDir, url.replace(/^\//, ''));
    let bytes: Buffer;
    try {
      bytes = await readFile(path);
    } catch {
      return {
        ok: false,
        status: 404,
        arrayBuffer: () => Promise.reject(new Error(`${path} is not in the package`)),
        json: () => Promise.reject(new Error(`${path} is not in the package`)),
      };
    }
    return {
      ok: true,
      status: 200,
      arrayBuffer: () => {
        const copy = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(copy).set(bytes);
        return Promise.resolve(copy);
      },
      json: () => Promise.resolve(JSON.parse(bytes.toString('utf8')) as unknown),
    };
  };
}

interface VerifyReport {
  readonly observerGroundM: number;
  readonly ringRadiusKm: number;
  readonly ringBearings: number;
  readonly ringUncovered: readonly number[];
  readonly sweepMs: number;
  readonly raysRequested: number;
  readonly raysWithTerrain: number;
  readonly samplesWithElevation: number;
  readonly samplesRequested: number;
  readonly labelled: number;
  readonly marginal: number;
  readonly machine: string;
}

/**
 * Read the package back as a browser would, then sweep it once and time that.
 *
 * The store here is `HttpTerrainStore` over a `fetch` that returns the files just
 * written, so what is exercised is the app's own code path rather than a
 * shortcut through the filesystem: the index is parsed, the grid's byte length is
 * checked against the geometry, and the samples are read through `parseGridWindow`.
 */
async function verifyPackage(
  site: SiteDefinition,
  plan: SiteMosaicPlan,
  outDir: string,
  manifestUrl: string,
): Promise<VerifyReport> {
  const store = new HttpTerrainStore(manifestUrl, { fetch: packageFetch(outDir) });
  const elevation = new TileElevationProvider(store);

  const ring = plan.ringCoverage(site.sweepRadiusKm, RING_BEARINGS);
  const samples = await elevation.fetchElevations(ring.map((entry) => entry.point));
  const uncovered: number[] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const entry = ring[index];
    const sample = samples[index];
    if (entry === undefined) continue;
    if (!entry.covered || sample === undefined || sample.elevationM === null) {
      uncovered.push(entry.bearingDeg);
    }
  }

  const observer = await elevation.fetchElevations([site.observer]);
  const ground = observer[0]?.elevationM;
  if (ground === null || ground === undefined) {
    throw new Error(
      `The package holds no elevation at the observer itself (${site.observer.lat}, ` +
        `${site.observer.lon}). Something is wrong with the cut, not with the radius.`,
    );
  }

  const peaks = await loadPeakCellIndex(join(outDir, 'peaks', site.peakRegion, 'index.json'));

  const startedAt = process.hrtime.bigint();
  const scene = await annotateScene({
    observer: { lat: site.observer.lat, lon: site.observer.lon, eyeHeightM: VERIFY_EYE_HEIGHT_M },
    camera: VERIFY_CAMERA,
    elevation,
    peaks,
    config: {
      sweep: {
        bearingStepDeg: VERIFY_BEARING_STEP_DEG,
        rangeStepM: VERIFY_RANGE_STEP_M,
        maxRangeKm: site.sweepRadiusKm,
        spanDeg: 360,
      },
      peakRadiusKm: site.sweepRadiusKm,
      nearFieldRadiusM: VERIFY_NEAR_FIELD_RADIUS_M,
    },
  });
  const sweepMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

  return {
    observerGroundM: ground,
    ringRadiusKm: site.sweepRadiusKm,
    ringBearings: RING_BEARINGS,
    ringUncovered: uncovered,
    sweepMs,
    raysRequested: scene.sweep.raysRequested,
    raysWithTerrain: scene.sweep.raysWithTerrain,
    samplesRequested: scene.sweep.samplesRequested,
    samplesWithElevation: scene.sweep.samplesWithElevation,
    labelled: scene.labelled.length,
    marginal: scene.marginal.length,
    machine: `${cpus()[0]?.model ?? 'unknown CPU'}, node ${process.version}`,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const definitionPath = join(options.sitesDir, `${options.siteId}.json`);
  const site = parseSiteDefinition(
    JSON.parse(await readFile(definitionPath, 'utf8')) as unknown,
    definitionPath,
  );
  const plan = planSiteMosaic(site);
  const outDir = resolve(options.outDir ?? join(SITE_PACKAGE_DIR, site.id));

  const line = (text = ''): void => {
    process.stdout.write(`${text}\n`);
  };

  line(`Site package — ${site.name} (${site.id})`);
  line(`  viewpoint       ${site.observer.lat}, ${site.observer.lon}`);
  line(
    `  sweep           ${site.sweepRadiusKm} km, 360 degrees ` +
      `(+${site.terrainMarginKm} km of margin cut)`,
  );
  line(
    `  cut             ${plan.geometry.rows} x ${plan.geometry.cols} samples at 1/` +
      `${plan.samplesPerDeg} deg, ${mb(plan.byteLength)} raw`,
  );
  line(`  tiles           ${plan.tileNames.join(', ')}`);
  line();

  const tiles = await readTiles(plan, options);
  const wholeTileBytes = [...tiles.values()].reduce((total, bytes) => total + bytes.length, 0);

  const gridName = plan.grid('').name;
  const dataName = `${gridName}.i16be`;
  const gridUrl = `windows/${dataName}`;
  const manifestUrl = '/terrain/manifest.json';
  const terrainDir = join(outDir, 'terrain');
  await rm(terrainDir, { recursive: true, force: true });
  await mkdir(join(terrainDir, 'windows'), { recursive: true });

  const mosaic = plan.assemble(tiles);
  const dataPath = join(terrainDir, 'windows', dataName);
  await writeFile(dataPath, mosaic);
  const manifest = plan.manifest(gridUrl);
  await writeFile(
    join(terrainDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );

  const seams = verifySeams(plan, tiles, mosaic);

  const gzipBytes = options.gzip ? await gzipTo(dataPath, `${dataPath}.gz`) : undefined;

  // Provenance beside the bytes: a mosaic's source is four tiles and their
  // offsets, which no single `.hgt` name can carry.
  const corners = [
    ['north-west', 0, 0],
    ['north-east', 0, plan.geometry.cols - 1],
    ['south-west', plan.geometry.rows - 1, 0],
    ['south-east', plan.geometry.rows - 1, plan.geometry.cols - 1],
  ] as const;
  await writeFile(
    join(terrainDir, 'windows', `${gridName}.json`),
    `${JSON.stringify(
      {
        name: gridName,
        data: dataName,
        format: 'int16-be-row-major-north-first',
        geometry: plan.geometry,
        cutPostings: plan.cut,
        site: { ...site, cutRadiusKm: plan.cutRadiusKm },
        sources: plan.tileNames.map((name) => ({
          tile: name,
          url: `https://s3.amazonaws.com/elevation-tiles-prod/skadi/${name.slice(0, 3)}/${name}.hgt.gz`,
          dataset: 'SRTM1 (1 arc-second) via the AWS elevation-tiles-prod "skadi" mirror',
          license: 'SRTM is public domain (NASA/USGS); the AWS mirror is a public dataset.',
        })),
        cornerSamples: corners.map(([corner, row, col]) => ({
          corner,
          row,
          col,
          ...plan.sampleSource(row, col),
        })),
        accuracyCaveat:
          'Terrain horizon only. SRTM under-reads AND displaces sharp summits, so summit ' +
          'heights come from the peak region in peaks/, never from these bytes.',
        regenerateWith: `npm run site:package -- ${site.id}`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  line('TERRAIN');
  line(`  ${manifestUrl} — 1 grid, ${gridName}`);
  line(
    `  ${gridUrl} — ${mb(mosaic.length)} raw` +
      (gzipBytes === undefined
        ? ''
        : ` → ${mb(gzipBytes)} gzipped (${((gzipBytes / mosaic.length) * 100).toFixed(1)} %)`),
  );
  line(
    `  seams: ${seams.latitudeSeams} latitude, ${seams.longitudeSeams} longitude, ` +
      `${seams.samples} boundary samples byte-identical to the tile each was cut from`,
  );
  line(
    `  the two tiles sharing a line disagree at ${seams.neighbourDisagreements} of those ` +
      `samples, by at most ${seams.maxNeighbourDisagreementM} m (the source's own rounding, ` +
      `tolerated to ${SEAM_NEIGHBOUR_TOLERANCE_M} m)`,
  );
  line(
    `  against whole tiles: ${plan.tileNames.length} x ${mb(wholeTileBytes / plan.tileNames.length)}` +
      ` = ${mb(wholeTileBytes)}, of which one session would download ` +
      `${mb(wholeTileBytes / plan.tileNames.length)} and see a quarter of the sweep`,
  );

  let peakReport: { cells: number; bytes: number; coveredRadiusKm: number; note?: string } | undefined;
  if (options.includePeaks) {
    const staged = await stagePeakRegion(site.peakRegion, outDir);
    const store = await loadPeakCellIndex(join(outDir, 'peaks', site.peakRegion, 'index.json'));
    const coverage = store.coverageFor({ center: site.observer, radiusKm: site.sweepRadiusKm });
    const covered =
      'coveredRadiusKm' in coverage ? (coverage.coveredRadiusKm ?? Number.NaN) : Number.NaN;
    peakReport = {
      ...staged,
      coveredRadiusKm: covered,
      ...(coverage.note === undefined ? {} : { note: coverage.note }),
    };
    const within = await store.peaksWithin(site.observer, site.sweepRadiusKm);
    line();
    line('PEAKS');
    line(
      `  /peaks/${site.peakRegion}/ — ${staged.cells} cells, ${mb(staged.bytes)}, ` +
        `${within.length} named summits inside ${site.sweepRadiusKm} km`,
    );
    if (coverage.complete) {
      line(`  the region covers the whole ${site.sweepRadiusKm} km query`);
    } else {
      line(
        `  INCOMPLETE: the region answers to ${covered.toFixed(1)} km of the ` +
          `${site.sweepRadiusKm} km query. Summits past that are absent by the import's ` +
          'extent, not by absence of mountains.',
      );
      line(`  ${coverage.note ?? ''}`);
    }
  }

  let verifyReport: VerifyReport | undefined;
  if (options.verify) {
    line();
    line('VERIFICATION — the package read back the way the app reads it');
    verifyReport = await verifyPackage(site, plan, outDir, manifestUrl);
    if (verifyReport.ringUncovered.length > 0) {
      throw new Error(
        `The package does not cover the sweep it declares: no terrain at ` +
          `${site.sweepRadiusKm} km on bearing(s) ` +
          `${verifyReport.ringUncovered.join(', ')}. A cut smaller than its sweep reports ` +
          'summits visible that a wider cut would show hidden, so this is a build failure.',
      );
    }
    line(
      `  ${verifyReport.ringBearings} ray ends at ${verifyReport.ringRadiusKm} km all read ` +
        'real terrain',
    );
    line(`  observer ground ${verifyReport.observerGroundM.toFixed(1)} m`);
    line(
      `  annotateScene, 360 deg at ${VERIFY_BEARING_STEP_DEG} deg / ${VERIFY_RANGE_STEP_M} m, ` +
        `nearFieldRadiusM ${VERIFY_NEAR_FIELD_RADIUS_M}: ` +
        `${(verifyReport.sweepMs / 1000).toFixed(2)} s`,
    );
    line(
      `  ${verifyReport.raysWithTerrain} of ${verifyReport.raysRequested} rays carried terrain, ` +
        `${verifyReport.samplesWithElevation} of ${verifyReport.samplesRequested} samples read`,
    );
    line(
      `  ${verifyReport.labelled} labelled summits, ${verifyReport.marginal} of them marginal`,
    );
    line(`  machine: ${verifyReport.machine}`);
  }

  await writeFile(
    join(outDir, 'site.json'),
    `${JSON.stringify(
      {
        site,
        definition: definitionPath,
        cutRadiusKm: plan.cutRadiusKm,
        geometry: plan.geometry,
        tiles: plan.tileNames,
        seams,
        terrain: {
          manifest: 'terrain/manifest.json',
          grid: gridName,
          url: `terrain/${gridUrl}`,
          rawBytes: mosaic.length,
          ...(gzipBytes === undefined ? {} : { gzipBytes }),
          wholeTileBytes,
        },
        ...(peakReport === undefined ? {} : { peaks: peakReport }),
        ...(verifyReport === undefined ? {} : { verification: verifyReport }),
        regenerateWith: `npm run site:package -- ${site.id}`,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  line();
  line(`Wrote ${relative(process.cwd(), outDir) || outDir}/ — gitignored, rebuild it, never commit it.`);
  line('Serve terrain/ at /terrain/ and peaks/ at /peaks/ on the app\'s own origin.');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
