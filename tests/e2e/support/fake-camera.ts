/**
 * A fake camera for headless Chromium, built from a committed photograph.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS STANDS IN FOR, AND WHAT IT DOES NOT
 * ═══════════════════════════════════════════════════════════════════════════
 * `--use-file-for-fake-video-capture=<file.y4m>` makes Chromium serve a real
 * `MediaStream` from a file: `getUserMedia` resolves, `enumerateDevices` lists a
 * `videoinput`, `track.getSettings()` reports the file's dimensions, and the
 * `<video>` element decodes and paints frames. So the whole camera path of the
 * AR screen runs for real — the device pick, the `object-fit: cover` geometry
 * read off `videoWidth`, the once-a-second settings poll, and the layer stack.
 *
 * What it does NOT stand in for is optics. The live path never looks at the
 * image: there is no CV in it (IMPLEMENTATION.md, "The route to the field
 * test"), so the pixels are scenery for a human reading a failure screenshot
 * and are an input to no assertion. Every geometric expectation in
 * `live.spec.ts` comes from the injected sensor pose and the served terrain.
 *
 * ── WHY A REAL PHOTOGRAPH RATHER THAN A TEST PATTERN ───────────────────────
 * `railroad-ridge-48mm.heic` is a landscape frame off the phone this app is
 * being built for, at that phone's own aspect ratio, and a trace screenshot
 * with a horizon in it is one a person can judge. It is one of the seven
 * originals AGENTS.md records the photographer's consent for. The generated
 * `.y4m` is written under `out/`, which is gitignored, so no derivative of a
 * personal photograph enters the repository.
 *
 * ── THE FORMAT ─────────────────────────────────────────────────────────────
 * YUV4MPEG2, one frame, planar 4:2:0. Chromium loops a single-frame file, so
 * one frame is a still camera pointed at a view — which is what a phone on a
 * tripod is. The BT.601 coefficients below are the ones the header's
 * `C420jpeg` tag names, and the even dimensions are required by 4:2:0
 * chroma subsampling.
 */

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');

/** Gitignored, so nothing derived from a personal photograph is committed. */
export const FAKE_CAMERA_DIR = resolve(ROOT, 'out/e2e');

/**
 * The frame the fake camera delivers.
 *
 * 1200 × 900 is a plausible phone video preview and keeps the raw file about
 * 1.6 MB. The aspect ratio is the source photograph's own 4:3, which is what
 * makes the `cover` crop in a 16:9 window a real crop rather than a contrived
 * one.
 */
export const FAKE_FRAME = { widthPx: 1200, heightPx: 900 } as const;

interface Rgba {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
}

async function decodePhoto(path: string): Promise<Rgba> {
  if (path.toLowerCase().endsWith('.heic')) {
    const { default: decodeHeic } = await import('heic-decode');
    const decoded = await decodeHeic({ buffer: await readFile(path) });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  const { default: jpeg } = await import('jpeg-js');
  const decoded = jpeg.decode(await readFile(path), { useTArray: true });
  return { width: decoded.width, height: decoded.height, data: decoded.data };
}

/** Box-average the source down to the target size, in RGBA. */
function resample(source: Rgba, widthPx: number, heightPx: number): Uint8Array {
  const out = new Uint8Array(widthPx * heightPx * 4);
  const scaleX = source.width / widthPx;
  const scaleY = source.height / heightPx;
  for (let y = 0; y < heightPx; y += 1) {
    const y0 = Math.floor(y * scaleY);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * scaleY));
    for (let x = 0; x < widthPx; x += 1) {
      const x0 = Math.floor(x * scaleX);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * scaleX));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = y0; sy < y1 && sy < source.height; sy += 1) {
        for (let sx = x0; sx < x1 && sx < source.width; sx += 1) {
          const p = (sy * source.width + sx) * 4;
          r += source.data[p] ?? 0;
          g += source.data[p + 1] ?? 0;
          b += source.data[p + 2] ?? 0;
          n += 1;
        }
      }
      const q = (y * widthPx + x) * 4;
      const divisor = n > 0 ? n : 1;
      out[q] = Math.round(r / divisor);
      out[q + 1] = Math.round(g / divisor);
      out[q + 2] = Math.round(b / divisor);
      out[q + 3] = 255;
    }
  }
  return out;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** RGBA to planar 4:2:0, BT.601 full range — what `C420jpeg` means. */
