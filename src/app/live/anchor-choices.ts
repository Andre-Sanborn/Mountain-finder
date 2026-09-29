/**
 * The summits the field session offers as a drag anchor.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT `layout.markers`
 * ═══════════════════════════════════════════════════════════════════════════
 * The panel used to list the drawn labels. On a phone-width frame the label
 * budget is small — the rehearsal measured an 800 px frame dropping the very
 * summit the protocol was anchored on — and a summit with no label is a dot the
 * person cannot name. So the protocol's anchor became unpickable exactly where
 * the protocol runs.
 *
 * A summit that is IN THE PICTURE is offerable, whether or not the frame had
 * room to write its name. `layout.markers` and `layout.crowdedOutSummits`
 * together are precisely that set: both carry a pixel position because both are
 * drawn, and the peaks that are not drawn at all (off-frame, or refused by D8)
 * are in separate lists and stay out.
 *
 * ── THE ORDER ──────────────────────────────────────────────────────────────
 * Nearest the middle of the frame first. Someone picking the summit they lined
 * up is looking at the middle of their own picture, and a list in reading order
 * puts whatever sits at the left edge first. Ties break by name and then by id,
 * so the list is total and does not reorder itself between redraws.
 *
 * Pure: pixels and names in, a list out. No DOM, no clock.
 */

import type { OverlayLayout } from '../../render/types';

/** One summit the person may name as the anchor. */
export interface AnchorChoice {
  readonly id: string;
  readonly name: string;
  /** Where its dot is drawn, in overlay pixels. */
  readonly summitPx: { readonly xPx: number; readonly yPx: number };
  /** True when the frame gave this summit a dot and no name. */
  readonly crowdedOut: boolean;
}

/**
 * Every in-frame summit, nearest the middle of the frame first.
 *
 * Summits with no name are left out: the list is read by name, and a blank
 * button names nothing.
 */
export function anchorChoices(
  layout: OverlayLayout,
  overlayWidthPx: number,
): readonly AnchorChoice[] {
  const centreXPx = overlayWidthPx / 2;
  const choices: AnchorChoice[] = [];

  for (const marker of layout.markers) {
    if (marker.peak.name.trim() === '') continue;
    choices.push({
      id: marker.peak.id,
      name: marker.peak.name,
      summitPx: marker.summitPx,
      crowdedOut: false,
    });
  }
  for (const summit of layout.crowdedOutSummits) {
    if (summit.peak.name.trim() === '') continue;
    choices.push({
      id: summit.peak.id,
      name: summit.peak.name,
      summitPx: summit.summitPx,
      crowdedOut: true,
    });
  }

  choices.sort((a, b) => {
    const da = Math.abs(a.summitPx.xPx - centreXPx);
    const db = Math.abs(b.summitPx.xPx - centreXPx);
    if (da !== db) return da - db;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return choices;
}

/** The choice with this id, or undefined when it has left the frame. */
export function findAnchorChoice(
  choices: readonly AnchorChoice[],
  id: string | undefined,
): AnchorChoice | undefined {
  if (id === undefined) return undefined;
  return choices.find((choice) => choice.id === id);
}
