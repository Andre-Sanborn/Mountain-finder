/**
 * Assemble a deployable directory — the step between `npm run build` and a
 * static host (docs/DEPLOY.md).
 *
 *   npm run build && npm run package:deploy
 *
 * `vite build` emits the app and nothing else: no terrain, because which square
 * degrees of the planet a deployment wants is a deployment decision and not the
 * bundler's business. The result is a bundle that is *correct* about having no
 * elevation data — it names the missing tile and the command that fetches it —
 * and that is not the same thing as being deployable. This script closes that
 * gap by staging, into the built output:
 *
 *   <out>/terrain/manifest.json     the index `HttpTerrainStore` reads first
 *   <out>/terrain/tiles/*.hgt       whole SRTM tiles from data/tiles/
 *   <out>/terrain/windows/*.i16be   the committed real-SRTM case windows
 *   <out>/terrain/sites/<id>/…      each field site's mosaic (see below)
 *   <out>/peaks/<region>/…          imported Overture peak cells (see below)
 *   <out>/ATTRIBUTION.txt           the licences the staged data carries
 *
 * ── FIELD SITES, IN THE SAME INDEX ─────────────────────────────────────────
 * A site package (`sites/<id>.json`, built by scripts/make-site-package.ts into
 * the gitignored `data/sites/<id>/`) is ONE grid mosaicked across whole tiles to
 * cover a 360° sweep from one viewpoint. Its grids are staged here beside the
 * whole tiles and listed in the SAME manifest, because `selectTerrainGrid` picks
 * the largest grid covering a point: the Bogus Basin mosaic covers 1.64 deg²
 * against a 1° tile's 1.0, so a viewpoint there gets the whole sweep, and a
 * viewpoint anywhere else is unaffected. Two manifests would have needed a
 * second code path and a rule for choosing between them.
 *
 * ── WHY IT REUSES THE DEV PLUGIN'S INDEX BUILDER ───────────────────────────
 * `buildTerrainManifest` (scripts/terrain-server.ts) is the one piece of code
 * that decides what counts as servable terrain, including the rule that
 * synthetic test tiles are never published. Calling it here means a packaged
 * deployment serves exactly what `npm run dev` served — same names, same
 * geometry, same exclusions — instead of a second, subtly different, listing.
 *
 * ── WHAT IT VERIFIES ───────────────────────────────────────────────────────
 * Every staged grid is checked against `expectedGridByteLength` before it is
 * copied. A truncated `.hgt` in data/tiles/ is a plausible-looking grid of the
 * wrong shape; caught here it is a build failure, caught in the browser it is a
 * wrong horizon. The peak side is verified too — see `verifyPeaksAreServed`.
 *
 * ── PEAKS ──────────────────────────────────────────────────────────────────
 * The app READS its summits from `/peaks/` (Q8): `src/app/main.tsx` compiles
 * in the region INDEXES (~10 KB, the same import the attribution footer uses)
 * and fetches summit CELLS on demand through `createRegionPeakSource`. The
 * imported Overture regions under `fixtures/peaks/regions/` — thousands of
 * summits, megabytes of cells, far too much to inline — are therefore staged
 * at `/peaks/<region>/` in exactly the layout `TiledPeakStore` expects, and
 * `verifyPeaksAreServed` FAILS the packaging if the bundle's regions are not
 * all staged: an app that fetches 404s draws empty overlays that read as "no
 * mountains here". In dev the same layout is served by scripts/peaks-server.ts.
 * The 15-summit cited dataset is still compiled in for the footer's count and
 * the acceptance suite; the app no longer queries it.
 *
 * ACQUISITION-TIME TOOL. It never touches the network: everything it stages is
 * already on disk. `npm run fetch:tiles` / `npm run fetch:peaks` put it there.
 */

