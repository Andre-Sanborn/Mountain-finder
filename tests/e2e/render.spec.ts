import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';

import type { CameraPose, HorizonPoint, VisiblePeak } from '../../src/core/types';
import type { OverlayOptions, OverlayScene } from '../../src/render/types';

/**
 * P4.2 — PNG compositor.
 *
 * Self-check from archive/v2-docs-20260929/PLAN.md: render a fixture scene, export it, assert the PNG's
 * dimensions and that it is non-empty, and save the image as a reviewable
 * artifact under `out/`.
 *
 * This goes further than the letter of that check in one respect, deliberately.
 * "Non-empty" is a weak claim — a 1600×1200 PNG of uniform grey passes it — so
 * the exported raster is also *probed*: the pixel at the hand-computed summit
 * position must be marker-coloured, and a control pixel a hundred columns away
 * must not be. That turns the export test into an independent check of P4.1's
 * geometry, measured in the delivered image rather than in the builder's own
 * return value.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '../../out');

/**
 * ## The fixture scene, and where its expected numbers come from
 *
 * Identical framing to the unit tests: 1600×1200, heading 90°, no pitch or
 * roll, hFOV 60°, so tan(vFOV/2) = tan30° · 1200/1600 and the projection
 * collapses to
 *
 *     x = 0.5 + tanΔ         / (2·tan(hFOV/2))
 *     y = 0.5 − tanα / cosΔ  / (2·tan(vFOV/2))
 *
 * For the Matterhorn at Δ = 15°, α = 3°:
 *
 *     x = 0.5 + tan15°/(2·tan30°) = √3 − 1 = 0.7320508 → 1171.281 px
 *     y = 0.5 − (tan3°/cos15°)/0.8660254 = 0.4373500 → 524.820 px
 *
 * Computed from the projection model, not from the renderer.
 */
const WIDTH_PX = 1600;
const HEIGHT_PX = 1200;
const HFOV_DEG = 60;
const TAN_HALF_V = Math.tan((HFOV_DEG / 2) * (Math.PI / 180)) * (HEIGHT_PX / WIDTH_PX);

const MATTERHORN_XPX = 1171.281;
const MATTERHORN_YPX = 524.82;

const POSE: CameraPose = {
  headingDeg: 90,
  pitchDeg: 0,
  rollDeg: 0,
  hFovDeg: HFOV_DEG,
  vFovDeg: (2 * Math.atan(TAN_HALF_V) * 180) / Math.PI,
};

function peak(
  id: string,
  name: string,
  bearingDeg: number,
  altitudeDeg: number,
  elevationM: number,
  distanceKm: number,
): VisiblePeak {
  return {
    id,
    name,
    lat: 45.976,
    lon: 7.658,
    elevationM,
    elevationSource: 'osm',
    bearingDeg,
    altitudeDeg,
    distanceKm,
    occludingAltitudeDeg: altitudeDeg - 1,
    clearanceDeg: 1,
  };
}

/**
 * A ridge line, sampled every degree.
 *
 * A deterministic sum of sines rather than a constant altitude, so the exported
 * artifact shows the overlay against a skyline that actually moves: a flat
 * horizon would exercise two distinct y values and prove nothing about the
 * polyline, and it would make the labels look more legible than they are.
 *
 * Bounded to roughly 0.5°–2.2°, which places the ridge between y ≈ 588 px and
 * y ≈ 545 px — below every peak in the scene (α ≥ 2.4°) so the summits stand
 * clear of it, and well below the probe row at y = 524.8 so the control pixel
 * there is sky.
 */
const HORIZON: HorizonPoint[] = [];
for (let bearingDeg = 0; bearingDeg < 360; bearingDeg += 1) {
  const radians = (bearingDeg * Math.PI) / 180;
  const altitudeDeg =
    1.35 + 0.55 * Math.sin(radians * 7) + 0.3 * Math.sin(radians * 23 + 1);
  HORIZON.push({ bearingDeg, altitudeDeg, distanceKm: 18, elevationM: 3100 });
}

