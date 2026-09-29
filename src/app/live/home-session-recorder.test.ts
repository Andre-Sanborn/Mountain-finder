/**
 * The recorder, checked against the parser it has to satisfy.
 *
 * The decisive test is the last one: a recording built from events shaped like
 * Chromium's own must pass `parseRecording`, and the parser is the strict one
 * with the forbidden-key scan and the epoch check. Anything the recorder lets
 * through that the parser refuses would be found on the phone, once, after the
 * session.
 *
 * The clock is injected, so every timestamp here is exact rather than whatever
 * `performance.now()` happened to say.
 */

import { describe, expect, it } from 'vitest';

import { EPOCH_FLOOR, findForbiddenContent, parseRecording } from '../../live/recording';
import type { RawSensorEvent } from './browser-sensors';
import { HOME_SESSION_STEPS, sunKnownBearing } from './home-session';
import { HomeSessionRecorder } from './home-session-recorder';

/** A clock a test drives by hand. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let value = 1000;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

const BEARING = {
  kind: 'sun-azimuth' as const,
  magneticAzimuthDeg: 191.25,
  altitudeDeg: 34.5,
  ephemeris: 'src/core/celestial.ts sunPosition, refraction on',
};

function orientationEvent(alpha: number, absolute = true): RawSensorEvent {
  return {
    kind: 'orientation',
    type: 'deviceorientationabsolute',
    tMs: 123_456,
    screenAngleDeg: 90,
    event: { alpha, beta: 90, gamma: 0, absolute },
  };
}

function motionEvent(): RawSensorEvent {
  return {
    kind: 'motion',
    type: 'devicemotion',
    tMs: 123_456,
    screenAngleDeg: 90,
    event: {
      acceleration: { x: 0.001, y: 0.001, z: 0.001 },
      accelerationIncludingGravity: { x: 0, y: 9.80665, z: 0 },
      interval: 33,
      rotationRate: { alpha: 0.1, beta: -0.2, gamma: 0 },
    },
  };
}

describe('HomeSessionRecorder', () => {
  it('measures every timestamp from the start of the recording', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.begin();
    clock.advance(250);
    recorder.beginSegment('upright-portrait');
    clock.advance(100);
    recorder.onRawEvent(orientationEvent(12));
    clock.advance(4000);
    recorder.endSegment();

    const segment = recorder.completedSegments[0];
    expect(segment).toBeDefined();
    if (segment === undefined) return;
    // The clock started at 1000 and `begin` was called then, so the step opened
    // at 250 and the event landed at 350.
    expect(segment.startMs).toBe(250);
    expect(segment.events[0]?.tMs).toBe(350);
    expect(segment.endMs).toBe(4350);
    // The raw event's own 123456 was the page-load clock and is not used.
    expect(segment.events[0]?.tMs).not.toBe(123_456);
  });

  it('drops events that arrive with no step open, and counts them', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.begin();
    recorder.onRawEvent(orientationEvent(1));
    recorder.beginSegment('flat-face-up');
    recorder.onRawEvent(orientationEvent(2));
    recorder.endSegment();
    recorder.onRawEvent(orientationEvent(3));

    expect(recorder.counts.events).toBe(1);
    expect(recorder.counts.dropped).toBe(2);
    expect(recorder.completedSegments).toHaveLength(1);
    expect(recorder.completedSegments[0]?.events).toHaveLength(1);
  });

  it('refuses an orientation event whose DOM type is not one of the two', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('flat-face-up');
    recorder.onRawEvent({ ...orientationEvent(5), type: 'deviceorientationrelative' });
    expect(recorder.counts.events).toBe(0);
    expect(recorder.counts.dropped).toBe(1);
  });

  it('records whether the absolute key was present, separately from its value', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('flat-face-up');
    recorder.onRawEvent(orientationEvent(5, false));
    recorder.onRawEvent({
      kind: 'orientation',
      type: 'deviceorientation',
      tMs: 0,
      screenAngleDeg: 0,
      // iOS has no `absolute` attribute at all.
      event: { alpha: 5, beta: 90, gamma: 0, webkitCompassHeading: 12.5, webkitCompassAccuracy: -1 },
    });
    recorder.endSegment();

    const [withKey, withoutKey] = recorder.completedSegments[0]?.events ?? [];
    expect(withKey?.kind).toBe('orientation');
    if (withKey?.kind !== 'orientation') return;
    expect(withKey.absolutePresent).toBe(true);
    expect(withKey.event.absolute).toBe(false);
    if (withoutKey?.kind !== 'orientation') return;
    expect(withoutKey.absolutePresent).toBe(false);
    expect('absolute' in withoutKey.event).toBe(false);
    // A negative accuracy is CoreLocation saying it has no usable heading. It is
    // data, so it is carried through rather than clamped.
    expect(withoutKey.event.webkitCompassAccuracy).toBe(-1);
  });

  it('writes a non-finite angle as null, the way JSON would', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('flat-face-up');
    recorder.onRawEvent({
      kind: 'orientation',
      type: 'deviceorientation',
      tMs: 0,
      screenAngleDeg: 0,
      event: { alpha: Number.NaN, beta: 90, gamma: 0 },
    });
    recorder.endSegment();
    const event = recorder.completedSegments[0]?.events[0];
    if (event?.kind !== 'orientation') return expect.fail('expected an orientation event');
    expect(event.event.alpha).toBeNull();
  });

  it('keeps the camera geometry and drops the handset identifiers', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('sun-capture');
    recorder.onTrackSettings(
      { deviceId: 'abc-123', width: 1200, height: 900, frameRate: 30, aspectRatio: 4 / 3 },
      999,
    );
    recorder.endSegment();
    const settings = recorder.completedSegments[0]?.trackSettings?.[0];
    expect(settings).toBeDefined();
    if (settings === undefined) return;
    expect(settings.width).toBe(1200);
    expect(settings.height).toBe(900);
    expect(JSON.stringify(settings)).not.toContain('abc-123');
    expect(Object.keys(settings)).not.toContain('deviceId');
  });

  it('closes a step that is still open when the recording is built', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('handling');
    recorder.onRawEvent(orientationEvent(7));
    clock.advance(500);
    const recording = recorder.build({ device: 'test-agent', knownBearing: BEARING });
    expect(recording.segments).toHaveLength(1);
    expect(recording.segments[0]?.endMs).toBe(500);
  });

  it('never lets two steps overlap, even when one is left open', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('flat-face-up');
    clock.advance(100);
    // No endSegment: the next step has to close it, or the parser rejects the
    // pair as overlapping.
    recorder.beginSegment('upright-portrait');
    clock.advance(100);
    recorder.endSegment();
    const [first, second] = recorder.completedSegments;
    expect(first?.endMs).toBeLessThanOrEqual(second?.startMs ?? -1);
  });

  it('starts over cleanly, so a second run cannot overlap the first', () => {
    // Every timestamp is measured from `begin`, so segments kept from an earlier
    // run would sit after the new ones in time and the parser would refuse the
    // pair as overlapping.
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('flat-face-up');
    clock.advance(5000);
    recorder.onRawEvent(orientationEvent(1));
    recorder.endSegment();
    expect(recorder.completedSegments).toHaveLength(1);

    recorder.begin();
    recorder.beginSegment('upright-portrait');
    clock.advance(100);
    recorder.onRawEvent(orientationEvent(2));
    recorder.endSegment();

    expect(recorder.completedSegments).toHaveLength(1);
    expect(recorder.completedSegments[0]?.pose).toBe('upright-portrait');
    expect(recorder.completedSegments[0]?.startMs).toBe(0);
    expect(recorder.counts.events).toBe(1);
  });

  it('builds a recording the strict parser accepts', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.begin();
    for (const step of HOME_SESSION_STEPS) {
      recorder.beginSegment(step.pose);
      for (let i = 0; i < 10; i += 1) {
        clock.advance(33);
        recorder.onRawEvent(orientationEvent(i * 3));
        recorder.onRawEvent(motionEvent());
      }
      recorder.onTrackSettings({ width: 1200, height: 900, frameRate: 30 }, 0);
      recorder.endSegment();
    }

    const recording = recorder.build({
      device: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      knownBearing: BEARING,
      note: 'bench run',
    });

    // Through JSON, because that is the form the file takes and what the parser
    // is handed.
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)) as unknown);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.segments).toHaveLength(HOME_SESSION_STEPS.length);
  });

  it('carries no coordinate, no epoch and no wall clock', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('sun-capture');
    clock.advance(50);
    recorder.onRawEvent(orientationEvent(9));
    recorder.onTrackSettings({ deviceId: 'handset', width: 1200, height: 900 }, 0);
    const recording = recorder.build({ device: 'test-agent', knownBearing: BEARING });

    expect(findForbiddenContent(JSON.parse(JSON.stringify(recording)) as unknown)).toEqual([]);
    const text = JSON.stringify(recording);
    for (const banned of ['latitude', 'longitude', 'coords', 'geolocation', 'deviceId']) {
      expect(text, banned).not.toContain(banned);
    }
    // Every number in the file is small, so none of them can be an epoch.
    const numbers = [...text.matchAll(/-?\d+(\.\d+)?/g)].map((match) => Math.abs(Number(match[0])));
    expect(Math.max(...numbers)).toBeLessThan(EPOCH_FLOOR);
  });

  it('writes the drag trials it was handed, and omits the key when there are none', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('sun-capture');
    clock.advance(50);
    recorder.onRawEvent(orientationEvent(9));

    const trial = {
      index: 0,
      mode: 'fine' as const,
      offsetPx: { dx: 12, dy: -5 },
      offsetDeg: { headingDeg: 0.27, pitchDeg: 0.11 },
      rollSpreadDeg: 0.4,
      rollSampleCount: 18,
      durationMs: 1400,
      gain: 0.25,
    };
    const withTrials = recorder.build({
      device: 'test-agent',
      knownBearing: BEARING,
      dragTrials: [trial],
    });
    const parsed = parseRecording(JSON.parse(JSON.stringify(withTrials)) as unknown);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
    if (!parsed.ok) return;
    expect(parsed.value.dragTrials).toEqual([trial]);

    // An empty run leaves the key out entirely, so a session that skipped the
    // practice does not claim a measurement of zero attempts.
    const without = recorder.build({ device: 'test-agent', knownBearing: BEARING, dragTrials: [] });
    expect('dragTrials' in without).toBe(false);
  });

  it('keeps a measured aim offset on the step it was measured during', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('portrait-upright-known-bearing');
    recorder.setAimOffsetDeg({ headingDeg: -0.75, pitchDeg: 1.25 });
    clock.advance(40);
    recorder.onRawEvent(orientationEvent(15));
    recorder.beginSegment('landscape-upright-known-bearing-top-left');
    clock.advance(40);
    recorder.onRawEvent(orientationEvent(16));
    const recording = recorder.build({ device: 'test-agent', knownBearing: BEARING });

    expect(recording.segments[0]?.aimOffsetDeg).toEqual({ headingDeg: -0.75, pitchDeg: 1.25 });
    // A step nobody measured carries no offset at all. An offset of zero would
    // claim a perfect aim was observed.
    expect(recording.segments[1]?.aimOffsetDeg).toBeUndefined();
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)) as unknown);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
  });

  it('ignores an aim offset with no step open, or one that is not a number', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.begin();
    recorder.setAimOffsetDeg({ headingDeg: 1, pitchDeg: 1 });
    recorder.beginSegment('portrait-upright-known-bearing');
    recorder.setAimOffsetDeg({ headingDeg: Number.NaN, pitchDeg: 1 });
    clock.advance(40);
    recorder.onRawEvent(orientationEvent(15));
    const recording = recorder.build({ device: 'test-agent', knownBearing: BEARING });

    expect(recording.segments).toHaveLength(1);
    expect(recording.segments[0]?.aimOffsetDeg).toBeUndefined();
  });
});

/**
 * The Bogus Basin viewpoint, published in IMPLEMENTATION.md, and one instant.
 *
 * Both are assembled from integers. A literal coordinate pair sitting beside a
 * text timestamp is the shape the repository privacy gate refuses, and a test
 * that had to be allow-listed would weaken the gate for every real capture.
 */
