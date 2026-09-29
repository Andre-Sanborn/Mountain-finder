/**
 * Every refusal the AR screen can show, checked for the two properties that
 * make a refusal useful: it names an action, and it is free of jargon.
 *
 * These are properties of the whole set rather than of particular strings, so
 * adding a state cannot quietly add an unusable message. The three messages the
 * task names explicitly — sideways, figure 8, no terrain — are pinned by
 * content as well, because those are the ones the field session depends on.
 *
 * The jargon list is the vocabulary of this repository's own internals. A word
 * from it in the headline or the remedy means a state's message was written for
 * a developer.
 */

import { describe, expect, it } from 'vitest';

import type { SensorRefusal } from '../../live/sensors';
import type { WebSampleRefusal } from '../../live/web-sensors';
import {
  allLiveRefusals,
  liveRefusal,
  refusalForSensorFusion,
  refusalForWebSample,
  type LiveRefusalCode,
} from './refusals';

/** Words that mean nothing to someone holding a phone on a ridge. */
const JARGON = [
  'getusermedia',
  'deviceorientation',
  'devicemotion',
  'alpha',
  'beta',
  'gamma',
  'gravity vector',
  'api',
  'null',
  'undefined',
  'nan',
  'refusal',
  'annotatescene',
  'localstorage',
  'clheading',
  'webkit',
  'dem',
  'srtm',
  'gimbal',
  'magnetometer',
  'declination',
  'quaternion',
  'deviceid',
  'promise',
  'exception',
];

describe('every refusal', () => {
  const refusals = allLiveRefusals();

  it('covers every code exactly once', () => {
    const codes = refusals.map((refusal) => refusal.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.length).toBeGreaterThan(15);
  });

  it('says what happened, why, and what to do — all three, non-empty', () => {
    for (const refusal of refusals) {
      expect(refusal.headline.length, refusal.code).toBeGreaterThan(5);
      expect(refusal.why.length, refusal.code).toBeGreaterThan(20);
      expect(refusal.whatToDo.length, refusal.code).toBeGreaterThan(20);
      expect(refusal.detail.length, refusal.code).toBeGreaterThan(10);
    }
  });

  it('keeps jargon out of the headline and the remedy', () => {
    for (const refusal of refusals) {
      const prose = `${refusal.headline} ${refusal.why} ${refusal.whatToDo}`.toLowerCase();
      for (const word of JARGON) {
        expect(prose, `${refusal.code} says "${word}"`).not.toContain(word);
      }
    }
  });

  it('puts the technical name in `detail`, which is where it belongs', () => {
    // The counterpart of the rule above: a developer reading a bug report has
    // to be able to find the state, so at least some details do use the names.
    const details = refusals.map((refusal) => refusal.detail.toLowerCase()).join(' ');
    expect(details).toContain('getusermedia');
    expect(details).toContain('deviceorientation');
  });

  it('marks as transient exactly the states that waiting or moving fixes', () => {
    const transient = new Set(
      refusals.filter((refusal) => refusal.transient).map((refusal) => refusal.code),
    );
    // Holding the phone differently, or waiting, is the whole remedy here.
    for (const code of [
      'portrait',
      'compass-uncalibrated',
      'camera-near-vertical',
      'sensors-stale',
      'waiting-for-fix',
      'building-terrain',
    ] as const) {
      expect(transient.has(code), code).toBe(true);
    }
    // These need a settings change, a different device, or a different build.
    for (const code of [
      'insecure-context',
      'camera-denied',
      'motion-denied',
      'location-denied',
      'no-terrain',
    ] as const) {
      expect(transient.has(code), code).toBe(false);
    }
  });
});

describe('the three messages the field session depends on', () => {
  it('tells a portrait phone to turn sideways', () => {
    const refusal = liveRefusal('portrait');
    expect(refusal.headline.toLowerCase()).toContain('sideways');
    expect(refusal.whatToDo.toLowerCase()).toContain('rotate');
  });

  it('tells an uncalibrated compass to be waved in a figure 8', () => {
    const refusal = liveRefusal('compass-uncalibrated');
    expect(refusal.headline.toLowerCase()).toContain('calibrat');
    expect(refusal.whatToDo.toLowerCase()).toContain('figure 8');
  });

  it('says there is no terrain for this location, and that nothing was drawn', () => {
    const refusal = liveRefusal('no-terrain');
    expect(refusal.headline.toLowerCase()).toContain('no terrain for this location');
    // The point D9 and the overlay builder both insist on: silence is not a
    // verdict about the view.
    expect(refusal.whatToDo.toLowerCase()).toContain('rather than guessing');
  });
});

