/**
 * The transport seam (archive/v2-docs-20260929/PLAN.md P2.1).
 *
 * Providers never call `fetch` directly. They describe a request and hand it to
 * a `Transport`. In production that is `FetchTransport`; in every test it is
 * `FixtureTransport`, replaying JSON recorded by `scripts/record-fixtures.ts`.
 *
 * Requests are addressed by a *canonical key* so a recorded exchange can be
 * found again deterministically: same logical request → same key, regardless of
 * query-parameter order, form-field order, or incidental whitespace in a body.
 */

import { ProviderError } from './errors.js';

export type HttpMethod = 'GET' | 'POST';

/**
 * A request body: either a raw string, or form fields that the transport
 * encodes as `application/x-www-form-urlencoded` (what Overpass expects).
 */
export type RequestBody = string | Readonly<Record<string, string>>;

export interface TransportRequest {
  readonly url: string;
  /** Defaults to GET. */
  readonly method?: HttpMethod;
  readonly body?: RequestBody;
  readonly headers?: Readonly<Record<string, string>>;
  /** Caller cancellation. An abort is surfaced immediately and is never retried. */
  readonly signal?: AbortSignal;
  /** Per-request time budget; overrides the transport default. */
  readonly timeoutMs?: number;
}

export interface TransportResponse {
  readonly status: number;
  /** Raw response text. Providers do their own parsing so they own their errors. */
  readonly body: string;
  /** Header names lower-cased. */
  readonly headers: Readonly<Record<string, string>>;
}

export interface Transport {
  request(req: TransportRequest): Promise<TransportResponse>;
}

/** Injectable delay so tests can assert backoff without wall-clock waiting. */
export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Collapse whitespace runs to a single space and trim — incidental formatting is not identity. */
function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Canonical URL: lower-cased scheme/host, default port dropped, query parameters
 * sorted (by name, then value), fragment dropped.
 */
export function canonicalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (cause) {
    throw new ProviderError('bad-response', `Malformed request URL: ${url}`, { url, cause });
  }
  const pairs = [...parsed.searchParams.entries()].sort((a, b) =>
    a[0] === b[0] ? compareStrings(a[1], b[1]) : compareStrings(a[0], b[0]),
  );
  const query = new URLSearchParams(pairs).toString();
  parsed.hash = '';
  parsed.search = '';
  return `${parsed.toString()}${query === '' ? '' : `?${query}`}`;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Canonical body text: form fields sorted by name, values whitespace-collapsed. */
export function canonicalBody(body: RequestBody | undefined): string {
  if (body === undefined) return '';
  if (typeof body === 'string') return collapseWhitespace(body);
  return Object.keys(body)
    .sort(compareStrings)
    .map((key) => `${key}=${collapseWhitespace(body[key] ?? '')}`)
    .join('&');
}

/**
 * The deterministic fixture key for a request.
 * Format: `METHOD <canonical url>` plus ` | <canonical body>` when there is one.
 */
export function fixtureKey(req: TransportRequest): string {
  const method = req.method ?? 'GET';
  const body = canonicalBody(req.body);
  return `${method} ${canonicalUrl(req.url)}${body === '' ? '' : ` | ${body}`}`;
}

/** Short stable hash of a key — used only to name fixture files readably. */
export function fixtureKeyHash(key: string): string {
  // FNV-1a, 32-bit. No dependencies, stable across runs and platforms.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Parse a response body as JSON, converting parser failure into a typed error. */
export function parseJsonBody(res: TransportResponse, url: string): unknown {
  try {
    return JSON.parse(res.body);
  } catch (cause) {
    throw new ProviderError('bad-response', `Response was not valid JSON (${url})`, {
      url,
      status: res.status,
      cause,
    });
  }
}
