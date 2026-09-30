/**
 * How wrong the live labels might be — D9's band, with the terms a sensor
 * stream actually has.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY NOT `poseUncertainty` UNCHANGED
 * ═══════════════════════════════════════════════════════════════════════════
 * `uncertainty.ts` builds the band for a PHOTOGRAPH, and its two terms are
 * photograph terms: the compass reading EXIF carried, and a camera tilt no
 * photograph records at all. That second term is the big one — 3.52°, measured
 * on the one solved frame — and it exists because the still path has to ASSUME
 * level.
 *
 * Live, the tilt is sensed. Carrying the 3.52° assumed-pitch term into a screen
 * that reads gravity forty times a second would report an error the app is not
 * making, which is the same kind of dishonesty as under-reporting one.
 *
 * So the terms are re-derived for this path, and every primitive is reused
 * unchanged: `frameFractionOf`, `pixelsPerDegreeAtCentre` and `summarise` all
 * come from `uncertainty.ts`, so the live band means exactly what the photo
 * band means and reads in the same voice.
 *
 * ── WHERE EACH LIVE TERM COMES FROM ────────────────────────────────────────
 *   heading, basis `true-model`   the WMM2025 model's own 0.5° RMS, which NOAA
 *                                 states, plus the compass's reported accuracy
 *   heading, basis `magnetic`     unquantified: the error IS the local
 *                                 declination and the app has no position to
 *                                 evaluate it at
 *   heading, basis `true`         the platform resolved north itself and
 *                                 publishes no figure — unquantified
 *   compass scatter               measured from the trace this second
 *   pitch scatter                 measured from the trace this second
 *   field of view                 unquantified while uncalibrated, because a
 *                                 browser stream's field is not the published
 *                                 one and the size of the gap is unmeasured
 *   pitch bias, measured          the home session's tilt zero point against
 *                                 the Sun, plus how far two re-aims landed
 *                                 apart
 *   pitch bias, unmeasured        unquantified: nothing on this phone has ever
 *                                 checked the sensed tilt against a known
 *                                 direction
 *   pitch bias, too loose         unquantified: a measurement exists, but its
 *                                 readings disagree too widely or too few were
 *                                 pooled to call it a zero point
 *
 * The scatter terms are the only ones with a sample count above 1, and they are
 * measurements of the noise rather than of the bias. Saying so matters: a still
 * phone has almost no scatter and can still be pointing 12° wrong.
 *
 * Pure: a heading decision, two spreads and a pose in, a statement out.
 */

import type { CameraPose } from '../../core/types';
import { MODEL_DECLINATION_RMS_DEG, type DrawableHeading } from '../../live/heading-policy';
import { chargedTiltSpreadDeg, qualifiesToGateVertical } from '../../live/recording';
import {
  frameFractionOf,
  pixelsPerDegreeAtCentre,
  summarise,
  type PoseUncertainty,
  type UncertaintyTerm,
} from '../uncertainty';
import type { FovSource } from './fov-choice';
import type { PitchBiasCalibration } from './pitch-bias';

export interface LiveUncertaintyInput {
  readonly heading: DrawableHeading;
  /** Platform-reported compass accuracy, degrees, when the platform gave one. */
  readonly compassAccuracyDeg?: number | undefined;
  readonly pitchSpreadDeg?: number | undefined;
  readonly fovSource: FovSource;
  /** The home session's tilt measurement for this phone, when one is stored. */
  readonly pitchBias?: PitchBiasCalibration | undefined;
  readonly pose: CameraPose;
  readonly framePx: { readonly widthPx: number; readonly heightPx: number };
}

