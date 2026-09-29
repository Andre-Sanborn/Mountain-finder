/**
 * The Gornergrat harness: the scene every live e2e is driven against, and the
 * helpers that drive it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THESE LIVE OUTSIDE A SPEC FILE
 * ═══════════════════════════════════════════════════════════════════════════
 * Two spec files need them, and one spec file cannot import another without
 * registering its tests twice. Nothing here calls `test()`; it is constants,
 * closed-form geometry and page helpers.
 *
 * ── THE GEOMETRY IS NOT THE CODE UNDER TEST ────────────────────────────────
 * `projectIndependently` and `expectedSummitPx` are written out here from the
 * East-North-Up definitions rather than imported from `src/core/projection.ts`,
 * so an expectation is never the output of the thing it is checking. The same
 * rule is why `magneticBearingFor` inverts the declination model instead of
 * reading what the screen reported.
 *
 * ── THE FRAME ──────────────────────────────────────────────────────────────
 * The overlay is drawn into the 800 × 450 landscape viewport, and `VISIBLE_FOV`
 * is the field of view that survives `object-fit: cover` of the fake camera's
 * 4:3 frame into it. A spec that serves a 16:9 camera instead crops nothing and
 * gets the same numbers, because `cover` of a 16:9 source into a 16:9 box is the
 * identity.
 */

import { expect, type Page } from '@playwright/test';

import { geomagneticField } from '../../../src/core/declination';

/** Same rule as playwright.config.ts: prefer this environment's Chromium. */
export const preinstalled = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';

export const DEG = Math.PI / 180;

/* ── the scene under test ─────────────────────────────────────────────────── */

export const GORNERGRAT = { lat: 45.983333, lon: 7.782222 };
/** Published platform height plus a standing eye height. */
export const OBSERVER_EYE_M = 3089 + 1.6;
export const MATTERHORN = { lat: 45.976389, lon: 7.658611, elevationM: 4478 };

/** Frame the overlay is drawn into: the landscape viewport. */
export const FRAME = { widthPx: 800, heightPx: 450 };

/** True heading the camera is pointed along for the main case. */
export const TRUE_HEADING_DEG = 265.4;

/** hFOV and vFOV of the visible box — the derivation is in the header. */
export const VISIBLE_FOV = {
  hFovDeg: (2 * Math.atan(0.75)) / DEG,
  vFovDeg: (2 * Math.atan(0.421875)) / DEG,
};


/**
 * Smallest spread of reference positions `fitFovCalibration` will fit, in this
 * frame's pixels: a tenth of the frame width.
 */
export const MIN_SPREAD_PX = 0.1 * FRAME.widthPx;

/** Initial great-circle bearing from observer to summit, degrees. */
export function bearingDeg(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
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
export function rangeM(from: { lat: number; lon: number }, to: { lat: number; lon: number }): number {
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
export function summitAltitudeDeg(): number {
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
export function projectIndependently(
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
export function expectedSummitPx(trueHeadingDeg: number): { xPx: number; yPx: number } {
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
export function magneticBearingFor(trueHeadingDeg: number, when: Date): number {
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
export function eventAnglesFor(
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
export async function installSensorPump(page: Page): Promise<void> {
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

export async function pumpSet(page: Page, angles: { alpha: number; beta: number; gamma: number }): Promise<void> {
  await page.evaluate((next) => {
    const api = (window as unknown as { __mfSensors: SensorPumpApi }).__mfSensors;
    api.set(next.alpha, next.beta, next.gamma);
    api.start();
  }, angles);
}

/** Where the summit dots landed, read off the rendered SVG. */
export async function summitDots(page: Page): Promise<{ cx: number; cy: number }[]> {
  return page
    .locator('[data-testid="live-overlay-svg"] g.mf-summits circle')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        cx: Number(node.getAttribute('cx')),
        cy: Number(node.getAttribute('cy')),
      })),
    );
}

export async function poseNumber(page: Page, attribute: string): Promise<number> {
  const raw = await page.getByTestId('live-pose').getAttribute(attribute);
  expect(raw, `live-pose is missing ${attribute}`).not.toBeNull();
  return Number(raw);
}

/**
 * One drag on the picture, below the panel, for the repeated-drag trials.
 *
 * The y is in the lower third of the frame: the session panel occupies the top
 * strip, and a press that started on it would be a button press rather than a
 * drag of the labels.
 */
export async function dragPicture(page: Page, dxPx: number, dyPx: number): Promise<void> {
  // The two chrome strips grow with their contents, and during the session the
  // top one is a panel of instructions. So the start of the drag is found rather
  // than assumed: the first point where the drag surface is the topmost element
  // is a point a finger would reach.
  const from = await page.evaluate(
    ([width, height]: readonly number[]) => {
      const surface = document.querySelector('[data-testid="live-drag"]');
      if (surface === null || width === undefined || height === undefined) return undefined;
      for (let y = Math.round(height / 2); y < height - 10; y += 5) {
        for (let x = 40; x < width - 40; x += 40) {
          if (document.elementFromPoint(x, y) === surface) return { x, y };
        }
      }
      return undefined;
    },
    [FRAME.widthPx, FRAME.heightPx] as const,
  );
  expect(from, 'no part of the picture is reachable for a drag').toBeDefined();
  if (from === undefined) return;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dxPx, from.y + dyPx, { steps: 6 });
  await page.mouse.up();
}
