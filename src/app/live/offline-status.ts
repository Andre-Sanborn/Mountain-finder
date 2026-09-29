/**
 * What the offline line says, and which grid the download button offers.
 *
 * `src/offline/offline-cache.ts` does the work — it registers the worker, reads
 * the caches and caches a grid. This module is the wording and the choice of
 * grid, kept out of the component so both are tested without a browser.
 *
 * ── WHY THE PANEL LOOKS THE GRID UP ITSELF ─────────────────────────────────
 * The button has to name a site and a size before anyone taps it, and both come
 * from the served terrain index: `selectTerrainGrid` picks the grid the sweep
 * will actually read at this position, and its geometry gives the exact byte
 * length. Neither fact reaches the screen any other way — the annotated scene
 * carries the sweep's configuration, not the file it was read from.
 *
 * Pure: an index, a coordinate and a status in, sentences out.
 */

import type { LatLng } from '../../core/types';
import type { OfflineCacheStatus, SiteDownloadResult } from '../../offline/offline-cache';
import {
  expectedGridByteLength,
  selectTerrainGrid,
  type TerrainGrid,
  type TerrainManifest,
} from '../../providers/terrain-manifest';

/** Megabytes, decimal, to one place — the unit a phone's storage prompt uses. */
export function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

export interface OfflineOffer {
  readonly grid: TerrainGrid;
  readonly byteLength: number;
  /** The button's own label, site and size included. */
  readonly label: string;
}

/**
 * The grid to offer at this position, or `undefined` when none covers it.
 *
 * The same `selectTerrainGrid` the store uses, so the button never caches a grid
 * the sweep would not have read. The name is the site package's own grid name
 * (`bogus-basin-60km`), which is what `downloadTerrainGrid` takes.
 */
export function offlineOffer(
  manifest: TerrainManifest | undefined,
  at: LatLng | undefined,
): OfflineOffer | undefined {
  if (manifest === undefined || at === undefined) return undefined;
  const grid = selectTerrainGrid(manifest, at.lat, at.lon);
  if (grid === undefined) return undefined;
  const byteLength = expectedGridByteLength(grid.geometry);
  return {
    grid,
    byteLength,
    label: `Download ${grid.name} for offline use (${megabytes(byteLength)} MB)`,
  };
}

/**
 * The status line: whether the page survives losing signal, and what it costs.
 *
 * Three facts in one sentence, in the order someone at a trailhead needs them.
 * An unknown storage estimate is stated as unknown: some privacy modes refuse
 * `navigator.storage.estimate()`, and a zero there would read as an empty cache.
 */
export function offlineStatusSentence(status: OfflineCacheStatus): string {
  if (!status.supported) {
    return status.error ?? 'This browser cannot keep the page for use without a signal.';
  }
  if (!status.controlled) {
    return (
      'The page is not installed for offline use yet' +
      `${status.error === undefined ? '' : ` — ${status.error}`}. ` +
      'Reload once while you still have a signal.'
    );
  }
  const shell = status.shell.length === 0 ? 'no page files' : `${status.shell.length} page files`;
  const data = status.data.length === 0 ? 'no terrain yet' : `${status.data.length} terrain files`;
  const used =
    status.usageBytes === null
      ? 'this browser will not say how much space that uses'
      : `using ${megabytes(status.usageBytes)} MB` +
        (status.quotaBytes === null ? '' : ` of ${megabytes(status.quotaBytes)} MB allowed`);
  return `Kept on this phone: ${shell}, ${data}, ${used}.`;
}

/** What the screen says when a download finishes, either way. */
export function downloadResultSentence(result: SiteDownloadResult, byteLength: number): string {
  if (result.ok) {
    return (
      `Done: ${result.gridName ?? 'the terrain'} is on this phone (${megabytes(byteLength)} MB). ` +
      'The skyline here now works with no signal.'
    );
  }
  return (
    `Failed: ${result.error ?? 'the download did not finish'}. ` +
    `${result.failed.length} file${result.failed.length === 1 ? '' : 's'} were not kept, and ` +
    'nothing here works without a signal yet. Try again with a better signal.'
  );
}

/** What the screen says while a download is running. */
export function downloadProgressSentence(offer: OfflineOffer, elapsedMs: number): string {
  return (
    `Downloading ${offer.grid.name} — ${megabytes(offer.byteLength)} MB, ` +
    `${(elapsedMs / 1000).toFixed(0)} s so far. Keep this page open.`
  );
}
