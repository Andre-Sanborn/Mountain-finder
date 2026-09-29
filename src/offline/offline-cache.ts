/**
 * The window side of the offline cache — registration, status, and the one
 * action a "download this site" button performs.
 *
 * `live-service-worker.ts` holds the caching rules. This file is what the page
 * runs: it registers that worker at the deployment base, hands it the hashed
 * asset names (the only party that knows them is the document that loaded
 * them), and answers two questions a person standing at a trailhead actually
 * asks — is this page going to work with no signal, and how much of the phone
 * has it taken.
 *
 * `useOfflineCache` is the hook the live screen can render. It is here rather
 * than in `src/app/live/` so the screen's own module graph does not change, and
 * `live-main.tsx` puts the same controller on `window.mountainFinderOffline`, so
 * the deployment check can drive a download with no UI to click.
 */

import { useEffect, useState } from 'react';

import { parseTerrainManifest } from '../providers/terrain-manifest.js';
import { resolveTerrainUrl } from '../providers/http-terrain-store.js';

/** Where the worker is served from, relative to the app's base. See its header. */
const WORKER_FILE = 'sw.js';

/** How long a command may wait for the worker before the page gives up on it. */
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;

export interface OfflineCacheStatus {
  /** Does this browser have service workers and the Cache API at all? */
  readonly supported: boolean;
  /** Is a worker controlling this page right now? */
  readonly controlled: boolean;
  /** URLs held: the document and its JS/CSS. */
  readonly shell: readonly string[];
  /** URLs held under `terrain/` and `peaks/`. */
  readonly data: readonly string[];
  /** `navigator.storage.estimate()`, in bytes, when the browser reports it. */
  readonly usageBytes: number | null;
  readonly quotaBytes: number | null;
  /** Why the status is empty, when it is empty for a reason worth showing. */
  readonly error?: string;
}

const EMPTY: OfflineCacheStatus = {
  supported: false,
  controlled: false,
  shell: [],
  data: [],
  usageBytes: null,
  quotaBytes: null,
};

interface WorkerReply {
  readonly ok: boolean;
  readonly cached?: readonly string[];
  readonly failed?: readonly string[];
  readonly error?: string;
  readonly status?: { readonly shell: readonly string[]; readonly data: readonly string[] };
}

function supported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'caches' in globalThis;
}

/**
 * The URLs this document loaded: its own address, its module scripts and its
 * stylesheets.
 *
 * Read off the live DOM rather than from a build-time list, because the names
 * carry Vite's content hashes and a list that goes stale caches the wrong build.
 * Exported separately so the selection rule is testable without a worker.
 */
export function shellUrlsFromDocument(doc: Document): readonly string[] {
  const urls = new Set<string>([doc.location.href.split('#')[0] ?? doc.location.href]);
  for (const script of doc.querySelectorAll('script[src]')) {
    const src = script.getAttribute('src');
    if (src !== null && src !== '') urls.add(new URL(src, doc.baseURI).href);
  }
  for (const link of doc.querySelectorAll('link[rel="stylesheet"][href], link[rel="modulepreload"][href]')) {
    const href = link.getAttribute('href');
    if (href !== null && href !== '') urls.add(new URL(href, doc.baseURI).href);
  }
  return [...urls];
}

/** Send one command and wait for the worker's answer over a private channel. */
async function command(payload: Record<string, unknown>): Promise<WorkerReply> {
  if (!supported()) return { ok: false, error: 'This browser has no service worker.' };
  const registration = await navigator.serviceWorker.ready;
  const active = registration.active ?? navigator.serviceWorker.controller;
  if (active === null || active === undefined) {
    return { ok: false, error: 'No active service worker to talk to yet.' };
  }
  return await new Promise<WorkerReply>((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve({ ok: false, error: 'The service worker did not answer.' });
    }, COMMAND_TIMEOUT_MS);
    channel.port1.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve((event.data ?? { ok: false }) as WorkerReply);
    };
    active.postMessage(payload, [channel.port2]);
  });
}

async function estimate(): Promise<{ usageBytes: number | null; quotaBytes: number | null }> {
  if (typeof navigator === 'undefined' || navigator.storage?.estimate === undefined) {
    return { usageBytes: null, quotaBytes: null };
  }
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageBytes: usage ?? null, quotaBytes: quota ?? null };
  } catch {
    // Some privacy modes refuse the estimate. An unknown figure is not a broken
    // cache, so it is reported as unknown rather than as zero.
    return { usageBytes: null, quotaBytes: null };
  }
}

/** What the cache holds, and what the browser says that costs. */
export async function offlineCacheStatus(): Promise<OfflineCacheStatus> {
  if (!supported()) {
    return { ...EMPTY, error: 'This browser cannot cache the page for offline use.' };
  }
  const controlled = navigator.serviceWorker.controller !== null;
  const reply = await command({ type: 'mf-status' });
  const { usageBytes, quotaBytes } = await estimate();
  return {
    supported: true,
    controlled,
    shell: reply.status?.shell ?? [],
    data: reply.status?.data ?? [],
    usageBytes,
    quotaBytes,
    ...(reply.ok ? {} : { error: reply.error ?? 'The service worker did not report its caches.' }),
  };
}

