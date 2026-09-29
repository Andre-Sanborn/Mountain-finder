/**
 * World Magnetic Model 2025 Gauss coefficients. GENERATED FILE — do not edit.
 *
 * Regenerate with `npm run fixtures:wmm`
 * (scripts/make-wmm-coefficients.ts), which reads the `.COF` below.
 *
 * PROVENANCE
 *   header line   2025.0            WMM-2025     11/13/2024
 *   source URL    https://raw.githubusercontent.com/AbdeldjalilChougui/qibla_math/main/tool/data/WMM.COF
 *   retrieved     2026-09-29
 *   sha256(.COF)  dfa8597825af4e0b87ff4198a5b4fb661b3c49f4cd090cd0164e0259b075582f
 *   local copy    fixtures/wmm2025/WMM.COF
 *
 * NOAA's own host (ngdc.noaa.gov / ncei) is blocked by this environment's
 * egress proxy, so the bytes came from the mirror above. CROSS-CHECK:
 * every one of the 360 numbers below matches npm `geomagnetism@0.2.0`'s
 * data/wmm-2025.json, which was converted from NOAA WMM.COF independently
 * of this mirror.
 *
 * Units: g and h in nanotesla; the dot terms in nanotesla per year, applied
 * linearly from the epoch (secular variation).
 *
 * PACKING. All four arrays share one index, running over (n, m) in the order
 * n = 1…12, m = 0…n, with the n = 0 slot omitted:
 *
 *     index(n, m) = n·(n+1)/2 + m − 1
 *
 * Use `wmmCoefficient()` rather than indexing directly. It returns 0 for
 * m > n, which is the mathematically correct value for a coefficient that does
 * not exist, and it does not paper over an index that is out of range.
 */

/** Reference epoch of the model, in decimal years. */
export const WMM2025_EPOCH = 2025.0;

/** Model name exactly as the `.COF` header spells it. */
export const WMM2025_NAME = 'WMM-2025';

/** Release date from the `.COF` header (MM/DD/YYYY, as published). */
export const WMM2025_RELEASE_DATE = '11/13/2024';

/**
 * Maximum spherical-harmonic degree. WMM truncates at 12; the model says
 * nothing about crustal structure at finer scales, and adding degrees would
 * not make it say anything.
 */
export const WMM2025_N_MAX = 12;

/**
 * Nominal validity window, in decimal years. NOAA fits each model to a
 * five-year span and the linear secular-variation terms degrade outside it.
 */
export const WMM2025_VALID_FROM = 2025.0;
export const WMM2025_VALID_UNTIL = 2030.0;

/** Main-field cosine coefficients g(n,m) at the epoch, nT. */
export const WMM2025_G: readonly number[] = [
  -29351.8, -1410.8, -2556.6, 2951.1, 1649.3, 1361.0,
  -2404.1, 1243.8, 453.6, 895.0, 799.5, 55.7,
  -281.1, 12.1, -233.2, 368.9, 187.2, -138.7,
  -142.0, 20.9, 64.4, 63.8, 76.9, -115.7,
  -40.9, 14.9, -60.7, 79.5, -77.0, -8.8,
  59.3, 15.8, 2.5, -11.1, 14.2, 23.2,
  10.8, -17.5, 2.0, -21.7, 16.9, 15.0,
  -16.8, 0.9, 4.6, 7.8, 3.0, -0.2,
  -2.5, -13.1, 2.4, 8.6, -8.7, -12.9,
  -1.3, -6.4, 0.2, 2.0, -1.0, -0.6,
  -0.9, 1.5, 0.9, -2.7, -3.9, 2.9,
  -1.5, -2.5, 2.4, -0.6, -0.1, -0.6,
  -0.1, 1.1, -1.0, -0.2, 2.6, -2.0,
  -0.2, 0.3, 1.2, -1.3, 0.6, 0.6,
  0.5, -0.1, -0.4, -0.2, -1.3, -0.7,
];

