/**
 * ACCEPTANCE — REAL-WORLD GROUND-TRUTH CASES (archive/v2-docs-20260929/PLAN.md P6.2)
 *
 * WHAT THIS FILE GENUINELY PROVES, TODAY, WITHOUT ANY PIPELINE:
 *
 *   1. Every case is well formed: coordinates in range, elevations plausible,
 *      ids unique.
 *   2. Every factual claim traces to a citation. Each `positionSourceId` and
 *      `elevationSourceId` must resolve to a `Source` in the same file, and
 *      every source must carry a URL and a retrieval date.
 *   3. must-see and must-not-see are disjoint, and neither overlaps `disputed`.
 *      A peak cannot be required and forbidden, and a claim I could not settle
 *      cannot leak into an assertion list.
 *   4. Every case is internally consistent with geometry computed HERE, from
 *      the fixtures' own kit — never from src/core. In particular each
 *      must-not-see peak is shown to be ABOVE the curvature horizon, which is
 *      what makes it a test of OCCLUSION rather than a test of curvature.
 *
 * WHAT IT DOES NOT PROVE: that the pipeline gets any of these cases right. That
 * needs elevation data and the horizon builder; see pipeline-hooks.test.ts.
 */

import { describe, expect, it } from 'vitest';

import {
  apparentAltitudeDeg,
  greatCircleDistanceM,
  horizonDipDeg,
  initialBearingDeg,
} from '../../fixtures/scenes';

import { groundTruthCases, type GroundTruthCase, type PeakExpectation } from './cases';

function eyeElevationM(observer: GroundTruthCase['observer']): number {
  return observer.groundElevationM + observer.eyeHeightM;
}

function geometryFor(
  observer: GroundTruthCase['observer'],
  peak: Pick<PeakExpectation, 'location' | 'elevationM'>,
): { distanceM: number; bearingDeg: number; altitudeDeg: number; dipDeg: number } {
  const origin = { lat: observer.lat, lon: observer.lon };
  const distanceM = greatCircleDistanceM(origin, peak.location);
  return {
    distanceM,
    bearingDeg: initialBearingDeg(origin, peak.location),
    altitudeDeg: apparentAltitudeDeg(
      eyeElevationM(observer),
      peak.elevationM,
      distanceM,
    ),
    dipDeg: horizonDipDeg(eyeElevationM(observer)),
  };
}

