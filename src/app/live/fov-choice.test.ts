/**
 * The field of view the overlay is scaled by, and its label.
 *
 * The field-of-view expectations are the long-axis rule stated in closed form:
 * `2·atan(36 / (2·f₃₅))` on the longer displayed axis, and the tangent relation
 * across. At 24 mm that is `2·atan(0.75)`, at 48 mm `2·atan(0.375)`, at 13 mm
 * `2·atan(36/26)`. None of them came from running the code.
 *
 * The storage tests use a hand-written fake rather than jsdom, and they include
 * a store that throws on every access — which is what Safari does in a private
 * window, and what a browser set to block site data does everywhere.
 */

import { describe, expect, it } from 'vitest';

import {
  FOV_STORE_KEY,
  fovCalibrationKey,
  lensPreset,
  parseFovCalibrations,
  phoneModelPreset,
  PHONE_MODEL_PRESETS,
  readStoredFovCalibration,
  resolveFov,
  writeStoredFovCalibration,
  type FovCalibration,
  type WebStorageLike,
} from './fov-choice';

const DEG = Math.PI / 180;
const FRAME = { widthPx: 1200, heightPx: 900 };
const NO_CROP = { x: 1, y: 1 };

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
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
  setItem(): void {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  }
}

/** `resolveFov` refuses a frame with no extent; every case here supplies one. */
function resolved(input: Parameters<typeof resolveFov>[0]): NonNullable<ReturnType<typeof resolveFov>> {
  const answer = resolveFov(input);
  if (answer === undefined) throw new Error('resolveFov refused a frame the test gave extent');
  return answer;
}

describe('the preset tables', () => {
  it('carries the phone the fixtures were shot on, and makes it the default', () => {
    const preset = phoneModelPreset('iPhone 17 Pro Max');
    expect(preset.lenses.map((lens) => lens.focalLength35mm)).toEqual([13, 24, 48, 100, 200]);
    expect(PHONE_MODEL_PRESETS[0]?.modelName).toBe('iPhone 17 Pro Max');
  });

  it('falls back to the default model for a name it does not hold', () => {
    expect(phoneModelPreset('Pixel 9').modelName).toBe('iPhone 17 Pro Max');
  });

  it('falls back to a model’s first lens for a label it does not hold', () => {
    const preset = phoneModelPreset('iPhone 15 Pro Max');
    expect(lensPreset(preset, '8x').focalLength35mm).toBe(13);
    expect(lensPreset(preset, '5x').focalLength35mm).toBe(120);
  });
});

describe('fovCalibrationKey', () => {
  it('keys on the track’s identity and the frame it delivers', () => {
    expect(fovCalibrationKey({ deviceId: 'abc', width: 1920, height: 1080 })).toBe('abc|1920x1080');
  });

  it('spells a missing field rather than dropping it, so two gaps cannot collide', () => {
    expect(fovCalibrationKey({ width: 1920, height: 1080 })).toBe('unknown|1920x1080');
    expect(fovCalibrationKey({ deviceId: 'abc' })).toBe('abc|unknownxunknown');
    expect(fovCalibrationKey({})).toBe('unknown|unknownxunknown');
  });
});

describe('resolveFov before the camera has sent a frame', () => {
  it('refuses a frame with no extent rather than inventing a field of view', () => {
    // A component renders before `getUserMedia` resolves and again before the
    // first frame is decoded, so `videoWidth` is 0 twice. A field of view there
    // would scale labels over a black rectangle; `undefined` is the honest
    // answer and the screen says "starting the camera".
    for (const frame of [
      { widthPx: 0, heightPx: 0 },
      { widthPx: 1200, heightPx: 0 },
      { widthPx: Number.NaN, heightPx: 900 },
    ]) {
      expect(
        resolveFov({
          decodedFrame: frame,
          visibleFraction: NO_CROP,
          modelName: 'iPhone 17 Pro Max',
          lensLabel: '1x main',
        }),
        JSON.stringify(frame),
      ).toBeUndefined();
    }
  });
});

