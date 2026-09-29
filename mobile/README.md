# Mountain Finder — mobile shell (P8.1)

Two screens on a phone, existing to settle one question the rest of this
repository cannot: **do the device frame conventions in `src/live/sensors.ts`
match a real device?**

## Why this is not just "the app yet"

`src/live/sensors.ts` says so in its own header. Every expectation in its 16
tests is derived by hand from the frame convention written directly above
them. That proves the *mathematics*. It cannot prove the *convention* — a sign
error would pass all 16 and invert the overlay on hardware, and no amount of
work in a Linux container closes that, because the missing evidence is a
physical fact about a phone.

So this app deliberately does **not** label peaks yet. Labelling needs terrain,
terrain needs a decision about how a phone carries square degrees of DEM
offline (D7), and building an AR overlay on top of an unverified sign
convention is the ordering mistake this project keeps declining to make. The
horizon comes first. The peaks come after the holds pass.

## Running it — no Mac, no Xcode, no Apple Developer account

You need **Expo Go** on the phone (App Store / Play Store) and a machine to run
the dev server. Nothing else: every native module this app uses —
`expo-sensors`, `expo-location`, `expo-camera`, `react-native-svg` — is bundled
into Expo Go, so there is no native build step. A Mac or an
[EAS](https://docs.expo.dev/build/introduction/) build is only needed later,
for a standalone binary, TestFlight, or the App Store.

**Only the `mobile/` install is needed.** Verified from a clean clone with no
root `node_modules` present at all: 750 modules bundled. The Expo app imports
`/src` as TypeScript source, so the root's own dependencies (Playwright,
Chromium, the parquet reader) are irrelevant here.

### On your own computer

Any OS, Node 20+:

```sh
git clone -b claude/gifted-lamport-3tyh5g \
  https://github.com/Andre-Sanborn/Mountain-finder.git
cd Mountain-finder/mobile
npm install
npx expo start
```

Scan the QR with the Camera app (iOS) or from inside Expo Go (Android). Phone
and computer must be on the same network — otherwise use `--tunnel` below.

### In the browser, via GitHub Codespaces

`.devcontainer/devcontainer.json` sets this up: open the repo on GitHub →
**Code ▸ Codespaces ▸ Create codespace on this branch**. Node and the `mobile/`
dependencies install themselves. Then, in the Codespace terminal:

```sh
cd mobile && npx expo start --tunnel
```

`--tunnel` is what makes this work: the dev server is in a datacentre and your
phone is not on its network, so Expo routes through a public tunnel URL that
the phone can reach from anywhere. Expo will offer to install `@expo/ngrok` the
first time — say yes. (It is deliberately not a dependency here, so that the
plain `npm install` above stays as small and as verified as it is.)

Local-network mode without `--tunnel` will not work from a Codespace.

### "Project is incompatible with this version of Expo Go"

Expo Go supports **one SDK at a time** — whichever the App Store build was cut
for. This project is pinned to the newest (SDK 57), which is wrong for any
phone whose Expo Go is older, and a phone stuck on an older iOS cannot install
a newer Expo Go however many times you check for updates.

**First, delete Expo Go and reinstall it.** The App Store will happily show
"Open" on a stale build when an update exists, and a reinstall is 30 seconds.

If it still refuses, the error names the SDK it wants — *"the installed version
of Expo Go is for SDK 54"*. Match the project to it:

```sh
cd mobile
npm install expo@~54.0.0     # substitute the number Expo Go reported
npx expo install --fix       # realigns every expo-* package to that SDK
```

`expo install --fix` needs network access to Expo's API, which any normal
machine or Codespace has. If it is unavailable, pin by hand from this table —
these are the versions Expo itself bundles for each SDK, read from
`expo/bundledNativeModules.json`:

