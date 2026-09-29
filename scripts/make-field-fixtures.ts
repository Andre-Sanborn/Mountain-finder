/**
 * Build the committed field fixtures under `fixtures/field/`.
 *
 *   npm run field:fixtures
 *
 * It writes `aligned-bundle.json`, `aligned-truth.json`, `stray-bundle.json`
 * and `stray-truth.json`, and nothing else. It reads no file, opens no socket
 * and takes no argument, so a run on any machine writes the same four files.
 * The randomness is one seeded generator started from {@link SEED}.
 *
 * ── WHAT THE TWO PAIRS ARE FOR ─────────────────────────────────────────────
 * `aligned` is an app inside the registered error budget: every criterion its
 * data reaches passes or reports `no-sample`. `stray` carries three deliberate
 * errors and fails exactly `F3.far`, `F5a` and `F5c`. `fixtures/field/README.md`
 * holds the verdict tables and what each error breaks.
 *
 * ── THE NOISE MODEL ────────────────────────────────────────────────────────
 * The magnitudes are the per-term 1σ figures of
 * `docs/FIELD-TEST-PREREGISTRATION.md` § 1.5, and the model is that section's
 * own decomposition rather than an invention here.
 *
 * Each summit is drawn ONE error for the whole session — its own position and
 * height error, the field-of-view scale error at its offset, and the roll of the
 * hold. Call it `a_i`. It is carried unchanged into every capture the summit
 * appears in, which is what makes it cancel where the budget says it cancels.
 *
 * A capture's injected residual is then
 *
 *   before-drag:  a_i + r                       r is one raw pointing offset,
 *                                               common to every summit, standing
 *                                               for the compass bias the drag has
 *                                               not yet removed
 *   after-drag:   (a_i − a_anchor) + d          d is that drag's own precision,
 *                                               one draw shared by every summit
 *                                               in the capture
 *   moved:        (a_i − a_anchor) + d + m_i    d is the REFERENCE capture's draw,
 *                                               because a moved capture carries
 *                                               the trim round the movement
 *                                               without re-dragging; m_i is what
 *                                               the movement itself adds
 *
 * So F3 reads `(a_i − a_anchor) + d` and F4's paired change is exactly `m_i`:
 * the summit's own error and the drag both cancel in the difference, as § 2.4
 * says they do. The anchor summit's own residual is `d` alone, which is the
 * drag precision § 1.6 asks the field session to measure.
 *
 * ── WHY EVERY GRADED UNIT IS INSIDE 2σ ─────────────────────────────────────
 * Every draw is Gaussian, truncated at {@link CLAMP_SIGMA} of its own term. A
 * residual is a sum of such terms, and `atan(Σ f·tan θ_j) ≤ Σ θ_j` because the
 * tangent is convex, so the residual's angle is at most `CLAMP_SIGMA` times the
 * LINEAR sum of the row's terms. The limits are 2σ of their RSS, and beyond 3 km
 * § 1.4 puts the linear sum at 1.69 to 1.93 times the RSS, so 0.8 × linear sits
 * under 2 × RSS with margin.
 *
 * That argument covers F2 and F3. It does not cover F4, whose statistic is a
 * difference of two angles read at two different frame offsets: the same pixel
 * error is worth less angle away from the optical axis, so a change carries a
 * second-order term the linear bound does not see. So the generator computes
 * every graded unit's residual and every paired change itself, from the pixels
 * it injected and the pinhole relation, and refuses to write a file whose unit
 * sits outside its pre-registered limit. The arithmetic is the fixture's
 * guarantee; the grader is never consulted.
 *
 * ── PRIVACY ────────────────────────────────────────────────────────────────
 * `AGENTS.md` § "Captures from the phone": these documents carry no geolocation
 * field, no latitude, no longitude, no bearing and no wall clock. Timestamps are
 * milliseconds from the start of the session, which is what the synthesiser
 * emits. A capture says one thing about its fix, `horizontalAccuracyM`, under
 * the bundle's declared convention. `npm run check:privacy` enforces it.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  synthesiseFieldBundle,
  type SynthCapture,
  type SynthSpec,
  type SynthSummit,
} from '../src/live/field-analysis.js';

/* ── the frame, and what a pixel is worth ────────────────────────────────── */

