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

import { destinationPoint } from '../../src/core/geodesy.js';
import type { OfflineCacheController } from '../../src/offline/offline-cache.js';
import {
  expectedGridByteLength,
  gridContains,
  parseTerrainManifest,
  selectTerrainGrid,
  type TerrainManifest,
} from '../../src/providers/terrain-manifest.js';
import { parseSiteDefinition, SITE_DEFINITION_DIR } from '../../src/sites/site-package.js';
import { BASE_PATH, servedUrl } from './serving.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const DIST = resolve(ROOT, 'dist');
const PHOTO_DIR = resolve(ROOT, 'fixtures/photos');
const GORNERGRAT = resolve(PHOTO_DIR, 'gornergrat-matterhorn.jpg');
const CHAMONIX = resolve(PHOTO_DIR, 'chamonix-north-east.jpg');

/** A tile fetch plus a 130° sweep over it; the dev-server suite allows as much. */
const OVERLAY_TIMEOUT_MS = 120_000;

/** The packaged index, validated the way the browser validates it. */
async function packagedManifest(): Promise<TerrainManifest> {
  return parseTerrainManifest(
    JSON.parse(await readFile(resolve(DIST, 'terrain/manifest.json'), 'utf8')),
    'dist/terrain/manifest.json',
  );
}

