import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { sunPosition } from '../../src/core/celestial';
import { MAX_TAP_DISTANCE_PX } from '../../src/app/live/fov-calibration';
import { EPOCH_FLOOR, findForbiddenContent } from '../../src/live/recording';
import {
  findForbiddenContent as findForbiddenBundleContent,
  parseFieldBundle,
} from '../../src/live/field-analysis';
import { FAKE_CAMERA_DIR, writeFakeCameraVideo } from './support/fake-camera';
import { holdStillForReanchor, tapReanchorAt } from './support/field-run';
import { tapSurfaceAt } from './support/tap';
import {
  DEG,
  FRAME,
  GORNERGRAT,
  MATTERHORN,
  MIN_SPREAD_PX,
  OBSERVER_EYE_M,
  TRUE_HEADING_DEG,
  VISIBLE_FOV,
  bearingDeg,
  dragPicture,
  eventAnglesFor,
  installSensorPump,
  magneticBearingFor,
  poseNumber,
  preinstalled,
  projectIndependently,
  pumpSet,
  summitAltitudeDeg,
  summitDots,
} from './support/gornergrat';

/* ══════════════════════════════════════════════════════════════════════════
 * THE FIELD SESSION — live.html?session=field
 * ══════════════════════════════════════════════════════════════════════════
 * WHAT THIS PROVES, AND WHAT IT CANNOT
 * ═══════════════════════════════════════════════════════════════════════════
 * Proved here:
 *   • the guided sequence walks § 2.7's steps and produces one bundle
 *   • that bundle passes `parseFieldBundle`, the same strict parser the grader
 *     runs, from the bytes the share sheet was handed rather than from the
 *     page's idea of them
 *   • it carries no coordinate, no bearing, no wall clock and no camera id
 *   • the stored frames are at least 1920 px across and are the CAMERA frame,
 *     checked pixel against pixel with the `<video>` the app is drawing over
 *   • no request carries any of it
 *
 * What it cannot prove is what a real phone's sensors report on a ridge, or
 * whether the labels land on the mountains. The pose here is dispatched and the
 * scenery is a file.
 *
 * ── WHY A SECOND FAKE CAMERA ───────────────────────────────────────────────
 * The pre-registration stores each capture at the video track's full width, at
 * least 1920 px, because truth is a pixel two people pick out of the frame by
 * eye (§ 2.0). The suite's usual fake camera is 1200 × 900, so this block runs
 * Chromium against a 1920 × 1080 file of the same photograph. 16:9 also matches
 * the 800 × 450 viewport exactly, so `object-fit: cover` crops nothing and the
 * frame is the overlay's own space scaled by 2.4 — which is what lets the truth
 * apexes below be stated in frame pixels from the injected pose alone.
 */

/** A tile fetch, then a 360° sweep. The still path allows 120 s for a 131° one. */
const SCENE_TIMEOUT_MS = 180_000;

/**
 * Pitch for the field-of-view taps, degrees. The panel covers the top of the
 * picture, and this puts the skyline's dots below it.
 */
const FOV_TAP_PITCH_DEG = 14;

const FIELD_FRAME = { widthPx: 1920, heightPx: 1080 } as const;
const FIELD_VIDEO = resolve(
  FAKE_CAMERA_DIR,
  `fake-camera-${FIELD_FRAME.widthPx}x${FIELD_FRAME.heightPx}.y4m`,
);

/** Overlay pixels to stored-frame pixels. Exact: 1920/800 = 1080/450 = 2.4. */
const FRAME_SCALE = FIELD_FRAME.widthPx / FRAME.widthPx;

/** Where the e2e leaves the bundle and its truth for `npm run analyze:field`. */
const FIELD_OUT_DIR = resolve(FAKE_CAMERA_DIR, 'field');

interface SharedBundleFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  /** The text, for the JSON only. A frame's bytes are read back separately. */
  readonly text: string;
}

/** Install a share sheet that keeps every file it was handed. */
async function installBundleShareStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = { calls: 0, files: [] as unknown[], handles: [] as File[] };
    (window as unknown as Record<string, unknown>).__mfBundleShare = store;
    Object.defineProperty(navigator, 'canShare', {
      configurable: true,
      value: (data: { files?: File[] }) => Array.isArray(data.files) && data.files.length > 0,
    });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: { files?: File[] }) => {
        store.calls += 1;
        const files = data.files ?? [];
        if (files.length === 0) throw new Error('share was called with no files');
        store.handles = files;
        store.files = await Promise.all(
          files.map(async (file) => ({
            name: file.name,
            type: file.type,
            size: file.size,
            text: file.type === 'application/json' ? await file.text() : '',
          })),
        );
      },
    });
  });
}

async function sharedBundleFiles(page: Page): Promise<readonly SharedBundleFile[]> {
  return page.evaluate(
    () =>
      (window as unknown as { __mfBundleShare: { files: SharedBundleFile[] } }).__mfBundleShare
        .files,
  );
}

interface SharedFrameReading {
  readonly name: string;
  readonly widthPx: number;
  readonly heightPx: number;
  /** Pearson correlation of luminance against the `<video>`, −1 to 1. */
  readonly correlationWithVideo: number;
  /** Standard deviation of the frame's own luminance. A flat fill reads 0. */
  readonly sd: number;
  /** The same, for the picture on screen, so the two can be compared. */
  readonly screenSd: number;
}