const FRAME_WIDTH_PX = 1920;
const HFOV_DEG = 73.74;
/** f = (1920/2) / tan(73.74°/2) = 1279.995 px. */
const FOCAL_PX = FRAME_WIDTH_PX / 2 / Math.tan((HFOV_DEG / 2) * (Math.PI / 180));

const pxForDeg = (deg: number): number => FOCAL_PX * Math.tan(deg * (Math.PI / 180));
const degForPx = (px: number): number => Math.atan(px / FOCAL_PX) * (180 / Math.PI);

/* ── the § 1.5 budget terms, per-axis 1σ in degrees ──────────────────────── */

/** `sqrt(20² + observer²)` metres of horizontal geodesy, over the distance. */
const PEAK_POSITION_M = 20;
/** `sqrt(5.5² + 10²)` metres: summit height and the DEM-ground observer height. */
const VERTICAL_GEODESY_M = Math.sqrt(5.5 ** 2 + 10 ** 2);
/** The term 3a fallback when a capture reports no fix accuracy. */
const UNREPORTED_OBSERVER_M = 15;
/** A W3C 95 % radius is 2.4477 per-axis σ (term 3a). */
const ACCURACY_TO_SIGMA = 2.4477;

const FOV_SCALE_DEG = { h: 0.275, v: 0.039 } as const;
const ROLL_DEG = { h: 0.034, v: 0.322 } as const;
const DRAG_DEG = 0.543;
/** § 2.4's RSS for the paired change: what a movement adds and nothing else. */
const MOVEMENT_DEG = { h: 0.304, v: 0.472 } as const;

/** Every draw is truncated here, in units of its own term's 1σ. */
const CLAMP_SIGMA = 0.8;

const RADIANS_TO_DEGREES = 180 / Math.PI;

const observerSigmaM = (accuracyM: number | undefined): number =>
  accuracyM === undefined ? UNREPORTED_OBSERVER_M : accuracyM / ACCURACY_TO_SIGMA;

/** The § 1.5 row for one summit: its own terms, per axis, in degrees. */
function summitTerms(
  distanceKm: number,
  accuracyM: number | undefined,
): { readonly h: readonly number[]; readonly v: readonly number[] } {
  const metres = distanceKm * 1000;
  const horizontalM = Math.sqrt(PEAK_POSITION_M ** 2 + observerSigmaM(accuracyM) ** 2);
  return {
    h: [(horizontalM / metres) * RADIANS_TO_DEGREES, FOV_SCALE_DEG.h, ROLL_DEG.h],
    v: [(VERTICAL_GEODESY_M / metres) * RADIANS_TO_DEGREES, FOV_SCALE_DEG.v, ROLL_DEG.v],
  };
}

/* ── the seeded generator ────────────────────────────────────────────────── */

/** Change this and every committed fixture changes. It is not a tuning knob. */
const SEED = 20_260_929;

/** mulberry32: 32 bits of state, uniform on [0, 1). */
function uniformStream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/**
 * Standard normal by Box–Muller, truncated at {@link CLAMP_SIGMA}.
 *
 * Truncation is resampling rather than clipping: clipping would pile the tail
 * onto the boundary and make the extreme draw the commonest one.
 */
function normalStream(uniform: () => number): () => number {
  return () => {
    for (;;) {
      const u = Math.max(uniform(), Number.MIN_VALUE);
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
      if (Math.abs(z) <= CLAMP_SIGMA) return z;
    }
  };
}

/* ── the summits the two fixtures draw ───────────────────────────────────── */

interface SummitFacts {
  readonly summitId: string;
  readonly name: string;
  readonly elevationM: number;
  readonly altitudeDeg: number;
}

