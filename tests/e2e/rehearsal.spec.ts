import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import {
  findForbiddenContent as findForbiddenBundleContent,
  parseFieldBundle,
  type Capture,
} from '../../src/live/field-analysis';
import { findForbiddenContent } from '../../src/live/recording';
import { FAKE_CAMERA_DIR, writeFakeCameraVideo } from './support/fake-camera';
import { eventAnglesFor, installSensorPump, preinstalled, pumpSet } from './support/gornergrat';
import {
  capture,
  fieldTapAt,
  holdStill,
  installBundleShareStub,
  sharedBundleFiles,
  sharedBytes,
  summitDots,
} from './support/field-run';
import {
  DEG,
  EYE_ABOVE_GROUND_M,
  PHOTO_PATH,
  PHOTO_POSE,
  ROOT,
  SITE_GROUND_M,
  SITE_ID,
  SITE_PACKAGE_MANIFEST,
  apparentAltitudeDeg,
  bearingDeg,
  currentTrim,
  fovForFrame,
  dragPictureFrom,
  drawnPose,
  magneticBearingAt,
  projectInto,
  rangeM,
  regionPeaks,
  serveSitePackage,
  type SitePeak,
} from './support/bogus-basin';

/* ══════════════════════════════════════════════════════════════════════════
 * THE HEADLESS DRESS REHEARSAL, AT BOGUS BASIN, ON THE REAL PHOTOGRAPH
 * ══════════════════════════════════════════════════════════════════════════
 * `field-session.spec.ts` proves the guided sequence and the bundle against a
 * synthetic Alpine scene. This runs the same sequence against everything the
 * field session will actually meet: the packaged Bogus Basin terrain at its own
 * 60 km radius, the committed `idaho-bogus-basin` peak region, the position and
 * true heading IMG_7270's EXIF carries, and IMG_7270 itself as the camera.
 *
 * ── WHAT IS DELIBERATELY WRONG ─────────────────────────────────────────────
 * The sensors are given the photograph's documented heading plus 8° and its
 * documented pitch minus 2°. So the overlay starts wrong by a known amount, the
 * drag has real work to do, and the residual after the drag is a measurement
 * rather than a rounding error. 8° is inside the 5–15° this repository records
 * for a phone compass; 2° is the order of the unrecorded pitch.
 *
 * ── WHAT THIS RUN CANNOT DECIDE ────────────────────────────────────────────
 * 1. **The fake camera cannot move.** Chromium serves one still frame, so when
 *    the sensors pan and tilt for the F4 captures, the picture behind the
 *    overlay does not move with them. On a real phone the frame and the sensors
 *    move together. **F4 on this rehearsal therefore tests the overlay's
 *    arithmetic under a moving pose, and nothing about whether the labels agree
 *    with the photograph.** Only the two captures taken at the photograph's own
 *    pose — the raw one and the first after-drag one — can be compared with the
 *    picture at all.
 * 2. **The documented pose has no pitch.** EXIF records none, so the documented
 *    pose's pitch is zero and the drag target below is computed at zero.
 *    `docs/REAL-PHOTO-POSE.md` records this viewpoint as looking slightly down
 *    by an unmeasured amount (eyeball reading, n = 1). Any vertical residual an
 *    annotator later measures carries that unknown inside it.
 * 3. **Nobody has annotated the photograph.** `out/rehearsal/ANNOTATE.md` is the
 *    brief that asks two people to, and until they answer there is no truth to
 *    grade against. The truth document this spec writes is SYNTHETIC — it is the
 *    injected pose projected back onto the frame — and it exists to exercise the
 *    grader, not to say where a summit is.
 *
 * ── THE FRAME ──────────────────────────────────────────────────────────────
 * The app asks the camera for 1920 × 1080 and the photograph is 8064 × 6048, so
 * the fake camera is the photograph CENTRE-CROPPED to 16:9 rather than squeezed
 * into it: the full 73.74° width of the 24 mm-equivalent lens survives, and the
 * top and bottom eighths of the picture do not. The viewport is 800 × 450, the
 * same 16:9, so `object-fit: cover` crops nothing further and the stored frame
 * is the overlay's own space scaled by exactly 2.4 on both axes.
 *
 * That last point is load-bearing. `residualOf` in the grader scales the overlay
 * into the stored frame by a plain ratio of widths and of heights, with no
 * offset, which is right only when the two share an aspect ratio. A 4:3 camera
 * in a 16:9 viewport would break it: the visible picture is then a 75 % crop of
 * the stored frame's width, and every horizontal residual would be scaled by
 * 2.4 where the truth is 1.8 about a shifted centre.
 *
 * ── HOW IT IS GATED ────────────────────────────────────────────────────────
 * `data/sites/bogus-basin/` is gitignored and built by `npm run site:package`.
 * Without it there is no 60 km mosaic to sweep, so the whole file skips, which
 * is what happens in CI.
 */