describe('resolveFov on the guess path', () => {
  it('gives the 36 mm gate angle to the long axis and labels it uncalibrated', () => {
    // 24 mm on a 1200×900 frame: hFOV = 2·atan(36/48) = 2·atan(0.75),
    // tan(vFOV/2) = 0.75·(900/1200) = 0.5625.
    const answer = resolved({
      decodedFrame: FRAME,
      visibleFraction: NO_CROP,
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
    });

    expect(answer.source).toBe('spec-sheet-guess');
    expect(answer.frameFov.hFovDeg).toBeCloseTo((2 * Math.atan(0.75)) / DEG, 10);
    expect(answer.frameFov.vFovDeg).toBeCloseTo((2 * Math.atan(0.5625)) / DEG, 10);
    expect(answer.label).toContain('Uncalibrated FOV');
    expect(answer.label).toContain('24 mm');
    expect(answer.guessedFrom).toEqual({
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
      focalLength35mm: 24,
    });
  });

  it('uses the lens asked for', () => {
    // 48 mm: hFOV = 2·atan(36/96) = 2·atan(0.375).
    const answer = resolved({
      decodedFrame: FRAME,
      visibleFraction: NO_CROP,
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '2x',
    });
    expect(answer.frameFov.hFovDeg).toBeCloseTo((2 * Math.atan(0.375)) / DEG, 10);
  });

  it('applies the cover crop to the visible field but not to the frame field', () => {
    // 24 mm frame field as above; the visible box keeps 0.75 of the height, so
    // tan(v_box/2) = 0.5625 · 0.75 = 0.421875.
    const answer = resolved({
      decodedFrame: FRAME,
      visibleFraction: { x: 1, y: 0.75 },
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
    });
    expect(answer.frameFov.vFovDeg).toBeCloseTo((2 * Math.atan(0.5625)) / DEG, 10);
    expect(answer.visibleFov.vFovDeg).toBeCloseTo((2 * Math.atan(0.421875)) / DEG, 10);
    expect(answer.visibleFov.hFovDeg).toBeCloseTo(answer.frameFov.hFovDeg, 10);
  });

  it('gives the gate angle to the HEIGHT of a portrait stream', () => {
    // 900×1200 at 24 mm: the long axis is now the height, so
    // vFOV = 2·atan(0.75) and tan(hFOV/2) = 0.75·(900/1200) = 0.5625.
    const answer = resolved({
      decodedFrame: { widthPx: 900, heightPx: 1200 },
      visibleFraction: NO_CROP,
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
    });
    expect(answer.frameFov.vFovDeg).toBeCloseTo((2 * Math.atan(0.75)) / DEG, 10);
    expect(answer.frameFov.hFovDeg).toBeCloseTo((2 * Math.atan(0.5625)) / DEG, 10);
  });
});

describe('resolveFov on the calibrated path', () => {
  const calibration: FovCalibration = {
    frameHFovDeg: 62.5,
    frameWidthPx: 1200,
    frameHeightPx: 900,
    method: 'sun sweep, home session',
  };

  it('uses a calibration measured on this frame, and says it is measured', () => {
    const answer = resolved({
      decodedFrame: FRAME,
      visibleFraction: NO_CROP,
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
      calibration,
    });
    expect(answer.source).toBe('calibrated');
    expect(answer.frameFov.hFovDeg).toBe(62.5);
    // tan(v/2) = tan(31.25°)·(900/1200).
    expect(answer.frameFov.vFovDeg).toBeCloseTo(
      (2 * Math.atan(Math.tan(31.25 * DEG) * 0.75)) / DEG,
      10,
    );
    expect(answer.label).toContain('Calibrated');
    expect(answer.label).toContain('sun sweep');
    expect(answer.guessedFrom).toBeUndefined();
  });

  it('refuses a calibration measured on a different frame size', () => {
    // A measurement of a 1200×900 crop says nothing about a 1920×1080 one, so
    // reusing it would put a measured label on a number that is not one.
    const answer = resolved({
      decodedFrame: { widthPx: 1920, heightPx: 1080 },
      visibleFraction: NO_CROP,
      modelName: 'iPhone 17 Pro Max',
      lensLabel: '1x main',
      calibration,
    });
    expect(answer.source).toBe('spec-sheet-guess');
    expect(answer.label).toContain('Uncalibrated');
  });
});