| | SDK 54 | SDK 55 | SDK 56 | SDK 57 |
|---|---|---|---|---|
| `expo` | ~54.0.37 | ~55.0.29 | ~56.0.20 | ~57.0.14 |
| `expo-sensors` | ~15.0.8 | ~55.0.18 | ~56.0.6 | ~57.0.2 |
| `expo-location` | ~19.0.8 | ~55.1.13 | ~56.0.24 | ~57.0.11 |
| `expo-camera` | ~17.0.10 | ~55.0.22 | ~56.0.8 | ~57.0.3 |
| `expo-status-bar` | ~3.0.9 | ~55.0.6 | ~56.0.4 | ~57.0.1 |
| `react-native` | 0.81.5 | 0.83.10 | 0.85.3 | 0.86.2 |
| `react` / `@types/react` | ^19.1.0 | ^19.1.0 | ^19.2.3 | ^19.2.3 |
| `react-native-svg` | 15.12.1 | 15.15.3 | 15.15.4 | 15.15.4 |
| `react-native-safe-area-context` | ~5.6.0 | ~5.6.2 | ~5.7.0 | ~5.7.0 |

**No source change is needed for any of these.** Verified by actually doing it:
the app was downgraded to SDK 54 — the largest jump in the table — and bundled
clean at 743 modules with not one line of application code touched. Everything
this shell uses (`CameraView`, `DeviceMotion`, `watchHeadingAsync`,
`PanResponder`, `react-native-svg`) has been stable across all four.

### What GitHub Actions can and cannot do

**It cannot serve the app to your phone.** Actions is headless CI — no QR code
to scan, no device attached. Codespaces is the browser-based option; Actions is
not.

**It does now prove the app still builds.** `.github/workflows/check.yml` runs
the core suite and a real Metro + Hermes bundle on every push — the exact check
whose absence let X-12 ship.

## Screen 1 — Calibrate

Four holds whose gravity vector is known a priori from geometry:

| Hold | Expected gravity | Proves |
|---|---|---|
| Upright portrait | `(0, −1, 0)` | `+y` is the top edge; level pitch reads 0°, not ±90° |
| Face up on a table | `(0, 0, −1)` | gravity points **down** (−z), not up — the W3C sign trap |
| Face down on a table | `(0, 0, +1)` | pitch is signed, so camera-up and camera-down are distinct |
| Right edge down | `(+1, 0, 0)` | roll is positive clockwise seen from behind the camera |

Hold the phone in each position, keep it still, tap **Capture**. Two holds on
different axes are enough for a verdict; all four leave nothing untested.

The verdict comes from `src/live/calibration.ts`, which is where all the
judgement lives — this screen only collects taps. It reports one of:

- **`matches-convention`** — the conventions are confirmed against hardware.
  P8.2's open bar closes. Nothing needs changing.
- **`systematic-remap`** — every hold is explained by one wrong signed axis
  permutation, and it names it: *"measured ≈ (x←−y, y←x, z←z) of expected"*.
  That is a one-line correction rather than a search across 48 candidates.
- **`inconsistent`** — no single mapping fits. The phone moved, or a hold was
  done differently than described. Not a convention problem; re-run it.
- **`insufficient`** — the captured holds constrain fewer than two axes.

**Share result + trace** exports the observations, the verdict and the raw
sample buffers as JSON. Send that back: the traces are what turn this from a
verdict into the replayed fixture P8.2 actually asks for.

## Screen 2 — Horizon

The camera preview with a computed horizon line drawn over it, plus bearing
ticks and the live fused pose.

The line is produced by the same `projectToImage` the still pipeline uses, fed
by the same `poseWithSensors` the live loop uses. **Tilt the phone. The line
must stay on the real horizon behind it.** If pitch or roll carries the wrong
sign, the line pulls away — tilt left and it tilts right. That is a convention
error you can read at a glance and that no test here can catch.

Pick the phone model, then the lens. Both figures come from the maker's spec
sheet and are an assumption, not a measurement: Expo Go cannot ask the hardware
which camera is active or what it is doing. The choice scales how far the line
spreads across the frame; it does not change which way the line tilts, which is
what the screen is for. The overlay's field of view is to become a calibrated
value measured against a solved pose, and these numbers are where it starts.

