/**
 * The Sun and Moon marks — the bench-test instrument's own bench test.
 *
 * Three kinds of expectation, none of them this code's output:
 *
 *   PHYSICAL   the Sun's angular radius is 959.63″ at 1 AU and the Earth-Sun
 *              distance varies by ±1.7 % over a year, so the disc is between
 *              0.262° and 0.271° across the whole orbit. The Moon runs from
 *              perigee to apogee, about 0.245° to 0.28°. A marker that reported
 *              a plausible-looking wrong size would fail these.
 *   IDENTITY   at transit the altitude of a body is 90° − |latitude −
 *              declination|, and the azimuth is due south for an observer north
 *              of the subsolar point. At the June solstice the Sun's
 *              declination is the obliquity, +23.44°.
 *   CLOSED FORM the drawn radius of an on-axis disc is
 *              `(heightPx/2)·tan(r) / tan(vFov/2)`, straight from the
 *              rectilinear projection. Derived here, not read off a run.
 */

import { describe, expect, it } from 'vitest';

import type { CameraPose } from '../../core/types';
import { projectToImage } from '../../core/projection';
import {
  celestialMark,
  celestialMarks,
  isTappableMark,
  MIN_MARK_RADIUS_PX,
  offFrameDirection,
  type CelestialMark,
} from './celestial-markers';
import { resolveCalibrationTap } from './fov-calibration';

const DEG = Math.PI / 180;
const FRAME = { widthPx: 800, heightPx: 450 };

/** Greenwich, at sea level. */
const GREENWICH = { lat: 51.4779, lon: 0, heightM: 0 };

function poseAt(headingDeg: number, pitchDeg: number, hFovDeg = 60, vFovDeg = 35): CameraPose {
  return { headingDeg, pitchDeg, rollDeg: 0, hFovDeg, vFovDeg };
}

describe('the Sun mark', () => {
  // 12:00 UTC on the June solstice at Greenwich: within a couple of minutes of
  // local apparent noon, so the Sun is nearly due south at its transit
  // altitude 90 − (51.4779 − 23.44) = 61.96°.
  const SOLSTICE_NOON = new Date('2026-06-21T12:00:00Z');

  it('puts the Sun where the transit identity says it is', () => {
    const mark = celestialMark('sun', SOLSTICE_NOON, GREENWICH, poseAt(180, 60), FRAME);
    expect(mark.azimuthDeg).toBeGreaterThan(176);
    expect(mark.azimuthDeg).toBeLessThan(184);
    expect(mark.altitudeDeg).toBeGreaterThan(61);
    expect(mark.altitudeDeg).toBeLessThan(63);
    expect(mark.belowHorizon).toBe(false);
  });

  it('reports a disc the size the Sun actually is', () => {
    const mark = celestialMark('sun', SOLSTICE_NOON, GREENWICH, poseAt(180, 60), FRAME);
    expect(mark.angularRadiusDeg).toBeGreaterThan(0.26);
    expect(mark.angularRadiusDeg).toBeLessThan(0.272);
  });

  it('separates "below the horizon" from "outside the frame"', () => {
    // Midnight on the June solstice at Greenwich. Anti-transit altitude is
    // |latitude + declination| − 90 = |51.4779 + 23.44| − 90 = −15.08°, due
    // north. A camera pointing north and level has a 35° vertical field, so
    // that position is INSIDE the frame while the Sun is under the ground.
    // The two facts are reported separately, because a disc drawn over a
    // hillside at a Sun nobody can see would be a mark with no referent.
    const pose = poseAt(0, 0);
    const mark = celestialMark('sun', new Date('2026-06-21T00:00:00Z'), GREENWICH, pose, FRAME);
    expect(mark.altitudeDeg).toBeLessThan(-14);
    expect(mark.altitudeDeg).toBeGreaterThan(-16);
    expect(mark.belowHorizon).toBe(true);
    expect(mark.inFrame).toBe(true);
    // The sentence leads with the fact that decides whether to look: there is
    // nothing up there to line the app up against.
    expect(offFrameDirection(mark, pose).text).toContain('below the horizon');
  });
});

