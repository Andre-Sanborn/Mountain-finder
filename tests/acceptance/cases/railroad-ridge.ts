/**
 * PHOTO CASE — RAILROAD RIDGE ROAD, WHITE CLOUD MOUNTAINS, IDAHO
 * ═══════════════════════════════════════════════════════════════════════════
 * Photograph: `fixtures/photos/real/tundra-blue-sky.jpeg`, supplied 2026-08-17.
 * Broad tundra foreground, a jagged rock skyline, snowfield against bright
 * cloud on the left and dark rock against blue sky on the right.
 *
 * This is the strong half of the pair. The skyline extractor resolves 506 of
 * 512 columns on it (98.8 % coverage, mean confidence 0.575), so it is the one
 * photograph in this repository on which recovering a heading from terrain is a
 * realistic prospect. It still has no heading today, and this file asserts
 * nothing that would need one.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS ESTABLISHED, AND HOW
 * ───────────────────────────────────────────────────────────────────────────
 *     Photographer   44°08'20.4"N 114°35'44.5"W  =  44.13900, −114.59569
 *     SRTM N44W115 at that point                    3166.1 m = 10,387 ft
 *     Published Railroad Ridge crest                10,433 ft = 3180 m
 *
 * The middle line is a reading of the same radar data the committed window
 * holds, so it is a FIXTURE-INTEGRITY check and is labelled as one. The third
 * is the independent one: a published elevation for the ridge this road runs
 * along, 14 m above the DEM at the supplied point — which is what a point ON a
 * ridge road should read against the ridge's own high point. A coordinate typed
 * wrong by a digit lands in a valley and misses by hundreds of metres.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE VIEW BEARING — MEASURED 2026-08-17, AND WHERE IT CAME FROM
 * ───────────────────────────────────────────────────────────────────────────
 * Until 2026-08-17 this block read "NOT ESTABLISHED", because the committed
 * JPEG carries orientation and dimensions and nothing else. That was a true
 * statement about the FILE and a false one about the photograph: the JPEG is a
 * transcode whose share path dropped the whole GPS IFD.
 *
 * The photographer then supplied the camera original,
 * `fixtures/photos/real/railroad-ridge-48mm.heic`, and its EXIF is intact:
 *
 *     GPSImgDirection      174.08944701476096, GPSImgDirectionRef 'T'
 *     GPSLatitude/Longitude    44.139125 N, 114.595650 W
 *     GPSAltitude              3165.65 m  (SRTM reads 3166.1 m here — 0.4 m)
 *     FocalLengthIn35mmFormat  48 mm   ->  hFOV 41.11 deg, vFOV 31.42 deg
 *
 * That the original is the SAME PICTURE as the committed JPEG is not assumed.
 * Both decode to 4032 x 3024, and comparing them pixel for pixel gives a mean
 * |dRGB| of 1.03/255 with a maximum of 18 — the residue of a JPEG transcode
 * and a Display-P3 profile, not two different photographs.
 *
 * The heading is a phone magnetometer reading. It is TRUE-referenced (ref 'T',
 * so declination is already applied) and it is NOT of survey quality; no
 * uncertainty is stated because none is published, and inventing +-10 deg
 * because it sounds like the right order of magnitude is the same sin as
 * inventing the bearing was. What IS recorded, as corroboration and nothing
 * more, is that this repository's own aligner — given the correct lens and a
 * +-25 deg window — independently returns 174.893 deg from the terrain, 0.804
 * deg away. Two unrelated instruments agreeing to under a degree is the
 * strongest statement available here, and it is still not an error bar.
 *
 * AND ONE THING EXIF DOES NOT CARRY AT ALL: PITCH. Every run assumes zero, and
 * on this photograph zero is wrong by 3.52 deg — the camera was pointed down,
 * which is why the frame is half tundra. That is the largest single error in
 * the first annotated render, larger than either heading estimate's. It is not
 * recorded in `view` because `view` is about where the camera POINTED in
 * bearing; it is recorded here so nobody reads the measured heading as though
 * it settled the pose.
 *
 * ONE CONSEQUENCE WORTH STATING PLAINLY: every alignment run before this date
 * assumed a 26 mm-equivalent lens, hFOV 69.4 deg, because the stripped JPEG
 * named no focal length. The true frame is 41.1 deg — a 1.69x error in image
 * scale. Sweeping the whole compass in 24 windows under the wrong lens produces
 * an answer in NONE of them; under the right lens the window containing the
 * truth is the only one that both survives its gates and holds the lowest
 * residual of all 24 (1.112 deg). The aligner was not the thing that was wrong.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * WHAT IS STILL NOT ESTABLISHED — AND IS THEREFORE ASSERTED NOWHERE
 * ───────────────────────────────────────────────────────────────────────────
 * • WHICH SUMMITS ARE IN THE FRAME. Seventeen named summits stand within the
 *   7.5 km window and thirty-two within 25 km; several of them are within a few
 *   degrees of one another from here. Picking the ones the pipeline would
 *   compute and calling them ground truth is precisely the circularity
 *   AGENTS.md "Independent expectations" forbids.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * ONE MEASURED FACT ABOUT THE COMMITTED WINDOW
 * ───────────────────────────────────────────────────────────────────────────
 * The window's highest sample is 3503 m at 44.11833 N, 114.62083 W — 268 m east
 * of the Calkens Peak node, whose tagged height is 3509 m. So SRTM under-reads
 * this summit by 6 m AND displaces its maximum by a quarter of a kilometre,
 * which is the behaviour MISSION.md documents for sharp tops and the reason
 * summit heights in this case come from the peak dataset and never from these
 * bytes. Recorded as a DEM reading; it gates nothing.
 */

