/**
 * NOAA's published WMM2025 test values, parsed.
 *
 * `WMM2025_TestValues.txt` is committed byte-for-byte as NOAA publishes it.
 * Every number in it came from NOAA's own reference implementation, so it is an
 * external reference in the sense fixtures/README.md requires: no expectation
 * here was produced by running anything in `src/`.
 *
 * PROVENANCE
 *   source URL  https://raw.githubusercontent.com/AbdeldjalilChougui/qibla_math/main/test/data/WMM2025_TestValues.txt
 *   retrieved   2026-09-29
 *   sha256      e6975b093dddeb6153e0b23cc418425c438167e7c5b1dd795da379cb654f5819
 *
 * NOAA's own host (ngdc.noaa.gov / ncei) is blocked by this environment's
 * egress proxy, so the file came from the mirror above. See README.md here for
 * what confirmed it.
 *
 * The file is read from disk rather than imported as JSON, so the committed
 * bytes stay exactly NOAA's text with no transcription step in between. Only
 * `src/core/declination.test.ts` imports this, so no filesystem dependency
 * reaches the browser bundle.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** One row of NOAA's table. Altitude is above the WGS-84 ellipsoid, in km. */
export interface WmmTestValue {
  readonly decimalYear: number;
  readonly altitudeKm: number;
  readonly latitudeDeg: number;
  readonly longitudeDeg: number;
  readonly declinationDeg: number;
  readonly inclinationDeg: number;
  readonly horizontalNt: number;
  readonly northNt: number;
  readonly eastNt: number;
  readonly downNt: number;
  readonly totalNt: number;
}

/** Path to the committed NOAA file, for tests that want to cite it. */
export const WMM2025_TEST_VALUES_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'WMM2025_TestValues.txt',
);

/**
 * Parse the 18-column table. The first eleven columns are the position, date
 * and field elements; the remaining seven are annual rates, which this project
 * does not model and which are therefore dropped rather than half-checked.
 */
function parseTestValues(text: string): WmmTestValue[] {
  const rows: WmmTestValue[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const fields = trimmed.split(/\s+/).map(Number);
    if (fields.length !== 18 || fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`WMM test values: expected 18 numbers, got "${trimmed}"`);
    }
    const [
      decimalYear,
      altitudeKm,
      latitudeDeg,
      longitudeDeg,
      declinationDeg,
      inclinationDeg,
      horizontalNt,
      northNt,
      eastNt,
      downNt,
      totalNt,
    ] = fields as [
      number, number, number, number, number, number,
      number, number, number, number, number, ...number[],
    ];

    rows.push({
      decimalYear,
      altitudeKm,
      latitudeDeg,
      longitudeDeg,
      declinationDeg,
      inclinationDeg,
      horizontalNt,
      northNt,
      eastNt,
      downNt,
      totalNt,
    });
  }

  if (rows.length === 0) throw new Error('WMM test values: file held no data rows');
  return rows;
}

/** Every published test case, in file order. */
export const wmm2025TestValues: readonly WmmTestValue[] = parseTestValues(
  readFileSync(WMM2025_TEST_VALUES_PATH, 'utf8'),
);
