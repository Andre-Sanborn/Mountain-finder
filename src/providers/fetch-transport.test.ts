/**
 * FetchTransport retry / backoff / abort behaviour (archive/v2-docs-20260929/PLAN.md P2.1 self-check).
 *
 * No test here waits for a real backoff: `sleep` is injected and records the
 * delays it was *asked* for, which is the thing worth asserting anyway.
 * Expected delays are computed by hand from the documented schedule —
 * generic: 300 ms then 600 ms; rate-limited: 2000 ms then 4000 ms
 * (base × 2^(attempt−1)).
 */

import { describe, expect, it } from 'vitest';

import { FetchTransport, type FetchLike } from './fetch-transport.js';
import { isProviderError, ProviderError } from './errors.js';
import type { Sleep } from './transport.js';

const URL_UNDER_TEST = 'https://api.opentopodata.org/v1/srtm90m?locations=45.0,7.0';

function recordingSleep(): { sleep: Sleep; delays: number[] } {
  const delays: number[] = [];
  const sleep: Sleep = (ms) => {
    delays.push(ms);
    return Promise.resolve();
  };
  return { sleep, delays };
}

/** A fake fetch that plays a scripted sequence, one entry per call. */
function scriptedFetch(steps: readonly (() => Promise<Response>)[]): {
  fetchImpl: FetchLike;
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl: FetchLike = (url, init) => {
    const step = steps[calls.length];
    calls.push({ url, init });
    if (step === undefined) return Promise.reject(new Error(`unexpected call ${calls.length}`));
    return step();
  };
  return { fetchImpl, calls };
}

const netFail = (): Promise<Response> => Promise.reject(new TypeError('fetch failed'));
const ok = (body = '{"status":"OK"}'): (() => Promise<Response>) =>
  () =>
    Promise.resolve(new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }));
const status =
  (code: number, headers: Record<string, string> = {}): (() => Promise<Response>) =>
  () =>
    Promise.resolve(new Response(`{"error":"${code}"}`, { status: code, headers }));

async function expectProviderError(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (error) {
    if (isProviderError(error)) return error;
    throw error;
  }
  throw new Error('expected the request to reject, but it resolved');
}

describe('FetchTransport retry', () => {
  it('fails twice and succeeds on the third attempt', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetchImpl, calls } = scriptedFetch([netFail, netFail, ok('{"status":"OK"}')]);
    const transport = new FetchTransport({ fetchImpl, sleep });

    const res = await transport.request({ url: URL_UNDER_TEST });

    expect(res.status).toBe(200);
    expect(res.body).toBe('{"status":"OK"}');
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([300, 600]);
  });

  it('gives up after 3 attempts with a typed network error', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetchImpl, calls } = scriptedFetch([netFail, netFail, netFail]);
    const transport = new FetchTransport({ fetchImpl, sleep });

    const error = await expectProviderError(transport.request({ url: URL_UNDER_TEST }));

    expect(error.code).toBe('network');
    expect(error.attempts).toBe(3);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([300, 600]);
  });

  it('retries 5xx but never 4xx', async () => {
    const server = recordingSleep();
    const serverFetch = scriptedFetch([status(503), ok()]);
    await new FetchTransport({ fetchImpl: serverFetch.fetchImpl, sleep: server.sleep }).request({
      url: URL_UNDER_TEST,
    });
    expect(serverFetch.calls).toHaveLength(2);

    const client = recordingSleep();
    const clientFetch = scriptedFetch([status(404)]);
    const error = await expectProviderError(
      new FetchTransport({ fetchImpl: clientFetch.fetchImpl, sleep: client.sleep }).request({
        url: URL_UNDER_TEST,
      }),
    );

    expect(error.code).toBe('bad-response');
    expect(error.status).toBe(404);
    expect(clientFetch.calls).toHaveLength(1);
    expect(client.delays).toEqual([]);
  });
});