/** A 60 km mosaic fetch and a 360° sweep, on a throttled shared runner. */
const SCENE_TIMEOUT_MS = 240_000;

const FRAME = { widthPx: 800, heightPx: 450 } as const;
const CAMERA = { widthPx: 1920, heightPx: 1080 } as const;
const CAMERA_VIDEO = resolve(
  FAKE_CAMERA_DIR,
  `fake-camera-hdr-gainmap-7270-${CAMERA.widthPx}x${CAMERA.heightPx}.y4m`,
);

/** What the overlay and the stored frame both span, from the documented lens. */
const VISIBLE_FOV = fovForFrame(CAMERA.widthPx, CAMERA.heightPx);

/** Overlay pixels to stored-frame pixels. Exact: 1920/800 = 1080/450 = 2.4. */
const FRAME_SCALE = CAMERA.widthPx / FRAME.widthPx;

/** The errors injected into the sensors, so the raw overlay is wrong by a known amount. */
const COMPASS_ERROR_DEG = 8;
const PITCH_ERROR_DEG = -2;

/** The peak region cut for this site's 60 km disc. */
const PEAK_REGION = 'idaho-bogus-basin';

const OUT_DIR = resolve(ROOT, 'out/rehearsal');
const FRAMES_DIR = resolve(OUT_DIR, 'frames');

/** Where the anchor may start, so an F4 pan can still reach either edge. */
const MAX_ANCHOR_OFFSET_U = 0.6;
/** Where an F4 pan puts the anchor. The registered target is 0.8. */
const PAN_TARGET_U = 0.85;

interface Candidate extends SitePeak {
  readonly bearingDeg: number;
  readonly rangeKm: number;
  readonly altitudeDeg: number;
  /** Offset from the frame centre at the documented pose, 0 centre, 1 edge. */
  readonly offsetU: number;
}

/**
 * Every named summit the documented pose puts in frame, with its own geometry.
 *
 * Bearing, range and apparent altitude come from this file's geodesy over the
 * committed peak region's coordinates, never from the app.
 */
function inFrameCandidates(): readonly Candidate[] {
  const eyeM = SITE_GROUND_M + EYE_ABOVE_GROUND_M;
  const halfFieldTan = Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2);
  const out: Candidate[] = [];
  for (const peak of regionPeaks(PEAK_REGION)) {
    const bearing = bearingDeg(PHOTO_POSE, peak);
    const distanceM = rangeM(PHOTO_POSE, peak);
    const delta = ((bearing - PHOTO_POSE.headingDeg + 540) % 360) - 180;
    if (Math.abs(delta) >= 90) continue;
    const offsetU = Math.abs(Math.tan(delta * DEG)) / halfFieldTan;
    if (offsetU > 1) continue;
    out.push({
      ...peak,
      bearingDeg: bearing,
      rangeKm: distanceM / 1000,
      altitudeDeg: apparentAltitudeDeg(eyeM, peak.elevationM, distanceM),
      offsetU,
    });
  }
  return [...out].sort((left, right) => right.altitudeDeg - left.altitudeDeg);
}

/**
 * Wait for the pan readout to settle and report where the anchor is drawn.
 *
 * `field-session-pan` is the same line the person on site reads while turning,
 * and it reports `''` when the anchor has left the picture.
 */
async function anchorOffset(page: Page): Promise<{ u: number; side: string } | undefined> {
  const line = page.getByTestId('field-session-pan');
  const raw = await line.getAttribute('data-anchor-u');
  if (raw === null || raw === '') return undefined;
  return { u: Number(raw), side: (await line.getAttribute('data-anchor-side')) ?? '' };
}

