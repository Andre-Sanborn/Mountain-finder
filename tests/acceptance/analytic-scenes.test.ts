/**
 * ACCEPTANCE — SYNTHETIC ANALYTIC SCENES (archive/v2-docs-20260929/PLAN.md P6.1)
 *
 * WHAT THIS FILE GENUINELY PROVES, TODAY, WITHOUT ANY PIPELINE:
 *
 *   1. The fixtures' own geometry kit is correct, checked against answers that
 *      are exact by construction (1° of latitude, a quarter circumference to
 *      the pole) and by round-tripping destination against distance.
 *   2. Each scene's closed-form expectation matches arithmetic done BY HAND and
 *      written out in the scene module — the literals below were typed from
 *      those longhand chains, not pasted from a program's output.
 *   3. Two independent Earth models (exact spherical atan2 vs the surveying
 *      curvature-drop form) agree on every expectation to better than 0.002°,
 *      so no expectation here is an artefact of one modelling choice.
 *   4. The generators emit terrain that actually contains the features the
 *      expectations are about, sampled exactly where the maths assumes.
 *   5. A brute-force scan of the generated terrain — using no pipeline code —
 *      recovers the same skyline the closed form predicts.
 *
 * WHAT IT DOES NOT PROVE: anything at all about src/core. See
 * pipeline-hooks.test.ts for the assertions waiting on Waves 2–3.
 */

import { describe, expect, it } from 'vitest';

import {
  analyticScenes,
  apparentAltitudeDeg,
  apparentAltitudeDegPlaneDrop,
  conicalPeakBruteForceRayMaximum,
  conicalPeakScene,
  destinationPoint,
  EARTH_MEAN_RADIUS_M,
  EFFECTIVE_EARTH_RADIUS_M,
  eyeElevationM,
  flatPlaneBruteForceSkyline,
  flatPlaneScene,
  greatCircleDistanceM,
  initialBearingDeg,
  REFRACTION_COEFFICIENT_K,
  twinRidgesFarHiddenScene,
  twinRidgesFarVisibleScene,
  type SyntheticScene,
} from '../../fixtures/scenes';

import {
  CONE_APEX_BEARING_DEG,
  CONE_APEX_DISTANCE_M,
  CONE_APEX_ELEVATION_M,
  CONE_APEX_OCCLUDER,
  CONE_BASE_RADIUS_M,
  CONE_EXPECTED_APEX_ALTITUDE_DEG,
  CONE_EXPECTED_APEX_OCCLUDING_ALTITUDE_DEG,
  CONE_EXPECTED_APEX_OCCLUDING_PLANE_DROP_DEG,
  CONE_PLAIN_BEARING_DEG,
  FAR_RIDGE_CREST_HIDDEN_M,
  FAR_RIDGE_CREST_VISIBLE_M,
  FAR_RIDGE_DISTANCE_M,
  FLAT_PLANE_EXPECTED_DIP_DEG,
  FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG,
  FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M,
  FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M,
  NEAR_RIDGE_CREST_M,
  NEAR_RIDGE_DISTANCE_M,
  TWIN_RIDGES_PLAIN_ELEVATION_M,
  TWIN_RIDGES_PRIMARY_BEARING_DEG,
} from '../../fixtures/scenes';

/**
 * Angles typed out from the longhand arithmetic in the scene modules' headers.
 * All of these are the CURVATURE-DROP form, because that is the one that can be
 * carried through by hand with an atan series. Each is checked to 1e-5°.
 */
const HAND_DERIVED_DEG = {
  flatPlaneDipExact: -0.299427,
  flatPlaneDipDropModel: -0.299429,
  nearRidge: 4.554485,
  farRidgeVisibleVariant: 5.349262,
  farRidgeHiddenVariant: 4.211342,
  // The terrain standing in FRONT of each crest — the maximum over samples
  // strictly nearer than it. Derived longhand in twin-ridges.ts's header.
  inFrontOfNearCrest: 3.590565,
  inFrontOfFarCrestVisibleVariant: 4.734353,
  coneApex: 8.481293,
  conePlainDip: -0.042346,
  // The cone's own flank at 9750 m — the only terrain in front of the apex.
  // Derived longhand in conical-peak.ts's DERIVATION 4.
  inFrontOfConeApex: 7.978309,
} as const;

