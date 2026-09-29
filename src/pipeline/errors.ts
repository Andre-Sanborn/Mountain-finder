/**
 * Failures that belong to the orchestration layer rather than to a provider.
 *
 * A `ProviderError` means "the data source could not answer". A
 * `PipelineError` means "the data source answered and the run still cannot
 * proceed" — no terrain under the observer, a sweep that sampled nothing, a
 * pose with fields nobody supplied. They are separated because the fix differs:
 * one is fetch a tile, the other is tell the pipeline something it needs.
 */

export type PipelineErrorCode =
  /** No elevation could be established for the observer's own coordinate. */
  | 'observer-elevation-unknown'
  /** An elevation was supplied for the observer, but it is NaN or infinite. */
  | 'observer-elevation-not-finite'
  /** The terrain sweep produced no usable samples, so there is no horizon. */
  | 'no-terrain'
  /** A pose field is missing and no override supplied it. */
  | 'incomplete-pose'
  /** Two routes through the same inputs disagreed — a bug, reported as one. */
  | 'internal-inconsistency'
  /** The caller's AbortSignal fired. */
  | 'aborted';

export class PipelineError extends Error {
  readonly code: PipelineErrorCode;

  constructor(code: PipelineErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PipelineError';
    this.code = code;
  }
}

export function isPipelineError(error: unknown): error is PipelineError {
  return error instanceof PipelineError;
}

/** Throw `aborted` if the caller has cancelled. Checked between ray batches. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return;
  throw new PipelineError('aborted', 'The pipeline run was aborted by the caller');
}
