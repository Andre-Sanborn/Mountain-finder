/**
 * The IMG_7270 pose derivation, printed step by step.
 *
 *   npx tsx scripts/probes/img-7270-heading/geometry.ts
 *
 * Reads the photograph, the committed Bogus Basin peak cells and the local SRTM
 * tiles, and prints every number `docs/IMG-7270-HEADING.md` cites: the bearing
 * and range to Deer Point, its apparent altitude under standard refraction, the
 * frame's field of view, the heading and pitch that put its summit where two
 * annotators read it, the error budget, and the Doe Point cross-check.
 *
 * It writes nothing. Terrain is the one input the repository does not carry;
 * without it the script prints the fetch command and stops.
 */

import {
  altitudeAngleDeg,
  REFRACTION_COEFFICIENT,
  curvatureRefractionDropM,
} from '../../../src/core/sightline.js';
import { haversineDistanceM, initialBearingDeg } from '../../../src/core/geodesy.js';
import {
  fovDegFromFocalLength35mm,
  otherAxisFovDeg,
  projectToImage,
} from '../../../src/core/projection.js';
import type { CameraPose } from '../../../src/core/types.js';

import {
  ANNOTATED_X_PX,
  ANNOTATED_Y_PX,
  EYE_HEIGHT_M,
  ORIGINAL_HEIGHT_PX,
  ORIGINAL_WIDTH_PX,
  PHOTO_NAME,
  READ_PRECISION_PX,
  SUMMIT_NODE_UNCERTAINTY_M,
  TILE_HINT,
  WORKING_HEIGHT_PX,
  WORKING_WIDTH_PX,
  loadGroundElevationM,
  loadSummits,
  numberTag,
  readRawTags,
  stringTag,
  summitNamed,
  viewpointFrom,
  type Site,
  type Summit,
} from './inputs.js';

const DEG = 180 / Math.PI;

function f(value: number, places = 3): string {
  return value.toFixed(places);
}

/** Solve heading and pitch so that one known direction lands on one known pixel. */
function solvePose(
  bearingDeg: number,
  altitudeDeg: number,
  xPx: number,
  yPx: number,
  fov: { hFovDeg: number; vFovDeg: number },
): { headingDeg: number; pitchDeg: number } {
  const wantX = xPx / WORKING_WIDTH_PX;
  const wantY = yPx / WORKING_HEIGHT_PX;

  const residual = (headingDeg: number, pitchDeg: number): [number, number] => {
    const pose: CameraPose = { headingDeg, pitchDeg, rollDeg: 0, ...fov };
    const point = projectToImage(pose, bearingDeg, altitudeDeg);
    return [point.x - wantX, point.y - wantY];
  };

  // Newton on a 2x2 numeric Jacobian. The map is smooth and nearly linear over
  // a degree, so this converges in a handful of steps from any sane start.
  const step = 1e-4;
  let headingDeg = bearingDeg;
  let pitchDeg = altitudeDeg;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const [rx, ry] = residual(headingDeg, pitchDeg);
    if (Math.abs(rx) < 1e-12 && Math.abs(ry) < 1e-12) break;
    const [hx, hy] = residual(headingDeg + step, pitchDeg);
    const [px, py] = residual(headingDeg, pitchDeg + step);
    const a = (hx - rx) / step;
    const b = (px - rx) / step;
    const c = (hy - ry) / step;
    const d = (py - ry) / step;
    const det = a * d - b * c;
    if (det === 0) break;
    headingDeg -= (d * rx - b * ry) / det;
    pitchDeg -= (a * ry - c * rx) / det;
  }
  return { headingDeg, pitchDeg };
}

function describe(site: Site, summit: Summit, eyeElevationM: number): {
  bearingDeg: number;
  rangeM: number;
  altitudeDeg: number;
} {
  const bearingDeg = initialBearingDeg(site, summit);
  const rangeM = haversineDistanceM(site, summit);
  const altitudeDeg = altitudeAngleDeg(eyeElevationM, summit.elevationM, rangeM);
  return { bearingDeg, rangeM, altitudeDeg };
}

