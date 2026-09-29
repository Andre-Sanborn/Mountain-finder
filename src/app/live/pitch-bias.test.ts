/**
 * The stored tilt zero point.
 *
 * The expectations are the rule the module header states: a measurement is
 * kept whole or dropped whole, and an unreadable store is the same state as an
 * empty one. Nothing here is a number this code produced.
 *
 * The storage tests use a hand-written fake rather than jsdom, and they include
 * a store that throws on every access — which is what Safari does in a private
 * window, and what a browser set to block site data does everywhere.
 */

import { describe, expect, it } from 'vitest';

import type { WebStorageLike } from './fov-choice';
import {
  PITCH_BIAS_STORE_KEY,
  parsePitchBiasCalibrations,
  pitchBiasKey,
  readStoredPitchBias,
  writeStoredPitchBias,
  type PitchBiasCalibration,
} from './pitch-bias';

class MemoryStorage implements WebStorageLike {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

class ThrowingStorage implements WebStorageLike {
  getItem(): string | null {
    throw new Error('site data is blocked');
  }
  setItem(): void {
    throw new Error('site data is blocked');
  }
}

const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1';

const MEASUREMENT: PitchBiasCalibration = {
  biasDeg: -0.62,
  spreadDeg: 0.18,
  segmentCount: 3,
  method: 'Measured against the sun over 3 aiming step(s) in the home session.',
  source: 'sun-aiming-steps',
};

describe('the key', () => {
  it('is the user agent, because the tilt sensor is a property of the handset', () => {
    expect(pitchBiasKey(IOS_UA)).toBe(IOS_UA);
  });

  it('never collapses a missing user agent into an empty key', () => {
    expect(pitchBiasKey('')).toBe('unknown');
  });
});

describe('the parser', () => {
  it('keeps a whole measurement', () => {
    const raw = JSON.stringify({ [IOS_UA]: MEASUREMENT });
    expect(parsePitchBiasCalibrations(raw)[IOS_UA]).toEqual(MEASUREMENT);
  });

  it('drops an entry missing any field, rather than repairing it', () => {
    // A half-understood measurement is indistinguishable from no measurement,
    // and no measurement is what the band reports as unquantified.
    const raw = JSON.stringify({
      a: { biasDeg: 0.4, spreadDeg: 0.1, segmentCount: 3 },
      b: { biasDeg: 0.4, spreadDeg: 0.1, method: 'x' },
      c: { spreadDeg: 0.1, segmentCount: 3, method: 'x' },
      d: { biasDeg: 0.4, spreadDeg: 0.1, segmentCount: 3, method: 'x' },
    });
    expect(parsePitchBiasCalibrations(raw)).toEqual({});
  });

  it('refuses a negative spread, a bias past a quarter turn, and an unknown source', () => {
    const raw = JSON.stringify({
      a: { ...MEASUREMENT, spreadDeg: -0.1 },
      b: { ...MEASUREMENT, biasDeg: 91 },
      c: { ...MEASUREMENT, segmentCount: 0 },
      d: { ...MEASUREMENT, segmentCount: 1.5 },
      e: { ...MEASUREMENT, source: 'guessed' },
    });
    expect(parsePitchBiasCalibrations(raw)).toEqual({});
  });

  it('returns nothing for a blob that is not an object of entries', () => {
    expect(parsePitchBiasCalibrations('')).toEqual({});
    expect(parsePitchBiasCalibrations('{ not json')).toEqual({});
    expect(parsePitchBiasCalibrations('[]')).toEqual({});
    expect(parsePitchBiasCalibrations('null')).toEqual({});
    expect(parsePitchBiasCalibrations(42)).toEqual({});
  });
});

describe('the store', () => {
  it('reads back what it wrote, under the key it was written at', () => {
    const storage = new MemoryStorage();
    expect(writeStoredPitchBias(storage, IOS_UA, MEASUREMENT)).toBe(true);
    expect(readStoredPitchBias(storage, IOS_UA)).toEqual(MEASUREMENT);
    expect(readStoredPitchBias(storage, 'some other browser')).toBeUndefined();
    expect(storage.getItem(PITCH_BIAS_STORE_KEY)).not.toBeNull();
  });

  it('leaves another handset’s measurement alone', () => {
    const storage = new MemoryStorage();
    writeStoredPitchBias(storage, 'phone one', MEASUREMENT);
    writeStoredPitchBias(storage, 'phone two', { ...MEASUREMENT, biasDeg: 1.25 });
    expect(readStoredPitchBias(storage, 'phone one')?.biasDeg).toBe(-0.62);
    expect(readStoredPitchBias(storage, 'phone two')?.biasDeg).toBe(1.25);
  });

  it('treats a store that throws as an empty one, on both sides', () => {
    const storage = new ThrowingStorage();
    expect(readStoredPitchBias(storage, IOS_UA)).toBeUndefined();
    expect(writeStoredPitchBias(storage, IOS_UA, MEASUREMENT)).toBe(false);
  });

  it('has no measurement when there is no storage at all', () => {
    expect(readStoredPitchBias(undefined, IOS_UA)).toBeUndefined();
    expect(writeStoredPitchBias(undefined, IOS_UA, MEASUREMENT)).toBe(false);
  });
});