import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import {
  buildTerrainManifest,
  TERRAIN_BASE,
  TILE_DIR,
  WINDOW_DIR,
} from './terrain-server.js';
import {
  expectedGridByteLength,
  parseTerrainManifest,
  TERRAIN_MANIFEST_VERSION,
  type TerrainGrid,
  type TerrainManifest,
} from '../src/providers/terrain-manifest.js';
import { SITE_DEFINITION_DIR, SITE_PACKAGE_DIR } from '../src/sites/site-package.js';

/** Where imported peak regions live, and where they are served from. */
const PEAK_REGION_DIR = 'fixtures/peaks/regions';
const PEAK_BASE = '/peaks';

/** The bundled peak dataset the app compiles in. */
const BUNDLED_PEAKS = 'fixtures/peaks/ground-truth-peaks.json';

interface Options {
  readonly out: string;
  /** Tile names to stage; empty means "every tile present". */
  readonly tiles: readonly string[];
  readonly includeTiles: boolean;
  readonly includeWindows: boolean;
  readonly includePeaks: boolean;
  /** Field-site ids to stage; empty means "every definition in sites/". */
  readonly sites: readonly string[];
  readonly includeSites: boolean;
  /** Write `.gz` siblings for the grids (see docs/DEPLOY.md). */
  readonly gzip: boolean;
  /** Real copies rather than hard links. */
  readonly copy: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let out = 'dist';
  const tiles: string[] = [];
  let includeTiles = true;
  let includeWindows = true;
  let includePeaks = true;
  const sites: string[] = [];
  let includeSites = true;
  let gzip = false;
  let copy = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    if (arg === '--out') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--out needs a directory');
      out = value;
      index += 1;
    } else if (arg === '--tiles') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--tiles needs a comma-separated list');
      for (const name of value.split(',')) {
        const trimmed = name.trim();
        if (trimmed !== '') tiles.push(trimmed.toUpperCase());
      }
      index += 1;
    } else if (arg === '--sites') {
      const value = argv[index + 1];
      if (value === undefined) throw new Error('--sites needs a comma-separated list');
      for (const id of value.split(',')) {
        const trimmed = id.trim();
        if (trimmed !== '') sites.push(trimmed);
      }
      index += 1;
    } else if (arg === '--no-tiles') includeTiles = false;
    else if (arg === '--no-windows') includeWindows = false;
    else if (arg === '--no-peaks') includePeaks = false;
    else if (arg === '--no-sites') includeSites = false;
    else if (arg === '--gzip') gzip = true;
    else if (arg === '--copy') copy = true;
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else throw new Error(`Unknown option ${arg}\n${USAGE}`);
  }

  return {
    out,
    tiles,
    includeTiles,
    includeWindows,
    includePeaks,
    sites,
    includeSites,
    gzip,
    copy,
  };
}

const USAGE = `
Usage: npm run package:deploy -- [options]

  --out <dir>          built app to package into (default: dist)
  --tiles <A,B,…>      stage only these whole tiles (default: all of data/tiles)
  --no-tiles           stage no whole tiles — case windows only, ~1.4 MB
  --no-windows         stage no case windows
  --no-peaks           do not stage imported peak regions
  --sites <a,b>        stage only these field sites (default: all of sites/)
  --no-sites           stage no field-site mosaics
  --gzip               also write .gz siblings for every grid
  --copy               real copies instead of hard links (for tar/rsync-by-inode)
`;

/** Bytes, in the units a deployment budget is actually written in. */
function mb(bytes: number): string {
  return `${(bytes / 1e6).toFixed(2)} MB`;
}

/** Where a manifest URL's bytes live in this repository. */
function sourceForGrid(root: string, grid: TerrainGrid): string {
  const [kind, name] = grid.url.split('/');
  if (name === undefined || (kind !== 'tiles' && kind !== 'windows')) {
    throw new Error(`Grid ${grid.name} has an unexpected url "${grid.url}"`);
  }
  return resolve(root, kind === 'tiles' ? TILE_DIR : WINDOW_DIR, name);
}

