/**
 * Canonical request keying (archive/v2-docs-20260929/PLAN.md P2.1).
 *
 * Expectations here are written from the rule stated in transport.ts — query
 * parameters sorted, form fields sorted, whitespace in form values collapsed —
 * not from what the implementation happens to emit.
 */

import { describe, expect, it } from 'vitest';

import { canonicalBody, canonicalUrl, fixtureKey, fixtureKeyHash } from './transport.js';

describe('canonicalUrl', () => {
  it('sorts query parameters and drops the fragment', () => {
    expect(canonicalUrl('https://example.org/v1/x?b=2&a=1#frag')).toBe(
      'https://example.org/v1/x?a=1&b=2',
    );
  });

  it('is insensitive to percent-encoding of the same value', () => {
    const raw = canonicalUrl('https://api.opentopodata.org/v1/srtm90m?locations=45.0,7.0|46.0,8.0');
    const encoded = canonicalUrl(
      'https://api.opentopodata.org/v1/srtm90m?locations=45.0%2C7.0%7C46.0%2C8.0',
    );
    expect(raw).toBe(encoded);
  });

  it('lower-cases the host and drops a default port', () => {
    expect(canonicalUrl('https://Overpass-API.de:443/api/interpreter')).toBe(
      'https://overpass-api.de/api/interpreter',
    );
  });

  it('keeps distinct paths distinct', () => {
    expect(canonicalUrl('https://api.opentopodata.org/v1/srtm90m')).not.toBe(
      canonicalUrl('https://api.opentopodata.org/v1/aster30m'),
    );
  });
});

describe('canonicalBody', () => {
  it('sorts form fields by name', () => {
    expect(canonicalBody({ b: '2', a: '1' })).toBe('a=1&b=2');
  });

  it('collapses whitespace inside form values', () => {
    expect(canonicalBody({ data: '[out:json];\n(\n  node;\n);\nout;' })).toBe(
      'data=[out:json]; ( node; ); out;',
    );
  });

  it('treats a missing body as empty', () => {
    expect(canonicalBody(undefined)).toBe('');
  });
});

describe('fixtureKey', () => {
  it('is identical for the same logical request written differently', () => {
    const a = fixtureKey({
      url: 'https://overpass-api.de/api/interpreter',
      method: 'POST',
      body: { data: '[out:json];\nnode["natural"="peak"];\nout;', extra: 'x' },
    });
    const b = fixtureKey({
      url: 'https://overpass-api.de/api/interpreter',
      method: 'POST',
      body: { extra: 'x', data: '[out:json]; node["natural"="peak"]; out;' },
    });
    expect(a).toBe(b);
  });

  it('separates method, url and body in a readable way', () => {
    expect(fixtureKey({ url: 'https://example.org/a?z=1&y=2' })).toBe(
      'GET https://example.org/a?y=2&z=1',
    );
    expect(fixtureKey({ url: 'https://example.org/a', method: 'POST', body: { q: 'hi' } })).toBe(
      'POST https://example.org/a | q=hi',
    );
  });

  it('changes when the request changes', () => {
    const base = fixtureKey({ url: 'https://example.org/a', method: 'POST', body: { q: 'hi' } });
    expect(base).not.toBe(
      fixtureKey({ url: 'https://example.org/a', method: 'POST', body: { q: 'ho' } }),
    );
    expect(base).not.toBe(fixtureKey({ url: 'https://example.org/a', method: 'POST' }));
    expect(base).not.toBe(fixtureKey({ url: 'https://example.org/b', method: 'POST', body: { q: 'hi' } }));
  });
});

describe('fixtureKeyHash', () => {
  it('is 8 hex characters and stable for a given key', () => {
    const hash = fixtureKeyHash('GET https://example.org/a');
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    expect(fixtureKeyHash('GET https://example.org/a')).toBe(hash);
    expect(fixtureKeyHash('GET https://example.org/b')).not.toBe(hash);
  });
});
