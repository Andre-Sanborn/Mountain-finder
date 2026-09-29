/**
 * `npm run annotate -- <photo>` — annotate a REAL photograph, from its own EXIF.
 *
 *   npm run annotate -- fixtures/photos/real/tundra-blue-sky.jpeg \
 *     --exif fixtures/photos/real/railroad-ridge-48mm.heic \
 *     --peaks idaho-central --out out/railroad-ridge.png
 *
 * ── HOW THIS DIFFERS FROM `npm run demo` ───────────────────────────────────
 * `demo` runs a ground-truth VIEWPOINT and composites onto a synthetic terrain
 * silhouette, because those cases cite photographs on Wikimedia Commons that
 * this repository deliberately does not vendor. Its header explains at length
 * why the horizon line lying on that backdrop is tautological.
 *
 * This script has a photograph. Nothing here is tautological and nothing here
 * is synthetic: the backdrop is the picture that was taken, and every drawn
 * thing is computed from SRTM and a peak database that have never seen it. If
 * a label lands on the wrong bump, the image says so.
 *
 * ── WHERE THE POSE COMES FROM ──────────────────────────────────────────────
 * EXIF, and nothing else, unless a flag overrides it — position, heading and
 * lens. `--exif` exists because a transcoded JPEG usually has none: a phone
 * share sheet keeps orientation and pixel dimensions and drops the whole GPS
 * IFD, so the pixels and the metadata often arrive in two different files. The
 * script decodes one and reads the other, and REFUSES if the two disagree about
 * the frame — different dimensions mean it is not the same photograph, and
 * annotating a picture with another one's heading is worse than not annotating.
 *
 * Anything EXIF does not carry is a required flag rather than a default. There
 * is no fallback heading, no assumed focal length, and in particular no assumed
 * 26 mm-equivalent: that assumption, made silently by earlier alignment work
 * against a stripped JPEG, is what a 1.69x error in image scale looked like
 * before anybody noticed (see docs/FINDINGS.md CV-5).
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 * It draws `scene.labelled` — the pipeline's own answer to which summits may be
 * named — so it cannot show a peak the acceptance gates would refuse. Summits
 * beyond the swept range reach `scene.unmeasured` and are printed, not drawn.
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { decode as decodeJpeg } from 'jpeg-js';

import { isHeif } from '../src/exif/heif.js';

import { interpolateHorizonAltitudeDeg, nearFieldHorizons } from '../src/core/horizon.js';
import type { CameraPose } from '../src/core/types.js';
import { extractPhotoExif } from '../src/exif/extract.js';
import { cameraPoseFromPhotoExif } from '../src/exif/photo-pose.js';
import type { PhotoExif } from '../src/exif/types.js';
import { annotateScene } from '../src/pipeline/annotate.js';
import type { AnnotatedScene, PeakSource } from '../src/pipeline/types.js';
import { loadPeakCellIndex } from '../src/providers/peak-directory.js';
import { suggestPoseTrim } from '../src/pipeline/cv-alignment.js';
import { DirectoryTileStore } from '../src/providers/tile-directory.js';
import { TileElevationProvider } from '../src/providers/tile-elevation.js';
import { buildOverlaySvgFromLayout, layoutOverlay } from '../src/render/index.js';
import type { OverlayScene } from '../src/render/types.js';
import { rasteriseToPng, RasteriseUnavailableError } from './rasterise.js';

const FULL_TILE_DIR = 'data/tiles';
const DEFAULT_OUT = 'out/annotated-photo.png';

interface Options {
  readonly photoPath: string | undefined;
  readonly exifPath: string | undefined;
  readonly peaksRegion: string;
  readonly outPath: string;
  readonly headingDeg: number | undefined;
  readonly pitchDeg: number | undefined;
  readonly rollDeg: number | undefined;
  readonly rangeKm: number;
  readonly rangeStepM: number;
  readonly minRangeM: number;
  readonly nearFieldRadiusM: number;
  readonly bearingStepDeg: number;
  readonly queryRadiusKm: number;
  readonly autoTrim: boolean;
  readonly writePng: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let photoPath: string | undefined;
  let exifPath: string | undefined;
  let peaksRegion = 'idaho-central';
  let outPath = DEFAULT_OUT;
  let headingDeg: number | undefined;
  let pitchDeg: number | undefined;
  let rollDeg: number | undefined;
  let rangeKm = 30;
  let rangeStepM = 90;
  let minRangeM = 0;
  let nearFieldRadiusM = 150;
  let bearingStepDeg = 0.25;
  let queryRadiusKm = 30;
  let autoTrim = false;
  let writePng = true;

  const value = (index: number, flag: string): string => {
    const raw = argv[index];
    if (raw === undefined || raw.startsWith('--')) throw new Error(`${flag} needs a value`);
    return raw;
  };
  const number = (index: number, flag: string): number => {
    const parsed = Number(value(index, flag));
    if (!Number.isFinite(parsed)) throw new Error(`${flag} needs a number`);
    return parsed;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) continue;
    switch (arg) {
      case '--exif': exifPath = value(index + 1, arg); index += 1; break;
      case '--peaks': peaksRegion = value(index + 1, arg); index += 1; break;
      case '--out': outPath = value(index + 1, arg); index += 1; break;
      case '--heading': headingDeg = number(index + 1, arg); index += 1; break;
      case '--pitch': pitchDeg = number(index + 1, arg); index += 1; break;
      case '--roll': rollDeg = number(index + 1, arg); index += 1; break;
      case '--range-km': rangeKm = number(index + 1, arg); index += 1; break;
      case '--range-step-m': rangeStepM = number(index + 1, arg); index += 1; break;
      case '--min-range-m': minRangeM = number(index + 1, arg); index += 1; break;
      case '--near-field-m': nearFieldRadiusM = number(index + 1, arg); index += 1; break;
      case '--bearing-step': bearingStepDeg = number(index + 1, arg); index += 1; break;
      case '--radius-km': queryRadiusKm = number(index + 1, arg); index += 1; break;
      case '--auto-trim': autoTrim = true; break;
      case '--no-png': writePng = false; break;
      default:
        if (arg.startsWith('--')) throw new Error(`Unknown flag ${arg}`);
        photoPath ??= arg;
    }
  }

  return {
    photoPath, exifPath, peaksRegion, outPath, headingDeg, pitchDeg, rollDeg,
    rangeKm, rangeStepM, minRangeM, nearFieldRadiusM, bearingStepDeg, queryRadiusKm, autoTrim,
    writePng,
  };
}

const out: string[] = [];
function line(text = ''): void {
  out.push(text);
}
function deg(value: number): string {
  return value.toFixed(3);
}

function usage(): void {
  line('usage: npm run annotate -- <photo.jpg> [options]');
  line();
  line('  --exif PATH        read the pose from a different file (the camera');
  line('                     original, when the photo itself was stripped)');
  line('  --peaks REGION     imported region under fixtures/peaks/regions/');
  line('  --out PATH         where to write the PNG (default out/annotated-photo.png)');
  line('  --heading DEG      override the EXIF heading');
  line('  --pitch DEG        camera pitch, degrees above horizontal (default 0)');
  line('  --roll DEG         camera roll about the optical axis (default 0)');
  line('  --radius-km N      peak query radius (default 30)');
  line('  --range-km N  --range-step-m N  --bearing-step N   terrain sweep');
  line('  --min-range-m N    do not sample terrain closer than this (default 0).');
  line('                     A DEM cannot resolve the ground beside you; using it');
  line('                     builds a wall in front of the camera. See the');
  line('                     NEAR FIELD line in the report and docs/NEAR-FIELD.md.');
  line('  --near-field-m N   radius treated as unresolvable (default 150): drives the');
  line('                     NEAR FIELD report AND the marginal verdicts — a peak whose');
  line('                     clearance is inside the near ground\'s own noise band is');
  line('                     labelled "may be hidden" instead of being decided (P1.6)');
  line('  --no-png           text report only');
  line();
  line('The pose comes from EXIF. There are no defaults for position, heading or');
  line('focal length: a photograph that does not state them cannot be annotated,');
  line('and guessing any of the three silently is how you get a confident wrong');
  line('answer (docs/FINDINGS.md CV-5).');
}

/**
 * The pose, from EXIF, with every missing piece named rather than defaulted.
 *
 * A `--heading` override is allowed because a magnetometer reading can be
 * refined; a focal length override is NOT, because a photograph's field of view
 * is a fact about the file and a flag that changed it would let the operator
 * tune the geometry until the labels look right.
 */
