/**
 * A tap on the picture that goes through the browser's hit-testing.
 *
 * A pointer event dispatched on a node reaches that node whatever is stacked
 * above it, so it cannot catch a surface a finger would never reach. A mouse
 * click lands on whatever is topmost at the point, as a finger does. Nothing
 * here calls `test()`.
 */

import { type Page } from '@playwright/test';

/**
 * Click the viewport at one point, and fail first if something other than the
 * named surface is topmost there.
 *
 * The check only names what is in the way. The click alone would fail too, by
 * landing on the wrong element and leaving the expected outcome undone.
 */
export async function tapSurfaceAt(
  page: Page,
  testId: string,
  xPx: number,
  yPx: number,
): Promise<void> {
  await page.getByTestId(testId).waitFor({ state: 'attached' });
  const topmost = await page.evaluate(
    ({ x, y }) => {
      const hit = document.elementFromPoint(x, y);
      if (hit === null) return '(nothing)';
      const id = hit.getAttribute('data-testid');
      return id ?? `${hit.tagName.toLowerCase()}.${hit.getAttribute('class') ?? ''}`;
    },
    { x: xPx, y: yPx },
  );
  if (topmost !== testId) {
    throw new Error(
      `a tap at (${xPx.toFixed(1)}, ${yPx.toFixed(1)}) would land on ${topmost}, not ${testId}`,
    );
  }
  await page.mouse.click(xPx, yPx);
}
