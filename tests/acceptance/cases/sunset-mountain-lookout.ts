/**
 * PHOTO CASE — SUNSET MOUNTAIN LOOKOUT, BOISE MOUNTAINS, IDAHO
 * ═══════════════════════════════════════════════════════════════════════════
 * Photograph: `fixtures/photos/real/lookout-snow-haze.jpeg`, supplied
 * 2026-08-17. Snow, white haze, and a lookout's window frame across the left
 * quarter of the image.
 *
 * This is the first case in the set built around a REAL photograph rather than
 * a viewpoint someone else wrote about, and it is deliberately the weaker of
 * the two: the skyline extractor reads it at 1.4 % coverage and says so (see
 * docs/CV-REAL-PHOTO-FINDING.md, owned elsewhere). Nothing in this file depends
 * on the extractor, because nothing in this file makes a claim about the frame.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS ESTABLISHED, AND HOW
 * ───────────────────────────────────────────────────────────────────────────
 * The position is not a guess and not read off a map by eye. `Sunset Mountain`
 * is a summit node in the Overture/OSM import committed at
 * `fixtures/peaks/regions/idaho-central/`, and SRTM agrees with its tagged
 * height at its own coordinate:
 *
 *     Overture / OSM summit node   43.89851 N, 115.64677 W   2393 m (ele tag)
 *     SRTM N43W116, same point                               2392.296 m
 *     National Historic Lookout Register                     7,869 ft = 2398.5 m
 *
 * Two of those three are wholly independent of each other — an OSM tag and a
 * radar DEM — and they agree to 0.7 m. The third, a register of lookout
 * structures, sits 6 m above both, which is the ordinary disagreement between a
 * structure's quoted elevation and the ground under it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS NOT ESTABLISHED — AND IS THEREFORE ASSERTED NOWHERE
 * ───────────────────────────────────────────────────────────────────────────
 * • THE VIEW BEARING. The file's EXIF carries orientation and pixel dimensions
 *   and nothing else: no GPS, no `GPSImgDirection`, no focal length. That is
 *   asserted from the committed bytes in photo-cases.test.ts, so "unmeasured"
 *   is a checked fact here, not a note. `view.bearingDeg` is `null` and the
 *   type will not accept a number.
 * • WHICH SUMMITS ARE IN THE FRAME. Nobody has established one. The nearest
 *   named summit other than the observer's own is 7.6 km away, so this
 *   photograph may well contain no named summit at all — which is precisely why
 *   guessing a must-see list from geometry would be inventing ground truth.
 * • THE CAMERA'S HEIGHT ABOVE THE GROUND. The lookout is an R-6 cab on a 10-foot
 *   concrete base with a walk-around catwalk, so a photograph taken from the
 *   catwalk sits about 3 m higher than one taken standing on the summit. The
 *   case records 1.6 m and says so; no assertion here is sensitive to it.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ONE MEASURED FACT ABOUT THE COMMITTED WINDOW, WORTH KNOWING EARLY
 * ───────────────────────────────────────────────────────────────────────────
 * The 6 km window's highest sample is 2471 m, at 43.95222 N, 115.7075 W — about
 * 78 m ABOVE the lookout, in the box's north-west corner. So the lookout is not
 * the local high point in every direction, and whoever eventually recovers a
 * bearing for this photograph should not assume a clean horizon to the
 * north-west. Recorded as a reading of the DEM, gating nothing.
 */

import type { PhotoCase } from './photo-case-types';

