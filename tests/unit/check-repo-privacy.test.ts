/**
 * `scripts/check-repo-privacy.ts` — one planted file per rule.
 *
 * WHERE THE EXPECTATIONS COME FROM. The rules as the script's header states
 * them, not from running it. Each planted file is built to satisfy exactly one
 * rule's conditions, or to satisfy none, and the expectation is whether that
 * rule should fire. The pass cases matter as much as the fail cases: a privacy
 * gate that convicts a legitimate fixture gets switched off, so the sensor
 * fixture written the way AGENTS.md asks for — orientation events, timestamps
 * relative to the start of the capture — has to come out clean.
 *
 * Planted files go in a temporary directory. Writing a file with GPS EXIF or a
 * coordinate dump into the repository to test the gate would be the thing the
 * gate is for.
 *
 * The one file copied in is `fixtures/photos/chamonix-north-east.jpg`, a
 * synthetic grey frame with authored EXIF from `src/exif/testing/generate.ts`.
 * Its GPS position is an invented test value, so it stands in for "an image
 * carrying GPS EXIF" without moving anybody's real photograph around.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  approve,
  assertApprovalAllowed,
  auditFiles,
  discoverFiles,
  loadAllowlist,
  type Allowlist,
} from '../../scripts/check-repo-privacy.js';
import {
  hasExtension,
  sha256OfBytes,
  TEXT_EXTENSIONS,
} from '../../scripts/lib/privacy-detect.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const GPS_JPEG = 'fixtures/photos/chamonix-north-east.jpg';

const EMPTY: Allowlist = { images: [], coordinateFiles: [] };

/**
 * The planted coordinates, assembled from integers at run time.
 *
 * A decimal-degree literal anywhere in this file's source would make this file a
 * finding for the very gate it tests, and every edit to the test would then need
 * a fresh review. Every number below is invented; only its shape matters. The
 * same rule keeps the orientation values to two fractional digits, which is
 * below the three the coordinate detector looks for.
 */
const LAT_DEG = 437_715 / 10_000;
const LON_DEG = -1_160_886 / 10_000;
const LAT2_DEG = 437_732 / 10_000;
const LON2_DEG = -1_160_842 / 10_000;

/** An orientation capture written the way AGENTS.md asks: no position, no clock. */
const CLEAN_SENSOR_FIXTURE = JSON.stringify(
  {
    note: 'orientation and motion only; t is milliseconds from the start of the capture',
    events: [
      { t: 0, alpha: 12.5, beta: 3.25, gamma: -1.5 },
      { t: 48, alpha: 12.88, beta: 3.5, gamma: -1.63 },
      { t: 96, alpha: 13.13, beta: 3.75, gamma: -1.75 },
    ],
  },
  null,
  2,
);

/**
 * The same capture with the browser's position object left in. Keyed `lat`/`lon`
 * rather than `latitude`/`longitude`, so the only rule that can convict it is
 * the `coords` key: with the full key set of a fix it would be caught twice, and
 * a test that two rules pass proves neither.
 */
const SENSOR_FIXTURE_WITH_COORDS = JSON.stringify(
  {
    coords: { lat: LAT_DEG, lon: LON_DEG },
    events: [{ t: 0, alpha: 12.5, beta: 3.25, gamma: -1.5 }],
  },
  null,
  2,
);

/** A position fix by its key set alone: no `coords` wrapper and no clock. */
const POSITION_FIX_KEYS = JSON.stringify(
  { latitude: LAT_DEG, longitude: LON_DEG, accuracy: 4.5, altitude: 2011.5 },
  null,
  2,
);

/**
 * A fix described in a sentence, not in JSON.
 *
 * The three keys are searched for across the whole file, so prose convicts a
 * file exactly as an object literal does. Line 2 carries the coordinate pair and
 * two of the keys; line 3 carries the third.
 */
const FIX_KEYS_IN_PROSE = [
  'Notes on what the screen showed while the fix settled.',
  `It reported latitude: ${LAT_DEG} and longitude: ${LON_DEG} while I stood there.`,
  'The accuracy: figure beside them is a radius in metres, not a position.',
].join('\n');

/** Coordinates beside a wall clock: epoch seconds, and an ISO instant. */
const EPOCH_AND_COORDS = JSON.stringify(
  {
    samples: [
      { timestamp: 1791043200, lat: LAT_DEG, lon: LON_DEG },
      { recordedAt: '2026-10-15T09:14:00Z', lat: LAT2_DEG, lon: LON2_DEG },
    ],
  },
  null,
  2,
);

