/**
 * What unit `GPSSpeed` is in, across every camera original in the repository.
 *
 *   npx tsx scripts/probes/img-7270-heading/exif-units.ts
 *
 * EXIF stores speed with a separate `GPSSpeedRef`: `K` is kilometres per hour,
 * `M` miles per hour, `N` knots. There is no metres-per-second code, so a bare
 * `GPSSpeed` value read as m/s is wrong by whatever the reference says — a
 * factor of 3.6 for `K`.
 *
 * This prints the tag, its reference and the value in m/s for every photograph
 * under `fixtures/photos/real/`, together with the fields that put IMG_7270's
 * conditions next to the other frames: the model and the iOS build.
 *
 * It writes nothing, and prints no coordinate.
 */

import { readdir } from 'node:fs/promises';

import { PHOTO_DIR, numberTag, readRawTags, stringTag, type RawTags } from './inputs.js';

/** Metres per second per unit of `GPSSpeed`, by `GPSSpeedRef`. */
const METRES_PER_SECOND: Readonly<Record<string, number>> = {
  K: 1000 / 3600,
  M: 1609.344 / 3600,
  N: 1852 / 3600,
};

function row(name: string, tags: RawTags): string {
  const speed = numberTag(tags, 'GPSSpeed');
  const ref = stringTag(tags, 'GPSSpeedRef');
  const factor = ref === undefined ? undefined : METRES_PER_SECOND[ref];
  const inMetres =
    speed === undefined || factor === undefined ? '        —' : (speed * factor).toFixed(3);
  return [
    name.padEnd(26),
    (stringTag(tags, 'Model') ?? '—').padEnd(18),
    `iOS ${(stringTag(tags, 'Software') ?? '—').padEnd(7)}`,
    `speed ${speed === undefined ? '     —' : speed.toFixed(4).padStart(8)}`,
    `ref ${(ref ?? '—').padEnd(2)}`,
    `= ${inMetres} m/s`,
    `dir ${(numberTag(tags, 'GPSImgDirection')?.toFixed(3) ?? '—').padStart(8)} ${
      stringTag(tags, 'GPSImgDirectionRef') ?? ''
    }`,
  ].join('  ');
}

async function main(): Promise<void> {
  const names = (await readdir(PHOTO_DIR))
    .filter((name) => /\.(heic|heif|jpe?g)$/i.test(name))
    .sort();

  let withSpeed = 0;
  const refs = new Set<string>();
  for (const name of names) {
    let tags: RawTags;
    try {
      tags = await readRawTags(name);
    } catch (error) {
      console.log(`${name.padEnd(26)}  unreadable: ${String(error)}`);
      continue;
    }
    if (numberTag(tags, 'GPSSpeed') !== undefined) {
      withSpeed += 1;
      const ref = stringTag(tags, 'GPSSpeedRef');
      if (ref !== undefined) refs.add(ref);
    }
    console.log(row(name, tags));
  }

  console.log(
    `\n  ${String(withSpeed)} frames record GPSSpeed; GPSSpeedRef values seen: ` +
      `${[...refs].sort().join(', ')}`,
  );
  console.log('  K is kilometres per hour, so a GPSSpeed value divided by 3.6 is metres per second.');
}

await main();
