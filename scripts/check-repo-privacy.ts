/**
 * Refuse to commit a photograph's GPS position, a raw sensor capture, or a
 * capture bundle.
 *
 *   npm run check:privacy                      # scan the repository
 *   npm run check:privacy -- --approve <path>  # record a reviewed file (never in CI)
 *
 * This is the check AGENTS.md asks for under "Captures from the phone": part of
 * `npm run check`, failing on EXIF GPS in a new image and on decimal-degree
 * coordinate pairs in a new fixture. A photograph carries the place someone
 * stood and the time they stood there, and a sensor capture carries the same
 * thing without the picture. This repository is public, so neither can be
 * withdrawn once it is pushed.
 *
 * ── WHAT IT SCANS ──────────────────────────────────────────────────────────
 * Three git lists, merged: tracked files (`git ls-files`), files newly staged
 * for the next commit (`git diff --cached --name-only --diff-filter=A`), and
 * files present but not yet added (`git ls-files --others --exclude-standard`).
 * All three work on a clean CI checkout, where the last two are empty. The third
 * is what makes the gate useful before the commit rather than after it: a new
 * fixture fails the check while it is still a working-tree file.
 *
 * `--exclude-standard` honours `.gitignore`, so an ignored file is out of scope.
 * A capture bundle written to `captures/` or `out/` is therefore invisible here;
 * `.gitignore` is what keeps those out, and rule 3 below catches the one that is
 * force-added anyway.
 *
 * With no `.git` directory at all it walks the tree instead, skipping build
 * output, caches and downloaded data (`FALLBACK_SKIP_DIRECTORIES`) but NOT
 * `archive/`, which is tracked and so in scope either way.
 *
 * ── WHAT IT REFUSES ────────────────────────────────────────────────────────
 * 1. An image carrying GPS EXIF, unless that exact file is allow-listed by path
 *    and sha256. A HEIC, HEIF or DNG that `exifr` cannot open is refused too:
 *    it reads the EXIF in some HEIC files and answers "Unknown file format" for
 *    others, so a refusal there is no evidence of a clean file, and a camera
 *    original is the likeliest thing to be carrying a position.
 *
 * 2. A `.json`, `.ts`, `.tsx`, `.csv` or `.txt` file that holds a decimal-degree
 *    coordinate pair AND looks like a capture rather than a public coordinate,
 *    unless that exact file is allow-listed by path and sha256. Coordinates
 *    alone are not enough: this repository legitimately holds peak databases,
 *    case viewpoints, WMM test values and synthetic scenes, and a rule that
 *    fired on all of them would be switched off within a week. It also takes a
 *    capture shape — one of:
 *      - a capture-shaped key within 300 characters of the pair: `coords`, or
 *        anything matching `geolocation` (so `navigator.geolocation`,
 *        `GeolocationPosition`, `GeolocationCoordinates`);
 *      - a wall clock within 300 characters of the pair: an ISO 8601 instant
 *        with a time of day, or a timestamp-shaped key holding epoch seconds or
 *        milliseconds. A committed sensor fixture carries timestamps relative to
 *        the start of the capture, so a wall clock beside a coordinate is the
 *        shape of a raw capture;
 *      - the `latitude` / `longitude` / `accuracy` key set of a position fix.
 *        These three are searched for across the whole file rather than beside
 *        the pair, so prose and comments count as much as JSON does. The finding
 *        names each key and the line it was found on, because a file convicted
 *        by a sentence looks clean to anyone hunting for a fix object;
 *      - a capture-shaped path, such as a file named `capture*` or `session-*`.
 *
 * 3. Any file under a `captures/` or `bundles/` directory, whatever is in it.
 *    A capture bundle travels by the human's own action to their own account and
 *    is never committed. `.gitignore` keeps an accidental one out of the index;
 *    this catches a deliberate `git add -f`.
 *
 * ── HOW A REVIEWED FILE GETS ALLOW-LISTED ──────────────────────────────────
 * A human looks at the file, decides the coordinates in it are public, and runs:
 *
 *     npm run check:privacy -- --approve fixtures/whatever.json
 *
 * That records the path and its sha256 in `scripts/privacy-allowlist.json`, to
 * be committed with the file. Editing the file afterwards breaks the hash and
 * the check fails again, so a review covers the bytes that were reviewed and
 * nothing else. `--approve` refuses to run when `CI` is set: approval is a human
 * act, and a CI job that could grant it would be no gate at all.
 *
 * It reads files and computes hashes. It never touches the network.
 */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  describeCaptureShape,
  findCaptureShape,
  findCoordinatePairs,
  forbiddenDirectory,
  hasExtension,
  isCaptureShaped,
  isCaptureShapedPath,
  IMAGE_EXTENSIONS,
  OPAQUE_IMAGE_EXTENSIONS,
  readGpsVerdict,
  sha256OfFile,
  TEXT_EXTENSIONS,
} from './lib/privacy-detect.js';

