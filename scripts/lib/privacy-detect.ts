/**
 * Detection primitives shared by the two privacy gates:
 * `scripts/check-repo-privacy.ts`, which decides what may be committed, and
 * `scripts/check-deploy-privacy.ts`, which decides what may be published.
 *
 * The text detectors are pure: string in, findings out. The image detectors are
 * thin adapters over `exifr` and `node:fs`, kept here so both gates ask the same
 * question of a file and get the same answer.
 *
 * This is not `src/core/`, because it reads files. It lives beside the scripts
 * because only scripts import it; the app and the geometry do not.
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import exifr from 'exifr';

/**
 * Extensions worth asking for EXIF. A `.hgt` grid is int16 samples and a
 * `.json` cell is text; neither can hold an EXIF block, and the tiles are
 * 25 MB each, so they are not parsed.
 */
export const IMAGE_EXTENSIONS: readonly string[] = [
  '.heic',
  '.heif',
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
  '.dng',
  '.webp',
  '.avif',
];

/**
 * Extensions read as text when hunting for coordinate pairs. Markdown is
 * excluded: `docs/` discusses viewpoints in prose by design, and the documents
 * that print the standing-exception coordinates are named in AGENTS.md rather
 * than policed here.
 */
export const TEXT_EXTENSIONS: readonly string[] = ['.json', '.ts', '.tsx', '.csv', '.txt'];

/**
 * Camera-original containers `exifr` cannot always open. It reads the EXIF in
 * some HEIC files and refuses others with "Unknown file format", so for these
 * extensions a refusal is not evidence of a clean file.
 */
export const OPAQUE_IMAGE_EXTENSIONS: readonly string[] = ['.heic', '.heif', '.dng'];

export function hasExtension(path: string, extensions: readonly string[]): boolean {
  const lower = path.toLowerCase();
  return extensions.some((extension) => lower.endsWith(extension));
}

