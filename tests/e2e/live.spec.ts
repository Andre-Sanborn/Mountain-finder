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

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { geomagneticField } from '../../src/core/declination';
import { moonPosition, sunPosition } from '../../src/core/celestial';
import { FAKE_CAMERA_DIR, FAKE_FRAME, writeFakeCameraVideo } from './support/fake-camera';

const FAKE_VIDEO = resolve(
  FAKE_CAMERA_DIR,
  `fake-camera-${FAKE_FRAME.widthPx}x${FAKE_FRAME.heightPx}.y4m`,
);

/** Same rule as playwright.config.ts: prefer this environment's Chromium. */
const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

const DEG = Math.PI / 180;

/* ── the scene under test ─────────────────────────────────────────────────── */

const GORNERGRAT = { lat: 45.983333, lon: 7.782222 };
/** Published platform height plus a standing eye height. */
const OBSERVER_EYE_M = 3089 + 1.6;
const MATTERHORN = { lat: 45.976389, lon: 7.658611, elevationM: 4478 };

/**
 * Chamonix, for the no-terrain case. It sits in SRTM tile N45E006, which this
 * repository does not serve — the same viewpoint `tests/e2e/app.spec.ts` uses to
 * prove the still path names a missing tile rather than drawing nothing.
 */
const CHAMONIX = { lat: 45.9237, lon: 6.8694 };

/** Frame the overlay is drawn into: the landscape viewport. */
const FRAME = { widthPx: 800, heightPx: 450 };

/** True heading the camera is pointed along for the main case. */
const TRUE_HEADING_DEG = 265.4;

/** hFOV and vFOV of the visible box — the derivation is in the header. */
const VISIBLE_FOV = {
  hFovDeg: (2 * Math.atan(0.75)) / DEG,
  vFovDeg: (2 * Math.atan(0.421875)) / DEG,
};

/** Tolerance: 1 % of the frame width, as the still path uses. */
const TOLERANCE_PX = 8;

/** Initial great-circle bearing from observer to summit, degrees. */
function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const f1 = from.lat * DEG;
  const f2 = to.lat * DEG;
  const dl = (to.lon - from.lon) * DEG;
  const raw =
    Math.atan2(
      Math.sin(dl) * Math.cos(f2),
      Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl),
    ) / DEG;
  return (raw + 360) % 360;
}