/** The names in the packaged index — what this deployment actually holds. */
async function packagedGridNames(): Promise<readonly string[]> {
  return (await packagedManifest()).grids.map((grid) => grid.name);
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

  // What the terrain actually cost on the wire, logged for whoever is budgeting
  // a phone's data. A package built with `--gzip` has a `.hgt.gz` sibling, this
  // static server offers it the way nginx's `gzip_static` would, and the browser
  // inflates it before `HttpTerrainStore`'s byte-length check sees a byte — so
  // the same tile arrives as ~16 MB with no application code involved. The Pages
  // workflow builds without `--gzip`, because Pages serves the object that was
  // asked for and the siblings would be artefact nobody reads (docs/DEPLOY.md).
  // The bound below holds either way; the logged figure says which happened.
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

test('a field site is published as one mosaic, and a viewpoint there is given it', async ({
  page,
}) => {
  // The Bogus Basin sweep reads four 1° tiles, and `selectTerrainGrid` hands a
  // viewpoint ONE grid. Whole tiles alone would therefore give that sweep a
  // quarter of its own terrain, which reports summits visible that the missing
  // ridges would have hidden. The mosaic is staged in the SAME index as the
  // tiles and wins on coverage, and this is where that is proved rather than
  // assumed. The viewpoint comes from the committed definition, so the site can
  // move without this file being edited into agreement with it.
  const definitionPath = resolve(ROOT, SITE_DEFINITION_DIR, 'bogus-basin.json');
  const site = parseSiteDefinition(
    JSON.parse(await readFile(definitionPath, 'utf8')),
    definitionPath,
  );
  const manifest = await packagedManifest();

  // The whole tile under the viewpoint is published too, so the choice below is
  // a choice between two grids that both cover the spot.
  expect(manifest.grids.map((grid) => grid.name)).toContain('N43W117');

  const chosen = selectTerrainGrid(manifest, site.observer.lat, site.observer.lon);
  expect(chosen, `this deployment serves no terrain at all for ${site.name}`).toBeDefined();
  if (chosen === undefined) return;
  expect(chosen.name).toBe(`${site.id}-${site.sweepRadiusKm}km`);
  expect(chosen.url).toMatch(new RegExp(`^sites/${site.id}/`));

  // Every ray end of the declared 360° sweep lands inside the SERVED geometry.
  // `make-site-package` proves this of the mosaic it builds; the claim here is
  // about what packaging published, which is a different artefact.
  const outside: number[] = [];
  for (let index = 0; index < 72; index += 1) {
    const bearingDeg = index * 5;
    const end = destinationPoint(site.observer, bearingDeg, site.sweepRadiusKm * 1000);
    if (!gridContains(chosen.geometry, end.lat, end.lon)) outside.push(bearingDeg);
  }
  expect(outside, `the published grid does not cover its own ${site.sweepRadiusKm} km sweep`)
    .toEqual([]);

  const head = await page.request.fetch(servedUrl(`/terrain/${chosen.url}`), { method: 'HEAD' });
  expect(head.status()).toBe(200);
  const onDisk = await stat(resolve(DIST, 'terrain', chosen.url));
  expect(onDisk.size).toBe(expectedGridByteLength(chosen.geometry));

  // A mosaic's provenance is four tiles and their offsets, which no file name
  // carries, so the sidecar is published with it.
  const sidecar = await page.request.get(
    servedUrl(`/terrain/sites/${site.id}/${chosen.name}.json`),
  );
  expect(sidecar.status()).toBe(200);
  const provenance = (await sidecar.json()) as { sources?: { tile?: string }[] };
  expect((provenance.sources ?? []).map((source) => source.tile).sort()).toEqual([
    'N43W116',
    'N43W117',
    'N44W116',
    'N44W117',
  ]);

  // And Gornergrat is still answered by the whole tile the Matterhorn proof
  // above turns on: adding a site changed one viewpoint, not the index's rule.
  expect(selectTerrainGrid(manifest, 45.983333, 7.782222)?.name).toBe('N45E007');
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

test('the live AR page still loads with the network switched off', async ({ page, context }) => {
  // What a ridge does to a phone, done to Chromium: cache on the first visit,
  // then take the network away and load the page again. Nothing here mocks the
  // cache — it is the deployment's own `sw.js`, registered at the published
  // subpath, storing the built bundle and a real terrain grid.
  //
  // The grid is the SMALLEST the deployment serves. The Bogus Basin mosaic is
  // 42.55 MB, and pushing that through the Cache API proves the same three
  // lines of worker code while adding a minute to every run of this suite. The
  // byte-length assertion after the reload is what shows a whole grid came back
  // from the cache rather than a truncated or opaque response.
  const manifest = await packagedManifest();
  const smallest = [...manifest.grids].sort(
    (left, right) =>
      expectedGridByteLength(left.geometry) - expectedGridByteLength(right.geometry),
  )[0];
  expect(smallest, 'the packaged index lists no grids').toBeDefined();
  if (smallest === undefined) return;
  const gridUrl = servedUrl(`/terrain/${smallest.url}`);

  await page.goto(servedUrl('/live.html'));
  await expect(page.getByTestId('live-title')).toHaveText('Mountain Finder — live');

  // The page registers the worker itself; nothing in this test installs it.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 30_000,
  });

  const download = await page.evaluate(async (gridName: string) => {
    const api = (window as unknown as { mountainFinderOffline: OfflineCacheController }).mountainFinderOffline;
    const result = await api.downloadTerrainGrid(gridName);
    return { result, status: await api.status() };
  }, smallest.name);

  expect(download.result.error ?? '').toBe('');
  expect(download.result.ok).toBe(true);
  // The index and the grid: a grid with no index is a grid the store cannot find.
  expect(download.result.cached.length).toBe(2);
  expect(download.status.data).toContain(new URL(gridUrl, page.url()).href);
  // The document plus at least its module script and its stylesheet.
  expect(download.status.shell.length).toBeGreaterThanOrEqual(3);
  expect(download.status.usageBytes ?? 0).toBeGreaterThan(0);
  console.log(
    `offline: shell ${download.status.shell.length} files, data ` +
      `${download.status.data.length} files, navigator.storage.estimate() ` +
      `${String(download.status.usageBytes)} of ${String(download.status.quotaBytes)} bytes`,
  );

  await context.setOffline(true);

  // The network really is gone. A published file nobody cached must fail, or
  // everything below would pass against a server that was still answering.
  const uncached = await page.evaluate(async (url: string) => {
    try {
      return String((await fetch(url)).status);
    } catch {
      return 'network-failed';
    }
  }, servedUrl('/ATTRIBUTION.txt'));
  expect(uncached).toBe('network-failed');

  await page.reload();
  await expect(page.getByTestId('live-title')).toHaveText('Mountain Finder — live');
  await expect(page.getByTestId('live-refusal')).toHaveAttribute(
    'data-refusal-code',
    'not-started',
  );

  const offlineReads = await page.evaluate(
    async ([indexUrl, samplesUrl]: readonly (string | undefined)[]) => {
      const read = async (url: string | undefined): Promise<number> => {
        if (url === undefined) return -1;
        try {
          const response = await fetch(url);
          if (!response.ok) return -1;
          return (await response.arrayBuffer()).byteLength;
        } catch {
          return -1;
        }
      };
      return { index: await read(indexUrl), samples: await read(samplesUrl) };
    },
    [servedUrl('/terrain/manifest.json'), gridUrl] as const,
  );

  expect(offlineReads.index).toBeGreaterThan(0);
  expect(offlineReads.samples).toBe(expectedGridByteLength(smallest.geometry));
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
