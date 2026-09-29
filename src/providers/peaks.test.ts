/**
 * Peaks provider (archive/v2-docs-20260929/PLAN.md P2.3 self-check) — entirely offline.
 *
 * The expected peak list was written by reading
 * `fixtures/api/zermatt/overpass-peaks.json` element by element and applying
 * the documented tag rules (`ele` in metres wins; `ele:ft` in feet is converted
 * with the exact factor 0.3048; ways are placed by `center`; unnamed or
 * unplaceable elements are dropped). Nothing here was copied from parser output.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { LatLng } from '../core/types.js';
import type { ElevationProvider, ElevationResult } from './elevation.js';
import { OpenTopoDataElevationProvider } from './elevation.js';
import { isProviderError, type ProviderErrorCode } from './errors.js';
import { FixtureTransport } from './fixture-transport.js';
import { loadFixtureTransport } from './fixture-store.js';
import {
  OVERPASS_URL,
  OverpassPeaksProvider,
  buildPeaksQuery,
  feetToMetres,
  parseEleFeet,
  parseEleMetres,
  resolvePeakElevations,
  type PeakCandidate,
  type PeakSearchArea,
} from './peaks.js';

const ZERMATT_AREA: PeakSearchArea = {
  center: { lat: 45.9833, lon: 7.7847 },
  radiusKm: 15,
};

const fixtureDir = (name: string): string =>
  fileURLToPath(new URL(`../../fixtures/api/${name}`, import.meta.url));

async function codeOf(promise: Promise<unknown>): Promise<ProviderErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (isProviderError(error)) return error.code;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('buildPeaksQuery', () => {
  it('asks for named natural=peak nodes AND ways, with centroids', () => {
    expect(buildPeaksQuery(ZERMATT_AREA)).toBe(
      [
        '[out:json][timeout:60];',
        '(',
        '  node["natural"="peak"]["name"](around:15000,45.983300,7.784700);',
        '  way["natural"="peak"]["name"](around:15000,45.983300,7.784700);',
        ');',
        'out body center;',
      ].join('\n'),
    );
  });

  it('supports an explicit bounding box', () => {
    const query = buildPeaksQuery({
      bbox: { south: 45.9, west: 7.6, north: 46.1, east: 7.9 },
    });
    expect(query).toContain('node["natural"="peak"]["name"](45.900000,7.600000,46.100000,7.900000);');
    expect(query).toContain('way["natural"="peak"]["name"](45.900000,7.600000,46.100000,7.900000);');
  });
});

describe('ele tag parsing', () => {
  it('reads metres, tolerating units and separators', () => {
    expect(parseEleMetres('4478')).toBe(4478);
    expect(parseEleMetres('4634 m')).toBe(4634);
    expect(parseEleMetres('4634m')).toBe(4634);
    expect(parseEleMetres('812.5')).toBe(812.5);
    expect(parseEleMetres('4,808 m')).toBe(4808);
    expect(parseEleMetres('1 100')).toBe(1100);
    expect(parseEleMetres('+30')).toBe(30);
    expect(parseEleMetres('-5')).toBe(-5);
  });

  it('converts an explicit foot unit: 14505 ft = 4421.124 m', () => {
    expect(parseEleMetres('14505 ft')).toBe(4421.124);
    expect(parseEleMetres('14505 feet')).toBe(4421.124);
  });

  it('refuses to guess at values it cannot read', () => {
    expect(parseEleMetres('unknown')).toBeNull();
    expect(parseEleMetres('approx 3000')).toBeNull();
    expect(parseEleMetres('4808 m ASL')).toBeNull();
    expect(parseEleMetres('')).toBeNull();
    expect(parseEleMetres('3,00')).toBeNull();
  });

  it('reads ele:ft as a bare foot count and rejects metric suffixes', () => {
    expect(parseEleFeet('15121')).toBe(15121);
    expect(parseEleFeet('14,505 ft')).toBe(14505);
    expect(parseEleFeet('4808 m')).toBeNull();
  });

  it('converts feet with the exact factor 0.3048, to the millimetre', () => {
    expect(feetToMetres(15121)).toBe(4608.881); // 15121 × 0.3048 = 4608.8808
    expect(feetToMetres(1)).toBe(0.305); // 0.3048
    expect(feetToMetres(0)).toBe(0);
  });
});

describe('fetchPeaks against the recorded Zermatt area', () => {
  const load = (): OverpassPeaksProvider =>
    new OverpassPeaksProvider(loadFixtureTransport(fixtureDir('zermatt')));

  it('returns exactly the named, placeable peaks with correct heights', async () => {
    const peaks = await load().fetchPeaks(ZERMATT_AREA);

    expect(peaks).toEqual([
      {
        id: 'node/26863221',
        name: 'Matterhorn',
        lat: 45.9763,
        lon: 7.6586,
        elevationM: 4478,
        elevationSource: 'osm',
      },
      {
        id: 'node/33862008',
        name: 'Dufourspitze',
        lat: 45.9369,
        lon: 7.8669,
        elevationM: 4634,
        elevationSource: 'osm',
      },
      {
        id: 'node/26999104',
        name: 'Breithorn',
        lat: 45.9414,
        lon: 7.7664,
        elevationM: 4164,
        elevationSource: 'osm',
      },
      {
        // A way, placed by the centroid that `out center` supplies.
        id: 'way/220000001',
        name: 'Klein Matterhorn',
        lat: 45.9386,
        lon: 7.7297,
        elevationM: 3883,
        elevationSource: 'osm',
      },
      {
        id: 'node/27000001',
        name: 'Riffelhorn',
        lat: 45.9819,
        lon: 7.75,
        elevationM: null,
        elevationSource: 'unknown',
      },
      {
        id: 'node/27000002',
        name: 'Unterrothorn',
        lat: 46.0325,
        lon: 7.7772,
        elevationM: null,
        elevationSource: 'unknown',
      },
      {
        // ele:ft only: 15121 ft × 0.3048 = 4608.8808 m
        id: 'node/27000004',
        name: 'Nordend',
        lat: 45.93,
        lon: 7.86,
        elevationM: 4608.881,
        elevationSource: 'osm',
      },
      {
        // Both tags present — the metric `ele` wins, ele:ft (14970 ft) is ignored.
        id: 'node/27000005',
        name: 'Zumsteinspitze',
        lat: 45.9,
        lon: 7.87,
        elevationM: 4563,
        elevationSource: 'osm',
      },
    ]);
  });

  it('drops the unnamed node and the way with no centroid', async () => {
    const peaks = await load().fetchPeaks(ZERMATT_AREA);
    expect(peaks.map((p) => p.id)).not.toContain('way/220000002');
    expect(peaks.map((p) => p.id)).not.toContain('node/27000003');
    expect(peaks).toHaveLength(8);
  });

  it('sends a single POST to the Overpass interpreter', async () => {
    const transport = loadFixtureTransport(fixtureDir('zermatt'));
    await new OverpassPeaksProvider(transport).fetchPeaks(ZERMATT_AREA);
    expect(transport.requestedKeys).toHaveLength(1);
    expect(transport.requestedKeys[0]).toContain(`POST ${OVERPASS_URL}`);
  });
});

describe('overpass failure modes', () => {
  const emptyTransport = (): FixtureTransport =>
    new FixtureTransport([
      {
        request: {
          url: OVERPASS_URL,
          method: 'POST',
          body: { data: buildPeaksQuery(ZERMATT_AREA) },
        },
        response: { status: 200, json: { version: 0.6, elements: [] } },
      },
    ]);

  it('reports an area with no peaks as empty-result', async () => {
    expect(await codeOf(new OverpassPeaksProvider(emptyTransport()).fetchPeaks(ZERMATT_AREA))).toBe(
      'empty-result',
    );
  });

  it('returns [] when the caller says empty is acceptable', async () => {
    const peaks = await new OverpassPeaksProvider(emptyTransport()).fetchPeaks(ZERMATT_AREA, {
      allowEmpty: true,
    });
    expect(peaks).toEqual([]);
  });

  it('treats an Overpass remark as a failure, not as "no peaks here"', async () => {
    const transport = new FixtureTransport([
      {
        request: { url: OVERPASS_URL, method: 'POST', body: { data: buildPeaksQuery(ZERMATT_AREA) } },
        response: {
          status: 200,
          json: { elements: [], remark: 'runtime error: Query timed out in "query" at line 3' },
        },
      },
    ]);
    expect(await codeOf(new OverpassPeaksProvider(transport).fetchPeaks(ZERMATT_AREA))).toBe(
      'bad-response',
    );
  });
});

describe('resolvePeakElevations', () => {
  it('fills tag-less peaks from SRTM and labels the source honestly', async () => {
    const transport = loadFixtureTransport(fixtureDir('zermatt'));
    const candidates = await new OverpassPeaksProvider(transport).fetchPeaks(ZERMATT_AREA);

    const { peaks, unresolved } = await resolvePeakElevations(
      candidates,
      new OpenTopoDataElevationProvider(transport),
    );

    expect(unresolved).toEqual([]);
    expect(peaks).toHaveLength(8);
    expect(peaks.map((p) => [p.name, p.elevationM, p.elevationSource])).toEqual([
      ['Matterhorn', 4478, 'osm'],
      ['Dufourspitze', 4634, 'osm'],
      ['Breithorn', 4164, 'osm'],
      ['Klein Matterhorn', 3883, 'osm'],
      // From fixtures/api/zermatt/srtm90m-unelevated-peaks.json
      ['Riffelhorn', 2921, 'srtm'],
      ['Unterrothorn', 3097, 'srtm'],
      ['Nordend', 4608.881, 'osm'],
      ['Zumsteinspitze', 4563, 'osm'],
    ]);
  });

  it('reports peaks no source can place a height on rather than inventing one', async () => {
    const candidates: readonly PeakCandidate[] = [
      { id: 'node/1', name: 'Tagged', lat: 45, lon: 7, elevationM: 2000, elevationSource: 'osm' },
      { id: 'node/2', name: 'Void', lat: 46, lon: 8, elevationM: null, elevationSource: 'unknown' },
    ];
    const noData: ElevationProvider = {
      fetchElevations: (points: readonly LatLng[]): Promise<readonly ElevationResult[]> =>
        Promise.resolve(
          points.map((p) => ({ lat: p.lat, lon: p.lon, elevationM: null, dataset: 'srtm90m' })),
        ),
    };

    const { peaks, unresolved } = await resolvePeakElevations(candidates, noData);

    expect(peaks.map((p) => p.name)).toEqual(['Tagged']);
    expect(unresolved.map((p) => p.name)).toEqual(['Void']);
  });

  it('asks the elevation API for nothing when every peak is already tagged', async () => {
    const transport = new FixtureTransport();
    const { peaks } = await resolvePeakElevations(
      [{ id: 'node/1', name: 'Tagged', lat: 45, lon: 7, elevationM: 2000, elevationSource: 'osm' }],
      new OpenTopoDataElevationProvider(transport),
    );
    expect(peaks).toHaveLength(1);
    expect(transport.requestedKeys).toEqual([]);
  });
});
