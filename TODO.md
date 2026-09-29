# TODO

One line per item, ordered so that nothing depends on something below it. Check an item only
after its self-check has run and passed here. The checks are in
[IMPLEMENTATION.md](IMPLEMENTATION.md); state and blockers are in [HANDOFF.md](HANDOFF.md).

## Open

- [ ] Decide the fate of the retired `claude/topographic-peak-identifier-EV4ZN` branch: keep, tag, or delete.
- [ ] Write the human phone-test runbook: install Expo Go, start the dev server, run the four holds, send the trace.
- [ ] Run the four calibration holds on a real phone and record the verdict; closes P8.2's hardware bar.
- [ ] P7.5: add a cue for soft crest steps under haze so the 24 mm and 14 mm frames report columns instead of declining.
- [ ] P7.7: capture pitch at photograph time on iOS, so the pose does not depend on recovering it from the picture.
- [ ] R-2: reconcile `src/cv/rays.ts:profileCoverage` onto the exact coverage notion in `src/core/horizon.ts`.
- [ ] R-3: decide whether `'nearest-valid'` stays discontinuous at a grid line, and record the decision either way.
- [ ] X-4: reconcile FINDINGS.md's X-4 row with the height-sensitivity note now in the Kerry Park case file.
- [ ] Check Wave 2's suspicion that a non-finite `groundElevationM` yields an empty overlay rather than a refusal.
- [ ] Fix `buildNotes` counting foreground-occluded peaks that are behind the camera.
- [ ] Close the export/pose race: clicking Export mid-rebuild can write a PNG whose labels belong to the old pose.
- [ ] Decide what `missingTilesFor` should ask for when an `HttpTerrainStore` serves windows, not SRTM tiles.
- [ ] Decide how a phone carries square degrees of DEM offline (D7), then label peaks on the Horizon screen.

## Blocked on network egress, not on code

- [ ] P2.4: record `fixtures/api/**` from live OpenTopoData and Overpass — both 403 at the proxy.
- [ ] P6.2: re-verify the four ground-truth case coordinates against live sources — Wikipedia, parks.ca.gov, seattle.gov all 403.