The preview is aspect-fill, so the field of view is derived from the screen's
own width and height: the 36 mm-gate angle spans the long side and the short
side follows as `2·atan(tan(long/2) · short / long)`. On a 393 x 852 pt portrait
layout the 24 mm main camera gives 73.7° down the screen and 38.2° across it.

**Drag the overlay to line it up.** This is D9's interaction, the one the web
app gives you as sliders: push the horizon with a finger until it sits on the
real one. The gesture writes the same visible `TrimState` the sliders write and
stops at the same limits (±30° across, ±20° up), and the panel reports how far
you nudged it. Nothing is ever corrected behind your back.

The drag geometry inverts the projection properly rather than assuming degrees
are linear in pixels. A phone held upright shows about 69° vertically on its
main camera and about 108° on its ultrawide, where the naive `fov ÷ pixels`
scale lags your finger by 12% and 32% respectively. See
`src/live/drag-trim.ts`.

### True north, magnetic north, and why the line still draws

If the compass has a **true** heading, the line is solid blue. If it only has a
**magnetic** one — Core Location reports `trueHeading` as `−1` without a
location fix — the line is drawn **amber and dashed**, labelled `MAG`, with the
error named on screen.

An earlier version refused to draw at all in that case. That was the magnetic
rule applied past its purpose. The rule forbids treating magnetic as true
*silently*; refusing to draw denies you the one gesture that actually fixes the
heading, and denies it hardest when the error is largest. Declination is
bounded, systematic and well inside the ±30° drag range, so the honest answer
is: draw it, say plainly what it is, let you push it into place.

## What is checked here, and what is not

Run from the repository root:

```sh
npm run check:mobile       # all three of the below, in order
npm run typecheck:mobile   # tsc over the app AND the shared modules it imports
npx eslint mobile          # lint
npm run bundle:mobile      # a REAL Metro + Hermes build — the one that matters
```

`bundle:mobile` exists because the first version of this app **typechecked,
linted, passed 1 218 unit tests, and could not be built** (X-12). `src/app/trim.ts`
imported two pure helpers from the `../exif` barrel, which drags in `exifr`,
which ships a dynamic `import()` that Hermes rejects outright. Metro resolved
all 756 modules; the failure came afterwards, in bytecode compilation. An app
that cannot start is invisible to every check that does not start it.

`typecheck:mobile` compiles this app against the real Expo SDK 57 /
React Native 0.86 / React 19 type definitions, and it pulls `src/core`,
`src/live`, `src/pipeline` and `src/render` in with it — 39 shared files
typechecked under the mobile toolchain, imported across the repository root
**unchanged**, which is P8.1's "no fork, no shim" bar.

What is **not** checked: nobody has *run* this app. It builds — Metro resolves
it and Hermes compiles it — but a build proves it will start, not that the
overlay lands in the right place. That last step is a person holding a phone,
so it ships marked `[~]`, not ticked — the same honest treatment `P2.4` carries
for the fixtures that could not be recorded through a blocked proxy.

## Layout

```
App.tsx                    two tabs, no navigation library
index.js                   registerRootComponent
metro.config.js            reaches outside this folder to import /src unchanged
src/useDeviceSensors.ts    the ONLY file that touches a device API
src/CalibrateScreen.tsx    collects taps; all judgement is in /src/live/calibration.ts
src/HorizonScreen.tsx      camera + the real projection code + the drag gesture
src/theme.ts               colours and styles
```

The geometry and policy behind both screens are pure modules in the shared
tree, tested here rather than on a phone:

| Module | What it decides |
|---|---|
| `src/live/calibration.ts` | whether the holds confirm the frame convention, and which axis map is wrong if not |
| `src/live/device-samples.ts` | Expo's payloads → the documented sample types (X-11) |
| `src/live/heading-policy.ts` | whether a heading may be drawn, and whether it may be called true |
| `src/live/drag-trim.ts` | how far a finger moves the overlay |

`useDeviceSensors.ts` is the whole impure surface. Everything it produces goes
straight into the pure modules: if a pitch is wrong, the bug is in a module
with tests behind it, not in a component nobody can execute in CI.
