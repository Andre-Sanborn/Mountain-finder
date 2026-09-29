/**
 * Regenerate `src/core/wmm2025-coefficients.ts` from a WMM `.COF` file.
 *
 *   npm run fixtures:wmm            # reads fixtures/wmm2025/WMM.COF
 *   npx tsx scripts/make-wmm-coefficients.ts <path-to.COF>
 *
 * The generated module is committed. This script exists so nobody has to
 * believe a hand-typed table of 360 numbers: delete the module, run this, and
 * the file comes back identical. It also stamps the SHA-256 of the `.COF` it
 * read into the output, so a reviewer can tell which bytes produced which
 * table without re-downloading anything.
 *
 * WHY THE .COF IS COMMITTED TOO. NOAA's own host (ngdc.noaa.gov / ncei) is
 * blocked by this environment's egress proxy, so a regeneration here cannot
 * re-fetch the authoritative file. `fixtures/wmm2025/WMM.COF` keeps the chain
 * reproducible offline; `fixtures/wmm2025/README.md` records where it came
 * from and what confirmed it.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_COF = join(REPO_ROOT, 'fixtures/wmm2025/WMM.COF');
const OUTPUT = join(REPO_ROOT, 'src/core/wmm2025-coefficients.ts');

/**
 * Provenance of the committed `.COF`, recorded here rather than inferred.
 * NOAA publishes WMM.COF at
 * https://www.ncei.noaa.gov/products/world-magnetic-model, which this
 * environment cannot reach; the bytes came from the mirror below and were
 * cross-checked against a second, independent distribution.
 */
const PROVENANCE = {
  sourceUrl:
    'https://raw.githubusercontent.com/AbdeldjalilChougui/qibla_math/main/tool/data/WMM.COF',
  retrieved: '2026-09-29',
  crossCheck: [
    "every one of the 360 numbers below matches npm `geomagnetism@0.2.0`'s",
    'data/wmm-2025.json, which was converted from NOAA WMM.COF independently',
    'of this mirror.',
  ].join('\n * '),
} as const;

interface CofRow {
  readonly n: number;
  readonly m: number;
  readonly g: number;
  readonly h: number;
  readonly gDot: number;
  readonly hDot: number;
}

interface ParsedCof {
  readonly header: string;
  readonly epoch: number;
  readonly modelName: string;
  readonly releaseDate: string;
  readonly nMax: number;
  readonly rows: readonly CofRow[];
}

/**
 * Parse the fixed-layout `.COF` text: one header line, then one row per
 * (n, m) pair in ascending order, then a run of `9999…` terminator lines.
 *
 * The parser is strict on purpose. A silently dropped row would leave a
 * coefficient at zero and shift the declination by a plausible-looking
 * fraction of a degree, which is exactly the failure this project keeps
 * finding when data is trusted by shape instead of by count.
 */
function parseCof(text: string): ParsedCof {
  const lines = text.split(/\r?\n/);
  const header = lines[0]?.trim();
  if (header === undefined || header === '') throw new Error('COF: empty first line');

  const headerFields = header.split(/\s+/);
  const [epochText, modelName, releaseDate] = headerFields;
  if (headerFields.length !== 3 || epochText === undefined || modelName === undefined || releaseDate === undefined) {
    throw new Error(`COF: header must be "<epoch> <model> <date>", got "${header}"`);
  }
  const epoch = Number(epochText);
  if (!Number.isFinite(epoch)) throw new Error(`COF: bad epoch "${epochText}"`);

  const rows: CofRow[] = [];
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    // NOAA terminates the table with lines of 9s carrying no separators.
    if (/^9{10,}$/.test(trimmed)) break;

    const fields = trimmed.split(/\s+/).map(Number);
    if (fields.length !== 6 || fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`COF: expected six numbers, got "${trimmed}"`);
    }
    const [n, m, g, h, gDot, hDot] = fields as [number, number, number, number, number, number];
    if (!Number.isInteger(n) || !Number.isInteger(m) || m > n || n < 1) {
      throw new Error(`COF: bad degree/order pair n=${n} m=${m}`);
    }
    rows.push({ n, m, g, h, gDot, hDot });
  }

  const nMax = rows.reduce((max, row) => Math.max(max, row.n), 0);
  const expected = (nMax * (nMax + 3)) / 2;
  if (rows.length !== expected) {
    throw new Error(`COF: nMax=${nMax} needs ${expected} rows, found ${rows.length}`);
  }
  // Rows must arrive in the exact triangular order the packing below assumes.
  rows.forEach((row, i) => {
    const index = (row.n * (row.n + 1)) / 2 + row.m - 1;
    if (index !== i) throw new Error(`COF: row ${i} is n=${row.n} m=${row.m}, out of order`);
  });

  return { header, epoch, modelName, releaseDate, nMax, rows };
}

