/**
 * Serve `/peaks/` during dev and preview — the peak side of
 * `scripts/terrain-server.ts` (archive/v2-docs-20260929/TODO.md Q8).
 *
 * A production deployment gets `/peaks/<region>/…` staged by
 * `npm run package:deploy` (see docs/DEPLOY.md and `test:deploy`, which proves
 * the staged files are served). Vite's dev and preview servers know nothing of
 * that staging, so this plugin publishes the SAME layout straight from
 * `fixtures/peaks/regions/` — index.json and cells verbatim, no rewriting —
 * and the browser code cannot tell the difference. One URL scheme, two
 * publishers, byte-identical answers.
 *
 * Only files the layout actually contains are reachable: a region directory
 * name, then `index.json` or `cells/<CELL>.json`. Anything else — traversal,
 * absolute paths, other extensions — is 404, not "resolve and hope".
 */

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';

const PEAKS_BASE = '/peaks';
const REGION_DIR = 'fixtures/peaks/regions';

/** `zermatt/index.json` or `zermatt/cells/N45E007.json` — nothing else. */
const SAFE_PATH = /^[a-z0-9-]+\/(index\.json|cells\/[A-Za-z0-9._-]+\.json)$/;

function fileForRequest(root: string, path: string): string | undefined {
  if (!SAFE_PATH.test(path) || path.includes('..')) return undefined;
  return resolve(join(root, REGION_DIR, path));
}

async function handle(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): Promise<void> {
  const url = request.url ?? '';
  if (!url.startsWith(`${PEAKS_BASE}/`)) {
    next();
    return;
  }
  const path = url.slice(PEAKS_BASE.length + 1).split('?')[0] ?? '';
  const file = fileForRequest(root, path);
  if (file === undefined) {
    response.statusCode = 404;
    response.end(`No peak file at ${url}`);
    return;
  }

  let size: number;
  try {
    ({ size } = await stat(file));
  } catch {
    response.statusCode = 404;
    response.end(`No peak file at ${url}`);
    return;
  }

  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Content-Length', String(size));
  // A committed region only changes when fetch:peaks reimports it; an hour of
  // cache matches the terrain server's choice for the same kind of bytes.
  response.setHeader('Cache-Control', 'public, max-age=3600');
  createReadStream(file).pipe(response);
}

interface MiddlewareHost {
  middlewares: {
    use(handler: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void;
  };
}

/** The Vite plugin — structural typing, same rationale as the terrain plugin. */
export function peaksServerPlugin(root: string = process.cwd()): {
  name: string;
  configureServer(server: MiddlewareHost): void;
  configurePreviewServer(server: MiddlewareHost): void;
} {
  const attach = (server: MiddlewareHost): void => {
    server.middlewares.use((request, response, next) => {
      handle(root, request, response, next).catch((error: unknown) => {
        response.statusCode = 500;
        response.end(
          `Peaks server failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
    });
  };
  return {
    name: 'mountain-finder-peaks',
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
