# TODO

One line per item, ordered so that nothing depends on something below it. Check an item only
after its self-check has run and passed here. The checks are in
[IMPLEMENTATION.md](IMPLEMENTATION.md); state and blockers are in [HANDOFF.md](HANDOFF.md).

## Route to the field test

- [x] Fix the portrait FOV axis in core, the phone shell and annotate-photo; re-derive the drag-trim test
- [x] Build WMM2025 declination in src/core; reproduce NOAA's test values to 0.05°; cross-check a second source
- [x] Wire src/core/declination into the live heading policy, labelled "true (model)"
- [ ] Hold the user's trim across a heading-basis change, so the first fix does not jump the overlay
- [ ] Confirm the live web screen's heading uses the WMM2025 true-model path end to end
- [x] Build sun and moon position in src/core against Meeus worked examples
- [x] Draw the sun and moon discs in the AR screen
- [x] Deploy the web app to GitHub Pages from Actions, gated on test:deploy and a no-GPS privacy check
- [ ] Confirm the first Pages run on GitHub; if enablement fails, the human sets Source to GitHub Actions
- [x] Measure the Pages artifact with and without --gzip; dropped it (88.87 MB of unservable siblings)
- [x] Add the Idaho field-site tiles to the Pages workflow's fetch:tiles line
- [x] Build the repository privacy check: no EXIF GPS or coordinate pairs in new files; wire into check
- [x] Build the web sensor adapter as a pure function of raw Safari and Chromium events
- [ ] Settle webkitCompassHeading's reference axis for an upright phone from the home recording
- [x] Build a recording schema and `analyze:recording` that scores the compass hypotheses automatically
- [x] Wire the recording schema to LiveScreen's rawEventSink so the home session can save a capture bundle
- [ ] Only if landscape fails: the iOS alpha-offset hold, re-anchored continuously, invalidated on re-base
- [ ] Settle the device-roll to screen-roll sign from the home recording
- [x] Give suggestPoseTrim tests a timeout that holds under parallel load (1.8 s alone, >5 s at load 13)
- [x] Build the Bogus Basin site package at 60 km radius, with seam and coverage tests
- [x] Import a new Overture peak region covering Bogus Basin's 60 km disc; keep idaho-central unchanged
- [ ] Decide fetch-peaks' default release now that 2026-06-17.0 is deleted upstream; pin --release in regenerate commands
- [x] Stage site packages from package:deploy and publish Bogus Basin from pages.yml
- [x] Measure the 360° annotateScene under phone-class CPU throttling (60 km: 0.64 s at 1x, 4.5 s at 6x)
- [x] Build the web AR screen in landscape: single-lens camera, live loop, drag, band, sun and moon discs
- [x] Add a service worker to live.html, so the AR screen opens with no network after one visit
- [x] Render the offline status line and the "Download Bogus Basin" button on the live screen
- [ ] Measure the real 42.55 MB download on the phone, and what iOS keeps after a week
- [x] Prefer the DEM's ground at the fix over GPS altitude on the live screen; the geoid gap reaches ~50 m
- [x] Build field-of-view calibration from taps on the sun or a landmark, stored against track settings
- [ ] Prove the automatic advance on the three-minute stillness step on a real device
- [x] Build the capture bundle schema and `analyze:field`; bundles never enter the repository
- [x] Have the live screen emit a field bundle in the field-bundle@1 shape (no bearings, no wall clock)
- [x] Register the stored frame's geometry: the grader compares 16:9 frames against the 956x440 viewport
- [ ] Have field-session.ts import the stored-frame width from field-analysis.ts's registration
- [ ] Decide from the home session's drag scatter whether the field session drags in fine mode
- [ ] Check the field bundle size before trimming: 2.4 MB in the Gornergrat e2e, 1.27 MB in the rehearsal
- [x] Write the error budget and pre-register the field pass criteria
- [x] Run the headless dress rehearsal at Bogus Basin on IMG_7270 with injected compass and pitch error
- [ ] Grade the rehearsal against apex truth from two independent annotators
- [x] Map overlay to stored frame through the cover crop in the grader; a 4:3 camera in a 16:9 view mis-scales residuals
- [ ] State the overlay-to-frame mapping in the prereg's § 2.0 and Part 3 bodies, not only its revision history
- [ ] Run the home session with the human (steps: docs/HOME-SESSION-GUIDE.md)
- [ ] Turn the home-session recording into fixtures; fix any sign or FOV error it shows
- [x] Lock the railroad-ridge CV result as a regression test, labelled n = 1
- [ ] Run the field test with the human (steps: docs/FIELD-SESSION-GUIDE.md)

