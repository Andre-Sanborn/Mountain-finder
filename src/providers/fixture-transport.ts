/**
 * `FixtureTransport` — offline replay (archive/v2-docs-20260929/PLAN.md P2.1, AGENTS.md "Tests are offline").
 *
 * Holds recorded exchanges in memory, addressed by the canonical key derived
 * from the request. It is pure (no filesystem, no network) so it works in the
 * browser test mode as well as in node; loading exchanges off disk is
 * `fixture-store.ts`'s job.
 */

import { ProviderError } from './errors.js';
import {
  fixtureKey,
  type HttpMethod,
  type RequestBody,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from './transport.js';

/** One recorded request/response pair, as stored in `fixtures/api/**.json`. */
export interface RecordedExchange {
  /** Free-text provenance: which site, when recorded, or that it is hand-authored. */
  readonly note?: string;
  readonly request: {
    readonly url: string;
    readonly method?: HttpMethod;
    readonly body?: RequestBody;
  };
  readonly response: {
    readonly status: number;
    readonly headers?: Readonly<Record<string, string>>;
    /**
     * Either the raw response text (`body`) or the already-parsed payload
     * (`json`). `json` keeps recorded API responses readable and diffable.
     */
    readonly body?: string;
    readonly json?: unknown;
  };
}

/** Response text for a recorded exchange (`body` wins over `json`). */
export function exchangeBodyText(exchange: RecordedExchange): string {
  const { body, json } = exchange.response;
  if (body !== undefined) return body;
  if (json !== undefined) return JSON.stringify(json);
  return '';
}

export class FixtureTransport implements Transport {
  /** A missing recording throws rather than falling through: a silent miss hides bugs. */
  private readonly byKey = new Map<string, RecordedExchange>();
  /** Every key requested, in order — lets tests assert batching and call counts. */
  readonly requestedKeys: string[] = [];

  constructor(exchanges: Iterable<RecordedExchange> = []) {
    for (const exchange of exchanges) this.add(exchange);
  }

  add(exchange: RecordedExchange): this {
    this.byKey.set(fixtureKey(exchange.request), exchange);
    return this;
  }

  /** Keys this transport can answer — useful in failure messages and tooling. */
  keys(): readonly string[] {
    return [...this.byKey.keys()];
  }

  request(req: TransportRequest): Promise<TransportResponse> {
    if (req.signal?.aborted === true) {
      return Promise.reject(
        new ProviderError('aborted', `Request aborted by caller: ${req.url}`, { url: req.url }),
      );
    }

    const key = fixtureKey(req);
    this.requestedKeys.push(key);

    const exchange = this.byKey.get(key);
    if (exchange === undefined) {
      return Promise.reject(
        new ProviderError(
          'fixture-missing',
          `No recorded fixture for:\n  ${key}\nRecorded keys:\n${this.keys()
            .map((k) => `  ${k}`)
            .join('\n')}`,
          { url: req.url },
        ),
      );
    }

    const status = exchange.response.status;
    const body = exchangeBodyText(exchange);

    if (status === 429) {
      return Promise.reject(
        new ProviderError('rate-limited', `Recorded rate limit for ${req.url}`, {
          url: req.url,
          status,
        }),
      );
    }
    if (status < 200 || status >= 300) {
      return Promise.reject(
        new ProviderError('bad-response', `Recorded HTTP ${status} for ${req.url}`, {
          url: req.url,
          status,
        }),
      );
    }

    return Promise.resolve({
      status,
      body,
      headers: exchange.response.headers ?? { 'content-type': 'application/json' },
    });
  }
}