function poseFrom(exif: PhotoExif, options: Options, sourceLabel: string): CameraPose {
  const missing: string[] = [];
  if (exif.lat === undefined || exif.lon === undefined) missing.push('GPS position');
  const heading = options.headingDeg ?? exif.imgDirectionDeg;
  if (heading === undefined) missing.push('GPSImgDirection (or --heading)');
  if (exif.focalLength35mmMm === undefined) missing.push('FocalLengthIn35mmFormat');
  if (exif.imageWidthPx === undefined || exif.imageHeightPx === undefined) {
    missing.push('pixel dimensions');
  }
  if (missing.length > 0) {
    throw new Error(
      `${sourceLabel} does not carry: ${missing.join(', ')}.\n` +
        '  A phone share sheet drops the whole GPS IFD while keeping orientation and\n' +
        '  dimensions, so the pose usually survives only in the camera original.\n' +
        '  Pass it with --exif, e.g.\n' +
        '    npm run annotate -- <photo> --exif <original.heic>',
    );
  }
  if (exif.imgDirectionRef === 'M') {
    line('  WARNING: GPSImgDirectionRef is "M" — this heading is MAGNETIC and no');
    line('           declination correction has been applied. Every bearing below is');
    line('           wrong by the local declination until one is.');
  }

  // `cameraPoseFromPhotoExif` prefers the fields of view the extractor already
  // derived, and gives the 36 mm-gate angle to the frame's longer displayed
  // axis — so a portrait photograph gets it on its height.
  return cameraPoseFromPhotoExif(exif, {
    ...(heading === undefined ? {} : { headingDeg: heading }),
    ...(options.pitchDeg === undefined ? {} : { pitchDeg: options.pitchDeg }),
    ...(options.rollDeg === undefined ? {} : { rollDeg: options.rollDeg }),
  });
}

