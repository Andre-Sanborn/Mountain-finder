/**
 * Elevation provider (archive/v2-docs-20260929/PLAN.md P2.2 self-check) — entirely offline.
 *
 * Expectations are read off the fixture files and the OpenTopoData docs, not
 * produced by running the parser:
 *  - `fixtures/api/synthetic-ramp/` states its own rule ("the sample at request
 *    index i has elevation 1000 + i"), so 150 points must come back as
 *    1000…1149 in exactly that order, split into 100 + 50.
 *  - `fixtures/api/monterey-bay/srtm90m-coast.json` lists 12.0, null, null,
 *    25.0 in that order.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { LatLng } from '../core/types.js';
import {
  MAX_LOCATIONS_PER_REQUEST,
  OpenTopoDataElevationProvider,
  SRTM90M_URL,
  batchPoints,
  elevationRequestUrl,
  toElevationSamples,
} from './elevation.js';
import { isProviderError, type ProviderErrorCode } from './errors.js';
import { FixtureTransport, type RecordedExchange } from './fixture-transport.js';
import { loadFixtureTransport } from './fixture-store.js';

const fixtureDir = (name: string): string =>
  fileURLToPath(new URL(`../../fixtures/api/${name}`, import.meta.url));

/** The ramp fixture's documented grid: index i → 45+0.001i, 7+0.001i. */
const rampPoints: readonly LatLng[] = Array.from({ length: 150 }, (_unused, i) => ({
  lat: 45 + i * 0.001,
  lon: 7 + i * 0.001,
}));

const montereyPoints: readonly LatLng[] = [
  { lat: 36.8, lon: -121.79 },
  { lat: 36.75, lon: -121.9 },
  { lat: 36.7, lon: -122.0 },
  { lat: 36.96, lon: -121.98 },
];