const run = promisify(execFile);

export const ALLOWLIST_PATH = 'scripts/privacy-allowlist.json';

/** Skipped when there is no `.git` to ask. Build output, caches, downloads. */
const FALLBACK_SKIP_DIRECTORIES: readonly string[] = [
  '.git',
  'node_modules',
  'dist',
  'out',
  'coverage',
  'test-results',
  'playwright-report',
  '_site-serve',
  'data',
  'scratch',
  '.expo',
  'ios',
  'android',
];

export interface AllowlistEntry {
  readonly path: string;
  readonly sha256: string;
  readonly note: string;
}

export interface Allowlist {
  readonly images: readonly AllowlistEntry[];
  readonly coordinateFiles: readonly AllowlistEntry[];
}

const EMPTY_ALLOWLIST: Allowlist = { images: [], coordinateFiles: [] };

function readEntries(value: unknown): readonly AllowlistEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: AllowlistEntry[] = [];
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue;
    const { path, sha256, note } = item as Record<string, unknown>;
    if (typeof path !== 'string' || typeof sha256 !== 'string') continue;
    entries.push({ path, sha256, note: typeof note === 'string' ? note : '' });
  }
  return entries;
}

export async function loadAllowlist(path: string): Promise<Allowlist> {
  const text = await readFile(path, 'utf8').catch(() => undefined);
  if (text === undefined) return EMPTY_ALLOWLIST;
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null) return EMPTY_ALLOWLIST;
  const record = parsed as Record<string, unknown>;
  return {
    images: readEntries(record['images']),
    coordinateFiles: readEntries(record['coordinateFiles']),
  };
}

type AllowState = 'allowed' | 'changed' | 'absent';

function allowStateOf(
  entries: readonly AllowlistEntry[],
  path: string,
  digest: string,
): AllowState {
  const matches = entries.filter((entry) => entry.path === path);
  if (matches.length === 0) return 'absent';
  return matches.some((entry) => entry.sha256 === digest) ? 'allowed' : 'changed';
}

export type FileSource = 'git' | 'walk';

async function* walk(directory: string): AsyncGenerator<string> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (FALLBACK_SKIP_DIRECTORIES.includes(entry.name)) continue;
      yield* walk(join(directory, entry.name));
    } else if (entry.isFile()) {
      yield join(directory, entry.name);
    }
  }
}

/**
 * Repository-relative paths to scan, and where the list came from.
 *
 * Tracked, staged and unignored-untracked files, de-duplicated and sorted. A path
 * in the index but missing from the working tree — staged as deleted, or a sparse
 * checkout — is dropped, so the gate never fails on a file nobody can read.
 */
