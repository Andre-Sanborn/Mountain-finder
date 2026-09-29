/**
 * Picking one rear lens, and never a lens group.
 *
 * The labels are Apple's own device names, as `enumerateDevices` reports them
 * on iOS. The expectation in every case is derived from the rule the module
 * states — a single named lens wins, a group is reported as a group, an
 * uninformative label is reported as uninformative — not from a run.
 *
 * The fake-device label in the last case is what this environment's Chromium
 * actually reports for `--use-file-for-fake-video-capture`: the path of the
 * file standing in for the camera. That is a real label carrying no lens
 * information, which is exactly the third case.
 */

import { describe, expect, it } from 'vitest';

import {
  cameraChoiceWarning,
  chooseRearCamera,
  isLensGroupLabel,
  isRearLabel,
  type MediaDeviceLike,
} from './camera-devices';

const video = (label: string, deviceId = label): MediaDeviceLike => ({
  kind: 'videoinput',
  deviceId,
  label,
});

/** What iOS offers on a triple-lens phone, in the order it lists them. */
const IPHONE_PRO: readonly MediaDeviceLike[] = [
  video('Front Camera', 'front'),
  video('Back Dual Wide Camera', 'dual-wide'),
  video('Back Camera', 'back'),
  video('Back Ultra Wide Camera', 'ultra'),
  video('Back Telephoto Camera', 'tele'),
  video('Back Triple Camera', 'triple'),
  { kind: 'audioinput', deviceId: 'mic', label: 'iPhone Microphone' },
];

describe('isLensGroupLabel', () => {
  it('flags Apple’s switching devices', () => {
    for (const label of [
      'Back Dual Wide Camera',
      'Back Dual Camera',
      'Back Triple Camera',
      'back triple camera',
    ]) {
      expect(isLensGroupLabel(label), label).toBe(true);
    }
  });

  it('does not flag a single lens', () => {
    for (const label of [
      'Back Camera',
      'Back Ultra Wide Camera',
      'Back Telephoto Camera',
      'Front Camera',
    ]) {
      expect(isLensGroupLabel(label), label).toBe(false);
    }
  });

  it('matches whole words, so a lens is not flagged for containing one', () => {
    // "Individual" contains "dual". Matching substrings would refuse a single
    // lens on a phone whose label happened to contain the letters.
    expect(isLensGroupLabel('Back Individually Named Camera')).toBe(false);
    expect(isLensGroupLabel('Back Dual Camera')).toBe(true);
  });
});

describe('isRearLabel', () => {
  it('recognises the three words a rear camera is named with', () => {
    expect(isRearLabel('Back Camera')).toBe(true);
    expect(isRearLabel('Rear camera 0')).toBe(true);
    expect(isRearLabel('camera2 0, facing environment')).toBe(true);
    expect(isRearLabel('Front Camera')).toBe(false);
  });
});

describe('chooseRearCamera', () => {
  it('takes "Back Camera" over every group and every other lens', () => {
    const choice = chooseRearCamera(IPHONE_PRO);
    expect(choice.kind).toBe('single-lens');
    if (choice.kind !== 'single-lens') return;
    expect(choice.label).toBe('Back Camera');
    expect(choice.deviceId).toBe('back');
    expect(choice.preferenceRank).toBe(0);
    expect(cameraChoiceWarning(choice)).toBeUndefined();
  });

  it('never returns a group while any single rear lens exists', () => {
    // "Back Camera" removed: the ultra wide and telephoto are still single
    // physical lenses and are preferred over the two switching devices.
    const choice = chooseRearCamera(IPHONE_PRO.filter((d) => d.deviceId !== 'back'));
    expect(choice.kind).toBe('single-lens');
    if (choice.kind !== 'single-lens') return;
    expect(choice.label).toBe('Back Telephoto Camera');
  });

  it('reports a group as a group when the phone offers nothing else', () => {
    const choice = chooseRearCamera([video('Front Camera', 'front'), video('Back Triple Camera', 'triple')]);
    expect(choice.kind).toBe('lens-group-only');
    if (choice.kind !== 'lens-group-only') return;
    expect(choice.deviceId).toBe('triple');
    // The warning says what the user will SEE, not what the API returned.
    expect(cameraChoiceWarning(choice)).toContain('switches');
    expect(cameraChoiceWarning(choice)).toContain('wider or closer');
  });

  it('reports an uninformative label as unproven rather than as a single lens', () => {
    // The label headless Chromium gives its fake device: a file path. It is
    // neither a known lens nor a known group, so the honest answer is that the
    // app cannot confirm what it opened.
    const choice = chooseRearCamera([video('/tmp/mf-live/fake-camera.y4m', 'fake')]);
    expect(choice.kind).toBe('unlabelled');
    if (choice.kind !== 'unlabelled') return;
    expect(choice.deviceId).toBe('fake');
    expect(cameraChoiceWarning(choice)).toContain('unproven');
  });

  it('prefers a rear unlabelled device over a front one', () => {
    const choice = chooseRearCamera([
      video('Front Camera', 'front'),
      video('camera2 0, facing environment', 'rear-android'),
    ]);
    expect(choice.kind).toBe('unlabelled');
    if (choice.kind !== 'unlabelled') return;
    expect(choice.deviceId).toBe('rear-android');
  });

  it('says so when there is no camera, and when there are only microphones', () => {
    expect(chooseRearCamera([])).toEqual({ kind: 'no-camera' });
    expect(
      chooseRearCamera([{ kind: 'audioinput', deviceId: 'mic', label: 'Fake Audio Input 1' }]),
    ).toEqual({ kind: 'no-camera' });
  });

  it('handles the unlabelled state iOS reports before permission is granted', () => {
    // Before a camera permission exists, every label is the empty string. The
    // decision is then "cannot confirm", which is what drives the app to
    // enumerate again once the first stream has granted permission.
    const choice = chooseRearCamera([video('', 'a'), video('', 'b')]);
    expect(choice.kind).toBe('unlabelled');
  });
});
