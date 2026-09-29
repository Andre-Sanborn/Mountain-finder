/**
 * ACCEPTANCE — REGRESSION LOCK ON THE ONE REAL-PHOTO CV ALIGNMENT RESULT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This file pins numbers that were measured once, on one photograph. Read the
 * next four paragraphs before reading a green run as evidence of anything.
 *
 * **n = 1.** Three frames from one position, one minute apart, at three focal
 * lengths. One of them (48 mm-equivalent) produces a pose suggestion; the other
 * two are declined. That is the whole sample.
 *
 * **The truth is an eyeball apex pick.** The pose this file grades against —
 * heading 174.686°, pitch −3.520° — was solved from Castle Peak's apex read off
 * the full-resolution image at x ≈ 2178, y ≈ 973 px by an agent looking at a
 * magnified crop with a labelled 50 px grid (docs/REAL-PHOTO-POSE.md). It is a
 * judgement, not an instrument reading. It is used anyway because it is the one
 * measurement here that neither the phone's magnetometer nor the aligner can
 * have influenced — but an error of a few tenths of a degree in it would move
 * every figure below by the same amount.
 *
 * **The CV constants were tuned on these frames.** The compass budget, the comb
 * step and half-width in `src/pipeline/cv-alignment.ts`, and the sky-roughness
 * thresholds in `src/cv/skyline.ts` were all chosen against this photograph
 * (docs/CV-REAL-PHOTO-FINDING.md, CV-2 and CV-10). So the errors asserted here
 * are in-sample. They say the code still does what it did; they do not say what
 * it would do on a photograph nobody tuned it on.
 *
 * **So this is a regression lock, not a capability claim.** It fails when a
 * change moves the recovered pose. It is not evidence that the aligner recovers
 * poses, and no product claim may cite it as such. The aligner stays out of the
 * live path for exactly this reason.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE TERRAIN WINDOW
 * ───────────────────────────────────────────────────────────────────────────
 * The answer depends on how far the profile reaches. Measured on the full
 * (gitignored) N44W115 tile, sweeping 0.25° × 90 m from 150 m out:
 *
 *     max range   heading error   pitch error   suggestion
 *      7.5 km      —               —            DECLINED (no interior optimum)
 *      8–10 km     −0.634…−0.660°  +0.544…+0.549°
 *     11 km        −0.102°         +0.667°
 *     12–25 km     −0.115°         +0.689°      (identical at every range)
 *     30 km        −0.109°         +0.691°
 *
 * Castle Peak stands at 11.07 km, and it is the feature that anchors the match.
 * The `railroad-ridge` window committed for the photo cases stops at 7.5 km, so
 * on that window the aligner declines — locking that decline would lock an
 * artefact of the window's size, not the aligner's behaviour.
 *
 * So this file uses its own window, `railroad-ridge-cv`: the southern sector
 * only (bearings 140–210°, which is the 41.11° frame plus the ±6° compass
 * budget, with margin) out to 12.5 km, where the answer has converged. A sector
 * is enough because `suggestPoseTrim` reads no profile point outside the span it
 * searches — checked, not assumed: the sector profile and a full 360° profile
 * cut from the same tile return bit-identical trims.
 *
 * The 12.5 km window reproduces the figure recorded in
 * docs/CV-REAL-PHOTO-FINDING.md (heading −0.109°, pitch +0.690°, measured on a
 * 30 km profile) to 0.006° of heading and 0.002° of pitch. It costs 579 KiB of
 * committed bytes, which is less than the 7.5 km disc window it sits beside,
 * because a sector out to 12.5 km is smaller than a disc out to 7.5 km. A 30 km
 * window is not an option: it would cross into a second SRTM tile, and the
 * window cutter takes one.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHERE EVERY INPUT COMES FROM
 * ───────────────────────────────────────────────────────────────────────────
 *   pixels    `fixtures/photos/real/tundra-blue-sky.jpeg` (48 mm), and the two
 *             camera originals for the 24 mm and 14 mm frames.
 *   pose      the camera originals' own EXIF, read here, never typed in.
 *   terrain   `fixtures/tiles/cases/railroad-ridge-cv-window.i16be`, real SRTM1
 *             bytes. Asserted to be the committed cut, so a developer holding
 *             the 25 MB tile in data/tiles/ still tests the same terrain.
 *   truth     docs/REAL-PHOTO-POSE.md, the apex pick described above.
 */

