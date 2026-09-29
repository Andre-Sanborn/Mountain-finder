/**
 * The camera with a computed horizon drawn over it — and draggable.
 *
 * Two things this screen is for.
 *
 * **A convention check you can read at a glance.** The line comes from the
 * SAME `projectToImage` the still pipeline uses, fed by the SAME
 * `poseWithSensors` the live loop uses. If pitch or roll carries the wrong
 * sign, the drawn line pulls away from the real horizon behind it — tilt the
 * phone left and the line tilts right. No test in this repository can catch
 * that. A window can.
 *
 * **D9's interaction, on a phone.** The first version of this screen refused
 * to draw anything without a true-north heading. That was the magnetic rule
 * applied past its purpose: the rule forbids treating magnetic as true
 * *silently*, and refusing to draw denies the user the one gesture that
 * actually fixes a bad heading — hardest, perversely, when the error is
 * biggest. So a magnetic bearing is now drawn, labelled `magnetic` by
 * `heading-policy.ts`, and the overlay can be pushed into place with a finger
 * exactly as the web app's sliders push it. The drag writes the same visible
 * `TrimState` the sliders write; nothing is corrected behind the user's back.
 *
 * What is deliberately NOT here: peaks. Labelling summits needs terrain, and
 * terrain needs a decision about how a phone carries square degrees of DEM
 * offline (D7). Building an AR overlay on top of an unverified sign convention
 * is the ordering mistake this project keeps declining to make — so the
 * horizon comes first, and the peaks come after the holds pass.
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Fragment, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { NO_TRIM, applyTrim, isUntrimmed, type TrimState } from '../../src/app/trim';
import {
  cameraAxes,
  cameraPoseFromFocalLength,
  directionVector,
  projectToImage,
} from '../../src/core/projection';
import type { CameraPose } from '../../src/core/types';
import { trimFromDrag } from '../../src/live/drag-trim';
import { resolveHeadingForDrawing } from '../../src/live/heading-policy';
import { poseWithSensors, type SensorAnswer } from '../../src/live/sensors';
import { colors, styles } from './theme';
import type { DeviceSensors } from './useDeviceSensors';

/**
 * 35 mm-equivalent focal lengths of the rear cameras, by phone model, as the
 * maker's spec sheet states them.
 *
 * These are INITIAL GUESSES, not measurements. Expo Go cannot ask the hardware
 * which camera is active or what it is doing, so the user picks — a stated
 * assumption they can correct, never a silent default. A wrong pick scales how
 * far the horizon spreads across the frame; it does NOT change which way the
 * line tilts, which is what this screen is for. The overlay's field of view is
 * to become a calibrated value measured against a solved pose, and these
 * numbers are what it starts from.
 *
 * Two details worth knowing when comparing a number here with a photograph's
 * EXIF. The "13 mm" ultrawide writes `FocalLengthIn35mmFormat` 14. And the
 * 17 Pro Max also frames an 8x, 200 mm-equivalent view by cropping its 100 mm
 * sensor; it is left out here because the four entries already span the range
 * the horizon check needs.
 */
interface PhoneLenses {
  readonly model: string;
  readonly focalLengths35mm: readonly number[];
}

const PHONE_LENSES: readonly PhoneLenses[] = [
  { model: 'iPhone 17 Pro Max', focalLengths35mm: [13, 24, 48, 100] },
  { model: 'iPhone 15 Pro Max', focalLengths35mm: [13, 24, 48, 120] },
];

/** The main camera, which is where both models' second entry sits. */
const DEFAULT_LENS_INDEX = 1;

/** Bearings marked along the horizon, degrees. */
const TICK_STEP_DEG = 15;

function cardinal(bearingDeg: number): string {
  const normalised = ((Math.round(bearingDeg) % 360) + 360) % 360;
  const names: Record<number, string> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  return names[normalised] ?? `${normalised}`;
}

/** Dot product of two East-North-Up vectors. */
function dot(a: { e: number; n: number; u: number }, b: { e: number; n: number; u: number }): number {
  return a.e * b.e + a.n * b.n + a.u * b.u;
}

interface ScreenPoint {
  readonly x: number;
  readonly y: number;
  readonly bearingDeg: number;
}

/**
 * The zero-altitude horizon as screen points.
 *
 * Points behind the camera are dropped rather than projected: the perspective
 * divide mirrors them back into frame with finite coordinates, so drawing them
 * would produce a confident line through the wrong part of the sky. That is
 * the same rule `projectToImage` documents; the depth test is repeated here
 * because a polyline needs to omit those vertices, not merely mark them.
 */
function horizonPoints(pose: CameraPose, widthPx: number, heightPx: number): ScreenPoint[] {
  const axes = cameraAxes(pose);
  const halfSpan = Math.min(80, pose.hFovDeg * 0.75);
  const steps = 61;
  const points: ScreenPoint[] = [];
  for (let i = 0; i < steps; i += 1) {
    const bearingDeg = pose.headingDeg - halfSpan + (2 * halfSpan * i) / (steps - 1);
    if (dot(directionVector(bearingDeg, 0), axes.forward) <= 0.05) continue;
    const projected = projectToImage(pose, bearingDeg, 0);
    if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) continue;
    points.push({ x: projected.x * widthPx, y: projected.y * heightPx, bearingDeg });
  }
  return points;
}