const SCENE: OverlayScene = {
  widthPx: WIDTH_PX,
  heightPx: HEIGHT_PX,
  pose: POSE,
  horizon: HORIZON,
  peaks: [
    // An apostrophe and an ampersand, in the export path rather than only in a
    // unit test: if escaping were wrong the SVG would fail to parse and the
    // overlay would silently vanish from the PNG.
    peak('node/1', "Dent d'Hérens", 95, 2.4, 4171, 15.2),
    peak('node/2', 'Matterhorn', 105, 3, 4478, 12.3),
    // Three near-coincident summits, to exercise label stacking in the raster.
    peak('node/3', 'Pollux', 105.4, 2.7, 4092, 14.8),
    peak('node/4', 'Castor & Pollux ridge', 105.8, 2.5, 4228, 16.1),
    peak('node/5', 'Breithorn', 106.3, 2.9, 4164, 13.4),
    // Off frame to the right (Δ = 40° > hFOV/2): must not appear at all.
    peak('node/6', 'Offscreen', 130, 2, 3000, 30),
  ],
};

const OPTIONS: OverlayOptions = {
  nameFontPx: 20,
  detailFontPx: 14,
  labelPaddingPx: 4,
  labelGapPx: 3,
  basePoleLengthPx: 60,
  frameMarginPx: 10,
  maxStackLevels: 6,
  summitDotRadiusPx: 5,
};

interface ProbeSample {
  label: string;
  xPx: number;
  yPx: number;
  rgba: [number, number, number, number];
}

interface HarnessResult {
  pngDataUrl: string;
  overlaySvg: string;
  svgParseError: string | null;
  canvasWidthPx: number;
  canvasHeightPx: number;
  markerCount: number;
  offFrameCount: number;
  markers: {
    name: string;
    summitPx: { xPx: number; yPx: number };
    stackLevel: number;
    direction: string;
    overlapped: boolean;
  }[];
  samples: ProbeSample[];
}

interface HarnessWindow {
  mfRenderHarness: {
    render(input: {
      scene: OverlayScene;
      options: OverlayOptions;
      probesPx: { label: string; xPx: number; yPx: number }[];
    }): Promise<HarnessResult>;
  };
}

/** The overlay's summit-dot fill, `#ffd166`. */
const MARKER_RGB: [number, number, number] = [255, 209, 102];

function channelDistance(rgba: readonly number[], rgb: readonly number[]): number {
  return Math.max(
    ...rgb.map((value, index) => Math.abs((rgba[index] ?? Number.NaN) - value)),
  );
}

function sampleNamed(result: HarnessResult, label: string): ProbeSample {
  const found = result.samples.find((sample) => sample.label === label);
  if (found === undefined) throw new Error(`no probe named ${label}`);
  return found;
}