export interface SiteDownloadResult {
  readonly ok: boolean;
  /** Grid the terrain index named, when it named one. */
  readonly gridName?: string;
  readonly cached: readonly string[];
  readonly failed: readonly string[];
  readonly error?: string;
}

/**
 * Cache one named terrain grid and the index that points at it.
 *
 * This is the "Download Bogus Basin for offline use" action, named after what it
 * does rather than after one site: a deployment that publishes a second field
 * site gets the same button by passing a different grid name. The grid is the
 * expensive part — 42.55 MB for the Bogus Basin mosaic — so it is never fetched
 * without someone asking for it.
 *
 * Peak cells are NOT pre-fetched here. Which cells a sweep touches depends on
 * the fix and the radius, they are a few tens of kilobytes each, and the worker
 * already keeps every one the app has fetched. Guessing at them would spend a
 * person's data on files a sweep may not read.
 */
export async function downloadTerrainGrid(
  base: string,
  gridName: string,
): Promise<SiteDownloadResult> {
  const manifestUrl = `${base}terrain/manifest.json`;
  let response: Response;
  try {
    response = await fetch(manifestUrl);
  } catch {
    return { ok: false, cached: [], failed: [], error: `Could not reach ${manifestUrl}.` };
  }
  if (!response.ok) {
    return {
      ok: false,
      cached: [],
      failed: [],
      error: `No terrain index at ${manifestUrl} (HTTP ${response.status}).`,
    };
  }
  const manifest = parseTerrainManifest(await response.json(), manifestUrl);
  const grid = manifest.grids.find((entry) => entry.name === gridName);
  if (grid === undefined) {
    return {
      ok: false,
      cached: [],
      failed: [],
      error:
        `This deployment serves no grid called ${gridName}. It serves: ` +
        `${manifest.grids.map((entry) => entry.name).join(', ')}.`,
    };
  }
  const urls = [manifestUrl, resolveTerrainUrl(manifestUrl, grid.url)];
  const reply = await command({ type: 'mf-cache-data', urls });
  return {
    ok: reply.ok,
    gridName,
    cached: reply.cached ?? [],
    failed: reply.failed ?? urls,
    ...(reply.error === undefined ? {} : { error: reply.error }),
  };
}

/** Drop every cached terrain and peak file, keeping the page itself installed. */
export async function forgetOfflineData(): Promise<boolean> {
  return (await command({ type: 'mf-forget-data' })).ok;
}

/**
 * Register the worker and hand it this document's shell.
 *
 * Called once from the page entry point. Failure is reported, never thrown: a
 * browser that refuses a worker still runs the app with a network.
 */
export async function registerOfflineCache(base: string): Promise<OfflineCacheStatus> {
  if (!supported()) {
    return { ...EMPTY, error: 'This browser cannot cache the page for offline use.' };
  }
  try {
    await navigator.serviceWorker.register(`${base}${WORKER_FILE}`, { scope: base });
    await navigator.serviceWorker.ready;
  } catch (error) {
    return { ...EMPTY, supported: true, error: `Service worker refused: ${String(error)}` };
  }
  // The worker claims its clients on activation, but the page that installed it
  // is not controlled until then; waiting keeps the first visit's precache from
  // being posted into the void.
  if (navigator.serviceWorker.controller === null) {
    await new Promise<void>((resolve) => {
      const done = (): void => {
        navigator.serviceWorker.removeEventListener('controllerchange', done);
        resolve();
      };
      navigator.serviceWorker.addEventListener('controllerchange', done);
      // A reload of an already-controlled page never fires the event.
      if (navigator.serviceWorker.controller !== null) done();
    });
  }
  await command({ type: 'mf-precache-shell', urls: shellUrlsFromDocument(document) });
  return await offlineCacheStatus();
}

/** Everything a button and a status line need, in one object. */
export interface OfflineCacheController {
  status(): Promise<OfflineCacheStatus>;
  downloadTerrainGrid(gridName: string): Promise<SiteDownloadResult>;
  forgetData(): Promise<boolean>;
}

export function offlineCacheController(base: string): OfflineCacheController {
  return {
    status: offlineCacheStatus,
    downloadTerrainGrid: (gridName) => downloadTerrainGrid(base, gridName),
    forgetData: forgetOfflineData,
  };
}

/**
 * The live screen's status line: what is cached, and what it costs.
 *
 * Polls rather than subscribes, because the facts it reports change from outside
 * this page — another tab's download, the browser's own eviction — and no event
 * fires for either.
 */
export function useOfflineCache(pollMs = 5000): OfflineCacheStatus {
  const [status, setStatus] = useState<OfflineCacheStatus>(EMPTY);
  useEffect(() => {
    let live = true;
    const read = (): void => {
      void offlineCacheStatus().then((next) => {
        if (live) setStatus(next);
      });
    };
    read();
    const timer = setInterval(read, pollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [pollMs]);
  return status;
}
