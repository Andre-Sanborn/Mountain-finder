/**
 * The service worker behind the live AR screen — what makes the page work with
 * no network after one visit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY A SERVICE WORKER AT ALL
 * ═══════════════════════════════════════════════════════════════════════════
 * The phone opens `live.html` on a ridge, which is where cell coverage ends.
 * Everything the screen needs is already static bytes on the app's own origin
 * (decision D7): the built JS and CSS, the terrain index, one grid of samples,
 * and the peak cells. An HTTP cache may hold them and may not; a service worker
 * holds them on purpose and answers while the radio is off.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SCOPE, AND WHY THIS FILE IS NOT A MODULE WITH IMPORTS
 * ═══════════════════════════════════════════════════════════════════════════
 * A worker's scope is the directory it is served from, and it cannot be widened
 * without a `Service-Worker-Allowed` response header, which GitHub Pages does
 * not let anyone set. So this file is emitted as `sw.js` at the DEPLOYMENT ROOT
 * — `/Mountain-finder/sw.js` for the project site, `/sw.js` at a site root —
 * rather than next to the hashed bundles in `assets/`. `vite.config.ts` does
 * that by transpiling this one file and emitting it under a fixed name, which
 * is also why it has no imports: there is no bundler step to resolve them.
 *
 * `self.registration.scope` is therefore the app's base URL, and every rule
 * below is written against it instead of against a hard-coded `/`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS CACHED, AND WHEN
 * ═══════════════════════════════════════════════════════════════════════════
 *   SHELL (`mf-shell-*`)  The document and its hashed JS and CSS. The page
 *                         posts its own asset list after the worker takes
 *                         control, so nothing here has to know a build hash.
 *   DATA  (`mf-data-*`)   Whatever was fetched under `terrain/` and `peaks/`,
 *                         cached as it arrives, plus whatever an explicit
 *                         "download this site for offline use" asks for.
 *
 * Terrain and peak files are content-addressed by the square degree they cover:
 * the elevation of a fixed patch of ground does not change, so cache-first with
 * no revalidation is correct rather than merely convenient. A navigation is
 * network-first, so a republished site is picked up on the next online load
 * instead of being pinned to the first visit forever.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IT DOES NOT DO
 * ═══════════════════════════════════════════════════════════════════════════
 * It never pre-caches a 42 MB site package on its own. iOS 17 gives an origin a
 * large quota — around 60 % of total disk in Safari — but deletes ALL of an
 * origin's script-written storage after seven days with no interaction
 * (https://webkit.org/blog/14403/updates-to-storage-policy/). Spending tens of
 * megabytes of someone's cellular data on a guess that expires is not a default;
 * it is a button, and `src/offline/offline-cache.ts` is what a button calls.
 *
 * TYPES. `tsconfig.json` ships the DOM lib, not WebWorker, because every other
 * file here runs in a window. The shims below name only the worker globals this
 * file touches, so a wrong event field is still a typecheck failure.
 */

/** Bump to abandon every cache this worker wrote. Names carry it. */
const CACHE_VERSION = 'v1';

const SHELL_CACHE = `mf-shell-${CACHE_VERSION}`;
const DATA_CACHE = `mf-data-${CACHE_VERSION}`;

/** Path prefixes, relative to the scope, whose bytes never change. */
const DATA_PREFIXES = ['terrain/', 'peaks/'] as const;

/** The page this worker exists for. Cached at install, before any page asks. */
const SHELL_DOCUMENTS = ['live.html'] as const;

interface ExtendableEventShim extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEventShim extends Event {
  readonly request: Request;
  respondWith(response: Response | Promise<Response>): void;
}

interface MessageEventShim extends Event {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}

interface ServiceWorkerScope {
  readonly registration: { readonly scope: string };
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEventShim) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventShim) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventShim) => void): void;
}

const worker = self as unknown as ServiceWorkerScope;

/** The deployment's base URL: `https://host/Mountain-finder/`, slash included. */
const scope = worker.registration.scope.endsWith('/')
  ? worker.registration.scope
  : `${worker.registration.scope}/`;

/** Is this one of ours — same origin, at or under the app's own base? */
function isInScope(url: URL): boolean {
  return `${url.origin}${url.pathname}`.startsWith(scope);
}

/** Path below the base, so a rule can be written once for both layouts. */
function pathInScope(url: URL): string {
  return `${url.origin}${url.pathname}`.slice(scope.length);
}