/** Great-circle range on a sphere of mean radius, metres. */
function rangeM(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
  const R = 6_371_008.8;
  const f1 = from.lat * DEG;
  const f2 = to.lat * DEG;
  const a =
    Math.sin((f2 - f1) / 2) ** 2 +
    Math.cos(f1) * Math.cos(f2) * Math.sin(((to.lon - from.lon) * DEG) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Apparent altitude of the summit, degrees, with the standard refraction
 * coefficient 0.13 folded into an effective Earth radius.
 */
function summitAltitudeDeg(): number {
  const d = rangeM(GORNERGRAT, MATTERHORN);
  const effectiveRadiusM = 6_371_008.8 / (1 - 0.13);
  return (
    Math.atan(
      (MATTERHORN.elevationM - OBSERVER_EYE_M - (d * d) / (2 * effectiveRadiusM)) / d,
    ) / DEG
  );
}

/**
 * Project a direction onto the frame, independently of `src/core/projection.ts`.
 *
 * East-North-Up throughout. `forward` is the optical axis, `right` is level at
 * heading + 90°, and `up` is `right × forward`; roll then spins both about the
 * optical axis, and the perspective divide is scaled by the half-field tangents.
 * Written out here rather than imported so the expectation is not the code under
 * test.
 *
 * Roll is not optional even when the phone is held level. The motion events
 * carry an injected user acceleration, so the fused roll is a few thousandths of
 * a degree rather than zero, and ignoring it misplaces a mark near the edge of
 * the frame by about a thousandth of a pixel — which is exactly the residual
 * this helper has to account for to assert the projection at all.
 */
function projectIndependently(
  pose: {
    headingDeg: number;
    pitchDeg: number;
    rollDeg: number;
    hFovDeg: number;
    vFovDeg: number;
  },
  bearingDeg: number,
  altitudeDeg: number,
): { xPx: number; yPx: number } {
  const dir = (bearing: number, altitude: number): [number, number, number] => [
    Math.cos(altitude * DEG) * Math.sin(bearing * DEG),
    Math.cos(altitude * DEG) * Math.cos(bearing * DEG),
    Math.sin(altitude * DEG),
  ];
  const cross = (
    a: [number, number, number],
    b: [number, number, number],
  ): [number, number, number] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const dot = (a: [number, number, number], b: [number, number, number]): number =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  const forward = dir(pose.headingDeg, pose.pitchDeg);
  const h = pose.headingDeg * DEG;
  const levelRight: [number, number, number] = [Math.cos(h), -Math.sin(h), 0];
  const levelUp = cross(levelRight, forward);

  const r = pose.rollDeg * DEG;
  const right = levelRight.map(
    (value, i) => value * Math.cos(r) - (levelUp[i] ?? 0) * Math.sin(r),
  ) as [number, number, number];
  const up = levelRight.map(
    (value, i) => value * Math.sin(r) + (levelUp[i] ?? 0) * Math.cos(r),
  ) as [number, number, number];

  const target = dir(bearingDeg, altitudeDeg);
  const depth = dot(target, forward);
  return {
    xPx:
      FRAME.widthPx *
      (0.5 + dot(target, right) / depth / (2 * Math.tan((pose.hFovDeg * DEG) / 2))),
    yPx:
      FRAME.heightPx *
      (0.5 - dot(target, up) / depth / (2 * Math.tan((pose.vFovDeg * DEG) / 2))),
  };
}

/** Closed-form pixel position of the summit for a given true heading. */
function expectedSummitPx(trueHeadingDeg: number): { xPx: number; yPx: number } {
  const delta = bearingDeg(GORNERGRAT, MATTERHORN) - trueHeadingDeg;
  const altitude = summitAltitudeDeg();
  return {
    xPx:
      FRAME.widthPx *
      (0.5 + Math.tan(delta * DEG) / (2 * Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2))),
    yPx:
      FRAME.heightPx *
      (0.5 -
        Math.tan(altitude * DEG) /
          Math.cos(delta * DEG) /
          (2 * Math.tan((VISIBLE_FOV.vFovDeg * DEG) / 2))),
  };
}

/**
 * The magnetic bearing to inject so the screen resolves `trueHeadingDeg`.
 *
 * `heightM: 0` because Playwright's geolocation carries no altitude, so the
 * screen evaluates the model at sea level too. The height term is worth about
 * 0.007° over 3 km — 0.06 px here — but matching the screen's own input removes
 * the discrepancy instead of widening a tolerance around it.
 */
function magneticBearingFor(trueHeadingDeg: number, when: Date): number {
  const field = geomagneticField(
    { latitudeDeg: GORNERGRAT.lat, longitudeDeg: GORNERGRAT.lon, heightM: 0 },
    when,
  );
  return (((trueHeadingDeg - field.declinationDeg) % 360) + 360) % 360;
}

/* ── the injected events ──────────────────────────────────────────────────── */

/**
 * The orientation event that puts the rear camera on a magnetic bearing at a
 * pitch, with no roll.
 *
 * From `web-sensors.ts`'s own geometry with γ = 0:
 *   pitch = asin(−cos β)      →  β = acos(−sin pitch)
 *   heading = atan2(−sin α, cos α) = −α for sin β > 0, which β = acos(…) gives
 * so α = −heading, folded onto [0, 360).
 */
function eventAnglesFor(
  magneticHeadingDeg: number,
  pitchDeg: number,
): { alpha: number; beta: number; gamma: number } {
  return {
    alpha: ((-magneticHeadingDeg % 360) + 360) % 360,
    beta: Math.acos(-Math.sin(pitchDeg * DEG)) / DEG,
    gamma: 0,
  };
}

/**
 * Install the pump. It dispatches real `DeviceOrientationEvent` and
 * `DeviceMotionEvent` objects at 30 Hz, so the traces stay inside the 1.5 s
 * window `fuseSensorPose` accepts.
 *
 * The motion event's `accelerationIncludingGravity` follows the W3C convention —
 * it points UP for a resting device, `−ĝ · 9.80665` — so
 * `detectMotionGravityConvention` has a real pair of events to settle the sign
 * from, exactly as it would on Chromium hardware.
 */
async function installSensorPump(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const DEG_LOCAL = Math.PI / 180;
    const state = { alpha: 0, beta: 90, gamma: 0, timer: 0 };

    const dispatch = (): void => {
      window.dispatchEvent(
        new DeviceOrientationEvent('deviceorientationabsolute', {
          alpha: state.alpha,
          beta: state.beta,
          gamma: state.gamma,
          absolute: true,
        }),
      );
      // ĝ = (cos β·sin γ, −sin β, −cos β·cos γ); the W3C vector is its negation
      // scaled by standard gravity.
      const b = state.beta * DEG_LOCAL;
      const g = state.gamma * DEG_LOCAL;
      const down = {
        x: Math.cos(b) * Math.sin(g),
        y: -Math.sin(b),
        z: -Math.cos(b) * Math.cos(g),
      };
      window.dispatchEvent(
        new DeviceMotionEvent('devicemotion', {
          accelerationIncludingGravity: {
            x: -down.x * 9.80665,
            y: -down.y * 9.80665,
            z: -down.z * 9.80665,
          },
          acceleration: { x: 0.001, y: 0.001, z: 0.001 },
          interval: 33,
        }),
      );
    };

    (window as unknown as Record<string, unknown>).__mfSensors = {
      set(alpha: number, beta: number, gamma: number): void {
        state.alpha = alpha;
        state.beta = beta;
        state.gamma = gamma;
        dispatch();
      },
      start(): void {
        if (state.timer !== 0) return;
        state.timer = window.setInterval(dispatch, 33);
        dispatch();
      },
      stop(): void {
        window.clearInterval(state.timer);
        state.timer = 0;
      },
    };
  });
}

interface SensorPumpApi {
  set(alpha: number, beta: number, gamma: number): void;
  start(): void;
  stop(): void;
}

async function pumpSet(page: Page, angles: { alpha: number; beta: number; gamma: number }): Promise<void> {
  await page.evaluate((next) => {
    const api = (window as unknown as { __mfSensors: SensorPumpApi }).__mfSensors;
    api.set(next.alpha, next.beta, next.gamma);
    api.start();
  }, angles);
}

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

/** Where the summit dots landed, read off the rendered SVG. */
async function summitDots(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page
    .locator('[data-testid="live-overlay-svg"] g.mf-summits circle')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        cx: Number(node.getAttribute('cx')),
        cy: Number(node.getAttribute('cy')),
      })),
    );
}

async function poseNumber(page: Page, attribute: string): Promise<number> {
  const raw = await page.getByTestId('live-pose').getAttribute(attribute);
  expect(raw, `live-pose is missing ${attribute}`).not.toBeNull();
  return Number(raw);
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