async function peakSourceFor(region: string, radiusKm: number): Promise<PeakSource> {
  const indexPath = `fixtures/peaks/regions/${region}/index.json`;
  try {
    const store = await loadPeakCellIndex(indexPath);
    return {
      async peaksWithin(center, queryRadiusKm) {
        return store.peaksWithin(center, Math.min(queryRadiusKm, radiusKm));
      },
    };
  } catch {
    throw new Error(
      `No imported peak region "${region}" at ${indexPath}.\n` +
        `  Import it: npm run fetch:peaks -- --region ${region}`,
    );
  }
}

/** Decoded pixels, from a JPEG or straight from a HEIC. */
interface DecodedPhoto {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array | Uint8ClampedArray;
  /** True when the bytes had to be re-encoded to reach the compositor. */
  readonly wasHeif: boolean;
}

/**
 * Decode the photograph.
 *
 * HEIC is decoded through `heic-decode` (libheif compiled to wasm), imported
 * lazily so the absence of a decoder is a sentence rather than a stack trace,
 * and so nothing pays for it on the JPEG path. It is a devDependency and a
 * SCRIPT-ONLY one: nothing under src/ imports it, and reading a HEIC's METADATA
 * needs no decoder at all — src/exif/heif.ts does that from the bytes.
 */
async function decodePhoto(bytes: Buffer, path: string): Promise<DecodedPhoto> {
  if (!isHeif(new Uint8Array(bytes))) {
    const decoded = decodeJpeg(bytes, { useTArray: true });
    return { width: decoded.width, height: decoded.height, data: decoded.data, wasHeif: false };
  }
  try {
    const { default: decodeHeic } = await import('heic-decode');
    const image = await decodeHeic({ buffer: bytes as unknown as ArrayBufferView & Uint8Array });
    return { width: image.width, height: image.height, data: image.data, wasHeif: true };
  } catch (cause) {
    throw new Error(
      `${path} is a HEIF file and could not be decoded: ` +
        `${cause instanceof Error ? cause.message : String(cause)}\n` +
        '  Install the decoder with:  npm install --save-dev heic-decode\n' +
        '  or convert the photograph to JPEG first. Note that its METADATA is\n' +
        '  readable either way — only the pixels need this.',
    );
  }
}

