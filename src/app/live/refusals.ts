/**
 * Every reason the AR screen declines to draw, in words a non-technical user
 * can act on.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THESE ARE DATA AND NOT STRINGS IN A COMPONENT
 * ═══════════════════════════════════════════════════════════════════════════
 * This app refuses often and on purpose. `sensors.ts` refuses a stale trace,
 * `web-sensors.ts` refuses an uncalibrated compass and a near-vertical
 * reference axis, `loop.ts` refuses a pose over un-swept terrain, and the
 * overlay builder refuses a position it holds no terrain for. Every one of
 * those refusals is correct and every one of them reaches a person standing on
 * a ridge holding a phone.
 *
 * A refusal that person cannot act on is worse than useless: it reads as the
 * app being broken, and the next thing they do is close it. So each state here
 * carries three separate sentences — what happened, why, and what to do — and
 * the "what to do" is a physical action wherever one exists. "Wave the phone in
 * a figure 8" is the remedy for an uncalibrated compass; "hold the phone
 * sideways" is the remedy for portrait.
 *
 * Keeping them out of the component is what lets a test assert that every state
 * has a remedy, and that the remedy names an action rather than a diagnosis.
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────────
 * No jargon reaches `headline` or `whatToDo`. The technical name of the state
 * lives in `detail`, which is where a developer reading a bug report looks, and
 * is printed in small type. A test enforces the split.
 *
 * Pure: a state in, three sentences out.
 */

import type { WebSampleRefusal } from '../../live/web-sensors';
import type { SensorRefusal } from '../../live/sensors';

/**
 * Everything the screen can refuse on.
 *
 * Grouped by what the user has to do about it rather than by which module
 * raised it, because a person holding the phone cannot act on a module name.
 */
export type LiveRefusalCode =
  /** The phone is upright in portrait. */
  | 'portrait'
  /** The page is not on a secure origin, so no device API will ever be granted. */
  | 'insecure-context'
  /** Nothing has been started yet — the permission gesture has not happened. */
  | 'not-started'
  | 'camera-denied'
  | 'camera-unavailable'
  /** The stream is open but no frame has been decoded yet. */
  | 'waiting-for-camera'
  | 'motion-denied'
  | 'motion-unavailable'
  | 'location-denied'
  | 'location-unavailable'
  /** `webkitCompassAccuracy` is negative: CoreLocation has no usable heading. */
  | 'compass-uncalibrated'
  /** The compass's own reference axis is near vertical, so it cannot be used. */
  | 'compass-unusable-at-this-angle'
  /** The camera points within a degree of straight up or down. */
  | 'camera-near-vertical'
  /** alpha is relative and nothing anchors it — iOS with no stored offset. */
  | 'heading-unreferenced'
  /** No orientation event has arrived, or its angles are null. */
  | 'no-orientation'
  /** Orientation events stopped arriving. */
  | 'sensors-stale'
  /** The phone is being moved too hard to read gravity from it. */
  | 'not-being-held-still'
  /** The deployment holds no elevation data for this position. */
  | 'no-terrain'
  /** Terrain is loading, or the position fix has not arrived yet. */
  | 'waiting-for-fix'
  | 'building-terrain';

export interface LiveRefusal {
  readonly code: LiveRefusalCode;
  /** One short line, in plain words. No jargon. */
  readonly headline: string;
  /** Why, in one sentence. No jargon. */
  readonly why: string;
  /** A physical action, or the plainest next step there is. No jargon. */
  readonly whatToDo: string;
  /** The technical name of the state, for a bug report. Small type. */
  readonly detail: string;
  /** True when waiting is the whole remedy, so the UI shows progress not alarm. */
  readonly transient: boolean;
}