describe('the Moon mark', () => {
  it('reports a disc the size the Moon actually is', () => {
    // Anywhere in its orbit the Moon is between about 0.49° and 0.56° across.
    const mark = celestialMark(
      'moon',
      new Date('2026-09-29T03:00:00Z'),
      GREENWICH,
      poseAt(0, 0),
      FRAME,
    );
    expect(mark.angularRadiusDeg).toBeGreaterThan(0.24);
    expect(mark.angularRadiusDeg).toBeLessThan(0.29);
  });

  it('is about twice the Sun’s angular size, which is the coincidence it is', () => {
    const when = new Date('2026-09-29T03:00:00Z');
    const [sun, moon] = celestialMarks(when, GREENWICH, poseAt(0, 0), FRAME);
    expect(sun).toBeDefined();
    expect(moon).toBeDefined();
    if (sun === undefined || moon === undefined) return;
    const ratio = moon.angularRadiusDeg / sun.angularRadiusDeg;
    expect(ratio).toBeGreaterThan(0.88);
    expect(ratio).toBeLessThan(1.08);
  });
});

describe('projection into the frame', () => {
  it('lands the disc at frame centre when the camera looks straight at it', () => {
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    const aimed = celestialMark(
      'sun',
      when,
      GREENWICH,
      poseAt(probe.azimuthDeg, probe.altitudeDeg),
      FRAME,
    );
    expect(aimed.centrePx.xPx).toBeCloseTo(FRAME.widthPx / 2, 6);
    expect(aimed.centrePx.yPx).toBeCloseTo(FRAME.heightPx / 2, 6);
    expect(aimed.inFrame).toBe(true);
  });

  it('draws an on-axis disc at the radius the projection gives', () => {
    // Closed form for a disc at frame centre:
    //   radiusPx = (heightPx / 2) · tan(r) / tan(vFov / 2)
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    const pose = poseAt(probe.azimuthDeg, probe.altitudeDeg, 60, 35);
    const aimed = celestialMark('sun', when, GREENWICH, pose, FRAME);

    const expected =
      ((FRAME.heightPx / 2) * Math.tan(aimed.angularRadiusDeg * DEG)) / Math.tan(17.5 * DEG);
    expect(aimed.radiusPx).toBeCloseTo(expected, 6);
    // A half-degree disc in a 35° frame is a few pixels across — a ruler, not
    // an icon.
    expect(aimed.radiusPx).toBeGreaterThan(2);
    expect(aimed.radiusPx).toBeLessThan(12);
  });

  it('draws a wider disc in a narrower frame, by the tangent ratio', () => {
    // Halving the field of view roughly doubles the pixels per degree, so the
    // same disc grows. The ratio is tan(17.5°)/tan(8.75°), not 2.
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    const wide = celestialMark(
      'sun',
      when,
      GREENWICH,
      poseAt(probe.azimuthDeg, probe.altitudeDeg, 60, 35),
      FRAME,
    );
    const narrow = celestialMark(
      'sun',
      when,
      GREENWICH,
      poseAt(probe.azimuthDeg, probe.altitudeDeg, 30, 17.5),
      FRAME,
    );
    expect(narrow.radiusPx / wide.radiusPx).toBeCloseTo(
      Math.tan(17.5 * DEG) / Math.tan(8.75 * DEG),
      4,
    );
  });

  it('never draws a disc too small to line anything up against', () => {
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    // A 170° field on a 450 px frame puts the Sun well under a pixel.
    const mark = celestialMark(
      'sun',
      when,
      GREENWICH,
      poseAt(probe.azimuthDeg, probe.altitudeDeg, 175, 170),
      FRAME,
    );
    expect(mark.radiusPx).toBe(MIN_MARK_RADIUS_PX);
  });

  it('reports a mark outside the frame instead of omitting it', () => {
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    // Look 90° to the left of the Sun.
    const pose = poseAt(probe.azimuthDeg - 90, probe.altitudeDeg);
    const mark = celestialMark('sun', when, GREENWICH, pose, FRAME);
    expect(mark.inFrame).toBe(false);
    const direction = offFrameDirection(mark, pose);
    expect(direction.turnDeg).toBeCloseTo(90, 6);
    expect(direction.text).toContain('to your right');
    expect(direction.text).toContain('Turn that way');
  });

  it('folds the turn onto the shorter way round', () => {
    const when = new Date('2026-06-21T12:00:00Z');
    const probe = celestialMark('sun', when, GREENWICH, poseAt(0, 0), FRAME);
    const pose = poseAt(probe.azimuthDeg + 20, probe.altitudeDeg);
    const mark = celestialMark('sun', when, GREENWICH, pose, FRAME);
    // The Sun is 20° anticlockwise, not 340° clockwise.
    expect(offFrameDirection(mark, pose).turnDeg).toBeCloseTo(-20, 6);
    expect(offFrameDirection(mark, pose).text).toContain('to your left');
  });
});

