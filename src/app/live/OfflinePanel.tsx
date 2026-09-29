/**
 * The offline strip — is this page going to work with no signal, and one button
 * that makes it so.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS COMPONENT OWNS
 * ═══════════════════════════════════════════════════════════════════════════
 * A poll, a button and three sentences. `src/offline/offline-cache.ts` holds the
 * worker commands, `offline-status.ts` holds the wording and the choice of grid,
 * and both are tested without a browser.
 *
 * ── WHY THE CONTROLLER IS READ OFF `window` EACH TIME ──────────────────────
 * `live-main.tsx` installs `window.mountainFinderOffline` at start-up, and that
 * is the only handle to the worker the page has. It is read on use rather than
 * captured in state so this component holds no stale copy of it, and so a page
 * that installs it late still gets a working button on the next poll.
 *
 * ── WHY A TIMEOUT AROUND THE STATUS READ ───────────────────────────────────
 * `offlineCacheStatus` waits on `navigator.serviceWorker.ready`, which never
 * settles when no worker is registered — the dev server serves none, and a
 * wedged worker on a phone behaves the same way. Without a timeout the poll
 * would leave a promise pending for ten minutes and the line would stay blank
 * with no reason given. The download itself is NOT raced: 42 MB over a mountain
 * road takes as long as it takes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { LatLng } from '../../core/types';
import type {
  OfflineCacheController,
  OfflineCacheStatus,
  SiteDownloadResult,
} from '../../offline/offline-cache';
import { parseTerrainManifest, type TerrainManifest } from '../../providers/terrain-manifest';
import {
  downloadProgressSentence,
  downloadResultSentence,
  offlineOffer,
  offlineStatusSentence,
  type OfflineOffer,
} from './offline-status';

/** How often the cache is re-read. Another tab's download changes it. */
const POLL_MS = 5000;

/** How long a status read may take before it is reported as no answer. */
const STATUS_TIMEOUT_MS = 4000;

export interface OfflinePanelProps {
  /** The position fix, once there is one. The grid on offer is the one covering it. */
  readonly at: LatLng | undefined;
  /** Where the terrain index is served, already resolved against the app's base. */
  readonly manifestUrl: string;
}

function installedController(): OfflineCacheController | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { mountainFinderOffline?: OfflineCacheController })
    .mountainFinderOffline;
}

const UNKNOWN: OfflineCacheStatus = {
  supported: false,
  controlled: false,
  shell: [],
  data: [],
  usageBytes: null,
  quotaBytes: null,
  error: 'The offline cache has not answered yet.',
};

async function readStatus(): Promise<OfflineCacheStatus> {
  const controller = installedController();
  if (controller === undefined) {
    return { ...UNKNOWN, error: 'This build does not install an offline cache.' };
  }
  return await Promise.race([
    controller.status(),
    new Promise<OfflineCacheStatus>((resolve) => {
      setTimeout(
        () =>
          resolve({
            ...UNKNOWN,
            supported: true,
            error: 'The offline cache did not answer, so nothing is installed yet.',
          }),
        STATUS_TIMEOUT_MS,
      );
    }),
  ]);
}

export function OfflinePanel(props: OfflinePanelProps): JSX.Element {
  const [status, setStatus] = useState<OfflineCacheStatus>(UNKNOWN);
  const [manifest, setManifest] = useState<TerrainManifest | undefined>(undefined);
  const [manifestError, setManifestError] = useState<string | undefined>(undefined);
  const [busySinceMs, setBusySinceMs] = useState<number | undefined>(undefined);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<SiteDownloadResult | undefined>(undefined);
  const offerRef = useRef<OfflineOffer | undefined>(undefined);

  /* ── the index, once ────────────────────────────────────────────────────── */
  useEffect(() => {
    let live = true;
    void fetch(props.manifestUrl)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return parseTerrainManifest((await response.json()) as unknown, props.manifestUrl);
      })
      .then((parsed) => {
        if (live) setManifest(parsed);
      })
      .catch((error: unknown) => {
        if (live) {
          setManifestError(
            `The list of terrain this deployment serves could not be read: ` +
              `${error instanceof Error ? error.message : String(error)}.`,
          );
        }
      });
    return () => {
      live = false;
    };
  }, [props.manifestUrl]);

  /* ── the poll ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void readStatus().then((next) => {
        if (live) setStatus(next);
      });
    };
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  /* ── the elapsed counter, only while a download is running ──────────────── */
  useEffect(() => {
    if (busySinceMs === undefined) return undefined;
    const timer = setInterval(() => setElapsedMs(Date.now() - busySinceMs), 500);
    return () => clearInterval(timer);
  }, [busySinceMs]);

  const offer = offlineOffer(manifest, props.at);
  offerRef.current = offer;

  const download = useCallback(() => {
    const controller = installedController();
    const current = offerRef.current;
    if (controller === undefined || current === undefined) return;
    setResult(undefined);
    setBusySinceMs(Date.now());
    setElapsedMs(0);
    void controller
      .downloadTerrainGrid(current.grid.name)
      .then((outcome) => setResult(outcome))
      .catch((error: unknown) =>
        setResult({
          ok: false,
          cached: [],
          failed: [],
          error: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(() => {
        setBusySinceMs(undefined);
        void readStatus().then(setStatus);
      });
  }, []);

  const busy = busySinceMs !== undefined;

  return (
    <section
      className="live__offline"
      data-testid="live-offline"
      data-supported={String(status.supported)}
      data-controlled={String(status.controlled)}
      data-shell-count={status.shell.length}
      data-data-count={status.data.length}
      data-usage-bytes={status.usageBytes ?? ''}
      data-grid={offer?.grid.name ?? ''}
      data-grid-bytes={offer?.byteLength ?? ''}
      data-busy={String(busy)}
    >
      <p data-testid="live-offline-status">{offlineStatusSentence(status)}</p>

      {manifestError !== undefined && (
        <p className="live__warn" data-testid="live-offline-manifest-error">
          {manifestError}
        </p>
      )}

      {offer !== undefined && (
        <button
          type="button"
          data-testid="live-offline-download"
          disabled={busy}
          onClick={download}
        >
          {offer.label}
        </button>
      )}

      {offer === undefined && manifestError === undefined && (
        <p className="live__hidden-note" data-testid="live-offline-no-offer">
          {props.at === undefined
            ? 'Waiting for your location before offering the terrain around it.'
            : 'This deployment serves no terrain here, so there is nothing to keep.'}
        </p>
      )}

      {busy && offer !== undefined && (
        <p data-testid="live-offline-progress" data-elapsed-ms={elapsedMs}>
          {downloadProgressSentence(offer, elapsedMs)}
        </p>
      )}

      {result !== undefined && offer !== undefined && (
        <p
          className={result.ok ? undefined : 'live__warn'}
          data-testid="live-offline-result"
          data-ok={String(result.ok)}
          data-cached-count={result.cached.length}
        >
          {downloadResultSentence(result, offer.byteLength)}
        </p>
      )}
    </section>
  );
}