test('composites a scene onto a photo and exports a PNG', async ({ page }) => {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    // "Failed to load resource" carries no URL and is raised for the favicon
    // Chromium requests unprompted; real failures are caught by the response
    // listener below, with the URL attached.
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource')) {
      errors.push(message.text());
    }
  });
  page.on('response', (response) => {
    // The browser logs a bare "Failed to load resource" to the console with no
    // URL, which is useless when it fires. Recording the response tells us what
    // actually 404'd. The dev server has no favicon and Chromium always asks
    // for one; that is the browser's habit, not a fault in the page.
    if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto('/src/render/harness.html');
  await page.waitForFunction(() => 'mfRenderHarness' in window);

  const result = await page.evaluate(
    (input) => (window as unknown as HarnessWindow).mfRenderHarness.render(input),
    {
      scene: SCENE,
      options: OPTIONS,
      probesPx: [
        // The hand-computed summit of the Matterhorn flag.
        { label: 'summit-dot', xPx: MATTERHORN_XPX, yPx: MATTERHORN_YPX },
        // Same row, 100 px to the left: sky, with no overlay ink on it.
        { label: 'control-sky', xPx: MATTERHORN_XPX - 100, yPx: MATTERHORN_YPX },
        // Well below the skyline: dark rock from the photograph.
        { label: 'control-rock', xPx: 120, yPx: 1120 },
      ],
    },
  );

  expect(errors).toEqual([]);
  expect(failedRequests).toEqual([]);
  expect(result.svgParseError).toBeNull();

  // --- the scene laid out as expected -------------------------------------
  expect(result.markerCount).toBe(5);
  expect(result.offFrameCount).toBe(1);
  expect(result.markers.map((marker) => marker.name)).not.toContain('Offscreen');
  expect(result.overlaySvg).not.toContain('Offscreen');
  expect(result.overlaySvg).toContain('Dent d&apos;Hérens');
  expect(result.overlaySvg).toContain('Castor &amp; Pollux ridge');

  const matterhorn = result.markers.find((marker) => marker.name === 'Matterhorn');
  expect(matterhorn).toBeDefined();
  expect(matterhorn?.summitPx.xPx).toBeCloseTo(MATTERHORN_XPX, 2);
  expect(matterhorn?.summitPx.yPx).toBeCloseTo(MATTERHORN_YPX, 2);

  // The cluster of three near-coincident peaks must not share a label row.
  const clustered = result.markers.filter((marker) =>
    ['Pollux', 'Castor & Pollux ridge', 'Breithorn'].includes(marker.name),
  );
  expect(clustered).toHaveLength(3);
  expect(new Set(clustered.map((marker) => marker.stackLevel)).size).toBe(3);
  expect(clustered.every((marker) => !marker.overlapped)).toBe(true);

  // --- the exported PNG ----------------------------------------------------
  expect(result.canvasWidthPx).toBe(WIDTH_PX);
  expect(result.canvasHeightPx).toBe(HEIGHT_PX);
  expect(result.pngDataUrl.startsWith('data:image/png;base64,')).toBe(true);

  const png = Buffer.from(result.pngDataUrl.slice('data:image/png;base64,'.length), 'base64');

  // Signature: the 8-byte PNG magic. Read from the file, not taken on trust
  // from the data URL's own MIME label.
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  // The IHDR chunk must be first, and carries the real dimensions: a 13-byte
  // payload at offset 8, the type at 12, width at 16, height at 20.
  expect(png.readUInt32BE(8)).toBe(13);
  expect(png.subarray(12, 16).toString('ascii')).toBe('IHDR');
  expect(png.readUInt32BE(16)).toBe(WIDTH_PX);
  expect(png.readUInt32BE(20)).toBe(HEIGHT_PX);
  // Non-empty, and by a margin that a blank canvas could not reach: a uniform
  // 1600×1200 image compresses to a few kB.
  expect(png.byteLength).toBeGreaterThan(50_000);

  // --- the geometry survived into the raster -------------------------------
  const summit = sampleNamed(result, 'summit-dot');
  const sky = sampleNamed(result, 'control-sky');
  const rock = sampleNamed(result, 'control-rock');

  // The flag's fill colour, at the pixel the projection maths puts it. Allowed
  // 12/255 per channel for the dot's antialiased edge and PNG's exact 8-bit
  // rounding — far tighter than the ±0.5 % of frame width (8 px) that P4.1 is
  // held to, which at this dot radius would land outside the dot entirely.
  expect(channelDistance(summit.rgba, MARKER_RGB)).toBeLessThanOrEqual(12);
  expect(summit.rgba[3]).toBe(255);

  // …and the control pixels are emphatically not that colour, so the assertion
  // above is about the flag and not about the picture being amber everywhere.
  expect(channelDistance(sky.rgba, MARKER_RGB)).toBeGreaterThan(40);
  expect(channelDistance(rock.rgba, MARKER_RGB)).toBeGreaterThan(40);
  // Sky is bright, rock is dark: the two hostile backgrounds the halo exists
  // for are both genuinely present in the composited image.
  expect(sky.rgba[0] + sky.rgba[1] + sky.rgba[2]).toBeGreaterThan(450);
  expect(rock.rgba[0] + rock.rgba[1] + rock.rgba[2]).toBeLessThan(240);

  // --- reviewable artifacts ------------------------------------------------
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, 'render-composite.png'), png);
  writeFileSync(resolve(OUT_DIR, 'render-overlay.svg'), result.overlaySvg, 'utf8');
});

test('exports the same bytes twice for the same scene', async ({ page }) => {
  // Determinism all the way through the raster, not just through the SVG
  // string: an export a user re-runs must be the file they saw before.
  await page.goto('/src/render/harness.html');
  await page.waitForFunction(() => 'mfRenderHarness' in window);

  const render = async (): Promise<string> => {
    const result = await page.evaluate(
      (input) => (window as unknown as HarnessWindow).mfRenderHarness.render(input),
      { scene: SCENE, options: OPTIONS, probesPx: [] },
    );
    return result.pngDataUrl;
  };

  expect(await render()).toBe(await render());
});

/**
 * D8 — a greyed label has to survive the raster, not just the SVG string.
 *
 * The unit tests prove the markup says the right things. What they cannot prove
 * is that a de-emphasised label is still READABLE once it has been composited
 * over a photograph, which is the only property that matters to a person
 * looking at the export. So this probes the delivered pixels:
 *
 *   • the summit marker is a hollow RING — the pixel at its exact centre is NOT
 *     the marker fill, while a solid peak's is. A shape difference, visible to
 *     a reader who cannot separate the two colours at all.
 *   • the pole is DASHED and HALOED — walking down it finds both bright pole
 *     ink and dark halo, and both stand well clear of the sky behind them.
 *     A faded halo would show up here as a pole that washes into the sky.
 */
