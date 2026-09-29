/**
 * The on-disk half of the fixture loop (archive/v2-docs-20260929/PLAN.md P2.4).
 *
 * The recorder writes exchanges with `writeFixture`; every test reads them back
 * with `loadFixtureTransport`. If that round-trip does not preserve the
 * canonical key, recordings silently stop matching the requests that produced
 * them — so it is asserted here rather than assumed.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { isProviderError } from './errors.js';
import type { RecordedExchange } from './fixture-transport.js';
import { fixtureFileName, loadFixtureFiles, loadFixtureTransport, writeFixture } from './fixture-store.js';

const created: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mf-fixtures-'));
  created.push(dir);
  return dir;
}

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

const exchange: RecordedExchange = {
  note: 'round-trip test',
  request: {
    url: 'https://api.opentopodata.org/v1/srtm90m?locations=45.976300,7.658600&interpolation=bilinear',
    method: 'GET',
  },
  response: {
    status: 200,
    json: {
      status: 'OK',
      results: [{ dataset: 'srtm90m', elevation: 4478, location: { lat: 45.9763, lng: 7.6586 } }],
    },
  },
};

describe('fixture round-trip', () => {
  it('writes a file that replays for the request that produced it', async () => {
    const dir = tempDir();
    const path = writeFixture(dir, 'srtm90m-batch1', exchange);

    expect(path.endsWith('.json')).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(exchange);

    const transport = loadFixtureTransport(dir);
    const res = await transport.request({ url: exchange.request.url });
    expect(JSON.parse(res.body)).toEqual(exchange.response.json);
  });

  it('names files by slug plus a stable key hash', () => {
    const name = fixtureFileName('overpass-peaks', exchange);
    expect(name).toMatch(/^overpass-peaks-[0-9a-f]{8}\.json$/);
    expect(fixtureFileName('overpass-peaks', exchange)).toBe(name);
  });

  it('loads nested site directories and keeps a deterministic order', () => {
    const dir = tempDir();
    writeFixture(join(dir, 'b-site'), 'srtm90m', exchange);
    writeFixture(join(dir, 'a-site'), 'srtm90m', {
      ...exchange,
      request: { ...exchange.request, url: 'https://api.opentopodata.org/v1/srtm90m?locations=1.0,1.0' },
    });

    const paths = loadFixtureFiles(dir).map((f) => f.path);
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('a-site');
    expect(paths[1]).toContain('b-site');
  });

  it('rejects a JSON file that is not a recorded exchange', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'not-a-fixture.json'), '{"hello":"world"}', 'utf8');

    try {
      loadFixtureFiles(dir);
      throw new Error('expected loadFixtureFiles to reject the file');
    } catch (error) {
      expect(isProviderError(error)).toBe(true);
    }
  });
});
