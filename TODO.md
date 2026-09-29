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

- [x] Redesign field truth: three answers, landmark truth, annotator method, stop rule, south-facing capture
- [x] Update the e2e specs to write @2 truth documents
- [x] Move the field fixture generator into scripts/ with an npm script
- [x] Add a measured pitch-bias term to the live vertical band; until measured, F2 vertical is not gated
- [ ] Write the sun's frame offset into RecordedSegment.aimOffsetDeg at each aiming step
- [ ] Give protocolSegments() aiming attitudes that point at a plausible sun altitude
- [ ] Make docs/REAL-PHOTO-POSE.md and FINDINGS X-7's photo counts agree with the nine-photo count
- [ ] Re-run the rehearsal at a 956x440 viewport over a 1920x1080 camera, without cropToAspect
- [x] Separate refusals from notes in the field report

- [x] Re-run the Bogus Basin rehearsal at the solved pose (187.9°, −4.94°), Deer Point as anchor, grade other features
- [ ] Grade the re-run rehearsal against @2 truth from two independent annotators
- [x] Let the field anchor picker offer crowded-out summits, and force-label the one picked
- [x] Make the anchor-drift warning compare the compass change with the phone's own turn
- [ ] Refresh the rehearsal spec's drift-line notes; they still describe the compass-only check
- [ ] Make `npm run annotate` warn when GPSImgDirection is the only heading source (X-10)
- [ ] Renumber the duplicate X-7 and X-8 ids in docs/FINDINGS.md

- [x] Split the gross heading offset from the fine trim; sun one-tap and named-summit re-anchor, stillness-gated
- [x] Widen field-analysis POSE_KEYS for grossHeadingOffsetDeg and its source, then flip POSE_CARRIES_GROSS_OFFSET
- [x] Add the walking-aim-at-the-sun segment to the home session and its analyzer verdict
- [x] Add the pose-level raw-heading check to F2 in the prereg and the grader, before field data
- [x] Write the IMG_7270 188° derivation as a cited doc with runnable probes (187.9° ± 0.9°, −4.94° ± 0.26°)
- [ ] Record both annotator pixels, not one agreed pixel, on the next apex read

- [x] Exclude each capture's drag anchor from F3 and F4; report its residual under F3.anchor/F4.anchor
- [x] Build the annotator reference map sheets (`npm run annotator:map -- <site>`), no pose or overlay
- [x] Test whether annotators given a top-down map can identify non-anchor summits (map: 0 graded)
- [x] Choose a field truth source that grades non-anchor summits; review it with strategy-adversary
- [ ] Rerun the aligner on IMG_7270 cropped right of the person, to isolate CV-11's cause
- [x] Pre-register the site's near-band limit, the south direction's bands, and the apex rules
- [x] Add the optional `rule` field to the @2 truth format and split the report by rule-bound/free
- [x] Register two north-east captures with a `turned` role that F2 reads and F3/F4 do not
- [x] Refresh the rehearsal spec for the 19-step session and the new drift line, then re-run it
- [x] Charge the field budget's drag anchor at the registered 2 km anchor, and regenerate §2.3's limits
- [x] Enforce the registered apex rule texts in the truth parser, keyed by summit
- [x] Qualify the north-east direction's Sun claim by season, in the pre-registration and the field guide
- [x] Make F3's unit a summit-axis medianed over its captures, with per-k drag factors and an allowance schedule
- [x] Make F4 grade the paired change over each movement, on its own distance-independent budget
- [x] Regenerate `fixtures/field/aligned-*` so a summit's error is carried into both frames of a pair
- [x] Fix F4's field-of-view term for summits crossing the axis; register Deer Point's start offset
- [x] Withhold F4 verdicts from off-protocol movements; restate pass rates under shared-term correlation
- [ ] Measure heading-dependent compass deviation over a 45° pan, and budget it or drop it
- [ ] Settle § 1.3's 0.017° against § 1.5's 0.034° for the roll's horizontal term
- [ ] Decide whether the 2 s brace should be a precondition of F3's captures as well as F4's

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
