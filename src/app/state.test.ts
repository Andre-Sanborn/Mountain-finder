/**
 * Session state: what the panel will show, and what the overlay will consume.
 *
 * The EXIF bags below are written by hand from the authored values documented
 * in `fixtures/photos/README.md`, and every expectation is derived from those
 * values analytically. The real extractor is exercised end to end against the
 * real fixture JPEGs in `tests/e2e/app.spec.ts`; this file is about the merge
 * and provenance rules the UI depends on.
 */

import { describe, expect, it } from 'vitest';

import type { PhotoExif } from '../exif';
import {
  deriveSession,
  exportDisabledReason,
  INITIAL_STATE,
  isInvalidDraft,
  overridesFromState,
  parseDraft,
  obscuredPeaksNote,
  reducer,
  type AppState,
  type LoadedPhoto,
} from './state';

const RAD_PER_DEG = Math.PI / 180;

/** chamonix-north-east.jpg: complete, TRUE-north direction, 26 mm equivalent. */
const CHAMONIX_EXIF: PhotoExif = {
  lat: 45.9237,
  lon: 6.8694,
  gpsAltitudeM: 1035.5,
  imgDirectionDeg: 137.25,
  imgDirectionRef: 'T',
  focalLengthMm: 4.2,
  focalLength35mmMm: 26,
  imageWidthPx: 800,
  imageHeightPx: 600,
  // hFov = 2·atan(36 / (2·26)) = 2·atan(9/13) = 69.390307062467940°
  hFovDeg: 69.39030706246794,
};

/** aconcagua-south-west.jpg: MAGNETIC direction, no altitude, no 35 mm equivalent. */
const ACONCAGUA_EXIF: PhotoExif = {
  lat: -32.6535,
  lon: -70.011,
  imgDirectionDeg: 250.5,
  imgDirectionRef: 'M',
  focalLengthMm: 24,
  imageWidthPx: 900,
  imageHeightPx: 600,
};

function photoWith(exif: PhotoExif, widthPx = 800, heightPx = 600): LoadedPhoto {
  return { fileName: 'test.jpg', url: 'blob:test', widthPx, heightPx, exif };
}

function stateWith(photo: LoadedPhoto, patch: Partial<AppState> = {}): AppState {
  return { ...INITIAL_STATE, status: 'ready', photo, ...patch };
}

describe('parseDraft / isInvalidDraft', () => {
  it('treats a blank box as "no override", not as zero', () => {
    expect(parseDraft('')).toBeUndefined();
    expect(parseDraft('   ')).toBeUndefined();
    expect(parseDraft(undefined)).toBeUndefined();
    expect(parseDraft('0')).toBe(0);
  });

  it('reads a negative and a decimal', () => {
    expect(parseDraft('-424.5')).toBe(-424.5);
    expect(parseDraft(' 45.9237 ')).toBe(45.9237);
  });

  it('flags text that is not a number instead of silently ignoring it', () => {
    expect(parseDraft('north-ish')).toBeUndefined();
    expect(isInvalidDraft('north-ish')).toBe(true);
    expect(isInvalidDraft('')).toBe(false);
    expect(isInvalidDraft('12')).toBe(false);
  });
});

describe('deriveSession — nothing loaded', () => {
  it('derives nothing at all before a photo exists', () => {
    expect(deriveSession(INITIAL_STATE)).toBeUndefined();
  });
});