/** How far the two Earth models may disagree before a scene is untrustworthy. */
const MODEL_AGREEMENT_TOLERANCE_DEG = 0.002;

describe('fixture geometry kit — checked against exactly-known answers', () => {
  it('derives the effective radius symbolically from R and k, not from a copied decimal', () => {
    expect(EARTH_MEAN_RADIUS_M).toBe(6_371_008.8);
    expect(REFRACTION_COEFFICIENT_K).toBe(0.13);
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeCloseTo(
      EARTH_MEAN_RADIUS_M / (1 - REFRACTION_COEFFICIENT_K),
      9,
    );
    // ~7 323 km, NOT ~7 314 km. Guards against a wrong constant being pasted in.
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeGreaterThan(7_322_000);
    expect(EFFECTIVE_EARTH_RADIUS_M).toBeLessThan(7_324_000);
  });

  const oneDegreeOfArcM = (EARTH_MEAN_RADIUS_M * Math.PI) / 180;

  it('destinationPoint: due north by one degree of arc lands one degree north', () => {
    const p = destinationPoint({ lat: 0, lon: 0 }, 0, oneDegreeOfArcM);
    expect(p.lat).toBeCloseTo(1, 10);
    expect(p.lon).toBeCloseTo(0, 10);
  });

  it('destinationPoint: due east along the equator by one degree of arc lands one degree east', () => {
    const p = destinationPoint({ lat: 0, lon: 0 }, 90, oneDegreeOfArcM);
    expect(p.lat).toBeCloseTo(0, 10);
    expect(p.lon).toBeCloseTo(1, 10);
  });

  it('destinationPoint: a quarter circumference due north from the equator reaches the pole', () => {
    const p = destinationPoint(
      { lat: 0, lon: 0 },
      0,
      (EARTH_MEAN_RADIUS_M * Math.PI) / 2,
    );
    expect(p.lat).toBeCloseTo(90, 8);
  });

  it('destinationPoint and greatCircleDistanceM are mutual inverses', () => {
    const origin = { lat: 47, lon: 11 };
    for (const bearingDeg of [0, 37, 90, 180, 271, 359]) {
      for (const distanceM of [250, 5_000, 20_000, 60_000, 250_000]) {
        const p = destinationPoint(origin, bearingDeg, distanceM);
        expect(greatCircleDistanceM(origin, p)).toBeCloseTo(distanceM, 4);
      }
    }
  });

  it('initialBearingDeg recovers the bearing destinationPoint was given', () => {
    const origin = { lat: 47, lon: 11 };
    for (const bearingDeg of [0, 37, 90, 180, 271, 359]) {
      const p = destinationPoint(origin, bearingDeg, 20_000);
      expect(initialBearingDeg(origin, p)).toBeCloseTo(bearingDeg, 6);
    }
  });

  it('the two Earth models agree on a spread of geometries', () => {
    for (const [eyeM, targetM, distanceM] of [
      [500, 900, 5_000],
      [500, 2_400, 20_000],
      [2, 1_500, 10_000],
      [1_174.6, 3_187, 291_900],
    ] as const) {
      const exactDeg = apparentAltitudeDeg(eyeM, targetM, distanceM);
      const dropDeg = apparentAltitudeDegPlaneDrop(eyeM, targetM, distanceM);
      expect(Math.abs(exactDeg - dropDeg)).toBeLessThan(MODEL_AGREEMENT_TOLERANCE_DEG);
    }
  });
});

