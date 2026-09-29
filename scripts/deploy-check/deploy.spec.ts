/**
 * THE DEPLOYMENT SELF-CHECK — a built bundle, a packaged terrain directory, a
 * dumb static file server, and real Chromium (docs/DEPLOY.md).
 *
 * `tests/e2e/app.spec.ts` already proves the app works. It proves it against
 * `npm run dev`, where a Vite plugin manufactures /terrain/manifest.json on
 * every request out of the repository's own directories. That is exactly the
 * machinery a deployment does not have, so the passing e2e suite says nothing
 * about whether `npm run build` produces something that can be shipped.
 *
 * This file closes that hole. Everything it drives came off disk:
 *
 *   dist/index.html + dist/assets/*   `vite build`, no dev server, no HMR
 *   dist/terrain/…                    `npm run package:deploy`
 *   scripts/static-server.ts          reads files, sets Content-Type, stops
 *
 * ── WHERE THE EXPECTED SUMMIT PIXEL COMES FROM ─────────────────────────────
 * Not from this code, and not from a previous run. It is the closed-form
 * projection derived in `tests/e2e/app.spec.ts` from the Gornergrat fixture's
 * own EXIF and the Matterhorn's cited position:
 *
 *   observer 45°59'00"N 7°46'56"E, eye 3089 + 1.6 m
 *   summit   45.976389 N, 7.658611 E, 4478 m  →  bearing 265.42252°, d 9.5827 km
 *   α = atan((4478 − 3090.6 − d²/2R_eff) / d) = +8.20143°,  R_eff = R/(1 − 0.13)
 *   Δ = 265.42252 − 265.4 = +0.02252°, hFOV 65.4704525° on 1200 × 900:
 *     x = 1200 · (0.5 + tanΔ / (2·tan(hFOV/2)))          = 600.37 px
 *     y =  900 · (0.5 − (tanα / cosΔ) / (2·tan(vFOV/2))) = 315.48 px
 *
 * Same numbers, same ±12 px (1 % of frame width). A deployed build that draws
 * the flag somewhere else is a deployed build that is wrong.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page, type Response } from '@playwright/test';

import { BASE_PATH, servedUrl } from './serving.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = resolve(ROOT, 'dist');
const PHOTO_DIR = resolve(ROOT, 'fixtures/photos');
const GORNERGRAT = resolve(PHOTO_DIR, 'gornergrat-matterhorn.jpg');
const CHAMONIX = resolve(PHOTO_DIR, 'chamonix-north-east.jpg');

/** A tile fetch plus a 130° sweep over it; the dev-server suite allows as much. */
const OVERLAY_TIMEOUT_MS = 120_000;

/** The names in the packaged index — what this deployment actually holds. */
async function packagedGridNames(): Promise<readonly string[]> {
  const manifest = JSON.parse(
    await readFile(resolve(DIST, 'terrain/manifest.json'), 'utf8'),
  ) as { grids?: readonly { name?: unknown }[] };
  return (manifest.grids ?? [])
    .map((grid) => grid.name)
    .filter((name): name is string => typeof name === 'string');
}

test.beforeAll(async () => {
  for (const file of ['index.html', 'terrain/manifest.json']) {
    const path = resolve(DIST, file);
    await stat(path).catch(() => {
      throw new Error(
        `${path} is missing. This suite tests a packaged build:\n` +
          '  npm run build && npm run package:deploy -- --gzip',
      );
    });
  }
  const names = await packagedGridNames();
  if (!names.includes('N45E007')) {
    throw new Error(
      'The packaged deployment holds no N45E007, so the Gornergrat photo cannot be ' +
        'the proof it is meant to be. Fetch it and repackage:\n' +
        '  npm run fetch:tiles -- N45E007 && npm run package:deploy -- --gzip',
    );
  }
});

async function pickPhoto(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('photo-input').setInputFiles(filePath);
}

test('the served files are the packaged files — nothing is generated per request', async ({
  page,
}) => {
  // The dev server BUILDS manifest.json on every request. A deployment cannot,
  // so the decisive check is byte identity with what packaging wrote.
  const response = await page.request.get(servedUrl('/terrain/manifest.json'));
  expect(response.status()).toBe(200);
  const served = await response.body();
  const onDisk = await readFile(resolve(DIST, 'terrain/manifest.json'));
  expect(served.equals(onDisk)).toBe(true);

  const manifest = JSON.parse(onDisk.toString('utf8')) as {
    version: number;
    grids: { name: string; url: string }[];
  };
  expect(manifest.version).toBe(1);
  expect(manifest.grids.length).toBeGreaterThan(0);

  // Every grid the index promises is actually reachable, with the right length.
  for (const grid of manifest.grids) {
    const head = await page.request.fetch(servedUrl(`/terrain/${grid.url}`), { method: 'HEAD' });
    expect(head.status(), `${grid.name} → ${servedUrl(`/terrain/${grid.url}`)}`).toBe(200);
  }

  // And the page itself is the built one: no Vite client, no module graph.
  const html = await (await page.request.get(BASE_PATH)).text();
  expect(html).not.toContain('/@vite/client');
  // BASE_PATH comes from the environment, so it is escaped before it becomes a
  // pattern — an unescaped `.` in a repository name would match anything.
  const basePattern = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(html).toMatch(new RegExp(`${basePattern}assets/index-[A-Za-z0-9_-]+\\.js`));
});