import type { PhotoCase } from './photo-case-types';

export const railroadRidgeCase: PhotoCase = {
  id: 'railroad-ridge',
  title: 'Railroad Ridge Road (FR 669), White Cloud Mountains, Custer County, Idaho',

  photo: {
    path: 'fixtures/photos/real/tundra-blue-sky.jpeg',
    widthPx: 4032,
    heightPx: 3024,
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
      'orientation and dimensions only. It is a transcode, and the camera ' +
      'original recorded below is where the position, heading and lens come ' +
      'from. The stripping is specific and worth naming — the APP1 segment ' +
      'survives at 9 564 bytes and the ICC Display-P3 profile survives, while ' +
      'the entire GPS IFD is gone.',
    original: {
      path: 'fixtures/photos/real/railroad-ridge-48mm.heic',
      // Every number this case takes from EXIF, re-read from the bytes by the
      // suite, and compared with EXACT equality — these are transcriptions, and
      // a transcription is right or wrong, not close.
      //
      // Hence -114.59564999999999 rather than the -114.59565 a person would
      // write. GPS coordinates are stored as three rationals and reconstructed
      // as `deg + min/60 + sec/3600`, so the result is whatever double that
      // arithmetic lands on; -114.59565 is a DIFFERENT double and comparing
      // against it fails. What is written here is the shortest decimal that
      // round-trips to the value the file yields. Rounding it and loosening the
      // comparison to compensate would trade a check that catches a wrong file
      // for one that only catches a very wrong file.
      exif: {
        lat: 44.139125,
        lon: -114.59564999999999,
        gpsAltitudeM: 3165.6544715447153,
        imgDirectionDeg: 174.08944701476096,
        imgDirectionRef: 'T',
        focalLengthMm: 6.764999866370901,
        focalLength35mmMm: 48,
        // Derived by src/exif/fov.ts, not stored in the file — pinned here
        // because these two angles are what every alignment run consumes, and
        // getting them wrong is precisely what went wrong before 2026-08-17.
        // The frame itself (4032 x 3024, orientation 1) is asserted against
        // `photo.widthPx`/`heightPx`/`orientation` above rather than repeated.
        hFovDeg: 41.11209043916693,
        vFovDeg: 31.417275658031485,
      },
      // Nothing: this original recovered every field the transcode lost. The
      // Sunset Mountain one did not, which is why the list exists.
      absentFromOriginalToo: [],
      sameImageEvidence:
        'Both decode to 4032 x 3024, and a pixel-for-pixel comparison of the ' +
        'two gives mean |dRGB| = 1.03/255 with a maximum of 18 across all ' +
        '36 578 304 channel samples. That is a JPEG transcode of a Display-P3 ' +
        'HEIC, not a different photograph. Checked with heic-decode + jpeg-js ' +
        'on 2026-08-17; the comparison is not in the offline suite because ' +
        'decoding HEIC pixels needs a dependency the suite does not carry, and ' +
        'the EXIF assertions below need only exifr, which already reads HEIC.',
      note:
        'iPhone 15 Pro Max, 2024-11-09 15:10:27 -07:00, 6.765 mm lens at f/1.78 ' +
        '= 48 mm-equivalent (the 2x telephoto crop). Supplied by the ' +
        'photographer on 2026-08-17 specifically to recover the heading, after ' +
        'the transcoded JPEG had been in the repository for a day.',
    },
  },

  terrainWindowCaseId: 'railroad-ridge',

  observer: {
    lat: 44.139,
    lon: -114.59569,
    // SRTM N44W115 at the supplied coordinate. NOT an independent source for
    // this position — see the cross-check below for the one that is.
    groundElevationM: 3166,
    // Tight on purpose: this figure is a reading of the very data the committed
    // window holds, so anything but agreement means the window was cut wrong.
    groundElevationUncertaintyM: 2,
    eyeHeightM: 1.6,
    eyeHeightNote:
      'A standing observer. Railroad Ridge Road is a high-clearance 4WD track ' +
      'and a photograph taken from a vehicle would sit roughly a metre higher; ' +
      'which this is has not been established. No assertion here depends on it.',
    positionSourceId: 'photographer-supplied-position',
    elevationSourceId: 'srtm-window-railroad-ridge',
    crossChecks: [
      {
        valueM: 3166,
        sourceId: 'idaho-photo-cases-doc',
        agreementToleranceM: 2,
        note:
          'The reading docs/IDAHO-PHOTO-CASES.md records for SRTM N44W115 at ' +
          'this coordinate (3166.0 m = 10,387 ft). Same radar data as the ' +
          'window, so this is a fixture-integrity check: it catches a window ' +
          'cut from the wrong rows or columns, not a wrong position.',
      },
      {
        valueM: 3180,
        sourceId: 'dangerousroads-railroad-ridge',
        agreementToleranceM: 30,
        note:
          'Railroad Ridge is published as 3,180 m / 10,433 ft, the high point ' +
          'of the road. Independent of both the photographer and the DEM. The ' +
          'camera stands 14 m below it, which is what a point ON a ridge road ' +
          'rather than at its summit should read — the check that matters is ' +
          'that this is metres, not the hundreds a mistyped coordinate gives.',
      },
    ],
  },

  view: {
    bearingDeg: 174.08944701476096,
    measured: true,
    bearingRef: 'T',
    bearingSourceId: 'railroad-ridge-48mm-original',
    // No published figure exists for an iPhone magnetometer's heading accuracy,
    // so none is stated. See the note: what is available instead is a second
    // instrument agreeing, which is corroboration and not an error bar.
    uncertaintyDeg: null,
    corroborationDeg: {
      bearingDeg: 174.893,
      method:
        "This repository's own aligner (src/cv/align.ts): the skyline extracted " +
        'from the photograph, correlated against an SRTM horizon profile swept ' +
        '30 km at 0.25 deg / 90 m from the EXIF position, searching +-25 deg of ' +
        'heading and +-10 deg of pitch under the EXIF lens.',
      note:
        'REPORTED, NOT ASSERTED, and it must never become the case\'s bearing: ' +
        'a heading this repository computed cannot also be the ground truth ' +
        'this repository is graded against (AGENTS.md "Independent expectations"). Terrain and ' +
        'magnetometer are wholly unrelated instruments and they land 0.804 deg ' +
        'apart. The alignment returned low-confidence, not a lock: NCC 0.578, ' +
        'margin 0.031 against a 0.03 floor, residual 1.111 deg against a 1.5 ' +
        'deg limit, recovered pitch -1.55 deg. ' +
        'AND YET IT WAS THE CLOSER OF THE TWO. Solving the pose from the ' +
        'photograph itself — Castle Peak\'s apex read off the full-resolution ' +
        'image, which neither instrument can have influenced — puts the true ' +
        'heading at 174.686 deg. The aligner missed by 0.207 deg and the ' +
        'magnetometer by 0.596 deg. The EXIF value is still what this case ' +
        'asserts, because it is the one of the three that is a tag in ' +
        'committed bytes; being asserted is about provenance, not about being ' +
        'the most accurate number in the room. See docs/REAL-PHOTO-POSE.md.',
    },
    note:
      'MEASURED, from GPSImgDirection in the camera original ' +
      'railroad-ridge-48mm.heic — 174.08944701476096 deg with ' +
      'GPSImgDirectionRef "T", so it is referenced to TRUE north and no ' +
      'declination correction is owed. It is a phone magnetometer reading, not ' +
      'a survey: fused compass headings are routinely several degrees out, and ' +
      'nothing here claims otherwise. The number was NOT recalled by the ' +
      'photographer, read off a map, or computed by this repository; it is a ' +
      'tag in committed bytes, and the suite re-reads it from those bytes ' +
      'rather than trusting this file. The frame it defines spans 153.5 to ' +
      '194.6 deg (hFOV 41.11 deg about the heading), which places Castle Peak ' +
      '(176.4 deg), Lonesome Lake Peak (190.5 deg) and Mount Andrus (191.4 ' +
      'deg) inside it and WCP-10, Lee Peak, WCP-9, White Cloud Peaks and ' +
      'Calkens Peak outside — arithmetic on the heading and the field of view, ' +
      'which is NOT a claim that any of the three is visible. Occlusion is ' +
      'unresolved and they stay unverified below.',
  },

  peakDataset: {
    region: 'idaho-central',
    indexPath: 'fixtures/peaks/regions/idaho-central/index.json',
    queryRadiusKm: 25,
    namedSummitsWithinRadius: 32,
  },

  summits: [
    {
      name: 'WCP-10',
      peakId: 'overture/e5be4fc9-feea-350c-9ac3-5aaf86364eda',
      location: { lat: 44.11758, lon: -114.60978 },
      elevationM: 3378,
      bearingDeg: 205.3,
      distanceKm: 2.634,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The nearest named summit, 212 m above the camera at 2.6 km. Almost ' +
        'certainly a prominent shape from somewhere on this ridge — but "from ' +
        'somewhere" is not "in this frame", and there is no bearing to decide ' +
        'with. The numbered White Cloud Peaks are authentic OSM names, not ' +
        'placeholders.',
    },
    {
      name: 'Calkens Peak',
      peakId: 'overture/350801c4-65c0-38fc-a07d-0cd8abc3b5e8',
      location: { lat: 44.1182, lon: -114.62418 },
      elevationM: 3509,
      bearingDeg: 224.5,
      distanceKm: 3.243,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The highest summit inside the committed window, and the one the DEM ' +
        'under-reads by 6 m while displacing its maximum 268 m east. No view ' +
        'bearing, so no claim in either direction.',
    },
    {
      name: 'WCP-9',
      peakId: 'overture/419b0ad9-bdc7-3db2-9ecd-65e8291f6ad5',
      location: { lat: 44.11146, lon: -114.62627 },
      elevationM: 3433,
      bearingDeg: 218.6,
      distanceKm: 3.916,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'Sits between WCP-10 and Calkens Peak in both bearing and range, which ' +
        'is exactly the configuration where a labelling error is invisible ' +
        'without ground truth. Unverified until a bearing exists.',
    },
    {
      name: 'Lee Peak',
      peakId: 'overture/adc5b8be-7c12-3d4a-9d99-b35c57128513',
      location: { lat: 44.10281, lon: -114.62862 },
      elevationM: 3458,
      bearingDeg: 213.2,
      distanceKm: 4.807,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved: 'In the southward arc, inside the window, and unverified. No bearing exists.',
    },
    {
      name: 'White Cloud Peaks',
      peakId: 'overture/19dba544-94a5-32bf-b28c-0bdd39c78bab',
      location: { lat: 44.09734, lon: -114.62788 },
      elevationM: 3438,
      bearingDeg: 209,
      distanceKm: 5.297,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'A node named for the whole range as well as a point in it — the sort ' +
        'of name that must never be matched on rather than on its id. ' +
        'Unverified in the frame like the rest.',
    },
    {
      name: 'Mount Andrus',
      peakId: 'overture/0776bca9-9b16-332c-aa45-718ae4a25b2d',
      location: { lat: 44.09107, lon: -114.60921 },
      elevationM: 3438,
      bearingDeg: 191.4,
      distanceKm: 5.438,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'Same tagged height as White Cloud Peaks, 18 deg apart in bearing. ' +
        'Unverified: no bearing, no claim.',
    },
    {
      name: 'Lonesome Lake Peak',
      peakId: 'overture/5bc30935-3698-3357-88f5-b14dfa636da7',
      location: { lat: 44.07531, lon: -114.61207 },
      elevationM: 3445,
      bearingDeg: 190.5,
      distanceKm: 7.202,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: true,
      unresolved:
        'The farthest summit still inside the committed window, and within a ' +
        'degree of Mount Andrus in bearing while standing 1.8 km behind it — ' +
        'an occlusion question this case is deliberately not answering.',
    },
    {
      name: 'Castle Peak',
      peakId: 'overture/203be435-c056-3359-be91-af61ed803d09',
      location: { lat: 44.0398, lon: -114.58698 },
      elevationM: 3603,
      bearingDeg: 176.4,
      distanceKm: 11.052,
      sourceId: 'overture-idaho-central',
      insideTerrainWindow: false,
      unresolved:
        'The high point of the White Clouds and the obvious anchor for the ' +
        'range — which is why it is recorded, and why it would be the ' +
        'temptation to assert. It is 11.1 km out, OUTSIDE the committed 7.5 km ' +
        'window, so even the terrain between here and there is unread: a ' +
        'window that stops short can produce a false VISIBLE. Two reasons to ' +
        'assert nothing, not one.',
    },
  ],

  visibility: {
    status: 'unverified',
    blockedOn:
      'IDENTIFICATION, no longer a bearing. The bearing arrived on 2026-08-17 ' +
      'and it narrows the question rather than answering it: three of the ' +
      'eight recorded summits fall inside the 153.5-194.6 deg frame and five ' +
      'do not, but whether the three are SEEN depends on occlusion, and ' +
      'deciding that with this repository\'s own occlusion code would make the ' +
      'pipeline its own ground truth. What is missing is an external ' +
      'identification of the summits in this frame — a person who knows the ' +
      'range naming them, or a published panorama from Railroad Ridge.',
    note:
      'No summit here is asserted visible or hidden. The eight recorded above ' +
      'are the nearest by bearing from the camera; asserting any of them would ' +
      'mean deriving the answer from the same geometry the pipeline uses, ' +
      'which is not ground truth but an echo. When a bearing exists and the ' +
      'summits in the frame are IDENTIFIED, they belong in a GroundTruthCase ' +
      'with must-see and must-not-see lists — this file is what precedes that, ' +
      'not a permanent home for it.',
  },

  sources: [
    {
      id: 'photographer-supplied-position',
      title:
        'Camera position supplied by the photographer, 2026-08-17: ' +
        '44 deg 08\' 20.4" N, 114 deg 35\' 44.5" W',
      locator: 'docs/IDAHO-PHOTO-CASES.md',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Converted to decimal degrees as 44.13900, -114.59569 (44 + 8/60 + ' +
        '20.4/3600 = 44.139000; 114 + 35/60 + 44.5/3600 = 114.595694). Read ' +
        'off the photographer\'s own mapping app; recorded in ' +
        'docs/IDAHO-PHOTO-CASES.md, which is why the locator points there. It ' +
        'is not a source anyone else can re-fetch, and it is the only position ' +
        'evidence this case has.',
    },
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
        'through unchanged, never DEM samples. Note what is NOT in it: ' +
        '"Railroad Ridge" itself, because ridges carry no `ele` tag and the ' +
        'importer drops elevation-less records rather than invent a height.',
    },
    {
      id: 'srtm-window-railroad-ridge',
      title:
        'Committed SRTM1 window for this case: 505 x 703 samples cut ' +
        'byte-for-byte from N44W115 at row 2844, column 1098',
      locator: 'fixtures/tiles/cases/railroad-ridge-window.json',
      retrieved: '2026-08-17',
      access: 'committed-in-repository',
      note:
        'Public-domain SRTM1 via the AWS elevation-tiles-prod "skadi" mirror. ' +
        '0 voids, 1886-3503 m. Its sidecar states what the window can and ' +
        'cannot prove; regenerate with `npm run fixtures:case-tiles`.',
    },
    {
      id: 'dangerousroads-railroad-ridge',
      title:
        'Railroad Ridge (FR 669), Custer County, Idaho — 3,180 m / 10,433 ft, ' +
        'described as the highest road in Idaho open to full-size vehicles',
      locator: 'https://www.dangerousroads.org/north-america/usa/6648-railroad-ridge.html',
      retrieved: '2026-08-17',
      access: 'via-search-index',
      note:
        'Read through the web-search index; direct egress is blocked by this ' +
        'build sandbox. A travel site, not a survey — which is why it backs a ' +
        '30 m tolerance and not a tighter one. It is nonetheless the only ' +
        'elevation evidence in this case that is independent of both the ' +
        'photographer and the DEM.',
    },
    {
      id: 'peakvisor-railroad-ridge',
      title: 'Railroad Ridge — PeakVisor, quoted at 2,941 m',
      locator: 'https://peakvisor.com/peak/railroad-ridge-22jhc0.html',
      retrieved: '2026-08-17',
      access: 'via-search-index',
      note:
        'Recorded as a DISAGREEING source, not as evidence. 2,941 m is 239 m ' +
        'below the published road high point and 225 m below what SRTM reads ' +
        'at the supplied coordinate, so it is most likely attached to a ' +
        'different point on the ridge. Nothing in this case uses it; it is ' +
        'here so that a later reader who finds it does not think it was ' +
        'missed.',
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
        'Where the supplied coordinate, the 3166.0 m SRTM reading, the 32 ' +
        'summits within 25 km and the 98.8 % extractor coverage are recorded, ' +
        'with the work that produced them.',
    },
    {
      id: 'photographer-supplied-photo',
      title: 'The photograph itself, supplied by the photographer on 2026-08-17',
      locator: 'fixtures/photos/real/tundra-blue-sky.jpeg',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Committed as bytes, and a TRANSCODE: orientation 1, 4032 x 3024 px, ' +
        'and no GPS IFD at all, which the suite asserts. Still the file every ' +
        'test decodes, because jpeg-js reads it with no extra dependency. The ' +
        'metadata comes from the original cited below.',
    },
    {
      id: 'railroad-ridge-48mm-original',
      title:
        'Camera original of the same frame — iPhone 15 Pro Max, 48 mm-equivalent, ' +
        '2024-11-09 15:10:27 -07:00, GPSImgDirection 174.08944701476096 deg ref T',
      locator: 'fixtures/photos/real/railroad-ridge-48mm.heic',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'THE SOURCE OF THE VIEW BEARING, and of the position and lens. Supplied ' +
        'a day after the JPEG, once it was clear the transcode had dropped the ' +
        'GPS IFD. Its GPSAltitude of 3165.65 m lands 0.4 m from what SRTM reads ' +
        'at its own stated coordinate, and its position lands 14.3 m from the ' +
        'DMS coordinate the photographer had supplied by hand — two agreements ' +
        'that were not available before it arrived. The suite re-reads every ' +
        'field this case quotes directly from these bytes. The observer below ' +
        'deliberately STAYS on the hand-supplied coordinate: 14.3 m is under ' +
        'half of SRTM1\'s 30 m posting, so no computed quantity can tell the ' +
        'two apart, and moving the case would churn every figure verified ' +
        'against the first one in exchange for nothing measurable.',
    },
    {
      id: 'railroad-ridge-wide-originals',
      title:
        'Two further originals from the same viewpoint, same minute: ' +
        'railroad-ridge-24mm.heic (173.151 deg T, 5712 x 4284) and ' +
        'railroad-ridge-14mm.heic (203.611 deg T, 4032 x 3024)',
      locator: 'fixtures/photos/real/railroad-ridge-24mm.heic',
      retrieved: '2026-08-17',
      access: 'supplied-by-photographer',
      note:
        'Committed because they are the same camera at the same position ' +
        'within the same minute at three different focal lengths — 14, 24 and ' +
        '48 mm-equivalent, hFOV 104.3 / 73.7 / 41.1 deg — each carrying its own ' +
        'independent magnetometer heading. That is a controlled test of whether ' +
        'alignment degrades with field of view, and it is not a test this ' +
        'repository could previously run. NOTHING IN THIS CASE IS DERIVED FROM ' +
        'THEM YET: see docs/FINDINGS.md CV-5, where the wide pair currently ' +
        'fails alignment at 12.9 and 9.8 deg residual while the 48 mm frame ' +
        'succeeds at 1.11 deg. That is an open finding, not a settled result.',
    },
  ],

  caveats: [
    'The position now rests on TWO readings, which is one more than it had ' +
      'before 2026-08-17 and still not two independent instruments: the ' +
      'photographer\'s hand-read DMS coordinate, and the GPS fix in the camera ' +
      'original (44.139125, -114.595650, GPSHPositioningError 2.66 m). They ' +
      'are 14.3 m apart — under half a DEM posting — so the agreement is real ' +
      'but weak evidence, since a mapping app showing the photo\'s own GPS pin ' +
      'is arguably where the hand-read coordinate came from in the first place.',
    'The elevation cited for the observer is a DEM reading, so comparing it ' +
      'with the committed DEM window is a fixture-integrity check and NOT an ' +
      'independent confirmation. The independent line is the published ridge ' +
      'crest, at 30 m tolerance.',
    'The two published elevations for Railroad Ridge disagree badly: 3,180 m ' +
      '(dangerousroads) against 2,941 m (PeakVisor). Neither could be fetched ' +
      'directly from this sandbox. The DEM sides with the former; the ' +
      'disagreement is recorded rather than resolved.',
    'The bearings and distances recorded for each summit are computed from ' +
      'the dataset\'s own coordinates and the supplied camera position, so the ' +
      'suite\'s check of them is a check of TRANSCRIPTION into this file — not ' +
      'independent verification of where those summits are. Their coordinates ' +
      'and heights carry the Overture/OSM citation and nothing stronger.',
    'Castle Peak, Patterson Peak, Merriam Peak, Blackmon Peak and Mount Frank ' +
      'stand outside the committed window. A window that stops short can ' +
      'produce a false VISIBLE and never a false hidden, so if this case ever ' +
      'grows visibility claims about them, the window has to grow first.',
  ],
};