const TRINITY: SummitFacts = {
  summitId: 'overture/91830abb-987b-3e66-9c17-856ce9b0ca5e',
  name: 'Trinity Mountain',
  elevationM: 2880,
  altitudeDeg: 6.1,
};
const SHAFER: SummitFacts = {
  summitId: 'overture/daf0b989-7a13-36e1-b4d0-b4ebfecf1e4c',
  name: 'Shafer Butte',
  elevationM: 2308,
  altitudeDeg: 4.1,
};
const MORES: SummitFacts = {
  summitId: 'overture/f2a82749-a0cb-3cea-b08c-c3d2d6e87938',
  name: 'Mores Mountain',
  elevationM: 2202,
  altitudeDeg: 2.8,
};
const JACKSON: SummitFacts = {
  summitId: 'overture/c72b4af9-b589-392c-9a35-02880fb5bff9',
  name: 'Jackson Peak',
  elevationM: 2471,
  altitudeDeg: 5.2,
};
const DEER: SummitFacts = {
  summitId: 'overture/bb7147e9-f16f-3d21-a0cb-a60a47cc8873',
  name: 'Deer Point',
  elevationM: 2150,
  altitudeDeg: 1.2,
};

const DEER_LANDMARK = 'the crest under the tallest mast, not its tip';
/** Both annotators pick 3 px apart, which is 0.134° — under § 2.0's 0.30°. */
const ANNOTATOR_SPLIT_PX = { xPx: 3, yPx: 0 } as const;

/* ── one session's draws ─────────────────────────────────────────────────── */

interface Offset {
  readonly xPx: number;
  readonly yPx: number;
}

const ZERO: Offset = { xPx: 0, yPx: 0 };
const add = (...offsets: readonly Offset[]): Offset => ({
  xPx: offsets.reduce((sum, offset) => sum + offset.xPx, 0),
  yPx: offsets.reduce((sum, offset) => sum + offset.yPx, 0),
});
const minus = (offset: Offset): Offset => ({ xPx: -offset.xPx, yPx: -offset.yPx });
const round = (offset: Offset): Offset => ({
  xPx: Math.round(offset.xPx * 1e6) / 1e6,
  yPx: Math.round(offset.yPx * 1e6) / 1e6,
});

/** One draw per term, summed in pixels. */
function drawTerms(normal: () => number, terms: { h: readonly number[]; v: readonly number[] }): Offset {
  return {
    xPx: terms.h.reduce((sum, sigma) => sum + pxForDeg(normal() * sigma), 0),
    yPx: terms.v.reduce((sum, sigma) => sum + pxForDeg(normal() * sigma), 0),
  };
}

/**
 * The session's draws: one carried error per summit, one drag per after-drag
 * capture, one movement term per summit per moved capture.
 */
class Session {
  private readonly normal: () => number;
  private readonly carried = new Map<string, Offset>();
  private readonly drags = new Map<string, Offset>();

  constructor(seed: number) {
    this.normal = normalStream(uniformStream(seed));
  }

  /** The one error this summit carries into every capture it appears in. */
  carry(summit: SummitFacts, distanceKm: number, accuracyM: number | undefined): Offset {
    const held = this.carried.get(summit.summitId);
    if (held !== undefined) return held;
    const drawn = drawTerms(this.normal, summitTerms(distanceKm, accuracyM));
    this.carried.set(summit.summitId, drawn);
    return drawn;
  }

  /** One drag's precision, shared by every summit in the capture it settled. */
  drag(captureId: string): Offset {
    const held = this.drags.get(captureId);
    if (held !== undefined) return held;
    const drawn = drawTerms(this.normal, { h: [DRAG_DEG], v: [DRAG_DEG] });
    this.drags.set(captureId, drawn);
    return drawn;
  }

  /** What one movement adds to one summit, over and above the pair it shares. */
  movement(): Offset {
    return drawTerms(this.normal, { h: [MOVEMENT_DEG.h], v: [MOVEMENT_DEG.v] });
  }
}

/* ── checking the draws against the budget before they are written ───────── */

const FRAME_CENTRE = { xPx: FRAME_WIDTH_PX / 2, yPx: 884 / 2 } as const;

/**
 * The residual a marker carries, as the frame angles the grader reads.
 *
 * The frame angle of a pixel is `atan((px − centre) / f)` about the optical
 * axis, so a residual is the difference of two of them. Computing it here from
 * the injected pixels is what makes the expectations independent of the grader.
 */
