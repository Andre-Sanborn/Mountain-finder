/**
 * WHAT THIS BUILD ACTUALLY SHIPS — the citations behind the footer.
 *
 * `attribution.ts` derives a credit from citation records; this module is where
 * those records come from, and it takes them from the shipped files themselves
 * rather than from a sentence somebody typed:
 *
 *   summits, labelled     fixtures/peaks/regions/<region>/ — the Overture
 *                         regions main.tsx reads through /peaks/ (Q8). The
 *                         INDEXES are matched by a glob so a region added
 *                         tomorrow appears in the footer with ITS licence, not
 *                         this one, and is served without a code change. They
 *                         carry Overture Maps' citation: © OpenStreetMap
 *                         contributors, ODbL-1.0 — attribution required.
 *   summits, cited        fixtures/peaks/ground-truth-peaks.json — the 15
 *                         cited summits the acceptance suite gates on, still
 *                         compiled into the bundle for this footer's count.
 *                         Its `sources[]` are per-summit citations
 *                         (Wikipedia / USGS GNIS); they name no licence, and
 *                         none is claimed for them.
 *   elevation             a citation constant, below, with its own reasons.
 *
 * Only the region INDEX files are imported (~10 KB of metadata for four
 * regions); the 3.2 MB of summit cells stay out of the bundle and are served
 * from `/peaks/` (docs/DEPLOY.md).
 *
 * ── THE ONE THING THAT CAN DRIFT ───────────────────────────────────────────
 * `peakDataReadByThisBuild` states which of the two summit datasets the
 * app actually reads. It is a claim about `main.tsx`, and switching that file
 * to the HTTP regions (archive/v2-docs-20260929/TODO.md Q8) means changing this constant in the same
 * commit. It is a constant rather than a derivation because the alternative —
 * the footer quietly claiming whichever dataset is bigger — would be a guess.
 * Everything else here follows the data.
 */

import type { CitationRecord, DataUse } from './attribution';
import bundledPeaksJson from '../../fixtures/peaks/ground-truth-peaks.json';

/** The two summit datasets this repository holds. */
export type PeakDataChoice = 'bundled' | 'regions';

const PEAK_DATA_CHOICE: PeakDataChoice = 'regions';

/**
 * Which summit dataset `main.tsx` wires into the pipeline. See module docs.
 *
 * A function rather than an exported const because TypeScript narrows a const
 * to its initialiser, which would make the other branch below "unreachable" and
 * fail the build — the branch has to stay compiled and correct so that flipping
 * the constant is genuinely a one-line change.
 */
export function peakDataReadByThisBuild(): PeakDataChoice {
  return PEAK_DATA_CHOICE;
}

/**
 * Elevation's citation.
 *
 * Written here rather than read from `/terrain/manifest.json` for two reasons:
 * the manifest carries geometry and provenance but no licence field, and the
 * footer must be complete on first paint — a credit that waits for a fetch is a
 * credit that is missing exactly when someone is looking for it.
 *
 * Nothing is owed here: SRTM is a US Government work, public domain, and this
 * line is courtesy. It is still derived through the same code path, so the
 * "public domain → courtesy" wording is produced by the licence table rather
 * than asserted by hand.
 */
export const SRTM_CITATION: CitationRecord = {
  title: 'NASA/USGS SRTM 1 arc-second global, via the AWS Open Data elevation-tiles-prod mirror, public domain',
  url: 'https://registry.opendata.aws/terrain-tiles/',
  note: 'Terrain grids served from this app’s own origin at /terrain/ (decision D7). Summit heights are NEVER sampled from it.',
};

interface RawSourceList {
  readonly sources?: readonly unknown[];
  readonly peaks?: readonly unknown[];
  readonly peakCount?: unknown;
}

/**
 * Read `sources[]` out of a dataset file without trusting it.
 *
 * The parser in `src/providers/peak-store.ts` already refuses a malformed
 * dataset at import time, but the region indexes are not parsed by it, and a
 * footer is the last place that should throw. A record missing a title is
 * skipped; a missing URL is simply absent.
 */
export function citationsOf(value: unknown): readonly CitationRecord[] {
  if (typeof value !== 'object' || value === null) return [];
  const sources = (value as RawSourceList).sources;
  if (!Array.isArray(sources)) return [];
  const records: CitationRecord[] = [];
  for (const entry of sources) {
    if (typeof entry !== 'object' || entry === null) continue;
    const raw = entry as { title?: unknown; url?: unknown; note?: unknown };
    if (typeof raw.title !== 'string' || raw.title.trim() === '') continue;
    records.push({
      title: raw.title,
      ...(typeof raw.url === 'string' ? { url: raw.url } : {}),
      ...(typeof raw.note === 'string' ? { note: raw.note } : {}),
    });
  }
  return records;
}

