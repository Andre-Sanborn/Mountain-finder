/**
 * The Bogus Basin harness: the real field site, the real photograph, and the
 * helpers that drive a rehearsal of the field session against them.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS SEPARATE FROM `gornergrat.ts`
 * ═══════════════════════════════════════════════════════════════════════════
 * `gornergrat.ts` is bound to one viewpoint, one summit and one 800 × 450 frame.
 * Every constant in it — the observer, the eye height, the visible field, the
 * closed-form summit pixel — is that scene's. Generalising it would change the
 * numbers two spec files already assert. So the geometry is written out again
 * here in a form that takes its frame and its observer as arguments.
 *
 * The projection below is still not the code under test. It is the East-North-Up
 * definition, written from scratch, exactly as `gornergrat.ts` writes it, so an
 * expectation is never the output of `src/core/projection.ts`.
 *
 * ── THE POSE THIS HARNESS TREATS AS DOCUMENTED ─────────────────────────────
 * `fixtures/photos/real/hdr-gainmap-7270.heic` carries a position, a true
 * heading and a 35 mm-equivalent focal length in its EXIF, read by
 * `src/exif/heif.ts` and asserted in `src/exif/heif.test.ts`. It carries **no
 * pitch**, because EXIF has no field for one. So the documented pose's pitch is
 * zero, which is what `npm run annotate` defaults to, and
 * `docs/REAL-PHOTO-POSE.md` records that all three Idaho viewpoints look
 * slightly downward by an amount only Railroad Ridge has measured (−3.520°).
 * For IMG_7270 that reading is an eyeball one at n = 1 and carries no number, so
 * nothing here pretends to know it.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, type Page } from '@playwright/test';

import { geomagneticField } from '../../../src/core/declination';
import { parseTerrainManifest, type TerrainManifest } from '../../../src/providers/terrain-manifest';
import { SITE_PACKAGE_DIR } from '../../../src/sites/site-package';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, '../../..');

export const DEG = Math.PI / 180;

/* ── the site and the photograph ──────────────────────────────────────────── */

export const SITE_ID = 'bogus-basin';

/** Built by `npm run site:package`, into a gitignored directory. */
export const SITE_PACKAGE_MANIFEST = resolve(
  ROOT,
  SITE_PACKAGE_DIR,
  SITE_ID,
  'terrain/manifest.json',
);

export const PHOTO_PATH = 'fixtures/photos/real/hdr-gainmap-7270.heic';

/**
 * IMG_7270's EXIF pose, and what is missing from it.
 *
 * Position, heading and the 24 mm-equivalent lens are the file's own bytes
 * (`src/exif/heif.test.ts` asserts the heading and the focal length against
 * them). `pitchDeg` is not: EXIF records no pitch, and zero is what the rest of
 * this repository assumes in its absence.
 */
export const PHOTO_POSE = {
  lat: 43.77148,
  lon: -116.08862,
  headingDeg: 280.33596801190254,
  pitchDeg: 0,
  focalLength35mm: 24,
} as const;

/**
 * SRTM's reading at the photograph's own coordinate, `docs/REAL-PHOTO-POSE.md`.
 *
 * The phone's GPS altitude there is 2313.1 m, 4.8 m above this, which is the
 * cross-check that the position is right to well inside a DEM posting. The live
 * screen samples the terrain itself; `expectGroundHeight` below checks that what
 * it samples agrees with this figure rather than assuming it does.
 */
export const SITE_GROUND_M = 2308.3;

/** A standing eye above whatever the ground reads, as the live screen assumes. */
export const EYE_ABOVE_GROUND_M = 1.6;

/**
 * The angle the documented lens spans across the long side of the frame.
 *
 * "35 mm equivalent" names the 36 × 24 mm film gate, and this repository matches
 * the focal length against the 36 mm side (`src/core/projection.ts`). So a
 * 24 mm-equivalent lens has a half-field tangent of 18/24 = 0.75 exactly, and
 * spans 73.74° across the photograph's 8064 px width.
 */
export const LENS_LONG_SIDE_FOV_DEG = (2 * Math.atan(18 / PHOTO_POSE.focalLength35mm)) / DEG;

/**
 * The field of view of a landscape frame cut from the photograph at full width.
 *
 * On a flat sensor the half-frame dimensions scale with the aspect ratio, and a
 * dimension is proportional to the tangent of the half-angle, so it is the
 * tangents that scale. A 16:9 frame cut out of the 4:3 photograph therefore
 * keeps the whole 73.74° horizontally and loses height.
 */
export function fovForFrame(widthPx: number, heightPx: number): {
  readonly hFovDeg: number;
  readonly vFovDeg: number;
} {
  const halfTangent = Math.tan((LENS_LONG_SIDE_FOV_DEG * DEG) / 2);
  return {
    hFovDeg: LENS_LONG_SIDE_FOV_DEG,
    vFovDeg: (2 * Math.atan((halfTangent * heightPx) / widthPx)) / DEG,
  };
}

/* ── geodesy, written out rather than imported ────────────────────────────── */