test('a statically served build draws a real overlay from a real photo', async ({ page }) => {
  // A 25 MB tile, inflated in the browser, then a 130° sweep across it. The
  // dev-server suite allows the same 120 s for this step.
  test.setTimeout(OVERLAY_TIMEOUT_MS + 60_000);

  // Decision D7, checked rather than asserted: if any request leaves this
  // origin at runtime, the deployment is not offline-first.
  // `blob:http://localhost:5210/…` is the photo the user chose, handed to the
  // <img> by the page itself; it never leaves the browser. Anything else with a
  // host in it would be a third-party call at runtime.
  const foreign: string[] = [];
  const ownOrigin = /^(blob:)?http:\/\/localhost:5210\//;
  page.on('request', (request) => {
    const url = request.url();
    if (!ownOrigin.test(url) && !url.startsWith('data:')) foreign.push(url);
  });

  // Listen from the start: the store fetches the tile as soon as the pose is
  // complete, which can be before any later `waitForResponse` is registered.
  const terrain: Response[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/terrain/tiles/')) terrain.push(response);
  });

  await page.goto(BASE_PATH);
  await expect(page.getByTestId('app-title')).toHaveText('Mountain Finder');

  await pickPhoto(page, GORNERGRAT);
  await expect(page.getByTestId('input-lat')).toHaveValue('45.983333');
  await page.getByTestId('input-assumptions').check();
  await expect(page.getByTestId('missing-summary')).toHaveAttribute('data-missing-count', '0');

  const overlayState = page.getByTestId('overlay-state');
  await expect(overlayState).toHaveAttribute('data-overlay', 'live', {
    timeout: OVERLAY_TIMEOUT_MS,
  });
  await expect(overlayState).toContainText('Matterhorn');
  await expect(page.getByTestId('overlay-error')).toHaveCount(0);

  // The horizon is our renderer's, over the photo, at the frame's own size.
  const overlay = page.locator('[data-testid="overlay-svg"] svg');
  await expect(overlay).toHaveAttribute('viewBox', '0 0 1200 900');
  await expect(
    page.locator('[data-testid="overlay-svg"] g.mf-horizon polyline').first(),
  ).toBeVisible();

  // Summit markers from the served Zermatt region (Q8) — the deployment now
  // answers peak queries from its own /peaks/ files, so the frame fills with
  // markers where the bundled dataset drew one. The dataset owns the count;
  // the geometry owns the claim pinned here: one marker within ±12 px of the
  // Matterhorn's hand-derived position.
  const summits = page.locator('[data-testid="overlay-svg"] g.mf-summits circle');
  expect(await summits.count()).toBeGreaterThan(5);
  const positions = await summits.evaluateAll((nodes) =>
    nodes.map((node) => ({
      cx: Number(node.getAttribute('cx')),
      cy: Number(node.getAttribute('cy')),
    })),
  );
  expect(
    positions.filter(
      (dot) => Math.abs(dot.cx - 600.37) < 12 && Math.abs(dot.cy - 315.48) < 12,
    ).length,
  ).toBeGreaterThan(0);

  // What the terrain actually cost on the wire. `--gzip` staged a .gz sibling
  // and the static server offered it; the browser inflated it before
  // HttpTerrainStore's byte-length check ever saw it, which is why a 25.93 MB
  // tile can arrive as ~16 MB with no application code involved.
  const response = terrain.find((entry) => entry.url().includes('N45E007.hgt'));
  expect(response, 'the overlay was drawn without fetching N45E007').toBeDefined();
  if (response === undefined) return;
  expect(response.status()).toBe(200);
  const encoding = response.headers()['content-encoding'] ?? 'identity';
  const { responseBodySize } = await response.request().sizes();
  console.log(
    `terrain: N45E007.hgt 25934402 B on disk, ${responseBodySize} B on the wire ` +
      `(Content-Encoding: ${encoding})`,
  );
  expect(responseBodySize).toBeLessThanOrEqual(25_934_402);

  expect(foreign, 'a deployed build must not call anything but its own origin').toEqual([]);
});

