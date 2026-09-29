/**
 * The script the person follows, and the one number kept from the fix.
 *
 * The script's job is coverage and plain words, so that is what is checked: one
 * step per pose the schema knows, in the schema's order, and no jargon in the
 * instructions. The bearing's job is to be the parser's `sun-azimuth`, so it is
 * checked against the parser's own relation rather than against itself.
 */

import { describe, expect, it } from 'vitest';

import { POSE_LABELS } from '../../live/recording';
import {
  HOME_SESSION_PRIVACY_STATEMENT,
  HOME_SESSION_STEPS,
  RECORDING_FILE_NAME,
  isHomeSessionRequested,
  scriptCoversEveryPose,
  scriptDurationMs,
  sunIsUsable,
  sunKnownBearing,
} from './home-session';

describe('isHomeSessionRequested', () => {
  it('turns on for the address a person is given', () => {
    expect(isHomeSessionRequested('?session=home')).toBe(true);
    expect(isHomeSessionRequested('?a=1&session=home&b=2')).toBe(true);
  });

  it('stays off for the ordinary live screen', () => {
    expect(isHomeSessionRequested('')).toBe(false);
    expect(isHomeSessionRequested('?session=field')).toBe(false);
    expect(isHomeSessionRequested('?home=session')).toBe(false);
  });
});

describe('HOME_SESSION_STEPS', () => {
  it('has one step per pose the recording schema knows, in its order', () => {
    expect(scriptCoversEveryPose()).toBe(true);
    expect(HOME_SESSION_STEPS.map((step) => step.pose)).toEqual([...POSE_LABELS]);
  });

  it('gives each step one plain sentence a stranger can follow', () => {
    // No Euler angles, no axis names, no jargon. The words the app must not use
    // on this screen are the words the analyzer uses in its own verdicts.
    const jargon = [
      'alpha',
      'beta',
      'gamma',
      'azimuth',
      'declination',
      'quaternion',
      'magnetometer',
      'euler',
      'accelerometer',
      'field of view',
    ];
    for (const step of HOME_SESSION_STEPS) {
      expect(step.instruction.length, step.pose).toBeGreaterThan(20);
      expect(step.instruction.length, step.pose).toBeLessThan(230);
      for (const word of jargon) {
        expect(step.instruction.toLowerCase(), `${step.pose} / ${word}`).not.toContain(word);
      }
      expect(step.title.length, step.pose).toBeLessThan(30);
    }
  });

  it('holds every step long enough for the analyzer’s eight-sample floor', () => {
    // A browser delivers orientation events at 30 Hz or better, and the
    // analyzer scores a segment only once it has eight usable samples. Three
    // seconds is the floor that leaves an order of magnitude of margin.
    for (const step of HOME_SESSION_STEPS) {
      expect(step.holdMs, step.pose).toBeGreaterThanOrEqual(3000);
    }
    // The drift question needs minutes of stillness, per the protocol.
    const drift = HOME_SESSION_STEPS.find((step) => step.pose === 'still-drift');
    expect(drift?.holdMs).toBeGreaterThanOrEqual(180_000);
  });

  it('is short enough for one sitting', () => {
    // Under ten minutes of wall time, dominated by the two long steps.
    expect(scriptDurationMs()).toBeLessThan(600_000);
    expect(scriptDurationMs()).toBeGreaterThan(240_000);
  });

  it('asks for the sun at two places in the frame on the tap step', () => {
    const tap = HOME_SESSION_STEPS.find((step) => step.kind === 'tap');
    expect(tap?.pose).toBe('sun-capture');
    // Two taps in different parts of the picture is what separates a wrong lens
    // width from a wrong direction, so the instruction has to ask for both.
    expect(tap?.instruction).toContain('LEFT');
    expect(tap?.instruction).toContain('RIGHT');
  });
});

describe('HOME_SESSION_PRIVACY_STATEMENT', () => {
  it('says what is in the file, what is not, and where it goes', () => {
    const text = HOME_SESSION_PRIVACY_STATEMENT.join(' ');
    expect(text).toContain('does not record where you are');
    expect(text).toContain('thrown away');
    expect(text).toContain('Nothing is uploaded');
    expect(text).toContain('goes only where you send it');
  });

  it('names a file with no date in it', () => {
    // A date in the name is a wall clock, which dates the session as precisely
    // as a coordinate places it.
    expect(RECORDING_FILE_NAME).toBe('mountain-finder-home-session.json');
    expect(RECORDING_FILE_NAME).not.toMatch(/\d/);
  });
});

