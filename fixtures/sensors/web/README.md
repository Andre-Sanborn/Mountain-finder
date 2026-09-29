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
