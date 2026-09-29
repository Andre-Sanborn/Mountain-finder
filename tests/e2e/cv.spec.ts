/**
 * Phase 7 in a real browser.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS WHEN THE UNIT SUITE ALREADY PASSES
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/cv` is written to run in the browser: the eventual caller is the web app
 * (and later the Expo app), handing over pixels straight out of a canvas. The
 * vitest suite runs it in Node against `Uint8Array` buffers this repository
 * constructed itself, and that leaves two claims untested:
 *
 *   1. **It is browser-safe.** No `node:` import, no Buffer, nothing that only
 *      exists under vitest, has crept into the module graph. A dynamic import
 *      of `/src/cv/index.ts` in a real page is the only thing that proves it,
 *      and it is exactly the failure mode v1 died of — code that looked fine
 *      and had never been executed where it was meant to run.
 *   2. **It works on the pixel buffer the app will actually give it.** That is
 *      a `Uint8ClampedArray` from `getImageData`, premultiplied and clamped by
 *      the browser's own canvas implementation, not an array we built. The
 *      round trip therefore goes photo → canvas → getImageData → extractor →
 *      aligner, which is the production path end to end.
 *
 * The expectation is the offset the test injects, decided here and now — the
 * same rule as the unit suite. And the artifact written to `out/` is a genuine
 * review: the extracted skyline drawn over the photograph it was read from, so
 * a human can see whether the line is on the ridge.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../out');

/** The Gornergrat fixture's framing: 28 mm-equivalent on a 4:3 frame. */
const WIDTH_PX = 900;
const HEIGHT_PX = 675;

/** Injected here, asserted below. Nothing reads it back out of the aligner. */
const INJECTED_HEADING_DEG = 8.4;
const INJECTED_PITCH_DEG = -1.75;

/** The accuracy archive/v2-docs-20260929/PLAN.md Phase 7 holds this to. */
const TOLERANCE_DEG = 0.5;

interface BrowserRun {
  readonly moduleError: string | null;
  readonly coverage01: number;
  readonly meanConfidence01: number;
  readonly status: string;
  readonly reason: string | null;
  readonly headingOffsetDeg: number | null;
  readonly pitchOffsetDeg: number | null;
  readonly confidence01: number | null;
  readonly score: number;
  readonly margin: number;
  readonly residualRmsDeg: number;
  readonly fogStatus: string;
  readonly fogReason: string | null;
  readonly pixelSource: string;
  readonly pngDataUrl: string;
}