function tickPoints(pose: CameraPose, widthPx: number, heightPx: number): ScreenPoint[] {
  const axes = cameraAxes(pose);
  const first = Math.ceil((pose.headingDeg - pose.hFovDeg / 2) / TICK_STEP_DEG) * TICK_STEP_DEG;
  const last = pose.headingDeg + pose.hFovDeg / 2;
  const points: ScreenPoint[] = [];
  for (let bearingDeg = first; bearingDeg <= last; bearingDeg += TICK_STEP_DEG) {
    if (dot(directionVector(bearingDeg, 0), axes.forward) <= 0.05) continue;
    const projected = projectToImage(pose, bearingDeg, 0);
    if (!projected.inFrame) continue;
    points.push({ x: projected.x * widthPx, y: projected.y * heightPx, bearingDeg });
  }
  return points;
}

function answerText(answer: SensorAnswer): string {
  if (!answer.ok) return answer.refusal;
  const spread = answer.field.spreadDeg;
  return `${answer.field.valueDeg.toFixed(1)}°` + (spread === undefined ? '' : ` ±${spread.toFixed(1)}`);
}

export function HorizonScreen({ sensors }: { sensors: DeviceSensors }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [modelIndex, setModelIndex] = useState(0);
  const [lensIndex, setLensIndex] = useState(DEFAULT_LENS_INDEX);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [trim, setTrim] = useState<TrimState>(NO_TRIM);

  // The gesture reads the frame and lens through refs so the PanResponder can
  // be built once. Rebuilding it per render loses the in-flight gesture.
  const trimAtGestureStart = useRef<TrimState>(NO_TRIM);
  const trimRef = useRef<TrimState>(NO_TRIM);
  const frameRef = useRef({ widthPx: 0, heightPx: 0 });
  // Zero until the first layout, which `dragAngleDeg` reads as "no frame yet"
  // and answers with no movement. Seeding a plausible-looking field of view
  // instead would scale the first gesture by a number belonging to no lens.
  const fovRef = useRef({ hFovDeg: 0, vFovDeg: 0 });
  trimRef.current = trim;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
        onPanResponderGrant: () => {
          trimAtGestureStart.current = trimRef.current;
        },
        onPanResponderMove: (_event, gesture) => {
          // `gesture.dx/dy` are cumulative from the gesture's start, so the
          // base is the trim as it was then — not the previous frame's, which
          // would integrate the same movement over and over.
          setTrim(
            trimFromDrag(
              trimAtGestureStart.current,
              { dx: gesture.dx, dy: gesture.dy },
              frameRef.current,
              fovRef.current,
            ),
          );
        },
      }),
    [],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    frameRef.current = { widthPx: width, heightPx: height };
  };

  const phone = PHONE_LENSES[modelIndex] ?? PHONE_LENSES[0];
  const focalLength35mm =
    phone?.focalLengths35mm[lensIndex] ?? phone?.focalLengths35mm[DEFAULT_LENS_INDEX];
  const ready = size.width > 0 && size.height > 0 && focalLength35mm !== undefined;

  // The heading is resolved through the policy module, which prefers true
  // north, converts with a declination when one exists, and only then falls
  // back to a labelled magnetic bearing.
  const headingDecision = resolveHeadingForDrawing(
    sensors.headingSamples,
    sensors.atMs,
    sensors.declinationDeg === undefined ? {} : { declinationDeg: sensors.declinationDeg },
  );

  let pose: CameraPose | undefined;
  if (ready && focalLength35mm !== undefined && headingDecision.ok) {
    // The layout's own width and height, not the sensor's, because the preview
    // is ASPECT-FILL: the camera frame is scaled until it covers the view and
    // whatever overhangs is cropped away. A phone's screen is more elongated
    // than its 4:3 sensor, so the crop is across the short axis and the long
    // axis survives whole — the 36 mm-gate angle spans the screen's long side,
    // and the short side follows as
    //
    //     visible hFov = 2·atan( tan(vFov/2) · width / height )
    //
    // which is exactly what `cameraPoseFromFocalLength` computes from these
    // dimensions. If the preview ever becomes aspect-FIT (letterboxed), this
    // stops being true: the sensor's own aspect ratio would then govern.
    const base = cameraPoseFromFocalLength({
      headingDeg: headingDecision.heading.headingDeg,
      focalLength35mm,
      imageWidthPx: size.width,
      imageHeightPx: size.height,
    });
    fovRef.current = { hFovDeg: base.hFovDeg, vFovDeg: base.vFovDeg };
    // Only pitch and roll come from `poseWithSensors` here — the heading is
    // already the policy's answer, and letting the raw fusion overwrite it
    // would put an unlabelled bearing back on screen.
    const oriented = poseWithSensors(base, { ...sensors.pose, heading: { ok: false, refusal: 'no-samples' } });
    pose = applyTrim(oriented.pose, trim);
  }

  if (!permission) {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.p}>Checking camera permission…</Text>
      </View>
    );
  }
  if (!permission.granted) {
    return (
      <View style={[styles.screen, styles.body]}>
        <Text style={styles.h2}>Camera permission needed</Text>
        <Text style={styles.p}>
          The preview is only a backdrop — the horizon line is computed from the sensors either
          way. Without it you can still use the frame convention check.
        </Text>
        <Pressable style={styles.button} onPress={() => void requestPermission()}>
          <Text style={styles.buttonText}>Grant camera access</Text>
        </Pressable>
      </View>
    );
  }

  const horizon = pose ? horizonPoints(pose, size.width, size.height) : [];
  const ticks = pose ? tickPoints(pose, size.width, size.height) : [];
  const magnetic = headingDecision.ok && headingDecision.heading.basis === 'magnetic';

  return (
    <View style={styles.screen}>
      <View style={{ flex: 1 }} onLayout={onLayout} {...panResponder.panHandlers}>
        <CameraView style={StyleSheet.absoluteFill} facing="back" />
        {horizon.length > 1 ? (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Polyline
              points={horizon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke={magnetic ? colors.warn : colors.accent}
              strokeWidth={2}
              strokeDasharray={magnetic ? '10,6' : undefined}
            />
            {ticks.map((tick) => (
              <Fragment key={tick.bearingDeg}>
                <Line
                  x1={tick.x}
                  y1={tick.y - 10}
                  x2={tick.x}
                  y2={tick.y + 10}
                  stroke={magnetic ? colors.warn : colors.accent}
                  strokeWidth={2}
                />
                <SvgText x={tick.x} y={tick.y - 16} fill={colors.text} fontSize={12} textAnchor="middle">
                  {cardinal(tick.bearingDeg)}
                </SvgText>
              </Fragment>
            ))}
            <Circle cx={size.width / 2} cy={size.height / 2} r={3} fill={colors.accent} />
          </Svg>
        ) : null}
      </View>

      <View style={[styles.panel, { margin: 12 }]}>
        <View style={styles.row}>
          <Text style={styles.mono}>
            {headingDecision.ok
              ? `${headingDecision.heading.basis === 'true' ? 'true' : 'MAG'} ${headingDecision.heading.headingDeg.toFixed(1)}°`
              : `heading: ${headingDecision.refusal}`}
          </Text>
          <Text style={styles.mono}>pitch {answerText(sensors.pose.pitch)}</Text>
          <Text style={styles.mono}>roll {answerText(sensors.pose.roll)}</Text>
        </View>

        {headingDecision.ok && headingDecision.heading.caveat ? (
          <Text style={{ color: colors.warn, fontSize: 12, lineHeight: 17 }}>
            {headingDecision.heading.caveat}
          </Text>
        ) : null}
        {!headingDecision.ok ? (
          <Text style={{ color: colors.warn, fontSize: 12, lineHeight: 17 }}>
            No line drawn — {headingDecision.detail}.
          </Text>
        ) : null}

        <View style={styles.row}>
          <Text style={styles.p}>
            {isUntrimmed(trim)
              ? 'Drag the overlay to line it up with what you can see.'
              : `nudged ${trim.headingDeg >= 0 ? '+' : ''}${trim.headingDeg.toFixed(1)}° across, ` +
                `${trim.pitchDeg >= 0 ? '+' : ''}${trim.pitchDeg.toFixed(1)}° up`}
          </Text>
          {!isUntrimmed(trim) ? (
            <Pressable style={styles.buttonGhost} onPress={() => setTrim(NO_TRIM)}>
              <Text style={[styles.buttonGhostText, { fontSize: 11 }]}>Reset</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.row}>
          {PHONE_LENSES.map((entry, index) => (
            <Pressable
              key={entry.model}
              style={[
                styles.buttonGhost,
                index === modelIndex ? { borderColor: colors.accent } : null,
              ]}
              onPress={() => {
                setModelIndex(index);
                // Models differ in how many cameras they list; the main one is
                // at the same index on both, so fall back there.
                if (lensIndex >= entry.focalLengths35mm.length) setLensIndex(DEFAULT_LENS_INDEX);
              }}
            >
              <Text style={[styles.buttonGhostText, { fontSize: 11 }]}>{entry.model}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.row}>
          {(phone?.focalLengths35mm ?? []).map((mm, index) => (
            <Pressable
              key={mm}
              style={[styles.buttonGhost, index === lensIndex ? { borderColor: colors.accent } : null]}
              onPress={() => setLensIndex(index)}
            >
              <Text style={[styles.buttonGhostText, { fontSize: 11 }]}>{mm} mm</Text>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: colors.dim, fontSize: 11, lineHeight: 16 }}>
          Lens figures are the spec sheet's, not a measurement — they set how far the line
          spreads, never which way it tilts.
        </Text>
      </View>
    </View>
  );
}
