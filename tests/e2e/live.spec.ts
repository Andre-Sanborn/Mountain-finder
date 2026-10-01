/**
 * THE LIVE AR SCREEN, DRIVEN HEADLESSLY — camera, sensors, terrain, labels.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS REAL HERE AND WHAT IS INJECTED
 * ═══════════════════════════════════════════════════════════════════════════
 * Real: the `<video>` element and its `MediaStream`, `enumerateDevices`, the
 * device pick, `track.getSettings()` and the once-a-second lens watch, the
 * `object-fit: cover` geometry read off `videoWidth`, the SRTM tile fetched over
 * HTTP, the 360° `annotateScene` sweep, `liveOverlayScene`, `layoutOverlay`, the
 * SVG, the uncertainty band, the Sun and Moon marks, and the drag.
 *
 * Injected: the camera's pixels (a file, see `support/fake-camera.ts`), the
 * geolocation fix (Playwright), and the orientation and motion events.
 *
 * ── HOW THE SENSOR EVENTS ARE INJECTED, AND WHY THAT WAY ───────────────────
 * Measured in this environment's Chromium 141.0.7390.37, all four candidate
 * routes:
 *
 *   `DeviceOrientation.setDeviceOrientationOverride` (CDP)
 *       fires events, but `deviceorientation` arrives with `absolute: false`,
 *       `deviceorientationabsolute` arrives with alpha/beta/gamma all null, and
 *       `devicemotion` arrives with every vector component null. So it can only
 *       deliver a RELATIVE alpha — which `web-sensors.ts` correctly refuses on
 *       Chromium, because nothing anchors it. Unusable for a heading.
 *   `Emulation.setSensorOverrideEnabled` + `setSensorOverrideReadings` (CDP)
 *       both calls succeed for `absolute-orientation` with a quaternion, and the
 *       one `deviceorientation` event that follows carries null angles. Also
 *       unusable, and it claims the same sensor as the call above, so the two
 *       cannot both be enabled.
 *   `Emulation.setDeviceMetricsOverride`
 *       resizes the viewport. Nothing to do with sensors.
 *   **constructing real `DeviceOrientationEvent` / `DeviceMotionEvent` objects
 *   in the page and dispatching them** — works exactly, including
 *   `absolute: true`, and including iOS's non-standard fields through
 *   `Object.defineProperty`. This is the route used below.
 *
 * That is faithful rather than a shortcut: `web-sensors.ts` is a pure function
 * of the event OBJECT, so a constructed event exercises the same code path a
 * phone's event does. What it cannot prove is that a phone emits the values this
 * test emits — which is what the home-session recording is for, and is stated as
 * such in IMPLEMENTATION.md rather than papered over here.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHERE THE EXPECTED PIXEL COMES FROM
 * ═══════════════════════════════════════════════════════════════════════════
 * Derived twice, from the coordinates rather than from any run of this app.
 *
 * Observer: the Gornergrat platform, 45°59'00"N 7°46'56"E = 45.983333,
 * 7.782222, at 3089 m with a 1.6 m eye height, so 3090.6 m.
 * Summit: the Matterhorn, 45.976389 N, 7.658611 E, 4478 m.
 *
 *   initial great-circle bearing  265.4227°
 *   range                           9.5827 km
 *   α = atan((4478 − 3090.6 − d²/2R_eff) / d) = +8.20145°, R_eff = R/(1 − 0.13)
 *
 * `tests/e2e/app.spec.ts` and `scripts/deploy-check/deploy.spec.ts` derived the
 * same three numbers for the still path and cite 265.42252°, 9.5827 km and
 * 8.20143°. Two derivations, agreeing to 0.0008° of bearing and 0.00002° of
 * altitude — the difference is the Earth radius each used.
 *
 * The frame is the 800 × 450 viewport. The camera delivers 1200 × 900, so
 * `object-fit: cover` scales by max(800/1200, 450/900) = 2/3, renders 800 × 600
 * and keeps 0.75 of the height. At the 24 mm-equivalent guess the decoded
 * frame's field is 2·atan(36/48) = 2·atan(0.75) across its long axis, and
 * tan(v/2) = 0.75 · (900/1200) = 0.5625 down it; the crop leaves
 * tan(v_box/2) = 0.5625 · 0.75 = 0.421875. So:
 *
 *   hFOV = 2·atan(0.75)      = 73.739795°
 *   vFOV = 2·atan(0.421875)  = 45.747330°
 *
 * With the camera looking along true 265.4°, Δ = 265.4227 − 265.4 = +0.0227°:
 *
 *   x = 800 · (0.5 + tanΔ / (2·tan(hFOV/2)))            = 400.21 px
 *   y = 450 · (0.5 − (tanα / cosΔ) / (2·tan(vFOV/2)))   = 148.13 px
 *
 * asserted to ±8 px — 1 % of the frame width, the same fraction the still
 * path's ±12 px on 1200 px is. At this scale 1 px is 0.107°, and the two
 * approximations folded into the tolerance are far smaller: the DEM reads
 * 3087.98 m where the published platform height is 3089 m, worth 0.006° or
 * 0.06 px, and the peak database's own coordinate precision is finer still.
 *
 * ── WHAT THE MAGNETIC BEARING HAS TO BE ────────────────────────────────────
 * The events carry a MAGNETIC bearing, and the screen converts it with WMM2025
 * once the fix arrives. So the injected bearing is the wanted true heading less
 * the model's declination for this place and date, computed here through
 * `src/core/declination.ts` — which is verified against NOAA's own test values.
 * It is used as an INPUT, to decide what to inject; the expectation stays the
 * closed form above for a true heading of 265.4°.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { geomagneticField } from '../../src/core/declination';
import { moonPosition, sunPosition } from '../../src/core/celestial';
import { EPOCH_FLOOR, findForbiddenContent, parseRecording, POSE_LABELS } from '../../src/live/recording';
import { parseSiteDefinition, SITE_DEFINITION_DIR, SITE_PACKAGE_DIR } from '../../src/sites/site-package';
import { parseTerrainManifest, type TerrainManifest } from '../../src/providers/terrain-manifest';
import { FAKE_CAMERA_DIR, FAKE_FRAME, writeFakeCameraVideo } from './support/fake-camera';
import {
  DEG,
  FRAME,
  GORNERGRAT,
  MIN_SPREAD_PX,
  OBSERVER_EYE_M,
  TRUE_HEADING_DEG,
  VISIBLE_FOV,
  bearingDeg,
  dragPicture,
  eventAnglesFor,
  expectedSummitPx,
  installSensorPump,
  magneticBearingFor,
  poseNumber,
  preinstalled,
  projectIndependently,
  pumpCompassOnly,
  pumpSet,
  rangeM,
  summitDots,
} from './support/gornergrat';

const FAKE_VIDEO = resolve(
  FAKE_CAMERA_DIR,
  `fake-camera-${FAKE_FRAME.widthPx}x${FAKE_FRAME.heightPx}.y4m`,
);

/** Repository root, for the committed site definition and the built package. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Chamonix, for the no-terrain case. It sits in SRTM tile N45E006, which this
 * repository does not serve — the same viewpoint `tests/e2e/app.spec.ts` uses to
 * prove the still path names a missing tile rather than drawing nothing.
 */
const CHAMONIX = { lat: 45.9237, lon: 6.8694 };


/** Tolerance: 1 % of the frame width, as the still path uses. */
const TOLERANCE_PX = 8;

/* ── fixtures ─────────────────────────────────────────────────────────────── */