const REFUSALS: Readonly<Record<LiveRefusalCode, Omit<LiveRefusal, 'code'>>> = {
  portrait: {
    headline: 'Turn the phone sideways',
    why: 'This screen only works held sideways, in landscape.',
    whatToDo: 'Rotate the phone a quarter turn, so the long edge is level.',
    detail: 'screen orientation is portrait; the landscape pose is the only one built',
    transient: true,
  },
  'insecure-context': {
    headline: 'This page cannot use the camera here',
    why: 'The camera, compass and location are only offered to pages loaded over https.',
    whatToDo: 'Open the published https address of this app instead of this one.',
    detail: 'window.isSecureContext is false; device APIs are gated on a secure origin',
    transient: false,
  },
  'not-started': {
    headline: 'Tap Start to begin',
    why: 'The phone only offers its camera, compass and location after you tap.',
    whatToDo: 'Tap Start, then tap Allow on each of the three questions the phone asks.',
    detail: 'awaiting the user gesture DeviceOrientationEvent.requestPermission() needs',
    transient: true,
  },
  'camera-denied': {
    headline: 'The camera was not allowed',
    why: 'You or the phone said no when this page asked for the camera.',
    whatToDo:
      'Open Settings, then Safari, then Camera, and set it to Ask or Allow. Then reload this page.',
    detail: 'getUserMedia rejected with NotAllowedError',
    transient: false,
  },
  'waiting-for-camera': {
    headline: 'Starting the camera',
    why: 'The camera is open but has not sent a picture yet.',
    whatToDo: 'Hold on a second. If the screen stays black, reload this page.',
    detail: 'the video element reports videoWidth 0, so there is no frame to scale the overlay by',
    transient: true,
  },
  'camera-unavailable': {
    headline: 'The camera did not open',
    why: 'The phone has a camera but would not hand it over — usually another app is using it.',
    whatToDo: 'Close any other app that is using the camera, then reload this page.',
    detail: 'getUserMedia rejected for a reason other than permission',
    transient: false,
  },
  'motion-denied': {
    headline: 'Motion and orientation were not allowed',
    why: 'Without them the app cannot tell which way the phone is pointing.',
    whatToDo:
      'Open Settings, then Safari, then Motion & Orientation Access, and turn it on. Then reload this page.',
    detail: 'DeviceOrientationEvent.requestPermission() returned denied',
    transient: false,
  },
  'motion-unavailable': {
    headline: 'This device reports no orientation',
    why: 'The app needs a compass and a tilt sensor, and this device offers neither.',
    whatToDo: 'Try the app on a phone. A desktop browser has no sensors to read.',
    detail: 'no deviceorientation or deviceorientationabsolute events arrived',
    transient: false,
  },
  'location-denied': {
    headline: 'Your location was not allowed',
    why: 'Without a position the app cannot tell which mountains are in front of you.',
    whatToDo:
      'Open Settings, then Privacy & Security, then Location Services, and allow it for Safari. Then reload this page.',
    detail: 'the Geolocation API returned PERMISSION_DENIED',
    transient: false,
  },
  'location-unavailable': {
    headline: 'Your location could not be found',
    why: 'The phone could not get a fix — this usually means no clear view of the sky yet.',
    whatToDo: 'Step outside, wait a few seconds, and tap Start again.',
    detail: 'the Geolocation API returned POSITION_UNAVAILABLE or timed out',
    transient: false,
  },
  'compass-uncalibrated': {
    headline: 'The compass needs calibrating',
    why: 'The phone says its compass reading is not usable yet.',
    whatToDo: 'Wave the phone through the air in a figure 8, a few times, then hold it up again.',
    detail: 'webkitCompassAccuracy is negative (CLHeading.headingAccuracy invalid)',
    transient: true,
  },
  'compass-unusable-at-this-angle': {
    headline: 'Hold the phone sideways and upright',
    why: 'At this angle the compass cannot say which way the camera is pointing.',
    whatToDo: 'Hold the phone sideways, upright, as if taking a photograph of the horizon.',
    detail: "the compass's reference axis is within a degree of vertical",
    transient: true,
  },
  'camera-near-vertical': {
    headline: 'Point the camera at the horizon',
    why: 'The camera is pointing almost straight up or straight down, where there is no bearing to draw.',
    whatToDo: 'Tilt the phone until the camera looks out at the view.',
    detail: "the camera axis is within a degree of vertical (MIN_HORIZONTAL_FRACTION)",
    transient: true,
  },
  'heading-unreferenced': {
    headline: 'This phone will not say which way is north',
    why: 'It reports how far it has turned, but not what it turned from.',
    whatToDo: 'Hold the phone sideways and upright so the built-in compass can answer instead.',
    detail: 'alpha is relative and no alpha offset is stored; see web-sensors.ts',
    transient: true,
  },
  'no-orientation': {
    headline: 'Waiting for the phone to report its angle',
    why: 'The tilt and compass readings have not arrived yet.',
    whatToDo: 'Hold the phone still for a second. If nothing happens, reload this page.',
    detail: 'alpha, beta or gamma is null on every event so far',
    transient: true,
  },
  'sensors-stale': {
    headline: 'The phone stopped reporting its angle',
    why: 'No tilt or compass reading has arrived for over a second.',
    whatToDo: 'Move the phone a little. If nothing comes back, reload this page.',
    detail: 'no usable sample within maxAgeMs of the current instant',
    transient: true,
  },
  'not-being-held-still': {
    headline: 'Hold the phone steadier',
    why: 'It is moving too much for the app to tell which way down is.',
    whatToDo: 'Hold the phone still, with both hands if you can.',
    detail: 'gravity magnitude outside GRAVITY_MAGNITUDE_RANGE',
    transient: true,
  },
  'no-terrain': {
    headline: 'No terrain for this location',
    why: 'This app only carries the elevation data for certain parts of the world, and this is not one of them.',
    whatToDo:
      'Nothing you can do here — the app would have to be published with the data for this area. It draws nothing rather than guessing.',
    detail: 'HttpTerrainStore.coverage reports the square degree is not served',
    transient: false,
  },
  'waiting-for-fix': {
    headline: 'Finding where you are',
    why: 'The phone is still working out your position.',
    whatToDo: 'Hold on a few seconds. Standing outside with a clear view of the sky is quickest.',
    detail: 'no geolocation fix yet',
    transient: true,
  },
  'building-terrain': {
    headline: 'Working out the skyline around you',
    why: 'The app is reading the elevation data for every direction from where you stand.',
    whatToDo: 'Hold on. This happens once, not every time you move the phone.',
    detail: 'annotateScene is running its 360° sweep',
    transient: true,
  },
};

