/**
 * Opening the rear camera, and keeping watch on the lens it gave us.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE TWO-STEP OPEN
 * ═══════════════════════════════════════════════════════════════════════════
 * `enumerateDevices` returns empty labels until a camera permission exists, so
 * the first open cannot choose a lens — it can only ask for a rear-facing one
 * and hope. Once that stream exists the labels are populated, and
 * `chooseRearCamera` can name a single lens. If that lens is not the one now
 * running, the first stream is stopped and a second is opened by `deviceId`.
 *
 * Reopening costs a visible flicker, so it happens only when it changes the
 * answer: when the chosen `deviceId` differs from the one already running.
 *
 * ── WHY `exact` ON THE SECOND OPEN ─────────────────────────────────────────
 * A plain `deviceId` constraint is advisory: the browser may ignore it and hand
 * back a virtual device that switches lenses. `deviceId: { exact }` fails
 * instead, which is the answer this app wants — a failure is visible, a
 * substitution is not.
 *
 * Everything in this file touches the browser. The decision it is built around
 * is in `camera-devices.ts`, pure and tested.
 */

import { cameraChoiceWarning, chooseRearCamera, type CameraChoice } from './camera-devices';
import type { TrackSettingsLike } from './lens-log';

/** How often `getSettings()` is read, milliseconds. */
export const TRACK_POLL_INTERVAL_MS = 1000;

/**
 * Resolution asked for.
 *
 * `ideal` rather than `exact`: an `exact` resolution a phone cannot deliver
 * fails the whole open, and any landscape frame is usable — the field of view
 * is derived from what actually arrived (`video-box.ts`), never from what was
 * requested.
 */
export const REQUESTED_FRAME = { width: 1920, height: 1080 } as const;

export interface OpenedCamera {
  readonly stream: MediaStream;
  readonly track: MediaStreamTrack;
  readonly choice: CameraChoice;
  /** What the screen must say about the lens, or nothing when it is confirmed. */
  readonly warning: string | undefined;
  /** True when the app reopened the stream to pin a single lens. */
  readonly reopened: boolean;
}

export type CameraOpenFailure = 'denied' | 'unavailable';

export class CameraOpenError extends Error {
  readonly failure: CameraOpenFailure;

  constructor(failure: CameraOpenFailure, message: string) {
    super(message);
    this.name = 'CameraOpenError';
    this.failure = failure;
  }
}

function classify(error: unknown): CameraOpenFailure {
  const name = error instanceof Error ? error.name : '';
  return name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable';
}

function stop(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

/**
 * Open the rear camera, pinning a single lens where the browser names one.
 *
 * Must be called from a user gesture on iOS. Throws {@link CameraOpenError}
 * with `'denied'` separated from `'unavailable'`, because the two have
 * completely different remedies: one is a settings change, the other is closing
 * another app.
 */
export async function openRearCamera(media: MediaDevices): Promise<OpenedCamera> {
  let stream: MediaStream;
  try {
    stream = await media.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: REQUESTED_FRAME.width },
        height: { ideal: REQUESTED_FRAME.height },
      },
      audio: false,
    });
  } catch (error) {
    throw new CameraOpenError(
      classify(error),
      error instanceof Error ? error.message : 'getUserMedia failed',
    );
  }

  const devices = await media.enumerateDevices().catch(() => []);
  const choice = chooseRearCamera(devices);
  const running = stream.getVideoTracks()[0];
  if (running === undefined) {
    stop(stream);
    throw new CameraOpenError('unavailable', 'the stream carried no video track');
  }

  const alreadyRight =
    choice.kind === 'no-camera' || running.getSettings().deviceId === choice.deviceId;
  if (choice.kind !== 'single-lens' || alreadyRight) {
    return { stream, track: running, choice, warning: cameraChoiceWarning(choice), reopened: false };
  }

  // A single named lens that is not the one running: reopen on it exactly.
  try {
    const pinned = await media.getUserMedia({
      video: {
        deviceId: { exact: choice.deviceId },
        width: { ideal: REQUESTED_FRAME.width },
        height: { ideal: REQUESTED_FRAME.height },
      },
      audio: false,
    });
    const track = pinned.getVideoTracks()[0];
    if (track === undefined) {
      stop(pinned);
      return { stream, track: running, choice, warning: cameraChoiceWarning(choice), reopened: false };
    }
    stop(stream);
    return { stream: pinned, track, choice, warning: cameraChoiceWarning(choice), reopened: true };
  } catch {
    // The named lens refused. The first stream is still running and still
    // rear-facing, so it is kept — with the warning that says the lens could
    // not be pinned, which is now the true state.
    return {
      stream,
      track: running,
      choice,
      warning:
        `This phone lists "${choice.label}" but would not open it on its own, so the app ` +
        'is using whichever rear camera it was given. If the picture suddenly gets wider ' +
        'or closer, drag the labels back into line.',
      reopened: false,
    };
  }
}

/**
 * Read the geometry, with nothing else copied.
 *
 * Every field is named rather than the object being spread, so a platform that
 * adds an identifier to `getSettings()` does not add it to a recording or a
 * field bundle by itself. `label` and `groupId` identify one handset and are
 * refused by both parsers; `deviceId` is kept here because the lens log watches
 * it for a switch, and the recorder drops it before anything is written.
 */
export function readTrackSettings(track: MediaStreamTrack): TrackSettingsLike {
  const settings = track.getSettings();
  return {
    deviceId: settings.deviceId,
    width: settings.width,
    height: settings.height,
    frameRate: settings.frameRate,
    aspectRatio: settings.aspectRatio,
    facingMode: settings.facingMode,
    // `resizeMode` and `zoom` are optional in the platform API and absent from
    // the DOM typings on this toolchain, so they are read by name off the
    // settings object rather than through it.
    ...('resizeMode' in settings
      ? { resizeMode: (settings as { resizeMode?: string }).resizeMode }
      : {}),
    ...('zoom' in settings ? { zoom: (settings as { zoom?: number }).zoom } : {}),
  };
}