/**
 * Decode every shared frame and compare it with the picture on screen.
 *
 * This is what separates "a JPEG was attached" from "the camera frame was
 * attached". The overlay is an SVG of thin marks over transparency; a render of
 * it would neither correlate with the video nor carry the video's own contrast.
 *
 * The measure is the CORRELATION of luminance, not the difference. Chromium
 * colour-manages the decoded video into a canvas and an untagged JPEG into the
 * same canvas by different routes, so the same picture comes back with a
 * systematic offset — measured at 15.5 of 255 on this fixture, uniform across
 * all six frames. A correlation is blind to that offset and to any gain, and a
 * picture of something else does not survive it.
 */
async function sharedFrameReadings(page: Page): Promise<readonly SharedFrameReading[]> {
  return page.evaluate(async () => {
    const store = (window as unknown as { __mfBundleShare: { handles: File[] } }).__mfBundleShare;
    const video = document.querySelector('video');
    if (video === null) return [];
    const readings: SharedFrameReading[] = [];
    const widthPx = 160;
    const heightPx = 90;
    for (const file of store.handles) {
      if (file.type !== 'image/jpeg') continue;
      const bitmap = await createImageBitmap(file);
      const luminance = (source: CanvasImageSource): number[] => {
        const canvas = new OffscreenCanvas(widthPx, heightPx);
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('no 2d context');
        context.drawImage(source, 0, 0, widthPx, heightPx);
        const data = context.getImageData(0, 0, widthPx, heightPx).data;
        const out: number[] = [];
        for (let index = 0; index < data.length; index += 4) {
          out.push(
            0.299 * (data[index] ?? 0) +
              0.587 * (data[index + 1] ?? 0) +
              0.114 * (data[index + 2] ?? 0),
          );
        }
        return out;
      };
      const stored = luminance(bitmap);
      const onScreen = luminance(video);
      const meanOf = (values: number[]): number =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const storedMean = meanOf(stored);
      const screenMean = meanOf(onScreen);
      let covariance = 0;
      let storedVariance = 0;
      let screenVariance = 0;
      for (let index = 0; index < stored.length; index += 1) {
        const a = (stored[index] ?? 0) - storedMean;
        const b = (onScreen[index] ?? 0) - screenMean;
        covariance += a * b;
        storedVariance += a * a;
        screenVariance += b * b;
      }
      readings.push({
        name: file.name,
        widthPx: bitmap.width,
        heightPx: bitmap.height,
        correlationWithVideo: covariance / Math.sqrt(storedVariance * screenVariance),
        sd: Math.sqrt(storedVariance / stored.length),
        screenSd: Math.sqrt(screenVariance / stored.length),
      });
    }
    return readings;
  });
}

/** Tap the picture at one point, on the field session's own tap surface. */
async function fieldTapAt(page: Page, xPx: number, yPx: number): Promise<void> {
  await tapSurfaceAt(page, 'field-session-tap-layer', xPx, yPx);
}

/** Wait until the phone has been still long enough for a capture (term 8). */
async function holdStill(page: Page): Promise<void> {
  await expect(page.getByTestId('field-session-still')).toHaveAttribute('data-braced', 'true', {
    timeout: 20_000,
  });
}

/**
 * Tap Capture and wait for the count to reach `expected`.
 *
 * A capture the screen refused says so in `field-session-capture-note`, which
 * sits below the fold on a 450 px viewport. So the note is read on failure and
 * reported, rather than the count timing out with nothing to explain it.
 */
async function capture(page: Page, expected: number): Promise<void> {
  await page.getByTestId('field-session-capture').click();
  const session = page.getByTestId('field-session');
  try {
    await expect(session).toHaveAttribute('data-capture-count', String(expected), {
      timeout: 15_000,
    });
  } catch (error) {
    const note = await page
      .getByTestId('field-session-capture-note')
      .textContent()
      .catch(() => null);
    throw new Error(
      `capture ${expected} was not taken; the screen said: ${note ?? '(nothing)'}`,
      { cause: error },
    );
  }
}