async function codeOf(promise: Promise<unknown>): Promise<ProviderErrorCode> {
  try {
    await promise;
  } catch (error) {
    if (isProviderError(error)) return error.code;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('request construction', () => {
  it('builds the documented OpenTopoData query', () => {
    const url = new URL(
      elevationRequestUrl([
        { lat: 45.9763, lon: 7.6586 },
        { lat: 46, lon: 7.7 },
      ]),
    );

    expect(`${url.origin}${url.pathname}`).toBe(SRTM90M_URL);
    // lat,lng pairs separated by "|", six decimals, request order preserved.
    expect(url.searchParams.get('locations')).toBe('45.976300,7.658600|46.000000,7.700000');
    expect(url.searchParams.get('interpolation')).toBe('bilinear');
  });

  it('splits at the API limit of 100 locations per request', () => {
    expect(MAX_LOCATIONS_PER_REQUEST).toBe(100);
    expect(batchPoints(rampPoints, 100).map((b) => b.length)).toEqual([100, 50]);
    expect(batchPoints(rampPoints.slice(0, 100), 100).map((b) => b.length)).toEqual([100]);
    expect(batchPoints(rampPoints.slice(0, 101), 100).map((b) => b.length)).toEqual([100, 1]);
    expect(batchPoints([], 100)).toEqual([]);
  });

  it('never lets a caller exceed or nullify the batch limit', () => {
    expect(batchPoints(rampPoints, 1000).map((b) => b.length)).toEqual([100, 50]);
    expect(batchPoints(rampPoints.slice(0, 3), 0).map((b) => b.length)).toEqual([1, 1, 1]);
  });
});

describe('fetchElevations against the recorded ramp', () => {
  it('returns 150 elevations in request order from exactly 2 batches', async () => {
    const transport = loadFixtureTransport(fixtureDir('synthetic-ramp'));
    const provider = new OpenTopoDataElevationProvider(transport);

    expect(provider.batchCount(rampPoints)).toBe(2);

    const results = await provider.fetchElevations(rampPoints);

    expect(results).toHaveLength(150);
    expect(transport.requestedKeys).toHaveLength(2);

    // Independent expectation: the fixture states elevation = 1000 + request index.
    expect(results.map((r) => r.elevationM)).toEqual(
      Array.from({ length: 150 }, (_unused, i) => 1000 + i),
    );
    // Spot-check the batch seam explicitly.
    expect(results[99]?.elevationM).toBe(1099);
    expect(results[100]?.elevationM).toBe(1100);
    // Coordinates come back attached to their own reading.
    expect(results[100]?.lat).toBeCloseTo(45.1, 9);
    expect(results[100]?.lon).toBeCloseTo(7.1, 9);
    expect(results[0]?.dataset).toBe('srtm90m');
  });

  it('makes one request per batch when the batch size is smaller', async () => {
    const transport = loadFixtureTransport(fixtureDir('synthetic-ramp'));
    const provider = new OpenTopoDataElevationProvider(transport);
    await provider.fetchElevations(rampPoints);
    expect(transport.requestedKeys).toHaveLength(2);
  });

  it('costs nothing for an empty request', async () => {
    const transport = loadFixtureTransport(fixtureDir('synthetic-ramp'));
    const results = await new OpenTopoDataElevationProvider(transport).fetchElevations([]);
    expect(results).toEqual([]);
    expect(transport.requestedKeys).toEqual([]);
  });
});

describe('no-data handling', () => {
  it('keeps ocean samples as null instead of 0 m', async () => {
    const transport = loadFixtureTransport(fixtureDir('monterey-bay'));
    const results = await new OpenTopoDataElevationProvider(transport).fetchElevations(
      montereyPoints,
    );

    expect(results.map((r) => r.elevationM)).toEqual([12, null, null, 25]);
  });

  it('forces the caller to choose what no-data means', async () => {
    const transport = loadFixtureTransport(fixtureDir('monterey-bay'));
    const results = await new OpenTopoDataElevationProvider(transport).fetchElevations(
      montereyPoints,
    );

    expect(toElevationSamples(results, 'drop').map((s) => s.elevationM)).toEqual([12, 25]);
    expect(toElevationSamples(results, { fillM: 0 }).map((s) => s.elevationM)).toEqual([
      12, 0, 0, 25,
    ]);
    expect(() => toElevationSamples(results, 'throw')).toThrowError(/No elevation data/);
    expect(toElevationSamples(results, 'drop')[0]).toEqual({ lat: 36.8, lon: -121.79, elevationM: 12 });
  });
});

describe('malformed responses', () => {
  const point: LatLng = { lat: 45, lon: 7 };
  const url = elevationRequestUrl([point]);

  const withPayload = (json: unknown): FixtureTransport =>
    new FixtureTransport([{ request: { url }, response: { status: 200, json } } as RecordedExchange]);

  const fetchOne = (json: unknown): Promise<unknown> =>
    new OpenTopoDataElevationProvider(withPayload(json)).fetchElevations([point]);

  it('rejects a non-OK API status', async () => {
    expect(
      await codeOf(fetchOne({ status: 'INVALID_REQUEST', error: 'Invalid location provided' })),
    ).toBe('bad-response');
  });

  it('rejects a response with no results array', async () => {
    expect(await codeOf(fetchOne({ status: 'OK' }))).toBe('bad-response');
  });

  it('reports an empty result set as empty-result', async () => {
    expect(await codeOf(fetchOne({ status: 'OK', results: [] }))).toBe('empty-result');
  });

  it('rejects a result count that does not match the request', async () => {
    const twoPoints = [point, { lat: 46, lon: 8 }];
    const transport = new FixtureTransport([
      {
        request: { url: elevationRequestUrl(twoPoints) },
        response: {
          status: 200,
          json: {
            status: 'OK',
            results: [{ dataset: 'srtm90m', elevation: 100, location: { lat: 45, lng: 7 } }],
          },
        },
      },
    ]);
    expect(
      await codeOf(new OpenTopoDataElevationProvider(transport).fetchElevations(twoPoints)),
    ).toBe('bad-response');
  });

  it('rejects results echoed back out of request order', async () => {
    expect(
      await codeOf(
        fetchOne({
          status: 'OK',
          results: [{ dataset: 'srtm90m', elevation: 100, location: { lat: 46, lng: 8 } }],
        }),
      ),
    ).toBe('bad-response');
  });

  it('rejects a non-numeric elevation', async () => {
    expect(
      await codeOf(
        fetchOne({
          status: 'OK',
          results: [{ dataset: 'srtm90m', elevation: '815', location: { lat: 45, lng: 7 } }],
        }),
      ),
    ).toBe('bad-response');
  });

  it('rejects a body that is not JSON', async () => {
    const transport = new FixtureTransport([
      { request: { url }, response: { status: 200, body: '<html>gateway timeout</html>' } },
    ]);
    expect(await codeOf(new OpenTopoDataElevationProvider(transport).fetchElevations([point]))).toBe(
      'bad-response',
    );
  });
});
