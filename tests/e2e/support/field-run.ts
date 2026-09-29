/**
 * Driving `live.html?session=field` from a spec, and reading back what the share
 * sheet was handed.
 *
 * The field session's own e2e, `field-session.spec.ts`, carries its own copies of
 * these. They live here as well rather than being lifted out of it, because that
 * file is the registered self-check for the session and moving its helpers would
 * change what it proves. Nothing here calls `test()`.
 */

import { expect, type Page } from '@playwright/test';

/** A file the share sheet was handed, as the page saw it. */
export interface SharedFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  /** The text, for the JSON only. A frame's bytes come back from `sharedBytes`. */
  readonly text: string;
}

/** Install a share sheet that keeps every file it was handed. */
export async function installBundleShareStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { calls: 0, files: [] as unknown[], handles: [] as File[] };
    (window as unknown as Record<string, unknown>).__mfBundleShare = store;
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: { files?: File[] }) => Array.isArray(data.files) && data.files.length > 0,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        store.calls += 1;
        const files = data.files ?? [];
        if (files.length === 0) throw new Error('share was called with no files');
        store.handles = files;
        store.files = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            text: file.type === 'application/json' ? await file.text() : '',
          })),
        );
      },
    });
  });
}

export async function sharedBundleFiles(page: Page): Promise<readonly SharedFile[]> {
  return page.evaluate(
    () => (window as unknown as { __mfBundleShare: { files: SharedFile[] } }).__mfBundleShare.files,
  );
}

/** Every shared file's bytes, base64 encoded so they survive the bridge. */
export async function sharedBytes(page: Page): Promise<readonly { name: string; base64: string }[]> {
  return page.evaluate(async () => {
    const store = (window as unknown as { __mfBundleShare: { handles: File[] } }).__mfBundleShare;
    const out: { name: string; base64: string }[] = [];
    for (const file of store.handles) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      // One argument per byte blows the call stack on a multi-megabyte frame,
      // which is the bug `composite-page.html` already shipped once.
      for (let index = 0; index < bytes.length; index += 8192) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      }
      out.push({ name: file.name, base64: btoa(binary) });
    }
    return out;
  });
}

/** Tap the picture at one point, on the field session's own tap surface. */
export async function fieldTapAt(page: Page, xPx: number, yPx: number): Promise<void> {
  await page.getByTestId('field-session-tap-layer').evaluate(
    (node, point) => {
      node.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: point.xPx,
          clientY: point.yPx,
          pointerId: 1,
          pointerType: 'touch',
        }),
      );
    },
    { xPx, yPx },
  );
}

/** Wait until the phone has been still long enough for a capture. */
export async function holdStill(page: Page): Promise<void> {
  await expect(page.getByTestId('field-session-still')).toHaveAttribute('data-braced', 'true', {
    timeout: 20_000,
  });
}

/**
 * Tap Capture and wait for the count to reach `expected`.
 *
 * A refused capture says why in `field-session-capture-note`, which sits below
 * the fold, so the note is read on failure rather than the count timing out with
 * nothing to explain it.
 */
export async function capture(page: Page, expected: number): Promise<void> {
  await page.getByTestId('field-session-capture').click();
  try {
    await expect(page.getByTestId('field-session')).toHaveAttribute(
      'data-capture-count',
      String(expected),
      { timeout: 15_000 },
    );
  } catch (error) {
    const note = await page
      .getByTestId('field-session-capture-note')
      .textContent()
      .catch(() => null);
    throw new Error(`capture ${expected} was not taken; the screen said: ${note ?? '(nothing)'}`, {
      cause: error,
    });
  }
}

/** Where the summit dots landed, read off the rendered SVG. */
export async function summitDots(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page
    .locator('[data-testid="live-overlay-svg"] g.mf-summits circle')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        cx: Number(node.getAttribute('cx')),
        cy: Number(node.getAttribute('cy')),
      })),
    );
}