test.use({
  viewport: FRAME.widthPx === 0 ? undefined : { width: FRAME.widthPx, height: FRAME.heightPx },
  permissions: ['camera', 'geolocation'],
  // No `accuracy`: Playwright does not require it, and the repository privacy
  // gate reads a latitude/longitude/accuracy key set as the shape of a recorded
  // position fix (scripts/lib/privacy-detect.ts). Leaving it out keeps a test
  // over published coordinates from looking like a capture.
  geolocation: { latitude: GORNERGRAT.lat, longitude: GORNERGRAT.lon },
  launchOptions: {
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: [
      // Auto-accept the media prompt, serve a fake device, and make that device
      // replay a file. All three are needed: without the third the fake device
      // is a rolling colour pattern.
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${FAKE_VIDEO}`,
    ],
  },
});

/** A tile fetch, then a 360° sweep. The still path allows 120 s for a 131° one. */
const SCENE_TIMEOUT_MS = 180_000;

test.beforeAll(async () => {
  // Generated before the browser is launched, because Chromium reads the file
  // named in its own command line at start-up.
  const path = await writeFakeCameraVideo();
  expect(path).toBe(FAKE_VIDEO);
});

/** Open the page, start the session, and pump the pose. */
async function startLive(
  page: Page,
  pose: { trueHeadingDeg: number; pitchDeg: number },
): Promise<void> {
  await installSensorPump(page);
  await page.goto('/live.html');
  await expect(page.getByTestId('live-title')).toHaveText('Mountain Finder — live');

  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');

  await pumpSet(
    page,
    eventAnglesFor(magneticBearingFor(pose.trueHeadingDeg, new Date()), pose.pitchDeg),
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

test('a phone held upright in portrait is told to turn it sideways, and nothing is drawn', async ({
  page,
}) => {
  await installSensorPump(page);
  await page.setViewportSize({ width: 450, height: 800 });
  await page.goto('/live.html');

  const refusal = page.getByTestId('live-refusal');
  await expect(refusal).toHaveAttribute('data-refusal-code', 'portrait');
  await expect(page.getByTestId('live-refusal-headline')).toHaveText('Turn the phone sideways');
  await expect(page.getByTestId('live-refusal-todo')).toContainText('Rotate the phone');
  // A refusal, not a failure: waiting for the user to move is the whole remedy.
  await expect(refusal).toHaveAttribute('data-transient', 'true');
  // Nothing is drawn while the pose is one the app cannot defend.
  await expect(page.getByTestId('live-overlay-svg')).toHaveCount(0);

  // Turning it sideways clears the refusal without a reload.
  await page.setViewportSize({ width: FRAME.widthPx, height: FRAME.heightPx });
  await expect(page.getByTestId('live-refusal')).not.toHaveAttribute(
    'data-refusal-code',
    'portrait',
  );
});

test('the permission steps are on screen before anything is asked for', async ({ page }) => {
  await page.goto('/live.html');
  const steps = page.getByTestId('live-steps');
  await expect(steps).toBeVisible();
  // Written for someone who has never granted a browser permission.
  await expect(steps).toContainText('Hold the phone sideways');
  await expect(steps).toContainText('Tap Allow when the phone asks to use the camera');
  await expect(steps).toContainText('motion and orientation');
  await expect(steps).toContainText('your location');
  await expect(page.getByTestId('live-refusal')).toHaveAttribute(
    'data-refusal-code',
    'not-started',
  );
});

test('the camera opens, and the app says what it could and could not confirm', async ({ page }) => {
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });

  // The stream is genuinely running at the file's own dimensions.
  const video = await page.getByTestId('live-video').evaluate((node) => {
    const element = node as HTMLVideoElement;
    return { width: element.videoWidth, height: element.videoHeight, paused: element.paused };
  });
  expect(video.width).toBe(FAKE_FRAME.widthPx);
  expect(video.height).toBe(FAKE_FRAME.heightPx);
  expect(video.paused).toBe(false);

  // Chromium's fake device is labelled with the path of the file replacing the
  // camera — a real label carrying no lens information. So the honest answer is
  // that a single fixed lens could not be confirmed, and that is what is shown.
  // On the phone this line is absent for a device named "Back Camera", and
  // names the switching device otherwise.
  await expect(page.getByTestId('live-lens-warning')).toContainText('unproven');

  // The lens watch is running and has not seen a change.
  const log = page.getByTestId('live-session-log');
  await expect(log).toHaveAttribute('data-switch-count', '0');
  expect(Number(await log.getAttribute('data-entry-count'))).toBeGreaterThan(0);
  expect(Number(await log.getAttribute('data-orientation-events'))).toBeGreaterThan(0);
  expect(Number(await log.getAttribute('data-motion-events'))).toBeGreaterThan(0);
  // The heading came through Chromium's earth-referenced alpha, which is the
  // only route this browser has.
  await expect(log).toHaveAttribute('data-heading-route', 'absolute-alpha');
});

test('the field of view is the cropped one, and it says it is a guess', async ({ page }) => {
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-pose')).toBeVisible();

  // `object-fit: cover` of a 1200×900 frame into an 800×450 box keeps all the
  // width and 0.75 of the height, and the principal point is the box centre.
  expect(await poseNumber(page, 'data-visible-fraction-x')).toBeCloseTo(1, 9);
  expect(await poseNumber(page, 'data-visible-fraction-y')).toBeCloseTo(0.75, 9);
  expect(await poseNumber(page, 'data-principal-x-px')).toBeCloseTo(FRAME.widthPx / 2, 9);
  expect(await poseNumber(page, 'data-principal-y-px')).toBeCloseTo(FRAME.heightPx / 2, 9);

  // The field of view the pose is drawn with is the CROPPED one. The uncropped
  // vertical field would be 2·atan(0.5625) = 58.31°, which is what a naive
  // reading gives and what would stretch the overlay by a quarter.
  expect(await poseNumber(page, 'data-hfov-deg')).toBeCloseTo(VISIBLE_FOV.hFovDeg, 6);
  expect(await poseNumber(page, 'data-vfov-deg')).toBeCloseTo(VISIBLE_FOV.vFovDeg, 6);
  expect(await poseNumber(page, 'data-vfov-deg')).toBeLessThan((2 * Math.atan(0.5625)) / DEG - 10);

  // And it is labelled, because a browser stream's field is not the published one.
  const label = page.getByTestId('live-fov-label');
  await expect(label).toHaveAttribute('data-fov-source', 'spec-sheet-guess');
  await expect(label).toContainText('Uncalibrated FOV');
  await expect(label).toContainText('24 mm');
});

test('the heading is WMM2025-converted, labelled, and is the one that was injected', async ({
  page,
}) => {
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });

  // Before the fix arrives the bearing is magnetic and says so. Once the fix
  // lands the model converts it. Waiting on the converted state is the
  // assertion; the intermediate state is the same policy's step 3.
  const basis = page.getByTestId('live-heading-basis');
  await expect(basis).toHaveAttribute('data-basis', 'true-model', { timeout: 30_000 });
  // The tag on the status line names the basis; the caveat that explains it sits
  // in the "Why the labels might be off" disclosure, where six lines of prose do
  // not cover the horizon.
  await expect(basis).toContainText('true north (WMM)');
  const caveat = page.getByTestId('live-heading-caveat');
  await expect(caveat).toContainText('WMM-2025');
  await expect(caveat).toContainText('magnetic model');

  // The injected magnetic bearing was chosen so the conversion lands on 265.4°.
  expect(await poseNumber(page, 'data-heading-deg')).toBeCloseTo(TRUE_HEADING_DEG, 3);

  // Level and unrolled, to within one measurable bias — and that bias is the
  // proof that BOTH gravity routes reached the fusion.
  //
  // The orientation event gives gravity exactly: β = acos(−sin 0) = 90° and
  // γ = 0 give ĝ = (0, −1, 0), so pitch and roll are 0. The motion event gives
  // it with the injected user acceleration subtracted, as `device-samples.ts`
  // and `web-sensors.ts` both do, so its vector is ĝ + (1, 1, 1)·10⁻³ / 9.80665
  // and its pitch and roll are each atan(10⁻³ / 9.80665) = 0.005843°. The
  // smoothed pose is a weighted mean of the two, so it lands strictly between.
  //
  // A pose of exactly 0 here would mean the motion events contributed nothing —
  // which is what happens when `detectMotionGravityConvention` never settles the
  // sign, and is the state this assertion exists to catch.
  const motionBiasDeg = Math.atan(0.001 / 9.80665) / DEG;
  for (const axis of ['data-pitch-deg', 'data-roll-deg']) {
    const value = await poseNumber(page, axis);
    expect(value, axis).toBeGreaterThan(0);
    expect(value, axis).toBeLessThan(motionBiasDeg);
  }
  // Both convention and route are named on screen, so a field report can say
  // which arithmetic produced the pose.
  await expect(page.getByTestId('live-session-log')).toHaveAttribute(
    'data-heading-route',
    'absolute-alpha',
  );
});

test('the whole chain lands the Matterhorn where the closed form says it is', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });

  // Decision D7, checked rather than asserted: nothing leaves this origin.
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!/^(blob:)?http:\/\/localhost:\d+\//.test(url) && !url.startsWith('data:')) {
      foreign.push(url);
    }
  });

  const sceneState = page.getByTestId('live-scene-state');
  await expect(sceneState).toHaveAttribute('data-scene', 'ready', { timeout: SCENE_TIMEOUT_MS });

  // One sweep, the whole way round, so no heading can ask for terrain nobody
  // measured. `liveOverlayScene` would refuse a frame otherwise.
  await expect(sceneState).toHaveAttribute('data-sweep-span-deg', '360');
  await expect(sceneState).toHaveAttribute('data-rays-requested', '720');
  const withTerrain = Number(await sceneState.getAttribute('data-rays-with-terrain'));
  expect(withTerrain).toBe(720);
  // TODO.md asks for this figure. It is printed rather than asserted: a wall
  // time is a property of the machine, not of the code.
  console.log(
    `live 360° sweep: ${Number(await sceneState.getAttribute('data-sweep-ms')).toFixed(0)} ms ` +
      `for ${withTerrain} rays in the browser`,
  );

  // Labels are drawn by the same renderer the still app uses.
  const overlay = page.locator('[data-testid="live-overlay-svg"] svg');
  await expect(overlay).toHaveAttribute('viewBox', `0 0 ${FRAME.widthPx} ${FRAME.heightPx}`);
  await expect(
    page.locator('[data-testid="live-overlay-svg"] g.mf-horizon polyline').first(),
  ).toBeVisible();
  expect(Number(await page.getByTestId('live-labels').getAttribute('data-label-count'))).toBeGreaterThan(0);

  // The decisive assertion: one summit dot within 8 px of the hand-derived
  // position for the injected pose. The count is the peak dataset's business;
  // the position is the geometry's.
  const expected = expectedSummitPx(TRUE_HEADING_DEG);
  const dots = await summitDots(page);
  expect(dots.length).toBeGreaterThan(0);
  const near = dots.filter(
    (dot) =>
      Math.abs(dot.cx - expected.xPx) < TOLERANCE_PX &&
      Math.abs(dot.cy - expected.yPx) < TOLERANCE_PX,
  );
  expect(
    near.length,
    `no summit dot within ${TOLERANCE_PX} px of (${expected.xPx.toFixed(2)}, ` +
      `${expected.yPx.toFixed(2)}); dots were ${JSON.stringify(dots.slice(0, 12))}`,
  ).toBeGreaterThan(0);

  // The Matterhorn is named, not merely dotted.
  await expect(page.getByTestId('live-labels')).toContainText('Matterhorn');

  expect(foreign, 'the live screen must not call anything but its own origin').toEqual([]);
});

test('a 10° turn moves the labels by the pixels the projection says it should', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });

  const before = expectedSummitPx(TRUE_HEADING_DEG);
  const after = expectedSummitPx(TRUE_HEADING_DEG + 10);
  // A rectilinear frame is linear in the TANGENT of the off-axis angle, so a
  // 10° turn does not move a label by 10 × the centre scale. At this field of
  // view the closed form gives about −94 px, where 10° at the centre scale
  // would be about −93 px; the test asserts the tangent answer.
  const expectedShiftPx = after.xPx - before.xPx;
  expect(expectedShiftPx).toBeLessThan(-80);

  const findNear = (dots: { cx: number; cy: number }[], target: { xPx: number; yPx: number }) =>
    dots.find(
      (dot) =>
        Math.abs(dot.cx - target.xPx) < TOLERANCE_PX && Math.abs(dot.cy - target.yPx) < TOLERANCE_PX,
    );

  const firstDots = await summitDots(page);
  const firstHit = findNear(firstDots, before);
  expect(firstHit, 'the summit was not found before the turn').toBeDefined();
  if (firstHit === undefined) return;

  // Turn the phone 10° to the right. Only the injected bearing changes: the
  // scene is NOT rebuilt, which is the whole premise of `loop.ts`.
  const sweepMsBefore = await page.getByTestId('live-scene-state').getAttribute('data-sweep-ms');
  await pumpSet(
    page,
    eventAnglesFor(magneticBearingFor(TRUE_HEADING_DEG + 10, new Date()), 0),
  );
  await expect
    .poll(async () => poseNumber(page, 'data-heading-deg'), { timeout: 15_000 })
    .toBeCloseTo(TRUE_HEADING_DEG + 10, 2);

  const secondDots = await summitDots(page);
  const secondHit = findNear(secondDots, after);
  expect(
    secondHit,
    `after a 10° turn no summit dot sat within ${TOLERANCE_PX} px of ` +
      `(${after.xPx.toFixed(2)}, ${after.yPx.toFixed(2)}); dots were ` +
      JSON.stringify(secondDots.slice(0, 12)),
  ).toBeDefined();
  if (secondHit === undefined) return;

  // The measured shift matches the closed form, to the same tolerance.
  expect(secondHit.cx - firstHit.cx).toBeCloseTo(expectedShiftPx, -1);
  expect(Math.abs(secondHit.cx - firstHit.cx - expectedShiftPx)).toBeLessThan(TOLERANCE_PX);

  // And the terrain was not swept again: one sweep, re-projected.
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute(
    'data-sweep-ms',
    sweepMsBefore ?? '',
  );
});

test('a lens the camera changes on its own is flagged', async ({ page }) => {
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-session-log')).toHaveAttribute('data-switch-count', '0');

  // iOS 18 changes rear lens inside a live stream with no event, and what moves
  // is the frame the same track delivers. `applyConstraints` on Chromium's fake
  // device reproduces exactly that: same `deviceId`, different width and height.
  // The track is reached through the video element's own `srcObject`, so this
  // needs no seam in the application code.
  await page.getByTestId('live-video').evaluate(async (node) => {
    const stream = (node as HTMLVideoElement).srcObject as MediaStream;
    const track = stream.getVideoTracks()[0];
    if (track === undefined) throw new Error('no video track on the element');
    await track.applyConstraints({ width: { exact: 640 }, height: { exact: 480 } });
  });

  // The once-a-second poll notices, and the warning names what the user saw.
  const warning = page.getByTestId('live-lens-switch');
  await expect(warning).toBeVisible({ timeout: 10_000 });
  await expect(warning).toContainText('1200×900');
  await expect(warning).toContainText('640×480');
  await expect(warning).toContainText('drag them back into line');
  await expect(page.getByTestId('live-session-log')).toHaveAttribute('data-switch-count', '1');
});

test('the uncertainty band says what it is, and the drag moves the labels (D9)', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });

  // The band names a direction rather than an identification, and says the
  // total is a floor while the field of view is uncalibrated.
  const band = page.getByTestId('live-uncertainty');
  await expect(band).toContainText('which way a summit lies');
  await expect(band).toContainText('minimum');
  await expect(page.getByTestId('live-band')).toBeVisible();

  const before = await summitDots(page);
  const dot = before.find((entry) => Math.abs(entry.cx - expectedSummitPx(TRUE_HEADING_DEG).xPx) < TOLERANCE_PX);
  expect(dot).toBeDefined();
  if (dot === undefined) return;

  // Push the overlay 100 px to the right. `drag-trim.ts` inverts the projection
  // rather than dividing the field of view by the frame width, so the angle is
  // atan((100/800) · 2·tan(hFOV/2)) = atan(0.125 · 1.5) = 10.6199°, subtracted
  // from the heading — the overlay follows the finger.
  const expectedTrimDeg = -Math.atan(0.125 * 1.5) / DEG;
  const drag = page.getByTestId('live-drag');
  await drag.hover({ position: { x: 300, y: 225 } });
  await page.mouse.down();
  await page.mouse.move(400, 225, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(async () => Number(await page.getByTestId('live-trim').getAttribute('data-heading-deg')))
    .toBeCloseTo(expectedTrimDeg, 3);

  // The labels moved with it: 100 px right, to within a pixel.
  const after = await summitDots(page);
  const moved = after.find((entry) => Math.abs(entry.cx - (dot.cx + 100)) < 2);
  expect(
    moved,
    `no dot near ${(dot.cx + 100).toFixed(1)}; dots were ${JSON.stringify(after.slice(0, 12))}`,
  ).toBeDefined();

  // And it can be put back.
  await page.getByTestId('live-reset-trim').click();
  await expect(page.getByTestId('live-trim')).toHaveAttribute('data-heading-deg', '0');
});

test('the Sun or the Moon is drawn where src/core/celestial says it is', async ({ page }) => {
  // The bench-test instrument. Whichever body is higher right now is aimed at,
  // and the disc must land at frame centre with the radius the projection gives
  // for its true angular size. On the phone the gap between this disc and the
  // real one is a direct reading of the heading, pitch and field-of-view error.
  const now = new Date();
  const observer = { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M };
  const sun = sunPosition(now, observer, { refraction: true });
  const moon = moonPosition(now, observer, { refraction: true });
  const target = sun.altitudeDeg >= moon.altitudeDeg ? sun : moon;
  const body = target === sun ? 'sun' : 'moon';

  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-marks')).toBeVisible();

  if (target.altitudeDeg < 5) {
    // Both below the horizon or grazing it. Nothing to line up against, and the
    // screen must say so rather than drawing a disc over the ground.
    await expect(page.getByTestId(`live-mark-note-${body}`)).toContainText(/below the horizon|Turn that way/);
    console.log(
      `both bodies low at this instant (sun ${sun.altitudeDeg.toFixed(1)}°, ` +
        `moon ${moon.altitudeDeg.toFixed(1)}°); asserted the refusal instead of a disc`,
    );
    return;
  }

  // Aim the camera at it. The injected bearing is magnetic, so the model's
  // declination is subtracted, exactly as for a summit.
  await pumpSet(
    page,
    eventAnglesFor(magneticBearingFor(target.azimuthDeg, now), target.altitudeDeg),
  );
  const disc = page.getByTestId(`live-mark-${body}`);
  await expect(disc).toBeVisible({ timeout: 15_000 });

  // Wait for the pose to SETTLE before reading it. `fuseSensorPose` smooths
  // over a 1.5 s window with a 400 ms time constant, so the first frames after
  // a change of aim are a weighted blend of the old pose and the new one — the
  // same lag a phone shows when it is swung to a new bearing. Reading during it
  // would be reading a pose that is on its way somewhere.
  await expect
    .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 15_000 })
    .toBeCloseTo(target.altitudeDeg, 2);

  // Read the disc and the pose from the SAME render. Both bodies move — the
  // Moon's azimuth by about 0.25° a minute, dominated by the Earth's rotation
  // rather than by its orbit — so asserting that the disc sits at frame centre
  // would be asserting that no time passed between aiming and drawing. What is
  // timeless is the projection: the disc must sit where the pose puts the
  // azimuth and altitude it reports.
  const drawn = await disc.evaluate((node) => ({
    cx: Number(node.getAttribute('cx')),
    cy: Number(node.getAttribute('cy')),
    radiusPx: Number(node.getAttribute('data-radius-px')),
    azimuthDeg: Number(node.getAttribute('data-azimuth-deg')),
    altitudeDeg: Number(node.getAttribute('data-altitude-deg')),
  }));
  const drawnPose = {
    headingDeg: await poseNumber(page, 'data-heading-deg'),
    pitchDeg: await poseNumber(page, 'data-pitch-deg'),
    rollDeg: await poseNumber(page, 'data-roll-deg'),
    hFovDeg: await poseNumber(page, 'data-hfov-deg'),
    vFovDeg: await poseNumber(page, 'data-vfov-deg'),
  };

  const expectedPx = projectIndependently(drawnPose, drawn.azimuthDeg, drawn.altitudeDeg);
  expect(drawn.cx).toBeCloseTo(expectedPx.xPx, 3);
  expect(drawn.cy).toBeCloseTo(expectedPx.yPx, 3);

  // And it is near the centre, because that is where the camera was aimed. The
  // few pixels of slack are the body's own motion between the aim and the draw:
  // the Moon's azimuth moves about 0.25° a minute, dominated by the Earth's
  // rotation, which is around 2 px a minute at this field of view.
  expect(Math.hypot(drawn.cx - FRAME.widthPx / 2, drawn.cy - FRAME.heightPx / 2)).toBeLessThan(15);

  // The app's own ephemeris agrees with this test's, within the motion of the
  // few seconds between the two calls.
  const nowAgain = new Date();
  const current = body === 'sun'
    ? sunPosition(nowAgain, observer, { refraction: true })
    : moonPosition(nowAgain, observer, { refraction: true });
  expect(drawn.azimuthDeg).toBeCloseTo(current.azimuthDeg, 0);
  expect(drawn.altitudeDeg).toBeCloseTo(current.altitudeDeg, 0);

  // And the disc is the size the body actually is, through the projection:
  //   radiusPx = (heightPx / 2) · tan(r) / tan(vFOV / 2)
  const expectedRadiusPx =
    ((FRAME.heightPx / 2) * Math.tan(current.angularRadiusDeg * DEG)) /
    Math.tan((VISIBLE_FOV.vFovDeg * DEG) / 2);
  expect(drawn.radiusPx).toBeCloseTo(expectedRadiusPx, 1);
  expect(drawn.radiusPx).toBeGreaterThan(2);
});

test('a position with no terrain names the missing tile instead of drawing nothing', async ({
  page,
  context,
}) => {
  // Chamonix sits in N45E006, which this repository does not serve. An empty
  // overlay would read as "no peaks are visible from here", which is a claim.
  await context.setGeolocation({ latitude: CHAMONIX.lat, longitude: CHAMONIX.lon });
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });

  const refusal = page.getByTestId('live-refusal');
  await expect(refusal).toHaveAttribute('data-refusal-code', 'no-terrain', { timeout: 60_000 });
  await expect(page.getByTestId('live-refusal-headline')).toHaveText('No terrain for this location');
  // The specific, actionable message from the overlay builder, verbatim.
  const detail = page.getByTestId('live-scene-error');
  await expect(detail).toContainText('N45E006');
  await expect(detail).toContainText('no peaks are visible');
  // And nothing was drawn.
  await expect(page.locator('[data-testid="live-overlay-svg"] g.mf-summits circle')).toHaveCount(0);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE HOME SESSION
 * ══════════════════════════════════════════════════════════════════════════
 * `live.html?session=home` walks a person through every pose in `POSE_LABELS`
 * and produces a file they share themselves. Three things are provable without a
 * phone, and all three are checked below:
 *
 *   the recording the screen builds passes the strict parser, and carries no
 *   coordinate, no epoch and no wall clock
 *   the Share button reaches the platform's share sheet with the JSON as a FILE
 *   nothing the page does puts the recording on the network
 *
 * What it cannot prove is what a real phone's sensors report, which is the whole
 * reason the session exists. The events here are the ones this suite dispatches.
 *
 * ── HOW THE SHARE SHEET IS STUBBED ─────────────────────────────────────────
 * Headless Chromium has no `navigator.share`. It is installed by an init script
 * that keeps the file's name, type and TEXT on `window`, so the assertions run
 * against the exact bytes the share sheet was handed rather than against the
 * page's own idea of them.
 */

interface SharedRecordingCapture {
  readonly name: string;
  readonly type: string;
  readonly text: string;
}

/** Install a share sheet that records what it was given. */
async function installShareStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { shared: undefined as unknown, calls: 0 };
    (window as unknown as Record<string, unknown>).__mfShare = store;
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: { files?: File[] }) => Array.isArray(data.files) && data.files.length > 0,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        store.calls += 1;
        const file = data.files?.[0];
        if (file === undefined) throw new Error('share was called with no file');
        store.shared = { name: file.name, type: file.type, text: await file.text() };
      },
    });
  });
}

async function sharedRecording(page: Page): Promise<SharedRecordingCapture | undefined> {
  return page.evaluate(
    () =>
      (window as unknown as { __mfShare: { shared: SharedRecordingCapture | undefined } }).__mfShare
        .shared,
  );
}

/** Open the guided session and get as far as the first step being offered. */
async function startHomeSession(page: Page): Promise<void> {
  await installShareStub(page);
  await installSensorPump(page);
  await page.goto('/live.html?session=home');
  await expect(page.getByTestId('home-session')).toBeVisible();

  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');
  await pumpSet(page, eventAnglesFor(magneticBearingFor(TRUE_HEADING_DEG, new Date()), 0));

  // The Start button waits for the position fix, because the Sun's bearing is
  // worked out from it once and the file is worthless without one.
  await expect(page.getByTestId('home-session-start')).toBeEnabled({ timeout: 30_000 });
}

/**
 * Tap the picture at one point.
 *
 * A real `mouse.click` would land on whichever element is topmost, and the
 * panel's own instruction covers the upper half of a 450 px viewport. So the
 * `pointerup` is constructed and dispatched on the tap surface itself, the same
 * route this file already uses for the sensor events, and for the same reason:
 * the handler is a function of the event object, so a constructed event
 * exercises the code a finger would.
 */
async function tapAt(page: Page, xPx: number, yPx: number): Promise<void> {
  await page.getByTestId('home-session-tap-layer').evaluate(
    (node, point) => {
      node.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: point.xPx,
          clientY: point.yPx,
          pointerId: 1,
          pointerType: 'touch',
        }),
      );
    },
    { xPx, yPx },
  );
}

/** Work through the six drag attempts the session ends with. */
async function walkDragTrials(page: Page): Promise<void> {
  const session = page.getByTestId('home-session');
  await expect(session).toHaveAttribute('data-phase', 'drag-trials', { timeout: 15_000 });
  const progress = page.getByTestId('home-session-trial-progress');
  for (let index = 0; index < 6; index += 1) {
    await expect(progress).toHaveAttribute('data-trial-index', String(index));
    // A different offset per attempt, so the scatter the panel reports is not
    // zero by construction.
    await dragPicture(page, 20 + (index % 3) * 6, -8 + (index % 3) * 2);
  }
}

/** Click through every step, moving the phone so the poses are not all identical. */
async function walkEveryStep(page: Page): Promise<void> {
  const session = page.getByTestId('home-session');
  for (let index = 0; index < POSE_LABELS.length; index += 1) {
    await expect(session).toHaveAttribute('data-step-index', String(index));
    await expect(session).toHaveAttribute('data-step-pose', POSE_LABELS[index] ?? '');
    // A different attitude per step, so the segments are not copies of each
    // other. The values are arbitrary: what a real phone reports is the
    // question the session asks, and no dispatched event can answer it.
    await pumpSet(page, { alpha: index * 17, beta: 60 + index * 5, gamma: index * 3 - 20 });
    await page.getByTestId('home-session-next').click();
  }
  await walkDragTrials(page);
  await expect(session).toHaveAttribute('data-phase', 'finished', { timeout: 30_000 });
}

test('the home session says what it records before it records anything', async ({ page }) => {
  await installShareStub(page);
  await page.goto('/live.html?session=home');

  const privacy = page.getByTestId('home-session-privacy');
  await expect(privacy).toBeVisible();
  // The four facts, in plain words: what is recorded, what is not, the one
  // number worked out from the fix, and where the file goes.
  await expect(privacy).toContainText('does not record where you are');
  await expect(privacy).toContainText('No photograph and no video is saved');
  await expect(privacy).toContainText('thrown away');
  await expect(privacy).toContainText('Nothing is uploaded');
  await expect(privacy).toContainText('goes only where you send it');

  // And it is shown BEFORE the first step, with recording not yet possible.
  await expect(page.getByTestId('home-session')).toHaveAttribute('data-phase', 'explaining');
  await expect(page.getByTestId('home-session-start')).toBeDisabled();
  await expect(page.getByTestId('home-session-not-ready')).toBeVisible();
});

test('the ordinary live screen has no home session on it', async ({ page }) => {
  await page.goto('/live.html');
  await expect(page.getByTestId('live-title')).toBeVisible();
  await expect(page.getByTestId('home-session')).toHaveCount(0);
});

test('a step runs out on its own, so a phone left on a table gets through it', async ({
  page,
}) => {
  // The countdown is what makes "hold still" actionable, and it has to move the
  // session on by itself: the first four steps are a phone lying on a table,
  // where nobody is there to tap anything. The first step is four seconds long.
  await startHomeSession(page);
  await page.getByTestId('home-session-start').click();

  const session = page.getByTestId('home-session');
  await expect(session).toHaveAttribute('data-step-index', '0');
  const remaining = page.getByTestId('home-session-remaining');
  const first = Number(await remaining.getAttribute('data-remaining-ms'));
  expect(first).toBeLessThanOrEqual(4000);

  // It counts down, without a tap.
  await expect
    .poll(async () => Number(await remaining.getAttribute('data-remaining-ms')), {
      timeout: 5000,
    })
    .toBeLessThan(first - 500);

  // And then it moves on by itself.
  await expect(session).toHaveAttribute('data-step-index', '1', { timeout: 10_000 });
  await expect(session).toHaveAttribute('data-step-pose', POSE_LABELS[1] ?? '');
});

test('the session walks every pose and builds a recording the parser accepts', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);

  // Every request the page makes, with its body, so the recording can be looked
  // for on the network rather than assumed absent.
  const requests: { url: string; method: string; body: string }[] = [];
  page.on('request', (request) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData() ?? '',
    });
  });

  await startHomeSession(page);
  await page.getByTestId('home-session-start').click();
  await walkEveryStep(page);

  const session = page.getByTestId('home-session');
  // The screen's own verdict on the file it built, from the same strict parser.
  const parse = page.getByTestId('home-session-parse');
  await expect(parse).toHaveAttribute('data-valid', 'true');
  await expect(parse).toHaveAttribute('data-problem-count', '0');
  await expect(parse).toContainText('holds no location and no clock time');
  expect(Number(await session.getAttribute('data-event-count'))).toBeGreaterThan(0);

  // The analysis ran on the device. Its verdicts are expected to be weak here —
  // the segments are seconds long and the events are dispatched — so what is
  // asserted is that every question was answered, not which way.
  const verdicts = page.locator('[data-testid="home-session-analysis"] li');
  expect(await verdicts.count()).toBeGreaterThan(10);
  await expect(page.locator('li[data-verdict-id="compass-reference"]')).toBeVisible();

  // Share it. The stub takes the file and keeps the bytes.
  await page.getByTestId('home-session-share').click();
  await expect(page.getByTestId('home-session-share-result')).toHaveAttribute(
    'data-outcome',
    'shared',
  );
  await expect(page.getByTestId('home-session-share-result')).toContainText('Nothing was uploaded');

  const captured = await sharedRecording(page);
  expect(captured, 'the share sheet was handed no file').toBeDefined();
  if (captured === undefined) return;
  expect(captured.name).toBe('mountain-finder-home-session.json');
  expect(captured.type).toBe('application/json');

  // ── the decisive assertions, on the shared bytes themselves ──────────────
  const parsed = parseRecording(JSON.parse(captured.text) as unknown);
  expect(parsed.ok ? [] : parsed.problems).toEqual([]);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.value.segments.map((segment) => segment.pose)).toEqual([...POSE_LABELS]);
  expect(parsed.value.knownBearing.kind).toBe('sun-azimuth');
  expect(parsed.value.device).toContain('Mozilla');

  // No coordinate, no epoch, no wall clock — the parser's own scan, plus a
  // direct look for the numbers Playwright injected as the position.
  expect(findForbiddenContent(JSON.parse(captured.text) as unknown)).toEqual([]);
  for (const banned of ['latitude', 'longitude', 'coords', 'geolocation', 'altitudeAccuracy']) {
    expect(captured.text, banned).not.toContain(banned);
  }
  expect(captured.text).not.toContain(GORNERGRAT.lat.toFixed(4));
  expect(captured.text).not.toContain(GORNERGRAT.lon.toFixed(4));
  // The fix's own digits, to two places, are enough to place a viewpoint.
  expect(captured.text).not.toContain('45.98');
  expect(captured.text).not.toContain('7.78');
  const numbers = [...captured.text.matchAll(/-?\d+(\.\d+)?/g)].map((match) =>
    Math.abs(Number(match[0])),
  );
  expect(Math.max(...numbers)).toBeLessThan(EPOCH_FLOOR);

  // ── and nothing carried it off the phone ────────────────────────────────
  const carriers = requests.filter(
    (request) =>
      request.body.includes('home-session-recording') ||
      request.body.includes('ms-since-recording-start'),
  );
  expect(carriers, 'a request carried the recording').toEqual([]);
  const foreign = requests.filter(
    (request) =>
      !/^(blob:)?http:\/\/localhost:\d+\//.test(request.url) && !request.url.startsWith('data:'),
  );
  expect(foreign.map((request) => request.url), 'the session called a foreign origin').toEqual([]);
  // Every request was a read of this origin's own files.
  expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);
});

test('a tap during the sun step measures the field of view and the aim', async ({ page }) => {
  // The step's taps are measured against the Sun's own disc and never against a
  // summit dot, so this test needs the Sun up. The page's clock is fixed at
  // 2026-04-02 09:00 UTC, when the Sun is 37.4° up at azimuth 129.3° over
  // Gornergrat and the Moon is 40° below the horizon, so the disc is the only
  // mark a tap can be about.
  //
  // A KNOWN camera error is injected and the screen has to recover it. Each tap
  // is placed at
  //
  //     tapped = principal + s · (drawn − principal) + d,   s = 1.1, d = (10, −6)
  //
  // which is exactly what a camera 1.1× longer than the guess, aimed a little
  // off, would have put there. So the fit must come back with scale 1.1, a
  // visible field of 2·atan(400 / (1.1 · 400/0.75)) = 61.9275°, and the two
  // offsets −atan(10/586.667) and +atan(−6/586.667).
  test.setTimeout(SCENE_TIMEOUT_MS + 180_000);
  const INJECTED_SCALE = 1.1;
  const INJECTED_SHIFT_PX = { xPx: 10, yPx: -6 };
  const FIXED_TIME = new Date('2026-04-02T09:00:00Z');
  const observer = { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M };
  const sun = sunPosition(FIXED_TIME, observer, { refraction: true });
  expect(sun.altitudeDeg).toBeGreaterThan(30);
  expect(moonPosition(FIXED_TIME, observer, { refraction: true }).altitudeDeg).toBeLessThan(0);

  await page.clock.setFixedTime(FIXED_TIME);
  await startHomeSession(page);
  await page.getByTestId('home-session-start').click();
  for (let index = 0; index < POSE_LABELS.length - 1; index += 1) {
    await page.getByTestId('home-session-next').click();
  }

  const session = page.getByTestId('home-session');
  await expect(session).toHaveAttribute('data-step-pose', 'sun-capture');
  await expect(page.getByTestId('home-session-instruction')).toContainText('LEFT');
  await expect(page.getByTestId('home-session-instruction')).toContainText('RIGHT');

  // The tap surface covers the whole picture, so a finger anywhere on it is a
  // tap rather than a nudge of the labels. The panel's own buttons stay above
  // it, which the previous test proves by clicking Finish through it.
  const layer = page.getByTestId('home-session-tap-layer');
  await expect(layer).toBeVisible();
  const box = await layer.boundingBox();
  expect(box?.width).toBe(FRAME.widthPx);
  expect(box?.height).toBe(FRAME.heightPx);
  await expect(page.getByTestId('home-session-taps')).toHaveAttribute('data-tap-count', '0');

  const injectedTap = (dot: { cx: number; cy: number }): { xPx: number; yPx: number } => ({
    xPx: FRAME.widthPx / 2 + INJECTED_SCALE * (dot.cx - FRAME.widthPx / 2) + INJECTED_SHIFT_PX.xPx,
    yPx:
      FRAME.heightPx / 2 + INJECTED_SCALE * (dot.cy - FRAME.heightPx / 2) + INJECTED_SHIFT_PX.yPx,
  });

  /**
   * Aim so the Sun sits `offAxisDeg` right of centre, wait for the pose to
   * settle, and return where its disc is drawn. 20° either side puts the two
   * discs about 390 px apart, well clear of the fit's spread floor.
   */
  const discWithSunAt = async (offAxisDeg: number): Promise<{ cx: number; cy: number }> => {
    const headingDeg = sun.azimuthDeg - offAxisDeg;
    await pumpSet(
      page,
      eventAnglesFor(magneticBearingFor(headingDeg, FIXED_TIME), sun.altitudeDeg),
    );
    await expect
      .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 15_000 })
      .toBeCloseTo(sun.altitudeDeg, 2);
    await expect
      .poll(async () => {
        const drawn = await poseNumber(page, 'data-heading-deg');
        return Math.abs(((drawn - headingDeg + 540) % 360) - 180);
      }, { timeout: 15_000 })
      .toBeLessThan(0.05);
    const disc = page.getByTestId('live-mark-sun');
    await expect(disc).toBeVisible();
    return disc.evaluate((node) => ({
      cx: Number(node.getAttribute('cx')),
      cy: Number(node.getAttribute('cy')),
    }));
  };

  const left = await discWithSunAt(-20);
  expect(left.cx).toBeLessThan(FRAME.widthPx / 2 - MIN_SPREAD_PX);
  const firstTap = injectedTap(left);
  await tapAt(page, firstTap.xPx, firstTap.yPx);
  await expect(page.getByTestId('home-session-taps')).toHaveAttribute('data-tap-count', '1');
  // One tap cannot tell a wrong lens width from a wrong direction, and the
  // screen says exactly that instead of producing a field of view.
  const refusal = page.getByTestId('home-session-fit-refusal');
  await expect(refusal).toHaveAttribute('data-refusal', 'too-few-taps');
  await expect(refusal).toContainText('different parts of the picture');

  const right = await discWithSunAt(20);
  expect(right.cx).toBeGreaterThan(FRAME.widthPx / 2 + MIN_SPREAD_PX);
  const secondTap = injectedTap(right);
  await tapAt(page, secondTap.xPx, secondTap.yPx);
  await expect(page.getByTestId('home-session-taps')).toHaveAttribute('data-tap-count', '2');

  const fit = page.getByTestId('home-session-fit');
  await expect(fit).toBeVisible();
  const read = async (attribute: string): Promise<number> => Number(await fit.getAttribute(attribute));
  // The injected camera, recovered. The tolerances allow for the disc moving by
  // a fraction of a pixel between the read above and each tap: the fused pose
  // is still settling by thousandths of a degree.
  expect(await read('data-scale')).toBeCloseTo(INJECTED_SCALE, 2);
  const assumedFocalPx = FRAME.widthPx / 2 / Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2);
  const fittedFocalPx = INJECTED_SCALE * assumedFocalPx;
  expect(await read('data-visible-hfov-deg')).toBeCloseTo(
    (2 * Math.atan(FRAME.widthPx / 2 / fittedFocalPx)) / DEG,
    1,
  );
  expect(await read('data-heading-offset-deg')).toBeCloseTo(
    -Math.atan(INJECTED_SHIFT_PX.xPx / fittedFocalPx) / DEG,
    1,
  );
  expect(await read('data-pitch-offset-deg')).toBeCloseTo(
    Math.atan(INJECTED_SHIFT_PX.yPx / fittedFocalPx) / DEG,
    1,
  );
  expect(await read('data-residual-px')).toBeLessThan(2);

  // Saving it changes what the overlay is drawn with, and the label stops
  // calling the field of view a guess.
  const beforeHFov = await poseNumber(page, 'data-hfov-deg');
  expect(beforeHFov).toBeCloseTo(VISIBLE_FOV.hFovDeg, 3);
  const fittedVisibleHFov = await read('data-visible-hfov-deg');
  const fittedHeadingOffset = await read('data-heading-offset-deg');
  await page.getByTestId('home-session-use-fit').click();

  const label = page.getByTestId('live-fov-label');
  await expect(label).toHaveAttribute('data-fov-source', 'calibrated', { timeout: 15_000 });
  await expect(label).toContainText('taps on');
  await expect
    .poll(async () => poseNumber(page, 'data-hfov-deg'), { timeout: 15_000 })
    .toBeCloseTo(fittedVisibleHFov, 1);
  // The two offsets land in the nudge, where the user can see and undo them,
  // rather than being applied behind their back.
  expect(
    Number(await page.getByTestId('live-trim').getAttribute('data-heading-deg')),
  ).toBeCloseTo(fittedHeadingOffset, 6);

  // A tap far from the disc is still counted. The gap between the mark and the
  // real thing is what the tilt zero point is read from, so refusing a wide gap
  // would let the sensor set a ceiling on its own error. Last in the test
  // because it adds a third tap, which changes the fit already read above.
  const farCorner = right.cx > FRAME.widthPx / 2 ? { xPx: 10, yPx: FRAME.heightPx - 10 } : {
    xPx: FRAME.widthPx - 10,
    yPx: FRAME.heightPx - 10,
  };
  await tapAt(page, farCorner.xPx, farCorner.yPx);
  await expect(page.getByTestId('home-session-taps')).toHaveAttribute('data-tap-count', '3');
  await expect(page.getByTestId('home-session-tap-note')).toHaveCount(0);
});

test('the observer stands on the map’s ground, not on the GPS altitude', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });

  // Playwright's fix carries no altitude at all, so the terrain is the only
  // source there is — and that is what the screen has to say it used.
  const note = page.getByTestId('live-ground-height');
  await expect(note).toHaveAttribute('data-ground-source', 'terrain');
  await expect(note).toContainText("from the map's own terrain");

  // The DEM reads 3087.98 m at the Gornergrat platform, whose published height
  // is 3089 m (IMPLEMENTATION.md). The eye is 1.6 m above whatever it reads, so
  // the note must show a ground height within a few metres of the platform and
  // an eye height 1.6 m above it.
  const text = (await note.textContent()) ?? '';
  const matched = /([\d.]+) m of ground plus ([\d.]+) m of eye height, so ([\d.]+) m/.exec(text);
  expect(matched, `the height note did not name its two parts: ${text}`).not.toBeNull();
  if (matched === null) return;
  const ground = Number(matched[1]);
  const eye = Number(matched[2]);
  const total = Number(matched[3]);
  expect(ground).toBeGreaterThan(3070);
  expect(ground).toBeLessThan(3100);
  expect(eye).toBeCloseTo(1.6, 2);
  expect(total).toBeCloseTo(ground + eye, 1);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIELD SITE'S OWN SWEEP RADIUS
 * ══════════════════════════════════════════════════════════════════════════
 * At a viewpoint inside a served site mosaic the live sweep must reach the
 * radius that mosaic was cut for, not the app's 30 km default. The mosaic under
 * test is the REAL packaged one, `data/sites/bogus-basin/`, served here the way
 * `npm run package:deploy` publishes it: its grid listed in the same index as
 * the whole tiles, at `terrain/sites/<id>/<file>`. The dev server publishes the
 * four Idaho tiles it holds, so `selectTerrainGrid` is choosing between a whole
 * 1° tile and the mosaic exactly as it does on the deployment.
 *
 * ── WHY THIS MATTERS ENOUGH TO PAY FOR THE SWEEP ───────────────────────────
 * 63 of the 104 summits within 60 km of this viewpoint lie beyond 30 km, and
 * the ten highest by apparent height are all 34–58 km out. At the default range
 * every one of them comes back `unmeasured`, so the screen draws none of them.
 * The assertion below is a name on screen that can only be there because the
 * rays reached it.
 */

const BOGUS_BASIN_TARGETS = ['Trinity Mountain', 'Freeman Peak', 'Pilot Peak'] as const;

/**
 * The magnetic bearing to inject at an arbitrary site.
 *
 * `magneticBearingFor` above evaluates WMM2025 at Gornergrat, where the
 * declination is about +2.5°; Idaho's is about +11.7°, so a Bogus Basin heading
 * has to be converted at Bogus Basin. `heightM: 0` for the same reason as there:
 * Playwright's fix carries no altitude, so the screen evaluates the model at sea
 * level too.
 */
function magneticBearingAt(
  site: { lat: number; lon: number },
  trueHeadingDeg: number,
  when: Date,
): number {
  const field = geomagneticField(
    { latitudeDeg: site.lat, longitudeDeg: site.lon, heightM: 0 },
    when,
  );
  return (((trueHeadingDeg - field.declinationDeg) % 360) + 360) % 360;
}

/** Where the built site package lives, and where it is published from. */
const SITE_ID = 'bogus-basin';

interface SiteTarget {
  readonly name: string;
  readonly bearingDeg: number;
  readonly rangeKm: number;
}

/**
 * The three far summits, read out of the committed peak region and measured
 * with this file's own geodesy.
 *
 * Their bearings and ranges are derived here rather than written down, so the
 * heading the phone is pointed along comes from the same coordinates the app
 * labels — and a peak that moved in a later Overture release moves this test
 * with it instead of silently failing it.
 */
function bogusBasinTargets(observer: { lat: number; lon: number }): readonly SiteTarget[] {
  const cellDir = resolve(ROOT, 'fixtures/peaks/regions/idaho-bogus-basin/cells');
  const found: SiteTarget[] = [];
  for (const file of readdirSync(cellDir)) {
    if (!file.endsWith('.json')) continue;
    const cell = JSON.parse(readFileSync(resolve(cellDir, file), 'utf8')) as {
      peaks: { name: string; lat: number; lon: number }[];
    };
    for (const peak of cell.peaks) {
      if (!(BOGUS_BASIN_TARGETS as readonly string[]).includes(peak.name)) continue;
      found.push({
        name: peak.name,
        bearingDeg: bearingDeg(observer, peak),
        rangeKm: rangeM(observer, peak) / 1000,
      });
    }
  }
  return found.sort((left, right) => right.rangeKm - left.rangeKm);
}

/**
 * Publish the built site package the way `package:deploy` does, over the dev
 * server's own index.
 *
 * The dev terrain plugin serves whole tiles and the committed case windows and
 * knows nothing of `data/sites/`, so the index is read from it and the site's
 * one grid is appended at the published path. Only those two URLs are
 * intercepted; every tile request still goes to the dev server.
 */
async function serveBogusBasinPackage(page: Page): Promise<TerrainManifest> {
  const packageDir = resolve(ROOT, SITE_PACKAGE_DIR, SITE_ID);
  const sitePath = resolve(packageDir, 'terrain/manifest.json');
  const siteManifest = parseTerrainManifest(
    JSON.parse(readFileSync(sitePath, 'utf8')) as unknown,
    sitePath,
  );
  const grid = siteManifest.grids[0];
  expect(grid, `${SITE_PACKAGE_DIR}/${SITE_ID}/ holds no built terrain package`).toBeDefined();
  if (grid === undefined) throw new Error('no site grid');
  const samplesPath = resolve(packageDir, 'terrain', grid.url);
  const publishedUrl = `sites/${SITE_ID}/${grid.url.split('/').pop() ?? ''}`;

  // Read the dev server's own index BEFORE the route is installed. `page.request`
  // does not go through `page.route`, but reading it first removes the question.
  const devIndex = await page.request.get('/terrain/manifest.json');
  expect(devIndex.status()).toBe(200);
  const served: TerrainManifest = {
    ...parseTerrainManifest((await devIndex.json()) as unknown, 'dev index'),
    grids: [
      ...parseTerrainManifest((await devIndex.json()) as unknown, 'dev index').grids,
      { ...grid, url: publishedUrl },
    ],
  };

  await page.route(
    (url) =>
      url.pathname === '/terrain/manifest.json' || url.pathname === `/terrain/${publishedUrl}`,
    async (route) => {
      if (new URL(route.request().url()).pathname === '/terrain/manifest.json') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify(served),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/octet-stream',
        path: samplesPath,
      });
    },
  );
  return served;
}

test('a viewpoint inside the Bogus Basin mosaic sweeps the site’s 60 km, and labels a summit beyond 30 km', async ({
  page,
  context,
}) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 240_000);

  const definitionPath = resolve(ROOT, SITE_DEFINITION_DIR, `${SITE_ID}.json`);
  const site = parseSiteDefinition(
    JSON.parse(readFileSync(definitionPath, 'utf8')) as unknown,
    definitionPath,
  );
  expect(site.sweepRadiusKm).toBe(60);
  const targets = bogusBasinTargets(site.observer);
  expect(targets.length, 'the committed peak region names none of the three summits').toBe(3);
  for (const target of targets) expect(target.rangeKm).toBeGreaterThan(30);

  await installSensorPump(page);
  await context.setGeolocation({
    latitude: site.observer.lat,
    longitude: site.observer.lon,
  });
  await serveBogusBasinPackage(page);

  await page.goto('/live.html');
  await page.getByTestId('live-start').click();
  await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');
  const first = targets[0];
  if (first === undefined) return;
  await pumpSet(
    page,
    eventAnglesFor(magneticBearingAt(site.observer, first.bearingDeg, new Date()), 0),
  );

  const sceneState = page.getByTestId('live-scene-state');
  await expect(sceneState).toHaveAttribute('data-scene', 'ready', { timeout: SCENE_TIMEOUT_MS });

  // The decisive number: the sweep ran at the site's radius, not the default.
  await expect(sceneState).toHaveAttribute('data-max-range-km', String(site.sweepRadiusKm));
  await expect(page.getByTestId('live-sweep-range')).toHaveAttribute(
    'data-max-range-km',
    String(site.sweepRadiusKm),
  );
  await expect(page.getByTestId('live-sweep-range')).toContainText(
    `measured out to ${site.sweepRadiusKm} km`,
  );

  // Every ray carried terrain: the mosaic covers its own 60 km, so a range this
  // wide is measured rather than claimed.
  await expect(sceneState).toHaveAttribute('data-rays-requested', '720');
  await expect(sceneState).toHaveAttribute('data-rays-with-terrain', '720');
  console.log(
    `live 360° sweep at ${await sceneState.getAttribute('data-max-range-km')} km: ` +
      `${Number(await sceneState.getAttribute('data-sweep-ms')).toFixed(0)} ms ` +
      'for 720 rays in the browser',
  );

  // A summit beyond the default range, drawn, at a heading facing it. At 30 km
  // all three are `unmeasured` and none of these names can appear.
  const drawn: string[] = [];
  for (const target of targets) {
    await pumpSet(
      page,
      eventAnglesFor(magneticBearingAt(site.observer, target.bearingDeg, new Date()), 0),
    );
    await expect
      .poll(async () => poseNumber(page, 'data-heading-deg'), { timeout: 20_000 })
      .toBeCloseTo(target.bearingDeg, 1);
    const labels = (await page.getByTestId('live-labels').textContent()) ?? '';
    if (labels.includes(target.name)) drawn.push(target.name);
  }
  expect(
    drawn,
    `none of ${targets.map((target) => `${target.name} (${target.rangeKm.toFixed(1)} km)`).join(', ')} ` +
      'was drawn, so the sweep did not reach past 30 km',
  ).not.toEqual([]);
});

test('fine drag moves the labels a quarter as far as normal drag', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });

  // The mode is named on screen, with the step size beside it. 1 mm of finger is
  // 6.037 CSS px at the field phone's 460 ppi, which the readout states in
  // degrees for whatever frame the page is actually in.
  const modeLine = page.getByTestId('live-drag-mode');
  await expect(modeLine).toHaveAttribute('data-mode', 'normal');
  await expect(page.getByTestId('live-fine-drag')).toContainText('4× slower');
  const normalStep = Number(await page.getByTestId('live-drag-step').getAttribute('data-per-px-deg'));
  // 800 px across 2·atan(0.75): the centre scale is 2·tan(hFOV/2)/widthPx.
  expect(normalStep).toBeCloseTo((1.5 / FRAME.widthPx / DEG), 9);
  await expect(page.getByTestId('live-drag-step')).toContainText('Normal drag');

  const dragSurface = page.getByTestId('live-drag');
  const dragBy = async (dxPx: number): Promise<void> => {
    await dragSurface.hover({ position: { x: 300, y: 225 } });
    await page.mouse.down();
    await page.mouse.move(300 + dxPx, 225, { steps: 8 });
    await page.mouse.up();
  };
  const trimHeading = async (): Promise<number> =>
    Number(await page.getByTestId('live-trim').getAttribute('data-heading-deg'));

  // Normal: `drag-trim.ts` inverts the projection, so 100 px is
  // atan((100/800)·2·tan(hFOV/2)) = atan(0.1875) = 10.61965°.
  const expectedNormalDeg = -Math.atan(0.1875) / DEG;
  const before = await summitDots(page);
  const dot = before.find(
    (entry) => Math.abs(entry.cx - expectedSummitPx(TRUE_HEADING_DEG).xPx) < TOLERANCE_PX,
  );
  expect(dot).toBeDefined();
  if (dot === undefined) return;

  await dragBy(100);
  await expect.poll(trimHeading).toBeCloseTo(expectedNormalDeg, 3);
  const afterNormal = await summitDots(page);
  expect(afterNormal.find((entry) => Math.abs(entry.cx - (dot.cx + 100)) < 2)).toBeDefined();

  await page.getByTestId('live-reset-trim').click();
  await expect(page.getByTestId('live-trim')).toHaveAttribute('data-heading-deg', '0');

  // Fine: the SAME 100 px, at a quarter of the gain. The gain multiplies the
  // ANGLE, so this is exactly a quarter of the degrees rather than 0.2519 of
  // them, which is what quartering the pixels would give.
  await page.getByTestId('live-fine-drag').click();
  await expect(modeLine).toHaveAttribute('data-mode', 'fine');
  await expect(page.getByTestId('live-fine-drag')).toContainText('Fine drag is ON');
  const fineStep = Number(await page.getByTestId('live-drag-step').getAttribute('data-per-px-deg'));
  expect(fineStep).toBeCloseTo(normalStep / 4, 12);
  // The budget's own unit: 1 mm of finger at 460 ppi.
  expect(
    Number(await page.getByTestId('live-drag-step').getAttribute('data-per-mm-deg')),
  ).toBeCloseTo(fineStep * 6.037, 9);

  await dragBy(100);
  const expectedFineDeg = expectedNormalDeg / 4;
  await expect.poll(trimHeading).toBeCloseTo(expectedFineDeg, 6);

  // And on screen: a trim of −2.65491° puts the summit at
  // 800·(0.5 + tan(0.0227° + 2.65491°)/1.5) = 424.94 px, which is 24.73 px along
  // — a quarter of the 100 px the same drag moved it at normal gain, to within a
  // third of a pixel.
  const expectedFinePx = expectedSummitPx(TRUE_HEADING_DEG + expectedFineDeg);
  const afterFine = await summitDots(page);
  const moved = afterFine.find((entry) => Math.abs(entry.cx - expectedFinePx.xPx) < TOLERANCE_PX);
  expect(
    moved,
    `no dot near ${expectedFinePx.xPx.toFixed(1)}; dots were ${JSON.stringify(afterFine.slice(0, 12))}`,
  ).toBeDefined();
  if (moved === undefined) return;
  const shiftPx = moved.cx - dot.cx;
  expect(shiftPx).toBeGreaterThan(100 / 4 - 1);
  expect(shiftPx).toBeLessThan(100 / 4 + 1);
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE OFFLINE STRIP
 * ══════════════════════════════════════════════════════════════════════════
 * The service worker itself is proved by `npm run test:deploy`, which takes
 * Chromium's network away and reads a cached grid back at its exact byte length.
 * The dev server deliberately serves no worker (`live-main.tsx` says why), so
 * what is provable here is the other half: that the strip reports the real state
 * of the cache, that the button names the grid the sweep at this position would
 * read and its size, and that tapping it runs the download and refreshes the
 * status.
 *
 * The controller is replaced on `window` after the page has loaded, which is the
 * same handle `live-main.tsx` installs and the deployment check drives. The
 * panel reads it on every poll, so the swap takes effect without a reload.
 */

interface StubbedOfflineApi {
  calls: string[];
  release: () => void;
}

async function stubOfflineController(page: Page): Promise<void> {
  await page.evaluate(() => {
    const calls: string[] = [];
    let release = (): void => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let data: string[] = [];
    (window as unknown as { __mfOffline: StubbedOfflineApi }).__mfOffline = {
      calls,
      release: () => release(),
    };
    (window as unknown as Record<string, unknown>).mountainFinderOffline = {
      status: () =>
        Promise.resolve({
          supported: true,
          controlled: true,
          shell: ['live.html', 'live.js', 'live.css'],
          data,
          usageBytes: 26_000_000,
          quotaBytes: 1_000_000_000,
        }),
      downloadTerrainGrid: async (gridName: string) => {
        calls.push(gridName);
        await held;
        data = ['terrain/manifest.json', 'terrain/tiles/N45E007.hgt'];
        return { ok: true, gridName, cached: data, failed: [] };
      },
      forgetData: () => Promise.resolve(true),
    };
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Recovering from a gross compass error
 * ══════════════════════════════════════════════════════════════════════════
 * The phone is really pointed at the Sun, and the compass is told it is pointed
 * 92° to the right of that — the error measured on IMG_7270 (X-10). Everything
 * drawn is therefore a quarter turn out, which no drag can fix: the fine trim
 * stops at ±30°.
 *
 * The Sun is the instrument, as it is for the field of view. The app draws its
 * disc where its own pose says the Sun is, so under the error the disc is off
 * the frame entirely, and after the re-anchor it must sit at frame centre —
 * which is where the real Sun is, because that is where the camera is pointed.
 */

/** The heading error injected, degrees. */
const GROSS_ERROR_DEG = 92;

async function tapReanchorAt(page: Page, xPx: number, yPx: number): Promise<void> {
  await page.getByTestId('live-reanchor-tap-layer').evaluate(
    (node, point) => {
      node.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          clientX: point.xPx,
          clientY: point.yPx,
          pointerId: 1,
          pointerType: 'touch',
        }),
      );
    },
    { xPx, yPx },
  );
}

test('a compass a quarter turn out is put right by one tap on the sun', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  const now = new Date();
  const observer = { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M };
  const sun = sunPosition(now, observer, { refraction: true });
  if (sun.altitudeDeg < 5) {
    console.log(
      `the sun is ${sun.altitudeDeg.toFixed(1)}° up at Gornergrat at this instant, so there is ` +
        'nothing to tap; the summit re-anchor covers the same arithmetic',
    );
    test.skip();
    return;
  }

  // Really aimed at the Sun; the compass reads 92° further round.
  await startLive(page, {
    trueHeadingDeg: sun.azimuthDeg + GROSS_ERROR_DEG,
    pitchDeg: sun.altitudeDeg,
  });
  await expect(page.getByTestId('live-heading-basis')).toHaveAttribute(
    'data-basis',
    'true-model',
    { timeout: 30_000 },
  );

  // ── the labels are wrong, and the Sun's own disc proves it ───────────────
  await expect(page.getByTestId('live-marks')).toBeVisible();
  await expect(page.getByTestId('live-mark-sun')).toHaveCount(0);
  await expect(page.getByTestId('live-mark-note-sun')).toContainText('Turn that way');
  const wrongHeading = await poseNumber(page, 'data-heading-deg');
  expect(Math.abs(wrongHeading - ((sun.azimuthDeg + GROSS_ERROR_DEG) % 360))).toBeLessThan(1);

  // ── the re-anchor waits for ten seconds of stillness ─────────────────────
  const reanchor = page.getByTestId('live-reanchor');
  await expect(reanchor).toBeVisible();
  await expect(page.getByTestId('live-reanchor-sun')).toBeDisabled();
  await expect
    .poll(async () => Number(await reanchor.getAttribute('data-still-ms')), { timeout: 40_000 })
    .toBeGreaterThanOrEqual(10_000);
  await expect(page.getByTestId('live-reanchor-sun')).toBeEnabled();

  // ── one tap where the real sun is: the middle of the picture ─────────────
  await page.getByTestId('live-reanchor-sun').click();
  await expect(page.getByTestId('live-reanchor-prompt')).toContainText('middle of the real sun');
  await tapReanchorAt(page, FRAME.widthPx / 2, FRAME.heightPx / 2);

  await expect(page.getByTestId('live-reanchor-note')).toContainText('the sun');
  await expect(page.getByTestId('live-reanchor-note')).toContainText(
    `${GROSS_ERROR_DEG}° to the right`,
  );
  expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBeCloseTo(
    -GROSS_ERROR_DEG,
    0,
  );
  await expect(reanchor).toHaveAttribute('data-anchor-source', 'sun');

  // ── the labels land: the Sun is drawn where the real one is ──────────────
  const disc = page.getByTestId('live-mark-sun');
  await expect(disc).toBeVisible({ timeout: 15_000 });
  const drawn = await disc.evaluate((node) => ({
    cx: Number(node.getAttribute('cx')),
    cy: Number(node.getAttribute('cy')),
  }));
  // The slack is the Sun's own motion between the aim and the tap, about 0.25°
  // a minute of azimuth, which is 2 px a minute at this field of view.
  expect(
    Math.hypot(drawn.cx - FRAME.widthPx / 2, drawn.cy - FRAME.heightPx / 2),
    `the sun disc landed at (${drawn.cx.toFixed(1)}, ${drawn.cy.toFixed(1)})`,
  ).toBeLessThan(20);

  const anchoredHeading = await poseNumber(page, 'data-heading-deg');
  expect(Math.abs(anchoredHeading - (sun.azimuthDeg % 360))).toBeLessThan(1.5);

  // ── and a drag afterwards is still a nudge ───────────────────────────────
  // One pixel is 2·tan(hFOV/2)/800 rad = 0.1074° in this frame, so a 20 px drag
  // is about 2.1°. If the correction lived inside the clamped trim, this drag
  // would have snapped it back to +30° and moved the labels 62°.
  const perPxDeg = ((2 * Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2)) / FRAME.widthPx) / DEG;
  await dragPicture(page, 20, 0);
  await expect
    .poll(async () => poseNumber(page, 'data-heading-deg'), { timeout: 15_000 })
    .toBeLessThan(anchoredHeading);
  const afterDrag = await poseNumber(page, 'data-heading-deg');
  expect(anchoredHeading - afterDrag).toBeGreaterThan(perPxDeg * 5);
  expect(anchoredHeading - afterDrag).toBeLessThan(perPxDeg * 40);
  expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBeCloseTo(
    -GROSS_ERROR_DEG,
    0,
  );

  // The gap between the compass and the anchor is on screen, and small, because
  // the compass has not moved since.
  const drift = page.getByTestId('live-anchor-drift');
  await expect(drift).toHaveAttribute('data-beyond-band', 'false');
  expect(Math.abs(Number(await drift.getAttribute('data-gap-deg')))).toBeLessThan(1);
});

test('turning the phone after a re-anchor warns that the fix has gone stale', async ({ page }) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  const now = new Date();
  const sun = sunPosition(
    now,
    { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M },
    { refraction: true },
  );
  if (sun.altitudeDeg < 5) {
    console.log('the sun is below the working window at this instant; nothing to anchor on');
    test.skip();
    return;
  }

  await startLive(page, {
    trueHeadingDeg: sun.azimuthDeg + GROSS_ERROR_DEG,
    pitchDeg: sun.altitudeDeg,
  });
  await expect(page.getByTestId('live-heading-basis')).toHaveAttribute(
    'data-basis',
    'true-model',
    { timeout: 30_000 },
  );
  const reanchor = page.getByTestId('live-reanchor');
  await expect
    .poll(async () => Number(await reanchor.getAttribute('data-still-ms')), { timeout: 40_000 })
    .toBeGreaterThanOrEqual(10_000);
  await page.getByTestId('live-reanchor-sun').click();
  await tapReanchorAt(page, FRAME.widthPx / 2, FRAME.heightPx / 2);
  await expect(reanchor).toHaveAttribute('data-anchor-source', 'sun');

  const drift = page.getByTestId('live-anchor-drift');
  await expect(drift).toHaveAttribute('data-beyond-band', 'false');

  // The compass now reads 30° further round with the phone held where it was:
  // a transient error baked into the anchor looks exactly like this. Only the
  // compass moves, so the relative alpha still says the phone has not turned.
  await pumpCompassOnly(
    page,
    eventAnglesFor(magneticBearingFor(sun.azimuthDeg + GROSS_ERROR_DEG + 30, now), sun.altitudeDeg),
  );
  await expect(drift).toHaveAttribute('data-beyond-band', 'true', { timeout: 20_000 });
  await expect(drift).toContainText('Fix the direction again');
  // The compass moved 30° and the phone turned none of it.
  await expect
    .poll(async () => Math.abs(Number(await drift.getAttribute('data-drift-deg'))))
    .toBeGreaterThan(25);
  expect(Math.abs(Number(await drift.getAttribute('data-turn-deg')))).toBeLessThan(1);
});

test('turning the phone on purpose after a re-anchor raises no drift warning', async ({ page }) => {
  // The same 30°, made by turning rather than by the compass going wrong. The
  // compass and the phone's own yaw move together, so the fix is still good and
  // the screen must not say otherwise.
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  const now = new Date();
  const sun = sunPosition(
    now,
    { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M },
    { refraction: true },
  );
  if (sun.altitudeDeg < 5) {
    console.log('the sun is below the working window at this instant; nothing to anchor on');
    test.skip();
    return;
  }

  await startLive(page, {
    trueHeadingDeg: sun.azimuthDeg + GROSS_ERROR_DEG,
    pitchDeg: sun.altitudeDeg,
  });
  await expect(page.getByTestId('live-heading-basis')).toHaveAttribute(
    'data-basis',
    'true-model',
    { timeout: 30_000 },
  );
  const reanchor = page.getByTestId('live-reanchor');
  await expect
    .poll(async () => Number(await reanchor.getAttribute('data-still-ms')), { timeout: 40_000 })
    .toBeGreaterThanOrEqual(10_000);
  await page.getByTestId('live-reanchor-sun').click();
  await tapReanchorAt(page, FRAME.widthPx / 2, FRAME.heightPx / 2);
  await expect(reanchor).toHaveAttribute('data-anchor-source', 'sun');

  await pumpSet(
    page,
    eventAnglesFor(magneticBearingFor(sun.azimuthDeg + GROSS_ERROR_DEG + 30, now), sun.altitudeDeg),
  );
  const drift = page.getByTestId('live-anchor-drift');
  // The phone's yaw follows the turn at once; the compass reading is fused over
  // a window and arrives a few tenths of a second later. So the turn is waited
  // for first, and then the compass, before the two are compared.
  await expect
    .poll(async () => Math.abs(Number(await drift.getAttribute('data-turn-deg'))), {
      timeout: 20_000,
    })
    .toBeGreaterThan(29.5);
  await expect
    .poll(async () => Math.abs(Number(await drift.getAttribute('data-drift-deg'))), {
      timeout: 20_000,
    })
    .toBeLessThan(1);
  await expect(drift).toHaveAttribute('data-beyond-band', 'false');
  expect(Math.abs(Number(await drift.getAttribute('data-gap-deg')))).toBeGreaterThan(29);
});

test('a tap on the real sun says how far off the compass is', async ({ page }) => {
  // The automatic warning. It fires on a tap the app can attribute to nothing:
  // a tap is attributed to a drawn mark within 160 px, about 17° here, so a
  // compass 92° out always leaves the app's own sun disc too far away to claim
  // the tap. The step the person is on asks for the middle of the real sun.
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  const now = new Date();
  const sun = sunPosition(
    now,
    { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M },
    { refraction: true },
  );
  if (sun.altitudeDeg < 5) {
    console.log('the sun is below the working window at this instant; nothing to tap');
    test.skip();
    return;
  }

  await startHomeSession(page);
  // Really aimed at the sun, with the compass 92° out.
  await pumpSet(
    page,
    eventAnglesFor(magneticBearingFor(sun.azimuthDeg + GROSS_ERROR_DEG, now), sun.altitudeDeg),
  );
  await page.getByTestId('home-session-start').click();
  for (let index = 0; index < POSE_LABELS.length - 1; index += 1) {
    await page.getByTestId('home-session-next').click();
  }
  await expect(page.getByTestId('home-session')).toHaveAttribute('data-step-pose', 'sun-capture');
  await expect(page.getByTestId('home-session-tap-layer')).toBeVisible();

  // Wait for the skyline, so summit dots are drawn. They never claim a tap on
  // this step, so only a disc near the middle could stop the warning.
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });
  const centre = { xPx: FRAME.widthPx / 2, yPx: FRAME.heightPx / 2 };
  const drawn = await page
    .locator('[data-testid="live-marks"] circle')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        cx: Number(node.getAttribute('cx')),
        cy: Number(node.getAttribute('cy')),
      })),
    );
  const nearestPx = Math.min(
    ...drawn.map((dot) => Math.hypot(dot.cx - centre.xPx, dot.cy - centre.yPx)),
    Number.POSITIVE_INFINITY,
  );
  if (nearestPx <= 160) {
    console.log(
      `a drawn disc sits ${nearestPx.toFixed(0)} px from the middle of the frame, so the tap ` +
        'would be attributed to it; skipped the warning assertion',
    );
    return;
  }

  // The middle of the picture is where the real sun is, because that is where
  // the camera is pointed.
  await tapAt(page, centre.xPx, centre.yPx);
  const warning = page.getByTestId('live-gross-warning');
  await expect(warning).toBeVisible({ timeout: 15_000 });
  await expect(warning).toContainText('tap the sun (or a summit you know) to fix it');
  const said = await warning.textContent();
  const degrees = Number(/(\d+)°/.exec(said ?? '')?.[1] ?? 0);
  expect(Math.abs(degrees - GROSS_ERROR_DEG)).toBeLessThan(3);
});

test('a summit picked by name re-anchors the labels, after the person confirms', async ({
  page,
}) => {
  // The fallback for an overcast day, and the path that has to ask first: the
  // move is stated in degrees and in a direction before anything turns.
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  await startLive(page, {
    trueHeadingDeg: TRUE_HEADING_DEG + GROSS_ERROR_DEG,
    pitchDeg: 0,
  });
  await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
    timeout: SCENE_TIMEOUT_MS,
  });

  const reanchor = page.getByTestId('live-reanchor');
  await expect
    .poll(async () => Number(await reanchor.getAttribute('data-still-ms')), { timeout: 40_000 })
    .toBeGreaterThanOrEqual(10_000);

  await page.getByTestId('live-reanchor-summit').click();
  const picker = page.getByTestId('live-reanchor-summit-name');
  const matterhornValue = await picker
    .locator('option')
    .evaluateAll((nodes) =>
      nodes
        .filter((node) => (node.textContent ?? '').startsWith('Matterhorn '))
        .map((node) => (node as HTMLOptionElement).value),
    );
  expect(matterhornValue[0], 'the sweep did not name the Matterhorn').toBeDefined();
  await picker.selectOption(matterhornValue[0] ?? '');
  await expect(page.getByTestId('live-reanchor-prompt')).toContainText('Now tap Matterhorn');

  // Where the Matterhorn really is on the screen: the closed form for the pose
  // the phone is actually in, which is 92° from what the compass claims.
  const truth = expectedSummitPx(TRUE_HEADING_DEG);
  await tapReanchorAt(page, truth.xPx, truth.yPx);

  const confirm = page.getByTestId('live-reanchor-confirm');
  await expect(confirm).toContainText(`This turns the labels ${GROSS_ERROR_DEG}° to the right.`);
  // Nothing has turned yet.
  expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBe(0);

  await page.getByTestId('live-reanchor-confirm-no').click();
  await expect(confirm).toHaveCount(0);
  expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBe(0);

  // Again, and this time say yes.
  await tapReanchorAt(page, truth.xPx, truth.yPx);
  await page.getByTestId('live-reanchor-confirm-yes').click();
  await expect(reanchor).toHaveAttribute('data-anchor-source', 'summit');
  expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBeCloseTo(
    -GROSS_ERROR_DEG,
    0,
  );

  // And the labels land where the closed form says they belong.
  await expect
    .poll(async () => poseNumber(page, 'data-heading-deg'), { timeout: 15_000 })
    .toBeCloseTo(TRUE_HEADING_DEG, 0);
  const dots = await summitDots(page);
  const near = dots.filter(
    (dot) =>
      Math.abs(dot.cx - truth.xPx) < TOLERANCE_PX && Math.abs(dot.cy - truth.yPx) < TOLERANCE_PX,
  );
  expect(
    near.length,
    `no summit dot within ${TOLERANCE_PX} px of (${truth.xPx.toFixed(2)}, ` +
      `${truth.yPx.toFixed(2)}); dots were ${JSON.stringify(dots.slice(0, 12))}`,
  ).toBeGreaterThan(0);
  await expect(page.getByTestId('live-labels')).toContainText('Matterhorn');
});

test('the offline strip reports the cache, and the button downloads the grid this viewpoint needs', async ({
  page,
}) => {
  test.setTimeout(SCENE_TIMEOUT_MS + 90_000);
  await startLive(page, { trueHeadingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });

  const strip = page.getByTestId('live-offline');
  const status = page.getByTestId('live-offline-status');

  // The dev server registers no worker, and the strip says so rather than
  // showing an empty line or claiming the page is installed.
  await expect(strip).toHaveAttribute('data-controlled', 'false');
  await expect(status).toContainText('not installed for offline use yet');

  // The button names the grid `selectTerrainGrid` would hand this viewpoint and
  // its exact size: a whole SRTM1 tile is 3601² samples at two bytes each.
  const button = page.getByTestId('live-offline-download');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect(strip).toHaveAttribute('data-grid', 'N45E007');
  await expect(strip).toHaveAttribute('data-grid-bytes', String(3601 * 3601 * 2));
  await expect(button).toHaveText('Download N45E007 for offline use (25.9 MB)');

  await stubOfflineController(page);
  // The poll picks the new controller up; the line then reports what it holds.
  await expect(strip).toHaveAttribute('data-controlled', 'true', { timeout: 15_000 });
  await expect(status).toContainText('3 page files');
  await expect(status).toContainText('no terrain yet');
  await expect(status).toContainText('using 26.0 MB of 1000.0 MB allowed');

  await button.click();
  await expect(strip).toHaveAttribute('data-busy', 'true');
  await expect(page.getByTestId('live-offline-progress')).toContainText('Downloading N45E007');
  await expect(page.getByTestId('live-offline-progress')).toContainText('25.9 MB');
  await expect(button).toBeDisabled();

  // The grid asked for is the one the button named, not a hard-coded site.
  expect(
    await page.evaluate(
      () => (window as unknown as { __mfOffline: StubbedOfflineApi }).__mfOffline.calls,
    ),
  ).toEqual(['N45E007']);

  await page.evaluate(() =>
    (window as unknown as { __mfOffline: StubbedOfflineApi }).__mfOffline.release(),
  );

  const result = page.getByTestId('live-offline-result');
  await expect(result).toHaveAttribute('data-ok', 'true', { timeout: 15_000 });
  await expect(result).toContainText('Done');
  await expect(result).toContainText('works with no signal');
  await expect(strip).toHaveAttribute('data-busy', 'false');

  // And the status line was re-read, so it now counts the terrain that arrived.
  await expect(strip).toHaveAttribute('data-data-count', '2', { timeout: 15_000 });
  await expect(status).toContainText('2 terrain files');
});

test('the session ends with six repeated drags, three normal and three fine', async ({ page }) => {
  // The measurement the field-test budget's largest term is waiting for: drag
  // precision, assumed at 0.543° from 1 mm of finger. Six attempts at putting a
  // drawn mark where it belongs replace the assumption with a scatter.
  //
  // They go into the shared file under `dragTrials`, beside the thirteen pose
  // segments. Every number in a trial is relative to the start of its own
  // gesture, so the file still carries no position.
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  await startHomeSession(page);
  await page.getByTestId('home-session-start').click();
  for (let index = 0; index < POSE_LABELS.length; index += 1) {
    await page.getByTestId('home-session-next').click();
  }

  const session = page.getByTestId('home-session');
  await expect(session).toHaveAttribute('data-phase', 'drag-trials', { timeout: 15_000 });

  // The plan is three at normal gain then three fine, and the screen puts the
  // drag layer into the gain each attempt asks for rather than asking the person
  // to remember.
  const progress = page.getByTestId('home-session-trial-progress');
  const instruction = page.getByTestId('home-session-trial-instruction');
  const modeLine = page.getByTestId('live-drag-mode');
  for (let index = 0; index < 6; index += 1) {
    const mode = index < 3 ? 'normal' : 'fine';
    await expect(progress).toHaveAttribute('data-trial-index', String(index));
    await expect(progress).toHaveAttribute('data-trial-mode', mode);
    await expect(modeLine).toHaveAttribute('data-mode', mode);
    await expect(instruction).toContainText(`Attempt ${(index % 3) + 1} of 3, ${mode} speed`);
    await expect(instruction).toContainText('both hands');
    await expect(page.getByTestId('home-session-trial-count')).toHaveAttribute(
      'data-count',
      String(index),
    );
    await dragPicture(page, 20 + (index % 3) * 6, -8 + (index % 3) * 2);
  }

  await expect(session).toHaveAttribute('data-phase', 'finished', { timeout: 15_000 });
  // The gain is put back, so the next person to touch the picture is not
  // silently in a mode they did not choose.
  await expect(modeLine).toHaveAttribute('data-mode', 'normal');

  const summary = page.getByTestId('home-session-trial-summary');
  await expect(summary).toHaveAttribute('data-trial-count', '6');
  // Each mode gets the same three offsets — 20, 26 and 32 px — so each has a
  // 6 px sample standard deviation, the same arithmetic as 2, 4, 6 scaled.
  for (const mode of ['normal', 'fine']) {
    const line = page.getByTestId(`home-session-trial-${mode}`);
    await expect(line).toContainText('3 attempts');
    await expect(line).toContainText('6.0 px');
    await expect(line).toContainText('roll held to');
  }
  // Fine mode's degrees are a quarter of normal mode's for the same pixels, so
  // its scatter is a quarter too — which is the whole point of measuring both.
  // The comparison is to two places because the screen rounds the figure to
  // three, not because the ratio is approximate.
  const scatterOf = async (mode: string): Promise<number> => {
    const text = (await page.getByTestId(`home-session-trial-${mode}`).textContent()) ?? '';
    const matched = /spread (-?[\d.]+)°/.exec(text);
    expect(matched, `no spread in "${text}"`).not.toBeNull();
    return Number(matched?.[1] ?? Number.NaN);
  };
  const normalScatter = await scatterOf('normal');
  expect(normalScatter).toBeGreaterThan(0);
  expect(await scatterOf('fine')).toBeCloseTo(normalScatter / 4, 2);

  // The shared file: thirteen poses, six trials, and nothing the parser refuses.
  await expect(page.getByTestId('home-session-parse')).toHaveAttribute('data-valid', 'true');
  await page.getByTestId('home-session-share').click();
  // The share is a promise, so the bytes are read once the screen reports the
  // outcome rather than straight after the click.
  await expect(page.getByTestId('home-session-share-result')).toHaveAttribute(
    'data-outcome',
    'shared',
  );
  const captured = await sharedRecording(page);
  expect(captured).toBeDefined();
  if (captured === undefined) return;
  const parsed = parseRecording(JSON.parse(captured.text) as unknown);
  expect(parsed.ok ? [] : parsed.problems).toEqual([]);
  if (!parsed.ok) return;
  expect(parsed.value.segments.map((segment) => segment.pose)).toEqual([...POSE_LABELS]);

  // The six attempts reached the file, in order, at the gain each ran at.
  const trials = parsed.value.dragTrials ?? [];
  expect(trials.map((trial) => trial.index)).toEqual([0, 1, 2, 3, 4, 5]);
  expect(trials.map((trial) => trial.mode)).toEqual([
    'normal',
    'normal',
    'normal',
    'fine',
    'fine',
    'fine',
  ]);
  // 1 and 1/4: `dragGain` is what the screen ran the gesture at, and the file
  // states it per attempt rather than leaving a reader to infer it.
  expect(trials.map((trial) => trial.gain)).toEqual([1, 1, 1, 0.25, 0.25, 0.25]);
  // The same three finger offsets in each mode — 20, 26 and 32 px across.
  expect(trials.map((trial) => trial.offsetPx.dx)).toEqual([20, 26, 32, 20, 26, 32]);
  for (const trial of trials) {
    expect(trial.rollSpreadDeg).toBeGreaterThanOrEqual(0);
    expect(trial.durationMs).toBeGreaterThan(0);
  }
  // A fine attempt turns the same pixels into a quarter of the degrees.
  const dxOf = (mode: string): number[] =>
    trials.filter((trial) => trial.mode === mode).map((trial) => trial.offsetDeg.headingDeg);
  const normalDeg = dxOf('normal');
  const fineDeg = dxOf('fine');
  for (let index = 0; index < 3; index += 1) {
    expect(fineDeg[index] ?? Number.NaN).toBeCloseTo((normalDeg[index] ?? Number.NaN) / 4, 9);
  }

  // The trials carry nothing absolute: no place on screen, no clock, no fix.
  expect(findForbiddenContent(JSON.parse(captured.text) as unknown)).toEqual([]);
  const trialText = JSON.stringify(trials);
  for (const banned of ['latitude', 'longitude', 'coords', 'geolocation', 'clientX', 'screenX']) {
    expect(trialText, banned).not.toContain(banned);
  }

  // And the analyzer read them on the device, rather than the file carrying
  // numbers nothing looks at.
  const scatter = page.locator('li[data-verdict-id="drag-scatter"]');
  await expect(scatter).toBeVisible();
  await expect(scatter).toHaveAttribute('data-inconclusive', 'false');
  await expect(scatter).toContainText('fine drag scatters');
});

test('the drag trials can be skipped, and the recording is still complete', async ({ page }) => {
  // The recording is the session's product; the trials are a measurement on top
  // of it. Someone who cannot brace the phone must still be able to finish.
  test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
  await startHomeSession(page);
  await page.getByTestId('home-session-start').click();
  for (let index = 0; index < POSE_LABELS.length; index += 1) {
    await page.getByTestId('home-session-next').click();
  }
  const session = page.getByTestId('home-session');
  await expect(session).toHaveAttribute('data-phase', 'drag-trials', { timeout: 15_000 });
  await page.getByTestId('home-session-skip-trials').click();

  await expect(session).toHaveAttribute('data-phase', 'finished', { timeout: 15_000 });
  await expect(page.getByTestId('home-session-trial-summary')).toHaveCount(0);
  await expect(page.getByTestId('home-session-parse')).toHaveAttribute('data-valid', 'true');
  await expect(page.getByTestId('live-drag-mode')).toHaveAttribute('data-mode', 'normal');
});
