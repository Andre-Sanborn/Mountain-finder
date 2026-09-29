# fixtures/sensors/web/

Raw browser sensor events for `src/live/web-sensors.ts`, in the shape
`RecordedWebSensorEvent` replays.

## What is here

`synthetic-events.json` is hand-built, not recorded. Each event's fields come
from the W3C rotation matrix and from each browser's published arithmetic, both
quoted in `src/live/web-sensors.ts`'s header: pick a pose, work out the angles
and the acceleration vector it must produce, and assert the adapter recovers the
pose that went in. No number in the file was produced by running the adapter.

The file covers both browsers on purpose. `devicemotion`'s
`accelerationIncludingGravity` has opposite signs in Chromium and iOS Safari, so
a fixture that carried only one of them would let the other's sign error through
untested.

Each event carries a `comment` naming the pose and the refusal it exercises. The
adapter ignores those fields.

## Privacy rules these files follow

`AGENTS.md` § Captures from the phone governs anything recorded from a real
device, and this directory follows the same rules even though its contents are
synthetic:

- Orientation and motion events only. No geolocation event, ever.
- Timestamps are milliseconds from the start of the capture. A wall-clock stamp
  dates a session as precisely as a coordinate places it.
- A real recording is committed only as a stripped copy a human has reviewed.
  The capture bundle itself travels by the human's own action and is never
  committed.

## The recording that is still missing

`webkitCompassHeading` is CLHeading, and Apple documents its reference axis as
the top of the device in portrait. Held upright to photograph a horizon, that
axis points at the sky. What CoreLocation returns in that pose is undocumented,
so `src/live/web-sensors.ts` implements both candidate readings and picks
neither. A ten-second Safari recording from the home session decides it, and
lands here beside the synthetic file rather than replacing it.

## The two home-session recordings

`synthetic-home-session-top-edge.json` and
`synthetic-home-session-camera-axis.json` are whole home sessions, one for each
candidate reading of `webkitCompassHeading`. They are the recordings
`scripts/analyze-recording.ts` is demonstrated on:

```
npm run analyze:recording -- fixtures/sensors/web/synthetic-home-session-top-edge.json
```

Both are synthetic. `synthesiseRecording` in `src/live/recording.ts` built them
from closed forms derived by hand from § A.2 of the W3C rotation matrix —
`recording.ts`'s Section 9 carries the derivation. Nothing in either file was
recorded from a phone or produced by running the analyzer, and
`recording.test.ts` asserts that those closed forms agree with the adapter's own
transcription of the matrix across a grid of attitudes.

They differ in exactly one respect: what `webkitCompassHeading` reports. The
top-edge file publishes the azimuth of the portrait top edge, and the
camera-axis file publishes the rear camera's. Every other field is identical,
which is what makes them a pair rather than two examples. The analyzer scores
the first as `device-top-edge` and the second as `rear-camera-axis`, and in both
it returns `inconclusive` for the portrait-upright hold, where the two readings
agree to within the compass noise.

Both carry an alpha drift of 2.4 °/min, an alpha re-base of 77° one minute in,
iOS's absent `absolute` attribute, and WebKit's downward
`accelerationIncludingGravity`, so a reader can see what each verdict looks like
against data whose answer is known.

To regenerate them, build a `SynthSpec` with `protocolSegments()` shortened —
`still-drift` to 120 s at 0.5 Hz, `handling` to 60 s at 2 Hz, and every other
hold to 3 s at 5 Hz — and these settings:

```
knownBearingDeg: 137.5          attitudeNoiseDeg: 0.3
compassNoiseDeg: 1.5            compassAccuracyDeg: 8
alphaDriftDegPerMinute: 2.4     alphaBiasDeg: 213
alphaRebase: { atMs: 60000, byDeg: 77 }
motionConvention: 'coremotion-gravity'
omitAbsolute: true              seed: 20260929
hypothesis: 'device-top-edge' | 'rear-camera-axis'
```

The seed drives a linear congruential generator, so the files are byte-identical
on any machine.

## What a real recording may not carry

`src/live/recording.ts`'s parser refuses a document that holds a geolocation
field, an epoch or ISO timestamp, a camera identifier, or any key it does not
know. The known-bearing reference is where a position and a wall clock would
otherwise be needed, because the sun's azimuth is a function of both: the web
app computes that azimuth on the device and stores the bearing alone, so neither
the position nor the instant ever enters the file.