describe('every analytic scene is internally well-formed', () => {
  it('exposes four scenes with unique ids', () => {
    expect(analyticScenes).toHaveLength(4);
    const ids = analyticScenes.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const scene of analyticScenes) {
    describe(scene.id, () => {
      it('states a derivation, a tolerance and at least one expectation', () => {
        expect(scene.derivation.length).toBeGreaterThan(80);
        expect(scene.toleranceDeg).toBeGreaterThan(0);
        expect(scene.distanceToleranceM).toBeGreaterThan(0);
        expect(scene.expectedSkyline.length).toBeGreaterThan(0);
      });

      it('generates exactly the samples its sampling description implies', () => {
        const samples = scene.generateSamples();
        const { bearingStepDeg, rangeStepM, maxRangeM } = scene.sampling;
        const expectedCount =
          1 + Math.round(360 / bearingStepDeg) * Math.round(maxRangeM / rangeStepM);
        expect(samples).toHaveLength(expectedCount);
      });

      it('generates samples whose elevations match the analytic terrain', () => {
        // Every sample must be reproducible from the scene's own terrain
        // function. If the generator drifted from the analytic definition, the
        // expectations would describe terrain the pipeline never sees.
        const samples = scene.generateSamples();
        for (let index = 0; index < samples.length; index += 977) {
          const sample = samples[index];
          expect(sample).toBeDefined();
          if (sample === undefined) continue;
          expect(sample.elevationM).toBeCloseTo(scene.elevationAtM(sample), 9);
          expect(Number.isFinite(sample.lat)).toBe(true);
          expect(Number.isFinite(sample.lon)).toBe(true);
          expect(Math.abs(sample.lat)).toBeLessThanOrEqual(90);
          expect(Math.abs(sample.lon)).toBeLessThanOrEqual(180);
        }
      });

      it('places every sample within the declared maximum range', () => {
        const samples = scene.generateSamples();
        const origin = { lat: scene.observer.lat, lon: scene.observer.lon };
        for (let index = 0; index < samples.length; index += 1361) {
          const sample = samples[index];
          if (sample === undefined) continue;
          expect(greatCircleDistanceM(origin, sample)).toBeLessThanOrEqual(
            scene.sampling.maxRangeM + 1,
          );
        }
      });

      it('agrees with itself across the two Earth models', () => {
        for (const point of scene.expectedSkyline) {
          expect(
            Math.abs(point.altitudeDeg - point.altitudeDegPlaneDrop),
          ).toBeLessThan(MODEL_AGREEMENT_TOLERANCE_DEG);
        }
      });

      it('declares peak verdicts consistent with its own closed-form angles', () => {
        for (const verdict of scene.expectedPeakVerdicts) {
          const peak = scene.peaks.find((candidate) => candidate.id === verdict.peakId);
          expect(peak, `verdict references unknown peak ${verdict.peakId}`).toBeDefined();
          if (peak === undefined) continue;

          // Recompute the peak's angle from its own coordinate rather than
          // trusting the number recorded alongside it.
          const distanceM = greatCircleDistanceM(
            { lat: scene.observer.lat, lon: scene.observer.lon },
            peak,
          );
          const recomputedDeg = apparentAltitudeDeg(
            eyeElevationM(scene.observer),
            peak.elevationM,
            distanceM,
          );
          expect(recomputedDeg).toBeCloseTo(verdict.peakAltitudeDeg, 6);

          // `visible` must follow from the angles, never be asserted alongside
          // numbers that contradict it.
          const clearance = verdict.peakAltitudeDeg - verdict.occludingAltitudeDeg;
          expect(clearance).toBeCloseTo(verdict.clearanceDeg, 9);
          expect(verdict.visible).toBe(clearance >= 0);
          expect(verdict.reason.length).toBeGreaterThan(20);
        }
      });
    });
  }
});

describe('scene 1 — flat plane: the horizon dip is the geometric one', () => {
  it('matches the hand-derived tangent-line dip', () => {
    expect(FLAT_PLANE_EXPECTED_DIP_DEG).toBeCloseTo(
      HAND_DERIVED_DEG.flatPlaneDipExact,
      5,
    );
  });

  it('matches the hand-derived drop-model optimum, by a different derivation', () => {
    expect(FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG).toBeCloseTo(
      HAND_DERIVED_DEG.flatPlaneDipDropModel,
      5,
    );
  });

  it('reconciles the tangent construction and the calculus optimum to 1e-5 deg', () => {
    expect(
      Math.abs(FLAT_PLANE_EXPECTED_DIP_DEG - FLAT_PLANE_EXPECTED_DIP_SMALL_ANGLE_DEG),
    ).toBeLessThan(1e-5);
  });

  it('puts the horizon at 38.27 km by both routes', () => {
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M / 1000).toBeCloseTo(38.27, 2);
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M / 1000).toBeCloseTo(38.27, 2);
    // Rule of thumb for k = 0.13: d(km) = 3.827 * sqrt(h(m)).
    expect(FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_SMALL_ANGLE_M / 1000).toBeCloseTo(
      3.827 * Math.sqrt(100),
      2,
    );
  });

  it('is identical at every expected bearing (rotational symmetry)', () => {
    const altitudes = flatPlaneScene.expectedSkyline.map((p) => p.altitudeDeg);
    for (const altitudeDeg of altitudes) {
      expect(altitudeDeg).toBeCloseTo(FLAT_PLANE_EXPECTED_DIP_DEG, 12);
    }
    // One expectation deliberately sits between sampling rays, to exercise the
    // profile interpolation of P1.3 when it exists.
    expect(
      flatPlaneScene.expectedSkyline.some((p) => !Number.isInteger(p.bearingDeg)),
    ).toBe(true);
  });

  it('is recovered by brute force over the generated terrain, using no pipeline code', () => {
    const found = flatPlaneBruteForceSkyline();
    expect(found.altitudeDeg).toBeCloseTo(FLAT_PLANE_EXPECTED_DIP_DEG, 4);
    expect(
      Math.abs(found.distanceM - FLAT_PLANE_EXPECTED_HORIZON_DISTANCE_M),
    ).toBeLessThanOrEqual(flatPlaneScene.distanceToleranceM);
  });

  it('generates a perfectly flat terrain, so relief cannot be the answer', () => {
    const samples = flatPlaneScene.generateSamples();
    const elevations = new Set(samples.map((s) => s.elevationM));
    expect(elevations).toEqual(new Set([0]));
  });
});

