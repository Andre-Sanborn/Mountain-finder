/**
 * Turning an overlay into a PNG from Node — for `npm run demo` (archive/v2-docs-20260929/TODO.md Q3).
 *
 * archive/v2-docs-20260929/PLAN.md P4.2 puts compositing in a browser on purpose: the only alternative
 * is `node-canvas`, a native build of Cairo and Pango that would be a SECOND
 * text-and-SVG engine, disagreeing in small ways with the one the app actually
 * renders in. Chromium is already installed here and already driven by
 * Playwright, so the demo drives the same `src/render/composite.ts` the app
 * calls, in the same engine, with zero new dependencies.
 *
 * The cost is that a demo image needs a dev server (to serve the TypeScript
 * module) and a browser. Both are started and stopped inside this function; a
 * caller sees `svg in → png bytes out`. Both failures — no Chromium, no server
 * — are reported as instructions, never as a stack trace, because this is a
 * developer tool and a wall of Playwright internals is not a diagnosis.
 */

import { existsSync } from 'node:fs';

import { chromium } from '@playwright/test';
import { createServer } from 'vite';

export interface RasteriseInput {
  /**
   * Backdrop SVG — what the overlay is composited ONTO. Ignored when
   * `backdropDataUrl` is set.
   */
  readonly backdropSvg: string;
  /**
   * A real photograph as an `image/*` data URL, used instead of `backdropSvg`.
   *
   * Kept separate rather than folded into the SVG because a photograph put
   * inside an `<image>` element inside an SVG is base64-encoded twice — a 4 MB
   * JPEG becomes about 7.5 MB of string — and the compositor takes an image
   * source directly. `npm run annotate` uses this; `npm run demo` does not.
   */
  readonly backdropDataUrl?: string;
  /** The overlay SVG from `buildOverlaySvgFromLayout`. */
  readonly overlaySvg: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

/** Where the compositor page lives, relative to the dev server root. */
const COMPOSITE_PAGE = 'src/render/composite-page.html';

/**
 * The same Chromium resolution `playwright.config.ts` uses: this environment
 * ships one at /opt/pw-browsers/chromium whose revision Playwright would not
 * otherwise match. Falls back to Playwright's own download elsewhere.
 */
function launchOptions(): { executablePath?: string } {
  const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
  return existsSync(preinstalled) ? { executablePath: preinstalled } : {};
}

/** Thrown for a missing browser or server — the message is the whole diagnosis. */
export class RasteriseUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RasteriseUnavailableError';
  }
}

/**
 * Composite backdrop + overlay into PNG bytes.
 *
 * Everything is torn down before returning, so a caller can use this in a
 * one-shot script without leaking a server or a browser process.
 */
export async function rasteriseToPng(input: RasteriseInput): Promise<Uint8Array> {
  const server = await createServer({ server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const base = server.resolvedUrls?.local[0];
  if (base === undefined) {
    await server.close();
    throw new RasteriseUnavailableError('The Vite dev server started but reported no URL.');
  }

  const browser = await chromium.launch(launchOptions()).catch((cause: unknown) => {
    throw new RasteriseUnavailableError(
      'Could not start Chromium, which is what rasterises the PNG.\n' +
        '  Install it with:  npx playwright install chromium\n' +
        '  or point at one:  CHROMIUM_PATH=/path/to/chromium npm run demo -- <case>\n' +
        '  or skip the image: npm run demo -- <case> --no-png',
      { cause },
    );
  });

  try {
    const page = await browser.newPage();
    const failures: string[] = [];
    page.on('pageerror', (error) => failures.push(error.message));

    await page.goto(new URL(COMPOSITE_PAGE, base).href);
    await page.waitForFunction(() => (window as unknown as { mfCompositeReady?: boolean }).mfCompositeReady === true, undefined, {
      timeout: 30_000,
    }).catch((cause: unknown) => {
      throw new RasteriseUnavailableError(
        `The compositor page (${COMPOSITE_PAGE}) never became ready` +
          `${failures.length === 0 ? '' : `: ${failures.join('; ')}`}`,
        { cause },
      );
    });

    const dataUrl = await page.evaluate(
      (payload: RasteriseInput) =>
        (
          window as unknown as {
            mfComposite: (value: RasteriseInput) => Promise<string>;
          }
        ).mfComposite(payload),
      input,
    );

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  } finally {
    await browser.close();
    await server.close();
  }
}
