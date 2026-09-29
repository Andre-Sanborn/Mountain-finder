// CV-11 isolation driver. Prints no coordinates; writes no image derivatives.
// Run: node_modules/.bin/tsx scripts/probes/cv11-aligner/driver.mts --variants '["full","mask","a","b","c"]' --tag run [--range-km 60]
/* eslint-disable @typescript-eslint/no-explicit-any -- the library modules are loaded with dynamic import, so their values are untyped here. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
const R = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');
const { extractPhotoExif } = await import(`${R}/src/exif/extract.ts`);
const { cameraPoseFromPhotoExif } = await import(`${R}/src/exif/photo-pose.ts`);
const { annotateScene } = await import(`${R}/src/pipeline/annotate.ts`);
const { loadPeakCellIndex } = await import(`${R}/src/providers/peak-directory.ts`);
const { DirectoryTileStore } = await import(`${R}/src/providers/tile-directory.ts`);
const { TileElevationProvider } = await import(`${R}/src/providers/tile-elevation.ts`);
const { extractSkyline } = await import(`${R}/src/cv/skyline.ts`);
const { alignSkyline } = await import(`${R}/src/cv/align.ts`);
const { unprojectFromImage, directionToSky } = await import(`${R}/src/cv/rays.ts`);
const { interpolateHorizonAltitudeDeg } = await import(`${R}/src/core/horizon.ts`);
const { suggestPoseTrim } = await import(`${R}/src/pipeline/cv-alignment.ts`);
const { default: decodeHeic } = await import((await import('node:module')).createRequire(R + '/package.json').resolve('heic-decode'));

const args = process.argv.slice(2);
const get = (f: string, d: string) => { const i = args.indexOf(f); return i < 0 ? d : args[i + 1]!; };
const PHOTO = `${R}/fixtures/photos/real/hdr-gainmap-7270.heic`;
const H0 = Number(get('--heading', '187.938'));
const P0 = Number(get('--pitch', '-4.939'));
const rangeKm = Number(get('--range-km', '30'));
const variants: string[] = JSON.parse(get('--variants', '["full"]'));
const personFrom = Number(get('--person-from', '170'));
const personTo = Number(get('--person-to', '183'));
const cropRightOfDeg = Number(get('--crop-right-of', '184'));
const tag = get('--tag', 'run');
const OUT = `${R}/out/probes/cv11-aligner`;
await mkdir(OUT, { recursive: true });

const d2r = Math.PI / 180, r2d = 180 / Math.PI;
const log: string[] = [];
const say = (s = '') => { log.push(s); console.log(s); };

const bytes = await readFile(PHOTO);
const img = await decodeHeic({ buffer: bytes as any });
const W = img.width, H = img.height;
const exif = await extractPhotoExif(new Uint8Array(bytes));
const cam = cameraPoseFromPhotoExif(exif, { headingDeg: H0, pitchDeg: P0 });
say(`frame ${W}x${H}  f35 ${exif.focalLength35mmMm}  hFOV ${cam.hFovDeg.toFixed(3)} vFOV ${cam.vFovDeg.toFixed(3)}  pose ${H0}/${P0}  range ${rangeKm} km`);
const fx = (W / 2) / Math.tan(cam.hFovDeg / 2 * d2r);
const fy = (H / 2) / Math.tan(cam.vFovDeg / 2 * d2r);
say(`focal px: fx ${fx.toFixed(1)} fy ${fy.toFixed(1)} (square pixels iff equal)`);

const t0 = Date.now();
const store = await loadPeakCellIndex(`${R}/fixtures/peaks/regions/idaho-central/index.json`);
const scene = await annotateScene({
  observer: { lat: exif.lat!, lon: exif.lon!, eyeHeightM: 1.6 },
  camera: cam,
  elevation: new TileElevationProvider(new DirectoryTileStore(`${R}/data/tiles`)),
  peaks: { async peaksWithin(c: any, r: number) { return store.peaksWithin(c, Math.min(r, 30)); } },
  config: { sweep: { bearingStepDeg: 0.25, rangeStepM: 90, minRangeM: 150, maxRangeKm: rangeKm }, peakRadiusKm: 30, nearFieldRadiusM: 150 },
});
const profile = scene.alignmentHorizon!;
say(`sweep ${(Date.now() - t0) / 1000}s, alignment profile ${profile.length} pts`);

const EDGE = Math.max(2, Math.round(H * 0.015));
const PITCH_COLS = W / 512;

function crop(x0: number, x1: number, y0: number, y1: number) {
  const w = x1 - x0, h = y1 - y0;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = ((y0 + y) * W + x0) * 4;
    data.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data };
}

// Comb search, identical to suggestPoseTrim but on a given skyline, keeping every window's diagnostics.
function comb(sky: any, camera: any) {
  const cands: { total: number; a: any }[] = [];
  let nonRim: any; let centre: any;
  for (let c = -6; c <= 6 + 1e-9; c += 1) {
    const a = alignSkyline(sky, { ...camera, headingDeg: camera.headingDeg + c }, profile, { headingRangeDeg: 0.6, headingStepDeg: 0.1 });
    if (c === 0) centre = a;
    if (a.status === 'failed') { if (a.reason !== 'search-range-exhausted') nonRim ??= a; continue; }
    const total = c + a.headingOffsetDeg;
    if (Math.abs(total) > 6 + 1e-9) continue;
    const near = cands.find((k) => Math.abs(k.total - total) < 0.5);
    if (!near) cands.push({ total, a }); else if (a.diagnostics.score > near.a.diagnostics.score) { near.total = total; near.a = a; }
  }
  cands.sort((p, q) => Math.abs(p.total) - Math.abs(q.total));
  return { cands, nonRim, centre };
}

function perBearing(sky: any, camera: any, label: string) {
  // Raw misfit at the supplied pose, no search: photo altitude minus profile altitude, binned 3 deg.
  const bins = new Map<number, { w: number; d: number; d2: number; n: number; dist: number; pa: number; ta: number }>();
  let W8 = 0, S = 0, S2 = 0; const rows: any[] = [];
  for (const col of sky.columns) {
    if (col.rowNorm === undefined || col.confidence01 < 0.05) continue;
    const s = directionToSky(unprojectFromImage(camera, col.xNorm, col.rowNorm));
    const t = interpolateHorizonAltitudeDeg(profile, s.bearingDeg);
    const d = s.altitudeDeg - t; const w = col.confidence01;
    W8 += w; S += w * d; S2 += w * d * d;
    let best: any; let bd = 1e9; for (const p of profile) { const dd = Math.abs(((p.bearingDeg - s.bearingDeg + 540) % 360) - 180); if (dd < bd) { bd = dd; best = p; } }
    rows.push({ b: s.bearingDeg, d, w, dist: best?.distanceKm ?? NaN });
    const k = Math.floor(s.bearingDeg / 3) * 3;
    const e = bins.get(k) ?? { w: 0, d: 0, d2: 0, n: 0, dist: 0, pa: 0, ta: 0 };
    e.w += w; e.d += w * d; e.d2 += w * d * d; e.n++; e.dist += w * (best?.distanceKm ?? 0); e.pa += w * s.altitudeDeg; e.ta += w * t; bins.set(k, e);
  }
  const mean = S / W8, rms = Math.sqrt(S2 / W8), rmsAboutMean = Math.sqrt(S2 / W8 - mean * mean);
  say(`  [${label}] raw misfit at supplied pose over ${rows.length} cols: mean ${mean.toFixed(3)}  rms ${rms.toFixed(3)}  rms-about-mean ${rmsAboutMean.toFixed(3)} deg`);
  say('    bin    n   photoAlt  terrAlt   meanDiff  rmsDiff  crestKm');
  for (const k of [...bins.keys()].sort((a, b) => a - b)) {
    const e = bins.get(k)!;
    say(`    ${String(k).padStart(3)}  ${String(e.n).padStart(3)}  ${(e.pa / e.w).toFixed(2).padStart(8)} ${(e.ta / e.w).toFixed(2).padStart(8)}  ${(e.d / e.w).toFixed(2).padStart(8)} ${Math.sqrt(e.d2 / e.w).toFixed(2).padStart(8)}  ${(e.dist / e.w).toFixed(1).padStart(6)}`);
  }
  return rows;
}

function report(name: string, sky: any, camera: any, note: string) {
  say(`\n=== ${name}: ${note}`);
  say(`  skyline coverage ${(sky.coverage01 * 100).toFixed(1)}%  meanConf ${sky.meanConfidence01.toFixed(3)}  columns ${sky.columns.length}`);
  const { cands, nonRim, centre } = comb(sky, camera);
  const cd = centre.diagnostics;
  say(`  centre window (±0.6 at supplied pose): ${centre.status}${centre.status === 'failed' ? ' ' + centre.reason : ''}  residual ${cd.residualRmsDeg.toFixed(3)}  used ${(cd.usedFraction01 * 100).toFixed(1)}%  score ${cd.score.toFixed(3)}  margin ${cd.margin.toFixed(3)}  photoRelief ${cd.photoReliefDeg.toFixed(2)} profRelief ${cd.profileReliefDeg.toFixed(2)}${centre.status !== 'failed' ? `  dh ${centre.headingOffsetDeg.toFixed(3)} dp ${centre.pitchOffsetDeg.toFixed(3)}` : ''}`);
  if (cands.length === 0) {
    say(`  COMB: declined no-alignment: ${nonRim ? nonRim.reason + ' — residual ' + nonRim.diagnostics.residualRmsDeg.toFixed(3) + ' used ' + (nonRim.diagnostics.usedFraction01 * 100).toFixed(1) + '%' : 'every window at its rim'}`);
  } else {
    const c = cands[0]!; const g = c.a.diagnostics;
    say(`  COMB: suggested ${c.a.status} heading ${c.total >= 0 ? '+' : ''}${c.total.toFixed(3)} pitch ${c.a.pitchOffsetDeg >= 0 ? '+' : ''}${c.a.pitchOffsetDeg.toFixed(3)}  => pose ${(camera.headingDeg + c.total).toFixed(3)} / ${(camera.pitchDeg + c.a.pitchOffsetDeg).toFixed(3)}  residual ${g.residualRmsDeg.toFixed(3)} used ${(g.usedFraction01 * 100).toFixed(1)}% score ${g.score.toFixed(3)} margin ${g.margin.toFixed(3)}  concerns ${c.a.concerns?.join(',') || '-'}  others ${cands.slice(1).map((k) => k.total.toFixed(2)).join(',') || '-'}`);
  }
  // Every window's result, compactly.
  for (let c = -6; c <= 6; c += 1) {
    const a = alignSkyline(sky, { ...camera, headingDeg: camera.headingDeg + c }, profile, { headingRangeDeg: 0.6, headingStepDeg: 0.1 });
    const g = a.diagnostics;
    say(`    win ${String(c).padStart(3)}: ${a.status.padEnd(14)} ${a.status === 'failed' ? a.reason.padEnd(22) : ('dh ' + (c + a.headingOffsetDeg).toFixed(2) + ' dp ' + a.pitchOffsetDeg.toFixed(2)).padEnd(22)} res ${g.residualRmsDeg.toFixed(2)} score ${g.score.toFixed(3)} margin ${g.margin.toFixed(3)}`);
  }
  return perBearing(sky, camera, name);
}

const skyOpts = (w: number) => ({ columnCount: Math.round(w / PITCH_COLS), edgeBandRows: EDGE });
const xAtBearing = (b: number) => W / 2 + fx * Math.tan((b - H0) * d2r); // level-camera approximation, used only to place crop edges

// Exact remap: extract on crop pixels, express columns in full-frame coordinates, align with the unchanged camera.
function remapped(x0: number, x1: number, y0: number, y1: number) {
  const s = extractSkyline(crop(x0, x1, y0, y1), skyOpts(x1 - x0));
  const cols = s.columns.map((c: any) => ({ ...c, xNorm: (x0 + c.xNorm * (x1 - x0)) / W, rowNorm: c.rowNorm === undefined ? undefined : (y0 + c.rowNorm * (y1 - y0)) / H }));
  return { ...s, widthPx: W, heightPx: H, columns: cols };
}
// Re-centred pose for a crop, as a user-side crop would be run.
function recentred(x0: number, x1: number, y0: number, y1: number) {
  const xc = (x0 + x1) / 2, yc = (y0 + y1) / 2;
  const hF = 2 * Math.atan((x1 - x0) / 2 / fx) * r2d, vF = 2 * Math.atan((y1 - y0) / 2 / fy) * r2d;
  const camera = { ...cam, headingDeg: H0 + Math.atan((xc - W / 2) / fx) * r2d, pitchDeg: P0 + Math.atan((H / 2 - yc) / fy) * r2d, hFovDeg: hF, vFovDeg: vF };
  const f35 = 36 / (2 * Math.tan(hF / 2 * d2r));
  // Geometry error of the approximation: where the recentred camera puts the crop's pixels vs the exact camera.
  let maxDb = 0, maxDa = 0;
  // Evaluated over the skyline band only (full-frame rows 2500..3400, altitude about +0.5 to -8 deg).
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 9; j++) {
    const X = x0 + (x1 - x0) * i / 40, Y = 2500 + 100 * j;
    const a = directionToSky(unprojectFromImage(cam, X / W, Y / H));
    const b = directionToSky(unprojectFromImage(camera, (X - x0) / (x1 - x0), (Y - y0) / (y1 - y0)));
    maxDb = Math.max(maxDb, Math.abs(((a.bearingDeg - b.bearingDeg + 540) % 360) - 180)); maxDa = Math.max(maxDa, Math.abs(a.altitudeDeg - b.altitudeDeg));
  }
  const s = extractSkyline(crop(x0, x1, y0, y1), skyOpts(x1 - x0));
  return { s, camera, f35, maxDb, maxDa };
}

const x183 = xAtBearing(cropRightOfDeg);
const XR = Math.ceil(x183);
const Y169 = Math.round(W * 9 / 16); // 16:9 keeps the top rows, drops the foreground
say(`crop edges: x >= ${XR} (bearing ${cropRightOfDeg} under a level camera); 16:9 keeps rows 0..${Y169} of ${H}`);

for (const v of variants) {
  if (v === 'full') {
    const s = extractSkyline(img, skyOpts(W));
    report('full', s, cam, 'original frame');
    const r = suggestPoseTrim({ image: img, scene: { camera: cam, horizon: profile }, skyline: { edgeBandRows: EDGE } });
    say(`  suggestPoseTrim (library, as annotate runs it): ${r.status}${r.status === 'declined' ? ' ' + r.reason + ': ' + r.detail : ' h ' + r.headingTrimDeg.toFixed(3) + ' p ' + r.pitchTrimDeg.toFixed(3) + ' res ' + r.alignment.diagnostics.residualRmsDeg.toFixed(3)}`);
  } else if (v === 'haze') {
    // Luminance and saturation down the frame at fixed sectors, in altitude steps, to see what lies between the DEM horizon and the extracted skyline.
    for (const [b0, b1] of [[159, 165], [186, 192], [195, 201], [204, 210], [213, 219]]) {
      const xs = [xAtBearing(b0!), xAtBearing(b1!)].map(Math.round);
      const tHor = interpolateHorizonAltitudeDeg(profile, (b0! + b1!) / 2);
      say(`\n  sector ${b0}-${b1} deg (x ${xs[0]}..${xs[1]}), DEM horizon ${tHor.toFixed(2)} deg`);
      say('    alt    lum    sat    B-R');
      for (let a = 3; a >= -8; a -= 0.5) {
        const y = Math.round(H / 2 - fy * Math.tan((a - P0) * d2r));
        let L = 0, S = 0, BR = 0, n = 0;
        for (let yy = y - 5; yy <= y + 5; yy++) for (let x = xs[0]!; x < xs[1]!; x += 4) {
          const i = (yy * W + x) * 4; const r = img.data[i]!, g = img.data[i + 1]!, bl = img.data[i + 2]!;
          L += 0.299 * r + 0.587 * g + 0.114 * bl; const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl); S += mx === 0 ? 0 : (mx - mn) / mx; BR += bl - r; n++;
        }
        say(`    ${a.toFixed(1).padStart(5)}  ${(L / n).toFixed(1).padStart(5)}  ${(S / n).toFixed(3)}  ${(BR / n).toFixed(1).padStart(6)}`);
      }
    }
  } else if (v === 'mask') {
    const s = extractSkyline(img, skyOpts(W));
    const cols = s.columns.map((c: any) => { const b = directionToSky(unprojectFromImage(cam, c.xNorm, c.rowNorm ?? 0.5)).bearingDeg; return b >= personFrom && b <= personTo ? { ...c, rowNorm: undefined, confidence01: 0 } : c; });
    report('mask', { ...s, columns: cols }, cam, `full-frame skyline with columns at ${personFrom}..${personTo} deg blanked`);
  } else {
    const [x0, x1, y0, y1] = v === 'a' ? [XR, W, 0, H] : v === 'b' ? [0, W, 0, Y169] : [XR, W, 0, Y169];
    const s = remapped(x0!, x1!, y0!, y1!);
    report(`${v}-exact`, s, cam, `crop x ${x0}..${x1}, y ${y0}..${y1}; skyline mapped back to the full-frame camera`);
    const rc = recentred(x0!, x1!, y0!, y1!);
    report(`${v}-recentred`, rc.s, rc.camera, `same crop as its own photo: heading ${rc.camera.headingDeg.toFixed(3)} pitch ${rc.camera.pitchDeg.toFixed(3)} hFOV ${rc.camera.hFovDeg.toFixed(3)} vFOV ${rc.camera.vFovDeg.toFixed(3)} f35 ${rc.f35.toFixed(2)}; pinhole-shift error max ${rc.maxDb.toFixed(3)} deg bearing, ${rc.maxDa.toFixed(3)} deg altitude`);
  }
}
await writeFile(`${OUT}/${tag}.log`, log.join('\n') + '\n');
