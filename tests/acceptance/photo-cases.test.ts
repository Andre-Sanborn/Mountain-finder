/**
 * ACCEPTANCE — THE SUPPLIED PHOTOGRAPHS (photo cases)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Two real photographs with real positions, ONE of which now has a measured
 * view bearing. What this file proves, offline, from committed bytes:
 *
 *   1. The photographs are what the cases say they are — dimensions,
 *      orientation, and the ABSENCE of GPS and of `GPSImgDirection` in the
 *      committed JPEGs. That last one is the load-bearing assertion of this
 *      file: it turns "this file carries no bearing" from a claim in a comment
 *      into a checked property of the bytes, so nobody can fill in a plausible
 *      number and leave the prose saying otherwise.
 *
 *      **And its mirror image, added 2026-08-17.** The Railroad Ridge case now
 *      commits the CAMERA ORIGINAL alongside the transcode, and its heading is
 *      re-read from that original's EXIF rather than trusted from the data
 *      file. The absence check and the presence check are the same check run in
 *      opposite directions: a stripped file may not claim a heading, and a case
 *      that claims one must point at bytes that carry it. Note in particular
 *      that the ORIGINAL is asserted to carry every field the transcode is
 *      asserted to lack — swap a stripped file in as the "original" and this
 *      fails rather than passing vacuously.
 *   2. Every number traces to a source, and every source resolves — a URL for
 *      the remote ones, an existing file for the committed ones.
 *   3. The committed SRTM window contains the viewpoint AND the whole sweep it
 *      declares (checked at 72 bearings on the sweep's own outer radius), and
 *      the elevation it reads at the observer agrees with each independently
 *      cited figure within that figure's stated tolerance.
 *   4. The imported peak region really covers the radius each case queries —
 *      asked of `TiledPeakStore.coverageFor`, which answers from the index
 *      before a single cell is read — and the summits each case names are in
 *      that dataset, by id, at the stated coordinates and heights.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ───────────────────────────────────────────────────────────────────────────
 * It runs no pipeline and asserts no visibility. Neither photograph has a
 * confirmed list of summits in frame, and a must-see list derived from the same
 * geometry the pipeline uses would be the pipeline grading its own homework
 * (AGENTS.md "Independent expectations"). The recorded summits are printed at the end of the run,
 * with the reason each is unresolved, and asserted in neither direction — the
 * treatment `disputed` gets in ground-truth-cases.test.ts.
 *
 * The four `GroundTruthCase`s and every gate on them are untouched by this
 * file; the photo cases are a separate list of a separate type.
 */

import { access, stat } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';

import { afterAll, describe, expect, it } from 'vitest';

import {
  destinationPoint,
  greatCircleDistanceM,
  initialBearingDeg,
} from '../../fixtures/scenes';
import { extractPhotoExif } from '../../src/exif';
import type { PhotoExif } from '../../src/exif';
import { loadPeakCellIndex } from '../../src/providers/peak-directory';
import { loadTileWindow } from '../../src/providers/tile-directory';
import { caseTerrainSpec, loadCaseTerrain } from '../../src/pipeline/testing/case-terrain';
import {
  groundTruthCases,
  photoCases,
  type PhotoCase,
  type PhotoExifProbe,
  type RecordedSummit,
} from './cases';

/* ══════════════════════════════════════════════════════════════════════════
 * Shared machinery
 * ══════════════════════════════════════════════════════════════════════════ */

const reportLines: string[] = [];