test.use({
  viewport: { width: FRAME.widthPx, height: FRAME.heightPx },
  permissions: ['camera', 'geolocation'],
  // No `accuracy`: the repository privacy gate reads a
  // latitude/longitude/accuracy key set as the shape of a recorded position fix.
  geolocation: { latitude: PHOTO_POSE.lat, longitude: PHOTO_POSE.lon },
  launchOptions: {
    ...(existsSync(preinstalled) ? { executablePath: preinstalled } : {}),
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${CAMERA_VIDEO}`,
    ],
  },
});

test.describe('the field session, rehearsed at Bogus Basin on IMG_7270', () => {
  test.skip(
    () => !existsSync(SITE_PACKAGE_MANIFEST),
    `data/sites/${SITE_ID}/ is not built; run: npm run site:package -- ${SITE_ID}`,
  );

  test.beforeAll(async () => {
    const path = await writeFakeCameraVideo({
      photo: PHOTO_PATH,
      widthPx: CAMERA.widthPx,
      heightPx: CAMERA.heightPx,
      cropToAspect: true,
    });
    expect(path).toBe(CAMERA_VIDEO);
  });

  test('runs the whole protocol and leaves a bundle, frames and an annotation brief', async ({
    page,
  }) => {
    test.setTimeout(SCENE_TIMEOUT_MS + 480_000);

    const requests: { url: string; method: string }[] = [];
    page.on('request', (request) =>
      requests.push({ url: request.url(), method: request.method() }),
    );

    await installBundleShareStub(page);
    await installSensorPump(page);
    await serveSitePackage(page, SITE_ID);

    /** Inject a true heading and pitch at this site's declination. */
    const aim = async (trueHeadingDeg: number, pitchDeg: number): Promise<void> => {
      await pumpSet(
        page,
        eventAnglesFor(magneticBearingAt(PHOTO_POSE, trueHeadingDeg, new Date()), pitchDeg),
      );
    };
    /** The sensor pose for a capture taken at the documented pose. */
    const RAW_HEADING_DEG = PHOTO_POSE.headingDeg + COMPASS_ERROR_DEG;
    const RAW_PITCH_DEG = PHOTO_POSE.pitchDeg + PITCH_ERROR_DEG;

    /** What was injected for each capture, for the synthetic truth document. */
    const injected: { captureId: string; headingDeg: number; pitchDeg: number }[] = [];

    await page.goto('/live.html?session=field');
    await page.getByTestId('live-start').click();
    await expect(page.getByTestId('live-root')).toHaveAttribute('data-phase', 'running');
    await aim(RAW_HEADING_DEG, RAW_PITCH_DEG);

    const sceneState = page.getByTestId('live-scene-state');
    await expect(sceneState).toHaveAttribute('data-scene', 'ready', {
      timeout: SCENE_TIMEOUT_MS,
    });

    /* ── the sweep the site package paid for ──────────────────────────────── */
    await expect(sceneState).toHaveAttribute('data-max-range-km', '60');
    await expect(sceneState).toHaveAttribute('data-rays-requested', '720');
    await expect(sceneState).toHaveAttribute('data-rays-with-terrain', '720');
    const sweepMs = Number(await sceneState.getAttribute('data-sweep-ms'));
    expect(sweepMs).toBeGreaterThan(0);
    const labels = page.getByTestId('live-labels');
    const labelled = {
      labelled: Number(await labels.getAttribute('data-label-count')),
      offFrame: Number(await labels.getAttribute('data-off-frame-count')),
      crowdedOut: Number(await labels.getAttribute('data-crowded-out-count')),
    };
    console.log(
      `rehearsal sweep: 720/720 rays to 60 km in ${sweepMs.toFixed(0)} ms in the browser; ` +
        `${labelled.labelled} labelled, ${labelled.offFrame} off frame, ` +
        `${labelled.crowdedOut} crowded out at the raw pose`,
    );

    /* ── the observer height the app read, against the documented DEM ─────── */
    const heightNote = page.getByTestId('live-ground-height');
    await expect(heightNote).toHaveAttribute('data-ground-source', 'terrain');
    const heightText = (await heightNote.textContent()) ?? '';
    const heightMatch = /([\d.]+) m of ground plus ([\d.]+) m of eye height/.exec(heightText);
    expect(heightMatch, `the height note did not name its two parts: ${heightText}`).not.toBeNull();
    if (heightMatch === null) return;
    // docs/REAL-PHOTO-POSE.md records SRTM reading 2308.3 m at this coordinate.
    // A metre of disagreement would mean the served mosaic is not that terrain.
    expect(Number(heightMatch[1])).toBeCloseTo(SITE_GROUND_M, 0);
    expect(Number(heightMatch[2])).toBeCloseTo(EYE_ABOVE_GROUND_M, 2);

    /* ── the lens the app assumed, against the documented lens ────────────── */
    // The spec-sheet guess is the phone's 24 mm-equivalent main lens, which is
    // the lens IMG_7270 was taken with, so the frame really does span 73.74°.
    const startPose = await drawnPose(page);
    expect(startPose.hFovDeg).toBeCloseTo(VISIBLE_FOV.hFovDeg, 2);
    expect(startPose.vFovDeg).toBeCloseTo(VISIBLE_FOV.vFovDeg, 2);

    const session = page.getByTestId('field-session');
    await expect(page.getByTestId('field-session-start')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('field-session-start').click();

    /* ── 1. where to stand ────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'stand');
    await page.getByTestId('field-session-next').click();

    /* ── 2. the camera width, from two taps ───────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fov-check');
    // Tapped exactly ON two drawn dots, so the fit is the identity. The point of
    // this run is the protocol and the drag, and a camera error injected here
    // would move the labels somewhere the drag target below did not predict.
    // What it changes is `fovSource`, which F2 and F3 both require.
    const dots = [...(await summitDots(page))].sort((a, b) => a.cx - b.cx);
    const left = dots[0];
    const right = dots[dots.length - 1];
    expect(left, 'no summit dots to calibrate against').toBeDefined();
    expect(right).toBeDefined();
    if (left === undefined || right === undefined) return;
    expect(right.cx - left.cx).toBeGreaterThan(0.1 * FRAME.widthPx);
    await fieldTapAt(page, left.cx, left.cy);
    await fieldTapAt(page, right.cx, right.cy);
    await expect(page.getByTestId('field-session-taps')).toHaveAttribute('data-tap-count', '2');
    await page.getByTestId('field-session-use-fit').click();
    await expect(page.getByTestId('live-fov-label')).toHaveAttribute(
      'data-fov-source',
      'calibrated',
      { timeout: 15_000 },
    );
    await page.getByTestId('field-session-next').click();

    /* ── 3. the fix ───────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fix');
    await expect(page.getByTestId('field-session-accuracy')).toBeVisible();
    await page.getByTestId('field-session-next').click();

    /* ── 4. brace ─────────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'brace');
    await holdStill(page);
    await page.getByTestId('field-session-next').click();

    /* ── 5. capture raw ───────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'capture-raw');
    await holdStill(page);
    injected.push({ captureId: 'c1', headingDeg: RAW_HEADING_DEG, pitchDeg: RAW_PITCH_DEG });
    await capture(page, 1);

    /* ── 6. the anchor, chosen by a rule fixed before the run ─────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'drag');
    const choices = page.getByTestId('field-session-anchor-choice');
    await expect(choices.first()).toBeVisible({ timeout: 20_000 });
    const drawnIds = await choices.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-summit-id') ?? ''),
    );
    // The rule: of the named summits the documented pose puts in frame, take the
    // greatest apparent height among those the overlay actually drew, more than
    // 1 km away — the viewpoint's own summit is underfoot — and near enough to
    // the frame centre that an F4 pan can still carry it to either edge.
    const anchor = inFrameCandidates().find(
      (peak) =>
        peak.rangeKm > 1 && peak.offsetU <= MAX_ANCHOR_OFFSET_U && drawnIds.includes(peak.id),
    );
    expect(
      anchor,
      `no drawn summit met the anchor rule; the overlay drew ${drawnIds.length} summits`,
    ).toBeDefined();
    if (anchor === undefined) return;
    console.log(
      `rehearsal anchor: ${anchor.name} — ${anchor.elevationM} m, ` +
        `${anchor.rangeKm.toFixed(2)} km, bearing ${anchor.bearingDeg.toFixed(3)}°, ` +
        `apparent altitude ${anchor.altitudeDeg.toFixed(3)}°, u ${anchor.offsetU.toFixed(3)}`,
    );
    await choices.filter({ hasText: anchor.name }).first().click();
    await expect(page.getByTestId('field-session-anchor-name')).toContainText(anchor.name);

    /**
     * Where the anchor's apex sits under the photograph's DOCUMENTED pose.
     *
     * This is the drag target, and it comes from EXIF's position and heading,
     * the committed peak coordinate, and this file's own projection. The app's
     * overlay is drawn 8° and 2° away from it and has no part in computing it.
     */
    const TARGET_PX = projectInto(
      FRAME,
      { ...PHOTO_POSE, rollDeg: 0, ...VISIBLE_FOV },
      anchor.bearingDeg,
      anchor.altitudeDeg,
    );
    console.log(
      `rehearsal drag target (overlay px, documented pose): ` +
        `${TARGET_PX.xPx.toFixed(1)}, ${TARGET_PX.yPx.toFixed(1)}`,
    );

    /**
     * Drag the labels until the anchor's marker sits on that pixel.
     *
     * The loop reads the pose the screen reports and re-projects the anchor
     * through this file's own geometry, which is what the person on site does by
     * eye. Only the target is independent, and it has to be: it is the pixel the
     * residual is measured from.
     */
    /**
     * Focal length of the overlay in its own pixels, per axis.
     *
     * A drag is an angle, not a distance: the gesture turns the labels by
     * `gain · atan(strokePx / focalPx)`, so the stroke that closes a gap of
     * `n` pixels is `focalPx · tan(Δangle / gain)` and not `n / gain`. At the
     * 8° this run has to undo, the difference is 333 px against 832 px, which is
     * an overshoot wider than the picture.
     */
    const FOCAL_PX = {
      x: FRAME.widthPx / 2 / Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2),
      y: FRAME.heightPx / 2 / Math.tan((VISIBLE_FOV.vFovDeg * DEG) / 2),
    };
    const FINE_DRAG_GAIN = 0.25;
    const strokeFor = (fromPx: number, toPx: number, centrePx: number, focalPx: number): number => {
      const delta =
        Math.atan((toPx - centrePx) / focalPx) - Math.atan((fromPx - centrePx) / focalPx);
      const stroke = focalPx * Math.tan(delta / FINE_DRAG_GAIN);
      // A stroke longer than the picture cannot be made in one gesture; the loop
      // takes the rest on its next pass.
      return Math.max(-700, Math.min(700, stroke));
    };

    const dragOntoTarget = async (): Promise<number> => {
      let missPx = Number.POSITIVE_INFINITY;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const pose = await drawnPose(page);
        const at = projectInto(FRAME, pose, anchor.bearingDeg, anchor.altitudeDeg);
        missPx = Math.hypot(TARGET_PX.xPx - at.xPx, TARGET_PX.yPx - at.yPx);
        if (missPx < 0.5) break;
        await dragPictureFrom(
          page,
          FRAME,
          Math.round(strokeFor(at.xPx, TARGET_PX.xPx, FRAME.widthPx / 2, FOCAL_PX.x)),
          Math.round(strokeFor(at.yPx, TARGET_PX.yPx, FRAME.heightPx / 2, FOCAL_PX.y)),
        );
      }
      return missPx;
    };
    await expect(page.getByTestId('live-drag-mode')).toHaveAttribute('data-mode', 'fine');
    const missPx = await dragOntoTarget();
    expect(missPx, 'the drag never reached the independently projected apex').toBeLessThan(1);
    // And the app agrees: one of its own dots is on that pixel.
    const onTarget = (await summitDots(page)).filter(
      (dot) => Math.hypot(dot.cx - TARGET_PX.xPx, dot.cy - TARGET_PX.yPx) < 2,
    );
    expect(onTarget, 'no drawn dot landed on the drag target').not.toEqual([]);
    await page.getByTestId('field-session-next').click();

    /* ── 7. capture after the drag ────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'capture-drag');
    await holdStill(page);
    injected.push({ captureId: 'c2', headingDeg: RAW_HEADING_DEG, pitchDeg: RAW_PITCH_DEG });
    await capture(page, 2);

    /* ── 8. the four movements § 2.4 registers ───────────────────────────── */
    const trim = await currentTrim(page);
    const halfFieldTan = Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2);
    /** Inject a pose and wait for the fused heading to catch up with it. */
    const aimAndSettle = async (trueHeadingDeg: number, pitchDeg: number): Promise<void> => {
      await aim(trueHeadingDeg, pitchDeg);
      const wanted = ((trueHeadingDeg % 360) + 360) % 360;
      await expect
        .poll(
          async () => {
            const raw = await page.getByTestId('live-pose').getAttribute('data-sensed-heading-deg');
            const seen = ((Number(raw) % 360) + 360) % 360;
            return Math.abs(((seen - wanted + 540) % 360) - 180);
          },
          { timeout: 25_000 },
        )
        .toBeLessThan(0.2);
    };

    /**
     * Turn until the anchor's marker reaches the wanted edge of the picture.
     *
     * The first guess is arithmetic: the heading that puts the anchor at
     * u = 0.85 once the drag's trim is allowed for. The loop after it closes on
     * what the screen reports, which is what the person on site does — the
     * registered target is a position on the picture, not an angle.
     */
    const panAnchorTo = async (side: 'left' | 'right'): Promise<number> => {
      const wantDelta = (side === 'left' ? -1 : 1) * (Math.atan(PAN_TARGET_U * halfFieldTan) / DEG);
      let trueHeading = anchor.bearingDeg - wantDelta - trim.headingDeg;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await aimAndSettle(trueHeading, RAW_PITCH_DEG);
        const seen = await anchorOffset(page);
        console.log(
          `pan ${side} attempt ${attempt}: aimed ${trueHeading.toFixed(2)}°, ` +
            `anchor ${seen === undefined ? 'off picture' : `${seen.side} u=${seen.u.toFixed(3)}`}`,
        );
        if (seen === undefined) {
          // The anchor left the picture: step back toward its own bearing.
          trueHeading = (trueHeading + anchor.bearingDeg - trim.headingDeg) / 2;
          continue;
        }
        if (seen.side === side && seen.u >= 0.8) return trueHeading;
        const haveDelta = (seen.side === 'left' ? -1 : 1) * (Math.atan(seen.u * halfFieldTan) / DEG);
        trueHeading += haveDelta - wantDelta;
      }
      throw new Error(`the anchor never reached the ${side} edge`);
    };

    type Movement =
      | { readonly id: string; readonly side: 'left' | 'right' }
      | { readonly id: string; readonly tiltDeg: number };
    const movements: readonly Movement[] = [
      { id: 'pan-left', side: 'left' },
      { id: 'pan-right', side: 'right' },
      { id: 'tilt-up', tiltDeg: 10 },
      { id: 'tilt-down', tiltDeg: -10 },
    ];
    for (const [index, movement] of movements.entries()) {
      await expect(session).toHaveAttribute('data-step-id', movement.id);
      let headingDeg = RAW_HEADING_DEG;
      let pitchDeg = RAW_PITCH_DEG;
      if ('side' in movement) {
        headingDeg = await panAnchorTo(movement.side);
        const panLine = page.getByTestId('field-session-pan');
        await expect(panLine).toHaveAttribute('data-anchor-side', movement.side);
        await expect(panLine).toHaveAttribute('data-reached', 'true', { timeout: 20_000 });
      } else {
        pitchDeg = RAW_PITCH_DEG + movement.tiltDeg;
        await aim(headingDeg, pitchDeg);
        await expect
          .poll(async () => (await drawnPose(page)).pitchDeg - trim.pitchDeg, { timeout: 20_000 })
          .toBeCloseTo(pitchDeg, 0);
      }
      await holdStill(page);
      injected.push({ captureId: `c${index + 3}`, headingDeg, pitchDeg });
      await capture(page, index + 3);
    }

    /* ── 9. the two remaining drags onto the same summit ──────────────────── */
    await aim(RAW_HEADING_DEG, RAW_PITCH_DEG);
    for (const repeat of [2, 3]) {
      await expect(session).toHaveAttribute('data-step-id', 'drag');
      await expect(page.getByTestId('field-session-anchor-name')).toContainText(anchor.name);
      await page.getByTestId('field-session-reset-trim').click();
      const repeatMissPx = await dragOntoTarget();
      expect(repeatMissPx, `drag ${repeat} never reached the apex`).toBeLessThan(1);
      await page.getByTestId('field-session-next').click();

      await expect(session).toHaveAttribute('data-step-id', 'capture-drag');
      await holdStill(page);
      injected.push({ captureId: `c${repeat + 5}`, headingDeg: RAW_HEADING_DEG, pitchDeg: RAW_PITCH_DEG });
      await capture(page, repeat + 5);
    }

    /* ── the finished bundle, on the device ───────────────────────────────── */
    await expect(session).toHaveAttribute('data-phase', 'finished', { timeout: 30_000 });
    const parseNote = page.getByTestId('field-session-parse');
    await expect(parseNote).toHaveAttribute('data-valid', 'true');
    await expect(parseNote).toHaveAttribute('data-problem-count', '0');
    await expect(page.getByTestId('field-session-frames')).toContainText(
      `${CAMERA.widthPx}×${CAMERA.heightPx}`,
    );

    /* ── the share, and the bytes it was handed ───────────────────────────── */
    await page.getByTestId('field-session-share').click();
    await expect(page.getByTestId('field-session-share-result')).toHaveAttribute(
      'data-outcome',
      'shared',
    );
    const shared = await sharedBundleFiles(page);
    expect(shared.map((file) => file.name)).toEqual([
      'mountain-finder-field-bundle.json',
      ...Array.from({ length: 8 }, (_, index) => `c${index + 1}.jpg`),
    ]);
    const bundleFile = shared[0];
    expect(bundleFile).toBeDefined();
    if (bundleFile === undefined) return;

    const bundleDocument = JSON.parse(bundleFile.text) as unknown;
    const parsed = parseFieldBundle(bundleDocument);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.value.captures.map((item) => item.role)).toEqual([
      'before-drag',
      'after-drag',
      'moved',
      'moved',
      'moved',
      'moved',
      'after-drag',
      'after-drag',
    ]);
    for (const item of parsed.value.captures) {
      expect(item.framePx.widthPx).toBe(CAMERA.widthPx);
      expect(item.framePx.heightPx).toBe(CAMERA.heightPx);
      expect(item.overlayPx.widthPx).toBe(FRAME.widthPx);
      expect(item.overlayPx.heightPx).toBe(FRAME.heightPx);
      expect(item.fovSource).toBe('calibrated');
      expect(item.sweepRadiusKm).toBe(60);
    }

    /* ── nothing forbidden, anywhere in it ────────────────────────────────── */
    expect(findForbiddenBundleContent(bundleDocument)).toEqual([]);
    expect(findForbiddenContent(bundleDocument)).toEqual([]);
    expect(bundleFile.text).not.toContain(PHOTO_POSE.lat.toFixed(4));
    expect(bundleFile.text).not.toContain(Math.abs(PHOTO_POSE.lon).toFixed(4));
    const foreign = requests.filter(
      (request) =>
        !/^(blob:)?http:\/\/localhost:\d+\//.test(request.url) && !request.url.startsWith('data:'),
    );
    expect(foreign.map((request) => request.url), 'the rehearsal called a foreign origin').toEqual(
      [],
    );

    /* ── everything the annotators and the grader need, on disk ───────────── */
    mkdirSync(FRAMES_DIR, { recursive: true });
    writeFileSync(resolve(OUT_DIR, 'bundle.json'), bundleFile.text);
    const frameBytes = (await sharedBytes(page)).filter((file) => file.name.endsWith('.jpg'));
    for (const file of frameBytes) {
      writeFileSync(resolve(FRAMES_DIR, file.name), Buffer.from(file.base64, 'base64'));
    }
    // The fake camera served one still, so every stored frame must be the same
    // bytes. That is what makes the F4 caveat a measurement: the sensors moved
    // and the picture did not.
    expect(
      new Set(frameBytes.map((file) => file.base64)).size,
      'the frames differ, so the fake camera did not serve one still',
    ).toBe(1);

    /**
     * A SYNTHETIC truth document, so `npm run analyze:field` has something to
     * chew on. It is the injected pose with the injected errors removed,
     * projected through this file's geometry and straddled by ±2 px. **No
     * annotator looked at a picture, so it is not truth**: it says where the
     * pipeline's own arithmetic puts a summit, not where the summit is. The real
     * truth comes back from `ANNOTATE.md`.
     */
    const truthCaptures = parsed.value.captures.map((item) => {
      const at = injected.find((entry) => entry.captureId === item.captureId);
      if (at === undefined) throw new Error(`no injected pose for ${item.captureId}`);
      const pose = {
        headingDeg: at.headingDeg - COMPASS_ERROR_DEG,
        pitchDeg: at.pitchDeg - PITCH_ERROR_DEG,
        rollDeg: 0,
        ...VISIBLE_FOV,
      };
      const apexes: { summitId: string; apexPx: { xPx: number; yPx: number } }[] = [];
      const second: { summitId: string; apexPx: { xPx: number; yPx: number } }[] = [];
      for (const summit of item.overlay.drawn) {
        const peak = inFrameCandidates().find((entry) => entry.id === summit.summitId);
        if (peak === undefined) continue;
        const spot = projectInto(CAMERA, pose, peak.bearingDeg, peak.altitudeDeg);
        if (spot.xPx < 0 || spot.xPx > CAMERA.widthPx) continue;
        if (spot.yPx < 0 || spot.yPx > CAMERA.heightPx) continue;
        apexes.push({ summitId: summit.summitId, apexPx: { xPx: spot.xPx - 2, yPx: spot.yPx } });
        second.push({ summitId: summit.summitId, apexPx: { xPx: spot.xPx + 2, yPx: spot.yPx } });
      }
      return {
        captureId: item.captureId,
        readings: [
          { annotatorId: 'synthetic-a', apexes },
          { annotatorId: 'synthetic-b', apexes: second },
        ],
      };
    });
    writeFileSync(
      resolve(OUT_DIR, 'synthetic-truth.json'),
      `${JSON.stringify(
        {
          format: 'mountain-finder/field-apex-truth@1',
          method:
            'SYNTHETIC — NOT INDEPENDENT TRUTH. The injected sensor pose with the injected ' +
            '8 deg compass and -2 deg pitch errors removed, projected onto the stored frame and ' +
            'straddled by +/-2 px. No annotator looked at a photograph. It exists to exercise ' +
            'the grading path; every verdict it produces is about the arithmetic, not the picture.',
          captures: truthCaptures,
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      resolve(OUT_DIR, 'ANNOTATE.md'),
      annotationBrief(parsed.value.captures, {
        anchorName: anchor.name,
        anchorId: anchor.id,
        framePx: CAMERA,
      }),
    );
    writeFileSync(
      resolve(OUT_DIR, 'run-notes.md'),
      runNotes(parsed.value.captures, { sweepMs, labelled, missPx, anchor, target: TARGET_PX }),
    );
  });
});

/** Summits the overlay drew in a capture, by name, in the order it drew them. */
function drawnNames(item: Capture): readonly string[] {
  return item.overlay.drawn.map((summit) => summit.name);
}

function annotationBrief(
  captures: readonly Capture[],
  context: {
    anchorName: string;
    anchorId: string;
    framePx: { widthPx: number; heightPx: number };
  },
): string {
  const lines: string[] = [];
  lines.push('# Annotating the Bogus Basin rehearsal frames');
  lines.push('');
  lines.push(
    'Two people do this separately. Do not read the other annotator\'s answers, and do not',
    'look at anything in this directory except the frame files named below. There is no',
    'overlay to see: the frames are the bare camera picture, with nothing drawn on them.',
    'That is deliberate — an apex picked off a frame that already carries a label is not',
    'independent of the label.',
  );
  lines.push('');
  lines.push('## What to do');
  lines.push('');
  lines.push(
    `1. Open one frame at full resolution. Every frame is ${context.framePx.widthPx} x ` +
      `${context.framePx.heightPx} pixels. Pixel (0, 0)`,
    '   is the top-left corner, x runs right and y runs down.',
    '2. For each summit named under that frame, decide whether you can identify it in the',
    '   picture.',
    '3. If you can, report its apex as a pixel: the single point you judge to be the top of',
    '   that summit.',
    '4. If you cannot, report `null`. **`null` is a real answer, not a skip.** It is what',
    '   catches the app drawing a mountain that is not there.',
    '5. Write nothing else about the frame, and do not revise an earlier frame after seeing',
    '   a later one.',
  );
  lines.push('');
  lines.push('## What to hand back');
  lines.push('');
  lines.push('One JSON document, in this shape, with your own id in place of `you`:');
  lines.push('');
  lines.push('```json');
  lines.push('{');
  lines.push('  "format": "mountain-finder/field-apex-truth@1",');
  lines.push('  "method": "two independent annotators, bare frames, labelled pixel grid",');
  lines.push('  "captures": [');
  lines.push('    { "captureId": "c1", "readings": [ { "annotatorId": "you", "apexes": [');
  lines.push('      { "summitId": "<the id printed beside the name>", "apexPx": { "xPx": 0, "yPx": 0 } },');
  lines.push('      { "summitId": "<another id>", "apexPx": null }');
  lines.push('    ] } ] }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('## What is known about the frames');
  lines.push('');
  lines.push(
    '- All eight frames are the SAME photograph. The camera in this rehearsal is a file, so',
    '  it could not move. The captures differ in where the app pointed its overlay, not in',
    '  what the picture shows. Answer each frame on its own anyway: identical answers across',
    '  the eight are the expected result and are worth having on the record.',
    `- The overlay's anchor summit was ${context.anchorName} (\`${context.anchorId}\`).`,
    '- Nothing about the app\'s predicted positions is in this file, on purpose.',
  );
  lines.push('');
  lines.push('## The frames, and the summits to look for in each');
  lines.push('');
  for (const item of captures) {
    lines.push(`### frames/${item.framePath}`);
    lines.push('');
    for (const summit of item.overlay.drawn) {
      lines.push(`- ${summit.name} — \`${summit.summitId}\`, ${summit.elevationM} m`);
    }
    if (item.overlay.drawn.length === 0) lines.push('- (the overlay drew no summit in this frame)');
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function runNotes(
  captures: readonly Capture[],
  context: {
    sweepMs: number;
    labelled: { labelled: number; offFrame: number; crowdedOut: number };
    missPx: number;
    anchor: Candidate;
    target: { xPx: number; yPx: number };
  },
): string {
  const lines: string[] = [];
  lines.push('# Bogus Basin rehearsal — what the run measured');
  lines.push('');
  lines.push('Written by `tests/e2e/rehearsal.spec.ts`. Nothing here is field data.');
  lines.push('');
  lines.push(`- Sweep: 720 of 720 rays to 60 km in **${context.sweepMs.toFixed(0)} ms** in Chromium.`);
  lines.push(
    `- At the raw pose the overlay labelled **${context.labelled.labelled}** summits, ` +
      `held ${context.labelled.offFrame} off frame and crowded out ${context.labelled.crowdedOut}.`,
  );
  lines.push(
    `- Anchor: **${context.anchor.name}**, ${context.anchor.elevationM} m, ` +
      `${context.anchor.rangeKm.toFixed(2)} km, bearing ${context.anchor.bearingDeg.toFixed(3)}°, ` +
      `apparent altitude ${context.anchor.altitudeDeg.toFixed(3)}°.`,
  );
  lines.push(
    `- Drag target, from the documented pose alone: ` +
      `${context.target.xPx.toFixed(1)}, ${context.target.yPx.toFixed(1)} overlay px ` +
      `(${(context.target.xPx * FRAME_SCALE).toFixed(1)}, ` +
      `${(context.target.yPx * FRAME_SCALE).toFixed(1)} frame px). ` +
      `The drag closed to ${context.missPx.toFixed(2)} px.`,
  );
  lines.push(`- Injected error: compass +${COMPASS_ERROR_DEG}°, pitch ${PITCH_ERROR_DEG}°.`);
  lines.push('');
  lines.push('## Summits drawn per capture');
  lines.push('');
  for (const item of captures) {
    lines.push(`- **${item.captureId}** (${item.role}, \`${item.framePath}\`): ` +
      `${drawnNames(item).join(', ') || '(none)'}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}
