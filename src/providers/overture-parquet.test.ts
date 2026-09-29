/**
 * Parquet range reading, spatial pruning and summit extraction — against REAL
 * Overture bytes, offline (archive/v2-docs-20260929/PLAN.md P9.1–P9.4).
 *
 * WHAT THIS TEST READS. `fixtures/parquet/overture-zermatt-rowgroup/` holds the
 * exact byte ranges one pruned read touches: the Parquet footer of part-00011
 * of Overture release 2026-06-17.0, and the eighteen leaf column chunks of row
 * group 21 belonging to the six columns the importer asks for. 1,362,032 bytes
 * — 0.32% of the 424 MB part. Nothing here touches the network, and nothing
 * here reads `data/`, which is gitignored.
 *
 * WHERE THE EXPECTATIONS COME FROM. Two independent places, kept apart on
 * purpose:
 *
 *   Structure — row-group count, row span, bbox statistics, column bytes — is
 *   stated in the fixture's own sidecar, recorded from the live file at
 *   acquisition time by `npm run fixtures:peak-parquet`. The reader has to
 *   re-derive those numbers from the committed bytes.
 *
 *   Content — summit heights and positions — is checked against
 *   `fixtures/peaks/ground-truth-peaks.json`, whose values are copied from
 *   cited sources and predate this importer entirely. That is the assertion
 *   that matters: it says Overture agrees with an independently sourced figure,
 *   rather than saying the decoder agrees with itself.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  OVERTURE_LAND_COLUMNS,
  importOvertureRows,
  readOvertureLandRow,
  type DegreeBox,
} from './overture-peaks.js';
import {
  CountingRangeBuffer,
  planParquetRead,
  readParquetMetadata,
  readRowGroup,
  rowGroupExtents,
  type FileMetaData,
} from './overture-parquet.js';
import type { ColumnChunk, ColumnMetaData, Statistics } from 'hyparquet';
import { parseParquetSliceMeta, parquetSliceBuffer } from './parquet-slice.js';
import { ProviderError } from './errors.js';
import groundTruth from '../../fixtures/peaks/ground-truth-peaks.json';

const FIXTURE_DIR = fileURLToPath(
  new URL('../../fixtures/parquet/overture-zermatt-rowgroup', import.meta.url),
);

/** The structural claims the sidecar makes about the live file. */
interface SidecarExpectations {
  readonly rowGroupCount: number;
  readonly fileRowCount: number;
  readonly rowGroupRowStart: number;
  readonly rowGroupRows: number;
  readonly rowGroupBox: DegreeBox;
  readonly selectedColumnBytes: number;
  readonly totalCompressedBytes: number;
}

function citedPeak(name: string): { lat: number; lon: number; elevationM: number } {
  const peak = groundTruth.peaks.find((entry) => entry.name === name);
  if (peak === undefined) throw new Error(`ground-truth-peaks.json has no ${name}`);
  return { lat: peak.lat, lon: peak.lon, elevationM: peak.elevationM };
}

/** Great-circle distance in metres. Written out so the tolerance is legible. */
function metresBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

let sidecar: ReturnType<typeof parseParquetSliceMeta>;
let expectations: SidecarExpectations;
let metadata: FileMetaData;
let buffer: ReturnType<typeof parquetSliceBuffer>;