function report(line: string): void {
  reportLines.push(line);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Sources by id, so a claim's citation can be looked up and checked. */
function sourceIds(photoCase: PhotoCase): ReadonlySet<string> {
  return new Set(photoCase.sources.map((source) => source.id));
}

/** The observer as a bare coordinate, for the geometry kit. */
function origin(photoCase: PhotoCase): { lat: number; lon: number } {
  return { lat: photoCase.observer.lat, lon: photoCase.observer.lon };
}

/**
 * The committed window's own terrain reading at the observer.
 *
 * Cached per case: every elevation assertion below compares against the same
 * single reading, so they cannot disagree with each other about what the DEM
 * says.
 */
const observerReadings = new Map<string, Promise<number>>();

function observerElevationM(photoCase: PhotoCase): Promise<number> {
  const existing = observerReadings.get(photoCase.id);
  if (existing !== undefined) return existing;

  const started = (async (): Promise<number> => {
    const terrain = await loadCaseTerrain(photoCase.terrainWindowCaseId);
    const [reading] = await terrain.elevation.fetchElevations([origin(photoCase)]);
    // `elevationM` is nullable: a void, or a coordinate outside the cut, reads
    // as "no data" rather than as a number. Either would make every elevation
    // assertion below meaningless, so it fails loudly here instead.
    if (reading === undefined || reading.elevationM === null) {
      throw new Error(
        `${photoCase.id}: the committed window has no elevation at the observer ` +
          `(${photoCase.observer.lat}, ${photoCase.observer.lon})`,
      );
    }
    return reading.elevationM;
  })();

  observerReadings.set(photoCase.id, started);
  return started;
}

/* ══════════════════════════════════════════════════════════════════════════
 * The set as a whole
 * ══════════════════════════════════════════════════════════════════════════ */

describe('the supplied photo cases as a set', () => {
  it('holds both supplied photographs, under ids of their own', () => {
    expect(photoCases.length).toBe(2);
    const ids = photoCases.map((photoCase) => photoCase.id);
    expect(new Set(ids).size).toBe(ids.length);

    // A photo case is not a ground-truth case and must never be mistaken for
    // one: no id may appear in both lists, because the two carry different
    // promises about what has been established.
    const groundTruthIds = new Set(groundTruthCases.map((testCase) => testCase.id));
    for (const id of ids) {
      expect(groundTruthIds.has(id), `${id} appears in both case lists`).toBe(false);
    }
  });

  it('leaves the four ground-truth cases exactly as they were', () => {
    // The photo cases must not be able to satisfy — or dilute — any gate the
    // ground-truth set carries. archive/v2-docs-20260929/PLAN.md P6.2 asks for 3 to 5 of those; adding
    // photographs does not change that count.
    expect(groundTruthCases.length).toBe(4);
  });

  it('states a view bearing only where a committed file carries one', () => {
    // The single most important property of this whole file, and the one that
    // had to change carefully when the first real heading arrived. It is NOT
    // "no case has a bearing" any more; it is "a bearing exists exactly where
    // there are bytes to read it out of". A case cannot become measured by
    // someone editing a data file: it needs a committed original whose EXIF is
    // re-read below, in `matches the committed photograph`.
    for (const photoCase of photoCases) {
      const { view } = photoCase;
      expect(view.note.length).toBeGreaterThan(60);

      if (view.measured) {
        expect(typeof view.bearingDeg, `${photoCase.id} measured but has no number`).toBe('number');
        expect(view.bearingDeg).toBeGreaterThanOrEqual(0);
        expect(view.bearingDeg).toBeLessThan(360);
        // A heading whose reference is unknown is not a heading.
        expect(['T', 'M']).toContain(view.bearingRef);
        // …and it must be traceable to a source that is a file in this repo.
        const source = photoCase.sources.find((entry) => entry.id === view.bearingSourceId);
        expect(source, `${photoCase.id}: bearingSourceId names no source`).toBeDefined();
        expect(source?.access).toBe('supplied-by-photographer');
        expect(source?.locator.startsWith('http')).toBe(false);
        // The original must be the file the bearing was read from, and its
        // recorded EXIF must contain that very number — so the case cannot
        // cite one file and quote another's heading.
        expect(photoCase.photo.original?.path).toBe(source?.locator);
        expect(photoCase.photo.original?.exif.imgDirectionDeg).toBe(view.bearingDeg);
        expect(photoCase.photo.original?.exif.imgDirectionRef).toBe(view.bearingRef);
      } else {
        expect(view.bearingDeg, `${photoCase.id} states a view bearing`).toBeNull();
        expect(view.measured).toBe(false);
      }
    }
  });

  it('never lets a bearing this repository COMPUTED become a case\'s ground truth', () => {
    // AGENTS.md "Independent expectations", made executable. `corroborationDeg` is where an
    // independently obtained heading is reported; the danger it carries is that
    // a later edit quietly promotes it into `bearingDeg`, at which point the
    // pipeline is grading its own homework and every gate built on this case
    // becomes worthless while still passing.
    for (const photoCase of photoCases) {
      const { view } = photoCase;
      if (!view.measured || view.corroborationDeg === null) continue;
      expect(
        view.corroborationDeg.bearingDeg,
        `${photoCase.id}: the corroborating heading IS the asserted bearing`,
      ).not.toBe(view.bearingDeg);
      expect(view.corroborationDeg.method.length).toBeGreaterThan(40);
      expect(view.corroborationDeg.note.length).toBeGreaterThan(60);
    }
  });

  it('records visibility as unverified and carries no must-see or must-not-see list', () => {
    for (const photoCase of photoCases) {
      expect(photoCase.visibility.status).toBe('unverified');
      expect(photoCase.visibility.blockedOn.length).toBeGreaterThan(20);

      // Runtime belt to the type-level braces: a `PhotoCase` has no visibility
      // lists at all, and an object cast into one must not smuggle them in.
      const keys = Object.keys(photoCase);
      expect(keys).not.toContain('mustBeVisible');
      expect(keys).not.toContain('mustNotBeVisible');
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * Per case
 * ══════════════════════════════════════════════════════════════════════════ */

describe.each(photoCases.map((photoCase) => [photoCase.id, photoCase] as const))(
  'photo case %s',
  (_id, photoCase) => {
    it('is well formed: a title, a position in range, an eye height and caveats', () => {
      expect(photoCase.title.length).toBeGreaterThan(10);
      expect(photoCase.observer.lat).toBeGreaterThanOrEqual(-90);
      expect(photoCase.observer.lat).toBeLessThanOrEqual(90);
      expect(photoCase.observer.lon).toBeGreaterThan(-180);
      expect(photoCase.observer.lon).toBeLessThanOrEqual(180);
      expect(photoCase.observer.groundElevationM).toBeGreaterThan(-500);
      expect(photoCase.observer.groundElevationM).toBeLessThan(9000);
      expect(photoCase.observer.groundElevationUncertaintyM).toBeGreaterThan(0);
      expect(photoCase.observer.eyeHeightM).toBeGreaterThan(0);
      expect(photoCase.observer.eyeHeightM).toBeLessThan(3);
      // The camera's height above the ground is not known to the centimetre in
      // either case, and saying so is not optional here.
      expect(photoCase.observer.eyeHeightNote.length).toBeGreaterThan(40);
      expect(photoCase.caveats.length).toBeGreaterThan(0);
      for (const caveat of photoCase.caveats) expect(caveat.length).toBeGreaterThan(40);
    });

    it('traces every claim to a source, and every source resolves', async () => {
      const ids = sourceIds(photoCase);
      expect(photoCase.sources.length).toBeGreaterThan(0);
      expect(ids.size).toBe(photoCase.sources.length);

      expect(ids.has(photoCase.observer.positionSourceId)).toBe(true);
      expect(ids.has(photoCase.observer.elevationSourceId)).toBe(true);
      for (const check of photoCase.observer.crossChecks) {
        expect(ids.has(check.sourceId), `cross-check cites "${check.sourceId}"`).toBe(true);
      }
      for (const summit of photoCase.summits) {
        expect(ids.has(summit.sourceId), `${summit.name} cites "${summit.sourceId}"`).toBe(true);
      }

      for (const source of photoCase.sources) {
        expect(source.title.length).toBeGreaterThan(5);
        expect(source.note.length).toBeGreaterThan(20);
        expect(source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);

        if (source.access === 'fetched' || source.access === 'via-search-index') {
          expect(
            source.locator.startsWith('https://'),
            `remote source ${source.id} must carry a URL`,
          ).toBe(true);
        } else {
          // A committed source is a file in this repository, and a citation to
          // a file that is not here is worse than no citation.
          expect(source.locator.startsWith('http')).toBe(false);
          expect(
            await exists(source.locator),
            `source ${source.id} points at ${source.locator}, which is not in the repository`,
          ).toBe(true);
        }
      }
    });

    it('matches the committed photograph, which carries NO bearing and NO GPS', async () => {
      const stats = await stat(photoCase.photo.path);
      expect(stats.size).toBeGreaterThan(0);

      const exif: PhotoExif = await extractPhotoExif(
        new Uint8Array(await readFile(photoCase.photo.path)),
      );

      // What the case says the file is.
      expect(exif.imageWidthPx).toBe(photoCase.photo.widthPx);
      expect(exif.imageHeightPx).toBe(photoCase.photo.heightPx);
      expect(exif.orientation).toBe(photoCase.photo.orientation);

      // What the case says the file is NOT. `imgDirectionDeg` is the one that
      // matters: while it is absent, no bearing in this repository can claim to
      // have come from the photograph.
      for (const field of photoCase.photo.absentFields) {
        expect(
          exif[field],
          `${photoCase.id}: the photograph carries ${field}, which this case says it does not`,
        ).toBeUndefined();
      }
      expect(photoCase.photo.absentFields).toContain('imgDirectionDeg');
      expect(photoCase.photo.absentFields).toContain('lat');
      expect(photoCase.photo.absentFields).toContain('lon');
    });

    it('reads the camera original\'s EXIF out of its own bytes, where one exists', async () => {
      const original = photoCase.photo.original;
      if (original === undefined) {
        // Not a skip that hides anything: a case with no original is a case
        // whose view must therefore be unmeasured, which is asserted here.
        expect(photoCase.view.measured).toBe(false);
        return;
      }

      // HEIC, not JPEG — exifr reads the EXIF item out of the ISO-BMFF meta
      // box. No pixel decoding is involved and no new dependency is needed,
      // which is why the ORIGINAL is what the repository commits: the metadata
      // is readable offline even though the image is not.
      expect(await exists(original.path)).toBe(true);
      const exif: PhotoExif = await extractPhotoExif(new Uint8Array(await readFile(original.path)));

      // Every field the case quotes, compared with the bytes. Exact equality
      // on purpose: these are transcriptions, and a transcription is either
      // right or wrong. Nothing here is a tolerance.
      for (const [field, expected] of Object.entries(original.exif)) {
        expect(
          exif[field as keyof PhotoExifProbe],
          `${photoCase.id}: ${original.path} does not carry ${field} = ${String(expected)}`,
        ).toBe(expected);
      }

      // An original must ADD something, or it is not worth committing.
      expect(Object.keys(original.exif).length).toBeGreaterThan(0);

      // …and every field asserted absent from the derivative must be accounted
      // for exactly once: either the original recovered it, or the original
      // lacks it too and says so. No field may be left unexplained, and none
      // may be claimed both ways.
      for (const field of photoCase.photo.absentFields) {
        const recovered = field in original.exif;
        const alsoAbsent = original.absentFromOriginalToo.includes(field);
        expect(
          `${field}: recovered=${recovered} alsoAbsent=${alsoAbsent}`,
          `${photoCase.id}: ${field} is absent from the photo and the original ` +
            'accounts for it neither way',
        ).toBe(`${field}: recovered=${recovered !== alsoAbsent && recovered} alsoAbsent=${recovered !== alsoAbsent && alsoAbsent}`);
      }

      // The absences, asserted against the bytes. This is what makes "it was
      // never geotagged" a measured fact instead of an assumption.
      for (const field of original.absentFromOriginalToo) {
        expect(
          exif[field],
          `${photoCase.id}: ${original.path} DOES carry ${field} — the case says it does not`,
        ).toBeUndefined();
      }

      // The derivative and the original must at least agree on the frame. This
      // does not prove they are the same picture — `sameImageEvidence` records
      // the pixel comparison that does — but two different shapes would prove
      // they are not, and that check is free.
      expect(exif.imageWidthPx).toBe(photoCase.photo.widthPx);
      expect(exif.imageHeightPx).toBe(photoCase.photo.heightPx);
      expect(exif.orientation).toBe(photoCase.photo.orientation);
      expect(original.sameImageEvidence.length).toBeGreaterThan(80);
    });

    it('places the original\'s own GPS fix and altitude near the case\'s observer', async () => {
      const original = photoCase.photo.original;
      if (original?.exif.lat === undefined || original.exif.lon === undefined) return;

      // A second reading of the same position, from a different instrument
      // than the one that produced `observer`. It is checked LOOSELY and on
      // purpose: this asserts the two describe the same spot on the ridge, not
      // that either is accurate. A coordinate typed wrong by a digit lands
      // kilometres away and fails; a GPS fix a few metres off does not.
      const separationM = greatCircleDistanceM(origin(photoCase), {
        lat: original.exif.lat,
        lon: original.exif.lon,
      });
      expect(
        separationM,
        `${photoCase.id}: the original's GPS fix is ${separationM.toFixed(0)} m from the observer`,
      ).toBeLessThan(100);

      // …and the barometric/GPS altitude against what the committed DEM reads.
      // 60 m is wide because GPS altitude is the weakest number a phone
      // records; it still catches a window cut from the wrong place.
      if (original.exif.gpsAltitudeM === undefined) return;
      const demM = await observerElevationM(photoCase);
      expect(Math.abs(original.exif.gpsAltitudeM - demM)).toBeLessThan(60);
    });

    it('has a committed terrain window that contains the viewpoint and its whole sweep', async () => {
      const spec = caseTerrainSpec(photoCase.terrainWindowCaseId);
      expect(spec, `no terrain window registered for ${photoCase.id}`).toBeDefined();
      if (spec === undefined) return;

      const terrain = await loadCaseTerrain(photoCase.terrainWindowCaseId);
      // Offline by construction: the committed cut, never a 25 MB tile that
      // happens to be in the gitignored data/tiles/.
      expect(terrain.origin).toBe('committed-window');
      expect(terrain.provenance).toContain(spec.sourceTile);

      // The committed bytes must be the ones this spec describes. A window
      // regenerated after the bounds moved, and not re-committed, would read
      // real elevations from the wrong place — the failure mode with no
      // symptoms.
      const { meta, tile } = await loadTileWindow(
        `fixtures/tiles/cases/${photoCase.terrainWindowCaseId}-window.json`,
      );
      expect(meta.source.tile).toBe(spec.sourceTile);
      expect(tile.geometry.northLat).toBeCloseTo(spec.bounds.north, 9);
      expect(tile.geometry.westLon).toBeCloseTo(spec.bounds.west, 9);
      const southLat =
        tile.geometry.northLat - (tile.geometry.rows - 1) * tile.geometry.latStepDeg;
      const eastLon = tile.geometry.westLon + (tile.geometry.cols - 1) * tile.geometry.lonStepDeg;
      expect(southLat).toBeCloseTo(spec.bounds.south, 9);
      expect(eastLon).toBeCloseTo(spec.bounds.east, 9);

      // The viewpoint is inside it…
      expect(photoCase.observer.lat).toBeGreaterThan(spec.bounds.south);
      expect(photoCase.observer.lat).toBeLessThan(spec.bounds.north);
      expect(photoCase.observer.lon).toBeGreaterThan(spec.bounds.west);
      expect(photoCase.observer.lon).toBeLessThan(spec.bounds.east);
      await expect(observerElevationM(photoCase)).resolves.toBeGreaterThan(0);

      // …and so is every ray end of the sweep the window declares. A square cut
      // around a circular sweep is only honest if the corners were checked:
      // 72 bearings at the outer radius, each of which must read real terrain.
      const maxRangeKm = spec.sweep.maxRangeKm;
      expect(maxRangeKm, `${photoCase.id}: the window declares no sweep radius`).toBeDefined();
      if (maxRangeKm === undefined) return;

      const ring = Array.from({ length: 72 }, (_unused, index) =>
        destinationPoint(origin(photoCase), index * 5, maxRangeKm * 1000),
      );
      const samples = await terrain.elevation.fetchElevations(ring);
      expect(samples.length).toBe(ring.length);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = samples[index];
        expect(
          sample !== undefined && Number.isFinite(sample.elevationM),
          `${photoCase.id}: no terrain at ${maxRangeKm} km on bearing ${index * 5} deg — ` +
            'the committed window does not cover the sweep it declares',
        ).toBe(true);
      }

      report(
        `  ${photoCase.id}: window ${tile.geometry.rows}x${tile.geometry.cols} from ` +
          `${meta.source.tile}, sweep ${maxRangeKm} km covered at all 72 test bearings`,
      );
    });

    it('reads an observer elevation that agrees with every cited figure', async () => {
      const terrainM = await observerElevationM(photoCase);
      const citedM = photoCase.observer.groundElevationM;
      const toleranceM = photoCase.observer.groundElevationUncertaintyM;

      report(
        `  ${photoCase.id}: observer ground cited ${citedM} m +-${toleranceM} m, the ` +
          `committed window reads ${terrainM.toFixed(3)} m ` +
          `(${terrainM - citedM >= 0 ? '+' : ''}${(terrainM - citedM).toFixed(3)} m)`,
      );

      expect(
        Math.abs(terrainM - citedM),
        `${photoCase.id}: the window reads ${terrainM.toFixed(3)} m where the case cites ` +
          `${citedM} m +-${toleranceM} m (source: ${photoCase.observer.elevationSourceId})`,
      ).toBeLessThanOrEqual(toleranceM);

      // Each cross-check is a separate, separately-sourced figure with its own
      // tolerance — the whole point being that they do not all come from the
      // same place. Which ones are independent and which are fixture-integrity
      // checks is stated in each `note`, and in the case's caveats.
      expect(photoCase.observer.crossChecks.length).toBeGreaterThan(0);
      for (const check of photoCase.observer.crossChecks) {
        expect(check.note.length).toBeGreaterThan(40);
        report(
          `  ${photoCase.id}: cross-check ${check.sourceId} says ${check.valueM} m ` +
            `+-${check.agreementToleranceM} m — DEM differs by ` +
            `${(terrainM - check.valueM).toFixed(3)} m`,
        );
        expect(
          Math.abs(terrainM - check.valueM),
          `${photoCase.id}: the window reads ${terrainM.toFixed(3)} m against ` +
            `${check.valueM} m from ${check.sourceId} (tolerance ` +
            `${check.agreementToleranceM} m)`,
        ).toBeLessThanOrEqual(check.agreementToleranceM);
      }
    });

    it('queries a peak region that actually covers its query radius', async () => {
      const binding = photoCase.peakDataset;
      const store = await loadPeakCellIndex(binding.indexPath);

      // `coverageFor` answers from the index alone, before a cell is read: the
      // honest answer to "can this dataset even contain what I am asking for".
      const coverage = store.coverageFor({
        center: origin(photoCase),
        radiusKm: binding.queryRadiusKm,
      });

      expect(
        coverage.complete,
        `${photoCase.id}: ${binding.region} does not cover a ${binding.queryRadiusKm} km ` +
          `query from this viewpoint. ${coverage.note ?? ''}`,
      ).toBe(true);
      expect(coverage.cellsHeld).toBe(coverage.cellsSpanned);
      expect(coverage.requestedRadiusKm).toBe(binding.queryRadiusKm);
      const coveredKm = coverage.coveredRadiusKm ?? 0;
      expect(
        coveredKm,
        `${photoCase.id}: covered to ${coveredKm.toFixed(1)} km, query asks for ` +
          `${binding.queryRadiusKm} km`,
      ).toBeGreaterThanOrEqual(binding.queryRadiusKm);

      const within = await store.recordsWithin(origin(photoCase), binding.queryRadiusKm);
      expect(within.length).toBe(binding.namedSummitsWithinRadius);

      report(
        `  ${photoCase.id}: region "${binding.region}" (${store.size} summits, ` +
          `${store.cellNames.length} cells) covers ${coveredKm.toFixed(1)} km around this ` +
          `viewpoint; ${within.length} named summits within ${binding.queryRadiusKm} km`,
      );
    });

    it('names summits that are really in that dataset, where this case says they are', async () => {
      const binding = photoCase.peakDataset;
      const store = await loadPeakCellIndex(binding.indexPath);
      const within = await store.recordsWithin(origin(photoCase), binding.queryRadiusKm);
      const byId = new Map(within.map((sighting) => [sighting.record.id, sighting.record]));

      const spec = caseTerrainSpec(photoCase.terrainWindowCaseId);
      expect(spec).toBeDefined();
      if (spec === undefined) return;

      expect(photoCase.summits.length).toBeGreaterThan(0);
      for (const summit of photoCase.summits) {
        const record = byId.get(summit.peakId);
        expect(
          record,
          `${photoCase.id}: ${summit.name} (${summit.peakId}) is not in the ${binding.region} ` +
            `dataset within ${binding.queryRadiusKm} km`,
        ).toBeDefined();
        if (record === undefined) continue;

        // Ids are the only safe handle — `Cow Hill` is 287 m in Lochaber and
        // 989 m in California — but the name is checked too, so a case cannot
        // quietly point at a different summit than the one it discusses.
        expect(record.name).toBe(summit.name);
        // Compared as a DISTANCE, not digit by digit: these case files record
        // five decimal places (about a metre) while the dataset carries
        // Overture's float32 bbox midpoint in full, so the two differ in the
        // sixth decimal by construction. Two metres is tight enough that a
        // transposed digit — worth 100 m at the fifth decimal — cannot pass.
        expect(
          greatCircleDistanceM(record, summit.location),
          `${photoCase.id}/${summit.name}: recorded at ${summit.location.lat}, ` +
            `${summit.location.lon}; the dataset holds ${record.lat}, ${record.lon}`,
        ).toBeLessThan(2);
        // Tagged height, exactly. Never rounded, never a DEM sample.
        expect(record.elevationM).toBe(summit.elevationM);

        // Geometry: a check of the TRANSCRIPTION into this file, computed by
        // the fixtures' own kit (which never imports src/core) from the
        // dataset's coordinates. It is not independent verification of where
        // the summit is — the case's caveats say so — but it does catch a
        // bearing or a range typed from the wrong row of a table.
        const distanceM = greatCircleDistanceM(origin(photoCase), summit.location);
        expect(
          Math.abs(distanceM / 1000 - summit.distanceKm),
          `${photoCase.id}/${summit.name}: recorded ${summit.distanceKm} km, computed ` +
            `${(distanceM / 1000).toFixed(3)} km`,
        ).toBeLessThan(0.05);

        if (summit.bearingDeg === null) {
          // The only honest reason for a null bearing: the observer is standing
          // on this summit, so there is no direction to state.
          expect(
            distanceM,
            `${photoCase.id}/${summit.name}: bearing is null but the summit is ` +
              `${(distanceM / 1000).toFixed(3)} km away`,
          ).toBeLessThan(50);
        } else {
          expect(distanceM).toBeGreaterThan(50);
          const bearingDeg = initialBearingDeg(origin(photoCase), summit.location);
          expect(
            Math.abs(bearingDeg - summit.bearingDeg),
            `${photoCase.id}/${summit.name}: recorded ${summit.bearingDeg} deg, computed ` +
              `${bearingDeg.toFixed(2)} deg`,
          ).toBeLessThan(0.2);
        }

        // And whether it is inside the committed window, which decides what a
        // future visibility claim about it could possibly rest on.
        const inside =
          summit.location.lat > spec.bounds.south &&
          summit.location.lat < spec.bounds.north &&
          summit.location.lon > spec.bounds.west &&
          summit.location.lon < spec.bounds.east;
        expect(
          inside,
          `${photoCase.id}/${summit.name}: insideTerrainWindow says ` +
            `${summit.insideTerrainWindow}, the window bounds say ${inside}`,
        ).toBe(summit.insideTerrainWindow);
      }
    });

    it('[report-only] records every named summit as UNVERIFIED in the frame', () => {
      // The counterpart of the `disputed` hook in pipeline-hooks.test.ts: the
      // claim is printed, and asserted in neither direction. The only gate is
      // that each recorded summit says WHY it is unresolved — an entry with no
      // reason would be an assertion waiting to be made by accident.
      for (const summit of photoCase.summits) {
        expect(summit.unresolved.length).toBeGreaterThan(60);
        report(
          `  ${photoCase.id} [unverified in frame] ${summitLabel(summit)}` +
            `\n      ${summit.unresolved.slice(0, 150)}`,
        );
      }
      report(
        `  ${photoCase.id} [unverified] blocked on: ${photoCase.visibility.blockedOn.slice(0, 120)}`,
      );
    });
  },
);

function summitLabel(summit: RecordedSummit): string {
  return (
    `${summit.name.padEnd(20)} ${summit.elevationM} m, ` +
    `${summit.distanceKm.toFixed(2)} km, ` +
    `${summit.bearingDeg === null ? 'no bearing (observer stands on it)' : `${summit.bearingDeg.toFixed(1)} deg`}` +
    `, ${summit.insideTerrainWindow ? 'inside' : 'OUTSIDE'} the committed window`
  );
}

afterAll(() => {
  process.stdout.write(
    [
      '',
      '──────────────────────────────────────────────────────────────────────',
      ' PHOTO CASES — WHAT JUST RAN',
      '──────────────────────────────────────────────────────────────────────',
      ` ${photoCases.length} supplied photographs, asserted offline from committed bytes:`,
      '   • the images themselves: dimensions, orientation, and NO GPS and NO',
      '     GPSImgDirection — so "the view bearing is unmeasured" is a measured',
      '     fact, not a note',
      '   • every citation resolves: a URL for remote sources, an existing file',
      '     for committed ones',
      '   • the committed SRTM windows contain the viewpoints and their whole',
      '     declared sweeps (72 bearings each, at the outer radius)',
      '   • observer elevations agree with every independently cited figure',
      '     within that figure\'s own tolerance',
      '   • the idaho-central peak region covers the queried radius, by',
      '     TiledPeakStore.coverageFor, and holds every summit these cases name',
      '',
      ' NOT ASSERTED, DELIBERATELY:',
      '   • which summits are in either frame. No bearing exists for either',
      '     photograph, and deriving a must-see list from the pipeline\'s own',
      '     geometry would make the pipeline its own ground truth.',
      '   • no pipeline runs in this file at all.',
      '',
      ' RECORDED AND REPORTED:',
      ...(reportLines.length === 0 ? ['   (none)'] : reportLines),
      '',
      ' A limited terrain window can produce a false VISIBLE, never a false',
      ' hidden. Both windows here are sized to their viewpoint, not to any',
      ' sightline, because neither case makes a sightline claim.',
      '──────────────────────────────────────────────────────────────────────',
      '',
    ].join('\n'),
  );
});
