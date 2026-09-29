/**
 * Refuse to publish a package that carries somebody's photographs.
 *
 *   npm run check:deploy-privacy            # checks dist/
 *   npm run check:deploy-privacy -- _site
 *
 * AGENTS.md: a photograph carries the place someone stood and the time they
 * stood there, and `fixtures/photos/real/` holds eleven frames the human
 * photographed, with the GPS position of each viewpoint in their EXIF. Those
 * files are in the repository by a recorded, narrow consent — reference frames
 * for this project's own tests. Consent to commit them to a private-ish
 * development repository is NOT consent to publish them at a public HTTPS URL,
 * which is exactly what the GitHub Pages workflow does with whatever is in the
 * packaged directory.
 *
 * Nothing in `scripts/package-deploy.ts` stages a photograph today, so this
 * check passes on every current package. That is the point: the check is cheap
 * while it is true, and it is the thing that notices the day it stops being
 * true — a debugging fixture copied into `dist/` by hand, a future packaging
 * step that stages "the acceptance photos", a Vite `publicDir` that someone
 * points at `fixtures/`. A published photograph cannot be unpublished.
 *
 * ── WHAT IT REFUSES ────────────────────────────────────────────────────────
 *   1. any file whose CONTENT is byte-identical to a file under
 *      `fixtures/photos/real/` (renaming it does not make it another photo);
 *   2. any file whose NAME is one of those files' names, whatever is inside it;
 *   3. any image anywhere in the package that carries GPS EXIF — including a
 *      photograph that was never in this repository at all.
 *
 * Rule 3 is the general one and the reason this is not just a path check: the
 * private thing is the coordinate, not the provenance. Rule 1 catches a
 * stripped-EXIF copy of a private frame, where the image itself is still the
 * human's.
 *
 * It reads files and computes hashes. It never touches the network.
 */

import { readdir, stat } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';

import {
  hasExtension,
  IMAGE_EXTENSIONS,
  readGpsVerdict,
  sha256OfFile,
} from './lib/privacy-detect.js';

/** The standing-exception directory whose contents must never be published. */
const PRIVATE_PHOTO_DIR = 'fixtures/photos/real';

interface PrivateFile {
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
}

/** Every file under `fixtures/photos/real/`, by name, size and content hash. */
async function readPrivatePhotos(root: string): Promise<readonly PrivateFile[]> {
  const directory = join(root, PRIVATE_PHOTO_DIR);
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files: PrivateFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(directory, entry.name);
    files.push({
      name: entry.name,
      size: (await stat(path)).size,
      sha256: await sha256OfFile(path),
    });
  }
  return files;
}

async function* walk(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile()) yield path;
  }
}

/**
 * `true` when this file carries a GPS position.
 *
 * A file `exifr` cannot parse is reported as "no GPS", deliberately: this runs
 * over a package full of files that are not images at all, and treating an
 * unparseable byte string as a privacy breach would make the gate useless. The
 * name and hash rules above do not depend on parsing.
 */
async function carriesGps(path: string): Promise<boolean> {
  return (await readGpsVerdict(path)) === 'gps';
}

async function main(): Promise<void> {
  const root = process.cwd();
  const target = resolve(root, process.argv[2] ?? 'dist');

  const info = await stat(target).catch(() => undefined);
  if (info === undefined || !info.isDirectory()) {
    throw new Error(
      `${relative(root, target) || target} is not a directory. This checks a PACKAGED ` +
        'deployment:\n  npm run build && npm run package:deploy -- --gzip',
    );
  }

  const privatePhotos = await readPrivatePhotos(root);
  const bySize = new Map<number, PrivateFile[]>();
  const byName = new Map<string, PrivateFile>();
  for (const photo of privatePhotos) {
    const group = bySize.get(photo.size) ?? [];
    group.push(photo);
    bySize.set(photo.size, group);
    byName.set(photo.name, photo);
  }

  const problems: string[] = [];
  let scanned = 0;
  let imagesParsed = 0;

  for await (const path of walk(target)) {
    scanned += 1;
    const shown = relative(root, path);
    const name = basename(path);
    const lower = name.toLowerCase();

    if (byName.has(name)) {
      problems.push(`${shown} — named like ${PRIVATE_PHOTO_DIR}/${name}, which is private`);
      continue;
    }

    // Only files that could BE one of those photos are hashed: identical
    // content means identical length, so the size index rules out the 25 MB
    // tiles without reading them.
    const sameSize = bySize.get((await stat(path)).size);
    if (sameSize !== undefined) {
      const digest = await sha256OfFile(path);
      const match = sameSize.find((photo) => photo.sha256 === digest);
      if (match !== undefined) {
        problems.push(
          `${shown} — byte-identical to ${PRIVATE_PHOTO_DIR}/${match.name}, renamed`,
        );
        continue;
      }
    }

    if (hasExtension(lower, IMAGE_EXTENSIONS)) {
      imagesParsed += 1;
      if (await carriesGps(path)) {
        problems.push(`${shown} — an image carrying GPS EXIF (the place someone stood)`);
      }
    }
  }

  const where = relative(root, target) || target;
  if (problems.length > 0) {
    throw new Error(
      `Refusing to publish ${where}/: ${problems.length} privacy problem(s).\n` +
        problems.map((line) => `  ${line}`).join('\n') +
        '\n\nA published photograph cannot be unpublished. Personal frames live in ' +
        `${PRIVATE_PHOTO_DIR}/ and are committed under a narrow recorded consent ` +
        '(AGENTS.md, "Privacy"); publishing them at a public URL is not covered by it. ' +
        'Remove them from the package, or get the photographer’s explicit yes first.',
    );
  }

  process.stdout.write(
    `Privacy gate passed on ${where}/: ${scanned} file(s) scanned, ` +
      `${imagesParsed} image(s) parsed for GPS EXIF, ` +
      `${privatePhotos.length} private photo(s) matched against by name and content.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
