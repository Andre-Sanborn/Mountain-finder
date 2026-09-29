/**
 * Entry point for the live AR screen — the page the phone opens in Safari.
 *
 * A second Vite entry rather than a route inside `index.html`, decided here:
 *
 *   • The two screens share no UI. The still app carries `exifr`, the CV
 *     aligner and the PNG compositor; none of them run on a ridge, and a phone
 *     on a mountain road should not download them.
 *   • `/Mountain-finder/live.html` is an address a person can be given and can
 *     bookmark. A hash route needs the `#` typed correctly on a phone keyboard.
 *   • A static host serves it with no rewrite rule, which is what GitHub Pages
 *     offers.
 *
 * The data wiring is the same as `main.tsx`'s and for the same reasons: terrain
 * and peaks come from this app's own origin (decision D7 — no third-party call
 * at runtime), and both paths resolve against `import.meta.env.BASE_URL` so the
 * page works at a site root and under the `/Mountain-finder/` project subpath.
 *
 * It also installs the offline cache, so the page loads on a ridge with no
 * signal. `src/offline/live-service-worker.ts` says what is cached and why.
 * Only a built deployment registers it. The dev server serves no `sw.js`,
 * and a worker that cached a hashed bundle would fight HMR for no gain, since
 * nothing about offline behaviour can be observed on a laptop on wifi. The
 * deployment check is where it is proved.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { offlineCacheController, registerOfflineCache } from '../offline/offline-cache';
import { createRegionPeakSource } from '../providers/http-peak-store';
import { HttpTerrainStore } from '../providers/http-terrain-store';
import { DEFAULT_TERRAIN_MANIFEST_URL } from '../providers/terrain-manifest';
import { TileElevationProvider } from '../providers/tile-elevation';
import { resolveFromBase } from './base-path';
import { bundledRegionIndexes } from './data-credits';
import { LiveScreen } from './live/LiveScreen';
import { buildLiveScene, type LiveObserver } from './live/live-terrain';
import type { TerrainSource } from './overlay-builder';
// Only this screen's stylesheet: the still app's `styles.css` styles controls
// this page does not have, and a phone on a mountain road downloads it for
// nothing.
import './live/live.css';

const base = import.meta.env.BASE_URL;

const store = new HttpTerrainStore(resolveFromBase(base, DEFAULT_TERRAIN_MANIFEST_URL));
const terrain: TerrainSource = {
  elevation: new TileElevationProvider(store),
  coverage: (lat, lon) => store.coverage(lat, lon),
};

const peaks = createRegionPeakSource(
  bundledRegionIndexes(),
  resolveFromBase(base, '/peaks'),
  (url) => fetch(url),
);

/**
 * The offline cache, reachable without a UI.
 *
 * `useOfflineCache` is the hook the live screen renders when it grows a status
 * line and a "Download Bogus Basin for offline use" button. Until then the same
 * controller hangs off `window`, so a person on the phone and the deployment
 * check can both trigger and inspect a download — and nothing inside
 * `src/app/live/` has to change for either.
 */
const offline = offlineCacheController(base);
declare global {
  interface Window {
    mountainFinderOffline?: typeof offline;
  }
}
window.mountainFinderOffline = offline;
if (import.meta.env.PROD) void registerOfflineCache(base);

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <LiveScreen
      buildScene={(observer: LiveObserver, signal: AbortSignal) =>
        buildLiveScene(observer, { terrain, peaks, signal })
      }
    />
  </StrictMode>,
);