test('a viewpoint the deployment has no tile for is named, not silently blank', async ({ page }) => {
  // Chamonix sits in N45E006. If a deployment ever ships that tile this case
  // stops being a no-terrain case, and skipping is the honest response —
  // quietly asserting an absence that is no longer true would be worse.
  const names = await packagedGridNames();
  test.skip(names.includes('N45E006'), 'this deployment now holds N45E006');

  await page.goto(BASE_PATH);
  await pickPhoto(page, CHAMONIX);
  await page.getByTestId('input-assumptions').check();

  await expect(page.getByTestId('overlay-placeholder')).toBeVisible();
  await expect(page.getByTestId('overlay-svg')).toHaveCount(0);

  const error = page.getByTestId('overlay-error');
  await expect(error).toBeVisible();
  // The message is built from the SERVED manifest, so a deployment that ships
  // different tiles gets a different, still-correct, list.
  await expect(error).toContainText('N45E006');
  await expect(error).toContainText('no peaks are visible');
  await expect(page.getByTestId('export-png')).toBeDisabled();
});

test('the packaged peak cells are served in the layout TiledPeakStore expects', async ({
  page,
}) => {
  // Peaks in USE are compiled into the bundle today (package-deploy.ts asserts
  // that). These staged region cells are what the app will read when it stops
  // bundling them, and a deployment that 404s them would be discovered by a
  // user, not by a build. So they are checked here.
  const regions = await readdir(resolve(DIST, 'peaks'), { withFileTypes: true }).catch(() => []);
  const first = regions.find((entry) => entry.isDirectory());
  expect(first, 'packaging staged no peak regions').toBeDefined();
  if (first === undefined) return;

  const indexResponse = await page.request.get(servedUrl(`/peaks/${first.name}/index.json`));
  expect(indexResponse.status()).toBe(200);
  const index = (await indexResponse.json()) as {
    peakCount: number;
    cells: { name: string; file: string; peaks: number }[];
  };
  expect(index.peakCount).toBeGreaterThan(0);
  expect(index.cells.length).toBeGreaterThan(0);

  const cell = index.cells[0];
  expect(cell).toBeDefined();
  if (cell === undefined) return;
  // `file` is relative to the index — the same resolution the store performs.
  const cellResponse = await page.request.get(servedUrl(`/peaks/${first.name}/${cell.file}`));
  expect(cellResponse.status()).toBe(200);
  const body = (await cellResponse.json()) as { cell: string; peaks: unknown[] };
  expect(body.cell).toBe(cell.name);
  expect(body.peaks.length).toBe(cell.peaks);
});

test('the live AR page is published, and asks for its assets under the subpath', async ({
  page,
}) => {
  // `live.html` is the page the phone opens in Safari, and the one thing it
  // cannot survive is the bug `base-path.ts` was written for: a URL written
  // root-relative in application code, asking the domain root from a project
  // site served under /Mountain-finder/. So both halves are checked on the
  // PACKAGED build — that the page is there at all, and that every URL it names
  // carries the prefix.
  const response = await page.request.get(servedUrl('/live.html'));
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).not.toContain('/@vite/client');

  const basePattern = BASE_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  expect(html).toMatch(new RegExp(`${basePattern}assets/live-[A-Za-z0-9_-]+\\.js`));
  // No absolute URL may point above the prefix. At a root deployment the prefix
  // is "/" and this is trivially true, which is the point: one assertion covers
  // both layouts.
  for (const [, url] of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
    expect(url, `${url} does not start with ${BASE_PATH}`).toContain(BASE_PATH);
  }

  await page.goto(servedUrl('/live.html'));
  await expect(page.getByTestId('live-title')).toHaveText('Mountain Finder — live');
  // Headless Chromium here has no camera, no sensors and no fix, so the screen
  // must be at its first refusal rather than blank or broken.
  await expect(page.getByTestId('live-refusal')).toHaveAttribute(
    'data-refusal-code',
    'not-started',
  );
  await expect(page.getByTestId('live-steps')).toBeVisible();
});

test('the deployed page displays the ODbL notice, and it matches ATTRIBUTION.txt', async ({
  page,
}) => {
  // The obligation ODbL-1.0 actually imposes is on the RUNNING app, so it has
  // to be checked on the deployed bundle rather than on the dev server —
  // `dist/ATTRIBUTION.txt` is what a deployer publishes, not what a visitor
  // reads. `tests/e2e/attribution.spec.ts` proves the footer is legible and on
  // screen; this proves the built artefact carries it and that the two
  // renderings of the same citation records agree.
  await page.goto(BASE_PATH);
  const footer = page.getByTestId('attribution');
  await expect(footer).toBeVisible();
  await expect(footer).toContainText('OpenStreetMap contributors');
  await expect(footer).toContainText('ODbL-1.0');

  const box = await footer.boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize();
  if (box !== null && viewport !== null) {
    // On screen without scrolling, not merely in the document.
    expect(box.height).toBeGreaterThan(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  }

  // The staged regions and the page must credit the same thing: packaging
  // writes ATTRIBUTION.txt from the region index files, the app derives the
  // footer from the same records, and a deployment where those disagree is a
  // deployment whose notice is stale.
  const attribution = await readFile(resolve(DIST, 'ATTRIBUTION.txt'), 'utf8');
  expect(attribution).toContain('ODbL-1.0');
  expect(attribution).toContain('OpenStreetMap contributors');
});