describe('which marks a calibration tap may be measured against', () => {
  // Camera due south and level, 60° × 35° on an 800 × 450 overlay.
  const POSE = poseAt(180, 0);

  /** A Sun mark at a stated direction, projected the way the screen draws it. */
  function sunAt(azimuthDeg: number, altitudeDeg: number): CelestialMark {
    const point = projectToImage(POSE, azimuthDeg, altitudeDeg);
    return {
      body: 'sun',
      centrePx: { xPx: point.x * FRAME.widthPx, yPx: point.y * FRAME.heightPx },
      radiusPx: 4,
      angularRadiusDeg: 0.267,
      azimuthDeg,
      altitudeDeg,
      inFrame: point.inFrame,
      belowHorizon: altitudeDeg < 0,
    };
  }

  it('takes a mark in the picture', () => {
    expect(isTappableMark(sunAt(190, 5), POSE, FRAME)).toBe(true);
  });

  it('takes a mark above the picture, where a tilt error puts it', () => {
    // 30° up on the centre line: tan 30° / tan 17.5° = 1.83 half-heights, off the top.
    const mark = sunAt(180, 30);
    expect(mark.inFrame).toBe(false);
    expect(mark.centrePx.yPx).toBeLessThan(0);
    expect(isTappableMark(mark, POSE, FRAME)).toBe(true);
  });

  it('refuses a mark off the side, which is a heading error for the re-anchor', () => {
    // 60° to the right: tan 60° / tan 30° = 3 half-widths past the centre,
    // so x = 400 + 3 · 400 = 1600 px.
    const mark = sunAt(240, 10);
    expect(mark.centrePx.xPx).toBeCloseTo(1600, 6);
    expect(isTappableMark(mark, POSE, FRAME)).toBe(false);
  });

  it('refuses a mark behind the camera even when its mirrored image lands on the picture', () => {
    // Due north, 10° up, behind a camera facing south: the perspective divide
    // mirrors it to x = 400, inside the width.
    const mark = sunAt(0, 10);
    expect(mark.centrePx.xPx).toBeCloseTo(400, 6);
    expect(isTappableMark(mark, POSE, FRAME)).toBe(false);
  });

  it('refuses a mark below the horizon, in the picture or not', () => {
    expect(isTappableMark(sunAt(180, -5), POSE, FRAME)).toBe(false);
  });

  it('lets the home session measure a tap on the real Sun against a mark off the top', () => {
    const mark = sunAt(180, 30);
    const outcome = resolveCalibrationTap(
      { xPx: 400, yPx: 20 },
      FRAME,
      [mark]
        .filter((candidate) => isTappableMark(candidate, POSE, FRAME))
        .map((candidate) => ({ kind: 'sun' as const, name: 'the Sun', drawnPx: candidate.centrePx })),
    );
    expect(outcome.ok).toBe(true);
  });
});