async function main(): Promise<void> {
  const tags = await readRawTags(PHOTO_NAME);
  const viewpoint = viewpointFrom(tags);

  const storedWidth = numberTag(tags, 'ExifImageWidth');
  const storedHeight = numberTag(tags, 'ExifImageHeight');
  const focal35 = numberTag(tags, 'FocalLengthIn35mmFormat');
  const exifHeadingDeg = numberTag(tags, 'GPSImgDirection');
  const gpsAltitudeM = numberTag(tags, 'GPSAltitude');

  console.log(`=== inputs — ${PHOTO_NAME}`);
  console.log(`  model                ${stringTag(tags, 'Model') ?? '(absent)'}`);
  console.log(`  software             ${stringTag(tags, 'Software') ?? '(absent)'}`);
  console.log(`  orientation          ${String(tags['Orientation'])}`);
  console.log(`  stored frame         ${String(storedWidth)} x ${String(storedHeight)} px`);
  console.log(`  35 mm-equivalent     ${String(focal35)} mm`);
  console.log(`  GPSImgDirection      ${f(exifHeadingDeg ?? NaN)} deg ${String(tags['GPSImgDirectionRef'])}`);
  console.log(`  GPSAltitude          ${f(gpsAltitudeM ?? NaN, 1)} m`);
  console.log(`  GPSHPositioningError ${f(numberTag(tags, 'GPSHPositioningError') ?? NaN, 1)} m`);
  if (storedWidth !== ORIGINAL_WIDTH_PX || storedHeight !== ORIGINAL_HEIGHT_PX) {
    throw new Error(
      `frame is ${String(storedWidth)} x ${String(storedHeight)}, expected ` +
        `${ORIGINAL_WIDTH_PX} x ${ORIGINAL_HEIGHT_PX}`,
    );
  }
  if (focal35 === undefined || exifHeadingDeg === undefined) {
    throw new Error('photograph carries no focal length or no heading');
  }

  const groundM = await loadGroundElevationM(viewpoint);
  if (groundM === undefined) {
    console.log(`\n${TILE_HINT}`);
    process.exitCode = 1;
    return;
  }
  const eyeElevationM = groundM + EYE_HEIGHT_M;
  console.log(`\n=== viewpoint`);
  console.log(`  position             ${f(viewpoint.lat, 5)} N ${f(-viewpoint.lon, 5)} W`);
  console.log(`  SRTM ground          ${f(groundM, 1)} m`);
  console.log(
    `  GPS altitude         ${f(gpsAltitudeM ?? NaN, 1)} m ` +
      `(${f((gpsAltitudeM ?? NaN) - groundM, 1)} m vs SRTM)`,
  );
  console.log(`  eye                  ${f(eyeElevationM, 1)} m (ground + ${EYE_HEIGHT_M} m)`);

  // ── Frame geometry ───────────────────────────────────────────────────────
  const original = fovDegFromFocalLength35mm(focal35, ORIGINAL_WIDTH_PX, ORIGINAL_HEIGHT_PX);
  const working = {
    hFovDeg: original.hFovDeg,
    vFovDeg: otherAxisFovDeg(original.hFovDeg, WORKING_WIDTH_PX, WORKING_HEIGHT_PX),
  };
  console.log(`\n=== frame geometry`);
  console.log(
    `  original ${ORIGINAL_WIDTH_PX} x ${ORIGINAL_HEIGHT_PX}  ` +
      `hFOV ${f(original.hFovDeg)} deg  vFOV ${f(original.vFovDeg)} deg`,
  );
  console.log(
    `  working  ${WORKING_WIDTH_PX} x ${WORKING_HEIGHT_PX}  ` +
      `hFOV ${f(working.hFovDeg)} deg  vFOV ${f(working.vFovDeg)} deg  ` +
      `(centre-cropped 16:9, full width kept)`,
  );
  console.log(`  half-width tangent   ${f(Math.tan(working.hFovDeg / 2 / DEG), 6)}`);

  // ── Deer Point ───────────────────────────────────────────────────────────
  const summits = await loadSummits();
  const deerPoint = summitNamed(summits, 'Deer Point');
  const seen = describe(viewpoint, deerPoint, eyeElevationM);
  console.log(`\n=== Deer Point, from the committed peak cells`);
  console.log(`  id                   ${deerPoint.id}`);
  console.log(`  cell                 ${deerPoint.cell}.json`);
  console.log(`  position             ${f(deerPoint.lat, 5)} N ${f(-deerPoint.lon, 5)} W`);
  console.log(
    `  height               ${deerPoint.elevationM} m ` +
      `(source kind ${deerPoint.elevationSourceKind ?? 'unknown'})`,
  );
  console.log(`  bearing              ${f(seen.bearingDeg, 2)} deg true`);
  console.log(`  range                ${f(seen.rangeM / 1000, 3)} km`);
  console.log(
    `  curvature/refraction ${f(curvatureRefractionDropM(seen.rangeM), 1)} m drop ` +
      `at k = ${REFRACTION_COEFFICIENT}`,
  );
  console.log(`  apparent altitude    ${f(seen.altitudeDeg)} deg`);

  // ── Pose ─────────────────────────────────────────────────────────────────
  const offsetDeg =
    Math.atan(
      ((ANNOTATED_X_PX - WORKING_WIDTH_PX / 2) / (WORKING_WIDTH_PX / 2)) *
        Math.tan(working.hFovDeg / 2 / DEG),
    ) * DEG;
  const pose = solvePose(seen.bearingDeg, seen.altitudeDeg, ANNOTATED_X_PX, ANNOTATED_Y_PX, working);
  console.log(`\n=== pose that puts Deer Point at (${ANNOTATED_X_PX}, ${ANNOTATED_Y_PX}) px`);
  console.log(`  off-axis angle       ${f(offsetDeg)} deg right of centre (flat-frame atan)`);
  console.log(`  heading - bearing    ${f(seen.bearingDeg - offsetDeg, 3)} deg (offset subtracted)`);
  console.log(`  solved heading       ${f(pose.headingDeg, 3)} deg true`);
  console.log(`  solved pitch         ${f(pose.pitchDeg, 3)} deg`);
  const check = projectToImage(
    { headingDeg: pose.headingDeg, pitchDeg: pose.pitchDeg, rollDeg: 0, ...working },
    seen.bearingDeg,
    seen.altitudeDeg,
  );
  console.log(
    `  re-projected         x ${f(check.x * WORKING_WIDTH_PX, 2)} px  ` +
      `y ${f(check.y * WORKING_HEIGHT_PX, 2)} px`,
  );
  console.log(`\n=== the EXIF heading against the solved one`);
  console.log(`  GPSImgDirection      ${f(exifHeadingDeg, 3)} deg`);
  console.log(`  solved               ${f(pose.headingDeg, 3)} deg`);
  console.log(`  error                ${f(exifHeadingDeg - pose.headingDeg, 3)} deg`);
  console.log(
    `  solved + 90          ${f(pose.headingDeg + 90, 3)} deg ` +
      `(top-edge reference, phone's top edge to the right): ` +
      `${f(exifHeadingDeg - pose.headingDeg - 90, 3)} deg residual`,
  );

  // ── Error budget ─────────────────────────────────────────────────────────
  console.log(`\n=== error budget`);
  for (const delta of [-READ_PRECISION_PX, READ_PRECISION_PX]) {
    const moved = solvePose(
      seen.bearingDeg,
      seen.altitudeDeg,
      ANNOTATED_X_PX + delta,
      ANNOTATED_Y_PX + delta,
      working,
    );
    console.log(
      `  ${delta > 0 ? '+' : ''}${delta} px in x and y  ` +
        `heading ${f(moved.headingDeg - pose.headingDeg, 3)} deg  ` +
        `pitch ${f(moved.pitchDeg - pose.pitchDeg, 3)} deg`,
    );
  }
  const nodeDeg = Math.atan(SUMMIT_NODE_UNCERTAINTY_M / seen.rangeM) * DEG;
  console.log(
    `  mast vs summit node  +/-${SUMMIT_NODE_UNCERTAINTY_M} m at ${f(seen.rangeM / 1000, 3)} km ` +
      `= +/-${f(nodeDeg)} deg of bearing, carried 1:1 into heading`,
  );
  const eyeSwing = [
    altitudeAngleDeg(groundM, deerPoint.elevationM, seen.rangeM),
    altitudeAngleDeg(groundM + 2, deerPoint.elevationM, seen.rangeM),
  ];
  console.log(
    `  eye height 0 .. 2 m  altitude ${f(eyeSwing[0] ?? NaN)} .. ${f(eyeSwing[1] ?? NaN)} deg, ` +
      `so pitch moves ${f(Math.abs((eyeSwing[0] ?? 0) - (eyeSwing[1] ?? 0)))} deg over that span`,
  );
  const gpsAltitudePitch = solvePose(
    seen.bearingDeg,
    altitudeAngleDeg((gpsAltitudeM ?? groundM) + EYE_HEIGHT_M, deerPoint.elevationM, seen.rangeM),
    ANNOTATED_X_PX,
    ANNOTATED_Y_PX,
    working,
  );
  console.log(
    `  eye from GPS instead heading ${f(gpsAltitudePitch.headingDeg, 3)} deg  ` +
      `pitch ${f(gpsAltitudePitch.pitchDeg, 3)} deg`,
  );

  // ── Cross-check ──────────────────────────────────────────────────────────
  console.log(`\n=== cross-check: other summits under the solved pose`);
  const solved: CameraPose = {
    headingDeg: pose.headingDeg,
    pitchDeg: pose.pitchDeg,
    rollDeg: 0,
    ...working,
  };
  const exifPose: CameraPose = { headingDeg: exifHeadingDeg, pitchDeg: 0, rollDeg: 0, ...working };
  for (const name of ['Doe Point', 'Little Deer Point', 'Shafer Butte', 'Mores Mountain']) {
    const matches = summits.filter((summit) => summit.name === name);
    for (const summit of matches) {
      const view = describe(viewpoint, summit, eyeElevationM);
      const onSolved = projectToImage(solved, view.bearingDeg, view.altitudeDeg);
      const onExif = projectToImage(exifPose, view.bearingDeg, view.altitudeDeg);
      console.log(
        `  ${name.padEnd(18)} ${f(view.rangeM / 1000, 3)} km  bearing ${f(view.bearingDeg, 2)}  ` +
          `alt ${f(view.altitudeDeg, 2)}  ` +
          `solved x ${f(onSolved.x * WORKING_WIDTH_PX, 0)} y ${f(onSolved.y * WORKING_HEIGHT_PX, 0)} ` +
          `${onSolved.inFrame ? 'IN' : 'off'}  ` +
          `EXIF-pose ${onExif.inFrame ? 'IN' : 'off'}`,
      );
    }
  }

  const sector = summits
    .map((summit) => ({ summit, view: describe(viewpoint, summit, eyeElevationM) }))
    .filter(({ view }) => view.rangeM < 60_000)
    .filter(({ view }) => projectToImage(exifPose, view.bearingDeg, view.altitudeDeg).inFrame)
    .map(({ summit, view }) => `${summit.name} ${f(view.bearingDeg, 2)}`);
  console.log(
    `\n  summits inside the frame at the EXIF heading (${f(exifHeadingDeg, 3)} deg, pitch 0): ` +
      `${String(sector.length)}`,
  );
  for (const entry of sector) console.log(`    ${entry}`);
}

await main();