import { readFile } from 'node:fs/promises';

import { decode as decodeJpeg } from 'jpeg-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildHorizonProfile } from '../../src/core/horizon';
import type { CameraPose, HorizonProfile } from '../../src/core/types';
import type { RgbaImage } from '../../src/cv/types';
import { cameraPoseFromPhotoExif, extractPhotoExif } from '../../src/exif';
import { isHeif } from '../../src/exif/heif';
import { suggestPoseTrim, type PoseTrimSuggestion } from '../../src/pipeline/cv-alignment';
import { buildTerrainRays, resolveSweep } from '../../src/pipeline/terrain';
import { loadCaseTerrain, caseTerrainSpec } from '../../src/pipeline/testing/case-terrain';

/* ══════════════════════════════════════════════════════════════════════════
 * The pose this file grades against, and the tolerances
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * The photogrammetrically solved pose — an eyeball apex pick, see the header.
 * docs/REAL-PHOTO-POSE.md § "the pose, solved from the picture itself".
 */
const SOLVED_POSE = { headingDeg: 174.686, pitchDeg: -3.52 } as const;

/** The phone's own compass error at this viewpoint, for scale: 174.089 vs 174.686. */
const COMPASS_ERROR_DEG = 0.596;

/**
 * Measured heading error on the committed window: −0.1148°. The gate is 0.25°.
 *
 * The margin is 0.135°, which is a little over one step of the heading search
 * (`headingStepDeg: 0.1` in `suggestPoseTrim`'s comb). That is the quantum the
 * recovered optimum can move by when a change reorders neighbouring correlation
 * scores, so one step of drift stays green and two fails. 0.25° is also well
 * inside {@link COMPASS_ERROR_DEG}, so a regression that degrades the aligner to
 * magnetometer quality fails this test rather than passing it.
 */
const HEADING_TOLERANCE_DEG = 0.25;

/**
 * Measured pitch error on the committed window: +0.6892°. The gate is 0.85°.
 *
 * The margin is 0.161°, about 1.5 steps of the pitch scan (`pitchStepDeg`
 * defaults to 0.1°). It stays below the two pitch regressions this repository
 * has already measured, so either returning fails the test: +1.13° when the
 * near-field DEM artefact is left in the profile (CV-9/CV-10), and +3.52° when
 * pitch is assumed to be zero.
 */
const PITCH_TOLERANCE_DEG = 0.85;

/** A standing photographer. Nothing in EXIF knows this; it is stated, not defaulted. */
const EYE_HEIGHT_M = 1.6;

/* ══════════════════════════════════════════════════════════════════════════
 * Loading the frames and the terrain
 * ══════════════════════════════════════════════════════════════════════════ */

const PHOTO_DIR = 'fixtures/photos/real';
const TERRAIN_CASE_ID = 'railroad-ridge-cv';

interface Frame {
  readonly id: string;
  /** The file the pose is read from — always a camera original with EXIF intact. */
  readonly exifFile: string;
  /** The file the pixels are decoded from. */
  readonly pixelFile: string;
  readonly focalLength35mmMm: number;
}

const FRAMES: readonly Frame[] = [
  // The committed JPEG is a transcode of the 48 mm original with the GPS IFD
  // stripped: same 4032 × 3024 frame, mean |ΔRGB| 1.03/255 (REAL-PHOTO-POSE.md).
  // Its pixels are used because they are the ones every other run used; the
  // dimension check below is what keeps the pairing honest.
  { id: '48mm', exifFile: 'railroad-ridge-48mm.heic', pixelFile: 'tundra-blue-sky.jpeg', focalLength35mmMm: 48 },
  { id: '24mm', exifFile: 'railroad-ridge-24mm.heic', pixelFile: 'railroad-ridge-24mm.heic', focalLength35mmMm: 24 },
  { id: '14mm', exifFile: 'railroad-ridge-14mm.heic', pixelFile: 'railroad-ridge-14mm.heic', focalLength35mmMm: 14 },
];

