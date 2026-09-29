/**
 * THE WIRING — app → pipeline → renderer (archive/v2-docs-20260929/TODO.md Q1).
 *
 * `seam.ts` states what the app will call and what it expects back. This module
 * is the implementation of that contract, and it is the ONLY place where the
 * three halves of the system meet:
 *
 *     OverlayRequest (frame, observer, pose, showObscuredPeaks)
 *       → coverage check          src/providers/http-terrain-store
 *       → annotateScene           src/pipeline
 *       → layoutOverlay + SVG     src/render
 *       → OverlayResult (svgMarkup, peakNames, notes)
 *
 * It is pure in the sense that matters: every outside dependency — the terrain
 * source, the peak source, the tolerances — is injected, so this file is
 * exercised in `npm run check` against an analytic plane with no browser, no
 * server and no tiles, exactly as the pipeline is.
 *
 * ── WHY THE COVERAGE CHECK COMES FIRST ─────────────────────────────────────
 * A photograph taken where the app holds no elevation data must not produce an
 * empty overlay. An empty overlay reads as "no peaks are visible from here",
 * which is a claim, and it would be a fabricated one. So coverage is settled
 * BEFORE the pipeline runs, and its absence is raised as an error the UI shows
 * verbatim — naming the position, the tile that is missing and the command that
 * fetches it. That is the same discipline `src/exif/resolve.ts` applies to a
 * missing pose field: unknown is a state with a reason, never a zero.
 */

import { isBehindCamera } from '../core/projection';
import type { CameraPose, LatLng, PeakVisibility } from '../core/types';
import { annotateScene } from '../pipeline/annotate';
import type { PeakSource, PipelineConfig, SweepConfig } from '../pipeline/types';
import type { ElevationProvider } from '../providers/elevation';
import type { TerrainCoverage } from '../providers/http-terrain-store';
import { buildOverlaySvgFromLayout, layoutOverlay } from '../render';
import type { OverlayOptions, OverlayScene } from '../render/types';
import type { OverlayBuilder, OverlayRequest, OverlayResult } from './seam';

/**
 * Terrain, as the app needs it: something to sample, and something that can say
 * whether a coordinate is covered at all without downloading a tile to find out.
 * `HttpTerrainStore` + `TileElevationProvider` satisfy this; so does a fake.
 */
export interface TerrainSource {
  readonly elevation: ElevationProvider;
  coverage(lat: number, lon: number): Promise<TerrainCoverage>;
}

export interface OverlayBuilderDeps {
  readonly terrain: TerrainSource;
  readonly peaks: PeakSource;
  /** Overrides merged over the defaults below. `sweep` is merged field-wise. */
  readonly config?: PipelineConfig;
  readonly overlayOptions?: OverlayOptions;
}

/**
 * How far the terrain walk goes, and how finely.
 *
 * 30 km covers the ridges that actually occlude: an occluder is nearly always
 * much closer than the summit it hides (Queen Anne Hill at 0.5 km hides Mount
 * Baker at 134 km). 90 m steps are three SRTM1 postings — enough to catch a
 * ridge crest, cheap enough that a 130° sector costs ~90 000 reads, which is
 * milliseconds against tiles already in memory.
 */
export const APP_SWEEP: Pick<SweepConfig, 'bearingStepDeg' | 'rangeStepM' | 'maxRangeKm'> = {
  bearingStepDeg: 0.5,
  rangeStepM: 90,
  maxRangeKm: 30,
};

/**
 * The near-field radius the app's verdicts carry their uncertainty over
 * (P1.6, decision D10, docs/NEAR-FIELD.md).
 *
 * 150 m — the same figure `npm run annotate` uses: a few SRTM postings
 * (~30 m each) widened by a typical phone GPS fix error. Inside it, the DEM's
 * own cells disagree about the ground the camera stands on, so a summit whose
 * verdict flips within that disagreement is labelled "may be hidden" instead
 * of being decided by the sampling grid. The web app is the surface D10 was
 * decided FOR; leaving the test off here while the developer script ran it
 * would be shipping the dishonest half.
 */
