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
  holdStillForReanchor,
  installBundleShareStub,
  sharedBundleFiles,
  sharedBytes,
  summitDots,
  tapReanchorAt,
} from './support/field-run';
import {
  DEER_POINT_ANNOTATED_PX,
  DEER_POINT_LANDMARK,
  DEER_POINT_NAME,
  DEG,
  EXIF_HEADING_DEG,
  EYE_ABOVE_GROUND_M,
  GROSS_COMPASS_ERROR_DEG,
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
 * 60 km radius, the committed `idaho-bogus-basin` peak region, the pose
 * IMG_7270 was taken at, and IMG_7270 itself as the camera.
 *
 * ── THE POSE, AND THE FAILURE INJECTED ON TOP OF IT ────────────────────────
 * The photograph's pose is SOLVED, not recorded: 187.938° true and −4.939°,
 * derived in `docs/IMG-7270-HEADING.md` § 3 from Deer Point's annotated crest
 * and confirmed by the Sun's side of the frame in § 4. That is the truth this
 * run is graded against.
 *
 * The phone's compass said **280.336°**, and this run feeds the sensors exactly
 * that. So the rehearsal starts under the real-world failure the photograph
 * measured: **a +92.398° gross compass error** (§ 7, finding X-10), which is
 * three times the ±30° the fine drag can reach. Nothing on screen is recoverable
 * by dragging, and the run has to use the "Fix direction" re-anchor to get back.
 *
 * The sensors' pitch is the solved pitch minus 2°. EXIF carries no pitch at all,
 * so there is no recorded figure to inject; 2° is the order of a phone's
 * unmeasured tilt zero point.
 *
 * ── THE RE-ANCHOR IS THE SUMMIT PATH, NOT THE SUN PATH ─────────────────────
 * `reanchorFromTap` takes either the Sun or a summit named by the person. **The
 * Sun cannot be used on this photograph.** At the recorded instant it is at
 * azimuth 238.3°, elevation 57.1°, which is 50.4° right of the optical axis
 * against a 36.87° half-frame — outside the picture, which is why the frame
 * carries a corner flare rather than a disc (`docs/IMG-7270-HEADING.md` § 4).
 * So this run exercises the fallback: Deer Point, picked by name and tapped.
 *
 * The tap is placed a few pixels off the true apex on purpose. A person taps by
 * eye, and a pixel-exact tap would solve the pose in one gesture and leave the
 * three drags nothing to close.
 *
 * ── WHAT THIS RUN CANNOT DECIDE ────────────────────────────────────────────
 * 1. **The fake camera cannot move.** Chromium serves one still frame, so when
 *    the sensors pan and tilt for the F4 captures, the picture behind the
 *    overlay does not move with them. On a real phone the frame and the sensors
 *    move together. **F4 on this rehearsal therefore tests the overlay's
 *    arithmetic under a moving pose, and nothing about whether the labels agree
 *    with the photograph.** Only the captures taken at the photograph's own pose
 *    — the raw one and the three after-drag ones — can be compared with the
 *    picture at all.
 * 2. **Nobody has annotated these frames.** `out/rehearsal/ANNOTATE.md` is the
 *    brief that asks two people to, and until they answer there is no truth to
 *    grade against. The truth document this spec writes is SYNTHETIC — it is the
 *    solved pose projected back onto the frame — and it exists to exercise the
 *    grader, not to say where a summit is.
 * 3. **Deer Point is not graded against itself.** The solved pose comes from
 *    Deer Point's annotated crest, the re-anchor is taken on Deer Point, and the
 *    drag is aimed at Deer Point. A residual measured there would be the
 *    arithmetic closing on its own input. The graded summits are the others the
 *    overlay draws — Doe Point and Little Deer Point at this pose.
 *
 * ── THE SOUTH-FACING CAPTURE § 2.7 REGISTERS ───────────────────────────────
 * The prereg registers one capture facing south toward Deer Point and Doe Point,
 * so the near band gets a sample. At 187.938° this frame already faces south,
 * with Deer Point 2 km out at −4.52° and the sky above it in the same picture,
 * so every capture taken at the photograph's own pose is that capture. The run
 * asserts it rather than assuming it.
 *
 * ── THE FRAME ──────────────────────────────────────────────────────────────
 * The app asks the camera for 1920 × 1080 and the photograph is 8064 × 6048, so
 * the fake camera is the photograph CENTRE-CROPPED to 16:9 rather than squeezed
 * into it: the full 73.74° width of the 24 mm-equivalent lens survives, and the
 * top and bottom eighths of the picture do not. The viewport is 960 × 540, the
 * same 16:9, so `object-fit: cover` crops nothing further and the stored frame
 * is the overlay's own space scaled by exactly 2 on both axes.
 *
 * That last point is load-bearing. `residualOf` in the grader scales the overlay
 * into the stored frame by a plain ratio of widths and of heights, with no
 * offset, which is right only when the two share an aspect ratio. A 4:3 camera
 * in a 16:9 viewport would break it: the visible picture is then a 75 % crop of
 * the stored frame's width, and every horizontal residual would be scaled by
 * 2 where the truth is 1.5 about a shifted centre.
 *
 * 960 px of width is also what gets Deer Point a name rather than a bare dot.
 * The label budget is `floor(usableWidth / meanLabelWidth)` columns of slots, so
 * it grows with the viewport. At 800 px this frame held 25 summits and could
 * name 21, and the four it dropped were the near low ones — Deer Point, Doe
 * Point and Little Deer Point among them. The field session's anchor list only
 * offers NAMED markers, so at 800 px the protocol's own anchor summit could not
 * be picked. At 960 px, which is nearer a landscape phone than 800 was, all 25
 * are named and none is crowded out.
 *
 * ── HOW IT IS GATED ────────────────────────────────────────────────────────
 * `data/sites/bogus-basin/` is gitignored and built by `npm run site:package`.
 * Without it there is no 60 km mosaic to sweep, so the whole file skips, which
 * is what happens in CI.
 */

/** A 60 km mosaic fetch and a 360° sweep, on a throttled shared runner. */
const SCENE_TIMEOUT_MS = 240_000;

const FRAME = { widthPx: 960, heightPx: 540 } as const;
const CAMERA = { widthPx: 1920, heightPx: 1080 } as const;
const CAMERA_VIDEO = resolve(
  FAKE_CAMERA_DIR,
  `fake-camera-hdr-gainmap-7270-${CAMERA.widthPx}x${CAMERA.heightPx}.y4m`,
);

/** What the overlay and the stored frame both span, from the documented lens. */
const VISIBLE_FOV = fovForFrame(CAMERA.widthPx, CAMERA.heightPx);

/** Overlay pixels to stored-frame pixels. Exact: 1920/960 = 1080/540 = 2. */
const FRAME_SCALE = CAMERA.widthPx / FRAME.widthPx;

/**
 * The pitch error injected into the sensors, degrees.
 *
 * The heading error is not a constant here: it is whatever the compass really
 * said, {@link GROSS_COMPASS_ERROR_DEG}, read off the photograph.
 */
const PITCH_ERROR_DEG = -2;

/**
 * How far off the true apex the re-anchor tap lands, overlay pixels.
 *
 * A person taps by eye. At this lens and this viewport the overlay's focal
 * length is 640 px, so 6 px across is 0.54° of heading and 4 px down is 0.36° of
 * pitch — the size of a careful tap, and well inside the fine trim's ±30°.
 */
const REANCHOR_TAP_ERROR_PX = { xPx: 6, yPx: -4 } as const;

/** The peak region cut for this site's 60 km disc. */
const PEAK_REGION = 'idaho-bogus-basin';

const OUT_DIR = resolve(ROOT, 'out/rehearsal');
const FRAMES_DIR = resolve(OUT_DIR, 'frames');

/** How far off centre the anchor may sit, so an F4 pan can still reach either edge. */
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
    /**
     * What the sensors say while the phone is aimed as the photograph was.
     *
     * The heading is the compass reading off the file itself, 92.398° from where
     * the camera pointed. The pitch is the solved pitch minus 2°.
     */
    const RAW_HEADING_DEG = EXIF_HEADING_DEG;
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
        `${labelled.crowdedOut} crowded out at the compass's own pose, before the re-anchor`,
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

    /* ── the anchor, and the pixel everything is measured from ────────────── */
    /**
     * Deer Point: the summit the pose was solved from, and the field protocol's
     * re-anchor and drag anchor.
     *
     * Its bearing, range and apparent altitude come from this file's geodesy
     * over the committed peak cell, never from the app.
     */
    const anchor = inFrameCandidates().find((peak) => peak.name === DEER_POINT_NAME);
    expect(anchor, `${DEER_POINT_NAME} is not in the committed peak region`).toBeDefined();
    if (anchor === undefined) return;
    // Near enough the centre that an F4 pan can still carry it to either edge.
    expect(anchor.offsetU).toBeLessThanOrEqual(MAX_ANCHOR_OFFSET_U);
    console.log(
      `rehearsal anchor: ${anchor.name} — ${anchor.elevationM} m, ` +
        `${anchor.rangeKm.toFixed(3)} km, bearing ${anchor.bearingDeg.toFixed(3)}°, ` +
        `apparent altitude ${anchor.altitudeDeg.toFixed(3)}°, u ${anchor.offsetU.toFixed(3)}`,
    );

    /**
     * Where Deer Point's crest sits under the SOLVED pose, in overlay pixels.
     *
     * This is the re-anchor's true tap point and the drag's target, and the app
     * has no part in computing it: the position and the lens are EXIF's, the
     * heading and pitch are `docs/IMG-7270-HEADING.md` § 3's, the coordinate is
     * the committed peak cell's, and the projection is this harness's own.
     *
     * The check below is the second instrument. The document solved the pose by
     * running Newton on `src/core/projection.ts` until Deer Point landed on the
     * annotators' pixel. Re-projecting through independent geometry has to come
     * back to that same pixel, and 0.15 px is the room the document's three
     * printed decimals leave: 0.001° is 0.01 px at this focal length.
     */
    const TARGET_PX = projectInto(
      FRAME,
      { ...PHOTO_POSE, rollDeg: 0, ...VISIBLE_FOV },
      anchor.bearingDeg,
      anchor.altitudeDeg,
    );
    expect(
      Math.hypot(
        TARGET_PX.xPx * FRAME_SCALE - DEER_POINT_ANNOTATED_PX.xPx,
        TARGET_PX.yPx * FRAME_SCALE - DEER_POINT_ANNOTATED_PX.yPx,
      ),
      'the solved pose does not put Deer Point back on the annotated pixel',
    ).toBeLessThan(0.15);
    console.log(
      `rehearsal drag target (solved pose): ${TARGET_PX.xPx.toFixed(2)}, ` +
        `${TARGET_PX.yPx.toFixed(2)} overlay px = ` +
        `${(TARGET_PX.xPx * FRAME_SCALE).toFixed(2)}, ` +
        `${(TARGET_PX.yPx * FRAME_SCALE).toFixed(2)} frame px, ` +
        `against the annotated ${DEER_POINT_ANNOTATED_PX.xPx}, ${DEER_POINT_ANNOTATED_PX.yPx}`,
    );

    const session = page.getByTestId('field-session');
    await expect(page.getByTestId('field-session-start')).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId('field-session-start').click();

    /* ── 1. where to stand ────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'stand');
    await page.getByTestId('field-session-next').click();

    /* ── 2. the camera width, from two taps ───────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fov-check');
    // Tapped exactly ON two drawn dots, so the fit is the identity. The point of
    // this run is the protocol, the re-anchor and the drag, and a camera error
    // injected here would move the labels somewhere the drag target did not
    // predict. What it changes is `fovSource`, which F2 and F3 both require.
    //
    // The dots are still a quarter-turn from anything in the picture at this
    // point, so on site this step would be done on the real sun instead. Here it
    // is arithmetic: two taps that fit the lens the app already assumed.
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

    /* ── 3. which way the labels point: the re-anchor on Deer Point ───────── */
    await expect(session).toHaveAttribute('data-step-id', 'fix-direction');

    // The sun path is unavailable on this photograph. At the recorded instant
    // the sun is 50.4° right of the optical axis against a 36.87° half-frame, so
    // it is outside the picture and there is nothing to tap
    // (docs/IMG-7270-HEADING.md § 4). The summit path is what the field protocol
    // falls back to, and it is what runs here.
    const reanchor = page.getByTestId('live-reanchor');
    await expect(reanchor).toHaveAttribute('data-gross-offset-deg', '0');
    await holdStillForReanchor(page);
    await page.getByTestId('live-reanchor-summit').click();

    const picker = page.getByTestId('live-reanchor-summit-name');
    const offered = await picker
      .locator('option')
      .evaluateAll((nodes) =>
        nodes.map((node) => ({
          value: (node as HTMLOptionElement).value,
          text: node.textContent ?? '',
        })),
      );
    const deerOption = offered.find((option) => option.value === anchor.id);
    expect(
      deerOption,
      `the sweep did not offer ${anchor.name} by name; it offered ${offered.length} summits`,
    ).toBeDefined();
    await picker.selectOption(anchor.id);
    await expect(page.getByTestId('live-reanchor-prompt')).toContainText(`Now tap ${anchor.name}`);

    // Tapped where Deer Point's crest really is, less the by-eye slip. Nothing
    // the app drew enters this: under a 92° error its own Deer Point marker is
    // off the picture entirely.
    const TAPPED_PX = {
      xPx: TARGET_PX.xPx + REANCHOR_TAP_ERROR_PX.xPx,
      yPx: TARGET_PX.yPx + REANCHOR_TAP_ERROR_PX.yPx,
    };
    await tapReanchorAt(page, TAPPED_PX.xPx, TAPPED_PX.yPx);

    // The summit path asks before it turns anything, and says how far by.
    const confirm = page.getByTestId('live-reanchor-confirm');
    await expect(confirm).toBeVisible();
    const promisedMoveDeg = Number(await confirm.getAttribute('data-move-deg'));
    expect(await reanchor.getAttribute('data-gross-offset-deg')).toBe('0');
    await page.getByTestId('live-reanchor-confirm-yes').click();
    await expect(reanchor).toHaveAttribute('data-anchor-source', 'summit');

    /**
     * What the re-anchor recovered, against what the photograph says was wrong.
     *
     * The tap was {@link REANCHOR_TAP_ERROR_PX} off the true apex, which is
     * 0.64° of heading, so the offset is expected to miss the documented
     * 92.398° by about that and no more.
     */
    const grossOffsetDeg = Number(await reanchor.getAttribute('data-gross-offset-deg'));
    const TAP_SLIP_DEG =
      Math.atan(REANCHOR_TAP_ERROR_PX.xPx / (FRAME.widthPx / 2 / Math.tan((VISIBLE_FOV.hFovDeg * DEG) / 2))) /
      DEG;
    console.log(
      `rehearsal re-anchor: compass said ${EXIF_HEADING_DEG.toFixed(3)}°, ` +
        `the photograph was taken at ${PHOTO_POSE.headingDeg.toFixed(3)}°, ` +
        `a gross error of +${GROSS_COMPASS_ERROR_DEG.toFixed(3)}°. ` +
        `One tap on ${anchor.name}, ${REANCHOR_TAP_ERROR_PX.xPx} px right and ` +
        `${-REANCHOR_TAP_ERROR_PX.yPx} px above its true apex, recorded ` +
        `${grossOffsetDeg.toFixed(3)}° and promised a ${promisedMoveDeg.toFixed(1)}° turn.`,
    );
    expect(
      Math.abs(grossOffsetDeg - -GROSS_COMPASS_ERROR_DEG),
      'the re-anchor did not recover the documented compass error',
    ).toBeLessThan(TAP_SLIP_DEG + 0.2);
    // And the labels are now pointed at the photograph rather than a quarter
    // turn away from it. What is left is the by-eye slip, which is the drag's
    // job.
    await expect
      .poll(
        async () => {
          const seen = (await drawnPose(page)).headingDeg;
          return Math.abs(((seen - PHOTO_POSE.headingDeg + 540) % 360) - 180);
        },
        { timeout: 15_000 },
      )
      .toBeLessThan(TAP_SLIP_DEG + 0.2);
    const anchoredHeadingDeg = (await drawnPose(page)).headingDeg;

    await page.getByTestId('field-session-next').click();

    /* ── 4. the fix ───────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'fix');
    await expect(page.getByTestId('field-session-accuracy')).toBeVisible();
    await page.getByTestId('field-session-next').click();

    /* ── 5. brace ─────────────────────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'brace');
    await holdStill(page);
    await page.getByTestId('field-session-next').click();

    /* ── 6. capture raw ───────────────────────────────────────────────────── */
    // "Raw" means before the drag, not before the re-anchor: § 2.7 puts Fix
    // direction ahead of the captures, so this frame is taken with the labels
    // already turned back onto the picture. It is also the south-facing capture
    // the prereg registers — the anchored heading is 187.9°, which is 8° east of
    // due south, with Deer Point 2 km out at −4.5° and the sky above it.
    await expect(session).toHaveAttribute('data-step-id', 'capture-raw');
    expect(
      Math.abs(anchoredHeadingDeg - 180),
      'the raw capture is not the south-facing one § 2.7 registers',
    ).toBeLessThan(15);
    await holdStill(page);
    injected.push({ captureId: 'c1', headingDeg: RAW_HEADING_DEG, pitchDeg: RAW_PITCH_DEG });
    await capture(page, 1);

    /* ── 7. the anchor: Deer Point, the summit the protocol names ─────────── */
    await expect(session).toHaveAttribute('data-step-id', 'drag');
    const choices = page.getByTestId('field-session-anchor-choice');
    await expect(choices.first()).toBeVisible({ timeout: 20_000 });
    const drawnIds = await choices.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('data-summit-id') ?? ''),
    );
    const drawnChoiceNames = await choices.allInnerTexts();
    console.log(`rehearsal anchor choices: ${drawnChoiceNames.join(', ')}`);
    // The anchor list offers named markers only, so a summit crowded out of the
    // labels cannot be picked even though its dot is drawn.
    await expect(labels).toHaveAttribute('data-crowded-out-count', '0');
    expect(
      drawnIds,
      `the overlay did not draw ${anchor.name}; it drew ${drawnChoiceNames.join(', ')}`,
    ).toContain(anchor.id);
    // Picked by id: "Deer Point" is a prefix of "Little Deer Point", and both
    // are in this frame, so a text match would be ambiguous.
    await page
      .locator(`[data-testid="field-session-anchor-choice"][data-summit-id="${anchor.id}"]`)
      .click();
    await expect(page.getByTestId('field-session-anchor-name')).toHaveText(anchor.name);

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
     * `n` pixels is `focalPx · tan(Δangle / gain)` and not `n / gain`. The gap
     * left after the re-anchor is under a degree, where the two agree closely,
     * but the repeats below reset the trim and leave the whole 2° of pitch
     * error, where they do not.
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

    /* ── 8. capture after the drag ────────────────────────────────────────── */
    await expect(session).toHaveAttribute('data-step-id', 'capture-drag');
    await holdStill(page);
    injected.push({ captureId: 'c2', headingDeg: RAW_HEADING_DEG, pitchDeg: RAW_PITCH_DEG });
    await capture(page, 2);

    /* ── 9. the four movements § 2.4 registers ───────────────────────────── */
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
     * The first guess is arithmetic: the COMPASS reading that puts the anchor at
     * u = 0.85 once the re-anchor's offset and the drag's trim are both allowed
     * for. The labels are drawn at `sensed + grossOffset + trim`, and the
     * compass is 92° wrong, so a guess that ignores the offset aims a quarter
     * turn away from the edge it wants. The loop after it closes on what the
     * screen reports, which is what the person on site does — the registered
     * target is a position on the picture, not an angle.
     */
    const sensedFor = (drawnHeadingDeg: number): number =>
      drawnHeadingDeg - grossOffsetDeg - trim.headingDeg;
    const panAnchorTo = async (side: 'left' | 'right'): Promise<number> => {
      const wantDelta = (side === 'left' ? -1 : 1) * (Math.atan(PAN_TARGET_U * halfFieldTan) / DEG);
      let sensedHeading = sensedFor(anchor.bearingDeg - wantDelta);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await aimAndSettle(sensedHeading, RAW_PITCH_DEG);
        const seen = await anchorOffset(page);
        console.log(
          `pan ${side} attempt ${attempt}: compass at ${sensedHeading.toFixed(2)}°, ` +
            `anchor ${seen === undefined ? 'off picture' : `${seen.side} u=${seen.u.toFixed(3)}`}`,
        );
        if (seen === undefined) {
          // The anchor left the picture: step back toward its own bearing.
          sensedHeading = (sensedHeading + sensedFor(anchor.bearingDeg)) / 2;
          continue;
        }
        if (seen.side === side && seen.u >= 0.8) return sensedHeading;
        const haveDelta = (seen.side === 'left' ? -1 : 1) * (Math.atan(seen.u * halfFieldTan) / DEG);
        sensedHeading += haveDelta - wantDelta;
      }
      throw new Error(`the anchor never reached the ${side} edge`);
    };

    /** What the drift line said at each pan, for the run notes. */
    const panDrift: { id: string; gapDeg: number; beyondBand: boolean }[] = [];

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
        // The drift line measures the compass against where it stood when the
        // direction was fixed, and § 2.4 asks the person to turn tens of
        // degrees. It cannot tell a deliberate pan from a compass that
        // wandered, so it warns on every F4 pan. Recorded, not asserted away.
        const driftLine = page.getByTestId('live-anchor-drift');
        panDrift.push({
          id: movement.id,
          gapDeg: Number(await driftLine.getAttribute('data-gap-deg')),
          beyondBand: (await driftLine.getAttribute('data-beyond-band')) === 'true',
        });
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

    /* ── 10. the two remaining drags onto the same summit ──────────────────── */
    await aim(RAW_HEADING_DEG, RAW_PITCH_DEG);
    for (const repeat of [2, 3]) {
      await expect(session).toHaveAttribute('data-step-id', 'drag');
      await expect(page.getByTestId('field-session-anchor-name')).toHaveText(anchor.name);
      // "Put the labels back" clears the fine trim only. The re-anchor's gross
      // offset survives it, which is what makes the repeat a repeat of the drag
      // rather than of the whole recovery.
      await page.getByTestId('field-session-reset-trim').click();
      expect(Number(await reanchor.getAttribute('data-gross-offset-deg'))).toBeCloseTo(
        grossOffsetDeg,
        6,
      );
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

    /* ── the captures taken at the photograph's own pose face south ───────── */
    // Every one of them records a heading near 188°, not the 280° the compass
    // read. That is the re-anchor surviving into the bundle: the offset itself
    // cannot travel yet (`POSE_CARRIES_GROSS_OFFSET` is false, so `POSE_KEYS`
    // has no field for it), but the pose the labels were drawn at does.
    for (const item of parsed.value.captures) {
      if (item.role === 'moved') continue;
      expect(
        Math.abs(((item.pose.headingDeg - PHOTO_POSE.headingDeg + 540) % 360) - 180),
        `${item.captureId} was not taken at the photograph's pose`,
      ).toBeLessThan(1);
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
     * chew on. It is where the phone really pointed — the compass reading with
     * the measured 92.398° error and the injected 2° of pitch taken back off —
     * projected through this file's geometry and straddled by ±2 px. **No
     * annotator looked at a picture, so it is not truth**: it says where the
     * pipeline's own arithmetic puts a summit, not where the summit is. The real
     * truth comes back from `ANNOTATE.md`.
     *
     * Deer Point is left out. The pose was solved from Deer Point's crest, the
     * re-anchor was taken on Deer Point and the drag was aimed at Deer Point, so
     * a residual measured there is the arithmetic closing on its own input.
     */
    const truthCaptures = parsed.value.captures.map((item) => {
      const at = injected.find((entry) => entry.captureId === item.captureId);
      if (at === undefined) throw new Error(`no injected pose for ${item.captureId}`);
      const pose = {
        headingDeg: at.headingDeg - GROSS_COMPASS_ERROR_DEG,
        pitchDeg: at.pitchDeg - PITCH_ERROR_DEG,
        rollDeg: 0,
        ...VISIBLE_FOV,
      };
      const apexes: { summitId: string; apexPx: { xPx: number; yPx: number } }[] = [];
      const second: { summitId: string; apexPx: { xPx: number; yPx: number } }[] = [];
      for (const summit of item.overlay.drawn) {
        if (summit.summitId === anchor.id) continue;
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
          { annotatorId: 'synthetic-a', method: 'bare-frame', apexes },
          { annotatorId: 'synthetic-b', method: 'bare-frame', apexes: second },
        ],
      };
    });
    writeFileSync(
      resolve(OUT_DIR, 'synthetic-truth.json'),
      `${JSON.stringify(
        {
          format: 'mountain-finder/field-apex-truth@2',
          procedure:
            'SYNTHETIC — NOT INDEPENDENT TRUTH. Where the phone really pointed: the compass ' +
            `reading less the ${GROSS_COMPASS_ERROR_DEG.toFixed(3)} deg error IMG_7270 measures ` +
            '(docs/IMG-7270-HEADING.md), and less the 2 deg of pitch this run injects, ' +
            'projected onto the stored frame and straddled by +/-2 px. Deer Point is left out: ' +
            'it is the summit the pose was solved from, the re-anchor reference and the drag ' +
            'anchor, so it cannot be graded against itself. No annotator looked at a ' +
            'photograph. It exists to exercise the grading path; every verdict it produces is ' +
            'about the arithmetic, not the picture.',
          captures: truthCaptures,
        },
        null,
        2,
      )}\n`,
    );

    writeFileSync(
      resolve(OUT_DIR, 'ANNOTATE.md'),
      annotationBrief(parsed.value.captures, { anchor, framePx: CAMERA }),
    );
    writeFileSync(
      resolve(OUT_DIR, 'run-notes.md'),
      runNotes(parsed.value.captures, {
        sweepMs,
        labelled,
        missPx,
        anchor,
        target: TARGET_PX,
        grossOffsetDeg,
        anchoredHeadingDeg,
        tapSlipDeg: TAP_SLIP_DEG,
        panDrift,
      }),
    );
  });
});