function toYuv420(rgba: Uint8Array, widthPx: number, heightPx: number): Buffer {
  const chromaWidth = widthPx / 2;
  const chromaHeight = heightPx / 2;
  const y = Buffer.alloc(widthPx * heightPx);
  const u = Buffer.alloc(chromaWidth * chromaHeight);
  const v = Buffer.alloc(chromaWidth * chromaHeight);

  for (let row = 0; row < heightPx; row += 1) {
    for (let col = 0; col < widthPx; col += 1) {
      const p = (row * widthPx + col) * 4;
      const r = rgba[p] ?? 0;
      const g = rgba[p + 1] ?? 0;
      const b = rgba[p + 2] ?? 0;
      y[row * widthPx + col] = clampByte(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  // Chroma is sampled at the top-left pixel of each 2×2 block. Averaging the
  // block would be marginally better and is beside the point: nothing asserts
  // on colour.
  for (let row = 0; row < chromaHeight; row += 1) {
    for (let col = 0; col < chromaWidth; col += 1) {
      const p = (row * 2 * widthPx + col * 2) * 4;
      const r = rgba[p] ?? 0;
      const g = rgba[p + 1] ?? 0;
      const b = rgba[p + 2] ?? 0;
      u[row * chromaWidth + col] = clampByte(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
      v[row * chromaWidth + col] = clampByte(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
    }
  }
  return Buffer.concat([y, u, v]);
}

export interface FakeCameraOptions {
  /** Source photograph, relative to the repository root. */
  readonly photo?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  /** Rebuild even when the file already exists. */
  readonly force?: boolean;
  /**
   * Centre-crop the photograph to the target aspect ratio before resampling.
   *
   * Without it the photograph is stretched to whatever shape is asked for,
   * which is harmless for scenery and wrong for a spec that reads angles off
   * the picture: a 4:3 frame squeezed into 16:9 no longer matches the lens its
   * EXIF names. Cropping keeps the horizontal field and throws away the top and
   * bottom, which is what a phone's 16:9 video preview does to a 4:3 sensor.
   */
  readonly cropToAspect?: boolean;
}

/** Centre-crop the source to `widthPx:heightPx`, keeping the longer field. */
function centreCrop(source: Rgba, widthPx: number, heightPx: number): Rgba {
  const wanted = widthPx / heightPx;
  const have = source.width / source.height;
  const cropWidth = have > wanted ? Math.round(source.height * wanted) : source.width;
  const cropHeight = have > wanted ? source.height : Math.round(source.width / wanted);
  const x0 = Math.floor((source.width - cropWidth) / 2);
  const y0 = Math.floor((source.height - cropHeight) / 2);
  const data = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const from = ((y + y0) * source.width + (x + x0)) * 4;
      const to = (y * cropWidth + x) * 4;
      data[to] = source.data[from] ?? 0;
      data[to + 1] = source.data[from + 1] ?? 0;
      data[to + 2] = source.data[from + 2] ?? 0;
      data[to + 3] = 255;
    }
  }
  return { width: cropWidth, height: cropHeight, data };
}

/**
 * Write the `.y4m` and return its absolute path.
 *
 * Cached: a HEIC decode of a 12 megapixel frame costs about 1.5 s, and the
 * output depends only on the committed source. `force` rebuilds it. A named
 * photograph puts its own basename in the file name, so two specs shooting
 * different scenes at the same size do not share one cache entry.
 */
export async function writeFakeCameraVideo(options: FakeCameraOptions = {}): Promise<string> {
  const photo = options.photo ?? 'fixtures/photos/real/railroad-ridge-48mm.heic';
  const widthPx = (options.widthPx ?? FAKE_FRAME.widthPx) & ~1;
  const heightPx = (options.heightPx ?? FAKE_FRAME.heightPx) & ~1;
  const stem =
    options.photo === undefined
      ? 'fake-camera'
      : `fake-camera-${(options.photo.split('/').pop() ?? options.photo).replace(/\.[^.]+$/, '')}`;
  const target = resolve(FAKE_CAMERA_DIR, `${stem}-${widthPx}x${heightPx}.y4m`);

  if (options.force !== true) {
    const existing = await stat(target).catch(() => undefined);
    if (existing !== undefined && existing.size > 0) return target;
  }

  const decoded = await decodePhoto(resolve(ROOT, photo));
  const source = options.cropToAspect === true ? centreCrop(decoded, widthPx, heightPx) : decoded;
  const rgba = resample(source, widthPx, heightPx);
  await mkdir(FAKE_CAMERA_DIR, { recursive: true });
  await writeFile(
    target,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${widthPx} H${heightPx} F30:1 Ip A1:1 C420jpeg\n`),
      Buffer.from('FRAME\n'),
      toYuv420(rgba, widthPx, heightPx),
    ]),
  );
  return target;
}