describe('sunKnownBearing', () => {
  // Bogus Basin, published in IMPLEMENTATION.md. Every instant below is built
  // from integer parts: a coordinate pair beside a text timestamp is the shape
  // the repository privacy gate refuses, and rightly.
  const SITE = { lat: 43.77148, lon: -116.08862, heightM: 2308 };

  it('is the sun’s azimuth turned into a compass bearing', () => {
    // The June solstice. At 19:00 UTC the local solar time is
    // 19:00 − 116.08862/15 h = 11:15, so the sun is still east of south: the
    // azimuth is between 90° and 180°. Noon altitude at this latitude is
    // 90 − 43.77 + 23.44 = 69.7°, and three quarters of an hour before noon it
    // is still above 60°.
    const bearing = sunKnownBearing(new Date(Date.UTC(2026, 5, 21, 19, 0, 0)), SITE);
    if (bearing.kind !== 'sun-azimuth') return expect.fail('expected a sun bearing');
    expect(bearing.trueAzimuthDeg).toBeGreaterThan(90);
    expect(bearing.trueAzimuthDeg).toBeLessThan(180);
    expect(bearing.altitudeDeg).toBeGreaterThan(60);
    expect(bearing.ephemeris).toContain('celestial.ts');
  });

  it('keeps magnetic, true and declination consistent to the parser’s tolerance', () => {
    const instants: readonly [number, number, number, number, number][] = [
      [2026, 0, 15, 17, 0],
      [2026, 2, 20, 16, 30],
      [2026, 5, 21, 19, 0],
      [2026, 8, 29, 15, 0],
    ];
    for (const [year, monthIndex, day, hour, minute] of instants) {
      const iso = `${year}/${monthIndex + 1}/${day} ${hour}h${minute}`;
      const bearing = sunKnownBearing(new Date(Date.UTC(year, monthIndex, day, hour, minute)), SITE);
      if (bearing.kind !== 'sun-azimuth') return expect.fail('expected a sun bearing');
      const { trueAzimuthDeg, declinationDeg } = bearing;
      if (trueAzimuthDeg === undefined || declinationDeg === undefined) {
        return expect.fail('both cross-check fields must be stored');
      }
      const expected = (((trueAzimuthDeg - declinationDeg) % 360) + 360) % 360;
      expect(bearing.magneticAzimuthDeg, iso).toBeCloseTo(expected, 9);
      expect(bearing.magneticAzimuthDeg, iso).toBeGreaterThanOrEqual(0);
      expect(bearing.magneticAzimuthDeg, iso).toBeLessThan(360);
    }
  });

  it('folds a bearing that crosses north', () => {
    // A site where true − declination goes negative: Alaska carries about 14° of
    // east declination, so a sun a few degrees east of north folds past 360.
    const bearing = sunKnownBearing(new Date(Date.UTC(2026, 5, 21, 20, 0, 0)), {
      lat: 64.84,
      lon: -147.72,
      heightM: 135,
    });
    expect(bearing.magneticAzimuthDeg).toBeGreaterThanOrEqual(0);
    expect(bearing.magneticAzimuthDeg).toBeLessThan(360);
  });
});

describe('sunIsUsable', () => {
  const base = {
    kind: 'sun-azimuth' as const,
    magneticAzimuthDeg: 180,
    ephemeris: 'test',
  };

  it('accepts a sun a person can point at', () => {
    expect(sunIsUsable({ ...base, altitudeDeg: 30 }).usable).toBe(true);
  });

  it('refuses a sun below the horizon, and says when to come back', () => {
    const answer = sunIsUsable({ ...base, altitudeDeg: -3 });
    expect(answer.usable).toBe(false);
    expect(answer.why).toContain('higher');
  });

  it('refuses a sun too near overhead to centre in a wide lens', () => {
    const answer = sunIsUsable({ ...base, altitudeDeg: 78 });
    expect(answer.usable).toBe(false);
    expect(answer.why).toContain('morning');
  });
});