export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** Initial great-circle bearing from observer to target, degrees. */
export function bearingDeg(from: LatLon, to: LatLon): number {
  const f1 = from.lat * DEG;
  const f2 = to.lat * DEG;
  const dl = (to.lon - from.lon) * DEG;
  const raw =
    Math.atan2(
      Math.sin(dl) * Math.cos(f2),
      Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl),
    ) / DEG;
  return (raw + 360) % 360;
}

/** Great-circle range on a sphere of mean radius, metres. */
export function rangeM(from: LatLon, to: LatLon): number {
  const R = 6_371_008.8;
  const f1 = from.lat * DEG;
  const f2 = to.lat * DEG;
  const a =
    Math.sin((f2 - f1) / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(((to.lon - from.lon) * DEG) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Apparent altitude of a summit, degrees, with the standard refraction
 * coefficient 0.13 folded into an effective Earth radius.
 */
export function apparentAltitudeDeg(
  eyeM: number,
  summitElevationM: number,
  distanceM: number,
): number {
  const effectiveRadiusM = 6_371_008.8 / (1 - 0.13);
  return (
    Math.atan(
      (summitElevationM - eyeM - (distanceM * distanceM) / (2 * effectiveRadiusM)) / distanceM,
    ) / DEG
  );
}

export interface FramePx {
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface CameraPose {
  readonly headingDeg: number;
  readonly pitchDeg: number;
  readonly rollDeg: number;
  readonly hFovDeg: number;
  readonly vFovDeg: number;
}

/**
 * Project a direction into a frame, independently of `src/core/projection.ts`.
 *
 * East-North-Up throughout. `forward` is the optical axis, `right` is level at
 * heading + 90°, `up` is `right × forward`, roll spins both about the axis, and
 * the perspective divide is scaled by the half-field tangents. This is
 * `gornergrat.ts`'s `projectIndependently` with the frame and the observer taken
 * as arguments instead of baked in.
 */
export function projectInto(
  frame: FramePx,
  pose: CameraPose,
  targetBearingDeg: number,
  targetAltitudeDeg: number,
): { xPx: number; yPx: number } {
  const dir = (bearing: number, altitude: number): [number, number, number] => [
    Math.cos(altitude * DEG) * Math.sin(bearing * DEG),
    Math.cos(altitude * DEG) * Math.cos(bearing * DEG),
    Math.sin(altitude * DEG),
  ];
  const cross = (
    a: [number, number, number],
    b: [number, number, number],
  ): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const forward = dir(pose.headingDeg, pose.pitchDeg);
  const h = pose.headingDeg * DEG;
  const levelRight: [number, number, number] = [Math.cos(h), -Math.sin(h), 0];
  const levelUp = cross(levelRight, forward);

  const r = pose.rollDeg * DEG;
  const right = levelRight.map(
    (value, i) => value * Math.cos(r) - (levelUp[i] ?? 0) * Math.sin(r),
  ) as [number, number, number];
  const up = levelRight.map(
    (value, i) => value * Math.sin(r) + (levelUp[i] ?? 0) * Math.cos(r),
  ) as [number, number, number];

  const target = dir(targetBearingDeg, targetAltitudeDeg);
  const depth = dot(target, forward);
  return {
    xPx:
      frame.widthPx *
      (0.5 + dot(target, right) / depth / (2 * Math.tan((pose.hFovDeg * DEG) / 2))),
    yPx:
      frame.heightPx *
      (0.5 - dot(target, up) / depth / (2 * Math.tan((pose.vFovDeg * DEG) / 2))),
  };
}

/**
 * The magnetic bearing to inject so the screen resolves `trueHeadingDeg` here.
 *
 * Idaho's declination is about +11.7°, so a Gornergrat conversion is 9° wrong at
 * this site. `heightM: 0` because Playwright's fix carries no altitude, so the
 * screen evaluates the same model at sea level.
 */
export function magneticBearingAt(at: LatLon, trueHeadingDeg: number, when: Date): number {
  const field = geomagneticField(
    { latitudeDeg: at.lat, longitudeDeg: at.lon, heightM: 0 },
    when,
  );
  return (((trueHeadingDeg - field.declinationDeg) % 360) + 360) % 360;
}

/* ── the committed peak region ────────────────────────────────────────────── */

export interface SitePeak {
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  readonly elevationM: number;
}

/** Every named summit in a committed peak region, read off the cells. */
export function regionPeaks(region: string): readonly SitePeak[] {
  const cellDir = resolve(ROOT, 'fixtures/peaks/regions', region, 'cells');
  const out: SitePeak[] = [];
  for (const file of readdirSync(cellDir)) {
    if (!file.endsWith('.json')) continue;
    const cell = JSON.parse(readFileSync(resolve(cellDir, file), 'utf8')) as {
      peaks?: {
        id?: unknown;
        name?: unknown;
        lat?: unknown;
        lon?: unknown;
        elevationM?: unknown;
      }[];
    };
    for (const peak of cell.peaks ?? []) {
      if (
        typeof peak.id !== 'string' ||
        typeof peak.name !== 'string' ||
        typeof peak.lat !== 'number' ||
        typeof peak.lon !== 'number' ||
        typeof peak.elevationM !== 'number'
      ) {
        continue;
      }
      out.push({
        id: peak.id,
        name: peak.name,
        lat: peak.lat,
        lon: peak.lon,
        elevationM: peak.elevationM,
      });
    }
  }
  return out;
}

/* ── serving the built site package ───────────────────────────────────────── */

/**
 * Publish the built site package the way `npm run package:deploy` does.
 *
 * The dev terrain plugin serves whole tiles and the committed case windows and
 * knows nothing of `data/sites/`, so the index is read from it and the site's
 * one grid is appended at the path the deployment publishes it under. Only those
 * two URLs are intercepted; every tile request still reaches the dev server.
 */
export async function serveSitePackage(page: Page, siteId: string): Promise<TerrainManifest> {
  const packageDir = resolve(ROOT, SITE_PACKAGE_DIR, siteId);
  const sitePath = resolve(packageDir, 'terrain/manifest.json');
  const siteManifest = parseTerrainManifest(
    JSON.parse(readFileSync(sitePath, 'utf8')) as unknown,
    sitePath,
  );
  const grid = siteManifest.grids[0];
  expect(grid, `${SITE_PACKAGE_DIR}/${siteId}/ holds no built terrain package`).toBeDefined();
  if (grid === undefined) throw new Error('no site grid');
  const samplesPath = resolve(packageDir, 'terrain', grid.url);
  const publishedUrl = `sites/${siteId}/${grid.url.split('/').pop() ?? ''}`;

  // Read the dev server's own index BEFORE the route is installed. `page.request`
  // does not go through `page.route`, but reading it first removes the question.
  const devIndex = await page.request.get('/terrain/manifest.json');
  expect(devIndex.status()).toBe(200);
  const devManifest = parseTerrainManifest((await devIndex.json()) as unknown, 'dev index');
  const served: TerrainManifest = {
    ...devManifest,
    grids: [...devManifest.grids, { ...grid, url: publishedUrl }],
  };

  await page.route(
    (url) =>
      url.pathname === '/terrain/manifest.json' || url.pathname === `/terrain/${publishedUrl}`,
    async (route) => {
      if (new URL(route.request().url()).pathname === '/terrain/manifest.json') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(served),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        path: samplesPath,
      });
    },
  );
  return served;
}

/* ── driving the screen ───────────────────────────────────────────────────── */

/** The pose the screen says it is drawing at, trim included. */
export async function drawnPose(page: Page): Promise<CameraPose> {
  const node = page.getByTestId('live-pose');
  const read = async (attribute: string): Promise<number> => {
    const raw = await node.getAttribute(attribute);
    expect(raw, `live-pose is missing ${attribute}`).not.toBeNull();
    return Number(raw);
  };
  return {
    headingDeg: await read('data-heading-deg'),
    pitchDeg: await read('data-pitch-deg'),
    rollDeg: await read('data-roll-deg'),
    hFovDeg: await read('data-hfov-deg'),
    vFovDeg: await read('data-vfov-deg'),
  };
}

/** The trim the user has dragged in so far, degrees. */
export async function currentTrim(page: Page): Promise<{ headingDeg: number; pitchDeg: number }> {
  const node = page.getByTestId('live-trim');
  return {
    headingDeg: Number(await node.getAttribute('data-heading-deg')),
    pitchDeg: Number(await node.getAttribute('data-pitch-deg')),
  };
}

/**
 * One drag on the picture, starting wherever a finger can actually reach it.
 *
 * The session panel covers the top strip and grows with its contents, so the
 * start is found rather than assumed: the first point where the drag surface is
 * the topmost element is a point a finger would land on. The pointer is captured
 * on press, so the rest of the gesture may leave the surface.
 */
export async function dragPictureFrom(
  page: Page,
  frame: FramePx,
  dxPx: number,
  dyPx: number,
): Promise<void> {
  const wanted = {
    // Leave room for the whole stroke inside the viewport.
    minX: Math.max(20, 20 - Math.min(0, dxPx)),
    maxX: Math.min(frame.widthPx - 20, frame.widthPx - 20 - Math.max(0, dxPx)),
  };
  const from = await page.evaluate(
    (box: { minX: number; maxX: number; height: number }) => {
      const surface = document.querySelector('[data-testid="live-drag"]');
      if (surface === null) return undefined;
      for (let y = Math.round(box.height / 2); y < box.height - 10; y += 5) {
        for (let x = box.minX; x < box.maxX; x += 20) {
          if (document.elementFromPoint(x, y) === surface) return { x, y };
        }
      }
      return undefined;
    },
    { minX: wanted.minX, maxX: wanted.maxX, height: frame.heightPx },
  );
  expect(from, 'no part of the picture is reachable for a drag').toBeDefined();
  if (from === undefined) return;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dxPx, from.y + dyPx, { steps: 8 });
  await page.mouse.up();
}