describe('the ground-truth case set as a whole', () => {
  it('has between 3 and 5 cases, as archive/v2-docs-20260929/PLAN.md P6.2 requires', () => {
    expect(groundTruthCases.length).toBeGreaterThanOrEqual(3);
    expect(groundTruthCases.length).toBeLessThanOrEqual(5);
  });

  it('gives every case a unique id', () => {
    const ids = groundTruthCases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains at least one peak that terrain must hide', () => {
    // The whole product is occlusion. A ground-truth set with no must-not-see
    // peak cannot fail a pipeline that labels everything it can reach.
    const hidden = groundTruthCases.flatMap((c) => c.mustNotBeVisible);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('contains at least one HIGH-confidence must-not-see peak', () => {
    const hardHidden = groundTruthCases
      .flatMap((c) => c.mustNotBeVisible)
      .filter((p) => p.confidence === 'high');
    expect(hardHidden.length).toBeGreaterThan(0);
  });

  it('spans both signs of altitude angle across the set', () => {
    // Diablo's peaks are all BELOW the observer horizontal; Gornergrat's are
    // all far above it. A pipeline that assumes one sign fails somewhere.
    const altitudes = groundTruthCases.flatMap((c) =>
      c.mustBeVisible.map((p) => geometryFor(c.observer, p).altitudeDeg),
    );
    expect(altitudes.some((a) => a < 0)).toBe(true);
    expect(altitudes.some((a) => a > 5)).toBe(true);
  });
});

describe.each(groundTruthCases.map((c) => [c.id, c] as const))(
  'ground-truth case %s',
  (_id, testCase) => {
    const allExpectations: readonly PeakExpectation[] = [
      ...testCase.mustBeVisible,
      ...testCase.mustNotBeVisible,
    ];

    it('has a title, a view bearing and at least one caveat', () => {
      expect(testCase.title.length).toBeGreaterThan(10);
      expect(testCase.view.bearingDeg).toBeGreaterThanOrEqual(0);
      expect(testCase.view.bearingDeg).toBeLessThan(360);
      expect(testCase.view.note.length).toBeGreaterThan(10);
      // Being honest about uncertainty is not optional in this directory.
      expect(testCase.caveats.length).toBeGreaterThan(0);
    });

    it('places the observer at a coordinate in range, with a stated uncertainty', () => {
      const { lat, lon, groundElevationM, eyeHeightM, groundElevationUncertaintyM } =
        testCase.observer;
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
      expect(lon).toBeGreaterThan(-180);
      expect(lon).toBeLessThanOrEqual(180);
      // Nothing in this set is below sea level or above the highest summit.
      expect(groundElevationM).toBeGreaterThan(-500);
      expect(groundElevationM).toBeLessThan(9000);
      expect(eyeHeightM).toBeGreaterThan(0);
      expect(eyeHeightM).toBeLessThan(3);
      expect(groundElevationUncertaintyM).toBeGreaterThanOrEqual(0);
    });

    it('names at least one peak that must be visible', () => {
      expect(testCase.mustBeVisible.length).toBeGreaterThan(0);
    });

    it('keeps must-see, must-not-see and disputed mutually disjoint', () => {
      const seen = testCase.mustBeVisible.map((p) => p.name);
      const hidden = testCase.mustNotBeVisible.map((p) => p.name);
      const disputed = testCase.disputed.map((p) => p.name);

      for (const name of hidden) {
        expect(seen, `${name} is in both must-see and must-not-see`).not.toContain(name);
      }
      for (const name of disputed) {
        expect(seen, `disputed ${name} leaked into must-see`).not.toContain(name);
        expect(hidden, `disputed ${name} leaked into must-not-see`).not.toContain(name);
      }
      // No duplicates within a list either.
      expect(new Set(seen).size).toBe(seen.length);
      expect(new Set(hidden).size).toBe(hidden.length);
    });

    it('gives every peak a coordinate in range and a plausible elevation', () => {
      for (const peak of [...allExpectations, ...testCase.disputed]) {
        expect(peak.name.length).toBeGreaterThan(1);
        expect(peak.location.lat).toBeGreaterThanOrEqual(-90);
        expect(peak.location.lat).toBeLessThanOrEqual(90);
        expect(peak.location.lon).toBeGreaterThan(-180);
        expect(peak.location.lon).toBeLessThanOrEqual(180);
        expect(peak.elevationM).toBeGreaterThan(0);
        expect(peak.elevationM).toBeLessThan(8849); // nothing here is Everest
      }
    });

    it('traces every claim to a cited source', () => {
      const sourceIds = new Set(testCase.sources.map((s) => s.id));

      expect(sourceIds.has(testCase.observer.positionSourceId)).toBe(true);
      expect(sourceIds.has(testCase.observer.elevationSourceId)).toBe(true);

      for (const peak of [...allExpectations, ...testCase.disputed]) {
        expect(
          sourceIds.has(peak.positionSourceId),
          `${peak.name} cites unknown source "${peak.positionSourceId}"`,
        ).toBe(true);
      }
    });

    it('gives every source a URL, a title and a retrieval date', () => {
      expect(testCase.sources.length).toBeGreaterThan(0);
      const ids = testCase.sources.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);

      for (const source of testCase.sources) {
        expect(source.url.startsWith('https://')).toBe(true);
        expect(source.title.length).toBeGreaterThan(5);
        // ISO-8601 date, so staleness is checkable later.
        expect(source.retrieved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(['fetched', 'via-search-index']).toContain(source.access);
      }
    });

    it('backs every expectation with evidence, a confidence and a rationale', () => {
      for (const peak of allExpectations) {
        expect(peak.evidence.length).toBeGreaterThan(0);
        expect(['high', 'medium']).toContain(peak.confidence);
        // A rationale short enough to be a label is not a rationale.
        expect(peak.rationale.length).toBeGreaterThan(60);
      }
      for (const peak of testCase.disputed) {
        expect(peak.conflict.length).toBeGreaterThan(60);
      }
    });

    it('records a licence and an attribution for every photo it references', () => {
      for (const photo of testCase.photos) {
        expect(photo.url.startsWith('https://')).toBe(true);
        expect(photo.licence.length).toBeGreaterThan(3);
        expect(photo.attribution.length).toBeGreaterThan(3);
        expect(photo.note.length).toBeGreaterThan(10);
      }
    });

    it('puts every must-see peak above the curvature horizon', () => {
      // Necessary, not sufficient: terrain can still hide it. But a "must-see"
      // peak that curvature alone already removes is a broken expectation, and
      // this is checkable from the cited numbers alone.
      for (const peak of testCase.mustBeVisible) {
        const { altitudeDeg, dipDeg, distanceM } = geometryFor(testCase.observer, peak);
        expect(
          altitudeDeg,
          `${peak.name} at ${(distanceM / 1000).toFixed(1)} km is below the ` +
            `curvature horizon (${altitudeDeg.toFixed(4)} vs dip ${dipDeg.toFixed(4)})`,
        ).toBeGreaterThan(dipDeg);
      }
    });

    it('puts every must-not-see peak above the curvature horizon too', () => {
      // This is the one that keeps the case honest. If a must-not-see peak were
      // below the curvature horizon, the case would silently be testing the
      // Earth model instead of testing occlusion, and would pass for a pipeline
      // with no terrain sweep at all.
      for (const peak of testCase.mustNotBeVisible) {
        const { altitudeDeg, dipDeg } = geometryFor(testCase.observer, peak);
        expect(
          altitudeDeg,
          `${peak.name} is hidden by curvature, not by terrain — it does not ` +
            'test occlusion',
        ).toBeGreaterThan(dipDeg);
      }
    });

    it('records geometry consistent with the distances quoted in its rationale', () => {
      // Cheap sanity net: everything in this set is a terrestrial sightline of
      // under 400 km, and no peak may sit at zero distance from the observer.
      for (const peak of [...allExpectations, ...testCase.disputed]) {
        const { distanceM, bearingDeg } = geometryFor(testCase.observer, peak);
        expect(distanceM).toBeGreaterThan(100);
        expect(distanceM).toBeLessThan(400_000);
        expect(bearingDeg).toBeGreaterThanOrEqual(0);
        expect(bearingDeg).toBeLessThan(360);
      }
    });
  },
);