describe('deriveSession — provenance', () => {
  it('marks EXIF-derived fields as coming from EXIF', () => {
    const session = deriveSession(stateWith(photoWith(CHAMONIX_EXIF)));
    const fields = session?.resolution.fields;
    expect(fields?.lat).toEqual({ status: 'resolved', value: 45.9237, source: 'exif' });
    expect(fields?.lon).toEqual({ status: 'resolved', value: 6.8694, source: 'exif' });
    expect(fields?.headingDeg).toEqual({ status: 'resolved', value: 137.25, source: 'exif' });
  });

  it('derives vFov through the tangent relation from the EXIF hFov and decoded aspect', () => {
    const session = deriveSession(stateWith(photoWith(CHAMONIX_EXIF)));
    const vFov = session?.resolution.fields.vFovDeg;
    expect(vFov?.status).toBe('resolved');
    if (vFov?.status !== 'resolved') throw new Error('vFov should resolve');
    // tan(hFov/2) = 18/26 = 9/13; aspect 600/800 = 3/4;
    // therefore tan(vFov/2) = (9/13)·(3/4) = 27/52.
    expect(Math.tan((vFov.value * RAD_PER_DEG) / 2)).toBeCloseTo(27 / 52, 12);
    expect(vFov.source).toBe('exif');
  });

  it('will not turn GPS altitude into a ground elevation without an eye height', () => {
    const session = deriveSession(stateWith(photoWith(CHAMONIX_EXIF)));
    expect(session?.resolution.fields.groundElevationM).toEqual({
      status: 'needs-manual',
      reason: 'eye-height-required',
    });
    expect(session?.resolution.fields.eyeHeightM).toEqual({
      status: 'needs-manual',
      reason: 'absent-from-exif',
    });
  });

  it('subtracts an opted-in eye height from GPS altitude, badging each honestly', () => {
    const session = deriveSession(
      stateWith(photoWith(CHAMONIX_EXIF), { useStandardAssumptions: true }),
    );
    // 1035.5 m camera altitude − 1.6 m eye height = 1033.9 m of terrain.
    expect(session?.resolution.fields.groundElevationM).toEqual({
      status: 'resolved',
      value: 1033.9,
      source: 'exif',
    });
    expect(session?.resolution.fields.eyeHeightM).toEqual({
      status: 'resolved',
      value: 1.6,
      source: 'default',
    });
    expect(session?.resolution.fields.pitchDeg).toEqual({
      status: 'resolved',
      value: 0,
      source: 'default',
    });
    expect(session?.missing).toEqual([]);
  });

  it('lets a typed value outrank EXIF and says so', () => {
    const session = deriveSession(
      stateWith(photoWith(CHAMONIX_EXIF), { drafts: { headingDeg: '212.5' } }),
    );
    expect(session?.resolution.fields.headingDeg).toEqual({
      status: 'resolved',
      value: 212.5,
      source: 'user',
    });
  });
});

describe('deriveSession — a magnetic bearing is never passed off as true north', () => {
  it('flags the heading while no declination is supplied', () => {
    const session = deriveSession(stateWith(photoWith(ACONCAGUA_EXIF, 900, 600)));
    expect(session?.resolution.fields.headingDeg).toEqual({
      status: 'needs-manual',
      reason: 'magnetic-declination-required',
    });
  });

  it('resolves it once a declination is typed in', () => {
    const session = deriveSession(
      stateWith(photoWith(ACONCAGUA_EXIF, 900, 600), { declinationDraft: '12.25' }),
    );
    // true = magnetic + declination = 250.5 + 12.25 = 262.75
    expect(session?.resolution.fields.headingDeg).toEqual({
      status: 'resolved',
      value: 262.75,
      source: 'exif',
    });
  });

  it('still refuses a field of view with no 35 mm equivalent', () => {
    const session = deriveSession(stateWith(photoWith(ACONCAGUA_EXIF, 900, 600)));
    expect(session?.resolution.fields.hFovDeg).toEqual({
      status: 'needs-manual',
      reason: 'no-35mm-equivalent-focal-length',
    });
  });
});

describe('deriveSession — a photo with no EXIF at all', () => {
  const session = deriveSession(stateWith(photoWith({})));

  it('flags every one of the nine pose fields', () => {
    expect(session?.missing).toHaveLength(9);
    expect(session?.resolution.complete).toBe(false);
  });

  it('reports no value for any of them — not a zero anywhere', () => {
    for (const field of session?.missing ?? []) {
      const state = session?.resolution.fields[field];
      expect(state?.status).toBe('needs-manual');
      expect(state).not.toHaveProperty('value');
    }
  });

  it('still knows the decoded pixel size, because that is measured, not claimed', () => {
    expect(session?.dimensions).toEqual({
      widthPx: 800,
      heightPx: 600,
      source: 'decoded',
      exifDisagrees: false,
    });
  });

  it('produces no overlay request, so nothing downstream can run on a guess', () => {
    expect(session?.overlayRequest).toBeUndefined();
    expect(session?.effectivePose).toBeUndefined();
  });
});

