/**
 * The second instrument: where the Sun stood when IMG_7270 was taken.
 *
 *   npx tsx scripts/probes/img-7270-heading/sun.ts [heading-deg]
 *
 * The photograph carries a flare entering from the top-right corner, so the Sun
 * has to be off the right-hand side of the frame. This prints its azimuth and
 * elevation at the recorded instant and which side of the axis it falls on,
 * under the solved heading and under the EXIF one.
 *
 * The instant comes out of the EXIF at run time, so no wall clock is written
 * here and none sits beside a coordinate. `GPSTimeStamp` is printed as an
 * independent check on the local time and its UTC offset.
 *
 * It writes nothing.
 */

import { sunPosition } from '../../../src/core/celestial.js';
import { angularDifferenceDeg } from '../../../src/core/geodesy.js';
import { fovDegFromFocalLength35mm, otherAxisFovDeg } from '../../../src/core/projection.js';

import {
  EYE_HEIGHT_M,
  ORIGINAL_HEIGHT_PX,
  ORIGINAL_WIDTH_PX,
  PHOTO_NAME,
  TILE_HINT,
  WORKING_HEIGHT_PX,
  WORKING_WIDTH_PX,
  loadGroundElevationM,
  numberTag,
  readRawTags,
  stringTag,
  viewpointFrom,
  type RawTags,
} from './inputs.js';

const DEG = 180 / Math.PI;

/** The default the derivation lands on; override with the first argument. */
const SOLVED_HEADING_DEG = 187.938;

function f(value: number, places = 3): string {
  return value.toFixed(places);
}

/** `YYYY:MM:DD HH:MM:SS` plus `+HH:MM` as a UTC instant. */
function instantFrom(tags: RawTags): { utc: Date; local: string; offset: string } {
  const local = stringTag(tags, 'DateTimeOriginal');
  const offset = stringTag(tags, 'OffsetTimeOriginal');
  if (local === undefined || offset === undefined) {
    throw new Error('photograph carries no DateTimeOriginal with an offset');
  }
  const iso = `${local.slice(0, 10).replace(/:/g, '-')}T${local.slice(11)}${offset}`;
  const utc = new Date(iso);
  if (Number.isNaN(utc.getTime())) throw new Error(`could not read ${iso} as an instant`);
  return { utc, local, offset };
}

/** `GPSTimeStamp` as hours:minutes:seconds UTC, for comparison with the above. */
function gpsClock(tags: RawTags): string {
  const stamp = tags['GPSTimeStamp'];
  if (!Array.isArray(stamp)) return '(absent)';
  const [hours, minutes, seconds] = stamp as readonly unknown[];
  const pad = (part: unknown): string =>
    typeof part === 'number' ? String(Math.trunc(part)).padStart(2, '0') : String(part);
  const secondsText = typeof seconds === 'number' ? seconds.toFixed(2).padStart(5, '0') : '?';
  return `${String(tags['GPSDateStamp'] ?? '?')} ${pad(hours)}:${pad(minutes)}:${secondsText} UTC`;
}

async function main(): Promise<void> {
  const argument = process.argv[2];
  const solvedHeadingDeg = argument === undefined ? SOLVED_HEADING_DEG : Number(argument);
  if (!Number.isFinite(solvedHeadingDeg)) throw new Error(`not a heading: ${String(argument)}`);

  const tags = await readRawTags(PHOTO_NAME);
  const viewpoint = viewpointFrom(tags);
  const { utc, local, offset } = instantFrom(tags);
  const focal35 = numberTag(tags, 'FocalLengthIn35mmFormat');
  const exifHeadingDeg = numberTag(tags, 'GPSImgDirection');
  if (focal35 === undefined || exifHeadingDeg === undefined) {
    throw new Error('photograph carries no focal length or no heading');
  }

  const groundM = await loadGroundElevationM(viewpoint);
  if (groundM === undefined) {
    console.log(TILE_HINT);
    process.exitCode = 1;
    return;
  }

  console.log(`=== instant — ${PHOTO_NAME}`);
  console.log(`  DateTimeOriginal     ${local} ${offset}`);
  console.log(`  as UTC               ${utc.toISOString()}`);
  console.log(`  GPSTimeStamp         ${gpsClock(tags)}`);

  const sun = sunPosition(utc, {
    lat: viewpoint.lat,
    lon: viewpoint.lon,
    heightM: groundM + EYE_HEIGHT_M,
  });
  console.log(`\n=== Sun, topocentric and airless`);
  console.log(`  azimuth              ${f(sun.azimuthDeg, 1)} deg true`);
  console.log(`  elevation            ${f(sun.altitudeDeg, 1)} deg`);

  const hFovDeg = fovDegFromFocalLength35mm(
    focal35,
    ORIGINAL_WIDTH_PX,
    ORIGINAL_HEIGHT_PX,
  ).hFovDeg;
  const vFovDeg = otherAxisFovDeg(hFovDeg, WORKING_WIDTH_PX, WORKING_HEIGHT_PX);
  console.log(
    `  frame half-width     ${f(hFovDeg / 2)} deg   half-height ${f(vFovDeg / 2)} deg ` +
      `(${WORKING_WIDTH_PX} x ${WORKING_HEIGHT_PX})`,
  );

  console.log(`\n=== which side of the optical axis the Sun falls on`);
  for (const [tag, headingDeg] of [
    ['solved from Deer Point', solvedHeadingDeg],
    ['GPSImgDirection', exifHeadingDeg],
  ] as const) {
    const offAxisDeg = angularDifferenceDeg(headingDeg, sun.azimuthDeg);
    const side = offAxisDeg > 0 ? 'RIGHT' : 'LEFT';
    const xPx =
      WORKING_WIDTH_PX / 2 +
      (WORKING_WIDTH_PX / 2) * (Math.tan(offAxisDeg / DEG) / Math.tan(hFovDeg / 2 / DEG));
    console.log(
      `  ${tag.padEnd(24)} heading ${f(headingDeg, 3)}  ` +
        `Sun ${offAxisDeg > 0 ? '+' : ''}${f(offAxisDeg, 1)} deg (${side})  ` +
        `${Math.abs(offAxisDeg) <= hFovDeg / 2 ? `x ${f(xPx, 0)} px, in frame` : 'outside the frame'}`,
    );
  }
  console.log(
    `\n  The flare enters from the top-right, so the Sun is on the right.` +
      ` It is outside the frame either way; the side is what separates the two headings.`,
  );
}

await main();