beforeAll(async () => {
  const raw = JSON.parse(await readFile(join(FIXTURE_DIR, 'slice.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  sidecar = parseParquetSliceMeta(raw, 'fixtures/parquet/overture-zermatt-rowgroup/slice.json');
  expectations = raw['expectations'] as unknown as SidecarExpectations;
  const bytes = new Uint8Array(await readFile(join(FIXTURE_DIR, 'slice.bin')));
  buffer = parquetSliceBuffer(sidecar, bytes);
  metadata = await readParquetMetadata(buffer);
});

describe('the committed slice', () => {
  it('is a small, honest cut of a named remote file', () => {
    expect(sidecar.release).toBe('2026-06-17.0');
    expect(sidecar.key).toContain('theme=base/type=land/part-00011');
    expect(sidecar.partByteLength).toBe(424105813);
    expect([...sidecar.columns]).toEqual([...OVERTURE_LAND_COLUMNS]);
    // The whole argument for this design in one assertion: the fixture is a
    // third of a percent of the file it was cut from.
    expect(sidecar.sliceByteLength / sidecar.partByteLength).toBeLessThan(0.005);
  });

  it('refuses bytes that were not recorded instead of returning zeros', () => {
    // Byte 0 of the part is the `PAR1` header, deliberately NOT recorded.
    expect(() => buffer.slice(0, 4)).toThrow(ProviderError);
    expect(() => buffer.slice(0, 4)).toThrow(/were not recorded/);
  });
});

describe('P9.1 — the footer, read from 512 KiB of a 424 MB file', () => {
  it('reports the row-group count and row count the sidecar recorded', () => {
    expect(metadata.row_groups).toHaveLength(expectations.rowGroupCount);
    expect(Number(metadata.num_rows)).toBe(expectations.fileRowCount);
  });

  it('carries bbox statistics for every row group — the pruning depends on it', () => {
    const extents = rowGroupExtents(metadata, OVERTURE_LAND_COLUMNS);
    expect(extents).toHaveLength(expectations.rowGroupCount);
    // A group with no statistics is given the whole world by `rowGroupExtents`,
    // which would be fetched rather than pruned. None of them is.
    const worldwide = extents.filter(
      (extent) => extent.box.west === -180 && extent.box.east === 180,
    );
    expect(worldwide).toHaveLength(0);
  });

  it('places row group 21 exactly where the sidecar says, in space and in rows', () => {
    const extent = rowGroupExtents(metadata, OVERTURE_LAND_COLUMNS)[sidecar.rowGroup];
    expect(extent).toBeDefined();
    if (extent === undefined) throw new Error('unreachable');
    expect(extent.rowStart).toBe(expectations.rowGroupRowStart);
    expect(extent.numRows).toBe(expectations.rowGroupRows);
    expect(extent.box).toEqual(expectations.rowGroupBox);
    expect(extent.selectedColumnBytes).toBe(expectations.selectedColumnBytes);
    expect(extent.totalCompressedBytes).toBe(expectations.totalCompressedBytes);

    // Column selection is the other half of the saving: six columns are 8.4% of
    // this group, because `geometry` is nearly all of the rest.
    expect(extent.selectedColumnBytes / extent.totalCompressedBytes).toBeLessThan(0.1);
  });
});

describe('P9.2 — spatial pruning', () => {
  const zermatt: DegreeBox = { south: 45.9, west: 7.6, north: 46.05, east: 7.8 };

  it('keeps the group holding the Matterhorn and prices the read', () => {
    const plan = planParquetRead(metadata, zermatt, OVERTURE_LAND_COLUMNS);
    expect(plan.groups.map((group) => group.index)).toContain(sidecar.rowGroup);
    expect(plan.totalRowGroups).toBe(expectations.rowGroupCount);
    // Whatever else it keeps, the plan must cost a tiny fraction of the part.
    expect(plan.plannedBytes).toBeLessThan(sidecar.partByteLength * 0.05);
    expect(plan.plannedBytes).toBeLessThan(plan.plannedBytesAllColumns * 0.2);
  });

  it('prunes every group for an area the file does not cover', () => {
    // part-00011 spans lon 5…9.7, lat 45.6…49.6 — western Europe. The Southern
    // Alps of New Zealand share nothing with it.
    const plan = planParquetRead(
      metadata,
      { south: -44.5, west: 169, north: -43, east: 171 },
      OVERTURE_LAND_COLUMNS,
    );
    expect(plan.groups).toHaveLength(0);
    expect(plan.plannedBytes).toBe(0);
  });

  it('prunes a box that misses in latitude alone', () => {
    const plan = planParquetRead(
      metadata,
      { south: 20, west: 7.6, north: 21, east: 7.8 },
      OVERTURE_LAND_COLUMNS,
    );
    expect(plan.groups).toHaveLength(0);
  });

  it('would fetch only what was recorded for a box hitting group 21 alone', async () => {
    // A box inside group 21's extent but outside its neighbours': the plan
    // reduces to the one group, which is exactly the group in the fixture — so
    // the read below succeeds against a buffer that holds nothing else.
    const plan = planParquetRead(metadata, zermatt, OVERTURE_LAND_COLUMNS);
    const only = plan.groups.filter((group) => group.index === sidecar.rowGroup);
    expect(only).toHaveLength(1);
    const rows = await readRowGroup(buffer, metadata, only[0]!, OVERTURE_LAND_COLUMNS);
    expect(rows).toHaveLength(expectations.rowGroupRows);
  });
});

/*
 * Wave 3 gate gap 1 — the fallback that costs every peak if it is inverted.
 *
 * `rowGroupExtents` gives a group with incomplete bbox statistics the WHOLE
 * WORLD, so it is fetched and filtered rather than skipped unseen. The real
 * Overture footer has statistics on every group, so no test built from it can
 * ever exercise that branch: inverting the fallback to an empty box — which
 * prunes every such group and returns zero peaks from a healthy file — passed
 * the whole suite. This builds the footer that branch needs instead.
 *
 * The metadata below is synthetic and minimal: `rowGroupExtents` reads
 * `num_rows`, `total_byte_size` and the column chunks' `path_in_schema`,
 * `total_compressed_size` and `statistics`, and nothing else.
 */
describe('a row group whose bbox statistics are missing', () => {
  function chunk(path: string, stats: Statistics | undefined): ColumnChunk {
    const meta: ColumnMetaData = {
      type: 'DOUBLE',
      encodings: ['PLAIN'],
      path_in_schema: path.split('.'),
      codec: 'SNAPPY',
      num_values: 10n,
      total_uncompressed_size: 200n,
      total_compressed_size: 100n,
      data_page_offset: 4n,
      ...(stats === undefined ? {} : { statistics: stats }),
    };
    return { file_offset: 4n, meta_data: meta };
  }

  /** One row group over the columns the importer reads, statistics on or off. */
  function metadataWith(statistics: 'present' | 'stripped'): FileMetaData {
    const stats = (min: number, max: number): Statistics | undefined =>
      statistics === 'present' ? { min_value: min, max_value: max } : undefined;
    return {
      version: 2,
      schema: [{ name: 'root' }],
      num_rows: 10n,
      metadata_length: 0,
      row_groups: [
        {
          num_rows: 10n,
          total_byte_size: 600n,
          columns: [
            chunk('bbox.xmin', stats(7.6, 7.6)),
            chunk('bbox.xmax', stats(7.8, 7.8)),
            chunk('bbox.ymin', stats(45.9, 45.9)),
            chunk('bbox.ymax', stats(46.0, 46.0)),
            chunk('names.primary', undefined),
            chunk('elevation', undefined),
          ],
        },
      ],
    };
  }

  it('is given the whole world, so it is read and filtered rather than skipped', () => {
    const [extent] = rowGroupExtents(metadataWith('stripped'), OVERTURE_LAND_COLUMNS);
    expect(extent).toBeDefined();
    expect(extent?.box).toEqual({ south: -90, west: -180, north: 90, east: 180 });
  });

  it('survives pruning for a box on the other side of the planet', () => {
    // An empty-box fallback would prune this group — and every group in a file
    // that stopped writing statistics — leaving an import that silently
    // returns zero peaks from a perfectly good part.
    const plan = planParquetRead(
      metadataWith('stripped'),
      { south: -44.5, west: 169, north: -43, east: 171 },
      OVERTURE_LAND_COLUMNS,
    );
    expect(plan.groups).toHaveLength(1);
    expect(plan.plannedBytes).toBeGreaterThan(0);
  });

  it('prunes normally as soon as the statistics are there', () => {
    // The same synthetic file WITH statistics must prune, or the test above
    // would pass for the trivial reason that nothing prunes at all.
    const plan = planParquetRead(
      metadataWith('present'),
      { south: -44.5, west: 169, north: -43, east: 171 },
      OVERTURE_LAND_COLUMNS,
    );
    expect(plan.groups).toHaveLength(0);
    const near = planParquetRead(
      metadataWith('present'),
      { south: 45.9, west: 7.6, north: 46.05, east: 7.8 },
      OVERTURE_LAND_COLUMNS,
    );
    expect(near.groups).toHaveLength(1);
  });
});

/*
 * Wave 3 gate gap 2 — the Range header string itself.
 *
 * HTTP byte ranges are INCLUSIVE at both ends; Parquet's are half-open. The
 * conversion is one `- 1` three lines above the length check that would catch
 * it, and only the length check was gated. An off-by-one here fetches one byte
 * too few or too many from every request the importer makes.
 */
describe('CountingRangeBuffer — the Range header it sends', () => {
  function recordingBuffer(): { buffer: CountingRangeBuffer; headers: string[] } {
    const headers: string[] = [];
    const buffer = new CountingRangeBuffer('https://example.invalid/part.parquet', 1000, async (
      _url,
      init,
    ) => {
      const header = init.headers['Range'] ?? '';
      headers.push(header);
      const match = /^bytes=(\d+)-(\d+)$/.exec(header);
      if (match === null) throw new Error(`unparseable Range header ${header}`);
      const from = Number(match[1]);
      const to = Number(match[2]);
      return {
        ok: true,
        status: 206,
        arrayBuffer: async () => new ArrayBuffer(to - from + 1),
      };
    });
    return { buffer, headers };
  }

  it('asks for an inclusive range one shorter than the half-open one', async () => {
    const { buffer, headers } = recordingBuffer();
    // Bytes 100…199 are 100 bytes; the last byte's index is 199, not 200.
    const slice = await buffer.slice(100, 200);
    expect(headers).toEqual(['bytes=100-199']);
    expect(slice.byteLength).toBe(100);
    expect(buffer.bytesFetched).toBe(100);
  });

  it('asks for the final byte of the file when no end is given', async () => {
    const { buffer, headers } = recordingBuffer();
    await buffer.slice(996);
    expect(headers).toEqual(['bytes=996-999']);
  });

  it('asks for a single byte as a range of one', async () => {
    const { buffer, headers } = recordingBuffer();
    await buffer.slice(7, 8);
    expect(headers).toEqual(['bytes=7-7']);
  });
});

describe('P9.3 / P9.4 — what a summit looks like, and whether it has a height', () => {
  let rows: readonly unknown[];

  beforeAll(async () => {
    const extent = rowGroupExtents(metadata, OVERTURE_LAND_COLUMNS)[sidecar.rowGroup];
    if (extent === undefined) throw new Error('row group 21 missing from the metadata');
    rows = await readRowGroup(buffer, metadata, extent, OVERTURE_LAND_COLUMNS);
  });

  it('marks a summit as subtype=physical, class=peak, and names it in names.primary', () => {
    const matterhorn = rows
      .map((row) => readOvertureLandRow(row))
      .find((feature) => feature?.namePrimary === 'Matterhorn');
    expect(matterhorn).toBeDefined();
    if (matterhorn === undefined || matterhorn === null) throw new Error('unreachable');
    expect(matterhorn.subtype).toBe('physical');
    expect(matterhorn.featureClass).toBe('peak');
  });

  it('CARRIES AN ELEVATION, and it agrees with the cited survey figure', () => {
    // The open question of P9.4, answered against real bytes: Overture's
    // `elevation` column is populated for summits, in metres.
    const imported = importOvertureRows(rows, { sourceId: 'test-source' });
    const matterhorn = imported.peaks.find((peak) => peak.name === 'Matterhorn');
    expect(matterhorn).toBeDefined();
    if (matterhorn === undefined) throw new Error('unreachable');

    const cited = citedPeak('Matterhorn');
    expect(matterhorn.elevationM).toBe(cited.elevationM); // 4478 m
    expect(matterhorn.elevationSourceKind).toBe('osm');
    // …and it is emphatically not the DEM's 4230 m (MISSION.md), which is what
    // sampling SRTM here would have produced.
    expect(matterhorn.elevationM).not.toBe(4230);
    expect(metresBetween(matterhorn, cited)).toBeLessThan(10);
  });

  it('agrees with the cited Breithorn height on its west summit', () => {
    const imported = importOvertureRows(rows, { sourceId: 'test-source' });
    // OSM names the 4164 m west summit "Breithorn Occidentale / Westgipfel";
    // the case file calls it "Breithorn". Same summit, same height — a naming
    // disagreement, not a data disagreement, and it is recorded in the README.
    const west = imported.peaks.find(
      (peak) => peak.name === 'Breithorn Occidentale / Westgipfel',
    );
    expect(west).toBeDefined();
    if (west === undefined) throw new Error('unreachable');
    const cited = citedPeak('Breithorn');
    expect(west.elevationM).toBe(cited.elevationM); // 4164 m
    expect(metresBetween(west, cited)).toBeLessThan(60);
  });

  it('accounts for every row it read — kept plus dropped equals the row count', () => {
    const imported = importOvertureRows(rows, { sourceId: 'test-source' });
    const dropped = Object.values(imported.rejected).reduce((sum, count) => sum + count, 0);
    expect(imported.peaks.length + dropped + imported.duplicates).toBe(
      expectations.rowGroupRows,
    );
    // Summits with no `ele` tag exist and are dropped, never DEM-filled.
    expect(imported.rejected['no-elevation']).toBeGreaterThan(0);
    // Every kept record has both a name and a height, by construction.
    for (const peak of imported.peaks) {
      expect(peak.name.length).toBeGreaterThan(0);
      expect(Number.isFinite(peak.elevationM)).toBe(true);
      expect(peak.elevationSourceKind).toBe('osm');
    }
  });

  it('finds hundreds of named summits in one Alpine row group', () => {
    // Coverage, which is the entire point of Q5: the bundled dataset held three
    // alpine summits; one row group of Overture holds hundreds.
    const imported = importOvertureRows(rows, { sourceId: 'test-source' });
    expect(imported.peaks.length).toBeGreaterThan(300);
    expect(groundTruth.peaks.length).toBeLessThan(imported.peaks.length);
  });
});