/** Hard link where possible (a 25 MB tile costs nothing), copy when it is not. */
async function place(from: string, to: string, forceCopy: boolean): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await rm(to, { force: true });
  if (!forceCopy) {
    try {
      await link(from, to);
      return;
    } catch {
      // Different filesystem, or a host that dislikes links — fall through.
    }
  }
  await copyFile(from, to);
}

async function gzipTo(from: string, to: string): Promise<number> {
  await pipeline(createReadStream(from), createGzip({ level: 6 }), createWriteStream(to));
  const { size } = await stat(to);
  return size;
}

interface StagedGrid {
  readonly grid: TerrainGrid;
  readonly bytes: number;
  readonly gzipBytes?: number;
}

/** One grid to stage: where its bytes are now, and what it is called in the index. */
interface GridSource {
  /** The index entry, with `url` already pointing at the packaged location. */
  readonly grid: TerrainGrid;
  /** Absolute path of the raw samples. */
  readonly from: string;
  /** Small files copied beside the grid, keyed by their packaged url. */
  readonly beside: readonly { readonly url: string; readonly from: string }[];
}

/**
 * The field-site mosaics to publish, read out of their built packages.
 *
 * A package is `data/sites/<id>/`, which is gitignored: it is tens of megabytes
 * rebuilt from a committed definition, so it is never in the tree a workflow
 * checks out. Its own `terrain/manifest.json` is the authority on the grid's
 * geometry and provenance, so it is read rather than recomputed here — one
 * mosaic built and verified by one script, published by another.
 *
 * A defined site with no built package is an ERROR rather than a quiet omission.
 * The failure it would otherwise cause is invisible: the deployment still works
 * everywhere, and at that one viewpoint `selectTerrainGrid` falls back to a whole
 * 1° tile, which covers a quarter of the sweep and reports summits visible that
 * the missing terrain would have hidden.
 */
async function siteGridSources(root: string, options: Options): Promise<readonly GridSource[]> {
  if (!options.includeSites) return [];

  const definitions = (await readdir(join(root, SITE_DEFINITION_DIR)).catch(() => []))
    .filter((file) => file.endsWith('.json'))
    .map((file) => basename(file, '.json'))
    .sort();
  const wanted = options.sites.length > 0 ? options.sites : definitions;
  const unknown = wanted.filter((id) => !definitions.includes(id));
  if (unknown.length > 0) {
    throw new Error(
      `No site definition for ${unknown.join(', ')} in ${SITE_DEFINITION_DIR}/. ` +
        `Defined sites: ${definitions.join(', ') || '(none)'}`,
    );
  }

  const sources: GridSource[] = [];
  for (const id of wanted) {
    const packageDir = join(root, SITE_PACKAGE_DIR, id);
    const manifestPath = join(packageDir, 'terrain', 'manifest.json');
    let raw: string;
    try {
      raw = await readFile(manifestPath, 'utf8');
    } catch {
      throw new Error(
        `${SITE_PACKAGE_DIR}/${id}/ holds no built terrain package, so a viewpoint at that ` +
          'site would fall back to a whole 1° tile and sweep terrain the deployment does not ' +
          `hold. Build it first:\n  npm run site:package -- ${id}\n` +
          'or pass --no-sites to publish without the field sites.',
      );
    }
    const manifest = parseTerrainManifest(JSON.parse(raw) as unknown, manifestPath);
    for (const grid of manifest.grids) {
      const file = grid.url.split('/').pop();
      if (file === undefined || file === '') {
        throw new Error(`${manifestPath} names grid ${grid.name} with an unusable url "${grid.url}"`);
      }
      const from = join(packageDir, 'terrain', grid.url);
      // The mosaic's provenance is four tiles and their offsets, which no single
      // file name carries, so the sidecar travels with the bytes.
      const sidecar = join(dirname(from), `${grid.name}.json`);
      const hasSidecar = await stat(sidecar).then(
        () => true,
        () => false,
      );
      sources.push({
        grid: { ...grid, url: `sites/${id}/${file}` },
        from,
        beside: hasSidecar
          ? [{ url: `sites/${id}/${grid.name}.json`, from: sidecar }]
          : [],
      });
    }
  }
  return sources;
}

