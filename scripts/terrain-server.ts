/**
 * Serving terrain to the browser (archive/v2-docs-20260929/TODO.md Q1) — a dev/preview-server plugin.
 *
 * The app reads elevation from static files on its own origin: an index at
 * `/terrain/manifest.json` and the raw sample files it names (see
 * `src/providers/terrain-manifest.ts` for the format and the reasoning). This
 * plugin publishes that directory during `npm run dev` and `npm run preview`
 * out of what the repository already holds:
 *
 *   data/tiles/*.hgt              whole SRTM tiles, fetched with
 *                                 `npm run fetch:tiles` — gitignored, 25 MB each
 *   fixtures/tiles/cases/*.json   the committed case windows: real SRTM bytes
 *                                 cut byte-for-byte out of those tiles, ~700 KB
 *
 * Both are indexed, so a fresh clone with no tiles still has real terrain for
 * the ground-truth viewpoints, and a developer who has run `fetch:tiles` gets
 * the whole degree square. Nothing is copied or duplicated: the bytes are
 * streamed from where they already live.
 *
 * ── WHAT IS DELIBERATELY NOT SERVED ────────────────────────────────────────
 * `fixtures/tiles/*.hgt` (N00E000, S01W001, …) are SYNTHETIC tiles — analytic
 * cones and planes for the reader's unit tests. Publishing them would put
 * invented mountains at real coordinates, which is precisely the class of
 * fabrication this project exists to avoid. Only the two directories above are
 * indexed, and that is a rule, not an oversight.
 *
 * ── A PRODUCTION BUILD ─────────────────────────────────────────────────────
 * `npm run build` emits no terrain: it is not the bundler's job to ship 25 MB
 * of radar data, and which tiles a deployment wants is a deployment decision.
 * A built app with nothing at /terrain/ says so plainly — the store raises "no
 * terrain index at /terrain/manifest.json", the app shows it, and no overlay is
 * drawn.
 *
 * `npm run package:deploy` (scripts/package-deploy.ts) is the step that fills
 * that directory for a deployment. It calls `buildTerrainManifest` below rather
 * than listing the tiles again, so a packaged app serves exactly what this
 * plugin serves — including the synthetic-tile exclusion above, which is a rule
 * and not a per-server preference. docs/DEPLOY.md has the sizes and the
 * self-check.
 */

import { createReadStream } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { TileWindowMeta } from '../src/providers/tile-directory.js';
import { datasetLabelForStepDeg } from '../src/providers/tile-elevation.js';
import {
  parseTerrainManifest,
  terrainGridForTileFile,
  TERRAIN_MANIFEST_VERSION,
  type TerrainGrid,
  type TerrainManifest,
} from '../src/providers/terrain-manifest.js';

/** Where whole tiles land (`npm run fetch:tiles`). */
export const TILE_DIR = 'data/tiles';

/** Where the committed real-data windows live. */
export const WINDOW_DIR = 'fixtures/tiles/cases';

/** URL prefix the app fetches from. */
export const TERRAIN_BASE = '/terrain';

async function listFiles(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

/**
 * Build the index from the repository's own terrain files.
 *
 * The result is passed through `parseTerrainManifest` before it is returned, so
 * a malformed sidecar fails here — where the message can name the file — rather
 * than in a browser.
 */
export async function buildTerrainManifest(root: string): Promise<TerrainManifest> {
  const grids: TerrainGrid[] = [];

  for (const file of await listFiles(join(root, TILE_DIR))) {
    if (!file.endsWith('.hgt')) continue;
    const name = basename(file, '.hgt');
    const { size } = await stat(join(root, TILE_DIR, file));
    grids.push({
      ...terrainGridForTileFile(name, size, `tiles/${file}`),
      source: `whole SRTM tile from ${TILE_DIR}/${file}`,
    });
  }

  for (const file of await listFiles(join(root, WINDOW_DIR))) {
    if (!file.endsWith('.json')) continue;
    const meta = JSON.parse(
      await readFile(join(root, WINDOW_DIR, file), 'utf8'),
    ) as TileWindowMeta;
    grids.push({
      name: meta.name,
      url: `windows/${meta.data}`,
      // Labelled from the spacing by the SAME function the manifest parser and
      // the provider use (R-4): a window cut from an SRTM1 tile reports srtm1
      // because its samples are 1/3600° apart, not because a locally rebuilt
      // grid-size arithmetic happened to agree. A spacing that divides no
      // degree evenly now reports arc-seconds here too, instead of a wrong
      // hgt-N from the rounding.
      dataset: datasetLabelForStepDeg(meta.geometry.latStepDeg),
      geometry: meta.geometry,
      source: `real bytes cut from ${meta.source.tile} — ${WINDOW_DIR}/${meta.data}`,
    });
  }

  return parseTerrainManifest(
    {
      version: TERRAIN_MANIFEST_VERSION,
      note:
        'Served by scripts/terrain-server.ts from data/tiles/ and fixtures/tiles/cases/. ' +
        'Synthetic test tiles are deliberately excluded.',
      grids,
    },
    'terrain plugin index',
  );
}

/** `windows/foo.i16be` and `tiles/N45E007.hgt` only — nothing with a path in it. */
const SAFE_PATH = /^(tiles|windows)\/[A-Za-z0-9._-]+$/;

function fileForRequest(root: string, path: string): string | undefined {
  if (!SAFE_PATH.test(path)) return undefined;
  const [kind, name] = path.split('/');
  if (name === undefined) return undefined;
  return resolve(root, kind === 'tiles' ? TILE_DIR : WINDOW_DIR, name);
}

async function handle(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = request.url ?? '';
  if (!url.startsWith(`${TERRAIN_BASE}/`)) {
    next();
    return;
  }
  const path = url.slice(TERRAIN_BASE.length + 1).split('?')[0] ?? '';

  if (path === 'manifest.json') {
    const manifest = await buildTerrainManifest(root);
    const body = JSON.stringify(manifest, null, 2);
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Content-Length', String(Buffer.byteLength(body)));
    // Never cached: the answer changes the moment someone runs fetch:tiles.
    response.setHeader('Cache-Control', 'no-store');
    response.end(body);
    return;
  }

  const file = fileForRequest(root, path);
  if (file === undefined) {
    response.statusCode = 404;
    response.end(`No terrain file at ${url}`);
    return;
  }

  let size: number;
  try {
    ({ size } = await stat(file));
  } catch {
    response.statusCode = 404;
    response.end(`No terrain file at ${url}`);
    return;
  }

  response.setHeader('Content-Type', 'application/octet-stream');
  response.setHeader('Content-Length', String(size));
  // Elevation samples for a fixed square of the planet do not change.
  response.setHeader('Cache-Control', 'public, max-age=3600');
  createReadStream(file).pipe(response);
}

interface MiddlewareHost {
  middlewares: {
    use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
  };
}

/**
 * The Vite plugin. Typed structurally rather than against `Plugin` so this file
 * carries no build-time dependency on Vite's own types.
 */
export function terrainServerPlugin(root: string = process.cwd()): {
  name: string;
  configureServer(server: MiddlewareHost): void;
  configurePreviewServer(server: MiddlewareHost): void;
} {
  const attach = (server: MiddlewareHost): void => {
    server.middlewares.use((request, response, next) => {
      handle(root, request, response, next).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(
          `Terrain server failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  };
  return {
    name: 'mountain-finder-terrain',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