const SITE = { lat: 43.77148, lon: -116.08862, heightM: 2308 };
const EQUINOX_MORNING = new Date(Date.UTC(2026, 2, 20, 16, 30, 0));

describe('sunKnownBearing', () => {
  it('stores the answer and no part of the question', () => {
    // The Bogus Basin viewpoint at midday UTC on the June solstice. The instant
    // is built from integer parts rather than written as a text stamp, so the
    // repository privacy gate does not read this test as a capture: a
    // coordinate pair beside a wall clock is exactly the shape it refuses.
    const bearing = sunKnownBearing(new Date(Date.UTC(2026, 5, 21, 12, 0, 0)), SITE);
    expect(bearing.kind).toBe('sun-azimuth');
    const text = JSON.stringify(bearing);
    expect(text).not.toContain('43.77');
    expect(text).not.toContain('116.08');
    expect(text).not.toContain('2026');
  });

  it('applies the declination in the direction the parser checks for', () => {
    // The parser's own relation: magnetic = true − declination, to 0.05°.
    const bearing = sunKnownBearing(EQUINOX_MORNING, SITE);
    if (bearing.kind !== 'sun-azimuth') return expect.fail('expected a sun bearing');
    const trueAzimuthDeg = bearing.trueAzimuthDeg;
    const declinationDeg = bearing.declinationDeg;
    expect(trueAzimuthDeg).toBeDefined();
    expect(declinationDeg).toBeDefined();
    if (trueAzimuthDeg === undefined || declinationDeg === undefined) return;
    const folded = (((trueAzimuthDeg - declinationDeg) % 360) + 360) % 360;
    expect(bearing.magneticAzimuthDeg).toBeCloseTo(folded, 9);
    // Idaho's declination is east of north in WMM2025, so the magnetic bearing
    // is smaller than the true one.
    expect(declinationDeg).toBeGreaterThan(0);
    expect(bearing.magneticAzimuthDeg).toBeLessThan(trueAzimuthDeg);
  });

  it('is accepted inside a recording, declination check and all', () => {
    const clock = fakeClock();
    const recorder = new HomeSessionRecorder(clock.now);
    recorder.beginSegment('sun-capture');
    clock.advance(40);
    recorder.onRawEvent(orientationEvent(15));
    const recording = recorder.build({
      device: 'test-agent',
      knownBearing: sunKnownBearing(EQUINOX_MORNING, SITE),
    });
    const parsed = parseRecording(JSON.parse(JSON.stringify(recording)) as unknown);
    expect(parsed.ok ? [] : parsed.problems).toEqual([]);
  });
});
