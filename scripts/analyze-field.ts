/**
 * Read a field capture bundle and its apex truth, and print the pre-registered
 * verdicts.
 *
 *   npm run analyze:field -- <bundle.json> <truth.json>
 *   npm run analyze:field -- <bundle.json> <truth.json> --brief
 *
 * The criteria, the thresholds and the error budget they came from are in
 * `docs/FIELD-TEST-PREREGISTRATION.md`. `src/live/field-analysis.ts` holds the
 * schema, the parser and the whole analysis; this file loads two documents and a
 * peak dataset, hands them over, and formats the answer. It takes no threshold
 * argument, so a run cannot be graded against anything but the pre-registration.
 *
 * F1 (offline start and frame rate) and F6 (human time on site) are stopwatch
 * numbers recorded by the person on site. They are not computed from a bundle
 * and this script says nothing about them.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 * It reports to the terminal and writes nothing, per `AGENTS.md` § "Captures
 * from the phone". It prints no coordinate, and no distance or bearing either:
 * a distance and a bearing to a named summit is a position fix, so a summit is
 * reported by its tolerance band rather than by how far away it is. The parser
 * refuses a bundle that carries a geolocation field, a bearing, a wall clock, a
 * camera identifier or an embedded frame, so a document that reaches the grader
 * has already been shown to carry none of them.
 *
 * ── WHERE SUMMIT TRUTH COMES FROM ──────────────────────────────────────────
 * The committed peak data under `fixtures/peaks/`, by summit id, never the
 * bundle. The bundle is written by the device under test.
 *
 * Exit status is 1 when either document will not parse, or when a criterion
 * fails, and 0 otherwise — including when every criterion comes back
 * `no-sample`. "The session did not produce a summit in that band" is an answer
 * the script is allowed to give.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  analyseFieldRun,
  parseFieldBundle,
  parseFieldTruth,
  renderFieldReport,
  type BundleProblem,
  type PeakLookup,
} from '../src/live/field-analysis.js';
import { groundTruthPeakDataset } from '../fixtures/peaks/index.js';
import type { Peak } from '../src/core/types.js';

const REGION_ROOT = 'fixtures/peaks/regions';

function usage(): never {
  process.stderr.write('usage: npm run analyze:field -- <bundle.json> <truth.json> [--brief]\n');
  process.exit(2);
}

/**
 * Every summit in every committed region, plus the ground-truth dataset.
 *
 * A bundle names the regions the app had loaded, but the lookup reads all of
 * them: a summit id that resolves in a region the bundle did not claim is a
 * finding about the bundle, and refusing to look would hide it.
 */
function loadPeaks(): PeakLookup {
  const byId = new Map<string, Peak>();
  for (const record of groundTruthPeakDataset.peaks) {
    byId.set(record.id, {
      id: record.id,
      name: record.name,
      lat: record.lat,
      lon: record.lon,
      elevationM: record.elevationM,
      elevationSource: record.elevationSourceKind,
    });
  }

  let regions: readonly string[] = [];
  try {
    regions = readdirSync(REGION_ROOT).filter((name) =>
      statSync(join(REGION_ROOT, name)).isDirectory(),
    );
  } catch {
    regions = [];
  }

  for (const region of regions) {
    const cellDir = join(REGION_ROOT, region, 'cells');
    let cells: readonly string[] = [];
    try {
      cells = readdirSync(cellDir).filter((name) => name.endsWith('.json'));
    } catch {
      continue;
    }
    for (const cell of cells) {
      const parsed = JSON.parse(readFileSync(join(cellDir, cell), 'utf8')) as {
        peaks?: {
          id?: unknown;
          name?: unknown;
          lat?: unknown;
          lon?: unknown;
          elevationM?: unknown;
          elevationSourceKind?: unknown;
        }[];
      };
      for (const raw of parsed.peaks ?? []) {
        if (
          typeof raw.id !== 'string' ||
          typeof raw.name !== 'string' ||
          typeof raw.lat !== 'number' ||
          typeof raw.lon !== 'number' ||
          typeof raw.elevationM !== 'number'
        ) {
          continue;
        }
        byId.set(raw.id, {
          id: raw.id,
          name: raw.name,
          lat: raw.lat,
          lon: raw.lon,
          elevationM: raw.elevationM,
          elevationSource: raw.elevationSourceKind === 'srtm' ? 'srtm' : 'osm',
        });
      }
    }
  }

  return (summitId: string): Peak | undefined => byId.get(summitId);
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`cannot read ${path} as JSON: ${String(error)}\n`);
    process.exit(1);
  }
}

function reportProblems(path: string, what: string, problems: readonly BundleProblem[]): never {
  process.stderr.write(`${path} is not a valid ${what}:\n`);
  for (const problem of problems) {
    process.stderr.write(`  ${problem.path === '' ? '<root>' : problem.path}: ${problem.message}\n`);
  }
  process.stderr.write(`\n${problems.length} problem(s). Nothing was analysed.\n`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const brief = args.includes('--brief');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const bundlePath = paths[0];
  const truthPath = paths[1];
  if (bundlePath === undefined || truthPath === undefined || paths.length > 2) usage();

  const bundle = parseFieldBundle(readJson(bundlePath));
  if (!bundle.ok) reportProblems(bundlePath, 'field capture bundle', bundle.problems);
  const truth = parseFieldTruth(readJson(truthPath));
  if (!truth.ok) reportProblems(truthPath, 'apex truth document', truth.problems);

  const analysis = analyseFieldRun(bundle.value, truth.value, loadPeaks());
  const lines = [
    `bundle:   ${bundlePath}`,
    `truth:    ${truthPath}`,
    `criteria: docs/FIELD-TEST-PREREGISTRATION.md`,
    ...renderFieldReport(analysis, { brief }),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);

  const failed = analysis.criteria.filter((criterion) => criterion.outcome === 'fail');
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