function residualDeg(truthPx: Offset, errorPx: Offset): { across: number; down: number } {
  return {
    across:
      degForPx(truthPx.xPx + errorPx.xPx - FRAME_CENTRE.xPx) -
      degForPx(truthPx.xPx - FRAME_CENTRE.xPx),
    down:
      degForPx(truthPx.yPx + errorPx.yPx - FRAME_CENTRE.yPx) -
      degForPx(truthPx.yPx - FRAME_CENTRE.yPx),
  };
}

function assertInsideLimit(label: string, valueDeg: number, limitDeg: number): void {
  if (Math.abs(valueDeg) >= limitDeg) {
    throw new Error(
      `${label}: the injected pixels are worth ${valueDeg.toFixed(3)}°, which is not inside the ` +
        `${limitDeg.toFixed(2)}° limit. The fixture would no longer represent an app inside budget.`,
    );
  }
}

/* ── the aligned pair ────────────────────────────────────────────────────── */

/** § 2.3's recomputed k = 1 limits at the accuracy the aligned captures report. */
const ALIGNED_ACCURACY_M = 8.4;
/** 2σ H / 2σ V, § 2.3, recomputed for the reported accuracy and rounded to 0.05°. */
const ALIGNED_LIMITS = {
  near: { h: 2.05, v: 1.55 },
  far: { h: 1.7, v: 1.45 },
} as const;
/** § 2.4's paired-change limits, which no distance moves. */
const MOVEMENT_LIMITS = { h: 0.6, v: 0.95 } as const;
/** § 2.2 gates F2 on the band the capture displayed, half-width. */
const ALIGNED_RAW_BAND_DEG = 8.7;
/** One raw pointing offset, standing for the compass bias before the drag. */
const RAW_POINTING_PX = { xPx: 55, yPx: 12 } as const;