/** The three sentences for a refusal state. */
export function liveRefusal(code: LiveRefusalCode): LiveRefusal {
  return { code, ...REFUSALS[code] };
}

/** Every state, for a test that checks all of them at once. */
export function allLiveRefusals(): readonly LiveRefusal[] {
  return (Object.keys(REFUSALS) as LiveRefusalCode[]).map(liveRefusal);
}

/**
 * Map `web-sensors.ts`'s refusal onto one of these.
 *
 * Two of its states are not user-facing conditions at all:
 * `'no-gravity-channel'` and `'not-finite'` mean a browser sent a malformed
 * payload, and `'bad-screen-angle'` means `screen.orientation.angle` was not a
 * right angle. All three become `'motion-unavailable'`, which is what they
 * amount to for the person holding the phone.
 */
export function refusalForWebSample(refusal: WebSampleRefusal): LiveRefusalCode {
  switch (refusal) {
    case 'no-orientation':
      return 'no-orientation';
    case 'compass-uncalibrated':
    case 'no-compass':
      return 'compass-uncalibrated';
    case 'compass-reference-near-vertical':
      return 'compass-unusable-at-this-angle';
    case 'camera-near-vertical':
      return 'camera-near-vertical';
    case 'relative-alpha':
      return 'heading-unreferenced';
    case 'no-gravity-channel':
    case 'not-finite':
    case 'bad-screen-angle':
      return 'motion-unavailable';
  }
}

/** Map `sensors.ts`'s fusion refusal onto one of these. */
export function refusalForSensorFusion(refusal: SensorRefusal): LiveRefusalCode {
  switch (refusal) {
    case 'no-samples':
      return 'no-orientation';
    case 'stale':
      return 'sensors-stale';
    case 'needs-declination':
      // `resolveHeadingForDrawing` converts or labels this one, so it never
      // reaches a refusal on the live path. Mapped for completeness.
      return 'heading-unreferenced';
    case 'not-gravity':
      return 'not-being-held-still';
    case 'gimbal-degenerate':
      return 'camera-near-vertical';
  }
}