/** Coordinates with no capture shape at all — a peak database row. */
const PUBLIC_PEAKS = JSON.stringify(
  {
    peaks: [
      { name: 'Sunset Mountain', lat: LAT_DEG, lon: LON_DEG, elevationM: 2393 },
      { name: 'Gornergrat', lat: LAT2_DEG, lon: LON2_DEG, elevationM: 3089 },
    ],
  },
  null,
  2,
);

describe('repository privacy gate', () => {
  let root = '';
  let gpsJpeg = new Uint8Array();

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'repo-privacy-'));
    gpsJpeg = await readFile(join(REPO_ROOT, GPS_JPEG));

    await mkdir(join(root, 'fixtures/sensors'), { recursive: true });
    await mkdir(join(root, 'fixtures/captures'), { recursive: true });
    await mkdir(join(root, 'fixtures/bundles'), { recursive: true });

    await writeFile(join(root, 'photo-with-gps.jpg'), gpsJpeg);
    // A HEIC `exifr` cannot open. Real camera HEICs in fixtures/photos/real/ do
    // the same thing, so an unreadable container is refused rather than cleared.
    await writeFile(join(root, 'camera-original.heic'), Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7]));
    await writeFile(join(root, 'allow-listed.jpg'), gpsJpeg);
    await writeFile(join(root, 'fixtures/sensors/clean.json'), CLEAN_SENSOR_FIXTURE);
    await writeFile(join(root, 'fixtures/sensors/with-coords.json'), SENSOR_FIXTURE_WITH_COORDS);
    await writeFile(join(root, 'fixtures/sensors/epoch-coords.json'), EPOCH_AND_COORDS);
    await writeFile(join(root, 'fixtures/sensors/fix-keys.json'), POSITION_FIX_KEYS);
    await mkdir(join(root, 'fixtures/notes'), { recursive: true });
    await writeFile(join(root, 'fixtures/notes/fix-in-prose.txt'), FIX_KEYS_IN_PROSE);
    await writeFile(join(root, 'fixtures/public-peaks.json'), PUBLIC_PEAKS);
    await writeFile(join(root, 'fixtures/sensors/capture-01.json'), PUBLIC_PEAKS);
    await writeFile(join(root, 'fixtures/captures/session.json'), CLEAN_SENSOR_FIXTURE);
    await writeFile(join(root, 'fixtures/bundles/readme.txt'), 'nothing in here\n');
  });

  afterAll(async () => {
    if (root !== '') await rm(root, { recursive: true, force: true });
  });

  const audit = async (paths: readonly string[], allowlist = EMPTY): Promise<readonly string[]> =>
    (await auditFiles(root, paths, allowlist)).problems;

  it('refuses an image carrying GPS EXIF that is not allow-listed', async () => {
    const problems = await audit(['photo-with-gps.jpg']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('photo-with-gps.jpg');
    expect(problems[0]).toContain('GPS EXIF');
  });

  it('refuses a camera original whose EXIF it cannot read', async () => {
    const problems = await audit(['camera-original.heic']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('cannot read EXIF from');
  });

  it('clears an image whose exact bytes are allow-listed', async () => {
    const allowlist: Allowlist = {
      images: [{ path: 'allow-listed.jpg', sha256: sha256OfBytes(gpsJpeg), note: 'reviewed' }],
      coordinateFiles: [],
    };
    expect(await audit(['allow-listed.jpg'], allowlist)).toEqual([]);
  });

  it('refuses an allow-listed image after one byte changes', async () => {
    // One pixel byte, well past the EXIF block, so the GPS is still readable and
    // the only thing that has changed is the hash the review was recorded for.
    const tampered = Uint8Array.from(gpsJpeg);
    const index = tampered.length - 8;
    const before = tampered[index];
    expect(before).toBeTypeOf('number');
    tampered[index] = (before ?? 0) ^ 0xff;
    await writeFile(join(root, 'tampered.jpg'), tampered);

    const allowlist: Allowlist = {
      images: [{ path: 'tampered.jpg', sha256: sha256OfBytes(gpsJpeg), note: 'reviewed' }],
      coordinateFiles: [],
    };
    const problems = await audit(['tampered.jpg'], allowlist);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('tampered.jpg');
  });

  it('passes a sensor fixture holding orientation and relative timestamps only', async () => {
    expect(await audit(['fixtures/sensors/clean.json'])).toEqual([]);
  });

  it('refuses the same fixture once it carries a coords object', async () => {
    const problems = await audit(['fixtures/sensors/with-coords.json']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('with-coords.json');
    expect(problems[0]).toContain('coords');
  });

  it('refuses the latitude/longitude/accuracy key set of a position fix', async () => {
    const problems = await audit(['fixtures/sensors/fix-keys.json']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('position fix');
  });

  /**
   * The line numbers come from the fixture's own layout, not from a run.
   * `JSON.stringify(…, null, 2)` puts `{` on line 1 and then one key per line,
   * in insertion order, so `latitude` is line 2, `longitude` line 3 and
   * `accuracy` line 4.
   */
  it('names each fix key and its line, and says prose counts', async () => {
    const problems = await audit(['fixtures/sensors/fix-keys.json']);
    const message = problems[0] ?? '';
    expect(message).toContain('"latitude": at line 2');
    expect(message).toContain('"longitude": at line 3');
    expect(message).toContain('"accuracy": at line 4');
    expect(message).toContain('prose and comments count too');
  });

  it('refuses the same key set written as prose, and names those lines', async () => {
    const problems = await audit(['fixtures/notes/fix-in-prose.txt']);
    expect(problems).toHaveLength(1);
    const message = problems[0] ?? '';
    expect(message).toContain('latitude: at line 2');
    expect(message).toContain('longitude: at line 2');
    expect(message).toContain('accuracy: at line 3');
  });

  it('refuses coordinates sitting beside wall-clock timestamps', async () => {
    const problems = await audit(['fixtures/sensors/epoch-coords.json']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('wall clock');
  });

  it('passes public coordinates with no capture shape', async () => {
    expect(await audit(['fixtures/public-peaks.json'])).toEqual([]);
  });

  it('refuses coordinates in a capture-shaped file name', async () => {
    // Identical content to the peak database above, which passes. Only the name
    // differs, so the path rule is the only thing that can convict it.
    const problems = await audit(['fixtures/sensors/capture-01.json']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('capture-shaped path');
  });

  it('refuses any file under captures/ or bundles/, whatever is in it', async () => {
    const problems = await audit(['fixtures/captures/session.json', 'fixtures/bundles/readme.txt']);
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toContain('captures/');
    expect(problems.join('\n')).toContain('bundles/');
  });

  it('walks the tree when there is no git repository to ask', async () => {
    const { paths, source } = await discoverFiles(root);
    expect(source).toBe('walk');
    expect(paths).toContain('fixtures/sensors/clean.json');
    expect(paths).toContain('fixtures/bundles/readme.txt');
  });

  it('records path and sha256 when a human approves a file', async () => {
    const allowlistPath = join(root, 'allowlist.json');
    await approve(root, allowlistPath, ['fixtures/sensors/with-coords.json'], 'reviewed by hand');
    const allowlist = await loadAllowlist(allowlistPath);
    expect(allowlist.coordinateFiles).toEqual([
      {
        path: 'fixtures/sensors/with-coords.json',
        sha256: sha256OfBytes(SENSOR_FIXTURE_WITH_COORDS),
        note: 'reviewed by hand',
      },
    ]);
    expect(await audit(['fixtures/sensors/with-coords.json'], allowlist)).toEqual([]);
  });
});

describe('--approve under CI', () => {
  it('refuses to record a review when CI is set', () => {
    expect(() => assertApprovalAllowed({ CI: 'true' })).toThrow(/refuses to run under CI/);
  });

  it('allows it on a developer machine', () => {
    expect(() => assertApprovalAllowed({})).not.toThrow();
    expect(() => assertApprovalAllowed({ CI: '' })).not.toThrow();
  });
});

describe('the committed tree', () => {
  /**
   * Rule 2 over the real tree, which is where a false positive would show up.
   *
   * Images are left to `npm run check:privacy`, the first step of `npm run
   * check`. Hashing 45 MB of HEIC here as well would add seconds to every test
   * run and prove nothing that step does not already prove.
   */
  it('has no unreviewed coordinate file', async () => {
    const { paths, source } = await discoverFiles(REPO_ROOT);
    expect(source).toBe('git');
    const text = paths.filter((path) => hasExtension(path, TEXT_EXTENSIONS));
    expect(text.length).toBeGreaterThan(100);
    const allowlist = await loadAllowlist(join(REPO_ROOT, 'scripts/privacy-allowlist.json'));
    const { problems } = await auditFiles(REPO_ROOT, text, allowlist);
    expect(problems).toEqual([]);
  }, 30_000);
});