describe('the iOS settings paths the denial messages name', () => {
  /** Do these words appear in this order? */
  function inOrder(text: string, words: readonly string[]): boolean {
    let at = 0;
    for (const word of words) {
      const found = text.indexOf(word, at);
      if (found < 0) return false;
      at = found + word.length;
    }
    return true;
  }

  it('sends a refused camera to Settings → Apps → Safari → Camera', () => {
    // Safari's own permissions moved under Settings → Apps in iOS 18.2, so the
    // pre-18.2 "Settings, then Safari" walks a person into a list that has no
    // Safari row in it.
    const text = liveRefusal('camera-denied').whatToDo.toLowerCase();
    expect(inOrder(text, ['settings', 'apps', 'safari', 'camera'])).toBe(true);
  });

  it('sends a refused location to both switches that gate it', () => {
    const text = liveRefusal('location-denied').whatToDo.toLowerCase();
    // The system switch, which is not under Safari at all.
    expect(inOrder(text, ['privacy & security', 'location services', 'safari websites'])).toBe(
      true,
    );
    // Safari's own, which is.
    expect(inOrder(text, ['apps', 'safari', 'location'])).toBe(true);
  });

  it('clears a refused motion answer with the site data, and admits what is unconfirmed', () => {
    const text = liveRefusal('motion-denied').whatToDo.toLowerCase();
    // There is no Motion & Orientation Access setting on current iOS and no
    // per-site switch for it, so the stored answer goes with the site data.
    expect(inOrder(text, ['settings', 'apps', 'safari', 'advanced', 'website data'])).toBe(true);
    expect(text).not.toContain('motion & orientation access');
    // Said on screen, because the project could not confirm which remedy works.
    expect(text).toContain('close this tab');
    expect(text).toContain('not been confirmed');
  });
});

describe('mapping the modules’ own refusals', () => {
  it('maps every web-sensors refusal to a state with a remedy', () => {
    const all: readonly WebSampleRefusal[] = [
      'no-orientation',
      'no-gravity-channel',
      'not-finite',
      'no-compass',
      'compass-uncalibrated',
      'relative-alpha',
      'camera-near-vertical',
      'compass-reference-near-vertical',
      'bad-screen-angle',
    ];
    for (const refusal of all) {
      const code: LiveRefusalCode = refusalForWebSample(refusal);
      expect(liveRefusal(code).whatToDo.length, refusal).toBeGreaterThan(20);
    }
  });

  it('sends an uncalibrated compass and a missing one to the figure-8 message', () => {
    // Both are "the compass has no usable reading". WebKit publishes heading 0
    // with accuracy −1 for a phone with no compass at all, so the two states
    // are indistinguishable to the user and get the same remedy.
    expect(refusalForWebSample('compass-uncalibrated')).toBe('compass-uncalibrated');
    expect(refusalForWebSample('no-compass')).toBe('compass-uncalibrated');
  });

  it('sends a malformed payload to "this device reports no orientation"', () => {
    for (const refusal of ['no-gravity-channel', 'not-finite', 'bad-screen-angle'] as const) {
      expect(refusalForWebSample(refusal)).toBe('motion-unavailable');
    }
  });

  it('maps every sensor-fusion refusal to a state with a remedy', () => {
    const all: readonly SensorRefusal[] = [
      'no-samples',
      'stale',
      'needs-declination',
      'not-gravity',
      'gimbal-degenerate',
    ];
    for (const refusal of all) {
      expect(liveRefusal(refusalForSensorFusion(refusal)).whatToDo.length, refusal).toBeGreaterThan(20);
    }
    expect(refusalForSensorFusion('stale')).toBe('sensors-stale');
    expect(refusalForSensorFusion('not-gravity')).toBe('not-being-held-still');
    expect(refusalForSensorFusion('gimbal-degenerate')).toBe('camera-near-vertical');
  });
});
