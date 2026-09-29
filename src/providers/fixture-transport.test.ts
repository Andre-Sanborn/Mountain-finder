/**
 * Offline replay (archive/v2-docs-20260929/PLAN.md P2.1). Fixtures are matched by canonical key, and a
 * request nobody recorded must fail loudly rather than resolve to nothing.
 */

import { describe, expect, it } from 'vitest';

import { isProviderError } from './errors.js';
import { FixtureTransport, exchangeBodyText, type RecordedExchange } from './fixture-transport.js';

const elevationExchange: RecordedExchange = {
  request: { url: 'https://api.opentopodata.org/v1/srtm90m?locations=45.0,7.0&interpolation=bilinear' },
  response: {
    status: 200,
    json: { status: 'OK', results: [{ dataset: 'srtm90m', elevation: 1234.5, location: { lat: 45, lng: 7 } }] },
  },
};

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (isProviderError(error)) return error.code;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('FixtureTransport', () => {
  it('replays a recording whose request is written in a different but equivalent form', async () => {
    const transport = new FixtureTransport([elevationExchange]);

    const res = await transport.request({
      // parameters in the other order, comma percent-encoded
      url: 'https://api.opentopodata.org/v1/srtm90m?interpolation=bilinear&locations=45.0%2C7.0',
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(elevationExchange.response.json);
  });

  it('records the keys it was asked for, in order', async () => {
    const transport = new FixtureTransport([elevationExchange]);
    await transport.request({ url: 'https://api.opentopodata.org/v1/srtm90m?locations=45.0,7.0&interpolation=bilinear' });

    expect(transport.requestedKeys).toEqual([
      'GET https://api.opentopodata.org/v1/srtm90m?interpolation=bilinear&locations=45.0%2C7.0',
    ]);
  });

  it('fails with fixture-missing rather than inventing a response', async () => {
    const transport = new FixtureTransport([elevationExchange]);
    expect(await codeOf(transport.request({ url: 'https://api.opentopodata.org/v1/srtm90m?locations=1,1' }))).toBe(
      'fixture-missing',
    );
  });

  it('replays recorded failures with the right code', async () => {
    const transport = new FixtureTransport([
      { request: { url: 'https://example.org/limited' }, response: { status: 429, body: 'slow down' } },
      { request: { url: 'https://example.org/broken' }, response: { status: 500, body: 'boom' } },
    ]);

    expect(await codeOf(transport.request({ url: 'https://example.org/limited' }))).toBe('rate-limited');
    expect(await codeOf(transport.request({ url: 'https://example.org/broken' }))).toBe('bad-response');
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const transport = new FixtureTransport([elevationExchange]);

    expect(
      await codeOf(
        transport.request({
          url: 'https://api.opentopodata.org/v1/srtm90m?locations=45.0,7.0&interpolation=bilinear',
          signal: controller.signal,
        }),
      ),
    ).toBe('aborted');
  });

  it('matches POST bodies through form-field order and whitespace', async () => {
    const transport = new FixtureTransport([
      {
        request: {
          url: 'https://overpass-api.de/api/interpreter',
          method: 'POST',
          body: { data: '[out:json];\n(\n  node["natural"="peak"];\n);\nout body center;' },
        },
        response: { status: 200, json: { elements: [] } },
      },
    ]);

    const res = await transport.request({
      url: 'https://overpass-api.de/api/interpreter',
      method: 'POST',
      body: { data: '[out:json]; ( node["natural"="peak"]; ); out body center;' },
    });

    expect(JSON.parse(res.body)).toEqual({ elements: [] });
  });
});

describe('exchangeBodyText', () => {
  it('prefers a raw body and otherwise serialises the recorded json', () => {
    expect(exchangeBodyText({ request: { url: 'https://x.test/' }, response: { status: 200, body: 'raw' } })).toBe(
      'raw',
    );
    expect(exchangeBodyText({ request: { url: 'https://x.test/' }, response: { status: 200, json: { a: 1 } } })).toBe(
      '{"a":1}',
    );
    expect(exchangeBodyText({ request: { url: 'https://x.test/' }, response: { status: 204 } })).toBe('');
  });
});