describe('parseFovCalibrations', () => {
  it('reads a well-formed store', () => {
    const raw = JSON.stringify({
      'abc|1200x900': { frameHFovDeg: 62.5, frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
    });
    expect(parseFovCalibrations(raw)['abc|1200x900']?.frameHFovDeg).toBe(62.5);
  });

  it('drops every entry it cannot fully check, rather than repairing one', () => {
    const raw = JSON.stringify({
      'no-fov': { frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
      'fov-as-string': { frameHFovDeg: '62.5', frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
      'fov-out-of-range': { frameHFovDeg: 190, frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
      'fov-zero': { frameHFovDeg: 0, frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
      'no-method': { frameHFovDeg: 62.5, frameWidthPx: 1200, frameHeightPx: 900 },
      'bad-frame': { frameHFovDeg: 62.5, frameWidthPx: 0, frameHeightPx: 900, method: 'sun' },
      good: { frameHFovDeg: 62.5, frameWidthPx: 1200, frameHeightPx: 900, method: 'sun' },
    });
    expect(Object.keys(parseFovCalibrations(raw))).toEqual(['good']);
  });

  it('returns nothing for a store that is absent, empty or not JSON', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '"a string"', '42', 42]) {
      expect(parseFovCalibrations(raw)).toEqual({});
    }
  });
});

describe('the localStorage wrapper', () => {
  it('round-trips one calibration and leaves the others alone', () => {
    const storage = new MemoryStorage();
    const first: FovCalibration = {
      frameHFovDeg: 62.5,
      frameWidthPx: 1200,
      frameHeightPx: 900,
      method: 'sun',
    };
    const second: FovCalibration = {
      frameHFovDeg: 48,
      frameWidthPx: 1920,
      frameHeightPx: 1080,
      method: 'landmark sweep',
    };
    expect(writeStoredFovCalibration(storage, 'a|1200x900', first)).toBe(true);
    expect(writeStoredFovCalibration(storage, 'a|1920x1080', second)).toBe(true);

    expect(readStoredFovCalibration(storage, 'a|1200x900')).toEqual(first);
    expect(readStoredFovCalibration(storage, 'a|1920x1080')).toEqual(second);
    expect(readStoredFovCalibration(storage, 'a|640x480')).toBeUndefined();
    expect(storage.getItem(FOV_STORE_KEY)).toContain('landmark sweep');
  });

  it('treats a store that throws as an empty store, and does not rethrow', () => {
    // Safari in a private window, and any browser set to block site data.
    const storage = new ThrowingStorage();
    expect(readStoredFovCalibration(storage, 'a|1200x900')).toBeUndefined();
    expect(
      writeStoredFovCalibration(storage, 'a|1200x900', {
        frameHFovDeg: 62.5,
        frameWidthPx: 1200,
        frameHeightPx: 900,
        method: 'sun',
      }),
    ).toBe(false);
  });

  it('treats a browser with no storage at all as an empty store', () => {
    expect(readStoredFovCalibration(undefined, 'a|1200x900')).toBeUndefined();
    expect(
      writeStoredFovCalibration(undefined, 'a|1200x900', {
        frameHFovDeg: 62.5,
        frameWidthPx: 1200,
        frameHeightPx: 900,
        method: 'sun',
      }),
    ).toBe(false);
  });

  it('survives a stored value that is not JSON, and overwrites it', () => {
    const storage = new MemoryStorage();
    storage.setItem(FOV_STORE_KEY, 'half a write from a previous version');
    expect(readStoredFovCalibration(storage, 'a|1200x900')).toBeUndefined();
    const calibration: FovCalibration = {
      frameHFovDeg: 62.5,
      frameWidthPx: 1200,
      frameHeightPx: 900,
      method: 'sun',
    };
    expect(writeStoredFovCalibration(storage, 'a|1200x900', calibration)).toBe(true);
    expect(readStoredFovCalibration(storage, 'a|1200x900')).toEqual(calibration);
  });
});