function isDataRequest(url: URL): boolean {
  const path = pathInScope(url);
  return DATA_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * Put a response in a cache, and say whether it was worth keeping.
 *
 * Only a plain 200 is stored. A 206 cannot be replayed as a whole body, and an
 * opaque cross-origin response would be cached as a success it cannot prove —
 * this app has no cross-origin requests to begin with (D7), so one arriving is
 * a reason to leave it alone rather than to cache it.
 */
async function keep(cacheName: string, request: Request, response: Response): Promise<boolean> {
  if (!response.ok || response.status !== 200 || response.type === 'opaque') return false;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return true;
}

/**
 * Cache first, then the network, for bytes that describe fixed ground.
 *
 * `ignoreVary` because a host that serves a precompressed sibling sends
 * `Vary: Accept-Encoding`, and a stored entry would then only match a request
 * whose header string is identical. One URL under `terrain/` is one grid of
 * samples whatever the transfer encoding was, so the variant is not a different
 * resource here.
 */
async function fromCacheThenNetwork(cacheName: string, request: Request): Promise<Response> {
  const cached = await caches.match(request, { cacheName, ignoreVary: true });
  if (cached !== undefined) return cached;
  const response = await fetch(request);
  await keep(cacheName, request, response);
  return response;
}

/**
 * Network first, cache as the fallback — for the document itself.
 *
 * A republished deployment changes `live.html` and the hashes inside it, so
 * serving the document from cache while online would pin a phone to whatever it
 * saw first. With no network, the cached copy answers instead.
 */
async function fromNetworkThenCache(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    await keep(SHELL_CACHE, request, response);
    return response;
  } catch (error) {
    const cached = await caches.match(request, { cacheName: SHELL_CACHE, ignoreVary: true });
    if (cached !== undefined) return cached;
    const fallback = await caches.match(`${scope}${SHELL_DOCUMENTS[0]}`, {
      cacheName: SHELL_CACHE,
      ignoreVary: true,
    });
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

/** Fetch and store each URL, reporting what actually landed. */
async function cacheUrls(
  cacheName: string,
  urls: readonly string[],
): Promise<{ readonly cached: readonly string[]; readonly failed: readonly string[] }> {
  const cached: string[] = [];
  const failed: string[] = [];
  for (const url of urls) {
    // Sequential on purpose: these are 20-40 MB grids on a phone radio, and a
    // parallel burst of them is how a download fails halfway on both.
    try {
      const request = new Request(url, { credentials: 'same-origin' });
      const response = await fetch(request, { cache: 'no-store' });
      if (await keep(cacheName, request, response)) cached.push(url);
      else failed.push(url);
    } catch {
      failed.push(url);
    }
  }
  return { cached, failed };
}

async function cachedUrls(cacheName: string): Promise<readonly string[]> {
  if (!(await caches.has(cacheName))) return [];
  const cache = await caches.open(cacheName);
  return (await cache.keys()).map((request) => request.url);
}

interface StatusReport {
  readonly scope: string;
  readonly version: string;
  readonly shell: readonly string[];
  readonly data: readonly string[];
}

async function cacheReport(): Promise<StatusReport> {
  return {
    scope,
    version: CACHE_VERSION,
    shell: await cachedUrls(SHELL_CACHE),
    data: await cachedUrls(DATA_CACHE),
  };
}

/** Commands the page sends. A shape that does not match is answered, not ignored. */
function parseCommand(data: unknown): { readonly type: string; readonly urls: readonly string[] } {
  if (typeof data !== 'object' || data === null) return { type: '', urls: [] };
  const record = data as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : '';
  const raw = Array.isArray(record.urls) ? record.urls : [];
  return { type, urls: raw.filter((url): url is string => typeof url === 'string') };
}

worker.addEventListener('install', (event) => {
  // The document is cached before any page asks, so a first visit that ends in
  // a tunnel still has something to reload. The hashed assets come from the
  // page, which is the only party that knows their names.
  event.waitUntil(
    (async () => {
      await cacheUrls(SHELL_CACHE, SHELL_DOCUMENTS.map((file) => `${scope}${file}`));
      await worker.skipWaiting();
    })(),
  );
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('mf-') && name !== SHELL_CACHE && name !== DATA_CACHE) {
          await caches.delete(name);
        }
      }
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (!isInScope(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(fromNetworkThenCache(request));
    return;
  }
  event.respondWith(
    fromCacheThenNetwork(isDataRequest(url) ? DATA_CACHE : SHELL_CACHE, request),
  );
});

worker.addEventListener('message', (event) => {
  const { type, urls } = parseCommand(event.data);
  const port = event.ports[0];
  const reply = (payload: unknown): void => {
    if (port !== undefined) port.postMessage(payload);
  };

  switch (type) {
    case 'mf-precache-shell':
      void cacheUrls(SHELL_CACHE, urls).then(async (result) =>
        reply({ ok: result.failed.length === 0, ...result, status: await cacheReport() }),
      );
      return;
    case 'mf-cache-data':
      void cacheUrls(DATA_CACHE, urls).then(async (result) =>
        reply({ ok: result.failed.length === 0, ...result, status: await cacheReport() }),
      );
      return;
    case 'mf-status':
      void cacheReport().then((report) => reply({ ok: true, status: report }));
      return;
    case 'mf-forget-data':
      void caches
        .delete(DATA_CACHE)
        .then(async (deleted) => reply({ ok: deleted, status: await cacheReport() }));
      return;
    default:
      reply({ ok: false, error: `Unknown command "${type}"` });
  }
});
