/**
 * Watching the camera track for a lens change it does not announce.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE OBSERVATION THIS IS BUILT ON
 * ═══════════════════════════════════════════════════════════════════════════
 * iOS 18 switches rear lenses inside a live `getUserMedia` stream without
 * firing any event (IMPLEMENTATION.md, "The route to the field test"). The
 * field of view changes by about 2×. Nothing in the MediaStream API reports it:
 * `track.onended` does not fire, no `devicechange` arrives, and the video keeps
 * playing.
 *
 * What DOES change is `track.getSettings()`. So the screen reads it once a
 * second and hands each reading here. A change of `deviceId`, `width` or
 * `height` is treated as a lens switch, and the switch is shown on screen —
 * because after one the overlay's scale is wrong and only the user can see the
 * picture jump.
 *
 * ── WHY THOSE THREE FIELDS AND NOT `frameRate` ─────────────────────────────
 * `deviceId` changing means the browser swapped devices outright.
 * `width`/`height` changing means the same device is delivering a different
 * frame, which is what a lens change looks like when the group keeps its id.
 * `frameRate` moves on its own under low light with no optical change at all,
 * so including it would cry wolf every dusk.
 *
 * Both a switch and a plain reading go into the log, so a session can be read
 * back afterwards and a field report can say when the picture changed. The log
 * is in memory only: writing it anywhere would make it a capture, and
 * AGENTS.md's capture rules govern those.
 *
 * Pure: a log and a reading in, a new log out. Timestamps are arguments.
 */

/** The fields of `MediaTrackSettings` this app reads. All optional there. */
export interface TrackSettingsLike {
  readonly deviceId?: string | undefined;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
  readonly frameRate?: number | undefined;
  readonly aspectRatio?: number | undefined;
  /** Geometry the field bundle records. Not watched for a lens switch. */
  readonly facingMode?: string | undefined;
  readonly resizeMode?: string | undefined;
  readonly zoom?: number | undefined;
}

/** One second's reading. `tMs` is relative to the start of the session. */
export interface LensLogEntry {
  readonly tMs: number;
  readonly settings: TrackSettingsLike;
  /** Which of the three watched fields differ from the previous entry. */
  readonly changed: readonly ('deviceId' | 'width' | 'height')[];
}

export interface LensLog {
  readonly entries: readonly LensLogEntry[];
  /** Entries whose `changed` list is non-empty, in order. */
  readonly switches: readonly LensLogEntry[];
}

export const EMPTY_LENS_LOG: LensLog = { entries: [], switches: [] };

/** The three fields a change of which counts as a lens switch. */
export const WATCHED_TRACK_FIELDS = ['deviceId', 'width', 'height'] as const;

/**
 * Append one reading.
 *
 * The FIRST reading never counts as a switch: there is nothing to have switched
 * from, and treating it as one would put a warning on screen every time the
 * stream opens.
 */
export function recordTrackSettings(
  log: LensLog,
  settings: TrackSettingsLike,
  tMs: number,
): LensLog {
  const previous = log.entries[log.entries.length - 1];
  const changed =
    previous === undefined
      ? []
      : WATCHED_TRACK_FIELDS.filter((field) => previous.settings[field] !== settings[field]);
  const entry: LensLogEntry = { tMs, settings, changed };
  return {
    entries: [...log.entries, entry],
    switches: changed.length > 0 ? [...log.switches, entry] : log.switches,
  };
}

/**
 * What the screen says after a lens switch, or nothing when there has been
 * none.
 *
 * Names the change in the terms the user can see — the picture got wider or
 * closer — and says the one thing they can do about it, which is drag the
 * overlay back into place. The pixel dimensions go in too: they are what a
 * field report needs to identify which lens took over.
 */
export function lensSwitchWarning(log: LensLog): string | undefined {
  const latest = log.switches[log.switches.length - 1];
  if (latest === undefined) return undefined;
  const previousIndex = log.entries.indexOf(latest) - 1;
  const previous = previousIndex >= 0 ? log.entries[previousIndex] : undefined;
  const size = (settings: TrackSettingsLike | undefined): string =>
    settings === undefined ? 'unknown' : `${settings.width ?? '?'}×${settings.height ?? '?'}`;
  const count = log.switches.length;
  return (
    `The camera changed lens on its own${count > 1 ? ` (${count} times)` : ''}: the picture ` +
    `went from ${size(previous?.settings)} to ${size(latest.settings)}. The labels are ` +
    'spaced for the old lens until you drag them back into line.'
  );
}