export function sha256OfBytes(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256OfFile(path: string): Promise<string> {
  return sha256OfBytes(await readFile(path));
}

function hasCoordinates(gps: unknown): boolean {
  if (typeof gps !== 'object' || gps === null) return false;
  const { latitude, longitude } = gps as { latitude?: unknown; longitude?: unknown };
  return typeof latitude === 'number' && typeof longitude === 'number';
}

export type GpsVerdict = 'gps' | 'none' | 'unparseable';

/**
 * Whether this image carries a GPS position.
 *
 * `unparseable` is reported apart from `none` because it is a different claim.
 * The repository gate treats a refusal as unreviewed; the deploy gate, which
 * walks a package full of files that are not images at all, treats it as `none`
 * and leans on its name and hash rules instead.
 */
export async function readGpsVerdict(path: string): Promise<GpsVerdict> {
  try {
    return hasCoordinates(await exifr.gps(path)) ? 'gps' : 'none';
  } catch {
    return 'unparseable';
  }
}

/** A decimal number written with at least three fractional digits. */
const PRECISE_DECIMAL = /-?\d{1,3}\.\d{3,}/g;

/** How far apart two numbers may sit and still read as one coordinate pair. */
const PAIR_WINDOW_CHARS = 80;

/**
 * How close a capture-shaped key or a wall clock must sit to a coordinate pair
 * to count as being "together with" it. 300 characters is a few lines of JSON
 * or one object literal. Without a window, the word `accuracy` in a paragraph
 * about geodesy convicted every provider module in the repository.
 */
const TOGETHER_WINDOW_CHARS = 300;

export interface CoordinatePair {
  /** Character offset of the first number. */
  readonly index: number;
  readonly line: number;
  readonly text: string;
}

/**
 * Counts newlines forward from wherever it last stopped.
 *
 * Pairs come out in increasing offset order, so one pass over the file numbers
 * all of them. Counting from zero for each pair instead made a peak-cell fixture
 * with hundreds of coordinates quadratic, and the whole scan slow enough that
 * the gate would have been tempting to skip.
 */
function makeLineCounter(content: string): (index: number) => number {
  let cursor = 0;
  let line = 1;
  return (index: number): number => {
    const limit = Math.min(index, content.length);
    for (; cursor < limit; cursor += 1) {
      if (content.charCodeAt(cursor) === 10) line += 1;
    }
    return line;
  };
}

/**
 * Decimal-degree pairs in this text.
 *
 * A pair is two numbers within `PAIR_WINDOW_CHARS` of each other, each written
 * with three or more fractional digits, where one is a plausible latitude
 * (|v| <= 90) and the other a plausible longitude (|v| <= 180). Three fractional
 * digits is about 100 m; coarser numbers are elevations, angles and tolerances,
 * which this repository is full of.
 *
 * The rule is loose on purpose. It decides only that coordinates are PRESENT.
 * Whether their presence is a problem is decided by the capture-shape rules
 * below and by the allow-list.
 */
export function findCoordinatePairs(content: string): readonly CoordinatePair[] {
  const numbers: { value: number; start: number; end: number }[] = [];
  for (const match of content.matchAll(PRECISE_DECIMAL)) {
    const index = match.index;
    if (index === undefined) continue;
    numbers.push({ value: Number(match[0]), start: index, end: index + match[0].length });
  }

  const pairs: CoordinatePair[] = [];
  const lineAt = makeLineCounter(content);
  for (let i = 0; i + 1 < numbers.length; i += 1) {
    const first = numbers[i];
    const second = numbers[i + 1];
    if (first === undefined || second === undefined) continue;
    if (second.start - first.end > PAIR_WINDOW_CHARS) continue;

    const a = Math.abs(first.value);
    const b = Math.abs(second.value);
    if (!((a <= 90 && b <= 180) || (a <= 180 && b <= 90))) continue;

    pairs.push({
      index: first.start,
      line: lineAt(first.start),
      text: content.slice(first.start, second.end),
    });
  }
  return pairs;
}

/**
 * The `GeolocationPosition.coords` wrapper, and the Geolocation API by name.
 * These are browser-capture vocabulary rather than EXIF or geodesy vocabulary,
 * which is why they convict and `GPSLatitude` does not.
 */
const CAPTURE_KEY_PATTERN = /(?:(?:^|[^A-Za-z])coords(?:[^A-Za-z]|$))|geolocation/gi;

/** `key:` or `"key":` — a key in an object literal or a JSON document. */
function keyPattern(name: string): RegExp {
  return new RegExp(`(?:^|[^A-Za-z])"?${name}"?\\s*:`, 'i');
}

/** The three keys a `GeolocationPosition.coords` object is recognised by. */
const FIX_KEY_PATTERNS = [
  { key: 'latitude', pattern: keyPattern('latitude') },
  { key: 'longitude', pattern: keyPattern('longitude') },
  { key: 'accuracy', pattern: keyPattern('accuracy') },
] as const;

/** Which line an offset falls on, counting from 1. */
function lineAt(content: string, index: number): number {
  let line = 1;
  const limit = Math.min(index, content.length);
  for (let i = 0; i < limit; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/**
 * A timestamp-shaped key holding seconds or milliseconds since the epoch, from
 * 2001 to 2096. The key is required: a bare ten-digit run is a substring of a
 * UUID and a bare nine-digit constant is the multiplier in a linear congruential
 * generator, and both are in this repository already.
 */
const KEYED_EPOCH =
  /(?:time|timestamp|epoch|clock|date|recorded|captured|started|taken)\w*"?\s*[:=]\s*\(?[123]\d{9}(?:\d{3})?(?![.\d])/gi;

/** An ISO 8601 instant carrying a time of day — a wall clock, not a date. */
const ISO_INSTANT = /\d{4}-[01]\d-[0-3]\d[T ][0-2]\d:[0-5]\d/g;

function firstMatchNear(
  content: string,
  pairs: readonly CoordinatePair[],
  pattern: RegExp,
): string | undefined {
  for (const match of content.matchAll(pattern)) {
    const index = match.index;
    if (index === undefined) continue;
    const near = pairs.some((pair) => Math.abs(pair.index - index) <= TOGETHER_WINDOW_CHARS);
    if (near) return match[0].trim().slice(0, 60);
  }
  return undefined;
}

/** One of a position fix's three keys, as it was written and where. */
export interface FixKeyMatch {
  /** `latitude`, `longitude` or `accuracy`. */
  readonly key: string;
  /** The matched text, so a reader can see which spelling tripped the rule. */
  readonly text: string;
  readonly line: number;
}

export interface CaptureShape {
  /** A capture-shaped key sitting next to a coordinate pair. */
  readonly key?: string;
  /** A wall-clock timestamp sitting next to a coordinate pair. */
  readonly clock?: string;
  /** All three of a fix's keys, in the order they are searched for. */
  readonly fixKeys?: readonly FixKeyMatch[];
}

/**
 * The three fix keys with their positions, or `undefined` when one is missing.
 *
 * The patterns are not global, so `exec` starts at the beginning each time and
 * reports the first spelling in the file. Three passes over the text is cheap
 * next to the coordinate scan that has already run.
 */
function findFixKeySet(content: string): readonly FixKeyMatch[] | undefined {
  const matches: FixKeyMatch[] = [];
  for (const { key, pattern } of FIX_KEY_PATTERNS) {
    const match = pattern.exec(content);
    if (match === null) return undefined;
    matches.push({ key, text: match[0].trim(), line: lineAt(content, match.index) });
  }
  return matches;
}

/**
 * What about this text looks like a raw position capture rather than a public
 * coordinate. Returns an empty object when nothing does.
 *
 * `fixKeys` is judged over the whole file rather than within a window: the three
 * keys together are specific enough on their own, and a pretty-printed fix can
 * put more than 300 characters between them.
 */
export function findCaptureShape(
  content: string,
  pairs: readonly CoordinatePair[],
): CaptureShape {
  if (pairs.length === 0) return {};
  const shape: { key?: string; clock?: string; fixKeys?: readonly FixKeyMatch[] } = {};

  const key = firstMatchNear(content, pairs, CAPTURE_KEY_PATTERN);
  if (key !== undefined) shape.key = key;

  const clock =
    firstMatchNear(content, pairs, KEYED_EPOCH) ?? firstMatchNear(content, pairs, ISO_INSTANT);
  if (clock !== undefined) shape.clock = clock;

  const fixKeys = findFixKeySet(content);
  if (fixKeys !== undefined) shape.fixKeys = fixKeys;
  return shape;
}

/**
 * Why this text looks like a capture, in the words a person needs to act on it.
 *
 * The fix-key sentence names each key and its line, and says that prose counts.
 * The rule searches the whole file for three keys that need not sit together, so
 * a paragraph or a comment that writes `latitude:`, `longitude:` and `accuracy:`
 * trips it exactly as a JSON fix does, and a reader hunting for a `coords` object
 * that is not there has no way to work that out from the verdict alone.
 */
export function describeCaptureShape(shape: CaptureShape): string {
  const parts: string[] = [];
  if (shape.key !== undefined) parts.push(`capture-shaped key near coordinates (${shape.key})`);
  if (shape.clock !== undefined) parts.push(`wall clock near coordinates (${shape.clock})`);
  if (shape.fixKeys !== undefined) {
    const where = shape.fixKeys.map((match) => `${match.text} at line ${match.line}`).join(', ');
    parts.push(
      'latitude/longitude/accuracy key set of a position fix ' +
        `(${where}; these are matched anywhere in the file, so prose and comments count too)`,
    );
  }
  return parts.join('; ');
}

export function isCaptureShaped(shape: CaptureShape): boolean {
  return shape.key !== undefined || shape.clock !== undefined || shape.fixKeys !== undefined;
}

/** Directory names a capture bundle lands in. Nothing under them is committable. */
const FORBIDDEN_DIRECTORIES: readonly string[] = ['captures', 'bundles'];

/** The forbidden segment of this path, when it has one. */
export function forbiddenDirectory(path: string): string | undefined {
  return path.split('/').find((segment) => FORBIDDEN_DIRECTORIES.includes(segment.toLowerCase()));
}

/**
 * Paths that hold captures even where the directory is not forbidden outright —
 * a session dump or a sensor log dropped beside the capture tooling. A file here
 * needs review whatever its keys look like.
 */
const CAPTURE_PATH_PATTERN =
  /(^|\/)(capture|session-|sensor-log|field-log)[^/]*$|(^|\/)(captures?|bundles?)\//i;

export function isCaptureShapedPath(path: string): boolean {
  return CAPTURE_PATH_PATTERN.test(path);
}