describe('image dimensions', () => {
  it('measures the decoded image rather than trusting the EXIF tags', () => {
    const exif: PhotoExif = { ...CHAMONIX_EXIF, imageWidthPx: 1600, imageHeightPx: 1200 };
    const session = deriveSession(stateWith(photoWith(exif, 800, 600)));
    expect(session?.overrides.imageWidthPx).toBe(800);
    expect(session?.overrides.imageHeightPx).toBe(600);
    expect(session?.dimensions.exifDisagrees).toBe(true);
  });

  it('reports agreement when the two match', () => {
    const session = deriveSession(stateWith(photoWith(CHAMONIX_EXIF)));
    expect(session?.dimensions.exifDisagrees).toBe(false);
  });
});

describe('the overlay request', () => {
  const state = stateWith(photoWith(CHAMONIX_EXIF), {
    useStandardAssumptions: true,
    trim: { headingDeg: 2.5, pitchDeg: -1.25, hFovDeg: 0 },
  });
  const session = deriveSession(state);

  it('carries the frame, the observer and the trimmed pose', () => {
    expect(session?.overlayRequest?.frame).toEqual({ widthPx: 800, heightPx: 600 });
    expect(session?.overlayRequest?.observer).toEqual({
      lat: 45.9237,
      lon: 6.8694,
      groundElevationM: 1033.9,
      eyeHeightM: 1.6,
    });
  });

  it('applies the trim to the pose the overlay consumes, leaving the panel untouched', () => {
    // 137.25 + 2.5 = 139.75; pitch 0 (assumed) − 1.25 = −1.25.
    expect(session?.effectivePose?.headingDeg).toBeCloseTo(139.75, 12);
    expect(session?.effectivePose?.pitchDeg).toBeCloseTo(-1.25, 12);
    expect(session?.basePose?.headingDeg).toBe(137.25);
    expect(session?.resolution.fields.headingDeg).toEqual({
      status: 'resolved',
      value: 137.25,
      source: 'exif',
    });
  });
});

describe('reducer', () => {
  it('drops the previous photo’s overrides and trim when a new photo arrives', () => {
    const dirty = stateWith(photoWith(CHAMONIX_EXIF), {
      drafts: { headingDeg: '99' },
      declinationDraft: '5',
      trim: { headingDeg: 3, pitchDeg: 0, hFovDeg: 0 },
      useStandardAssumptions: true,
    });
    const next = reducer(dirty, { type: 'photo-loaded', photo: photoWith({}) });
    expect(next.drafts).toEqual({});
    expect(next.declinationDraft).toBe('');
    expect(next.trim).toEqual({ headingDeg: 0, pitchDeg: 0, hFovDeg: 0 });
    // The assumptions opt-in is a user preference about themselves, not about
    // the photo, so it deliberately survives.
    expect(next.useStandardAssumptions).toBe(true);
  });

  it('distinguishes an emptied box from a reverted one', () => {
    const typed = reducer(stateWith(photoWith(CHAMONIX_EXIF)), {
      type: 'draft-changed',
      field: 'headingDeg',
      text: '',
    });
    // Emptied: still the user's box, so nothing falls back yet.
    expect(typed.drafts).toEqual({ headingDeg: '' });
    expect(deriveSession(typed)?.resolution.fields.headingDeg).toEqual({
      status: 'resolved',
      value: 137.25,
      source: 'exif',
    });

    const reverted = reducer(typed, { type: 'draft-reverted', field: 'headingDeg' });
    expect(reverted.drafts).toEqual({});
  });

  it('records a read failure without discarding the message', () => {
    const failed = reducer(INITIAL_STATE, { type: 'photo-failed', message: 'not a JPEG' });
    expect(failed.status).toBe('error');
    expect(failed.errorMessage).toBe('not a JPEG');
  });

  it('resets the trim on demand', () => {
    const trimmed = reducer(INITIAL_STATE, {
      type: 'trim-changed',
      axis: 'hFovDeg',
      valueDeg: -4.5,
    });
    expect(trimmed.trim.hFovDeg).toBe(-4.5);
    expect(reducer(trimmed, { type: 'trim-reset' }).trim).toEqual({
      headingDeg: 0,
      pitchDeg: 0,
      hFovDeg: 0,
    });
  });
});