export const sunsetMountainLookoutCase: PhotoCase = {
  id: 'sunset-mountain-lookout',
  title: 'Sunset Mountain Lookout, Boise National Forest, Boise County, Idaho',

  photo: {
    path: 'fixtures/photos/real/lookout-snow-haze.jpeg',
    widthPx: 5712,
    heightPx: 4284,
    orientation: 1,
    absentFields: [
      'lat',
      'lon',
      'gpsAltitudeM',
      'imgDirectionDeg',
      'imgDirectionRef',
      'focalLengthMm',
      'focalLength35mmMm',
      'hFovDeg',
      'vFovDeg',
    ],
    note:
      'EXIF did not survive the upload path that produced THIS file: ' +
      'orientation and dimensions only. The absent fields are asserted absent, ' +
      'which is what makes the missing view bearing a measured fact rather ' +
      'than an assumption. The camera original below settles WHY they are ' +
      'missing, and the answer differs field by field.',
    original: {
      path: 'fixtures/photos/real/lookout-snow-haze.heic',
      // What the original recovered: the lens, and only the lens. Exact
      // equality — a transcription is right or wrong, not close.
      exif: {
        focalLengthMm: 6.764999866370901,
        focalLength35mmMm: 24,
        hFovDeg: 73.73979529168804,
        vFovDeg: 58.71550708558255,
      },
      // AND WHAT IT DID NOT. This is the load-bearing half of this block and
      // the reason the field exists at all. The Railroad Ridge original
      // recovered everything its transcode had lost, and the schema was
      // written assuming that is what an original does. This one recovered the
      // lens and nothing else: the GPS IFD is absent from the CAMERA FILE.
      //
      // So the photograph was never geotagged — not stripped in transit, never
      // recorded. That converts "we have not got the heading yet" into "there
      // is no heading to get from this file", which is a different and final
      // answer, and it is asserted here against the committed bytes rather
      // than written in a comment.
      absentFromOriginalToo: [
        'lat',
        'lon',
        'gpsAltitudeM',
        'imgDirectionDeg',
        'imgDirectionRef',
      ],
      sameImageEvidence:
        'Both decode to 5712 x 4284 with Orientation 1, both are iPhone 17 Pro, ' +
        'and the original\'s DateTimeOriginal is 2026-02-21 11:45:51 -07:00. ' +
        'NOT a pixel comparison — unlike the Railroad Ridge pair, this one has ' +
        'not been checked channel by channel, and the frame match plus the ' +
        'device and timestamp is what is claimed. Weaker evidence, stated as ' +
        'weaker; nothing in this case depends on which of the two files the ' +
        'pixels came from, because the original supplies no position and no ' +
        'heading for anything to depend on.',
      note:
        'iPhone 17 Pro, 2026-02-21 11:45:51 -07:00, 24 mm-equivalent. Supplied ' +
        '2026-08-17 in answer to a direct request for it. The request expected ' +
        'a position and got a definitive absence instead, which is a better ' +
        'outcome than an open question: see the companion-photo source below ' +
        'for where a position for this viewpoint does now come from.',
    },
  },

  terrainWindowCaseId: 'sunset-mountain-lookout',

  observer: {
    lat: 43.89851,
    lon: -115.64677,
    // The OSM `ele` tag on the summit node, carried through Overture.
    groundElevationM: 2393,
    // 5 m spans the OSM/SRTM disagreement (0.7 m) with room for the DEM's own
    // posting-versus-summit behaviour on a rounded top. It does NOT span the
    // lookout register's 2398.5 m, which is handled as its own cross-check
    // because it is a claim about a structure, not about the ground.
    groundElevationUncertaintyM: 5,
    eyeHeightM: 1.6,
    eyeHeightNote:
      'A standing observer on the summit. The lookout is an R-6 flat cab on a ' +
      '10-foot (3.0 m) concrete base with a catwalk open to visitors, so a ' +
      'photograph taken from the catwalk is roughly 3 m higher. Which of the ' +
      'two this photograph is, nobody has established — so the ordinary ' +
      'standing figure is used and the ambiguity is recorded here rather than ' +
      'resolved by preference. No assertion in this case depends on it.',
    positionSourceId: 'overture-idaho-central',
    elevationSourceId: 'overture-idaho-central',
    crossChecks: [
      {
        valueM: 2392.296,
        sourceId: 'srtm-window-sunset-mountain-lookout',
        agreementToleranceM: 1,
        note:
          'The figure docs/IDAHO-PHOTO-CASES.md records for SRTM N43W116 at ' +
          'this coordinate. Comparing the committed WINDOW against it is a ' +
          'fixture-integrity check, not an independent one: both are the same ' +
          'radar data. What it catches is a window cut from the wrong rows or ' +
          'columns, which would be wrong by tens of metres, not by one.',
      },
      {
        valueM: 2398.5,
        sourceId: 'nhlr-sunset-mountain',
        agreementToleranceM: 15,
        note:
          '7,869 ft on the National Historic Lookout Register. Genuinely ' +
          'independent of both OSM and SRTM, and it agrees to 6 m. The ' +
          'tolerance is wide because a register of STRUCTURES quotes the ' +
          'lookout, and this figure and the DEM are not measuring the same ' +
          'thing to the metre.',
      },
    ],
  },

  view: {
    bearingDeg: null,
    measured: false,
    note:
      'UNMEASURED. The photograph carries no GPSImgDirection (asserted from ' +
      'the file), and no independent record of where the camera pointed ' +
      'exists. Recovering it from the terrain is what src/cv\'s aligner is ' +
      'for; on this photograph the skyline extractor reaches only 1.4 % ' +
      'coverage, so this is the case least likely to yield one. Until a ' +
      'bearing exists, no framing claim of any kind belongs in this file.',
    plausibleArcDeg: null,
  },

  peakDataset: {
    region: 'idaho-central',
    indexPath: 'fixtures/peaks/regions/idaho-central/index.json',
    queryRadiusKm: 25,
    namedSummitsWithinRadius: 15,
  },

  summits: [
    {
      name: 'Sunset Mountain',
      peakId: 'overture/e5bc1bb9-c413-3c04-8f4f-18e76ddd156e',
      location: { lat: 43.89851, lon: -115.64677 },
      elevationM: 2393,
      bearingDeg: null,
      distanceKm: 0,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The observer IS this summit: the lookout stands on it, so the camera ' +
        'is on top of the mountain rather than looking at it. There is no ' +
        'bearing to state and no visibility question to answer. It is recorded ' +
        'because it is the record the position itself came from.',
    },
    {
      name: 'Pilot Peak',
      peakId: 'overture/b9591f32-f380-3ec6-9e91-574ad7e9c39f',
      location: { lat: 43.96015, lon: -115.68684 },
      elevationM: 2466,
      bearingDeg: 334.9,
      distanceKm: 7.568,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: false,
      unresolved:
        'The nearest named summit to the lookout, and 73 m higher than it. ' +
        'Whether it is in this photograph is unknown: there is no view ' +
        'bearing, and it stands beyond the committed 6 km window, so the ' +
        'terrain between here and there has not been read either.',
    },
    {
      name: 'Freeman Peak',
      peakId: 'overture/3fd52a5d-faac-37b4-89c2-22fe839112b6',
      location: { lat: 43.95118, lon: -115.70758 },
      elevationM: 2467,
      bearingDeg: 320.3,
      distanceKm: 7.617,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'Falls inside the committed window\'s north-west corner but outside ' +
        'the 6 km sweep the window is sized for, so even the terrain layer has ' +
        'nothing to say about it yet. No view bearing, no claim.',
    },
    {
      name: 'Wilson Peak',
      peakId: 'overture/beafc763-a091-3b4f-a014-56d8be437be2',
      location: { lat: 43.96684, lon: -115.75067 },
      elevationM: 2382,
      bearingDeg: 312.4,
      distanceKm: 11.267,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: false,
      unresolved:
        'Recorded to give the north-western arc a third point of reference. ' +
        '11 m LOWER than the lookout and 11 km out, so it is the sort of ' +
        'summit a horizon pipeline can plausibly get wrong in either ' +
        'direction — which is exactly why it is not asserted in either.',
    },
  ],

  visibility: {
    status: 'unverified',
    blockedOn:
      'A view bearing. Either recovered from the terrain by src/cv (this ' +
      'photograph is the hard one — 1.4 % skyline coverage) or supplied by the ' +
      'photographer.',
    note:
      'No summit in this case is asserted visible or hidden, in either ' +
      'direction. Deriving such a list from the pipeline\'s own geometry would ' +
      'make the pipeline its own ground truth (AGENTS.md "Independent expectations"). This mirrors ' +
      'the `disputed` category in case-types.ts, which the suite reports and ' +
      'never fails on — the difference being that `disputed` records a ' +
      'conflict between sources, while this records the absence of any.',
  },

  sources: [
    {
      id: 'overture-idaho-central',
      title:
        'Committed Overture Maps import of central Idaho (release 2026-06-17.0, ' +
        'base/land, class peak|volcano|ridge) — 709 named summits in 12 cells',
      locator: 'fixtures/peaks/regions/idaho-central/index.json',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Positions are the midpoint of Overture\'s float32 bbox (sub-metre for ' +
        'a point feature); heights are the OpenStreetMap `ele` tag carried ' +
        'through unchanged, never DEM samples. The index carries its own ' +
        'upstream citation and licence (© OpenStreetMap contributors, ODbL-1.0).',
    },
    {
      id: 'srtm-window-sunset-mountain-lookout',
      title:
        'Committed SRTM1 window for this case: 406 x 559 samples cut ' +
        'byte-for-byte from N43W116 at row 162, column 990',
      locator: 'fixtures/tiles/cases/sunset-mountain-lookout-window.json',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Public-domain SRTM1 via the AWS elevation-tiles-prod "skadi" mirror. ' +
        '0 voids, 1404-2471 m. Its sidecar states what the window can and ' +
        'cannot prove; regenerate with `npm run fixtures:case-tiles`.',
    },
    {
      id: 'companion-photo-6812',
      title:
        'A GEOLOCATED PHOTOGRAPH FROM THE SAME VISIT, 79 seconds later: ' +
        'idaho-6812-14mm.heic, 2026-02-21 11:47:10 -07:00, iPhone 17 Pro Max, ' +
        'GPS 43.898708 N 115.646797 W, GPSImgDirection 298.295 deg T',
      locator: 'fixtures/photos/real/idaho-6812-14mm.heic',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'THE ONLY INSTRUMENT-MEASURED POSITION THIS VIEWPOINT HAS. The lookout ' +
        'photograph itself was never geotagged, so until this arrived the ' +
        'observer coordinate was an INFERENCE: the photographer named the place ' +
        'and the case took the summit node\'s coordinate. This is a GPS fix ' +
        'from a different phone standing at the same spot 79 seconds later, and ' +
        'it lands 22 m from that inferred position — inside SRTM1\'s 30 m ' +
        'posting, so no computed quantity here can tell the two apart. ' +
        'WHAT IT IS NOT: it is not this photograph\'s position, and its own ' +
        'heading of 298.295 deg is NOT transferable — the two frames were shot ' +
        'over a minute apart on different devices and nothing says they faced ' +
        'the same way. The heading stays unmeasured. A companion of the SAME ' +
        'visit bounds the motion: idaho-6815-24mm.heic, 2 min 41 s after this ' +
        'one, is 42.5 m away, which is the order of walking-about to allow for.',
    },
    {
      id: 'nhlr-sunset-mountain',
      title:
        'Sunset Mountain Lookout — National Historic Lookout Register ' +
        '(registered October 2011; elevation 7,869 ft; R-6 flat cab of 1958 on ' +
        'a 10-foot concrete base of 1930)',
      locator: 'https://nhlr.org/lookouts/us/id/sunset-mountain-lookout/',
      retrieved: '2026-08-17',
      access: 'via-search-index',
      note:
        'Egress to nhlr.org is blocked by this build sandbox (the fetch was ' +
        'attempted and refused), so this was read through the web-search index. ' +
        'The elevation and the 10-foot base should be re-verified against the ' +
        'live page before either is relied on for anything tighter than the ' +
        '15 m cross-check it backs here.',
    },
    {
      id: 'idaho-photo-cases-doc',
      title:
        'docs/IDAHO-PHOTO-CASES.md — the running record of what was established ' +
        'about these two photographs, and how',
      locator: 'docs/IDAHO-PHOTO-CASES.md',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Where the SRTM reading of 2392.296 m and the 1.4 % extractor coverage ' +
        'are recorded, with the work that produced them.',
    },
    {
      id: 'photographer-supplied-photo',
      title: 'The photograph itself, supplied by the photographer on 2026-08-17',
      locator: 'fixtures/photos/real/lookout-snow-haze.jpeg',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Committed as bytes. EXIF: orientation 1, 5712 x 4284 px, nothing else ' +
        '— no GPS and no GPSImgDirection, which the suite asserts.',
    },
  ],

  caveats: [
    'The observer coordinate is the Overture/OSM SUMMIT NODE, not a fix from ' +
      'this photograph, which was never geotagged — its camera original is ' +
      'committed and the absence is asserted against those bytes. Since ' +
      '2026-08-17 the inference is corroborated by an independent instrument: ' +
      'a companion photograph from the same visit, 79 s later on a different ' +
      'phone, whose GPS fix is 22 m away. That is real corroboration and it is ' +
      'still not a fix for THIS frame; a photographer at a lookout moves tens ' +
      'of metres, and the same visit\'s next frame is 42.5 m from the first.',
    'The observer coordinate is the OSM SUMMIT NODE, not a GPS fix from the ' +
      'camera. It is used because the lookout stands on the summit, but the ' +
      'two are not the same claim: a photograph taken from the road a hundred ' +
      'metres below would carry the same story and a different horizon. ' +
      'Nothing here should be promoted to a visibility gate until the position ' +
      'is confirmed by the photographer.',
    'The nearest named summit other than the observer\'s own is 7.6 km away, ' +
      'so this photograph may contain NO named summit at all. That possibility ' +
      'is the strongest argument against writing a must-see list for it.',
    'The committed window stops at 6 km. It is sized to the viewpoint and its ' +
      'own ridge, because this case asserts no visibility; a window sized to a ' +
      'visibility claim would have to reach at least Pilot and Freeman Peaks ' +
      'and would need recutting (one command, `npm run fixtures:case-tiles`).',
    'The lookout register\'s 7,869 ft was read through the web-search index. ' +
      'It is the only remote source in this case and it backs the widest ' +
      'tolerance in it.',
    'The window\'s highest sample (2471 m, 43.95222 N 115.7075 W) stands 78 m ' +
      'above the lookout to the north-west. The viewpoint is not a local ' +
      'maximum in every direction.',
  ],
};