function alignedPair(): { bundle: unknown; truth: unknown } {
  const session = new Session(SEED);
  const accuracy = ALIGNED_ACCURACY_M;
  const carry = (summit: SummitFacts, distanceKm: number): Offset =>
    session.carry(summit, distanceKm, accuracy);

  const distances = new Map<string, number>([
    [TRINITY.summitId, 55],
    [SHAFER.summitId, 12],
    [MORES.summitId, 9],
    [JACKSON.summitId, 15],
    [DEER.summitId, 2],
  ]);
  const distanceOf = (summit: SummitFacts): number => distances.get(summit.summitId) ?? 0;

  // Drawn in the order the captures draw them, so the stream is stable.
  const order = [TRINITY, SHAFER, MORES, JACKSON, DEER];
  for (const summit of order) carry(summit, distanceOf(summit));

  const anchorCarry = carry(TRINITY, distanceOf(TRINITY));
  const drag = session.drag('c2');

  /** Before the drag: the summit's own error, plus one pointing offset. */
  const rawError = (summit: SummitFacts): Offset =>
    round(add(carry(summit, distanceOf(summit)), RAW_POINTING_PX));

  /** After the drag: the anchor's error is subtracted, the drag is added. */
  const settledError = (summit: SummitFacts, movement: Offset = ZERO): Offset =>
    round(add(carry(summit, distanceOf(summit)), minus(anchorCarry), drag, movement));

  const drawn = (
    summit: SummitFacts,
    truthPx: { xPx: number; yPx: number },
    errorPx: Offset,
    extra: Partial<SynthSummit> = {},
  ): SynthSummit => ({
    summitId: summit.summitId,
    name: summit.name,
    elevationM: summit.elevationM,
    distanceKm: distanceOf(summit),
    altitudeDeg: summit.altitudeDeg,
    truthPx,
    errorPx,
    annotatorSplitPx: ANNOTATOR_SPLIT_PX,
    ...extra,
  });

  const captures: SynthCapture[] = [
    {
      captureId: 'c1',
      role: 'before-drag',
      horizontalAccuracyM: accuracy,
      // The vertical term is unquantified until the tilt zero point is
      // measured (§ 2.2), so F2 records that axis rather than gating it.
      band: {
        horizontalDeg: ALIGNED_RAW_BAND_DEG,
        verticalDeg: 1.5,
        hasUnquantifiedHorizontal: false,
        hasUnquantifiedVertical: true,
      },
      summits: [
        drawn(TRINITY, { xPx: 520, yPx: 300 }, rawError(TRINITY)),
        drawn(SHAFER, { xPx: 1040, yPx: 370 }, rawError(SHAFER)),
        drawn(MORES, { xPx: 1310, yPx: 410 }, rawError(MORES), {
          truthCannotIdentify: 'second',
        }),
        drawn(JACKSON, { xPx: 780, yPx: 330 }, rawError(JACKSON)),
        drawn(DEER, { xPx: 1540, yPx: 470 }, rawError(DEER), { landmark: DEER_LANDMARK }),
      ],
    },
    {
      captureId: 'c2',
      role: 'after-drag',
      horizontalAccuracyM: accuracy,
      dragAnchorSummitId: TRINITY.summitId,
      withheld: [
        {
          summitId: 'overture/53cb8f7e-49cf-3fb1-9481-c74a55614bb1',
          name: 'Jackson Peak',
          distanceKm: 78,
          reason: 'unmeasured',
        },
        {
          summitId: 'overture/89e63b23-e42b-3a06-b025-722221840540',
          name: 'Cougar Mountain',
          distanceKm: 18,
          reason: 'off-frame',
        },
      ],
      summits: [
        drawn(TRINITY, { xPx: 520, yPx: 300 }, settledError(TRINITY)),
        drawn(SHAFER, { xPx: 1040, yPx: 370 }, settledError(SHAFER)),
        drawn(MORES, { xPx: 1310, yPx: 410 }, settledError(MORES)),
        drawn(JACKSON, { xPx: 780, yPx: 330 }, settledError(JACKSON)),
        drawn(DEER, { xPx: 1540, yPx: 470 }, settledError(DEER), { landmark: DEER_LANDMARK }),
      ],
    },
    {
      captureId: 'c3',
      role: 'moved',
      horizontalAccuracyM: accuracy,
      dragAnchorSummitId: TRINITY.summitId,
      // The drag anchor sits at 0.84 of the half-frame; § 2.4 registers 0.8.
      panFromReferenceDeg: 26,
      summits: [
        drawn(TRINITY, { xPx: 155, yPx: 310 }, settledError(TRINITY, session.movement())),
        drawn(SHAFER, { xPx: 620, yPx: 370 }, settledError(SHAFER, session.movement())),
        drawn(MORES, { xPx: 890, yPx: 410 }, settledError(MORES, session.movement())),
        drawn(JACKSON, { xPx: 360, yPx: 330 }, settledError(JACKSON, session.movement())),
      ],
    },
    {
      captureId: 'c4',
      role: 'moved',
      horizontalAccuracyM: accuracy,
      // The drag came from c2 and was anchored on Trinity Mountain. This
      // capture names Shafer Butte instead, so the anchor rule removes it and
      // the movement is left pairing two summits — under the stop rule's floor.
      dragAnchorSummitId: SHAFER.summitId,
      tiltFromReferenceDeg: -10,
      summits: [
        drawn(SHAFER, { xPx: 1040, yPx: 140 }, settledError(SHAFER, session.movement())),
        drawn(MORES, { xPx: 1310, yPx: 180 }, settledError(MORES, session.movement())),
        drawn(JACKSON, { xPx: 780, yPx: 100 }, settledError(JACKSON, session.movement())),
      ],
    },
  ];

  checkAligned(captures);

  const spec: SynthSpec = {
    device: 'synthetic/field-bundle-aligned',
    annotatorMethods: ['bare-frame', 'frame-and-map'],
    captures,
  };
  return synthesiseFieldBundle(spec);
}

/** The band each aligned summit falls in, by § 2.3's distance bins. */
const ALIGNED_BAND: Record<string, keyof typeof ALIGNED_LIMITS> = {
  [SHAFER.summitId]: 'far',
  [MORES.summitId]: 'far',
  [JACKSON.summitId]: 'far',
  [DEER.summitId]: 'near',
};