test('a greyed label stays legible in the exported raster', async ({ page }) => {
  const OBSCURED_XPX = MATTERHORN_XPX;
  const OBSCURED_YPX = MATTERHORN_YPX;
  // A second peak far to the left, drawn at full strength, as the control.
  const SOLID_DELTA_DEG = -15;
  const SOLID_XPX = WIDTH_PX - MATTERHORN_XPX;

  const scene: OverlayScene = {
    widthPx: WIDTH_PX,
    heightPx: HEIGHT_PX,
    pose: POSE,
    horizon: HORIZON,
    peaks: [
      { ...peak('node/1', 'Cow Hill', 105, 3, 287, 1), visibility: 'self-occluded' },
      {
        ...peak('node/2', 'Ben Nevis', 100, 2.6, 1345, 6.7),
        visibility: 'foreground-occluded',
      },
      peak('node/3', 'Solid Peak', 90 + SOLID_DELTA_DEG, 3, 4478, 12.3),
    ],
  };

  await page.goto('/src/render/harness.html');
  await page.waitForFunction(() => 'mfRenderHarness' in window);

  // Probe the length of the pole: the dash pattern's phase is a detail of the
  // renderer, so rather than compute which millimetre is ink, walk it and
  // require BOTH kinds of pixel to be present.
  const poleProbes = Array.from({ length: 41 }, (_, index) => ({
    label: `pole-${String(index)}`,
    xPx: OBSCURED_XPX,
    yPx: OBSCURED_YPX - 8 - index,
  }));

  const result = await page.evaluate(
    (input) => (window as unknown as HarnessWindow).mfRenderHarness.render(input),
    {
      scene,
      options: OPTIONS,
      probesPx: [
        { label: 'obscured-centre', xPx: OBSCURED_XPX, yPx: OBSCURED_YPX },
        { label: 'solid-centre', xPx: SOLID_XPX, yPx: OBSCURED_YPX },
        { label: 'sky', xPx: OBSCURED_XPX - 100, yPx: OBSCURED_YPX },
        ...poleProbes,
      ],
    },
  );

  expect(result.svgParseError).toBeNull();

  // The peak hidden behind a DIFFERENT hill never reaches the picture.
  expect(result.overlaySvg).not.toContain('Ben Nevis');
  expect(result.markers.map((marker) => marker.name).sort()).toEqual(['Cow Hill', 'Solid Peak']);
  // ...and the greyed one says so in words, in the delivered document.
  expect(result.overlaySvg).toContain('summit obscured');

  // Shape: filled dot versus hollow ring, at the same relative position.
  const solidCentre = sampleNamed(result, 'solid-centre');
  const obscuredCentre = sampleNamed(result, 'obscured-centre');
  expect(channelDistance(solidCentre.rgba, MARKER_RGB)).toBeLessThanOrEqual(12);
  expect(channelDistance(obscuredCentre.rgba, MARKER_RGB)).toBeGreaterThan(40);

  // Legibility: the sky here is bright, and the greyed pole has to stand out
  // against it in both of its states.
  const sky = sampleNamed(result, 'sky');
  const skyLuma = sky.rgba[0] + sky.rgba[1] + sky.rgba[2];
  expect(skyLuma).toBeGreaterThan(450);

  const poleLumas = poleProbes.map((probe) => {
    const sample = sampleNamed(result, probe.label);
    return sample.rgba[0] + sample.rgba[1] + sample.rgba[2];
  });

  // Both thresholds come from the compositing algebra, not from a measurement.
  // In a dash GAP the only ink is the halo: black at `haloOpacity` 0.6 over the
  // sky, so the pixel is 0.4·sky and the drop below sky is 0.6·sky. Requiring
  // only half of that leaves ample room for antialiasing while failing loudly
  // if the halo were ever faded along with the greyed ink — which is the whole
  // legibility claim, and the reason this assertion is in the raster and not in
  // a unit test.
  expect(skyLuma - Math.min(...poleLumas)).toBeGreaterThan(0.5 * skyLuma);

  // In a dash ITSELF the pole is white at `obscuredOpacity` 0.7 over that halo:
  // 0.7·255 + 0.3·0.4·sky per channel, i.e. ~607 of luma against ~240 in the
  // gap. A modulation of 200 is comfortably under that and impossible without a
  // real dash pattern — a solid pole would read flat.
  expect(Math.max(...poleLumas) - Math.min(...poleLumas)).toBeGreaterThan(200);
});