/** Render one packed coefficient array, six per line for a readable diff. */
function renderArray(name: string, values: readonly number[], doc: string): string {
  const lines: string[] = [];
  for (let i = 0; i < values.length; i += 6) {
    const chunk = values.slice(i, i + 6).map((value) => value.toFixed(1));
    lines.push(`  ${chunk.join(', ')},`);
  }
  return `${doc}\nexport const ${name}: readonly number[] = [\n${lines.join('\n')}\n];\n`;
}

function generate(cof: ParsedCof, sha256: string, cofPath: string): string {
  const g = cof.rows.map((row) => row.g);
  const h = cof.rows.map((row) => row.h);
  const gDot = cof.rows.map((row) => row.gDot);
  const hDot = cof.rows.map((row) => row.hDot);

  return `/**
 * World Magnetic Model 2025 Gauss coefficients. GENERATED FILE — do not edit.
 *
 * Regenerate with \`npm run fixtures:wmm\`
 * (scripts/make-wmm-coefficients.ts), which reads the \`.COF\` below.
 *
 * PROVENANCE
 *   header line   ${cof.header}
 *   source URL    ${PROVENANCE.sourceUrl}
 *   retrieved     ${PROVENANCE.retrieved}
 *   sha256(.COF)  ${sha256}
 *   local copy    ${cofPath}
 *
 * NOAA's own host (ngdc.noaa.gov / ncei) is blocked by this environment's
 * egress proxy, so the bytes came from the mirror above. CROSS-CHECK:
 * ${PROVENANCE.crossCheck}
 *
 * Units: g and h in nanotesla; the dot terms in nanotesla per year, applied
 * linearly from the epoch (secular variation).
 *
 * PACKING. All four arrays share one index, running over (n, m) in the order
 * n = 1…${cof.nMax}, m = 0…n, with the n = 0 slot omitted:
 *
 *     index(n, m) = n·(n+1)/2 + m − 1
 *
 * Use \`wmmCoefficient()\` rather than indexing directly. It returns 0 for
 * m > n, which is the mathematically correct value for a coefficient that does
 * not exist, and it does not paper over an index that is out of range.
 */

/** Reference epoch of the model, in decimal years. */
export const WMM2025_EPOCH = ${cof.epoch.toFixed(1)};

/** Model name exactly as the \`.COF\` header spells it. */
export const WMM2025_NAME = '${cof.modelName}';

/** Release date from the \`.COF\` header (MM/DD/YYYY, as published). */
export const WMM2025_RELEASE_DATE = '${cof.releaseDate}';

/**
 * Maximum spherical-harmonic degree. WMM truncates at 12; the model says
 * nothing about crustal structure at finer scales, and adding degrees would
 * not make it say anything.
 */
export const WMM2025_N_MAX = ${cof.nMax};

/**
 * Nominal validity window, in decimal years. NOAA fits each model to a
 * five-year span and the linear secular-variation terms degrade outside it.
 */
export const WMM2025_VALID_FROM = ${cof.epoch.toFixed(1)};
export const WMM2025_VALID_UNTIL = ${(cof.epoch + 5).toFixed(1)};

${renderArray('WMM2025_G', g, '/** Main-field cosine coefficients g(n,m) at the epoch, nT. */')}
${renderArray('WMM2025_H', h, '/** Main-field sine coefficients h(n,m) at the epoch, nT. */')}
${renderArray('WMM2025_G_DOT', gDot, '/** Secular variation of g(n,m), nT/year. */')}
${renderArray('WMM2025_H_DOT', hDot, '/** Secular variation of h(n,m), nT/year. */')}
/**
 * Read one coefficient out of a packed array.
 *
 * Returns 0 when m > n or n is outside 1…${cof.nMax}: no such coefficient exists, and
 * zero is its value in every sum that would reference it. Anything else in
 * range is present, so a missing slot means the table itself is wrong and the
 * throw is the honest answer.
 */
export function wmmCoefficient(packed: readonly number[], n: number, m: number): number {
  if (m > n || m < 0 || n < 1 || n > WMM2025_N_MAX) return 0;
  const value = packed[(n * (n + 1)) / 2 + m - 1];
  if (value === undefined) throw new Error(\`WMM coefficient table is short at n=\${n} m=\${m}\`);
  return value;
}
`;
}

const cofPath = process.argv[2] ?? DEFAULT_COF;
const bytes = readFileSync(cofPath);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const parsed = parseCof(bytes.toString('utf8'));
writeFileSync(OUTPUT, generate(parsed, sha256, relative(REPO_ROOT, cofPath)));

process.stdout.write(
  [
    `read    ${cofPath}`,
    `sha256  ${sha256}`,
    `header  ${parsed.header}`,
    `rows    ${parsed.rows.length} (nMax ${parsed.nMax})`,
    `wrote   ${relative(REPO_ROOT, OUTPUT)}`,
    '',
  ].join('\n'),
);