function headingTerms(input: LiveUncertaintyInput): readonly UncertaintyTerm[] {
  const terms: UncertaintyTerm[] = [];
  const { heading } = input;

  if (heading.basis === 'true-model') {
    const declination = heading.model?.declinationDeg ?? 0;
    terms.push({
      axis: 'horizontal',
      label: 'True north from a model',
      basis: {
        kind: 'measured',
        deg: MODEL_DECLINATION_RMS_DEG,
        sampleCount: 1,
        note:
          'Your phone gave a magnetic bearing and the app added the ' +
          `${declination.toFixed(1)}° of local declination its magnetic model computes. ` +
          `The model is good to about ${MODEL_DECLINATION_RMS_DEG}° on average, and iron-rich ` +
          'rock underfoot can bend the field several degrees more than that.',
      },
    });
  } else if (heading.basis === 'magnetic') {
    terms.push({
      axis: 'horizontal',
      label: 'Magnetic north, not true north',
      basis: {
        kind: 'unquantified',
        note:
          'The app has no position, so it cannot work out how far magnetic north is ' +
          'from true north here. In the mountains of the western United States that ' +
          'is usually ten degrees or more. Drag the labels sideways to correct it.',
      },
    });
  } else {
    terms.push({
      axis: 'horizontal',
      label: 'Your phone resolved north itself',
      basis: {
        kind: 'unquantified',
        note:
          'The phone reported true north directly and publishes no figure for how ' +
          'accurate that is, so the app states none.',
      },
    });
  }

  if (input.compassAccuracyDeg !== undefined && input.compassAccuracyDeg > 0) {
    terms.push({
      axis: 'horizontal',
      label: "Compass's own reported accuracy",
      basis: {
        kind: 'measured',
        deg: input.compassAccuracyDeg,
        sampleCount: 1,
        note:
          'Your phone says its compass reading is good to about this much right now. ' +
          'Waving the phone in a figure 8 usually improves it.',
      },
    });
  }

  if (heading.spreadDeg !== undefined && heading.spreadDeg > 0) {
    terms.push({
      axis: 'horizontal',
      label: 'Compass wobble this second',
      basis: {
        kind: 'measured',
        deg: heading.spreadDeg,
        sampleCount: heading.sampleCount,
        note:
          'How much the compass readings disagreed with each other over the last ' +
          'second. This measures the shake in your hands, not how far off north the ' +
          'compass is.',
      },
    });
  }

  return terms;
}

/**
 * The tilt zero point: how far the sensed tilt sits from the truth.
 *
 * Separate from the wobble term above, because a still phone has almost no
 * wobble and can still read two degrees low all day. Without this term a
 * calibrated band would claim the pitch is known to the width of a second's
 * hand shake, which on a braced phone is a few thousandths of a degree.
 *
 * The measured figure charges the bias and its spread together. The app does
 * not subtract the bias from the pose — it reports it — so the band has to
 * carry the whole of it, and the re-aim spread is how well the bias itself is
 * known. A tap spread is floored by `chargedTiltSpreadDeg` first.
 *
 * A stored measurement whose readings disagree too widely, or that pooled too
 * few of them, is not a zero point. `qualifiesToGateVertical` decides, and a
 * measurement that fails it leaves this term unquantified with its own figures
 * named, so the screen says which measurement fell short rather than implying
 * none was taken.
 */
function pitchBiasTerm(bias: PitchBiasCalibration | undefined): UncertaintyTerm {
  if (bias === undefined) {
    return {
      axis: 'vertical',
      label: 'Tilt zero point never checked',
      basis: {
        kind: 'unquantified',
        note:
          'Nothing on this phone has ever checked its tilt sensor against a direction ' +
          'it knows, so the app cannot say how far the tilt reading sits from the truth. ' +
          'It could be a fraction of a degree or it could be several. Run the home ' +
          'session in sunshine to measure it.',
      },
    };
  }
  const quality = {
    biasDeg: bias.biasDeg,
    spreadDeg: bias.spreadDeg,
    sampleCount: bias.segmentCount,
    source: bias.source,
  };
  if (!qualifiesToGateVertical(quality)) {
    return {
      axis: 'vertical',
      label: 'Tilt zero point never checked',
      basis: {
        kind: 'unquantified',
        note:
          `The home session did aim at the sun, but its ${bias.segmentCount} reading` +
          `${bias.segmentCount === 1 ? '' : 's'} landed ${bias.spreadDeg.toFixed(2)}° apart ` +
          `and found the tilt ${Math.abs(bias.biasDeg).toFixed(2)}° out, which is not steady ` +
          'enough to stand as a zero point. So the app still cannot say how far the tilt ' +
          'reading sits from the truth. Run the home session again in sunshine, tapping the ' +
          'middle of the sun.',
      },
    };
  }
  const spreadDeg = chargedTiltSpreadDeg(quality);
  return {
    axis: 'vertical',
    label: 'Tilt zero point, measured against the sun',
    basis: {
      kind: 'measured',
      deg: Math.abs(bias.biasDeg) + spreadDeg,
      sampleCount: bias.segmentCount,
      note:
        `The home session measured this phone against the sun and found its tilt reading ` +
        `${Math.abs(bias.biasDeg).toFixed(2)}° too ${bias.biasDeg >= 0 ? 'high' : 'low'}, with ` +
        `${bias.segmentCount} independent readings landing ${bias.spreadDeg.toFixed(2)}° apart. ` +
        (spreadDeg > bias.spreadDeg
          ? `So few taps can agree by luck, so the spread is charged at ` +
            `${spreadDeg.toFixed(2)}°, the least that ${bias.segmentCount} taps can pin down. `
          : '') +
        `Both are charged here, because the app reports the error rather than quietly ` +
        `correcting for it. ${bias.method}`,
    },
  };
}

