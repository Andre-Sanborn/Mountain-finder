/**
 * Schema for the PHOTO ground-truth cases — a real photograph, a real
 * position, and NO view bearing.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SEPARATE TYPE FROM `GroundTruthCase`
 * ───────────────────────────────────────────────────────────────────────────
 * `GroundTruthCase` is built around a claim of the form "from here, that peak
 * is / is not visible", and its schema makes two things mandatory that neither
 * of the supplied Idaho photographs can honestly supply:
 *
 *   1. `view.bearingDeg: number`. Both photographs FIRST arrived with their EXIF
 *      stripped — orientation and pixel dimensions survived, GPS and
 *      `GPSImgDirection` did not (asserted in photo-cases.test.ts, from the
 *      committed files themselves). Any number written in that field would have
 *      been invented, and an invented bearing is exactly the failure mode this
 *      repository keeps designing against.
 *
 *      **Half of that is now fixed, by evidence rather than by relaxing the
 *      rule.** The photographer later supplied the camera ORIGINALS, whose EXIF
 *      survived intact, and the Railroad Ridge frame carries `GPSImgDirection
 *      174.089° T`. So that case's view is a {@link MeasuredView} read out of
 *      committed bytes; the Sunset Mountain lookout frame has no original and
 *      remains an {@link UnmeasuredView}. The schema now expresses both, and
 *      which one a case is remains a change to this file to make.
 *   2. `mustBeVisible` with at least one peak. Nobody has established which
 *      summits are in either frame. Deriving a must-see list from the geometry
 *      would make the pipeline its own ground truth — AGENTS.md "Independent expectations" — and a
 *      case that asserts what the code computes tests nothing.
 *
 * So a photo case asserts only what is independently checkable today:
 *
 *   ASSERTED    the position, its elevation, and the agreement between
 *               independently sourced elevations for it; that the committed
 *               terrain window contains the viewpoint and the whole declared
 *               sweep; that the peak dataset covers the query radius; that the
 *               named summits really are in that dataset where this file says.
 *   RECORDED    which summits stand near the viewpoint, and the fact that
 *               whether any of them is in the frame is UNKNOWN. Recorded in the
 *               same spirit as `DisputedExpectation` in case-types.ts: reported,
 *               never asserted, in neither direction.
 *
 * A photo case is therefore not a weaker ground-truth case. It is a different
 * claim: everything except the frame.
 */

import type { LatLng } from '../../../src/core/types';

/**
 * How a source was read. The first two are new here and matter:
 * a coordinate handed over by the person who pressed the shutter is not a
 * citation anyone else can re-fetch, and a file committed in this repository is
 * not a web page. Both are legitimate; conflating either with "fetched" is not.
 */
export type PhotoSourceAccess =
  | 'supplied-by-photographer'
  | 'committed-in-repository'
  | 'fetched'
  | 'via-search-index';

export interface PhotoSource {
  readonly id: string;
  readonly title: string;
  /**
   * An `https://` URL for a remote source; a repository-relative PATH for a
   * committed one. The suite checks the URL scheme for remote sources and that
   * the file really exists for committed ones, so neither kind can rot quietly.
   */
  readonly locator: string;
  /** ISO-8601 date the source was read. */
  readonly retrieved: string;
  readonly access: PhotoSourceAccess;
  /** What this source actually says, and anything that qualifies it. */
  readonly note: string;
}

/**
 * A second, independently sourced figure for the observer's ground elevation.
 *
 * The suite compares it against what the COMMITTED TERRAIN WINDOW reads at the
 * observer's coordinate. That is the only elevation comparison available
 * offline, and it is a real one: a window cut from the wrong place, or a
 * coordinate off by a kilometre, fails it by tens or hundreds of metres.
 */
export interface ElevationCrossCheck {
  readonly valueM: number;
  readonly sourceId: string;
  /** How far the DEM may sit from `valueM` before this case is wrong, metres. */
  readonly agreementToleranceM: number;
  /**
   * What the comparison does and does not establish — in particular whether the
   * two figures are genuinely independent of each other.
   */
  readonly note: string;
}

export interface PhotoObserver extends LatLng {
  /** Terrain height at the observer's coordinate, from `elevationSourceId`. */
  readonly groundElevationM: number;
  /** Uncertainty in that height, metres. Never left implicit. */
  readonly groundElevationUncertaintyM: number;
  /** Camera above that terrain. */
  readonly eyeHeightM: number;
  /** What is known and not known about the camera's height above the ground. */
  readonly eyeHeightNote: string;
  readonly positionSourceId: string;
  readonly elevationSourceId: string;
  readonly crossChecks: readonly ElevationCrossCheck[];
}

