/**
 * The home session, as a script a person can follow — and the one number it
 * keeps from the position fix.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE SESSION IS FOR
 * ═══════════════════════════════════════════════════════════════════════════
 * `src/live/recording.ts` answers fourteen questions about what a phone's
 * browser actually reports, and it cannot answer any of them without a recording
 * made by a person holding a phone. This module is the script that person
 * follows: one pose at a time, one short instruction each, in the order
 * `POSE_LABELS` lists them.
 *
 * The instructions are written for someone who has never heard of an Euler
 * angle. They say what to do with a phone and nothing else. What each pose
 * PROVES is in `recording.ts` and is deliberately not on screen: a person
 * holding a phone at arm's length cannot act on it, and the screen room goes to
 * the instruction instead.
 *
 * ── THE KNOWN BEARING, AND WHAT IS THROWN AWAY ─────────────────────────────
 * Most of the questions need one bearing the recording can be scored against,
 * and the Sun is the only reference a person has at home. So the device computes
 * the Sun's MAGNETIC azimuth on the spot — `src/core/celestial.ts` for the true
 * azimuth, `src/core/declination.ts` for WMM2025's declination — and keeps the
 * answer. The position and the instant that produced it are discarded and never
 * reach the file.
 *
 * That is the schema's own design, and the reason is in AGENTS.md § "Captures
 * from the phone": a coordinate places the session and a wall clock dates it.
 * The stored declination narrows the observer to an isogonic band, which
 * `recording.ts` states as the one residual leak, and it buys the parser's
 * check that the declination was applied with the right sign.
 *
 * Magnetic rather than true because that is what `webkitCompassHeading` reports:
 * CLHeading is magnetic by name, and the orientation specification's earth frame
 * puts its y axis on magnetic north.
 *
 * Pure. No DOM, no storage, no clock of its own — the instant is an argument.
 */

import { magneticDeclinationDeg } from '../../core/declination';
import { sunPosition } from '../../core/celestial';
import { fold360, POSE_LABELS, type KnownBearing, type PoseLabel } from '../../live/recording';

/** Query flag that turns `live.html` into the guided session. */
export const HOME_SESSION_QUERY = 'session';
export const HOME_SESSION_VALUE = 'home';

/**
 * Is this page being opened for the home session?
 *
 * A query flag rather than a second HTML entry, because the session needs the
 * same camera, the same sensors and the same overlay this screen already has,
 * and a person is given one address to open.
 */
export function isHomeSessionRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get(HOME_SESSION_QUERY) === HOME_SESSION_VALUE;
  } catch {
    return false;
  }
}

/** What the person is doing during a step, which decides what the screen shows. */
export type StepKind = 'hold' | 'move' | 'aim' | 'tap';

export interface HomeSessionStep {
  readonly pose: PoseLabel;
  /** Two or three words for the progress line. */
  readonly title: string;
  /** One plain sentence of what to do. No jargon, no explanation. */
  readonly instruction: string;
  readonly kind: StepKind;
  /** How long the step runs before it says "done", milliseconds. */
  readonly holdMs: number;
}

/**
 * Every pose, in the protocol's order, with one instruction each.
 *
 * The durations are the shortest that give the analyzer enough samples. Its
 * floor is eight usable samples per segment (`MIN_SCORED_SAMPLES`), and a
 * browser delivers orientation events at 30 to 60 Hz, so three seconds is an
 * order of magnitude of margin for a hold. The two long steps are different:
 * the drift question needs minutes of stillness to put a rate on alpha drift,
 * and the handling step needs long enough for a person to actually move around.
 */
export const HOME_SESSION_STEPS: readonly HomeSessionStep[] = [
  {
    pose: 'flat-face-up',
    title: 'Flat, screen up',
    instruction: 'Put the phone flat on a table with the screen facing the ceiling.',
    kind: 'hold',
    holdMs: 4000,
  },
  {
    pose: 'upright-portrait',
    title: 'Upright',
    instruction: 'Pick the phone up and hold it upright, tall way up, screen facing you.',
    kind: 'hold',
    holdMs: 4000,
  },
  {
    pose: 'flat-face-down',
    title: 'Flat, screen down',
    instruction: 'Put the phone face down on the table, so the camera points at the ceiling.',
    kind: 'hold',
    holdMs: 4000,
  },
  {
    pose: 'right-edge-down',
    title: 'Right edge down',
    instruction:
      'Hold the phone upright again, then turn it a quarter turn so its right-hand edge points at the floor.',
    kind: 'hold',
    holdMs: 4000,
  },
  {
    pose: 'portrait-upright-known-bearing',
    title: 'Point at the sun, upright',
    instruction:
      'Hold the phone upright, tall way up, and point the back camera straight at the sun. Keep the sun in the middle.',
    kind: 'aim',
    holdMs: 6000,
  },
  {
    pose: 'landscape-upright-known-bearing-top-left',
    title: 'Sideways, top to the left',
    instruction:
      'Turn the phone sideways so the end with the camera is on your LEFT, and keep the sun in the middle.',
    kind: 'aim',
    holdMs: 6000,
  },
  {
    pose: 'landscape-upright-known-bearing-top-right',
    title: 'Sideways, top to the right',
    instruction:
      'Turn the phone the other way round, so the end with the camera is on your RIGHT, sun still in the middle.',
    kind: 'aim',
    holdMs: 6000,
  },
  {
    pose: 'tip-past-vertical',
    title: 'Tip it over the top',
    instruction:
      'Slowly tip the phone backwards, past straight up, until the screen faces the sky. Take about five seconds.',
    kind: 'move',
    holdMs: 9000,
  },
  {
    pose: 'roll-about-camera-axis',
    title: 'Spin it slowly',
    instruction:
      'Keep the camera pointing the same way and slowly spin the phone a full turn, like a steering wheel.',
    kind: 'move',
    holdMs: 9000,
  },
  {
    pose: 'rotate-to-landscape',
    title: 'Upright, then sideways',
    instruction: 'Hold the phone upright, then slowly turn it sideways, then back again.',
    kind: 'move',
    holdMs: 8000,
  },
  {
    pose: 'still-drift',
    title: 'Leave it alone',
    instruction:
      'Put the phone down, sideways against something, and do not touch it until this step finishes.',
    kind: 'hold',
    holdMs: 180_000,
  },
  {
    pose: 'handling',
    title: 'Walk about with it',
    instruction:
      'Pick the phone up and carry it around normally for a minute. Turn, walk, put it in a pocket, take it out.',
    kind: 'move',
    holdMs: 60_000,
  },
  {
    pose: 'sun-capture',
    title: 'Tap the real sun',
    instruction:
      'Hold the phone sideways and point it at the sun near the LEFT of the screen; tap the middle of the real sun. Then turn until it is near the RIGHT and tap it again.',
    kind: 'tap',
    holdMs: 60_000,
  },
];