test('the skyline aligner runs in the browser and recovers an injected offset', async ({
  page,
}) => {
  // Uncaught exceptions are the signal that matters for "does this module run
  // in a browser". Console errors are not: the app page this test borrows as a
  // host does its own fetching (a terrain manifest that is not published in
  // dev), and failing on that would be testing somebody else's module. So
  // exceptions are asserted empty, and failed requests are asserted only for
  // the source tree — a 404 under /src/ IS this test's business.
  const pageErrors: string[] = [];
  const failedSourceRequests: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (response.status() >= 400 && url.pathname.startsWith('/src/')) {
      failedSourceRequests.push(`${response.status()} ${url.pathname}`);
    }
  });

  await page.goto('/');

  const result = (await page.evaluate(
    async ({ widthPx, heightPx, headingOffsetDeg, pitchOffsetDeg }) => {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      // The specifier is held in a variable so this stays a *runtime* import
      // the browser resolves against the dev server, not something the spec's
      // own compiler tries to type-check against the filesystem. That is the
      // whole point of the test: these modules must load and run as served.
      const load = (path: string): Promise<any> => import(path);
      let cv: any;
      let raster: any;
      let profiles: any;
      let projection: any;
      try {
        [cv, raster, profiles, projection] = await Promise.all([
          load('/src/cv/index.ts'),
          load('/src/cv/testing/raster.ts'),
          load('/src/cv/testing/profiles.ts'),
          load('/src/core/projection.ts'),
        ]);
      } catch (error) {
        return { moduleError: String(error) };
      }

      const profile = profiles.signatureProfile(265, 60);
      const truePose = projection.cameraPoseFromFocalLength({
        headingDeg: 265.4,
        pitchDeg: 3,
        focalLength35mm: 28,
        imageWidthPx: widthPx,
        imageHeightPx: heightPx,
      });

      // Draw the photograph with the pure rasteriser, then push it through a
      // real canvas so that what the extractor sees is a browser-produced
      // ImageData buffer — the same object the app gets from a dropped photo.
      const drawn = raster.renderSkylinePhoto({
        widthPx,
        heightPx,
        pose: truePose,
        profile,
        noise01: 0.025,
        seed: 20260816,
        clouds: [{ xNorm: 0.28, yNorm: 0.2, radiusNorm: 0.2, strength: 0.8 }],
        sun: { xNorm: 0.82, yNorm: 0.14, radiusNorm: 0.14 },
      });

      const canvas = document.createElement('canvas');
      canvas.width = widthPx;
      canvas.height = heightPx;
      const context = canvas.getContext('2d');
      if (context === null) return { moduleError: 'no 2d context' };
      const imageData = context.createImageData(widthPx, heightPx);
      imageData.data.set(drawn.data);
      context.putImageData(imageData, 0, 0);

      const fromCanvas = context.getImageData(0, 0, widthPx, heightPx);
      const image = { width: widthPx, height: heightPx, data: fromCanvas.data };

      const skyline = cv.extractSkyline(image);
      const nominal = {
        ...truePose,
        headingDeg: truePose.headingDeg - headingOffsetDeg,
        pitchDeg: truePose.pitchDeg - pitchOffsetDeg,
      };
      const alignment = cv.alignSkyline(skyline, nominal, profile);

      // Draw the extracted skyline over the photograph as the review artifact.
      context.strokeStyle = 'rgba(255,64,160,0.95)';
      context.lineWidth = 2;
      context.beginPath();
      let started = false;
      for (const column of skyline.columns) {
        if (column.rowNorm === undefined) {
          started = false;
          continue;
        }
        const x = column.xNorm * widthPx;
        const y = column.rowNorm * heightPx;
        if (started) context.lineTo(x, y);
        else context.moveTo(x, y);
        started = true;
      }
      context.stroke();

      // A second, independent control: fog must be refused in the browser too.
      const fog = raster.renderFog(widthPx, heightPx, 3);
      const fogAlignment = cv.alignSkyline(cv.extractSkyline(fog), nominal, profile);

      return {
        moduleError: null,
        coverage01: skyline.coverage01,
        meanConfidence01: skyline.meanConfidence01,
        status: alignment.status,
        reason: alignment.status === 'failed' ? alignment.reason : null,
        headingOffsetDeg: alignment.status === 'failed' ? null : alignment.headingOffsetDeg,
        pitchOffsetDeg: alignment.status === 'failed' ? null : alignment.pitchOffsetDeg,
        confidence01: alignment.status === 'failed' ? null : alignment.confidence01,
        score: alignment.diagnostics.score,
        margin: alignment.diagnostics.margin,
        residualRmsDeg: alignment.diagnostics.residualRmsDeg,
        fogStatus: fogAlignment.status,
        fogReason: fogAlignment.status === 'failed' ? fogAlignment.reason : null,
        pixelSource: fromCanvas.data.constructor.name,
        pngDataUrl: canvas.toDataURL('image/png'),
      };
      /* eslint-enable @typescript-eslint/no-explicit-any */
    },
    {
      widthPx: WIDTH_PX,
      heightPx: HEIGHT_PX,
      headingOffsetDeg: INJECTED_HEADING_DEG,
      pitchOffsetDeg: INJECTED_PITCH_DEG,
    },
  )) as BrowserRun;

  expect(result.moduleError, 'src/cv must import cleanly in a browser').toBeNull();
  expect(failedSourceRequests, 'every /src/ module the aligner needs must load').toEqual([]);
  expect(pageErrors, 'no uncaught exception while running the aligner').toEqual([]);

  // The buffer really came from the browser's canvas, not from our own array.
  expect(result.pixelSource).toBe('Uint8ClampedArray');

  expect(result.coverage01).toBeGreaterThan(0.9);
  expect(result.meanConfidence01).toBeGreaterThan(0.5);

  expect(result.status).toBe('aligned');
  expect(result.headingOffsetDeg).not.toBeNull();
  expect(result.pitchOffsetDeg).not.toBeNull();
  expect(Math.abs((result.headingOffsetDeg ?? 0) - INJECTED_HEADING_DEG)).toBeLessThan(
    TOLERANCE_DEG,
  );
  expect(Math.abs((result.pitchOffsetDeg ?? 0) - INJECTED_PITCH_DEG)).toBeLessThan(TOLERANCE_DEG);
  expect(result.score).toBeGreaterThan(0.9);

  // …and the refusal path works here too, so a browser build cannot quietly
  // lose the one behaviour the whole feature's safety rests on.
  expect(result.fogStatus).toBe('failed');
  expect(result.fogReason).toBe('insufficient-skyline');

  const base64 = result.pngDataUrl.replace(/^data:image\/png;base64,/, '');
  expect(base64.length).toBeGreaterThan(1000);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'cv-skyline.png'), Buffer.from(base64, 'base64'));
});
