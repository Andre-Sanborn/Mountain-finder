/**
 * Read a home-session recording and print what it settles.
 *
 *   npm run analyze:recording -- <path to recording.json>
 *   npm run analyze:recording -- <path> --brief     # the table, no evidence
 *
 * The recording answers twelve questions about the browser sensor path that no
 * document could: what `webkitCompassHeading` is referenced to, whether the
 * device frame follows the screen, which sign `accelerationIncludingGravity`
 * carries, and so on. `src/live/recording.ts` holds the parser and the whole
 * analysis; this file loads a document, hands it over, and formats the answer.
 *
 * ── WHAT IT WILL NOT DO ────────────────────────────────────────────────────
 * It reports to the terminal and writes nothing, per `AGENTS.md` § "Captures
 * from the phone". A stripped copy of a recording enters `fixtures/` only after
 * a human has read it and committed it deliberately. Nothing here prints a
 * coordinate either, because the schema has nowhere to put one: the strict
 * parser rejects a geolocation field, an epoch timestamp and any key it does not
 * know, so a document that reaches the analyzer has already been shown to carry
 * neither a place nor a wall clock.
 *
 * Exit status is 1 when the document will not parse, and 0 otherwise —
 * including when every verdict comes back inconclusive. "The session did not
 * settle it" is an answer the script is allowed to give; only a malformed or
 * privacy-violating file is a failure.
 */

import { readFileSync } from 'node:fs';

import { analyseRecording, parseRecording, type Verdict } from '../src/live/recording.js';

function usage(): never {
  process.stderr.write(
    'usage: npm run analyze:recording -- <path to recording.json> [--brief]\n',
  );
  process.exit(2);
}

function main(): void {
  const args = process.argv.slice(2);
  const brief = args.includes('--brief');
  const paths = args.filter((arg) => !arg.startsWith('--'));
  const path = paths[0];
  if (path === undefined || paths.length > 1) usage();

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    process.stderr.write(`cannot read ${path} as JSON: ${String(error)}\n`);
    process.exit(1);
  }

  const parsed = parseRecording(raw);
  if (!parsed.ok) {
    process.stderr.write(`${path} is not a valid home-session recording:\n`);
    for (const problem of parsed.problems) {
      process.stderr.write(`  ${problem.path === '' ? '<root>' : problem.path}: ${problem.message}\n`);
    }
    process.stderr.write(`\n${parsed.problems.length} problem(s). Nothing was analysed.\n`);
    process.exit(1);
  }

  const recording = parsed.value;
  const analysis = analyseRecording(recording);

  const lines: string[] = [];
  lines.push(`recording: ${path}`);
  lines.push(`device:    ${analysis.device}`);
  lines.push(
    `bearing:   ${recording.knownBearing.magneticAzimuthDeg.toFixed(2)}° magnetic, from ${recording.knownBearing.kind}`,
  );
  lines.push(
    `segments:  ${recording.segments.length} (${recording.segments.reduce((n, s) => n + s.events.length, 0)} events)`,
  );
  if (analysis.missingPoses.length > 0) {
    lines.push(`missing:   ${analysis.missingPoses.join(', ')}`);
  }
  lines.push('');
  lines.push(...table(analysis.verdicts));

  if (!brief) {
    for (const verdict of analysis.verdicts) {
      lines.push('');
      lines.push(`${verdict.id} — ${verdict.question}`);
      lines.push(`  answer: ${verdict.answer}  [${verdict.confidence} confidence]`);
      for (const line of verdict.evidence) lines.push(`  · ${line}`);
    }
  }

  const undecided = analysis.verdicts.filter((v) => v.inconclusive);
  lines.push('');
  lines.push(
    `${analysis.verdicts.length - undecided.length} of ${analysis.verdicts.length} questions answered` +
      (undecided.length === 0 ? '' : `; inconclusive: ${undecided.map((v) => v.id).join(', ')}`),
  );
  process.stdout.write(`${lines.join('\n')}\n`);
}

/** Three aligned columns: the question's id, the answer, the confidence. */
function table(verdicts: readonly Verdict[]): readonly string[] {
  const header = ['question', 'verdict', 'confidence'] as const;
  const rows: readonly (readonly [string, string, string])[] = verdicts.map((v) => [
    v.id,
    oneLine(v.answer),
    v.confidence,
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)),
  );
  const rule = widths.map((width) => '─'.repeat(width)).join('──');
  const render = (cells: readonly string[]): string =>
    cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join('  ');
  return [render(header), rule, ...rows.map(render)];
}

/** Longest verdict text the table column carries before it is cut. */
const MAX_TABLE_ANSWER = 88;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= MAX_TABLE_ANSWER ? flat : `${flat.slice(0, MAX_TABLE_ANSWER - 1)}…`;
}

main();