/** Every pose the recording schema knows appears in the script, in order. */
export function scriptCoversEveryPose(): boolean {
  return (
    HOME_SESSION_STEPS.length === POSE_LABELS.length &&
    HOME_SESSION_STEPS.every((step, index) => step.pose === POSE_LABELS[index])
  );
}

/** Total length of the script, milliseconds. */
export function scriptDurationMs(): number {
  return HOME_SESSION_STEPS.reduce((sum, step) => sum + step.holdMs, 0);
}

/**
 * What the screen says before anything is recorded.
 *
 * It is shown before the first step rather than after the session, because
 * consent to a capture is only consent if it is given before the capture. Each
 * line is one fact, in the order a person needs them: what is in the file, what
 * is not, and where it goes.
 */
export const HOME_SESSION_PRIVACY_STATEMENT: readonly string[] = [
  'This records what the phone’s own motion and compass sensors report while you hold it in each position, and what size picture the camera is sending.',
  'It does not record where you are, what time it is, or any pictures. No photograph and no video is saved.',
  'One number is worked out from your location and the clock: the compass direction of the sun from where you stand. Your position and the time are used for that and then thrown away.',
  'The file stays on this phone until you send it. Nothing is uploaded. At the end you get a Share button, and the file goes only where you send it.',
  'At the end there is some lining-up practice: you drag a label onto the thing it names, six times. How far you dragged stays on the screen and is not put in the file.',
];

/** The file the Share button offers. No date in the name — a date is a wall clock. */
export const RECORDING_FILE_NAME = 'mountain-finder-home-session.json';

/** Where the observer stands, for the two models that need it. */
export interface BearingSite {
  readonly lat: number;
  readonly lon: number;
  /** Metres above sea level. Worth 0.007° of declination over 3 km. */
  readonly heightM: number;
}

/**
 * The Sun's magnetic azimuth at one instant, with the position and the instant
 * left behind.
 *
 * `refraction: true` because the Sun a camera sees is the refracted one, and
 * near the horizon that is about half a degree. Azimuth is unaffected by
 * refraction, which only lifts the altitude, so the stored bearing is the same
 * either way; the altitude is stored too, and it is the refracted one because
 * that is what the person was aiming at.
 */
export function sunKnownBearing(when: Date, site: BearingSite): KnownBearing {
  const position = sunPosition(when, { lat: site.lat, lon: site.lon, heightM: site.heightM }, { refraction: true });
  const declinationDeg = magneticDeclinationDeg(
    { latitudeDeg: site.lat, longitudeDeg: site.lon, heightM: site.heightM },
    when,
  );
  return {
    kind: 'sun-azimuth',
    magneticAzimuthDeg: fold360(position.azimuthDeg - declinationDeg),
    altitudeDeg: position.altitudeDeg,
    ephemeris: 'src/core/celestial.ts sunPosition, refraction on',
    trueAzimuthDeg: fold360(position.azimuthDeg),
    declinationDeg,
  };
}

/** Is the Sun high enough to be aimed at, and low enough to centre in a wide lens? */
export function sunIsUsable(bearing: KnownBearing): { readonly usable: boolean; readonly why: string } {
  if (bearing.kind !== 'sun-azimuth') return { usable: true, why: '' };
  if (bearing.altitudeDeg < 5) {
    return {
      usable: false,
      why:
        `The sun is only ${bearing.altitudeDeg.toFixed(0)}° above the horizon, or already below it. ` +
        'Run the session when it is higher, or somewhere you can see it.',
    };
  }
  if (bearing.altitudeDeg > 60) {
    return {
      usable: false,
      why:
        `The sun is ${bearing.altitudeDeg.toFixed(0)}° up, which is too near overhead to line up in a ` +
        'wide camera. Run the session in the morning or the late afternoon.',
    };
  }
  return { usable: true, why: '' };
}