describe('scene 2 — twin ridges: angle decides visibility, not height', () => {
  const observerPoint = {
    lat: twinRidgesFarVisibleScene.observer.lat,
    lon: twinRidgesFarVisibleScene.observer.lon,
  };
  const eyeM = eyeElevationM(twinRidgesFarVisibleScene.observer);

  it('puts the observer eye at exactly 500 m, as the hand arithmetic assumes', () => {
    expect(eyeM).toBeCloseTo(500, 9);
  });

  it('matches the hand-derived near-ridge angle', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.nearRidge, 5);
  });

  it('matches the hand-derived far-ridge angles in both variants', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, FAR_RIDGE_CREST_VISIBLE_M, FAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.farRidgeVisibleVariant, 5);
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, FAR_RIDGE_CREST_HIDDEN_M, FAR_RIDGE_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.farRidgeHiddenVariant, 5);
  });

  it('variant A: the far ridge wins the skyline by 0.79 deg', () => {
    const nearDeg = apparentAltitudeDeg(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M);
    const farDeg = apparentAltitudeDeg(eyeM, FAR_RIDGE_CREST_VISIBLE_M, FAR_RIDGE_DISTANCE_M);
    expect(farDeg).toBeGreaterThan(nearDeg);
    expect(farDeg - nearDeg).toBeCloseTo(0.7936, 3);

    const [skyline] = twinRidgesFarVisibleScene.expectedSkyline;
    expect(skyline).toBeDefined();
    expect(skyline?.altitudeDeg).toBeCloseTo(farDeg, 9);
    expect(skyline?.distanceM).toBe(FAR_RIDGE_DISTANCE_M);
  });

  it('variant B: the far ridge is 1100 m HIGHER and still loses by 0.34 deg', () => {
    const nearDeg = apparentAltitudeDeg(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M);
    const farDeg = apparentAltitudeDeg(eyeM, FAR_RIDGE_CREST_HIDDEN_M, FAR_RIDGE_DISTANCE_M);

    expect(FAR_RIDGE_CREST_HIDDEN_M - NEAR_RIDGE_CREST_M).toBe(1100);
    expect(farDeg).toBeLessThan(nearDeg);
    expect(nearDeg - farDeg).toBeCloseTo(0.3437, 3);

    const [skyline] = twinRidgesFarHiddenScene.expectedSkyline;
    expect(skyline).toBeDefined();
    expect(skyline?.altitudeDeg).toBeCloseTo(nearDeg, 9);
    expect(skyline?.distanceM).toBe(NEAR_RIDGE_DISTANCE_M);
  });

  it('states the occlusion verdicts the two variants exist to test', () => {
    const visibleVerdict = twinRidgesFarVisibleScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/far-crest'),
    );
    const hiddenVerdict = twinRidgesFarHiddenScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/far-crest'),
    );
    expect(visibleVerdict?.visible).toBe(true);
    expect(hiddenVerdict?.visible).toBe(false);
  });

  const rangeStepM = twinRidgesFarVisibleScene.sampling.rangeStepM;
  /** Ground range of the last sample before the near crest: 5 000 − 250 m. */
  const inFrontOfNearCrestDistanceM = NEAR_RIDGE_DISTANCE_M - rangeStepM;
  /** Ground range of the last sample before the far crest: 20 000 − 250 m. */
  const inFrontOfFarCrestDistanceM = FAR_RIDGE_DISTANCE_M - rangeStepM;

  it('generates the flank samples that stand in front of each crest', () => {
    // Triangular flanks, so the elevations are exact fractions:
    //   4 750 m: 498.4 + (900 − 498.4)·(1 − 250/1 000) = 498.4 + 301.2 = 799.6
    //  19 750 m: 498.4 + (2400 − 498.4)·(1 − 250/2 000) = 498.4 + 1663.9 = 2162.3
    const inFrontOfNearCrest = destinationPoint(
      observerPoint,
      TWIN_RIDGES_PRIMARY_BEARING_DEG,
      inFrontOfNearCrestDistanceM,
    );
    const inFrontOfFarCrest = destinationPoint(
      observerPoint,
      TWIN_RIDGES_PRIMARY_BEARING_DEG,
      inFrontOfFarCrestDistanceM,
    );
    expect(twinRidgesFarVisibleScene.elevationAtM(inFrontOfNearCrest)).toBeCloseTo(799.6, 6);
    expect(twinRidgesFarVisibleScene.elevationAtM(inFrontOfFarCrest)).toBeCloseTo(2162.3, 6);
  });

  it('matches the hand-derived angles of the terrain in front of each crest', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, 799.6, inFrontOfNearCrestDistanceM),
    ).toBeCloseTo(HAND_DERIVED_DEG.inFrontOfNearCrest, 5);
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, 2162.3, inFrontOfFarCrestDistanceM),
    ).toBeCloseTo(HAND_DERIVED_DEG.inFrontOfFarCrestVisibleVariant, 5);
    // Both are BELOW the crest they stand in front of, which is what makes the
    // crests visible at all.
    expect(HAND_DERIVED_DEG.inFrontOfNearCrest).toBeLessThan(HAND_DERIVED_DEG.nearRidge);
    expect(HAND_DERIVED_DEG.inFrontOfFarCrestVisibleVariant).toBeLessThan(
      HAND_DERIVED_DEG.farRidgeVisibleVariant,
    );
  });

  it('PROMOTED: variant A asserts the near crest is VISIBLE in front of the taller ridge', () => {
    // This assertion used to read `expect(nearVerdict).toBeUndefined()`. Ground
    // truth withheld a verdict here because P1.5 compared every peak against
    // the skyline — a maximum over ALL distances — and so called a summit
    // standing in FRONT of a taller ridge hidden. P1.5 now compares a peak only
    // against terrain NEARER than itself, so the case has an unambiguous
    // answer and ground truth states it.
    const nearVerdict = twinRidgesFarVisibleScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/near-crest'),
    );
    expect(nearVerdict).toBeDefined();
    expect(nearVerdict?.visible).toBe(true);

    // It is genuinely below the skyline — that is what made the case hard.
    const [skyline] = twinRidgesFarVisibleScene.expectedSkyline;
    expect(nearVerdict?.peakAltitudeDeg ?? Infinity).toBeLessThan(skyline?.altitudeDeg ?? 0);
    expect(
      (skyline?.altitudeDeg ?? 0) - (nearVerdict?.peakAltitudeDeg ?? 0),
    ).toBeCloseTo(0.7936, 3);

    // And it is measured against what actually stands in front of it: the
    // near ridge's own inner flank, recomputed here from the scene's geometry
    // kit rather than trusted from the verdict.
    expect(nearVerdict?.occludingAltitudeDeg).toBeCloseTo(
      apparentAltitudeDeg(eyeM, 799.6, inFrontOfNearCrestDistanceM),
      9,
    );
    // Cross-checked against the independent longhand (curvature-drop) chain.
    expect(
      Math.abs((nearVerdict?.occludingAltitudeDeg ?? NaN) - HAND_DERIVED_DEG.inFrontOfNearCrest),
    ).toBeLessThan(MODEL_AGREEMENT_TOLERANCE_DEG);
    expect(nearVerdict?.clearanceDeg ?? 0).toBeGreaterThan(0.96);
  });

  it('asserts the near crest in variant B too, on the same footing', () => {
    // Nothing about the far ridge is in front of the near crest, so the verdict
    // and the occluding angle are identical in both variants.
    const a = twinRidgesFarVisibleScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/near-crest'),
    );
    const b = twinRidgesFarHiddenScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/near-crest'),
    );
    expect(b?.visible).toBe(true);
    expect(b?.occludingAltitudeDeg).toBeCloseTo(a?.occludingAltitudeDeg ?? NaN, 12);
    expect(b?.clearanceDeg).toBeCloseTo(a?.clearanceDeg ?? NaN, 12);
  });

  it('leaves the far crest in variant B measured against the skyline, unchanged', () => {
    // BACKWARD COMPATIBILITY. The far crest is beyond every piece of terrain
    // that forms the skyline at its bearing, so "highest thing nearer than the
    // peak" and "the skyline" are the same maximum — the near crest at 5 km.
    // The corrected rule must not move this verdict by so much as a rounding.
    const farVerdict = twinRidgesFarHiddenScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/far-crest'),
    );
    const [skyline] = twinRidgesFarHiddenScene.expectedSkyline;
    expect(farVerdict?.visible).toBe(false);
    expect(skyline?.distanceM).toBe(NEAR_RIDGE_DISTANCE_M);
    expect(farVerdict?.occludingAltitudeDeg).toBeCloseTo(skyline?.altitudeDeg ?? NaN, 12);
    expect(farVerdict?.occludingAltitudeDeg).toBeCloseTo(
      apparentAltitudeDeg(eyeM, NEAR_RIDGE_CREST_M, NEAR_RIDGE_DISTANCE_M),
      12,
    );
    expect(farVerdict?.clearanceDeg ?? 0).toBeCloseTo(-0.3437, 3);
  });

  it('generates terrain containing both crests at the assumed ranges', () => {
    for (const [scene, farCrestM] of [
      [twinRidgesFarVisibleScene, FAR_RIDGE_CREST_VISIBLE_M],
      [twinRidgesFarHiddenScene, FAR_RIDGE_CREST_HIDDEN_M],
    ] as const) {
      const samples = scene.generateSamples();
      const maxElevationM = samples.reduce((best, s) => Math.max(best, s.elevationM), 0);
      expect(maxElevationM).toBeCloseTo(Math.max(NEAR_RIDGE_CREST_M, farCrestM), 6);

      const crest = destinationPoint(
        observerPoint,
        TWIN_RIDGES_PRIMARY_BEARING_DEG,
        NEAR_RIDGE_DISTANCE_M,
      );
      expect(scene.elevationAtM(crest)).toBeCloseTo(NEAR_RIDGE_CREST_M, 6);
    }
  });

  it('keeps the plain below the eye, so only a ridge can ever be the skyline', () => {
    // Samples ON the plain, i.e. off both ridges. Flank samples sit between the
    // plain and a crest and are legitimately above the eye — they are part of
    // the ridge, not part of the plain.
    const samples = twinRidgesFarVisibleScene.generateSamples();
    const plainSamples = samples.filter(
      (s) => Math.abs(s.elevationM - TWIN_RIDGES_PLAIN_ELEVATION_M) < 1e-9,
    );
    expect(plainSamples.length).toBeGreaterThan(1000);
    for (const sample of plainSamples) {
      expect(sample.elevationM).toBeLessThan(eyeM);
    }

    // The stronger statement: every point of the plain subtends a NEGATIVE
    // angle, so no amount of plain can compete with either crest.
    for (
      let distanceM = twinRidgesFarVisibleScene.sampling.rangeStepM;
      distanceM <= twinRidgesFarVisibleScene.sampling.maxRangeM;
      distanceM += twinRidgesFarVisibleScene.sampling.rangeStepM
    ) {
      expect(
        apparentAltitudeDeg(eyeM, TWIN_RIDGES_PLAIN_ELEVATION_M, distanceM),
      ).toBeLessThan(0);
    }
  });
});