/**
 * Copy the grids the options select, refusing any whose byte length disagrees
 * with the geometry the index claims for it.
 */
async function stageTerrain(
  root: string,
  outDir: string,
  options: Options,
): Promise<{ manifest: TerrainManifest; staged: readonly StagedGrid[] }> {
  const source = await buildTerrainManifest(root);

  const wanted = source.grids.filter((grid) => {
    const isTile = grid.url.startsWith('tiles/');
    if (isTile && !options.includeTiles) return false;
    if (!isTile && !options.includeWindows) return false;
    if (isTile && options.tiles.length > 0) return options.tiles.includes(grid.name.toUpperCase());
    return true;
  });

  if (options.tiles.length > 0) {
    const have = new Set(wanted.map((grid) => grid.name.toUpperCase()));
    const missing = options.tiles.filter((name) => !have.has(name));
    if (missing.length > 0) {
      throw new Error(
        `${missing.join(', ')} not in ${TILE_DIR}/. Fetch first: ` +
          `npm run fetch:tiles -- ${missing.join(' ')}`,
      );
    }
  }

  const terrainDir = join(outDir, TERRAIN_BASE.replace(/^\//, ''));
  await rm(terrainDir, { recursive: true, force: true });
  await mkdir(terrainDir, { recursive: true });

  const sources: GridSource[] = [
    ...wanted.map((grid) => ({ grid, from: sourceForGrid(root, grid), beside: [] })),
    ...(await siteGridSources(root, options)),
  ];

  // One index, so a name has to mean one grid: `tileByName` resolves by name and
  // would otherwise answer with whichever entry came first.
  const seen = new Set<string>();
  for (const { grid } of sources) {
    const key = grid.name.toUpperCase();
    if (seen.has(key)) {
      throw new Error(`Two grids would be published as ${grid.name}. Rename one of them.`);
    }
    seen.add(key);
  }

  const staged: StagedGrid[] = [];
  for (const { grid, from, beside } of sources) {
    const { size } = await stat(from);
    const expected = expectedGridByteLength(grid.geometry);
    if (size !== expected) {
      throw new Error(
        `${from} is ${size} bytes but its ${grid.geometry.rows}×${grid.geometry.cols} ` +
          `geometry needs exactly ${expected}. A truncated grid is not terrain; ` +
          'refusing to deploy it.',
      );
    }
    const to = join(terrainDir, grid.url);
    await place(from, to, options.copy);
    for (const extra of beside) await place(extra.from, join(terrainDir, extra.url), options.copy);
    const entry: StagedGrid = { grid, bytes: size };
    staged.push(
      options.gzip ? { ...entry, gzipBytes: await gzipTo(from, `${to}.gz`) } : entry,
    );
  }

  const manifest = parseTerrainManifest(
    {
      version: TERRAIN_MANIFEST_VERSION,
      note:
        'Packaged by scripts/package-deploy.ts. Serve this directory at ' +
        `${TERRAIN_BASE}/ on the app's own origin — the app reads elevation from ` +
        'here and from no other source (MISSION.md decision D7).',
      grids: staged.map(({ grid }) => grid),
    },
    'packaged terrain index',
  );
  await writeFile(
    join(terrainDir, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return { manifest, staged };
}

interface StagedRegion {
  readonly name: string;
  readonly cells: number;
  readonly peaks: number;
  readonly bytes: number;
}

async function directoryBytes(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(path);
    else total += (await stat(path)).size;
  }
  return total;
}

/**
 * Stage `fixtures/peaks/regions/<region>/` verbatim: an `index.json` and a
 * `cells/` directory, which is exactly the layout `TiledPeakStore`'s index
 * describes (each cell entry's `file` is relative to the index).
 */
async function stagePeakRegions(
  root: string,
  outDir: string,
  options: Options,
): Promise<readonly StagedRegion[]> {
  const peaksDir = join(outDir, PEAK_BASE.replace(/^\//, ''));
  await rm(peaksDir, { recursive: true, force: true });
  if (!options.includePeaks) return [];

  const regionRoot = join(root, PEAK_REGION_DIR);
  const entries = await readdir(regionRoot, { withFileTypes: true }).catch(() => []);

  const staged: StagedRegion[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const from = join(regionRoot, entry.name);
    const indexPath = join(from, 'index.json');
    let indexRaw: string;
    try {
      indexRaw = await readFile(indexPath, 'utf8');
    } catch {
      // A directory with no index.json is not a region — skip it rather than
      // publish half a dataset.
      continue;
    }
    const index = JSON.parse(indexRaw) as { cells?: unknown; peakCount?: unknown };
    const cells = Array.isArray(index.cells) ? index.cells.length : 0;
    const peaks = typeof index.peakCount === 'number' ? index.peakCount : 0;

    const to = join(peaksDir, entry.name);
    await mkdir(join(to, 'cells'), { recursive: true });
    await place(indexPath, join(to, 'index.json'), options.copy);
    for (const cell of await readdir(join(from, 'cells'))) {
      if (!cell.endsWith('.json')) continue;
      await place(join(from, 'cells', cell), join(to, 'cells', cell), options.copy);
    }
    staged.push({ name: entry.name, cells, peaks, bytes: await directoryBytes(to) });
  }
  return staged;
}

/**
 * The app READS its summits from `/peaks/` (Q8). Prove the deployment can
 * answer, rather than trusting a comment — at packaging time, where the fix is
 * a re-run, instead of as an empty overlay in front of a user:
 *
 *   1. the JS bundle must reference every region's cells (the indexes are
 *      compiled in — data-credits imports them, main.tsx queries by them), and
 *   2. every region the bundle knows must actually be STAGED, cells included.
 *      A `--no-peaks` package of this app is therefore an error, not an
 *      option silently honoured: the app would fetch 404s everywhere.
 *
 * This is the same assertion the pre-Q8 version made, inverted with the
 * architecture: it used to prove the bundle CONTAINED the summits and fail the
 * day they were served; now it proves the served layout matches the bundle's
 * promises and fails the day they are missing.
 */
async function verifyPeaksAreServed(
  root: string,
  outDir: string,
  staged: readonly StagedRegion[],
): Promise<string> {
  const regionRoot = join(root, PEAK_REGION_DIR);
  const regionNames = (await readdir(regionRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  if (regionNames.length === 0) {
    throw new Error(`${PEAK_REGION_DIR} holds no regions — the app would have no summits at all.`);
  }

  const assetsDir = join(outDir, 'assets');
  const scripts = (await readdir(assetsDir)).filter((file) => file.endsWith('.js'));
  let bundleBytes = 0;
  const texts: string[] = [];
  for (const file of scripts) {
    const text = await readFile(join(assetsDir, file), 'utf8');
    bundleBytes += Buffer.byteLength(text);
    texts.push(text);
  }

  // Region names reach the bundle as import.meta.glob keys; `cells/` reaches
  // it inside every compiled index. Either ALL gone means main.tsx stopped
  // reading the region indexes.
  const missingFromBundle = regionNames.filter(
    (name) => !texts.some((text) => text.includes('cells/') && text.includes(name)),
  );
  if (missingFromBundle.length === regionNames.length) {
    throw new Error(
      `The JS bundle references none of the regions (${regionNames.join(', ')}). ` +
        'main.tsx no longer reads the region indexes — if the app went back to a bundled ' +
        'dataset, update data-credits and this assertion in the same commit (Q8 in reverse).',
    );
  }

  const unstaged: string[] = [];
  for (const name of regionNames) {
    const region = staged.find((entry) => entry.name === name);
    if (region === undefined || region.cells === 0) {
      unstaged.push(name);
      continue;
    }
    await stat(join(outDir, 'peaks', name, 'index.json'));
  }
  if (unstaged.length > 0) {
    throw new Error(
      `The app reads /peaks/ but ${unstaged.join(', ')} ${unstaged.length === 1 ? 'is' : 'are'} ` +
        'not staged. Do not package this app with --no-peaks: it would fetch 404s and draw ' +
        'empty overlays that read as "no mountains here".',
    );
  }

  const totalPeaks = staged.reduce((sum, entry) => sum + entry.peaks, 0);
  return (
    `${staged.length} region(s), ${totalPeaks} summits staged and referenced by the bundle ` +
    `(${mb(bundleBytes)} of JS)`
  );
}

/**
 * The licence text a deployment is obliged to carry, written from the staged
 * data's own citations rather than from memory.
 *
 * A file nobody links to is not attribution — see docs/DEPLOY.md — but it is
 * the artefact a deployer needs in order to link to something true.
 */
async function writeAttribution(
  root: string,
  outDir: string,
  staged: readonly StagedGrid[],
  regions: readonly StagedRegion[],
): Promise<string> {
  const lines: string[] = [
    'Mountain Finder — data attribution',
    '==================================',
    '',
    'ELEVATION (terrain, horizon line)',
    '  NASA Shuttle Radar Topography Mission (SRTM) 1 arc-second global, via the',
    '  AWS Open Data "elevation-tiles-prod" Skadi mirror.',
    '  Public domain (NASA/USGS). Attribution is courtesy, not a condition.',
    '  Grids served by this deployment:',
  ];
  for (const { grid } of staged) {
    lines.push(`    ${grid.name}  ${grid.dataset}  ${grid.source ?? ''}`.trimEnd());
  }
  if (staged.length === 0) lines.push('    (none — this deployment serves no terrain)');

  lines.push('', 'SUMMIT NAMES AND HEIGHTS (labels)');
  const bundled = JSON.parse(await readFile(join(root, BUNDLED_PEAKS), 'utf8')) as {
    sources?: readonly { title?: unknown; url?: unknown }[];
  };
  lines.push('  Compiled into the app bundle — cited summits:');
  for (const source of bundled.sources ?? []) {
    const title = typeof source.title === 'string' ? source.title : '(untitled source)';
    const url = typeof source.url === 'string' ? ` — ${source.url}` : '';
    lines.push(`    ${title}${url}`);
  }

  for (const region of regions) {
    const index = JSON.parse(
      await readFile(join(root, PEAK_REGION_DIR, region.name, 'index.json'), 'utf8'),
    ) as { sources?: readonly { title?: unknown; url?: unknown }[] };
    lines.push('', `  Served at ${PEAK_BASE}/${region.name}/ — ${region.peaks} summits:`);
    for (const source of index.sources ?? []) {
      const title = typeof source.title === 'string' ? source.title : '(untitled source)';
      const url = typeof source.url === 'string' ? ` — ${source.url}` : '';
      lines.push(`    ${title}${url}`);
    }
    lines.push(
      '    ODbL-1.0 REQUIRES that this attribution be shown to users of the app,',
      '    that the licence be named, and that any modified dataset be offered',
      '    under the same terms. A file in the deployment root is not enough:',
      '    the running app has to display it. See docs/DEPLOY.md.',
    );
  }

  const path = join(outDir, 'ATTRIBUTION.txt');
  await writeFile(path, `${lines.join('\n')}\n`, 'utf8');
  return path;
}

async function main(): Promise<void> {
  const root = process.cwd();
  const options = parseArgs(process.argv.slice(2));
  const outDir = resolve(root, options.out);

  try {
    await stat(join(outDir, 'index.html'));
  } catch {
    throw new Error(
      `${relative(root, outDir) || outDir} holds no index.html — run "npm run build" first. ` +
        'This script packages a build; it does not make one.',
    );
  }

  // The live page registers `sw.js` at the deployment root. A build that emits no
  // worker leaves a page promising offline use and 404ing on the promise, which a
  // visitor finds out about on a ridge. vite.config.ts emits it; this is the gate.
  const workerPath = join(outDir, 'sw.js');
  const worker = await stat(workerPath).catch(() => {
    throw new Error(
      `${relative(root, workerPath)} is missing, so the live page's offline cache cannot ` +
        'install. vite.config.ts emits it from src/offline/live-service-worker.ts — rebuild, ' +
        'or find out why that plugin stopped running.',
    );
  });

  const { manifest, staged } = await stageTerrain(root, outDir, options);
  const regions = await stagePeakRegions(root, outDir, options);
  const peakProof = await verifyPeaksAreServed(root, outDir, regions);
  const attribution = await writeAttribution(root, outDir, staged, regions);

  const rawTotal = staged.reduce((total, entry) => total + entry.bytes, 0);
  const gzTotal = staged.reduce((total, entry) => total + (entry.gzipBytes ?? entry.bytes), 0);
  const largest = staged.reduce((max, entry) => Math.max(max, entry.gzipBytes ?? entry.bytes), 0);

  const out: string[] = [];
  out.push(`Packaged ${relative(root, outDir) || outDir}/`);
  out.push('');
  out.push(`  ${TERRAIN_BASE}/manifest.json — ${manifest.grids.length} grid(s)`);
  for (const entry of staged) {
    const size = entry.gzipBytes === undefined
      ? mb(entry.bytes)
      : `${mb(entry.bytes)} → ${mb(entry.gzipBytes)} gzipped`;
    out.push(`    ${entry.grid.name.padEnd(26)} ${entry.grid.dataset.padEnd(6)} ${size}`);
  }
  out.push(`    ${'total'.padEnd(26)} ${''.padEnd(6)} ${mb(rawTotal)}`);
  if (options.gzip) out.push(`    ${'total on the wire'.padEnd(26)} ${''.padEnd(6)} ${mb(gzTotal)}`);
  out.push(
    `    one session downloads at most ${mb(largest)} of terrain ` +
      '(the largest grid covering its viewpoint)',
  );

  const siteGrids = staged.filter((entry) => entry.grid.url.startsWith('sites/'));
  if (siteGrids.length > 0) {
    out.push('');
    out.push(
      `  field sites in the same index: ${siteGrids.map((entry) => entry.grid.name).join(', ')}`,
    );
    out.push(
      '    each covers more square degrees than the 1° tiles under it, so selectTerrainGrid ' +
        'gives its viewpoint the whole sweep',
    );
  }

  out.push('');
  out.push(
    `  sw.js — ${worker.size} B, the live page's offline cache ` +
      '(src/offline/live-service-worker.ts)',
  );

  out.push('');
  if (regions.length === 0) {
    out.push(`  ${PEAK_BASE}/ — nothing staged`);
  } else {
    for (const region of regions) {
      out.push(
        `  ${PEAK_BASE}/${region.name}/ — ${region.peaks} summits in ${region.cells} cells, ` +
          mb(region.bytes),
      );
    }
    out.push('    read by the app over HTTP, cell by cell, as queries need them (Q8)');
  }
  out.push('');
  out.push(`  peaks served and readable: ${peakProof}`);
  out.push(
    `  wrote ${relative(root, attribution)} — the app itself DISPLAYS this notice too ` +
      '(src/app/attribution.ts; a file nobody links to is not attribution)',
  );
  out.push('');
  out.push(`Serve ${relative(root, outDir) || outDir}/ as a static directory. Nothing in it`);
  out.push('calls a third-party API at runtime; every request is same-origin.');
  process.stdout.write(`${out.join('\n')}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