/** Main-field sine coefficients h(n,m) at the epoch, nT. */
export const WMM2025_H: readonly number[] = [
  0.0, 4545.4, 0.0, -3133.6, -815.1, 0.0,
  -56.6, 237.5, -549.5, 0.0, 278.6, -133.9,
  212.0, -375.6, 0.0, 45.4, 220.2, -122.9,
  43.0, 106.1, 0.0, -18.4, 16.8, 48.8,
  -59.8, 10.9, 72.7, 0.0, -48.9, -14.4,
  -1.0, 23.4, -7.4, -25.1, -2.3, 0.0,
  7.1, -12.6, 11.4, -9.7, 12.7, 0.7,
  -5.2, 3.9, 0.0, -24.8, 12.2, 8.3,
  -3.3, -5.2, 7.2, -0.6, 0.8, 10.0,
  0.0, 3.3, 0.0, 2.4, 5.3, -9.1,
  0.4, -4.2, -3.8, 0.9, -9.1, 0.0,
  0.0, 2.9, -0.6, 0.2, 0.5, -0.3,
  -1.2, -1.7, -2.9, -1.8, -2.3, 0.0,
  -1.3, 0.7, 1.0, -1.4, 0.0, 0.6,
  -0.1, 0.8, 0.1, -1.0, 0.1, 0.2,
];

/** Secular variation of g(n,m), nT/year. */
export const WMM2025_G_DOT: readonly number[] = [
  12.0, 9.7, -11.6, -5.2, -8.0, -1.3,
  -4.2, 0.4, -15.6, -1.6, -2.4, -6.0,
  5.6, -7.0, 0.6, 1.4, 0.0, 0.6,
  2.2, 0.9, -0.2, -0.4, 0.9, 1.2,
  -0.9, 0.3, 0.9, 0.0, -0.1, -0.1,
  0.5, -0.1, -0.8, -0.8, 0.8, -0.1,
  0.2, 0.0, 0.5, -0.1, 0.3, 0.2,
  0.0, 0.2, 0.0, -0.1, 0.1, 0.3,
  -0.3, 0.0, 0.3, -0.1, 0.1, -0.1,
  0.1, 0.0, 0.1, 0.1, 0.0, -0.3,
  0.0, -0.1, -0.1, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, -0.1, 0.0,
  0.0, -0.1, -0.1, -0.1, -0.1, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, 0.1,
  0.0, 0.0, 0.0, -0.1, 0.0, -0.1,
];

/** Secular variation of h(n,m), nT/year. */
export const WMM2025_H_DOT: readonly number[] = [
  0.0, -21.5, 0.0, -27.7, -12.1, 0.0,
  4.0, -0.3, -4.1, 0.0, -1.1, 4.1,
  1.6, -4.4, 0.0, -0.5, 2.2, 0.4,
  1.7, 1.9, 0.0, 0.3, -1.6, -0.4,
  0.9, 0.7, 0.9, 0.0, 0.6, 0.5,
  -0.8, 0.0, -1.0, 0.6, -0.2, 0.0,
  -0.2, 0.5, -0.4, 0.4, -0.5, -0.6,
  0.3, 0.2, 0.0, -0.3, 0.3, -0.3,
  0.3, 0.2, -0.1, -0.2, 0.4, 0.1,
  0.0, 0.0, 0.0, -0.2, 0.1, -0.1,
  0.1, 0.0, -0.1, 0.2, 0.0, 0.0,
  0.0, 0.1, 0.0, 0.1, 0.0, 0.0,
  0.1, 0.0, 0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, -0.1, 0.1, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0, 0.0, -0.1,
];

/**
 * Read one coefficient out of a packed array.
 *
 * Returns 0 when m > n or n is outside 1…12: no such coefficient exists, and
 * zero is its value in every sum that would reference it. Anything else in
 * range is present, so a missing slot means the table itself is wrong and the
 * throw is the honest answer.
 */
export function wmmCoefficient(packed: readonly number[], n: number, m: number): number {
  if (m > n || m < 0 || n < 1 || n > WMM2025_N_MAX) return 0;
  const value = packed[(n * (n + 1)) / 2 + m - 1];
  if (value === undefined) throw new Error(`WMM coefficient table is short at n=${n} m=${m}`);
  return value;
}