/**
 * Check every unit the aligned pair will be graded on, before it is written.
 *
 * F2 reads the before-drag capture, F3 the after-drag one, and F4 the paired
 * change over each movement. Each is computed from the injected pixels alone.
 */
function checkAligned(captures: readonly SynthCapture[]): void {
  const by = (captureId: string): SynthCapture => {
    const found = captures.find((capture) => capture.captureId === captureId);
    if (found === undefined) throw new Error(`no capture ${captureId}`);
    return found;
  };
  const residualsOf = (capture: SynthCapture): Map<string, { across: number; down: number }> =>
    new Map(
      capture.summits.map((summit) => [summit.summitId, residualDeg(summit.truthPx, summit.errorPx)]),
    );

  // F2: the raw error against the half-width of the band the capture displayed.
  // Only the horizontal axis is gated; the vertical carries an unquantified term.
  for (const [summitId, raw] of residualsOf(by('c1'))) {
    assertInsideLimit(`F2 ${summitId} across`, raw.across, ALIGNED_RAW_BAND_DEG / 2);
  }

  // F3: one after-drag capture, so k = 1 and each median is its own residual.
  const reference = residualsOf(by('c2'));
  for (const [summitId, residual] of reference) {
    const band = ALIGNED_BAND[summitId];
    if (band === undefined) continue; // the drag anchor, which is not graded
    assertInsideLimit(`F3 ${summitId} across`, residual.across, ALIGNED_LIMITS[band].h);
    assertInsideLimit(`F3 ${summitId} up/down`, residual.down, ALIGNED_LIMITS[band].v);
  }

  // F4: the paired change, which one limit grades whatever the band.
  for (const captureId of ['c3', 'c4']) {
    const capture = by(captureId);
    for (const [summitId, moved] of residualsOf(capture)) {
      if (summitId === capture.dragAnchorSummitId) continue;
      const before = reference.get(summitId);
      if (before === undefined) continue;
      assertInsideLimit(
        `F4 ${captureId} ${summitId} across`,
        moved.across - before.across,
        MOVEMENT_LIMITS.h,
      );
      assertInsideLimit(
        `F4 ${captureId} ${summitId} up/down`,
        moved.down - before.down,
        MOVEMENT_LIMITS.v,
      );
    }
  }
}

/* ── the stray pair ──────────────────────────────────────────────────────── */

/**
 * Shafer Butte's total horizontal offset, pinned rather than added.
 *
 * 70 px is 3.130°, where the `far` band's registered 3σ limit is 2.85°. The
 * noise model's own draw for this summit is subtracted from the injected error,
 * so the offset the grader reads is this number whatever the draws were. A 3σ
 * excursion is deliberate: a band tolerates one summit-axis past 2σ, so a 2σ
 * error would pass and the fixture would assert nothing.
 */
const STRAY_SHAFER_OFFSET_PX = 70;

/** § 2.3's registered k = 1 rows, which grade a capture reporting no accuracy. */
const STRAY_FAR_LIMITS = { threeSigmaH: 2.85, twoSigmaV: 1.45 } as const;
const STRAY_NEAR_LIMITS = { h: 2.35, v: 1.55 } as const;

