/**
 * The `PngExporter` half of the seam (P4.2 / archive/v2-docs-20260929/TODO.md Q1).
 *
 * All the work is in `src/render/composite.ts`, which draws the photograph and
 * then the overlay onto a canvas in the browser's own rasteriser. This file is
 * only the adapter between the app's vocabulary (`photoUrl`, `frame`) and the
 * compositor's (`photoSrc`, `widthPx`/`heightPx`) — deliberately nothing more,
 * so there is exactly one implementation of compositing and the exported PNG
 * cannot drift from what the screen shows.
 *
 * The photo arrives as an object URL, which is same-origin and therefore does
 * not taint the canvas; `toBlob` keeps working. See the compositor's own module
 * docs for why the overlay goes through an `<img>` rather than being re-issued
 * as canvas calls.
 */

import { compositeToPngBlob } from '../render/composite';
import type { ExportRequest, PngExporter } from './seam';

export const compositePng: PngExporter = ({ photoUrl, svgMarkup, frame }: ExportRequest) =>
  compositeToPngBlob({
    photoSrc: photoUrl,
    overlaySvg: svgMarkup,
    widthPx: frame.widthPx,
    heightPx: frame.heightPx,
  });
