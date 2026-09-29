/**
 * Choosing ONE rear lens, and never a lens group.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE FAILURE THIS PREVENTS
 * ═══════════════════════════════════════════════════════════════════════════
 * iOS exposes the rear camera twice. There are single physical lenses —
 * `"Back Camera"`, `"Back Ultra Wide Camera"`, `"Back Telephoto Camera"` — and
 * there are virtual devices that switch between them by themselves:
 * `"Back Dual Wide Camera"`, `"Back Dual Camera"`, `"Back Triple Camera"`.
 *
 * Opening a virtual device gives iOS 18 permission to change lens mid-stream,
 * which it does, without firing an event. The field of view jumps by about 2×.
 * The overlay would then be scaled wrongly with nothing on screen saying so —
 * the exact class of silent, plausible error this repository is built against
 * (IMPLEMENTATION.md, "The route to the field test").
 *
 * So the app asks for a named single lens, and when it cannot confirm it has
 * one it says so rather than assuming. `facingMode: 'environment'` alone is not
 * enough: it is a constraint, and the browser is free to satisfy it with a
 * virtual device.
 *
 * ── WHY THE PICK RUNS TWICE ────────────────────────────────────────────────
 * `enumerateDevices` returns empty labels until a camera permission has been
 * granted, so the first `getUserMedia` has nothing to choose from. The flow is
 * therefore: open by constraint, enumerate now that labels exist, and reopen by
 * `deviceId` when a better-identified device is available. This module is the
 * pure decision in the middle of that; the calls themselves are in the screen.
 *
 * Pure: a list of device descriptions in, one decision out. No DOM types — the
 * input is structurally what `MediaDeviceInfo` provides.
 */

/** Structurally what `enumerateDevices()` yields, with nothing else read. */
export interface MediaDeviceLike {
  readonly kind: string;
  readonly deviceId: string;
  readonly label: string;
}

/**
 * Words that mark a label as a lens GROUP rather than one lens.
 *
 * Matched case-insensitively as whole words against the label. `dual` and
 * `triple` are Apple's own names for the switching devices. `virtual` and
 * `composite` are not known to appear on iOS and are here because a device
 * whose label advertises itself as synthetic must not be treated as a fixed
 * lens on any platform.
 */
export const LENS_GROUP_WORDS = ['dual', 'triple', 'virtual', 'composite'] as const;

/** Labels of single rear lenses, in the order this app prefers them. */
export const SINGLE_REAR_LENS_PREFERENCE = [
  'back camera',
  'back wide camera',
  'back telephoto camera',
  'back ultra wide camera',
] as const;

export type CameraChoice =
  /** A named single rear lens. The only case the app calls confirmed. */
  | {
      readonly kind: 'single-lens';
      readonly deviceId: string;
      readonly label: string;
      /** Where in {@link SINGLE_REAR_LENS_PREFERENCE} the label matched. */
      readonly preferenceRank: number;
    }
  /**
   * Cameras exist and one faces backwards, but every rear label names a lens
   * group. Opening it risks a silent lens switch, so the caller opens it and
   * warns rather than presenting the field of view as settled.
   */
  | { readonly kind: 'lens-group-only'; readonly deviceId: string; readonly label: string }
  /**
   * Cameras exist but the labels say nothing usable — no permission yet, or a
   * browser that does not name its devices. Headless Chromium's fake device is
   * this case: its label is the path of the file standing in for the camera.
   */
  | { readonly kind: 'unlabelled'; readonly deviceId: string; readonly label: string }
  /** No video input at all. */
  | { readonly kind: 'no-camera' };

function normalise(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when a label names a device that switches lenses by itself. */
export function isLensGroupLabel(label: string): boolean {
  const words = new Set(normalise(label).split(/[^a-z]+/).filter((word) => word.length > 0));
  return LENS_GROUP_WORDS.some((word) => words.has(word));
}

/** True when a label names a camera on the back of the device. */
export function isRearLabel(label: string): boolean {
  return /\bback\b|\brear\b|\benvironment\b/.test(normalise(label));
}

/**
 * Pick the camera to open.
 *
 * A single named rear lens wins, by {@link SINGLE_REAR_LENS_PREFERENCE}. Then a
 * rear lens group, reported as such. Then any video input whose label carries
 * no information, reported as such. `'back camera'` outranks
 * `'back wide camera'` because that is the name iOS gives the main lens; the
 * remaining two are the same physical lenses a group would switch to, and a
 * fixed one of them is still better than a switching one.
 */
export function chooseRearCamera(devices: readonly MediaDeviceLike[]): CameraChoice {
  const videoInputs = devices.filter((device) => device.kind === 'videoinput');
  if (videoInputs.length === 0) return { kind: 'no-camera' };

  let best: { device: MediaDeviceLike; rank: number } | undefined;
  for (const device of videoInputs) {
    if (isLensGroupLabel(device.label)) continue;
    const rank = SINGLE_REAR_LENS_PREFERENCE.indexOf(
      normalise(device.label) as (typeof SINGLE_REAR_LENS_PREFERENCE)[number],
    );
    if (rank < 0) continue;
    if (best === undefined || rank < best.rank) best = { device, rank };
  }
  if (best !== undefined) {
    return {
      kind: 'single-lens',
      deviceId: best.device.deviceId,
      label: best.device.label,
      preferenceRank: best.rank,
    };
  }

  const group = videoInputs.find(
    (device) => isRearLabel(device.label) && isLensGroupLabel(device.label),
  );
  if (group !== undefined) {
    return { kind: 'lens-group-only', deviceId: group.deviceId, label: group.label };
  }

  // A rear device whose label is neither a known single lens nor a known group
  // is as unidentified as a device with no label at all, so both land here.
  const fallback = videoInputs.find((device) => isRearLabel(device.label)) ?? videoInputs[0];
  if (fallback === undefined) return { kind: 'no-camera' };
  return { kind: 'unlabelled', deviceId: fallback.deviceId, label: fallback.label };
}

/**
 * What the screen says about the lens it opened.
 *
 * Only `'single-lens'` gets to be silent. Both other cases put a sentence on
 * screen, because the field of view the overlay is scaled by may change under
 * them and the user is the one who can see it happen.
 */
export function cameraChoiceWarning(choice: CameraChoice): string | undefined {
  switch (choice.kind) {
    case 'single-lens':
      return undefined;
    case 'lens-group-only':
      return (
        `This phone only offers the rear camera as "${choice.label}", which switches ` +
        'between lenses on its own. If the picture suddenly gets wider or closer, the ' +
        'labels will be the wrong size until you line them up again.'
      );
    case 'unlabelled':
      return (
        'This browser will not say which lens it opened, so the app cannot confirm it ' +
        'is a single fixed lens. Treat the label spacing as unproven.'
      );
    case 'no-camera':
      return 'No camera was found on this device.';
  }
}