/** How many summits a dataset file holds, counted or taken from its own total. */
export function summitCountOf(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0;
  const raw = value as RawSourceList;
  if (Array.isArray(raw.peaks)) return raw.peaks.length;
  return typeof raw.peakCount === 'number' && Number.isFinite(raw.peakCount) ? raw.peakCount : 0;
}

function formatCount(count: number): string {
  return count.toLocaleString('en-GB');
}

/**
 * Every region index committed under `fixtures/peaks/regions/`, by region name.
 *
 * A glob, not a list: adding `regions/pyrenees/` puts the Pyrenees in the
 * footer under whatever licence its own citation names, with no code change.
 */
const REGION_INDEXES: Record<string, unknown> = import.meta.glob(
  '../../fixtures/peaks/regions/*/index.json',
  { eager: true, import: 'default' },
);

/** `../../fixtures/peaks/regions/zermatt/index.json` → `zermatt`. */
export function regionNameFromPath(path: string): string {
  const parts = path.split('/');
  const name = parts[parts.length - 2];
  return name ?? path;
}

/**
 * The bundled region indexes, keyed by region name — what `main.tsx` hands to
 * `createRegionPeakSource` (Q8). The same glob feeds the footer above, so the
 * regions the app queries and the regions the footer credits cannot drift: one
 * import, two readers.
 */
export function bundledRegionIndexes(): Readonly<Record<string, unknown>> {
  const byName: Record<string, unknown> = {};
  for (const path of Object.keys(REGION_INDEXES)) {
    byName[regionNameFromPath(path)] = REGION_INDEXES[path];
  }
  return byName;
}

interface RegionSummary {
  readonly names: readonly string[];
  readonly summits: number;
  readonly citations: readonly CitationRecord[];
}

/** Fold the region indexes into one summary — names, total summits, citations. */
export function summariseRegions(indexes: Record<string, unknown>): RegionSummary {
  const names: string[] = [];
  const citations: CitationRecord[] = [];
  let summits = 0;
  for (const path of Object.keys(indexes).sort()) {
    const index = indexes[path];
    names.push(regionNameFromPath(path));
    summits += summitCountOf(index);
    for (const citation of citationsOf(index)) {
      if (!citations.some((existing) => existing.title === citation.title)) citations.push(citation);
    }
  }
  return { names, summits, citations };
}

const REGIONS = summariseRegions(REGION_INDEXES);
const BUNDLED_SUMMITS = summitCountOf(bundledPeaksJson);
const READS = peakDataReadByThisBuild();

/**
 * The bodies of data this build holds, in the order the footer lists them.
 *
 * Both summit datasets appear, and each says plainly whether the app reads it.
 * The deployed-but-unread regions are credited because the deployment serves
 * them (`dist/peaks/`, and `dist/ATTRIBUTION.txt` already names them): the
 * moment archive/v2-docs-20260929/TODO.md Q8 flips `main.tsx`, the notice is already on the page and
 * only the "does the app read it" wording changes.
 */
export const APP_DATA_USES: readonly DataUse[] = [
  {
    what: 'Elevation',
    detail: 'terrain horizon and occlusion, from /terrain/',
    sources: [SRTM_CITATION],
  },
  {
    what: 'Summits',
    detail:
      READS === 'bundled'
        ? `${formatCount(BUNDLED_SUMMITS)} cited summits — the ones this build labels`
        : `${formatCount(BUNDLED_SUMMITS)} cited summits, compiled into this build, unused`,
    sources: citationsOf(bundledPeaksJson),
  },
  ...(REGIONS.summits === 0
    ? []
    : [
        {
          what: 'Summits',
          detail:
            READS === 'regions'
              ? `${formatCount(REGIONS.summits)} summits, ${REGIONS.names.length} regions ` +
                `(${REGIONS.names.join(', ')}), read from /peaks/`
              : `${formatCount(REGIONS.summits)} summits, ${REGIONS.names.length} regions ` +
                `(${REGIONS.names.join(', ')}) — shipped at /peaks/, not read by this build yet`,
          sources: REGIONS.citations,
        },
      ]),
];
