/**
 * Typed provider failures (archive/v2-docs-20260929/PLAN.md P2.1).
 *
 * Every failure that crosses the provider boundary is a `ProviderError` with a
 * discriminating `code`, so callers can branch on the failure class instead of
 * pattern-matching English message strings.
 */

/**
 * Failure classes.
 *
 * - `network`        transport could not reach the host at all (DNS, TLS, socket).
 * - `timeout`        the request exceeded its own time budget.
 * - `aborted`        the caller's AbortSignal fired; never retried.
 * - `rate-limited`   HTTP 429 and the retry budget is spent.
 * - `bad-response`   reachable but unusable: non-2xx, unparseable JSON, or a
 *                    payload that does not match the documented schema.
 * - `empty-result`   a well-formed response that contains nothing usable.
 * - `fixture-missing` offline replay was asked for a request that was never recorded.
 * - `bad-tile`       a local elevation tile exists but cannot be parsed: byte
 *                    length is not `n × n × 2`, or its name/geometry is malformed.
 *                    Distinct from `bad-response` because no request was involved —
 *                    a corrupt or truncated file on disk is a different fix.
 */
export type ProviderErrorCode =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'rate-limited'
  | 'bad-response'
  | 'empty-result'
  | 'fixture-missing'
  | 'bad-tile';

export interface ProviderErrorDetails {
  /** HTTP status, when the failure came with one. */
  readonly status?: number;
  /** Request URL, when known. */
  readonly url?: string;
  /** How many attempts were made before giving up. */
  readonly attempts?: number;
  /** Underlying error, if this wraps one. */
  readonly cause?: unknown;
}

/** A failure raised by a transport or a data provider. */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status: number | undefined;
  readonly url: string | undefined;
  readonly attempts: number | undefined;

  constructor(code: ProviderErrorCode, message: string, details: ProviderErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'ProviderError';
    this.code = code;
    this.status = details.status;
    this.url = details.url;
    this.attempts = details.attempts;
  }
}

/** Type guard usable across module boundaries (survives duplicate class identities). */
export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof Error && value.name === 'ProviderError' && 'code' in value;
}