function strayPair(): { bundle: unknown; truth: unknown } {
  const session = new Session(SEED);
  const distances = new Map<string, number>([
    [TRINITY.summitId, 55],
    [SHAFER.summitId, 12],
    [MORES.summitId, 5],
    [JACKSON.summitId, 30],
    [DEER.summitId, 2],
  ]);
  const distanceOf = (summit: SummitFacts): number => distances.get(summit.summitId) ?? 0;
  const carry = (summit: SummitFacts): Offset =>
    session.carry(summit, distanceOf(summit), undefined);

  for (const summit of [TRINITY, SHAFER, MORES, JACKSON, DEER]) carry(summit);
  const anchorCarry = carry(TRINITY);
  const drag = session.drag('c1');

  const settledError = (summit: SummitFacts): Offset =>
    round(add(carry(summit), minus(anchorCarry), drag));

  const shaferNoise = settledError(SHAFER);
  const shaferError = round({
    xPx: STRAY_SHAFER_OFFSET_PX,
    yPx: shaferNoise.yPx,
  });

  const drawn = (
    summit: SummitFacts,
    truthPx: { xPx: number; yPx: number },
    errorPx: Offset,
    extra: Partial<SynthSummit> = {},
  ): SynthSummit => ({
    summitId: summit.summitId,
    name: summit.name,
    elevationM: summit.elevationM,
    distanceKm: distanceOf(summit),
    altitudeDeg: summit.altitudeDeg,
    truthPx,
    errorPx,
    annotatorSplitPx: ANNOTATOR_SPLIT_PX,
    ...extra,
  });

  // The stray capture reports no fix accuracy, so § 2.3's registered k = 1 row
  // grades it. Shafer Butte must sit past 3σ across and inside 2σ up/down: the
  // fixture fails F3.far on one axis of one summit and on nothing else.
  const shafer = residualDeg({ xPx: 1040, yPx: 370 }, shaferError);
  if (Math.abs(shafer.across) <= STRAY_FAR_LIMITS.threeSigmaH) {
    throw new Error(
      `stray Shafer Butte is ${shafer.across.toFixed(3)}° across, which no longer passes the ` +
        `${STRAY_FAR_LIMITS.threeSigmaH}° 3σ limit. F3.far would stop failing.`,
    );
  }
  assertInsideLimit('stray Shafer Butte up/down', shafer.down, STRAY_FAR_LIMITS.twoSigmaV);
  const deer = residualDeg({ xPx: 1540, yPx: 470 }, settledError(DEER));
  assertInsideLimit('stray Deer Point across', deer.across, STRAY_NEAR_LIMITS.h);
  assertInsideLimit('stray Deer Point up/down', deer.down, STRAY_NEAR_LIMITS.v);

  const spec: SynthSpec = {
    device: 'synthetic/field-bundle-stray',
    captures: [
      {
        captureId: 'c1',
        role: 'after-drag',
        dragAnchorSummitId: TRINITY.summitId,
        // Trinity Mountain is drawn with a verdict from 55 km, beyond this
        // sweep: the F5c error.
        sweepRadiusKm: 30,
        summits: [
          drawn(TRINITY, { xPx: 520, yPx: 300 }, settledError(TRINITY)),
          drawn(SHAFER, { xPx: 1040, yPx: 370 }, shaferError),
          // Drawn visible where both annotators report clear sky: the F5a error.
          drawn(MORES, { xPx: 1310, yPx: 410 }, settledError(MORES), {
            truthAbsent: 'clear-sky',
          }),
          // Drawn visible and identifiable by neither, which convicts nothing.
          drawn(JACKSON, { xPx: 780, yPx: 330 }, settledError(JACKSON), {
            truthCannotIdentify: 'both',
          }),
          drawn(DEER, { xPx: 1540, yPx: 470 }, settledError(DEER)),
        ],
      },
    ],
  };
  return synthesiseFieldBundle(spec);
}

/* ── write them ──────────────────────────────────────────────────────────── */

function main(): void {
  const directory = fileURLToPath(new URL('../fixtures/field/', import.meta.url));
  const pairs = [
    { name: 'aligned', pair: alignedPair() },
    { name: 'stray', pair: strayPair() },
  ];
  for (const { name, pair } of pairs) {
    for (const [kind, document] of [
      ['bundle', pair.bundle],
      ['truth', pair.truth],
    ] as const) {
      const path = `${directory}${name}-${kind}.json`;
      writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
      process.stdout.write(`wrote ${name}-${kind}.json\n`);
    }
  }
  process.stdout.write(
    `seed ${SEED}; draws truncated at ${CLAMP_SIGMA}σ; ` +
      `Shafer Butte's stray offset pinned at ${STRAY_SHAFER_OFFSET_PX} px = ` +
      `${degForPx(STRAY_SHAFER_OFFSET_PX).toFixed(3)}°\n`,
  );
}

main();