export async function discoverFiles(
  root: string,
): Promise<{ readonly paths: readonly string[]; readonly source: FileSource }> {
  const fromGit = async (args: readonly string[]): Promise<readonly string[]> => {
    const { stdout } = await run('git', [...args], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    return stdout.split('\0').filter((line) => line.length > 0);
  };

  let paths: readonly string[] | undefined;
  try {
    await run('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
    const tracked = await fromGit(['ls-files', '-z']);
    const staged = await fromGit(['diff', '--cached', '--name-only', '--diff-filter=A', '-z']);
    const untracked = await fromGit(['ls-files', '--others', '--exclude-standard', '-z']);
    paths = [...new Set([...tracked, ...staged, ...untracked])];
  } catch {
    paths = undefined;
  }

  if (paths === undefined) {
    const walked: string[] = [];
    for await (const path of walk(root)) walked.push(relative(root, path));
    return { paths: walked.sort(), source: 'walk' };
  }

  const present: string[] = [];
  for (const path of paths) {
    const info = await stat(join(root, path)).catch(() => undefined);
    if (info?.isFile() === true) present.push(path);
  }
  return { paths: present.sort(), source: 'git' };
}

export interface AuditStats {
  readonly considered: number;
  readonly imagesChecked: number;
  readonly textFilesScanned: number;
  readonly imagesAllowed: number;
  readonly coordinateFilesAllowed: number;
}

export interface AuditResult {
  readonly problems: readonly string[];
  readonly stats: AuditStats;
}

const APPROVE_HINT = (path: string): string =>
  `if its coordinates are public, review it and run: npm run check:privacy -- --approve ${path}`;

/**
 * Apply the three rules to a list of repository-relative paths.
 *
 * Pure apart from reading the files it was handed: the path list, the
 * allow-list and the root all come from the caller, so a test can point it at a
 * temporary directory with planted files.
 */
export async function auditFiles(
  root: string,
  paths: readonly string[],
  allowlist: Allowlist,
): Promise<AuditResult> {
  const problems: string[] = [];
  let imagesChecked = 0;
  let textFilesScanned = 0;
  let imagesAllowed = 0;
  let coordinateFilesAllowed = 0;

  for (const path of paths) {
    // The allow-list holds hashes and review notes, and it changes every time a
    // file is approved. Scanning it would need it to clear itself.
    if (path === ALLOWLIST_PATH) continue;

    const forbidden = forbiddenDirectory(path);
    if (forbidden !== undefined) {
      problems.push(
        `${path} — under a ${forbidden}/ directory. A capture bundle is never committed ` +
          "(AGENTS.md, \"Captures from the phone\"); it travels by the human's own action to " +
          'their own account. Delete it, or move it outside the repository.',
      );
      continue;
    }

    const absolute = join(root, path);

    if (hasExtension(path, IMAGE_EXTENSIONS)) {
      imagesChecked += 1;
      const digest = await sha256OfFile(absolute);
      const state = allowStateOf(allowlist.images, path, digest);
      if (state === 'allowed') {
        imagesAllowed += 1;
        continue;
      }

      const verdict = await readGpsVerdict(absolute);
      const changed = state === 'changed';
      if (verdict === 'gps') {
        problems.push(
          `${path} — an image carrying GPS EXIF (the place someone stood)` +
            (changed ? ', and its bytes differ from the allow-listed copy' : '') +
            `. Strip the EXIF, or ${APPROVE_HINT(path)}`,
        );
      } else if (verdict === 'unparseable' && hasExtension(path, OPAQUE_IMAGE_EXTENSIONS)) {
        problems.push(
          `${path} — a camera original this checker cannot read EXIF from, so it cannot be ` +
            'cleared as position-free' +
            (changed ? ', and its bytes differ from the allow-listed copy' : '') +
            `. Convert it to a format EXIF can be read from, or ${APPROVE_HINT(path)}`,
        );
      } else if (changed) {
        problems.push(
          `${path} — allow-listed, but its bytes have changed since review. ` +
            `Re-review it and run: npm run check:privacy -- --approve ${path}`,
        );
      }
      continue;
    }

    if (!hasExtension(path, TEXT_EXTENSIONS)) continue;

    textFilesScanned += 1;
    const content = await readFile(absolute, 'utf8').catch(() => '');
    const pairs = findCoordinatePairs(content);
    if (pairs.length === 0) continue;

    const shape = findCaptureShape(content, pairs);
    const captureShapedPath = isCaptureShapedPath(path);
    if (!isCaptureShaped(shape) && !captureShapedPath) continue;

    const digest = await sha256OfFile(absolute);
    const state = allowStateOf(allowlist.coordinateFiles, path, digest);
    if (state === 'allowed') {
      coordinateFilesAllowed += 1;
      continue;
    }

    const first = pairs[0];
    const where = first === undefined ? 'unknown line' : `line ${first.line}`;
    const reasons = [
      describeCaptureShape(shape),
      captureShapedPath ? 'a capture-shaped path' : '',
    ]
      .filter((reason) => reason.length > 0)
      .join('; ');
    problems.push(
      `${path} — a coordinate pair at ${where} with ${reasons}` +
        (state === 'changed' ? ', and its bytes have changed since review' : '') +
        `. ${APPROVE_HINT(path)}`,
    );
  }

  return {
    problems,
    stats: {
      considered: paths.length,
      imagesChecked,
      textFilesScanned,
      imagesAllowed,
      coordinateFilesAllowed,
    },
  };
}

export function summarise(stats: AuditStats, source: FileSource): string {
  return (
    `Repository privacy gate passed: ${stats.considered} file(s) from ${source}, ` +
    `${stats.imagesChecked} image(s) checked for GPS EXIF, ` +
    `${stats.textFilesScanned} text file(s) scanned for coordinates, ` +
    `${stats.imagesAllowed} image(s) and ${stats.coordinateFilesAllowed} ` +
    'coordinate file(s) cleared by the reviewed allow-list.'
  );
}

function bucketFor(path: string): 'images' | 'coordinateFiles' {
  return hasExtension(path, IMAGE_EXTENSIONS) ? 'images' : 'coordinateFiles';
}

function sortEntries(entries: readonly AllowlistEntry[]): AllowlistEntry[] {
  return [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Record `path` and its current sha256 as human-reviewed. */
export async function approve(
  root: string,
  allowlistPath: string,
  paths: readonly string[],
  note: string,
): Promise<string[]> {
  const allowlist = await loadAllowlist(allowlistPath);
  const buckets = {
    images: sortEntries(allowlist.images),
    coordinateFiles: sortEntries(allowlist.coordinateFiles),
  };

  const recorded: string[] = [];
  for (const raw of paths) {
    const path = relative(root, resolve(root, raw)).split('\\').join('/');
    const digest = await sha256OfFile(join(root, path));
    const bucket = buckets[bucketFor(path)];
    const existing = bucket.findIndex((entry) => entry.path === path);
    const entry: AllowlistEntry = { path, sha256: digest, note };
    if (existing >= 0) bucket.splice(existing, 1, entry);
    else bucket.push(entry);
    recorded.push(`${path} ${digest.slice(0, 12)}…`);
  }

  const body = {
    $comment:
      'Files a human reviewed and cleared for this repository. See the header of ' +
      'scripts/check-repo-privacy.ts. Add one with: npm run check:privacy -- --approve <path>',
    images: sortEntries(buckets.images),
    coordinateFiles: sortEntries(buckets.coordinateFiles),
  };
  await writeFile(allowlistPath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  return recorded;
}

/**
 * Throw when the environment is a CI runner.
 *
 * Clearing a file for this repository is a human review. A CI job that could
 * grant one would leave no gate at all, so `--approve` refuses to run where `CI`
 * is set.
 */
export function assertApprovalAllowed(env: Record<string, string | undefined>): void {
  const ci = env['CI'];
  if (ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0') {
    throw new Error(
      '--approve refuses to run under CI. Clearing a file for this repository is a human ' +
        'review, and a CI job that could grant it would leave no gate at all. Run it on your ' +
        `own machine and commit the updated ${ALLOWLIST_PATH}`,
    );
  }
}

interface Options {
  readonly approvals: readonly string[];
  readonly note: string;
}

export function parseArgs(argv: readonly string[]): Options {
  const approvals: string[] = [];
  let note = 'human-reviewed: coordinates are public';
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--approve') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--approve needs a path');
      approvals.push(value);
      i += 1;
    } else if (arg === '--note') {
      const value = argv[i + 1];
      if (value === undefined) throw new Error('--note needs a string');
      note = value;
      i += 1;
    } else if (arg !== undefined) {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { approvals, note };
}

async function main(): Promise<void> {
  const root = process.cwd();
  const allowlistPath = join(root, ALLOWLIST_PATH);
  const options = parseArgs(process.argv.slice(2));

  if (options.approvals.length > 0) {
    assertApprovalAllowed(process.env);
    const recorded = await approve(root, allowlistPath, options.approvals, options.note);
    process.stdout.write(
      `Recorded ${recorded.length} reviewed file(s) in ${ALLOWLIST_PATH}:\n` +
        recorded.map((line) => `  ${line}\n`).join('') +
        'Commit that file with the change it clears.\n',
    );
    return;
  }

  const { paths, source } = await discoverFiles(root);
  const allowlist = await loadAllowlist(allowlistPath);
  const { problems, stats } = await auditFiles(root, paths, allowlist);

  if (problems.length > 0) {
    throw new Error(
      `Repository privacy gate failed: ${problems.length} problem(s).\n` +
        problems.map((line) => `  ${line}`).join('\n') +
        '\n\nA photograph or a sensor capture records where someone stood and when. This ' +
        'repository is public, so a pushed position cannot be withdrawn. See AGENTS.md, ' +
        `"Privacy" and "Captures from the phone", and the header of scripts/${basename(
          fileURLToPath(import.meta.url),
        )}`,
    );
  }

  process.stdout.write(`${summarise(stats, source)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
