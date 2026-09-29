/**
 * `FetchTransport` — the only production path to the network (archive/v2-docs-20260929/PLAN.md P2.1).
 *
 * Retries up to 3 attempts with exponential backoff; rate limiting (HTTP 429)
 * backs off on a longer schedule than a generic failure and honours a numeric
 * `Retry-After`; an abort from the caller surfaces immediately as a typed error
 * and is never retried.
 *
 * The delay function is injected (`sleep`) so tests can assert the *requested*
 * backoff without waiting for it.
 */

import { ProviderError } from './errors.js';
import type { Sleep, Transport, TransportRequest, TransportResponse } from './transport.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchTransportOptions {
  /** Defaults to the global `fetch`. */
  readonly fetchImpl?: FetchLike;
  /** Defaults to a real `setTimeout` delay. Injected in tests. */
  readonly sleep?: Sleep;
  /** Total attempts including the first. Default 3. */
  readonly maxAttempts?: number;
  /** First backoff after a generic failure, doubling each attempt. Default 300 ms. */
  readonly baseDelayMs?: number;
  /** First backoff after HTTP 429, doubling each attempt. Default 2000 ms. */
  readonly rateLimitBaseDelayMs?: number;
  /** Ceiling applied to any computed backoff. Default 30 s. */
  readonly maxDelayMs?: number;
  /** Per-request time budget. Default 15 s. */
  readonly timeoutMs?: number;
  /** Sent as User-Agent; both upstream APIs ask callers to identify themselves. */
  readonly userAgent?: string;
}

type AttemptResult =
  | { readonly kind: 'ok'; readonly response: TransportResponse }
  | {
      readonly kind: 'fail';
      readonly error: ProviderError;
      readonly retryable: boolean;
      readonly retryAfterMs?: number;
    };

const DEFAULT_USER_AGENT = 'mountain-finder/2.0 (+https://github.com/mountain-finder)';

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    // A cancelled caller should not sit through the rest of a backoff.
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export class FetchTransport implements Transport {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: Sleep;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly rateLimitBaseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: FetchTransportOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 300;
    this.rateLimitBaseDelayMs = options.rateLimitBaseDelayMs ?? 2000;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    let lastError: ProviderError | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      throwIfAborted(req.signal, req.url, attempt);

      const result = await this.attemptOnce(req, attempt);
      if (result.kind === 'ok') return result.response;

      lastError = withAttempts(result.error, attempt);
      if (!result.retryable || attempt === this.maxAttempts) break;

      const delayMs = this.delayFor(result, attempt);
      await this.sleep(delayMs, req.signal);
      throwIfAborted(req.signal, req.url, attempt);
    }

    throw (
      lastError ??
      new ProviderError('network', `Request failed with no attempts made: ${req.url}`, {
        url: req.url,
      })
    );
  }

  /** Backoff for the delay *after* `attempt`. Rate limiting always waits longer. */
  private delayFor(result: Extract<AttemptResult, { kind: 'fail' }>, attempt: number): number {
    const base =
      result.error.code === 'rate-limited' ? this.rateLimitBaseDelayMs : this.baseDelayMs;
    const backoffMs = base * 2 ** (attempt - 1);
    return Math.min(Math.max(backoffMs, result.retryAfterMs ?? 0), this.maxDelayMs);
  }

  private async attemptOnce(req: TransportRequest, attempt: number): Promise<AttemptResult> {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutMs = req.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = (): void => controller.abort();
    req.signal?.addEventListener('abort', onCallerAbort, { once: true });

    try {
      const res = await this.fetchImpl(req.url, buildInit(req, controller.signal, this.userAgent));
      const body = await res.text();
      const headers = headersToRecord(res.headers);

      if (res.status === 429) {
        return {
          kind: 'fail',
          retryable: true,
          retryAfterMs: parseRetryAfterMs(headers['retry-after']),
          error: new ProviderError('rate-limited', `Rate limited by ${req.url} (HTTP 429)`, {
            url: req.url,
            status: 429,
            attempts: attempt,
          }),
        };
      }

      if (res.status < 200 || res.status >= 300) {
        return {
          kind: 'fail',
          // 5xx is worth another attempt; a 4xx is our own fault and will not fix itself.
          retryable: res.status >= 500,
          error: new ProviderError(
            'bad-response',
            `HTTP ${res.status} from ${req.url}: ${truncate(body, 200)}`,
            { url: req.url, status: res.status, attempts: attempt },
          ),
        };
      }

      return { kind: 'ok', response: { status: res.status, body, headers } };
    } catch (cause) {
      if (req.signal?.aborted === true) {
        return {
          kind: 'fail',
          retryable: false,
          error: new ProviderError('aborted', `Request aborted by caller: ${req.url}`, {
            url: req.url,
            attempts: attempt,
            cause,
          }),
        };
      }
      if (timedOut) {
        return {
          kind: 'fail',
          retryable: true,
          error: new ProviderError(
            'timeout',
            `Request to ${req.url} exceeded ${timeoutMs} ms`,
            { url: req.url, attempts: attempt, cause },
          ),
        };
      }
      return {
        kind: 'fail',
        retryable: true,
        error: new ProviderError(
          'network',
          `Network failure calling ${req.url}: ${describe(cause)}`,
          { url: req.url, attempts: attempt, cause },
        ),
      };
    } finally {
      clearTimeout(timer);
      req.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

function buildInit(req: TransportRequest, signal: AbortSignal, userAgent: string): RequestInit {
  const headers: Record<string, string> = { 'user-agent': userAgent, ...req.headers };
  let body: string | undefined;

  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      body = req.body;
    } else {
      body = new URLSearchParams(req.body).toString();
      headers['content-type'] ??= 'application/x-www-form-urlencoded';
    }
  }

  return { method: req.method ?? 'GET', headers, body, signal };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** Numeric `Retry-After` (seconds) only; HTTP-date form is ignored on purpose (no clock in here). */
function parseRetryAfterMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return seconds * 1000;
}

function throwIfAborted(signal: AbortSignal | undefined, url: string, attempts: number): void {
  if (signal?.aborted === true) {
    throw new ProviderError('aborted', `Request aborted by caller: ${url}`, { url, attempts });
  }
}

function withAttempts(error: ProviderError, attempts: number): ProviderError {
  if (error.attempts === attempts) return error;
  return new ProviderError(error.code, error.message, {
    status: error.status,
    url: error.url,
    attempts,
    cause: error.cause,
  });
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