export const APP_NEAR_FIELD_RADIUS_M = 150;

/**
 * How far out summits are looked for.
 *
 * Larger than `APP_SWEEP.maxRangeKm` on purpose, and no longer a silent
 * over-claim (review 2, finding 2): the pipeline refuses a verdict on any peak
 * whose sightline it did not measure to the end, so a summit at 97 km comes
 * back in `scene.unmeasured` and is reported by `buildNotes` below rather than
 * drawn. Looking wide and refusing out loud is the useful half of the
 * asymmetry — it turns "the app has no terrain out there" into a note the user
 * can act on, where a narrow radius would simply never mention the mountain.
 *
 * The sweep stays at 30 km rather than growing to match: past that the app
 * would be sampling tiles it does not serve, which converts an honest refusal
 * into a ray full of holes and buys no answers. A deployment that does hold
 * 200 km of tiles raises `maxRangeKm` and gets real verdicts automatically,
 * because the refusal is keyed to terrain that was MEASURED, not to this number.
 */
export const APP_PEAK_RADIUS_KM = 200;

/** Raised when the app holds no elevation data where the photo was taken. */
export class TerrainUnavailableError extends Error {
  readonly coverage: TerrainCoverage;

  constructor(message: string, coverage: TerrainCoverage) {
    super(message);
    this.name = 'TerrainUnavailableError';
    this.coverage = coverage;
  }
}

function normaliseBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/**
 * The sector of terrain one photograph needs.
 *
 * Twice the horizontal field of view, centred on the heading. Sweeping the full
 * circle would spend three quarters of the work on terrain behind the camera;
 * sweeping exactly the field of view would leave the overlay's own horizon line
 * — which is drawn across 1.5 × hFOV — running off the end of the profile.
 * Double is the smallest simple rule that covers the drawn line with margin for
 * a trim slider nudge.
 */
export function sweepForPose(pose: CameraPose): Pick<SweepConfig, 'spanDeg' | 'startBearingDeg'> {
  const spanDeg = Math.min(360, pose.hFovDeg * 2);
  return {
    spanDeg,
    startBearingDeg: normaliseBearing(pose.headingDeg - spanDeg / 2),
  };
}

/**
 * Which peaks the overlay is entitled to draw.
 *
 * `labelled` is the pipeline's own answer to that question (visible plus
 * self-occluded plus marginal — decisions D8 and P1.6); the switch only ever
 * removes the SELF-OCCLUDED ones. Marginal summits stay either way: the
 * switch is "hide summits tucked behind their own hill", and a marginal
 * summit may be in plain view — hiding it would convert "the data cannot
 * decide" into "hidden", the exact promotion the state exists to prevent.
 * Foreground-occluded summits are never in `labelled`, so this function
 * cannot leak one however it is called.
 */
export function selectOverlayPeaks<T extends { readonly visibility?: PeakVisibility }>(
  scene: { readonly visible: readonly T[]; readonly labelled: readonly T[] },
  showObscuredPeaks: boolean,
): readonly T[] {
  if (showObscuredPeaks) return scene.labelled;
  return scene.labelled.filter((peak) => peak.visibility !== 'self-occluded');
}