/**
 * The direction the camera faced, when nothing establishes it.
 *
 * `bearingDeg` is typed `null`, not `number | null`, deliberately: filling it in
 * has to be a change to this type and therefore a change a reviewer sees, not a
 * one-line edit to a data file that quietly turns a guess into ground truth.
 *
 * **That change has now happened once**, and the mechanism worked as designed —
 * see {@link MeasuredView}. It was not a guess being promoted: the photographer
 * supplied the ORIGINAL HEIC of the Railroad Ridge frame, whose EXIF carries
 * `GPSImgDirection`. The JPEG that had been committed until then was a
 * transcode that dropped the GPS IFD entirely, which is why this type existed.
 */
export interface UnmeasuredView {
  readonly bearingDeg: null;
  readonly measured: false;
  /** Why there is no bearing, and what would produce one. */
  readonly note: string;
  /**
   * An arc the photographed terrain plausibly lies in, or `null` when even that
   * cannot be said. NEVER ASSERTED and never used as a bearing: it records
   * where the mountains are, which is not evidence of where the camera pointed.
   */
  readonly plausibleArcDeg: {
    readonly fromDeg: number;
    readonly toDeg: number;
    readonly basis: string;
  } | null;
}

/**
 * The direction the camera faced, READ OUT OF THE FILE.
 *
 * The only admissible origin for `bearingDeg` is a `GPSImgDirection` tag in a
 * committed image, cited by `bearingSourceId` and re-read from those bytes by
 * the suite. It may not be typed in from a map, recalled by the photographer,
 * or — above all — produced by this repository's own aligner: a case that
 * carried a computed heading would be the pipeline grading its own homework,
 * which AGENTS.md "Independent expectations" forbids.
 *
 * `corroborationDeg` exists to keep that separation legible. It records what
 * an independent method got, purely as a reported number; nothing derives from
 * it and no gate consults it.
 */
export interface MeasuredView {
  readonly bearingDeg: number;
  readonly measured: true;
  /**
   * `'T'` = referenced to true north, i.e. the writer already applied magnetic
   * declination; `'M'` = magnetic, and a declination correction is still owed
   * before the number may be compared with a computed bearing. Never assumed:
   * a heading whose reference is unknown is not a heading.
   */
  readonly bearingRef: 'T' | 'M';
  /** Id of the source this number was read from. Must be a committed image. */
  readonly bearingSourceId: string;
  /**
   * Uncertainty in degrees, or `null` where none is established. `null` is the
   * honest entry for a phone magnetometer: vendors publish no figure, and
   * inventing ±10° because it sounds like the right order of magnitude would be
   * exactly the invented precision this schema is built to prevent.
   */
  readonly uncertaintyDeg: number | null;
  /**
   * What an INDEPENDENT method obtained for the same frame, reported only.
   * Never asserted, never averaged in, never used to narrow `uncertaintyDeg`.
   */
  readonly corroborationDeg: {
    readonly bearingDeg: number;
    readonly method: string;
    readonly note: string;
  } | null;
  readonly note: string;
}

/** What the committed photograph's EXIF actually contains — and lacks. */
export interface PhotoMetadata {
  /** Repository-relative path to the committed image. */
  readonly path: string;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly orientation: number;
  /**
   * EXIF fields the file does NOT carry, asserted absent by the suite. The
   * presence of `imgDirectionDeg` in this list is what makes "the bearing is
   * unmeasured" a checked fact rather than a claim in a comment.
   */
  readonly absentFields: readonly (keyof PhotoExifProbe)[];
  readonly note: string;
  /**
   * The camera original this file was transcoded from, where one was supplied.
   *
   * This exists because of a specific and repeatable failure: a phone JPEG that
   * has been through a share sheet or a messaging app keeps its orientation and
   * pixel dimensions and loses the entire GPS IFD — position, altitude and
   * `GPSImgDirection` together. The image looks identical and the metadata that
   * makes it usable is gone. `absentFields` above is a true statement about
   * THIS file and a misleading one about the photograph, and this block is what
   * separates the two.
   */
  readonly original?: PhotoOriginal;
}

