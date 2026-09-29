# TODO

One line per item, ordered so that nothing depends on something below it. Check an item only
after its self-check has run and passed here. The checks are in
[IMPLEMENTATION.md](IMPLEMENTATION.md); state and blockers are in [HANDOFF.md](HANDOFF.md).

## Route to the field test

- [x] Fix the portrait FOV axis in core, the phone shell and annotate-photo; re-derive the drag-trim test
- [ ] Settle long-side vs CIPA-diagonal 35 mm equivalence against the solved Railroad Ridge pose (~2°, 3% scale)
- [x] Build WMM2025 declination in src/core; reproduce NOAA's test values to 0.05°; cross-check a second source
- [x] Wire src/core/declination into the live heading policy, labelled "true (model)"
- [ ] Hold the user's trim across a heading-basis change, so the first fix does not jump the overlay
- [ ] Use the WMM2025 path in the web shell's heading, as the phone shell now does
- [x] Build sun and moon position in src/core against Meeus worked examples
- [ ] Draw the sun and moon discs in the AR screen; bench-test heading, pitch and FOV against them
- [x] Deploy the web app to GitHub Pages from Actions, gated on test:deploy and a no-GPS privacy check
- [ ] Confirm the first Pages run on GitHub; if enablement fails, the human sets Source to GitHub Actions
- [ ] Measure what the phone downloads from Pages; drop --gzip if the .gz siblings go unread
- [ ] Add the Idaho field-site tiles to the Pages workflow's fetch:tiles line
- [x] Build the repository privacy check: no EXIF GPS or coordinate pairs in new files; wire into check
- [x] Build the web sensor adapter as a pure function of raw Safari and Chromium events
- [ ] Settle webkitCompassHeading's reference axis for an upright phone from the home recording
- [ ] Build a recording schema and `analyze:recording` that scores the compass hypotheses automatically
- [ ] Only if landscape fails: the iOS alpha-offset hold, re-anchored continuously, invalidated on re-base
- [ ] Settle the device-roll to screen-roll sign from the home recording
- [ ] Give suggestPoseTrim tests a timeout that holds under parallel load (1.8 s alone, >5 s at load 13)
- [ ] Build the Bogus Basin site package at 60 km radius, with seam and coverage tests
- [ ] Run a 360° annotateScene at location fix; measure its time under CPU throttling
- [ ] Build the web AR screen in landscape: single-lens camera, live loop, drag, band, sun marker, offline worker
- [ ] Build the capture bundle and `analyze:field`; bundles never enter the repository
- [ ] Write the error budget and pre-register the field pass criteria
- [ ] Run the headless dress rehearsal on IMG_7270 and railroad-ridge-48mm with injected errors
- [ ] Write the home-session steps; run the home session with the human
- [ ] Turn the home-session recording into fixtures; fix any sign or FOV error it shows
- [ ] Lock the railroad-ridge CV result as a regression test, labelled n = 1
- [ ] Write the field-session steps; run the field test with the human

## Other open work

- [ ] Get the human's answer on whether the seven photos in fixtures/photos/real/ stay public.
- [ ] Decide the fate of the retired `claude/topographic-peak-identifier-EV4ZN` branch: keep, tag, or delete.
- [ ] P7.5: add a cue for soft crest steps under haze so the 24 mm and 14 mm frames report columns instead of declining.
- [ ] P7.7: capture pitch at photograph time on iOS, so the pose does not depend on recovering it from the picture.
- [ ] R-2: reconcile `src/cv/rays.ts:profileCoverage` onto the exact coverage notion in `src/core/horizon.ts`.
- [ ] R-3: decide whether `'nearest-valid'` stays discontinuous at a grid line, and record the decision either way.
- [ ] X-4: reconcile FINDINGS.md's X-4 row with the height-sensitivity note now in the Kerry Park case file.
- [ ] Check Wave 2's suspicion that a non-finite `groundElevationM` yields an empty overlay rather than a refusal.
- [ ] Fix `buildNotes` counting foreground-occluded peaks that are behind the camera.
- [ ] Close the export/pose race: clicking Export mid-rebuild can write a PNG whose labels belong to the old pose.
- [ ] Decide what `missingTilesFor` should ask for when an `HttpTerrainStore` serves windows, not SRTM tiles.

## Blocked on network egress, not on code

- [ ] Cross-check src/core/celestial against a third ephemeris; NOAA, USNO and JPL Horizons all 403 at the proxy.
- [ ] P2.4: record `fixtures/api/**` from live OpenTopoData and Overpass — both 403 at the proxy.
- [ ] P6.2: re-verify the four ground-truth case coordinates against live sources — Wikipedia, parks.ca.gov, seattle.gov all 403.