describe('overridesFromState', () => {
  it('sends only the boxes that hold a usable number', () => {
    const state = stateWith(photoWith(CHAMONIX_EXIF), {
      drafts: { lat: '46.5', lon: '', pitchDeg: 'nonsense' },
    });
    expect(overridesFromState(state, photoWith(CHAMONIX_EXIF))).toEqual({
      imageWidthPx: 800,
      imageHeightPx: 600,
      lat: 46.5,
    });
  });
});

describe('exportDisabledReason — the button tells the truth', () => {
  const ready = { hasPhoto: true, missingFieldCount: 0, hasOverlay: true, hasExporter: true };

  it('is enabled only when there is genuinely something to export', () => {
    expect(exportDisabledReason(ready)).toBeUndefined();
  });

  it('names the missing photo', () => {
    expect(exportDisabledReason({ ...ready, hasPhoto: false })).toMatch(/photo/i);
  });

  it('counts the fields still needing input, with the right plural', () => {
    expect(exportDisabledReason({ ...ready, missingFieldCount: 9 })).toBe(
      '9 pose fields still need manual input.',
    );
    expect(exportDisabledReason({ ...ready, missingFieldCount: 1 })).toBe(
      '1 pose field still needs manual input.',
    );
  });

  it('states the missing piece without blaming an unfinished build', () => {
    // Both implementations are wired in as of archive/v2-docs-20260929/TODO.md Q1, so these two reasons
    // are now about THIS photo — there is no overlay for it yet — rather than
    // about the app being half-built. The old copy pointed at a TODO item that
    // no longer exists, which would read as an excuse for a real failure.
    expect(exportDisabledReason({ ...ready, hasExporter: false })).toBe(
      'This build has no PNG compositor.',
    );
    expect(exportDisabledReason({ ...ready, hasOverlay: false })).toBe(
      'There is no overlay to export: the skyline for this photo has not been computed.',
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D8 — the "show obscured peaks" control
 * ══════════════════════════════════════════════════════════════════════════ */

describe('obscured-peak visibility setting', () => {
  it('defaults to SHOWN, which is the user decision D8 records', () => {
    expect(INITIAL_STATE.showObscuredPeaks).toBe(true);
  });

  it('toggles, and survives loading another photo', () => {
    const off = reducer(INITIAL_STATE, { type: 'obscured-peaks-toggled', enabled: false });
    expect(off.showObscuredPeaks).toBe(false);

    // Same reasoning as `useStandardAssumptions`: this is a preference about how
    // the viewer wants to be shown results, not a claim about the photograph, so
    // a new photo must not silently switch it back on.
    const withPhoto = reducer(off, { type: 'photo-loaded', photo: photoWith({}) });
    expect(withPhoto.showObscuredPeaks).toBe(false);
    expect(reducer(withPhoto, { type: 'photo-cleared' }).showObscuredPeaks).toBe(false);
  });

  it('travels to the pipeline in the overlay request', () => {
    const ready = stateWith(photoWith(CHAMONIX_EXIF), { useStandardAssumptions: true });
    expect(deriveSession(ready)?.overlayRequest?.showObscuredPeaks).toBe(true);
    expect(
      deriveSession({ ...ready, showObscuredPeaks: false })?.overlayRequest?.showObscuredPeaks,
    ).toBe(false);
  });

  it('explains what each position of the switch means, in provenance-first terms', () => {
    expect(obscuredPeaksNote(true)).toContain('behind its own hill');
    expect(obscuredPeaksNote(false)).toContain('hidden');
    // Neither position may promise something the pipeline does not do: a peak
    // behind a DIFFERENT hill is never drawn, whichever way the switch is set.
    expect(obscuredPeaksNote(true)).toContain('never');
    expect(obscuredPeaksNote(false)).toContain('never');
  });
});