describe('FetchTransport rate limiting', () => {
  it('waits longer after a 429 than after a generic failure', async () => {
    const generic = recordingSleep();
    await new FetchTransport({
      fetchImpl: scriptedFetch([netFail, netFail, ok()]).fetchImpl,
      sleep: generic.sleep,
    }).request({ url: URL_UNDER_TEST });

    const limited = recordingSleep();
    await new FetchTransport({
      fetchImpl: scriptedFetch([status(429), status(429), ok()]).fetchImpl,
      sleep: limited.sleep,
    }).request({ url: URL_UNDER_TEST });

    expect(generic.delays).toEqual([300, 600]);
    expect(limited.delays).toEqual([2000, 4000]);
    expect(limited.delays[0]).toBeGreaterThan(generic.delays[0] ?? Infinity);
    expect(limited.delays[1]).toBeGreaterThan(generic.delays[1] ?? Infinity);
  });

  it('honours a longer numeric Retry-After but is never shortened by it', async () => {
    const long = recordingSleep();
    await new FetchTransport({
      fetchImpl: scriptedFetch([status(429, { 'Retry-After': '5' }), ok()]).fetchImpl,
      sleep: long.sleep,
    }).request({ url: URL_UNDER_TEST });
    expect(long.delays).toEqual([5000]);

    const short = recordingSleep();
    await new FetchTransport({
      fetchImpl: scriptedFetch([status(429, { 'Retry-After': '1' }), ok()]).fetchImpl,
      sleep: short.sleep,
    }).request({ url: URL_UNDER_TEST });
    expect(short.delays).toEqual([2000]);
  });

  it('reports rate-limited once the retry budget is spent', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetchImpl, calls } = scriptedFetch([status(429), status(429), status(429)]);

    const error = await expectProviderError(
      new FetchTransport({ fetchImpl, sleep }).request({ url: URL_UNDER_TEST }),
    );

    expect(error.code).toBe('rate-limited');
    expect(error.status).toBe(429);
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([2000, 4000]);
  });
});

describe('FetchTransport cancellation', () => {
  it('surfaces an already-aborted signal immediately, without calling fetch', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetchImpl, calls } = scriptedFetch([ok()]);
    const controller = new AbortController();
    controller.abort();

    const error = await expectProviderError(
      new FetchTransport({ fetchImpl, sleep }).request({
        url: URL_UNDER_TEST,
        signal: controller.signal,
      }),
    );

    expect(error.code).toBe('aborted');
    expect(calls).toHaveLength(0);
    expect(delays).toEqual([]);
  });

  it('does not retry a request aborted mid-flight', async () => {
    const { sleep, delays } = recordingSleep();
    const controller = new AbortController();
    const { fetchImpl, calls } = scriptedFetch([
      () => {
        controller.abort();
        return Promise.reject(new DOMException('The operation was aborted.', 'AbortError'));
      },
      ok(),
    ]);

    const error = await expectProviderError(
      new FetchTransport({ fetchImpl, sleep }).request({
        url: URL_UNDER_TEST,
        signal: controller.signal,
      }),
    );

    expect(error.code).toBe('aborted');
    expect(calls).toHaveLength(1);
    expect(delays).toEqual([]);
  });

  it('reports a timeout when the request outlives its budget', async () => {
    const { sleep, delays } = recordingSleep();
    // Never settles on its own; only the transport's internal timeout signal
    // can end it. 5 ms is the transport's own clock, not a backoff wait.
    const fetchImpl: FetchLike = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });

    const error = await expectProviderError(
      new FetchTransport({ fetchImpl, sleep, timeoutMs: 5, maxAttempts: 1 }).request({
        url: URL_UNDER_TEST,
      }),
    );

    expect(error.code).toBe('timeout');
    expect(error.attempts).toBe(1);
    expect(delays).toEqual([]);
  });
});

describe('FetchTransport request shaping', () => {
  it('encodes a form body and identifies the client', async () => {
    const { sleep } = recordingSleep();
    const { fetchImpl, calls } = scriptedFetch([ok('{"elements":[]}')]);

    await new FetchTransport({ fetchImpl, sleep, userAgent: 'mf-test/1.0' }).request({
      url: 'https://overpass-api.de/api/interpreter',
      method: 'POST',
      body: { data: '[out:json];out;' },
    });

    const call = calls[0];
    expect(call).toBeDefined();
    expect(call?.init.method).toBe('POST');
    expect(call?.init.body).toBe('data=%5Bout%3Ajson%5D%3Bout%3B');
    const headers = call?.init.headers as Record<string, string> | undefined;
    expect(headers?.['content-type']).toBe('application/x-www-form-urlencoded');
    expect(headers?.['user-agent']).toBe('mf-test/1.0');
  });

  it('returns the status and lower-cased headers of a success', async () => {
    const { sleep } = recordingSleep();
    const fetchImpl: FetchLike = () =>
      Promise.resolve(
        new Response('{"status":"OK"}', { status: 200, headers: { 'X-Rate-Limit': '1000' } }),
      );

    const res = await new FetchTransport({ fetchImpl, sleep }).request({ url: URL_UNDER_TEST });

    expect(res.status).toBe(200);
    expect(res.headers['x-rate-limit']).toBe('1000');
  });
});