/** The photograph itself as the backdrop — its own bytes, as a data URL. */
async function photoDataUrl(path: string, decoded: DecodedPhoto): Promise<string> {
  if (!decoded.wasHeif) {
    const bytes = await readFile(path);
    const mime = path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  }
  // A browser cannot display HEIC, so the decoded pixels are re-encoded as a
  // JPEG for the backdrop. This is the ONLY lossy step in the run and it
  // touches the picture alone — every number came from the metadata and the
  // terrain, and none of them passes through here.
  const { encode: encodeJpeg } = await import('jpeg-js');
  const encoded = encodeJpeg(
    { data: Buffer.from(decoded.data), width: decoded.width, height: decoded.height },
    92,
  );
  return `data:image/jpeg;base64,${Buffer.from(encoded.data).toString('base64')}`;
}

function reportScene(scene: AnnotatedScene, limit = 40): void {
  line('SCENE');
  line(`  ${scene.labelled.length} labelled, ${scene.visible.length} visible, ` +
    `${scene.marginal.length} marginal, ${scene.occluded.length} occluded, ` +
    `${scene.unmeasured.length} unmeasured`);
  if (scene.nearFieldUncertainty !== undefined && scene.marginal.length > 0) {
    line(`  MARGINAL (occluder within ${scene.nearFieldUncertainty.radiusM} m, where the DEM's ` +
      `own cells disagree by ±${scene.nearFieldUncertainty.elevationBandM.toFixed(1)} m — ` +
      'clearance inside that noise, so neither verdict is claimed):');
    for (const peak of scene.marginal.slice(0, 10)) {
      line(`    ${peak.name.padEnd(24)} clearance ${peak.clearanceDeg >= 0 ? '+' : ''}` +
        `${peak.clearanceDeg.toFixed(3)} deg against a ±${peak.clearanceBandDeg.toFixed(3)} deg band` +
        ` (occluder at ${((peak.occluderDistanceKm ?? 0) * 1000).toFixed(0)} m)`);
    }
  }
  if (scene.unmeasured.length > 0) {
    line(`  UNMEASURED (beyond the swept range — no verdict, not "not visible"):`);
    for (const peak of scene.unmeasured.slice(0, 10)) {
      line(`    ${peak.name.padEnd(24)} ${peak.distanceKm.toFixed(1)} km, bearing ${deg(peak.bearingDeg)}`);
    }
  }
  line();
  line('LABELLED');
  for (const peak of scene.labelled.slice(0, limit)) {
    const skylineDeg = interpolateHorizonAltitudeDeg(scene.horizon, peak.bearingDeg);
    line(
      `  ${peak.name.padEnd(24)} ${peak.distanceKm.toFixed(2)} km  bearing ${deg(peak.bearingDeg)}  ` +
        `alt ${deg(peak.altitudeDeg)}  skyline ${deg(skylineDeg)}  ` +
        `${peak.visibility}${peak.visibility === 'visible' ? '' : ' (greyed)'}`,
    );
  }
  if (scene.labelled.length === 0) line('  (none in this frame)');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.photoPath === undefined) {
    usage();
    return;
  }

  // Pixels from the photo, metadata from wherever it survived.
  const photoBytes = await readFile(options.photoPath);
  const decoded = await decodePhoto(photoBytes, options.photoPath);
  const exifPath = options.exifPath ?? options.photoPath;
  const exif = await extractPhotoExif(new Uint8Array(await readFile(exifPath)));

  line('PHOTOGRAPH');
  line(`  pixels    ${options.photoPath} — ${decoded.width} x ${decoded.height}`);
  line(`  metadata  ${exifPath}`);

  // Two files, one photograph — or refuse. Different dimensions is the cheapest
  // available proof that the metadata belongs to a different picture, and
  // annotating with a stranger's heading is worse than annotating nothing.
  if (options.exifPath !== undefined) {
    if (exif.imageWidthPx !== decoded.width || exif.imageHeightPx !== decoded.height) {
      throw new Error(
        `--exif file is ${exif.imageWidthPx} x ${exif.imageHeightPx} but the photograph is ` +
          `${decoded.width} x ${decoded.height}. These are not the same picture.`,
      );
    }
    line(`            frames agree at ${decoded.width} x ${decoded.height} (necessary, not sufficient:`);
    line('            same shape does not prove same picture)');
  }

  const camera = poseFrom(exif, options, exifPath);
  const lat = exif.lat ?? 0;
  const lon = exif.lon ?? 0;
  line();
  line('POSE (from EXIF)');
  line(`  position  ${lat.toFixed(6)}, ${lon.toFixed(6)}` +
    `${exif.gpsAltitudeM === undefined ? '' : `  GPS altitude ${exif.gpsAltitudeM.toFixed(1)} m`}`);
  line(`  heading   ${deg(camera.headingDeg)} deg ${exif.imgDirectionRef ?? '(no ref tag)'}` +
    `${options.headingDeg === undefined ? '' : '  [--heading override]'}`);
  line(`  lens      ${exif.focalLength35mmMm} mm-eq -> hFOV ${deg(camera.hFovDeg)}, vFOV ${deg(camera.vFovDeg)}`);
  line(`  pitch     ${deg(camera.pitchDeg)} deg   roll ${deg(camera.rollDeg)} deg` +
    '   (EXIF carries neither; both default to 0)');
  const halfFov = camera.hFovDeg / 2;
  line(`  frame spans ${deg((camera.headingDeg - halfFov + 360) % 360)} .. ` +
    `${deg((camera.headingDeg + halfFov) % 360)} deg`);

  const elevation = new TileElevationProvider(new DirectoryTileStore(FULL_TILE_DIR));
  const peaks = await peakSourceFor(options.peaksRegion, options.queryRadiusKm);

  line();
  line('TERRAIN');
  line(`  ${FULL_TILE_DIR}, swept ${options.rangeKm} km at ${options.bearingStepDeg} deg / ${options.rangeStepM} m`);

  const buildScene = (pose: typeof camera): ReturnType<typeof annotateScene> =>
    annotateScene({
      // 1.6 m: a standing photographer. Stated, not defaulted silently —
      // `annotateScene` requires it and there is nothing in EXIF that knows it.
      observer: { lat, lon, eyeHeightM: 1.6 },
      camera: pose,
      elevation,
      peaks,
      config: {
        sweep: {
          bearingStepDeg: options.bearingStepDeg,
          rangeStepM: options.rangeStepM,
          minRangeM: options.minRangeM,
          maxRangeKm: options.rangeKm,
        },
        peakRadiusKm: options.queryRadiusKm,
        // P1.6: verdicts measured against an occluder inside this radius carry
        // the DEM's local disagreement as an uncertainty band, and a peak whose
        // verdict flips inside it is reported `marginal` rather than decided.
        nearFieldRadiusM: options.nearFieldRadiusM,
      },
    });

  let scene = await buildScene(camera);

  if (options.autoTrim) {
    line();
    line('AUTO-TRIM (P7.4 / CV-10)');
    if (scene.alignmentHorizon === undefined) {
      line('  unavailable: run with --near-field-m > 0 so the pipeline builds the');
      line('  near-field-free profile the aligner is allowed to match against.');
    } else {
      const suggestion = suggestPoseTrim({
        image: { width: decoded.width, height: decoded.height, data: decoded.data },
        scene: { camera, horizon: scene.alignmentHorizon },
      });
      if (suggestion.status === 'declined') {
        line(`  declined (${suggestion.reason}): ${suggestion.detail}`);
        line('  The pose below is the EXIF pose, un-trimmed.');
      } else {
        const { alignment } = suggestion;
        line(`  skyline match suggests heading ${suggestion.headingTrimDeg >= 0 ? '+' : ''}` +
          `${suggestion.headingTrimDeg.toFixed(3)} deg, pitch ` +
          `${suggestion.pitchTrimDeg >= 0 ? '+' : ''}${suggestion.pitchTrimDeg.toFixed(3)} deg ` +
          `(searched within the ±${suggestion.compassBudgetDeg} deg compass budget)`);
        line(`  ${alignment.status}${alignment.concerns.length === 0 ? '' : ` — concerns: ${alignment.concerns.join(', ')}`}`);
        line(`  score ${alignment.diagnostics.score.toFixed(3)}, margin ` +
          `${alignment.diagnostics.margin.toFixed(3)}, residual ` +
          `${alignment.diagnostics.residualRmsDeg.toFixed(3)} deg over ` +
          `${(alignment.diagnostics.usedFraction01 * 100).toFixed(0)}% of columns`);
        line('  Re-running the scene at the corrected pose. The trims are APPLIED and');
        line('  visible here — nothing is corrected silently.');
        scene = await buildScene(alignment.correctedCamera);
      }
    }
  }

  const near = nearFieldHorizons(scene.horizon, options.nearFieldRadiusM);
  if (near.bearings.length > 0) {
    line();
    line('  NEAR FIELD — READ THIS BEFORE TRUSTING THE HORIZON');
    line(`  ${near.bearings.length} of ${scene.horizon.length} bearings ` +
      `(${(near.fraction01 * 100).toFixed(0)}%) have their horizon within ` +
      `${near.radiusM} m of the camera, reaching ${near.maxAltitudeDeg.toFixed(3)} deg.`);
    line('  A DEM cannot resolve the ground that close: its posting is ~30 m, it');
    line('  smooths a ridge crest, and the camera position is uncertain by a');
    line('  comparable distance. Those bearings are the sampling grid talking, not');
    line('  terrain. Re-run with --min-range-m to exclude them and compare.');
  }
  line(`  observer ground ${scene.observer.groundElevationM.toFixed(1)} m, eye ` +
    `${(scene.observer.groundElevationM + scene.observer.eyeHeightM).toFixed(1)} m` +
    ` (${scene.observerResolution.groundElevationSource})`);
  line();
  reportScene(scene);

  if (!options.writePng) {
    line();
    line('  skipped (--no-png)');
    return;
  }

  const overlayScene: OverlayScene = {
    widthPx: decoded.width,
    heightPx: decoded.height,
    pose: scene.camera,
    horizon: scene.horizon,
    peaks: scene.labelled,
  };
  const layout = layoutOverlay(overlayScene);
  const overlaySvg = buildOverlaySvgFromLayout(layout);
  const backdropDataUrl = await photoDataUrl(options.photoPath, decoded);

  line();
  line('IMAGE');
  for (const marker of layout.markers) {
    line(`  ${marker.peak.name.padEnd(24)} at x=${marker.summitPx.xPx.toFixed(0)} ` +
      `y=${marker.summitPx.yPx.toFixed(0)} px` +
      `${marker.obscured ? ' (obscured: greyed)' : ''}` +
      `${marker.overlapped ? ' (OVERLAPPED)' : ''}`);
  }
  line(`  ${layout.markers.length} marker(s), ${layout.offFramePeaks.length} off-frame`);

  try {
    const png = await rasteriseToPng({
      backdropSvg: '', backdropDataUrl, overlaySvg,
      widthPx: decoded.width, heightPx: decoded.height,
    });
    await mkdir(dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, png);
    line();
    line(`  wrote ${options.outPath} — ${decoded.width}x${decoded.height}, ${png.length} bytes`);
    line('  The backdrop IS the photograph. Nothing drawn on it came from the picture:');
    line('  the horizon line is SRTM, the markers are the peak database and the EXIF');
    line('  pose. Where they land is the measurement.');
  } catch (error) {
    if (!(error instanceof RasteriseUnavailableError)) throw error;
    line();
    line(`  no image: ${error.message}`);
  }
}

main()
  .then(() => process.stdout.write(`${out.join('\n')}\n`))
  .catch((error: unknown) => {
    process.stdout.write(`${out.join('\n')}\n`);
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