async function decodePhoto(path: string): Promise<RgbaImage> {
  const bytes = await readFile(path);
  if (!isHeif(new Uint8Array(bytes))) {
    const decoded = decodeJpeg(bytes, { useTArray: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  const { default: decodeHeic } = await import('heic-decode');
  const image = await decodeHeic({ buffer: bytes as unknown as ArrayBufferView & Uint8Array });
  return { width: image.width, height: image.height, data: new Uint8Array(image.data) };
}

interface RunResult {
  readonly camera: CameraPose;
  readonly image: RgbaImage;
  readonly exifWidthPx: number | undefined;
  readonly exifHeightPx: number | undefined;
  readonly suggestion: PoseTrimSuggestion;
  readonly groundElevationM: number;
  readonly horizon: HorizonProfile;
  readonly raysRequested: number;
  readonly raysWithTerrain: number;
  readonly samplesRequested: number;
  readonly samplesWithElevation: number;
  readonly terrainGaps: readonly string[];
}

const runs = new Map<string, RunResult>();
let terrainOrigin = '';
let terrainProvenance = '';
const reportLines: string[] = [];

beforeAll(async () => {
  const spec = caseTerrainSpec(TERRAIN_CASE_ID);
  if (spec === undefined) throw new Error(`no terrain window registered for ${TERRAIN_CASE_ID}`);

  // `preferFullTiles` is left at its default: the committed cut answers, even on
  // a machine that has the 25 MB tile. Asserted below, not trusted.
  const terrain = await loadCaseTerrain(TERRAIN_CASE_ID);
  terrainOrigin = terrain.origin;
  terrainProvenance = terrain.provenance;

  // `minRangeM` in the sweep is the same profile the pipeline hands the aligner
  // as `alignmentHorizon`: `sweepRangesM` keeps the grid on multiples of
  // `rangeStepM` and skips the near ones, which is exactly what annotate.ts's
  // near-field filter does to an already-swept ray.
  const sweep = resolveSweep(spec.sweep);

  for (const frame of FRAMES) {
    const exif = await extractPhotoExif(
      new Uint8Array(await readFile(`${PHOTO_DIR}/${frame.exifFile}`)),
    );
    const camera = cameraPoseFromPhotoExif(exif);
    const image = await decodePhoto(`${PHOTO_DIR}/${frame.pixelFile}`);
    const { lat, lon } = exif;
    if (lat === undefined || lon === undefined) {
      throw new Error(`${frame.exifFile} carries no GPS position`);
    }

    const { rays, report } = await buildTerrainRays(terrain.elevation, { lat, lon }, sweep);
    const [reading] = await terrain.elevation.fetchElevations([{ lat, lon }]);
    if (reading === undefined || reading.elevationM === null) {
      throw new Error(`the committed window reads no elevation at ${lat}, ${lon}`);
    }
    const horizon = buildHorizonProfile(reading.elevationM + EYE_HEIGHT_M, rays);

    runs.set(frame.id, {
      camera,
      image,
      exifWidthPx: exif.imageWidthPx,
      exifHeightPx: exif.imageHeightPx,
      suggestion: suggestPoseTrim({ image, scene: { camera, horizon } }),
      groundElevationM: reading.elevationM,
      horizon,
      raysRequested: report.raysRequested,
      raysWithTerrain: report.raysWithTerrain,
      samplesRequested: report.samplesRequested,
      samplesWithElevation: report.samplesWithElevation,
      terrainGaps: report.gaps,
    });
  }
}, 120_000);

function run(id: string): RunResult {
  const result = runs.get(id);
  if (result === undefined) throw new Error(`frame ${id} was not run`);
  return result;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The inputs are the inputs
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the inputs the lock rests on', () => {
  it('reads terrain from the committed window, not from a 25 MB tile on disk', () => {
    expect(terrainOrigin).toBe('committed-window');
    expect(terrainProvenance).toContain('N44W115');
  });

  it('covers the whole swept sector with no data gaps', () => {
    // A window cut too small loses rays at its edge, and a profile with holes in
    // it would move the recovered pose without any test noticing. The sweep's own
    // report is what separates "the window is big enough" from "it happened to
    // answer for the bearings that mattered".
    for (const frame of FRAMES) {
      const result = run(frame.id);
      expect(result.raysWithTerrain, `${frame.id}: rays with terrain`).toBe(result.raysRequested);
      expect(result.samplesWithElevation, `${frame.id}: samples with elevation`).toBe(
        result.samplesRequested,
      );
      expect(result.terrainGaps, `${frame.id}: terrain gaps`).toEqual([]);
    }
  });

  it('takes each pose from the camera original, at the lens that original names', () => {
    for (const frame of FRAMES) {
      const result = run(frame.id);
      // The pixels and the metadata must be the same picture. Equal dimensions
      // do not prove it, but unequal dimensions disprove it — the cheapest
      // available guard against grading one frame's pose on another's pixels.
      expect(result.exifWidthPx, `${frame.id}: EXIF width`).toBe(result.image.width);
      expect(result.exifHeightPx, `${frame.id}: EXIF height`).toBe(result.image.height);
    }

    // The 48 mm frame's field of view is the number CV-5 turned on: assuming
    // 26 mm-equivalent (69.4°) instead of 41.11° is a 1.69× scale error that no
    // heading search can absorb. It is asserted here so a change to the
    // focal-length-to-FOV rule cannot move this lock silently.
    const fortyEight = run('48mm');
    expect(fortyEight.camera.headingDeg).toBeCloseTo(174.089, 3);
    expect(fortyEight.camera.hFovDeg).toBeCloseTo(41.112, 3);
    expect(fortyEight.camera.pitchDeg).toBe(0);
    expect(fortyEight.camera.rollDeg).toBe(0);
  });

  it('reads the viewpoint 3168 m above sea level, as the DEM does', () => {
    // Fixture integrity, not an independent check: it is the same radar data.
    // A window cut from the wrong offsets reads a different number here.
    expect(run('48mm').groundElevationM).toBeCloseTo(3168.27, 1);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * The lock
 * ══════════════════════════════════════════════════════════════════════════ */

describe('suggestPoseTrim on the 48 mm Railroad Ridge frame', () => {
  it('suggests a trim rather than declining', () => {
    const { suggestion } = run('48mm');
    if (suggestion.status === 'declined') {
      throw new Error(`declined (${suggestion.reason}): ${suggestion.detail}`);
    }
    expect(suggestion.status).toBe('suggested');
    expect(suggestion.compassBudgetDeg).toBe(6);
    // One interior optimum in the budget. More than one would mean the terrain
    // shape supports several compass-consistent headings, and the suggestion
    // would be one of them rather than the answer.
    expect(suggestion.otherCandidateHeadingsDeg).toEqual([]);
  });

  it('recovers the heading to within a quarter of a degree of the solved pose', () => {
    const { camera, suggestion } = run('48mm');
    if (suggestion.status !== 'suggested') return;
    const recoveredDeg = camera.headingDeg + suggestion.headingTrimDeg;
    const errorDeg = recoveredDeg - SOLVED_POSE.headingDeg;
    report(
      `48 mm heading: EXIF ${camera.headingDeg.toFixed(3)}° + trim ` +
        `${suggestion.headingTrimDeg.toFixed(4)}° = ${recoveredDeg.toFixed(4)}°, ` +
        `error ${errorDeg.toFixed(4)}° against the solved ${SOLVED_POSE.headingDeg}°`,
    );
    expect(Math.abs(errorDeg)).toBeLessThanOrEqual(HEADING_TOLERANCE_DEG);
    // And it beats the phone's own compass, which is the only comparison in
    // this file that is not against a judgement call.
    expect(Math.abs(errorDeg)).toBeLessThan(COMPASS_ERROR_DEG);
  });

  it('recovers the pitch EXIF never records to within 0.85°', () => {
    const { camera, suggestion } = run('48mm');
    if (suggestion.status !== 'suggested') return;
    const recoveredDeg = camera.pitchDeg + suggestion.pitchTrimDeg;
    const errorDeg = recoveredDeg - SOLVED_POSE.pitchDeg;
    report(
      `48 mm pitch:   assumed ${camera.pitchDeg}° + trim ` +
        `${suggestion.pitchTrimDeg.toFixed(4)}° = ${recoveredDeg.toFixed(4)}°, ` +
        `error ${errorDeg.toFixed(4)}° against the solved ${SOLVED_POSE.pitchDeg}°`,
    );
    expect(Math.abs(errorDeg)).toBeLessThanOrEqual(PITCH_TOLERANCE_DEG);
    // The camera was pointed DOWN, which is why the frame is full of tundra. A
    // recovered pitch on the wrong side of zero is a sign error, not a drift.
    expect(recoveredDeg).toBeLessThan(0);
  });

  it('says low-confidence while being right, and names its concerns', () => {
    const { suggestion } = run('48mm');
    if (suggestion.status !== 'suggested') return;
    const { alignment } = suggestion;
    // Not 'aligned'. The correlation score, the residual and the flatness of
    // this profile are all genuinely marginal, and the recovered pose being
    // good does not make the evidence for it strong. A change that promoted
    // this to 'aligned' would be an over-claim, so it fails here.
    expect(alignment.status).toBe('low-confidence');
    expect(alignment.concerns.length).toBeGreaterThan(0);
    report(
      `48 mm verdict: ${alignment.status}, concerns ${alignment.concerns.join(', ')}; ` +
        `score ${alignment.diagnostics.score.toFixed(4)}, ` +
        `margin ${alignment.diagnostics.margin.toFixed(4)}, ` +
        `residual ${alignment.diagnostics.residualRmsDeg.toFixed(4)}°, ` +
        `used ${(alignment.diagnostics.usedFraction01 * 100).toFixed(1)} % of columns`,
    );
  });

  it('reads the photograph at better than 98 % coverage', () => {
    const { suggestion } = run('48mm');
    if (suggestion.status !== 'suggested') return;
    // The extraction is the other half of the result. A drop here would change
    // the recovered pose, and it is worth failing on its own so the diagnosis
    // does not have to start at the correlator.
    expect(suggestion.skyline.coverage01).toBeGreaterThan(0.98);
  });
});

describe('the wide frames from the same position, one minute apart', () => {
  // Both decline, and that is the recorded behaviour, not a target. CV-2 and
  // CV-8 are open: hazy distant crests in a wide frame now report nothing
  // rather than a confident wrong row, which leaves too few columns to anchor
  // an interior optimum. Saying so beats inventing one.
  for (const id of ['24mm', '14mm'] as const) {
    it(`declines the ${id} frame`, () => {
      const { suggestion } = run(id);
      expect(suggestion.status).toBe('declined');
      if (suggestion.status !== 'declined') return;
      // The reason is asserted; the detail string is reported, not pinned. Which
      // comb window fails first, and therefore which input diagnosis is quoted,
      // is not a property worth freezing.
      expect(suggestion.reason).toBe('no-alignment');
      report(
        `${id} declined (${suggestion.reason}), coverage ` +
          `${((suggestion.skyline?.coverage01 ?? 0) * 100).toFixed(1)} %: ${suggestion.detail}`,
      );
    });
  }
});

function report(line: string): void {
  reportLines.push(line);
}

afterAll(() => {
  process.stdout.write(
    [
      '',
      '──────────────────────────────────────────────────────────────────────',
      ' CV ALIGNMENT REGRESSION LOCK — WHAT JUST RAN',
      '──────────────────────────────────────────────────────────────────────',
      ` terrain: ${terrainProvenance}`,
      ` gates:   |heading error| ≤ ${HEADING_TOLERANCE_DEG}°, |pitch error| ≤ ${PITCH_TOLERANCE_DEG}°`,
      '',
      ...(reportLines.length === 0 ? ['   (nothing measured)'] : reportLines.map((l) => ` ${l}`)),
      '',
      ' n = 1. The truth is an eyeball apex pick (docs/REAL-PHOTO-POSE.md), and',
      ' the CV constants were tuned on these three frames. Green means the',
      ' aligner still does what it did, and nothing more than that.',
      '──────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
});