test.use({
  viewport: { width: FRAME.widthPx, height: FRAME.heightPx },
  permissions: ['camera', 'geolocation'],
  // No `accuracy`: the repository privacy gate reads a
  // latitude/longitude/accuracy key set as the shape of a recorded position
  // fix, and a test over published coordinates must not look like a capture.
  geolocation: { latitude: GORNERGRAT.lat, longitude: GORNERGRAT.lon },
  launchOptions: {
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${FIELD_VIDEO}`,
    ],
  },
});

test.describe('the field session', () => {
  test.beforeAll(async () => {
    const path = await writeFakeCameraVideo({
      widthPx: FIELD_FRAME.widthPx,
      heightPx: FIELD_FRAME.heightPx,
    });
    expect(path).toBe(FIELD_VIDEO);
  });

  test('says what it stores before it stores anything, including the photographs', async ({
    page,
  }) => {
    await installBundleShareStub(page);
    await page.goto('/live.html?session=field');

    const privacy = page.getByTestId('field-session-privacy');
    await expect(privacy).toBeVisible();
    await expect(privacy).toContainText('photographs');
    await expect(privacy).toContainText('shows where it was taken');
    await expect(privacy).toContainText('no date and no time of day');
    await expect(privacy).toContainText('Nothing is uploaded');
    await expect(privacy).toContainText('goes only where you send it');

    // Shown BEFORE the first capture, with capturing not yet possible.
    await expect(page.getByTestId('field-session')).toHaveAttribute('data-phase', 'explaining');
    await expect(page.getByTestId('field-session-start')).toBeDisabled();
    await expect(page.getByTestId('field-session-not-ready')).toBeVisible();
  });

  test('the ordinary live screen has no field session on it', async ({ page }) => {
    await page.goto('/live.html');
    await expect(page.getByTestId('live-title')).toBeVisible();
    await expect(page.getByTestId('field-session')).toHaveCount(0);
    await page.goto('/live.html?session=home');
    await expect(page.getByTestId('field-session')).toHaveCount(0);
  });

  test('walks the protocol and shares a bundle the grader accepts', async ({ page }) => {
    test.setTimeout(SCENE_TIMEOUT_MS + 240_000);

    // Every request the page makes, with its body, so the bundle can be looked
    // for on the network rather than assumed absent.
    const requests: { url: string; method: string; body: string }[] = [];
    page.on('request', (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        body: request.postData() ?? '',
      });
    });

    await installBundleShareStub(page);
    await installSensorPump(page);
    await page.goto('/live.html?session=field');
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');

    const summitBearing = bearingDeg(GORNERGRAT, MATTERHORN);
    const summitAltitude = summitAltitudeDeg();
    /** The pose injected for each capture, for the truth document below. */
    const injected: { captureId: string; headingDeg: number; pitchDeg: number }[] = [];

    const aim = async (trueHeadingDeg: number, pitchDeg: number): Promise<void> => {
      await pumpSet(page, eventAnglesFor(magneticBearingFor(trueHeadingDeg, new Date()), pitchDeg));
    };
    await aim(TRUE_HEADING_DEG, 0);
    await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
      timeout: SCENE_TIMEOUT_MS,
    });

    const session = page.getByTestId('field-session');
    await expect(page.getByTestId('field-session-start')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('field-session-start').click();

    /* ── 1. where to stand ────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'stand');
    await expect(page.getByTestId('field-session-instruction')).toContainText(
      'within a couple of hundred metres',
    );
    await page.getByTestId('field-session-next').click();

    /* ── 2. the camera width, from two taps ───────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fov-check');
    // Tapped exactly ON two drawn dots, so the fit is the identity: this run is
    // about the protocol and the bundle, and an injected camera error would put
    // the labels somewhere the truth below did not predict. What it changes is
    // `fovSource`, which F2 and F3 both require.
    // The panel covers the top of the picture, so the phone tilts up until the
    // skyline's dots sit low enough for a finger to reach them.
    await aim(TRUE_HEADING_DEG, FOV_TAP_PITCH_DEG);
    await expect
      .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 15_000 })
      .toBeCloseTo(FOV_TAP_PITCH_DEG, 1);
    const dots = await summitDots(page);
    const spread = [...dots].sort((a, b) => a.cx - b.cx);
    const left = spread[0];
    const right = spread[spread.length - 1];
    expect(left, 'no summit dots to calibrate against').toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;
    expect(right.cx - left.cx).toBeGreaterThan(MIN_SPREAD_PX);
    await fieldTapAt(page, left.cx, left.cy);
    await fieldTapAt(page, right.cx, right.cy);
    await expect(page.getByTestId('field-session-taps')).toHaveAttribute('data-tap-count', '2');
    await page.getByTestId('field-session-use-fit').click();
    await expect(page.getByTestId('live-fov-label')).toHaveAttribute(
      'data-fov-source',
      'calibrated',
      { timeout: 15_000 },
    );
    await aim(TRUE_HEADING_DEG, 0);
    await expect
      .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 15_000 })
      .toBeCloseTo(0, 1);
    await page.getByTestId('field-session-next').click();

    /* ── 3. which way the labels point ────────────────────────────────────── */
    // The re-anchor lives on the live screen, not in this panel, so the step is
    // a read: it tells the person the button is there and moves on.
    await expect(session).toHaveAttribute('data-step-id', 'fix-direction');
    await expect(page.getByTestId('field-session-instruction')).toContainText(
      'tap Fix direction',
    );
    await expect(page.getByTestId('live-reanchor')).toBeVisible();
    await page.getByTestId('field-session-next').click();

    /* ── 4. the fix ───────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fix');
    const accuracy = page.getByTestId('field-session-accuracy');
    await expect(accuracy).toBeVisible();
    await page.getByTestId('field-session-next').click();

    /* ── 5. brace ─────────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'brace');
    await holdStill(page);
    await page.getByTestId('field-session-next').click();

    /* ── 6. capture raw ───────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'capture-raw');
    await holdStill(page);
    injected.push({ captureId: 'c1', headingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
    await capture(page, 1);

    /* ── 7. the first drag, on a summit the person names ──────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'drag');
    await expect(page.getByTestId('live-drag-mode')).toHaveAttribute('data-mode', 'fine');
    const anchor = page
      .getByTestId('field-session-anchor-choice')
      .filter({ hasText: 'Matterhorn' });
    await expect(anchor).toHaveCount(1);
    const anchorId = (await anchor.getAttribute('data-summit-id')) ?? '';
    expect(anchorId).not.toBe('');
    await anchor.click();
    // Small on purpose: the injected scene is already correct, so every pixel of
    // drag is error introduced into an otherwise exact overlay. At fine gain a
    // 4 px drag moves the labels by about 1 px of the 800 px viewport.
    await dragPicture(page, 4, 0);
    await page.getByTestId('field-session-next').click();

    /* ── 8. capture after the drag ────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'capture-drag');
    await holdStill(page);
    injected.push({ captureId: 'c2', headingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
    await capture(page, 2);

    /* ── 9. the four movements § 2.4 registers ───────────────────────────── */
    // 33° off the summit's own bearing. On this frame x = 400 + 533.33·tan(δ),
    // so |δ| = 33° puts the marker 533.33 × 0.6494 = 346 px from the centre,
    // i.e. u = 0.866 — past the 0.8 target and still inside the 36.87°
    // half-field. Aiming 33° to one side of the summit's bearing drives the
    // marker to the opposite edge of the picture.
    const panLeftHeading = summitBearing + 33;
    const panRightHeading = summitBearing - 33;
    const movements = [
      { id: 'pan-left', headingDeg: panLeftHeading, pitchDeg: 0, side: 'left' },
      { id: 'pan-right', headingDeg: panRightHeading, pitchDeg: 0, side: 'right' },
      { id: 'tilt-up', headingDeg: TRUE_HEADING_DEG, pitchDeg: 10, side: undefined },
      { id: 'tilt-down', headingDeg: TRUE_HEADING_DEG, pitchDeg: -10, side: undefined },
    ] as const;

    for (const [index, movement] of movements.entries()) {
      await expect(session).toHaveAttribute('data-step-id', movement.id);
      await aim(movement.headingDeg, movement.pitchDeg);
      if (movement.side === undefined) {
        await expect
          .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 20_000 })
          .toBeCloseTo(movement.pitchDeg, 0);
      } else {
        const panLine = page.getByTestId('field-session-pan');
        await expect(panLine).toHaveAttribute('data-anchor-side', movement.side, {
          timeout: 20_000,
        });
        await expect(panLine).toHaveAttribute('data-reached', 'true', { timeout: 20_000 });
        expect(Number(await panLine.getAttribute('data-anchor-u'))).toBeGreaterThanOrEqual(0.8);
      }
      await holdStill(page);
      const captureId = `c${index + 3}`;
      injected.push({
        captureId,
        headingDeg: movement.headingDeg,
        pitchDeg: movement.pitchDeg,
      });
      await capture(page, index + 3);
    }

    /* ── 11. the two remaining drags onto the same summit ─────────────────── */
    await aim(TRUE_HEADING_DEG, 0);
    for (const repeat of [2, 3]) {
      await expect(session).toHaveAttribute('data-step-id', 'drag');
      await expect(page.getByTestId('field-session-anchor-name')).toContainText('Matterhorn');
      await page.getByTestId('field-session-reset-trim').click();
      await dragPicture(page, 4, 0);
      await page.getByTestId('field-session-next').click();

      await expect(session).toHaveAttribute('data-step-id', 'capture-drag');
      await holdStill(page);
      injected.push({ captureId: `c${repeat + 5}`, headingDeg: TRUE_HEADING_DEG, pitchDeg: 0 });
      await capture(page, repeat + 5);
    }

    /* ── 12. the second registered direction, with nothing dragged in it ──── */
    // On site this turn is about 100°, to the north-east. The injected scene is
    // one photograph, so the test turns only as far as keeps the summit in the
    // picture: what it exercises is a capture taken in a new direction, under
    // the trim the first direction set and with no anchor of its own.
    const turnedHeading = TRUE_HEADING_DEG + 20;
    await expect(session).toHaveAttribute('data-step-id', 'face-north-east');
    await aim(turnedHeading, 0);
    // The turn has to arrive before the capture step, or the heading lands
    // inside the still window and the capture is taken mid-turn.
    await expect
      .poll(async () => poseNumber(page, 'data-heading-deg'), { timeout: 20_000 })
      .toBeCloseTo(turnedHeading, 0);
    await page.getByTestId('field-session-next').click();

    for (const [index, stepId] of ['capture-north-east', 'capture-north-east-again'].entries()) {
      await expect(session).toHaveAttribute('data-step-id', stepId);
      await holdStill(page);
      const captureId = `c${index + 9}`;
      injected.push({ captureId, headingDeg: turnedHeading, pitchDeg: 0 });
      await capture(page, index + 9);
    }

    /* ── the finished bundle, on the device ───────────────────────────────── */
    await expect(session).toHaveAttribute('data-phase', 'finished', { timeout: 20_000 });
    const parse = page.getByTestId('field-session-parse');
    await expect(parse).toHaveAttribute('data-valid', 'true');
    await expect(parse).toHaveAttribute('data-problem-count', '0');
    await expect(parse).toContainText('no location, no bearing and no clock time');
    // Every capture follows the protocol, so the screen names no shortfall.
    await expect(page.getByTestId('field-session-shortfall')).toHaveCount(0);
    await expect(page.getByTestId('field-session-frames')).toContainText(
      `${FIELD_FRAME.widthPx}×${FIELD_FRAME.heightPx}`,
    );

    /* ── the share, and the decisive assertions on the shared bytes ───────── */
    await page.getByTestId('field-session-share').click();
    await expect(page.getByTestId('field-session-share-result')).toHaveAttribute(
      'data-outcome',
      'shared',
    );
    await expect(page.getByTestId('field-session-share-result')).toContainText(
      'Nothing was uploaded',
    );

    const shared = await sharedBundleFiles(page);
    expect(shared.map((file) => file.name)).toEqual([
      'mountain-finder-field-bundle.json',
      'c1.jpg',
      'c2.jpg',
      'c3.jpg',
      'c4.jpg',
      'c5.jpg',
      'c6.jpg',
      'c7.jpg',
      'c8.jpg',
      'c9.jpg',
      'c10.jpg',
    ]);
    expect(shared.filter((file) => file.type === 'image/jpeg')).toHaveLength(10);
    const bundleFile = shared[0];
    expect(bundleFile).toBeDefined();
    if (bundleFile === undefined) return;
    expect(bundleFile.type).toBe('application/json');

    const bundleDocument = JSON.parse(bundleFile.text) as unknown;
    const parsed = parseFieldBundle(bundleDocument);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.captures.map((capture) => capture.role)).toEqual([
      'before-drag',
      'after-drag',
      'moved',
      'moved',
      'moved',
      'moved',
      'after-drag',
      'after-drag',
      'turned',
      'turned',
    ]);
    // A turned capture faces a second direction and nothing was dragged in it,
    // so it names no anchor and no capture it moved from.
    for (const capture of parsed.value.captures.filter((entry) => entry.role === 'turned')) {
      expect(capture.dragAnchorSummitId).toBeUndefined();
      expect(capture.movedFromCaptureId).toBeUndefined();
    }
    // The frames are referenced by bare file name, and the file names match the
    // images that travelled with the bundle.
    expect(parsed.value.captures.map((capture) => capture.framePath)).toEqual(
      shared.slice(1).map((file) => file.name),
    );
    for (const capture of parsed.value.captures) {
      expect(capture.framePx.widthPx).toBe(FIELD_FRAME.widthPx);
      expect(capture.fovSource).toBe('calibrated');
      expect(capture.trace.stillForMs).toBeGreaterThanOrEqual(2000);
      expect(capture.trace.sampleCount).toBeGreaterThan(0);
    }
    // The four movements, all measured from the same after-drag capture: one pan
    // each way, then one tilt each way inside the graded 5–15° envelope.
    const moved = parsed.value.captures.filter((capture) => capture.role === 'moved');
    expect(moved).toHaveLength(4);
    for (const capture of moved) expect(capture.movedFromCaptureId).toBe('c2');
    const pans = moved.filter((capture) => capture.panFromReferenceDeg !== undefined);
    expect(pans).toHaveLength(2);
    expect((pans[0]?.panFromReferenceDeg ?? 0) * (pans[1]?.panFromReferenceDeg ?? 0)).toBeLessThan(
      0,
    );
    for (const capture of pans) {
      expect(Math.abs(capture.panFromReferenceDeg ?? 0)).toBeGreaterThan(20);
    }
    const tilts = moved.filter((capture) => capture.tiltFromReferenceDeg !== undefined);
    expect(tilts).toHaveLength(2);
    expect((tilts[0]?.tiltFromReferenceDeg ?? 0) * (tilts[1]?.tiltFromReferenceDeg ?? 0)).toBeLessThan(
      0,
    );
    for (const capture of tilts) {
      const magnitude = Math.abs(capture.tiltFromReferenceDeg ?? 0);
      expect(magnitude).toBeGreaterThanOrEqual(5);
      expect(magnitude).toBeLessThanOrEqual(15);
    }
    // Three drags onto the same summit, which is what § 1.6 measures the drag
    // term's spread from.
    const anchors = parsed.value.captures
      .filter((capture) => capture.role === 'after-drag')
      .map((capture) => capture.dragAnchorSummitId);
    expect(anchors).toHaveLength(3);
    expect(new Set(anchors).size).toBe(1);
    expect(anchors[0]).toBe(anchorId);

    /* ── nothing forbidden, anywhere in it ────────────────────────────────── */
    // The bundle's own scanner, not the recording's: the two ban different keys,
    // and a bundle answers to the list in `field-analysis.ts`.
    expect(findForbiddenBundleContent(bundleDocument)).toEqual([]);
    expect(findForbiddenContent(bundleDocument)).toEqual([]);
    for (const banned of [
      '"latitude"',
      '"longitude"',
      '"coords"',
      '"geolocation"',
      '"bearingDeg"',
      '"deviceId"',
      '"groupId"',
      '"label"',
      '"timestamp"',
      '"base64"',
      'data:image',
    ]) {
      expect(bundleFile.text, banned).not.toContain(banned);
    }
    expect(bundleFile.text).not.toContain(GORNERGRAT.lat.toFixed(4));
    expect(bundleFile.text).not.toContain(GORNERGRAT.lon.toFixed(4));
    // No fractional number anywhere in the file is the injected fix. 5e-5° is
    // about 5 m, so a value that close is the coordinate rather than a
    // coincidence, and a bundle full of pixels and degrees holds plenty of
    // numbers that share a latitude's leading digits without being one.
    //
    // Only numbers WITH a decimal point are scanned. A summit id's last UUID
    // group is twelve hex characters and is sometimes twelve digits, which a
    // scan of the raw text would read as an epoch. The epoch rule is enforced on
    // the parsed values instead, by the two `findForbiddenContent` calls above,
    // which walk the document rather than its text.
    const decimals = [...bundleFile.text.matchAll(/-?\d+\.\d+/g)].map((match) =>
      Math.abs(Number(match[0])),
    );
    const nearFix = decimals.filter(
      (value) =>
        Math.abs(value - GORNERGRAT.lat) < 5e-5 || Math.abs(value - GORNERGRAT.lon) < 5e-5,
    );
    expect(nearFix, 'a number in the bundle is the position fix').toEqual([]);
    expect(Math.max(...decimals)).toBeLessThan(EPOCH_FLOOR);
    // The one thing it does say about the fix, and what that number means. The
    // figure itself is 0 here, because Playwright's fake fix carries no accuracy
    // and the platform reports 0 for it; a phone reports metres. What is checked
    // is that every capture carries the number and that its convention is
    // declared, which is what the parser requires of the pair.
    expect(parsed.value.accuracyConvention).toBe('w3c-95-percent-horizontal-radius');
    for (const capture of parsed.value.captures) {
      expect(capture.horizontalAccuracyM).toBeDefined();
      expect(capture.horizontalAccuracyM ?? -1).toBeGreaterThanOrEqual(0);
    }

    /* ── the frames are the camera's, not the overlay's ───────────────────── */
    const readings = await sharedFrameReadings(page);
    expect(readings).toHaveLength(10);
    for (const reading of readings) {
      expect(reading.widthPx, reading.name).toBeGreaterThanOrEqual(1920);
      expect(reading.heightPx, reading.name).toBe(FIELD_FRAME.heightPx);
      // A render of the overlay would be thin marks over transparency, which is
      // flat once composited. The photograph is not, and it carries about as
      // much contrast as the picture on screen.
      expect(reading.sd, reading.name).toBeGreaterThan(5);
      expect(reading.sd / reading.screenSd, reading.name).toBeGreaterThan(0.6);
      expect(reading.sd / reading.screenSd, reading.name).toBeLessThan(1.7);
      // And it is the SAME picture the app is drawing over. This fixture
      // measures 0.923, the same figure for all six frames: Chromium tone-maps
      // the decoded video and the untagged JPEG by different routes, so the
      // stored frame comes back with more contrast (sd 63.7 against 56.9) than
      // the one on screen. The threshold is set below that and far above what a
      // different picture reaches — an overlay render has no variance at all,
      // which makes the correlation undefined and fails this outright.
      expect(reading.correlationWithVideo, reading.name).toBeGreaterThan(0.85);
    }
    // The overlay was on screen the whole time and did not get into the files.
    expect((await summitDots(page)).length).toBeGreaterThan(0);

    /* ── and nothing carried it off the phone ─────────────────────────────── */
    const carriers = requests.filter(
      (request) =>
        request.body.includes('field-bundle') ||
        request.body.includes('ms-since-session-start') ||
        request.body.includes('framePath'),
    );
    expect(carriers, 'a request carried the bundle').toEqual([]);
    const foreign = requests.filter(
      (request) =>
        !/^(blob:)?http:\/\/localhost:\d+\//.test(request.url) && !request.url.startsWith('data:'),
    );
    expect(foreign.map((request) => request.url), 'the session called a foreign origin').toEqual([]);
    expect(requests.filter((request) => request.method !== 'GET')).toEqual([]);

    /* ── left on disk for `npm run analyze:field` ─────────────────────────── */
    // The truth apexes come from the INJECTED pose through this file's own
    // projection, never from the overlay the app drew, and they are stated in
    // the stored frame's pixels — the overlay's space scaled by 2.4. Two
    // annotators straddle each apex by ±2 px, so their midpoint is it exactly
    // and their disagreement is 4 px, which at 1920 px is 0.179°, well inside
    // the 0.30° above which a summit is `truth-disputed`.
    const truthFor = (captureId: string): unknown => {
      const at = injected.find((entry) => entry.captureId === captureId);
      if (at === undefined) throw new Error(`no injected pose for ${captureId}`);
      const apex = projectIndependently(
        { headingDeg: at.headingDeg, pitchDeg: at.pitchDeg, rollDeg: 0, ...VISIBLE_FOV },
        summitBearing,
        summitAltitude,
      );
      const xPx = apex.xPx * FRAME_SCALE;
      const yPx = apex.yPx * FRAME_SCALE;
      return {
        captureId,
        readings: [
          {
            annotatorId: 'closed-form-a',
            method: 'bare-frame',
            apexes: [{ summitId: anchorId, apexPx: { xPx: xPx - 2, yPx } }],
          },
          {
            annotatorId: 'closed-form-b',
            method: 'bare-frame',
            apexes: [{ summitId: anchorId, apexPx: { xPx: xPx + 2, yPx } }],
          },
        ],
      };
    };
    mkdirSync(FIELD_OUT_DIR, { recursive: true });
    writeFileSync(resolve(FIELD_OUT_DIR, 'bundle.json'), bundleFile.text);
    writeFileSync(
      resolve(FIELD_OUT_DIR, 'truth.json'),
      `${JSON.stringify(
        {
          format: 'mountain-finder/field-apex-truth@2',
          procedure:
            'closed-form projection of the injected pose, straddled by ±2 px; no annotator looked at a picture',
          captures: parsed.value.captures.map((capture) => truthFor(capture.captureId)),
        },
        null,
        2,
      )}\n`,
    );
  });

  test('offers the summits the frame had no room to name, and names the one picked', async ({
    page,
  }) => {
    // On this 800 px frame the label budget is smaller than the number of
    // summits in view, so the overlay leaves some of them a dot and no name.
    // The protocol's anchor can be one of those, and a dot cannot be picked by
    // name. The picker therefore offers every summit in the picture, and the
    // layout keeps a label for whichever one is named.
    //
    // The pan at the end is the second thing this proves: a deliberate turn
    // moves the compass and the phone's own yaw together, so it is not drift.
    test.setTimeout(SCENE_TIMEOUT_MS + 240_000);

    await installBundleShareStub(page);
    await installSensorPump(page);
    await page.goto('/live.html?session=field');
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');

    const aim = async (trueHeadingDeg: number, pitchDeg: number): Promise<void> => {
      await pumpSet(page, eventAnglesFor(magneticBearingFor(trueHeadingDeg, new Date()), pitchDeg));
    };
    await aim(TRUE_HEADING_DEG, 0);
    await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
      timeout: SCENE_TIMEOUT_MS,
    });

    const session = page.getByTestId('field-session');
    await expect(page.getByTestId('field-session-start')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('field-session-start').click();

    /* ── to the first drag, by the shortest legal route ───────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'stand');
    await page.getByTestId('field-session-next').click();

    await expect(session).toHaveAttribute('data-step-id', 'fov-check');
    // The panel covers the top of the picture, so the phone tilts up until the
    // skyline's dots sit low enough for a finger to reach them.
    await aim(TRUE_HEADING_DEG, FOV_TAP_PITCH_DEG);
    await expect
      .poll(async () => poseNumber(page, 'data-pitch-deg'), { timeout: 15_000 })
      .toBeCloseTo(FOV_TAP_PITCH_DEG, 1);
    const dots = await summitDots(page);
    const spread = [...dots].sort((a, b) => a.cx - b.cx);
    const left = spread[0];
    const right = spread[spread.length - 1];
    expect(left, 'no summit dots to calibrate against').toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;
    await fieldTapAt(page, left.cx, left.cy);
    await fieldTapAt(page, right.cx, right.cy);
    await page.getByTestId('field-session-use-fit').click();
    await expect(page.getByTestId('live-fov-label')).toHaveAttribute(
      'data-fov-source',
      'calibrated',
      { timeout: 15_000 },
    );
    await page.getByTestId('field-session-next').click();

    /* ── the direction is fixed on a summit, so the drift line exists ─────── */
    // A summit rather than the sun: the sun is below the horizon for part of
    // every day and this test must not depend on the hour it runs at. The tap
    // lands on the summit's own drawn dot, so the correction is about nothing
    // and the anchor is what the step is for.
    await expect(session).toHaveAttribute('data-step-id', 'fix-direction');
    // Still tilted up, and turned so the Matterhorn sits right of centre. The
    // re-anchor's own controls cover the middle of the bottom strip.
    const reanchorHeadingDeg = TRUE_HEADING_DEG - 20;
    await aim(reanchorHeadingDeg, FOV_TAP_PITCH_DEG);
    await holdStillForReanchor(page);
    await page.getByTestId('live-reanchor-summit').click();
    const picker = page.getByTestId('live-reanchor-summit-name');
    // By the start of the name: "Klein Matterhorn" sorts first and is a different summit.
    const matterhornId = await picker
      .locator('option', { hasText: /^Matterhorn / })
      .first()
      .getAttribute('value');
    expect(matterhornId).not.toBeNull();
    await picker.selectOption(matterhornId ?? '');
    const summitPx = projectIndependently(
      { headingDeg: reanchorHeadingDeg, pitchDeg: FOV_TAP_PITCH_DEG, rollDeg: 0, ...VISIBLE_FOV },
      bearingDeg(GORNERGRAT, MATTERHORN),
      summitAltitudeDeg(),
    );
    await tapReanchorAt(page, summitPx.xPx, summitPx.yPx);
    // The tap is on the real summit and the compass is right, so the move is near zero.
    const move = Number(await page.getByTestId('live-reanchor-confirm').getAttribute('data-move-deg'));
    expect(Math.abs(move)).toBeLessThan(1);
    await page.getByTestId('live-reanchor-confirm-yes').click();
    await expect(page.getByTestId('live-reanchor')).toHaveAttribute(
      'data-anchor-source',
      'summit',
    );
    await aim(TRUE_HEADING_DEG, 0);
    await page.getByTestId('field-session-next').click();

    await expect(session).toHaveAttribute('data-step-id', 'fix');
    await page.getByTestId('field-session-next').click();

    await expect(session).toHaveAttribute('data-step-id', 'brace');
    await holdStill(page);
    await page.getByTestId('field-session-next').click();

    await expect(session).toHaveAttribute('data-step-id', 'capture-raw');
    await holdStill(page);
    await capture(page, 1);

    /* ── the picker at the drag step, on a view that crowds ───────────────── */
    // Which way to look for a crowded view depends on the field of view, and
    // this session has just measured its own. So the test turns until the
    // overlay reports summits it had no room to name, rather than assuming a
    // heading that crowded under some other lens.
    await expect(session).toHaveAttribute('data-step-id', 'drag');
    const labels = page.getByTestId('live-labels');
    const settled = async (): Promise<{ labelled: number; crowded: number }> => {
      // The pose is fused over a 1.5 s window, so the counts mean nothing until
      // that window holds only samples from the new heading.
      await page.waitForTimeout(1800);
      return {
        labelled: Number(await labels.getAttribute('data-label-count')),
        crowded: Number(await labels.getAttribute('data-crowded-out-count')),
      };
    };
    let counts = { labelled: 0, crowded: 0 };
    let crowdedHeadingDeg = 0;
    for (let headingDeg = 0; headingDeg < 360; headingDeg += 10) {
      await aim(headingDeg, 0);
      counts = await settled();
      crowdedHeadingDeg = headingDeg;
      if (counts.crowded > 0) {
        console.log(
          `crowding at ${headingDeg}°: ${counts.labelled} named, ${counts.crowded} left as dots`,
        );
        break;
      }
    }
    expect(
      counts.crowded,
      'no heading in this scene spent the label budget, so there is no crowding to pick out of',
    ).toBeGreaterThan(0);
    const labelledCount = counts.labelled;
    const crowdedOutCount = counts.crowded;

    const choices = page.getByTestId('field-session-anchor-choice');
    // Every summit in the picture is offered, named or not. The two counts are
    // the layout's own, so this is the picker against the frame it came from.
    // Summits with no name at all are left out, so the picker may offer fewer.
    expect(await choices.count()).toBeGreaterThan(labelledCount);
    expect(await choices.count()).toBeLessThanOrEqual(labelledCount + crowdedOutCount);

    const firstDotted = page
      .locator('[data-testid="field-session-anchor-choice"][data-crowded-out="true"]')
      .first();
    await expect(firstDotted).toBeVisible();
    const dottedName = ((await firstDotted.textContent()) ?? '').replace(' (dot only)', '').trim();
    expect(dottedName).not.toBe('');
    // It has a dot and no name right now: the overlay does not list it.
    expect(await labels.textContent()).not.toContain(dottedName);

    /* ── naming it puts it on the picture ─────────────────────────────────── */
    await firstDotted.click();
    await expect(page.getByTestId('field-session-anchor-name')).toContainText(dottedName);
    await expect(labels).toContainText(dottedName, { timeout: 15_000 });
    // It spent no other summit's slot: the frame names at least as many as before.
    expect(Number(await labels.getAttribute('data-label-count'))).toBeGreaterThanOrEqual(
      labelledCount,
    );

    /* ── and a deliberate pan is not drift ────────────────────────────────── */
    const drift = page.getByTestId('live-anchor-drift');
    await expect(drift).toHaveAttribute('data-beyond-band', 'false');
    // A further 30° of turn. The pose is fused over a window, so the compass
    // reading lags the turn by a few tenths of a second; the poll waits for it
    // to arrive before the two are compared.
    await aim(crowdedHeadingDeg + 30, 0);
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
  });

  test('a missed landmark is not a tap on the Sun, and a re-anchor gets the next tap', async ({
    page,
  }) => {
    // The live screen reads an unclaimed tap as a tap on the real Sun, because
    // the home step asks for the Sun. The field sweep asks for landmarks, so an
    // unclaimed tap here must not reach that check. At this instant the Sun is
    // 37° up at azimuth 129°, about 136° left of where the camera points, so a
    // tap solved against it would put the compass far out and raise the warning.
    //
    // The tap goes in the sky above the skyline, where the implied tilt error is
    // under 15°. Further down, the Sun solve refuses the tap for tilt before any
    // warning, and the test could not tell the fix from that refusal.
    test.setTimeout(SCENE_TIMEOUT_MS + 120_000);
    const PITCH_DEG = 5;
    const FIXED_TIME = new Date('2026-04-02T09:00:00Z');
    const sun = sunPosition(
      FIXED_TIME,
      { lat: GORNERGRAT.lat, lon: GORNERGRAT.lon, heightM: OBSERVER_EYE_M },
      { refraction: true },
    );
    expect(sun.altitudeDeg).toBeGreaterThan(30);

    await page.clock.setFixedTime(FIXED_TIME);
    await installBundleShareStub(page);
    await installSensorPump(page);
    await page.goto('/live.html?session=field');
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');
    await pumpSet(
      page,
      eventAnglesFor(magneticBearingFor(TRUE_HEADING_DEG, FIXED_TIME), PITCH_DEG),
    );
    await expect(page.getByTestId('live-scene-state')).toHaveAttribute('data-scene', 'ready', {
      timeout: SCENE_TIMEOUT_MS,
    });

    const session = page.getByTestId('field-session');
    await expect(page.getByTestId('field-session-start')).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId('field-session-start').click();
    await page.getByTestId('field-session-next').click();
    await expect(session).toHaveAttribute('data-step-id', 'fov-check');

    // A point on the tap surface, clear of the panel, further than the claim
    // radius from every summit dot, and high enough for the Sun solve to run.
    const dots = await summitDots(page);
    expect(dots.length).toBeGreaterThan(0);
    const focalYPx = FRAME.heightPx / 2 / Math.tan((VISIBLE_FOV.vFovDeg * DEG) / 2);
    const maxYPx =
      FRAME.heightPx / 2 - focalYPx * Math.tan((sun.altitudeDeg - 15 - PITCH_DEG) * DEG);
    const clear = await openPointOn(page, 'field-session-tap-layer', {
      avoid: dots,
      radiusPx: MAX_TAP_DISTANCE_PX + 20,
      maxYPx,
    });
    expect(clear, 'no open point on the tap surface').toBeDefined();
    if (clear === undefined) return;

    await fieldTapAt(page, clear.xPx, clear.yPx);
    // The note and the warning are set in the same handler, so once the note
    // shows, a warning would show too.
    await expect(page.getByTestId('field-session-tap-note')).toContainText(
      'not near anything the app has drawn',
    );
    await expect(page.getByTestId('field-session-taps')).toHaveAttribute('data-tap-count', '0');
    await expect(page.getByTestId('live-gross-warning')).toHaveCount(0);

    // The panel's tap surface is in the top strip, which stacks above the
    // re-anchor's. So it must step aside while a re-anchor is armed, or the
    // re-anchor never receives the tap.
    await holdStillForReanchor(page);
    await page.getByTestId('live-reanchor-sun').click();
    await expect(page.getByTestId('field-session-tap-layer')).toHaveCount(0);
    const open = await openPointOn(page, 'live-reanchor-tap-layer', {
      avoid: [],
      radiusPx: 0,
      maxYPx,
    });
    expect(open, 'no open point on the re-anchor surface').toBeDefined();
    if (open === undefined) return;
    // Solved as the Sun, so the labels turn a long way. The point here is only
    // that the re-anchor received the tap.
    await tapReanchorAt(page, open.xPx, open.yPx);
    await expect(page.getByTestId('live-reanchor')).toHaveAttribute('data-anchor-source', 'sun');
    await expect(page.getByTestId('field-session-tap-layer')).toBeVisible();
    await expect(page.getByTestId('field-session-taps')).toHaveAttribute('data-tap-count', '0');
  });
});

/**
 * The highest point, no lower than `maxYPx`, where the named surface is topmost
 * and which is further than `radiusPx` from every one of `avoid`.
 */
async function openPointOn(
  page: Page,
  testId: string,
  limits: {
    readonly avoid: readonly { cx: number; cy: number }[];
    readonly radiusPx: number;
    readonly maxYPx: number;
  },
): Promise<{ xPx: number; yPx: number } | undefined> {
  return page.evaluate(
    ({ testId, avoid, widthPx, radiusPx, maxYPx }) => {
      for (let yPx = 5; yPx <= maxYPx; yPx += 10) {
        for (let xPx = 10; xPx < widthPx; xPx += 10) {
          const hit = document.elementFromPoint(xPx, yPx);
          if (hit?.getAttribute('data-testid') !== testId) continue;
          if (avoid.every((dot) => Math.hypot(dot.cx - xPx, dot.cy - yPx) > radiusPx)) {
            return { xPx, yPx };
          }
        }
      }
      return undefined;
    },
    { testId, widthPx: FRAME.widthPx, ...limits },
  );
}