function verticalTerms(input: LiveUncertaintyInput): readonly UncertaintyTerm[] {
  const terms: UncertaintyTerm[] = [];
  if (input.pitchSpreadDeg !== undefined && input.pitchSpreadDeg > 0) {
    terms.push({
      axis: 'vertical',
      label: 'Tilt wobble this second',
      basis: {
        kind: 'measured',
        deg: input.pitchSpreadDeg,
        sampleCount: 1,
        note:
          'How much the tilt readings disagreed over the last second. Unlike a ' +
          'photograph, the app is measuring the tilt rather than assuming the camera ' +
          'is level, so there is no guessed tilt error here.',
      },
    });
  }

  terms.push(pitchBiasTerm(input.pitchBias));
  if (input.fovSource === 'spec-sheet-guess') {
    terms.push({
      axis: 'vertical',
      label: 'Field of view not yet calibrated',
      basis: {
        kind: 'unquantified',
        note:
          'The app is guessing how wide the camera sees from the phone’s published ' +
          'lens figures. A video preview is a crop of the photo frame, so the real ' +
          'figure differs by an amount nobody has measured yet. This stretches the ' +
          'labels apart or squeezes them together rather than sliding them.',
      },
    });
  }
  return terms;
}

/**
 * Assemble the live band.
 *
 * Shaped as `PoseUncertainty` so the existing banner component and its tests
 * read it unchanged. The measured totals are a FLOOR whenever any term has no
 * figure, and `summarise` already says so.
 */
export function liveUncertainty(input: LiveUncertaintyInput): PoseUncertainty {
  const terms = [...headingTerms(input), ...verticalTerms(input)];

  const sumFor = (axis: 'horizontal' | 'vertical'): number =>
    terms
      .filter((term) => term.axis === axis && term.basis.kind === 'measured')
      .reduce((total, term) => total + (term.basis.kind === 'measured' ? term.basis.deg : 0), 0);

  const measuredDeg = { horizontal: sumFor('horizontal'), vertical: sumFor('vertical') };
  const hasUnquantified = terms.some((term) => term.basis.kind === 'unquantified');
  const frameFraction = {
    horizontal: frameFractionOf(measuredDeg.horizontal, input.pose.hFovDeg),
    vertical: frameFractionOf(measuredDeg.vertical, input.pose.vFovDeg),
  };

  return {
    terms,
    measuredDeg,
    hasUnquantified,
    frameFraction,
    pixelsPerDegree: {
      horizontal: pixelsPerDegreeAtCentre(input.pose.hFovDeg, input.framePx.widthPx),
      vertical: pixelsPerDegreeAtCentre(input.pose.vFovDeg, input.framePx.heightPx),
    },
    summary: summarise(measuredDeg, frameFraction, hasUnquantified),
  };
}

/**
 * Half-width of the horizontal band in pixels, for the shaded strip drawn down
 * the middle of the frame.
 *
 * Exact projection arithmetic — the same tangent scale the labels use — so the
 * strip is as wide as the error it represents at the centre of frame. Zero when
 * every horizontal term is unquantified, which is the honest width for "no
 * figure": the strip disappears and the sentence carries the statement instead.
 */
export function horizontalBandHalfWidthPx(
  uncertainty: PoseUncertainty,
  framePx: { readonly widthPx: number },
): number {
  return (uncertainty.frameFraction.horizontal * framePx.widthPx) / 2;
}