/** Summits the overlay drew in a capture, by name, in the order it drew them. */
function drawnNames(item: Capture): readonly string[] {
  return item.overlay.drawn.map((summit) => summit.name);
}

/** Every summit drawn in any capture, once each, in the order first drawn. */
function drawnUnion(captures: readonly Capture[]): Capture['overlay']['drawn'][number][] {
  const seen = new Map<string, Capture['overlay']['drawn'][number]>();
  for (const item of captures) {
    for (const summit of item.overlay.drawn) {
      if (!seen.has(summit.summitId)) seen.set(summit.summitId, summit);
    }
  }
  return [...seen.values()];
}

function annotationBrief(
  captures: readonly Capture[],
  context: {
    anchor: Candidate;
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
    '2. For each summit named under that frame, give exactly one of three answers. Each one',
    '   is a positive claim, and the three grade in different directions:',
    '   - **You found it.** Report its apex as a pixel: the single point you judge to be the',
    '     top of that summit. If you took the point from a feature such as a mast, a lookout',
    '     or a notch, name that feature as the landmark.',
    '   - **It is not there.** The place where that summit would stand holds no summit. Say',
    '     which it holds instead: `clear-sky` for open sky, `foreground-blocked` for ground',
    '     or a ridge standing in front of it. This is the answer that convicts the app of',
    '     drawing a mountain that is not there, so only give it when you are sure.',
    '   - **You cannot tell.** Haze, a crowded ridge line, a foothill you cannot resolve.',
    '     This answer removes the summit from the scoring rather than counting against the',
    '     app either way.',
    `3. **On ${context.anchor.name}, mark ${DEER_POINT_LANDMARK} — not the tip of the mast.**`,
    '   That summit carries a cluster of masts and buildings, and the mast tops stand roughly',
    '   30 px above the ground crest in a frame this size. When you report it, give',
    `   \`${DEER_POINT_LANDMARK}\` as the landmark.`,
    '4. Say which method you worked under, on your own reading:',
    '   - `bare-frame` — the frame and the summit names, nothing else. This is what you have',
    '     been given, so it is the answer unless you went and found a map.',
    '   - `frame-and-map` — the frame, the summit names, the viewpoint and a topographic',
    '     map. Never the app\'s projection, and never the pose.',
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
  lines.push('  "format": "mountain-finder/field-apex-truth@2",');
  lines.push(
    '  "procedure": "two independent annotators, bare frames, no overlay and no pose",',
  );
  lines.push('  "captures": [');
  lines.push('    { "captureId": "c1", "readings": [');
  lines.push('      { "annotatorId": "you", "method": "bare-frame", "apexes": [');
  lines.push('        { "summitId": "<the id printed beside the name>", "apexPx": { "xPx": 0, "yPx": 0 } },');
  lines.push(
    `        { "summitId": "<one taken off a feature>", "apexPx": { "xPx": 0, "yPx": 0 }, ` +
      `"landmark": "${DEER_POINT_LANDMARK}" },`,
  );
  lines.push('        { "summitId": "<one that is not there>", "absent": true, "reason": "clear-sky" },');
  lines.push('        { "summitId": "<one you cannot tell>", "cannotIdentify": true }');
  lines.push('      ] }');
  lines.push('    ] }');
  lines.push('  ]');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push(
    'Every summit named under a frame gets one of the three answers. `null` is not one of',
    'them and the reader refuses it.',
  );
  lines.push('');
  lines.push('## What is known about the frames');
  lines.push('');
  lines.push(
    `- All ${captures.length} frames are the SAME photograph. The camera in this rehearsal is a`,
    '  file, so it could not move. The captures differ in where the app pointed its overlay,',
    '  not in what the picture shows. Answer each frame on its own anyway: identical answers',
    `  across the ${captures.length} are the expected result and are worth having on the`,
    '  record.',
    '- The picture faces south from a ridge, and the nearest summit in it is about 2 km away',
    '  and below the horizon line rather than on it.',
    `- The overlay was anchored on ${context.anchor.name} (\`${context.anchor.id}\`). Its`,
    '  reading is reported on its own and is not scored against the app, because the app was',
    '  aimed at it by hand. Report it anyway: it is what ties one frame to the next.',
    '- Nothing about the app\'s predicted positions is in this file, on purpose.',
  );
  lines.push('');
  lines.push('## Every summit named across the frames');
  lines.push('');
  lines.push('The union of the per-frame lists below, so you know the whole cast before you');
  lines.push('start. A name here is a claim by the app, not a fact about the picture.');
  lines.push('');
  for (const summit of drawnUnion(captures)) {
    const note = summit.summitId === context.anchor.id ? ' — the anchor' : '';
    lines.push(`- ${summit.name} — \`${summit.summitId}\`, ${summit.elevationM} m${note}`);
  }
  lines.push('');
  lines.push('## The frames, and the summits to look for in each');
  lines.push('');
  for (const item of captures) {
    lines.push(`### frames/${item.framePath}`);
    lines.push('');
    for (const summit of item.overlay.drawn) {
      const note = summit.summitId === context.anchor.id ? ' — the anchor' : '';
      lines.push(`- ${summit.name} — \`${summit.summitId}\`, ${summit.elevationM} m${note}`);
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
    grossOffsetDeg: number;
    anchoredHeadingDeg: number;
    tapSlipDeg: number;
    panDrift: readonly { id: string; gapDeg: number; beyondBand: boolean }[];
  },
): string {
  const lines: string[] = [];
  lines.push('# Bogus Basin rehearsal — what the run measured');
  lines.push('');
  lines.push('Written by `tests/e2e/rehearsal.spec.ts`. Nothing here is field data.');
  lines.push('');
  lines.push(`- Sweep: 720 of 720 rays to 60 km in **${context.sweepMs.toFixed(0)} ms** in Chromium.`);
  lines.push(
    `- At the compass's own pose, before the direction was fixed, the overlay labelled ` +
      `**${context.labelled.labelled}** summits, ` +
      `held ${context.labelled.offFrame} off frame and crowded out ${context.labelled.crowdedOut}.`,
  );
  lines.push(
    `- Anchor: **${context.anchor.name}**, ${context.anchor.elevationM} m, ` +
      `${context.anchor.rangeKm.toFixed(2)} km, bearing ${context.anchor.bearingDeg.toFixed(3)}°, ` +
      `apparent altitude ${context.anchor.altitudeDeg.toFixed(3)}°.`,
  );
  lines.push(
    `- Drag target, from the solved pose alone: ` +
      `${context.target.xPx.toFixed(2)}, ${context.target.yPx.toFixed(2)} overlay px ` +
      `(${(context.target.xPx * FRAME_SCALE).toFixed(2)}, ` +
      `${(context.target.yPx * FRAME_SCALE).toFixed(2)} frame px), against the annotated ` +
      `${DEER_POINT_ANNOTATED_PX.xPx}, ${DEER_POINT_ANNOTATED_PX.yPx}. ` +
      `The drag closed to ${context.missPx.toFixed(2)} px.`,
  );
  lines.push('');
  lines.push('## The gross compass error, and the re-anchor that undid it');
  lines.push('');
  lines.push(
    `- The photograph's pose is solved, not recorded: **${PHOTO_POSE.headingDeg}° true, ` +
      `${PHOTO_POSE.pitchDeg}°**, from \`docs/IMG-7270-HEADING.md\` § 3.`,
    `- The phone's compass reported **${EXIF_HEADING_DEG.toFixed(3)}°**, so the sensors start ` +
      `**+${GROSS_COMPASS_ERROR_DEG.toFixed(3)}°** wrong. The fine drag reaches ±30°, so none ` +
      'of that is draggable.',
    '- The sun path is unusable here: at the recorded instant the sun is 50.4° right of the',
    '  optical axis against a 36.87° half-frame, outside the picture (§ 4). The run uses the',
    `  summit path instead — ${context.anchor.name}, picked by name and tapped.`,
    `- The tap was placed ${REANCHOR_TAP_ERROR_PX.xPx} px right and ` +
      `${-REANCHOR_TAP_ERROR_PX.yPx} px above the true apex, a by-eye slip worth ` +
      `${context.tapSlipDeg.toFixed(2)}°.`,
    `- Recorded gross heading offset: **${context.grossOffsetDeg.toFixed(3)}°**, against the ` +
      `${(-GROSS_COMPASS_ERROR_DEG).toFixed(3)}° the photograph measures — a residual of ` +
      `${Math.abs(context.grossOffsetDeg + GROSS_COMPASS_ERROR_DEG).toFixed(3)}°.`,
    `- The labels then sat at ${context.anchoredHeadingDeg.toFixed(3)}°, and the fine drag ` +
      'closed the rest.',
    '- The offset itself does not travel in the bundle: `POSE_CARRIES_GROSS_OFFSET` is false,',
    '  so `POSE_KEYS` has no field for it. What travels is the pose the labels were drawn at.',
  );
  lines.push(`- Injected pitch error: ${PITCH_ERROR_DEG}°. EXIF records no pitch.`);
  lines.push('');
  lines.push('## The drift line during the F4 pans');
  lines.push('');
  lines.push(
    '`anchorDrift` compares the compass now with the compass when the direction was fixed.',
    '§ 2.4 asks the person to turn tens of degrees, so it fires on every pan. It cannot tell a',
    'deliberate turn from a compass that wandered.',
  );
  lines.push('');
  for (const entry of context.panDrift) {
    lines.push(
      `- **${entry.id}**: gap ${entry.gapDeg.toFixed(1)}°, ` +
        `${entry.beyondBand ? 'beyond the band it claims' : 'inside the band it claims'}.`,
    );
  }
  lines.push('');
  lines.push('## The south-facing capture § 2.7 registers');
  lines.push('');
  lines.push(
    `The anchored heading is ${context.anchoredHeadingDeg.toFixed(1)}°, which faces south, and`,
    `${context.anchor.name} sits ${context.anchor.rangeKm.toFixed(2)} km out at`,
    `${context.anchor.altitudeDeg.toFixed(2)}° with the sky above it. Every capture taken at`,
    'the photograph\'s own pose is therefore the registered south-facing capture.',
  );
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
