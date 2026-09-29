/**
 * Where the deployment check serves the package from, and at which path.
 *
 * A GitHub Pages project site serves the app under `/<repo>/`, so the published
 * bundle is built with Vite's `base=/Mountain-finder/` and asks for its terrain
 * and peaks under that prefix. Checking the root build would check a different
 * artefact from the one published, so `.github/workflows/pages.yml` points this
 * suite at a directory that mounts `dist/` under the repository name and sets
 * both variables below.
 *
 * The defaults serve `dist/` at `/`, which is what a local run does.
 */

/** Directory `scripts/static-server.ts` serves, relative to the repository root. */
export const SERVE_DIR = process.env.DEPLOY_CHECK_SERVE_DIR ?? 'dist';

/** URL path the app is mounted at, always with a trailing slash. */
export const BASE_PATH = ((raw) => (raw.endsWith('/') ? raw : `${raw}/`))(
  process.env.DEPLOY_CHECK_BASE_PATH ?? '/',
);

/** The app's own URL for a path written root-relative in the application. */
export function servedUrl(path: string): string {
  return `${BASE_PATH}${path.startsWith('/') ? path.slice(1) : path}`;
}