- [x] Take the live sweep range from the served site (60 km at Bogus Basin), not APP_SWEEP's 30 km
- [x] Measure the 60 km live sweep in Chromium under 4-6x CPU throttling; precondition of the field session
- [ ] Measure the live start on the phone: iOS Cache Storage read of 42.55 MB, permissions, fix, first paint
- [x] Fine-drag mode (4x slow) on the live screen; home session measures drag and roll spread on screen
- [x] Add `dragTrials` to the recording schema and parser, then write the trials into the shared file
- [x] Prereg: gate F3/F4 at one 2σ exceedance and no 3σ; F4 pan to frame edge; accuracy confidence; text fixes
- [x] Emit horizontalAccuracyM and accuracyConvention from the live screen into the capture bundle
- [ ] Re-derive the drag and roll terms from the home-session measurements; record in the prereg revision history
- [x] Make the privacy gate's position-fix message say which key set tripped it; prose 'accuracy' trips it now

- [x] Fix refusals.ts iOS settings paths: Safari moved to Settings → Apps → Safari in iOS 18.2
- [x] Decide the motion-permission remedy: clear Website Data, then close the tab; hedged on screen
- [ ] Confirm the iOS 26 motion-permission remedy on the phone at the home session
- [x] Replace the field guide's provisional steps with the real screen wording once field mode lands

- [ ] Redesign field truth: agent annotators named 0 of 17 summits on the rehearsal frame (n = 1)
- [x] Add a measured pitch-bias term to the live vertical band; until measured, F2 vertical is not gated
- [ ] Write the sun's frame offset into RecordedSegment.aimOffsetDeg at each aiming step
- [ ] Give protocolSegments() aiming attitudes that point at a plausible sun altitude
- [ ] Make docs/REAL-PHOTO-POSE.md and FINDINGS X-7's photo counts agree with the nine-photo count
- [ ] Re-run the rehearsal at a 956x440 viewport over a 1920x1080 camera, without cropToAspect
- [x] Separate refusals from notes in the field report

- [ ] Re-run the Bogus Basin rehearsal at the solved pose (187.9°, −4.94°), Deer Point as anchor, grade other features
- [ ] Make `npm run annotate` warn when GPSImgDirection is the only heading source (X-10)
- [ ] Renumber the duplicate X-7 and X-8 ids in docs/FINDINGS.md

- [ ] Split the gross heading offset from the fine trim; sun one-tap and named-summit re-anchor, stillness-gated
- [ ] Add the walking-aim-at-the-sun segment to the home session and its analyzer verdict
- [ ] Add the pose-level raw-heading check to F2 in the prereg and the grader, before field data
- [x] Write the IMG_7270 188° derivation as a cited doc with runnable probes (187.9° ± 0.9°, −4.94° ± 0.26°)
- [ ] Record both annotator pixels, not one agreed pixel, on the next apex read

## Other open work

- [ ] Find a real photograph that exercises D8's self-occlusion rule; it has never fired on one
- [ ] Re-check CV-2/CV-8's 14 mm figures via `npm run annotate`: suggestPoseTrim now reads coverage 66.6 %, not 0 %
- [ ] Settle long-side vs CIPA-diagonal 35 mm equivalence against the solved Railroad Ridge pose (~2°, 3% scale)
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