describe('scene 3 — conical peak: the apex angle is closed form', () => {
  const eyeM = eyeElevationM(conicalPeakScene.observer);

  it('matches the hand-derived apex angle', () => {
    expect(
      apparentAltitudeDegPlaneDrop(eyeM, CONE_APEX_ELEVATION_M, CONE_APEX_DISTANCE_M),
    ).toBeCloseTo(HAND_DERIVED_DEG.coneApex, 5);
  });

  it('matches the hand-derived bare-plain dip 135 deg away', () => {
    const plainExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_PLAIN_BEARING_DEG,
    );
    expect(plainExpectation).toBeDefined();
    expect(plainExpectation?.altitudeDegPlaneDrop).toBeCloseTo(
      HAND_DERIVED_DEG.conePlainDip,
      5,
    );
  });

  it('keeps the flank steeper than the sightline, so the apex is the maximum', () => {
    const apexExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_APEX_BEARING_DEG,
    );
    expect(apexExpectation).toBeDefined();
    const tanAlpha = Math.tan(((apexExpectation?.altitudeDeg ?? 0) * Math.PI) / 180);
    expect(tanAlpha).toBeLessThan(0.5); // flank slope = 1500/3000
  });

  it('is recovered by brute force along the apex ray, using no pipeline code', () => {
    const found = conicalPeakBruteForceRayMaximum(CONE_APEX_BEARING_DEG);
    expect(found.distanceM).toBe(CONE_APEX_DISTANCE_M);
    expect(found.elevationM).toBeCloseTo(CONE_APEX_ELEVATION_M, 6);
    const apexExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_APEX_BEARING_DEG,
    );
    expect(found.altitudeDeg).toBeCloseTo(apexExpectation?.altitudeDeg ?? NaN, 9);
  });

  it('falls back to the bare-plain horizon away from the cone', () => {
    const found = conicalPeakBruteForceRayMaximum(CONE_PLAIN_BEARING_DEG);
    expect(found.elevationM).toBe(0);
    const plainExpectation = conicalPeakScene.expectedSkyline.find(
      (p) => p.bearingDeg === CONE_PLAIN_BEARING_DEG,
    );
    expect(found.altitudeDeg).toBeCloseTo(plainExpectation?.altitudeDeg ?? NaN, 4);
    expect(
      Math.abs(found.distanceM - (plainExpectation?.distanceM ?? 0)),
    ).toBeLessThanOrEqual(conicalPeakScene.distanceToleranceM);
  });

  it('measures the apex against the terrain in FRONT of it, not against itself', () => {
    /**
     * The corrected P1.5 rule (see conical-peak.ts DERIVATION 4 and
     * twin-ridges.ts): a peak is occluded only by terrain strictly NEARER than
     * itself. The apex forms the skyline, so measuring it against the skyline
     * makes it its own occluder and pins the clearance at exactly zero — the
     * superseded rule this fixture used to encode.
     *
     * What is actually in front of the apex is the cone's own flank at
     * 10 000 − 250 = 9 750 m, whose height the analytic terrain fixes exactly:
     *   E = 1500 · (1 − 250/3000) = 1375 m
     *   c = 9750² / (2 × 7 322 998.6207) = 6.490681 m
     *   tan α = (1375 − 2 − 6.490681)/9750 = 0.140154802 → α = 7.978309°
     * (drop model, longhand; 7.976826° under the exact sphere model).
     */
    expect(CONE_APEX_OCCLUDER.distanceM).toBe(CONE_APEX_DISTANCE_M - conicalPeakScene.sampling.rangeStepM);
    expect(CONE_APEX_OCCLUDER.elevationM).toBeCloseTo(
      CONE_APEX_ELEVATION_M * (1 - conicalPeakScene.sampling.rangeStepM / CONE_BASE_RADIUS_M),
      9,
    );
    expect(CONE_APEX_OCCLUDER.elevationM).toBeCloseTo(1375, 9);

    // Both Earth models, against the hand-derived figures.
    expect(CONE_EXPECTED_APEX_OCCLUDING_PLANE_DROP_DEG).toBeCloseTo(
      HAND_DERIVED_DEG.inFrontOfConeApex,
      5,
    );
    expect(CONE_EXPECTED_APEX_OCCLUDING_ALTITUDE_DEG).toBeCloseTo(7.976826, 5);

    const verdict = conicalPeakScene.expectedPeakVerdicts.find((v) =>
      v.peakId.endsWith('/apex'),
    );
    expect(verdict).toBeDefined();
    expect(verdict?.visible).toBe(true);
    expect(verdict?.occludingAltitudeDeg).toBeCloseTo(CONE_EXPECTED_APEX_OCCLUDING_ALTITUDE_DEG, 12);

    // The apex is NOT its own occluder, and the clearance is not zero.
    expect(verdict?.occludingAltitudeDeg).not.toBeCloseTo(CONE_EXPECTED_APEX_ALTITUDE_DEG, 3);
    expect(verdict?.clearanceDeg ?? 0).toBeCloseTo(0.50275, 5);
    // 50x the scene's own declared tolerance, in the safe direction.
    expect(verdict?.clearanceDeg ?? 0).toBeGreaterThan(conicalPeakScene.toleranceDeg * 50);
  });

  it('separates the two expectations by three orders of magnitude in angle', () => {
    // 8.48 deg against -0.042 deg in one scene: a pipeline cannot fudge a
    // constant that satisfies both.
    const [apex, plain] = conicalPeakScene.expectedSkyline;
    expect(apex).toBeDefined();
    expect(plain).toBeDefined();
    expect((apex?.altitudeDeg ?? 0) / Math.abs(plain?.altitudeDeg ?? 1)).toBeGreaterThan(150);
  });
});

describe('the scene set collectively covers the failure modes it is meant to', () => {
  const scenes: readonly SyntheticScene[] = analyticScenes;

  it('includes at least one scene whose skyline is below horizontal', () => {
    expect(
      scenes.some((s) => s.expectedSkyline.some((p) => p.altitudeDeg < 0)),
    ).toBe(true);
  });

  it('includes at least one scene whose skyline is well above horizontal', () => {
    expect(
      scenes.some((s) => s.expectedSkyline.some((p) => p.altitudeDeg > 5)),
    ).toBe(true);
  });

  it('includes a provably hidden peak and a provably visible one', () => {
    const verdicts = scenes.flatMap((s) => s.expectedPeakVerdicts);
    expect(verdicts.some((v) => v.visible)).toBe(true);
    expect(verdicts.some((v) => !v.visible)).toBe(true);
  });
});
