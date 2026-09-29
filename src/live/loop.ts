/**
 * The live overlay loop — Phase 8's P8.3, the pure half.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ONE FACT THE LOOP IS BUILT ON
 * ═══════════════════════════════════════════════════════════════════════════
 * Every verdict in an `AnnotatedScene` is POSE-FREE. Visibility is a fact
 * about the terrain and the peaks — a summit clears the ground in front of it
 * or it does not, whichever way the camera happens to point — and the sweep,
 * the horizon profile and every clearance were computed without consulting
 * `camera` at all (the pose only projects the results into the frame). So a
 * live view does NOT re-run the pipeline per frame: it computes the scene
 * once and re-projects it as the sensors move the pose, which is the entire
 * still pipeline minus the two expensive steps (terrain sweep, peak query).
 *
 * The one thing the pose CAN invalidate is coverage: the still pipeline
 * sweeps a bounded sector around the initial heading (2× the field of view in
 * the app), and a user who turns far enough points the camera at bearings
 * whose terrain was never swept — where peaks were refused as `unmeasured`
 * (R-1) and where the drawn horizon line would be interpolated across the
 * un-swept arc. That is not a rendering problem, it is missing evidence, so
 * this module REFUSES those frames with `resweep-needed` and the caller runs
 * the pipeline again around the new heading — exactly what the still path
 * does for a new photograph. Refusing is cheap (the check is arithmetic);
 * showing labels over never-swept terrain would be the fabrication this
 * repository exists to prevent.
 *
 * Pure throughout: scene in, overlay scene or refusal out. Both this function
 * and `layoutOverlay` (src/render) are side-effect-free, so a render loop can
 * call them per sensor tick. Nothing calls it yet: the React Native shell draws
 * the horizon line from `projectToImage` directly and has no terrain on the
 * phone to sweep, which is D7's open question.
 */

import type { CameraPose } from '../core/types.js';
import type { AnnotatedScene } from '../pipeline/types.js';
import type { OverlayScene } from '../render/types.js';

/**
 * The bearing span the renderer will actually draw for a pose: the horizon
 * polyline covers 1.5× the horizontal field of view (src/render/layout.ts),
 * which is wider than the frame itself. Using the DRAWN span rather than the
 * frame span means a pose passes this check only when everything that would
 * reach the screen has swept terrain under it.
 */
export const DRAWN_SPAN_FACTOR = 1.5;

export type LiveFrame =
  | { readonly ok: true; readonly overlay: OverlayScene }
  | {
      readonly ok: false;
      readonly reason: 'resweep-needed';
      /** How far the drawn span pokes outside the swept sector, degrees. */
      readonly uncoveredDeg: number;
      readonly detail: string;
    };

function normaliseDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * How far outside the swept sector the pose's drawn span reaches, degrees.
 * 0 means fully covered. Exported for the shell's own "turn back / hold on"
 * affordance — a UI can warn as the number grows instead of cutting off.
 */
export function uncoveredSpanDeg(scene: AnnotatedScene, pose: CameraPose): number {
  const { spanDeg, startBearingDeg } = scene.config.sweep;
  if (spanDeg >= 360) return 0;
  const drawnSpan = Math.min(360, pose.hFovDeg * DRAWN_SPAN_FACTOR);
  // Uncovered = drawn span minus its arc overlap with the sector. The drawn
  // arc starts `offset` past the sector start (unwrapped to [0, 360)); it
  // overlaps the sector directly where it begins inside it, and again via the
  // wrap where its tail passes 360 back into the sector's beginning.
  const offset = normaliseDeg(pose.headingDeg - drawnSpan / 2 - startBearingDeg);
  const direct = offset < spanDeg ? Math.min(spanDeg - offset, drawnSpan) : 0;
  const wrapped = Math.max(0, Math.min(offset + drawnSpan - 360, spanDeg));
  return drawnSpan - direct - wrapped;
}

/**
 * One live frame: the stored scene re-projected under `pose`, or a refusal.
 *
 * The overlay scene it returns is IDENTICAL in content to what the still
 * pipeline would produce for the same pose — same horizon, same labelled
 * peaks (verdicts are pose-free), same frame — which is P8.3's own bar and is
 * asserted as a property in loop.test.ts rather than trusted to this comment.
 *
 * `peaks` is the scene's `labelled` list: the pipeline's single answer to
 * "which summits may be drawn" (visible + self-occluded + marginal, decisions
 * D8/D10). A shell that offers the obscured-summits switch filters the same
 * way the web app does (`selectOverlayPeaks`).
 */
export function liveOverlayScene(
  scene: AnnotatedScene,
  pose: CameraPose,
  frame: { readonly widthPx: number; readonly heightPx: number },
): LiveFrame {
  const uncoveredDeg = uncoveredSpanDeg(scene, pose);
  if (uncoveredDeg > 0) {
    return {
      ok: false,
      reason: 'resweep-needed',
      uncoveredDeg,
      detail:
        `the drawn span at heading ${pose.headingDeg.toFixed(1)}° reaches ` +
        `${uncoveredDeg.toFixed(1)}° beyond the swept ${scene.config.sweep.spanDeg}° sector — ` +
        'labels over never-swept terrain would be invented; re-run the pipeline around the ' +
        'new heading',
    };
  }
  return {
    ok: true,
    overlay: {
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
      pose,
      horizon: scene.horizon,
      peaks: scene.labelled,
    },
  };
}