/** Up to `limit` names, then "and N more" — for a one-line note. */
function nameList(names: readonly string[], limit = 4): string {
  if (names.length <= limit) return names.join(', ');
  return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/**
 * The message shown when the app has no terrain for a photograph.
 *
 * Written to be actionable rather than apologetic: where the photo is, which
 * tile that needs, and what the deployment does hold. It also states plainly
 * that nothing was drawn, because the failure mode being guarded against is a
 * blank overlay being read as "no peaks are visible".
 *
 * ── WHO IS READING IT ──────────────────────────────────────────────────────
 * Two audiences, one string. A visitor to a deployed site cannot run npm and
 * has no `data/tiles/` to serve, so the first three sentences are addressed to
 * them and say what is true of the *deployment*: this build does not hold that
 * square degree of the planet, and that is a gap in what was published, not a
 * verdict about the view. The developer instruction is kept — it is the one
 * sentence that closes the gap — but it comes last and is explicitly scoped to
 * someone running a source checkout, so a stranger is never told to type a
 * command that cannot exist for them.
 */
export function noTerrainMessage(coverage: TerrainCoverage, at: LatLng): string {
  const held =
    coverage.available.length === 0
      ? 'It is serving no terrain at all.'
      : `It is serving: ${nameList(coverage.available, 6)}.`;
  return (
    `No terrain data for ${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}. ` +
    `That position needs SRTM tile ${coverage.tileName}, which this deployment does not hold. ` +
    `${held} ` +
    'Without it there is no horizon and no visibility verdict here, so nothing is drawn — ' +
    'an empty overlay would look like "no peaks are visible", which is a different claim. ' +
    'Photographs taken over the terrain this build does ship are unaffected. ' +
    `(Running Mountain Finder from a source checkout? "npm run fetch:tiles -- ${coverage.tileName}" ` +
    'downloads that tile into data/tiles/, which is served at /terrain/.)'
  );
}

/**
 * Everything one note needs to know about one summit. `bearingDeg` and
 * `altitudeDeg` are there for the behind-the-camera test below.
 */
interface NotePeak {
  readonly name: string;
  readonly bearingDeg: number;
  readonly altitudeDeg: number;
}

/**
 * The notes shown under a sparse overlay, one per reason.
 *
 * Exported for its tests: each note makes a claim about the world ("hidden
 * behind nearer hills"), and a claim that can be wrong gets a test.
 */
export function buildNotes(
  pose: CameraPose,
  scene: {
    readonly peaks: readonly { readonly name: string }[];
    readonly foregroundOccluded: readonly NotePeak[];
    readonly marginal: readonly { readonly name: string }[];
    readonly unmeasured: readonly { readonly name: string }[];
    readonly sweep: { readonly raysRequested: number; readonly raysWithTerrain: number };
    readonly config: { readonly peakRadiusKm: number; readonly sweep: { readonly maxRangeKm: number } };
  },
  layout: { readonly offFramePeaks: readonly { readonly name: string }[] },
  at: LatLng,
): string[] {
  const notes: string[] = [];

  if (scene.peaks.length === 0) {
    notes.push(
      `The bundled peak database holds no summit within ${scene.config.peakRadiusKm} km of ` +
        `${at.lat.toFixed(4)}, ${at.lon.toFixed(4)}, so nothing can be labelled here — that is ` +
        'a gap in the database, not a view without mountains.',
    );
  }
  if (layout.offFramePeaks.length > 0) {
    notes.push(
      `${layout.offFramePeaks.length} summit${layout.offFramePeaks.length === 1 ? '' : 's'} ` +
        `outside this frame (or behind the camera), not drawn: ` +
        `${nameList(layout.offFramePeaks.map((peak) => peak.name))}.`,
    );
  }
  // A sweep is twice the field of view wide, so it reaches round past the film
  // plane whenever the lens is wider than 90°, and a summit back there gets an
  // occlusion verdict like any other. Counting one here would tell the viewer
  // a mountain behind them is missing from the frame because a hill is in the
  // way. The terrain in front of it is real and the verdict stands; it is only
  // no reason this photograph does not show it.
  const occludedInView = scene.foregroundOccluded.filter(
    (peak) => !isBehindCamera(pose, peak.bearingDeg, peak.altitudeDeg),
  );
  if (occludedInView.length > 0) {
    notes.push(
      `${occludedInView.length} summit${occludedInView.length === 1 ? ' is' : 's are'} ` +
        `hidden behind nearer, different hills and ${occludedInView.length === 1 ? 'is' : 'are'} ` +
        `never labelled: ${nameList(occludedInView.map((peak) => peak.name))}.`,
    );
  }
  if (scene.marginal.length > 0) {
    // P1.6 / D10: the ground within ~150 m of the camera decides these
    // verdicts and the DEM cannot resolve it, so neither "visible" nor
    // "hidden" is claimed. The label itself already says "may be hidden";
    // this note says WHY, once, instead of per label.
    notes.push(
      `${scene.marginal.length} summit${scene.marginal.length === 1 ? '' : 's'} may or may not ` +
        `clear the ground right in front of the camera — terrain data cannot resolve ground ` +
        `that close, so ${scene.marginal.length === 1 ? 'it is' : 'they are'} labelled ` +
        `"may be hidden" rather than decided: ${nameList(scene.marginal.map((peak) => peak.name))}.`,
    );
  }
  if (scene.unmeasured.length > 0) {
    // Not drawn and not claimed either way. Saying so is the point: these are
    // the summits the app used to judge off terrain nobody measured — beyond
    // the swept range, or (R-1) outside the swept sector entirely, which for a
    // photograph mostly means behind the camera. A user who sees a name here
    // can widen the terrain rather than wonder why a mountain is missing.
    notes.push(
      `${scene.unmeasured.length} summit${scene.unmeasured.length === 1 ? '' : 's'} ` +
        `${scene.unmeasured.length === 1 ? 'was' : 'were'} not judged — beyond the ` +
        `${scene.config.sweep.maxRangeKm} km swept range, or outside the swept sector ` +
        `(mostly behind the camera) — so ` +
        `${scene.unmeasured.length === 1 ? 'it is' : 'they are'} neither labelled nor ruled out: ` +
        `${nameList(scene.unmeasured.map((peak) => peak.name))}.`,
    );
  }
  const blindRays = scene.sweep.raysRequested - scene.sweep.raysWithTerrain;
  if (blindRays > 0) {
    notes.push(
      `${blindRays} of ${scene.sweep.raysRequested} sampled bearings had no elevation data; ` +
        'the horizon line is interpolated across them and a summit there could be wrong.',
    );
  }
  return notes;
}

/** Build the app's `OverlayBuilder` over injected terrain and peak sources. */
export function createOverlayBuilder(deps: OverlayBuilderDeps): OverlayBuilder {
  return async (request: OverlayRequest): Promise<OverlayResult> => {
    const { observer, pose, frame } = request;

    const coverage = await deps.terrain.coverage(observer.lat, observer.lon);
    if (!coverage.covered) {
      throw new TerrainUnavailableError(noTerrainMessage(coverage, observer), coverage);
    }

    const config: PipelineConfig = {
      peakRadiusKm: APP_PEAK_RADIUS_KM,
      nearFieldRadiusM: APP_NEAR_FIELD_RADIUS_M,
      ...deps.config,
      sweep: { ...APP_SWEEP, ...sweepForPose(pose), ...deps.config?.sweep },
    };

    const scene = await annotateScene({
      // Every field is already resolved — `deriveSession` only builds an
      // `OverlayRequest` once `resolvePose` reports a complete pose — so the
      // pipeline is told the ground height rather than asked to look it up.
      observer: {
        lat: observer.lat,
        lon: observer.lon,
        eyeHeightM: observer.eyeHeightM,
        groundElevationM: observer.groundElevationM,
      },
      camera: pose,
      elevation: deps.terrain.elevation,
      peaks: deps.peaks,
      config,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });

    const overlayScene: OverlayScene = {
      widthPx: frame.widthPx,
      heightPx: frame.heightPx,
      pose,
      horizon: scene.horizon,
      peaks: selectOverlayPeaks(scene, request.showObscuredPeaks),
    };

    const layout = layoutOverlay(overlayScene, deps.overlayOptions ?? {});
    const notes = buildNotes(pose, scene, layout, observer);

    return {
      svgMarkup: buildOverlaySvgFromLayout(layout),
      // The names actually DRAWN, read back off the layout rather than off the
      // scene: a peak the renderer dropped must not be announced as labelled.
      peakNames: layout.markers.map((marker) => marker.peak.name),
      ...(notes.length === 0 ? {} : { notes }),
      // P7.4: the basis for an auto-trim suggestion — the pose this scene ran
      // with and the near-field-free profile the aligner may match (CV-10).
      ...(scene.alignmentHorizon === undefined
        ? {}
        : { alignment: { camera: pose, horizon: scene.alignmentHorizon } }),
    };
  };
}
