/**
 * Schema for the real-world ground-truth acceptance cases (archive/v2-docs-20260929/PLAN.md P6.2).
 *
 * These files live under tests/acceptance/ rather than fixtures/ because they
 * are pure text — coordinates, citations and expected peak names. No binaries
 * are committed: archive/v2-docs-20260929/PLAN.md and the task brief both forbid dragging large photos
 * into the repository, so where an openly licensed photograph exists we record
 * its URL and licence and leave the bytes on the internet.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE HONESTY RULES THIS SCHEMA ENFORCES
 * ───────────────────────────────────────────────────────────────────────────
 * 1. Every number carries a source. `sources[]` is not optional decoration.
 * 2. Every visibility claim carries an `evidence` list and a `confidence`.
 *    A claim I could not establish does not go in `mustBeVisible` or
 *    `mustNotBeVisible` — it goes in `disputed`, which the suite reports but
 *    never fails on.
 * 3. `confidence: 'high'` means the claim is a hard gate. `'medium'` means it
 *    is worth testing but a failure is a prompt to investigate, not proof of a
 *    bug. The acceptance suite must treat the two differently.
 *
 * Angle and height naming follows src/core/types.ts: `elevationM` is a height
 * in metres, `bearingDeg` is a true-north compass angle.
 */

import type { LatLng } from '../../../src/core/types';

/** A citation. `retrieved` is the date the claim was read, ISO-8601. */
export interface Source {
  /** Short label used to reference this source from a claim. */
  id: string;
  title: string;
  url: string;
  retrieved: string;
  /**
   * How the page was read in this environment. The build sandbox blocks direct
   * egress to most hosts, so several sources were read through the web-search
   * index rather than fetched. Recording which is which is part of the point.
   */
  access: 'fetched' | 'via-search-index';
  /** Licence of the source content, where it matters (images especially). */
  licence?: string;
}

export type Confidence = 'high' | 'medium';

/** What kind of argument backs a visibility claim. */
export type EvidenceKind =
  | 'published-claim' // a cited page states it
  | 'multiple-independent-sources'
  | 'own-geometry' // derived here from cited coordinates and elevations
  | 'photographic'; // an openly licensed photo shows it

export interface PeakExpectation {
  /** Name as it should appear in the peaks database (OSM `name` tag). */
  name: string;
  location: LatLng;
  elevationM: number;
  /** Which `Source.id` the coordinate and elevation came from. */
  positionSourceId: string;
  evidence: readonly EvidenceKind[];
  confidence: Confidence;
  /** Why this peak is or is not visible, in the author's own words. */
  rationale: string;
}

/**
 * A claim that could not be settled. Reported, never asserted.
 *
 * It has no `confidence` (there is none to state) and no `rationale`: the
 * `conflict` field replaces it, and must name the sources on each side rather
 * than argue for one of them.
 */
export interface DisputedExpectation
  extends Omit<PeakExpectation, 'confidence' | 'rationale'> {
  /** Summary of the conflict, naming the sources on each side. */
  conflict: string;
}

/** An openly licensed photograph from this viewpoint, if one was found. */
export interface ReferencePhoto {
  url: string;
  licence: string;
  attribution: string;
  note: string;
}

export interface GroundTruthCase {
  id: string;
  title: string;
  /** Where the camera stands. */
  observer: LatLng & {
    /** Terrain height at the observer's coordinate. */
    groundElevationM: number;
    /** Camera above that terrain. */
    eyeHeightM: number;
    /** Uncertainty in `groundElevationM`, metres. Never left implicit. */
    groundElevationUncertaintyM: number;
    /** Which `Source.id` the coordinate came from. */
    positionSourceId: string;
    /** Which `Source.id` the ground elevation came from. */
    elevationSourceId: string;
  };
  /** The direction a photograph from here would face. */
  view: {
    bearingDeg: number;
    /** Why that bearing: what the classic shot from here points at. */
    note: string;
  };
  /**
   * Peaks that MUST come out visible. Hard gate at confidence 'high'.
   * Visibility is a property of the viewpoint, not of the frame, so this list
   * is deliberately independent of `view.bearingDeg` or any field of view.
   */
  mustBeVisible: readonly PeakExpectation[];
  /** Peaks that MUST come out hidden, because terrain occludes them. */
  mustNotBeVisible: readonly PeakExpectation[];
  /** Claims the research could not settle. Reported only. */
  disputed: readonly DisputedExpectation[];
  photos: readonly ReferencePhoto[];
  sources: readonly Source[];
  /** Anything a reader needs to know before trusting this case. */
  caveats: readonly string[];
}
