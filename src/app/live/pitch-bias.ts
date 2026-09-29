/**
 * The measured tilt zero point, stored on the phone that it was measured on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THE LIVE BAND NEEDS THIS
 * ═══════════════════════════════════════════════════════════════════════════
 * `live-uncertainty.ts` reports the tilt SCATTER over the last second, and
 * scatter is not bias. A phone whose gravity zero sits two degrees low reports
 * the same tiny scatter while every label sits two degrees wrong, so a band
 * built from scatter alone claims the pitch is known to about 0.003° on a
 * still phone. The home session measures the bias against the Sun
 * (`src/live/recording.ts`, `estimatePitchBias`), and this module is where that
 * measurement waits for the next AR session on the same handset.
 *
 * ── WHY IT IS KEYED ON THE USER AGENT, NOT ON THE CAMERA TRACK ─────────────
 * `fov-choice.ts` keys its calibration to the camera track's settings, because
 * a field of view describes one crop of one stream. The tilt zero point
 * describes the accelerometer and the browser's reading of it, so a new camera
 * resolution says nothing about it and must not discard it. `localStorage` is
 * already scoped to one origin in one browser on one phone; the user agent is
 * the part left over, and it changes when the browser or the OS that produces
 * the orientation events changes.
 *
 * Pure apart from {@link readStoredPitchBias} and {@link writeStoredPitchBias},
 * the two functions that touch `localStorage` and can throw-and-be-caught.
 */

import type { PitchBiasSource } from '../../live/recording';
import type { WebStorageLike } from './fov-choice';

/** `localStorage` key holding every tilt measurement this origin has stored. */
export const PITCH_BIAS_STORE_KEY = 'mountain-finder.live.pitch-bias.v1';

/** One measured tilt zero point, and what it was measured against. */
export interface PitchBiasCalibration {
  /** Sensed camera altitude minus the truth, degrees. Positive reads too high. */
  readonly biasDeg: number;
  /** How far two re-aims landed apart, degrees at 1σ. */
  readonly spreadDeg: number;
  /** Aiming steps the estimate pooled. One step gets no re-aim spread. */
  readonly segmentCount: number;
  /** How it was measured, in the operator's own words. */
  readonly method: string;
  /**
   * Which measurement it came out of.
   *
   * The two sources need different numbers of readings before the band may gate
   * on them, so the source has to survive the round trip through storage.
   */
  readonly source: PitchBiasSource;
}

const PITCH_BIAS_SOURCES: readonly PitchBiasSource[] = ['fov-calibration-taps', 'sun-aiming-steps'];

/** The key a measurement is stored under. */
export function pitchBiasKey(userAgent: string): string {
  return userAgent === '' ? 'unknown' : userAgent;
}

/**
 * Parse the stored blob.
 *
 * Every field is checked, because the store holds a string some earlier version
 * of this app wrote. An entry that fails a check is dropped rather than
 * repaired: a half-understood measurement is indistinguishable from no
 * measurement, and no measurement is what the band reports as unquantified.
 *
 * A negative spread is refused and a bias beyond a quarter turn is refused. The
 * second bound is loose on purpose — the point is to catch a field holding a
 * heading or a pixel count, not to decide what tilt error is plausible. What
 * decides whether a stored measurement may close the band is
 * `qualifiesToGateVertical`, not this parser.
 *
 * An entry naming no known source is dropped, so a blob written before the
 * source was stored reads as no measurement. That is the conservative end: the
 * band reports the tilt term as unquantified and the next home session
 * remeasures.
 */
export function parsePitchBiasCalibrations(
  raw: unknown,
): Readonly<Record<string, PitchBiasCalibration>> {
  if (typeof raw !== 'string' || raw === '') return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const out: Record<string, PitchBiasCalibration> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    const { biasDeg, spreadDeg, segmentCount, method, source } = entry;
    if (
      typeof biasDeg !== 'number' ||
      !Number.isFinite(biasDeg) ||
      Math.abs(biasDeg) > 90 ||
      typeof spreadDeg !== 'number' ||
      !Number.isFinite(spreadDeg) ||
      spreadDeg < 0 ||
      spreadDeg > 90 ||
      typeof segmentCount !== 'number' ||
      !Number.isInteger(segmentCount) ||
      segmentCount < 1 ||
      typeof method !== 'string' ||
      typeof source !== 'string' ||
      !PITCH_BIAS_SOURCES.includes(source as PitchBiasSource)
    ) {
      continue;
    }
    out[key] = { biasDeg, spreadDeg, segmentCount, method, source: source as PitchBiasSource };
  }
  return out;
}

/**
 * Read the measurement for one user agent.
 *
 * Every access is wrapped: `localStorage` throws outright in a Safari private
 * window and when a browser is set to block site data, and a thrown getter must
 * not take the AR screen down with it. An unreadable store is the same state as
 * an empty one — no measurement, so the band reports the term as unquantified.
 */
export function readStoredPitchBias(
  storage: WebStorageLike | undefined,
  key: string,
): PitchBiasCalibration | undefined {
  if (storage === undefined) return undefined;
  try {
    return parsePitchBiasCalibrations(storage.getItem(PITCH_BIAS_STORE_KEY))[key];
  } catch {
    return undefined;
  }
}

/** Store one measurement, leaving the others alone. Failures are swallowed. */
export function writeStoredPitchBias(
  storage: WebStorageLike | undefined,
  key: string,
  calibration: PitchBiasCalibration,
): boolean {
  if (storage === undefined) return false;
  try {
    const all = parsePitchBiasCalibrations(storage.getItem(PITCH_BIAS_STORE_KEY));
    storage.setItem(PITCH_BIAS_STORE_KEY, JSON.stringify({ ...all, [key]: calibration }));
    return true;
  } catch {
    return false;
  }
}