/** A camera original, and the EXIF the suite re-reads out of its bytes. */
export interface PhotoOriginal {
  /** Repository-relative path to the committed original. */
  readonly path: string;
  /**
   * Fields the ORIGINAL carries, asserted present AND equal by the suite. Every
   * number a case takes from EXIF must appear here, so no such number can drift
   * away from the bytes it claims to have come from.
   */
  readonly exif: PhotoExifProbe;
  /**
   * Fields absent from the original TOO, asserted absent.
   *
   * This half was added when the Sunset Mountain original arrived and turned
   * out to carry its lens and NOT its position — the first schema assumed an
   * original recovers everything the transcode lost, and that assumption was
   * simply wrong. Recording it this way makes "the photograph was never
   * geotagged" a checked fact about committed bytes rather than a note, which
   * is the difference between a closed question and an unasked one.
   *
   * The suite requires every entry of `PhotoMetadata.absentFields` to appear
   * in exactly one of these two lists, so a case cannot quietly leave a field
   * unaccounted for.
   */
  readonly absentFromOriginalToo: readonly (keyof PhotoExifProbe)[];
  /**
   * How it was established that the original and the committed derivative are
   * the same photograph. Without this the original's EXIF is metadata for some
   * other picture, and its heading would be worse than no heading at all.
   */
  readonly sameImageEvidence: string;
  readonly note: string;
}

/** The subset of `PhotoExif` this schema makes claims about. */
export interface PhotoExifProbe {
  lat?: number;
  lon?: number;
  gpsAltitudeM?: number;
  imgDirectionDeg?: number;
  imgDirectionRef?: 'T' | 'M';
  focalLengthMm?: number;
  focalLength35mmMm?: number;
  hFovDeg?: number;
  vFovDeg?: number;
}

/**
 * A summit that the peak dataset holds near this viewpoint.
 *
 * Every field is a transcription from a committed dataset, and the suite checks
 * it against that dataset. What it does NOT do — cannot do — is say whether the
 * summit is in the photograph; see {@link RecordedSummit.unresolved}.
 */
export interface DatasetSummit {
  /** OSM `name`, carried through Overture. Names repeat; see `peakId`. */
  readonly name: string;
  /** The dataset's stable id. The only safe way to refer to a summit. */
  readonly peakId: string;
  readonly location: LatLng;
  /** Tagged height. Never a DEM sample (MISSION.md). */
  readonly elevationM: number;
  /**
   * True-north bearing from the observer, or `null` when the observer stands on
   * the summit itself and there is no direction to state.
   */
  readonly bearingDeg: number | null;
  readonly distanceKm: number;
  readonly sourceId: string;
  /** Whether the summit falls inside the committed terrain window's bounds. */
  readonly insideTerrainWindow: boolean;
}

/** A summit recorded near the viewpoint, with the reason it is not asserted. */
export interface RecordedSummit extends DatasetSummit {
  /**
   * Why this is neither in a must-see list nor in a must-not-see list. It
   * replaces `PeakExpectation.rationale`, in the way `DisputedExpectation`
   * replaces it with `conflict`: there is no argument to make yet.
   */
  readonly unresolved: string;
}

/** Which imported peak region answers this case's queries. */
export interface PeakDatasetBinding {
  /** Directory name under `fixtures/peaks/regions/`. */
  readonly region: string;
  /** Repository-relative path to the region's `index.json`. */
  readonly indexPath: string;
  /** The radius the case queries, and the radius coverage is asserted for. */
  readonly queryRadiusKm: number;
  /** How many named summits the dataset holds inside that radius. */
  readonly namedSummitsWithinRadius: number;
}

/**
 * The state of the visibility question. There is exactly one legal value today,
 * which is the point: a photo case cannot express "this peak is visible".
 */
export interface VisibilityStatus {
  readonly status: 'unverified';
  /** What has to exist before any visibility claim can be made. */
  readonly blockedOn: string;
  readonly note: string;
}

export interface PhotoCase {
  readonly id: string;
  readonly title: string;
  readonly photo: PhotoMetadata;
  /** The `CaseTerrainSpec.caseId` whose committed window backs this case. */
  readonly terrainWindowCaseId: string;
  readonly observer: PhotoObserver;
  readonly view: UnmeasuredView | MeasuredView;
  readonly peakDataset: PeakDatasetBinding;
  /** Summits near the viewpoint. Recorded, never asserted to be in frame. */
  readonly summits: readonly RecordedSummit[];
  readonly visibility: VisibilityStatus;
  readonly sources: readonly PhotoSource[];
  /** Anything a reader needs to know before trusting this case. */
  readonly caveats: readonly string[];
}
