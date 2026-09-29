/**
 * `npm run record:fixtures` — the ONLY code permitted to hit live APIs
 * (AGENTS.md "Tests are offline", archive/v2-docs-20260929/PLAN.md P2.4).
 *
 * Record a site:
 *   npm run record:fixtures -- --site zermatt --lat 45.9833 --lon 7.7847 \
 *                              --radius-km 15 [--rays 8] [--samples-per-ray 15]
 *
 * Verify what is already on disk, offline (touches no network at all):
 *   npm run record:fixtures -- --verify [--site zermatt]
 *
 * Recording drives the real providers through a `RecordingTransport` wrapping
 * `FetchTransport`, so every captured exchange is keyed exactly the way the
 * provider will ask for it at replay time — recorded fixtures cannot drift from
 * the request shapes the code actually produces.
 */

import { fileURLToPath } from 'node:url';

import type { LatLng } from '../src/core/types.js';
import {
  OpenTopoDataElevationProvider,
  type ElevationResult,
} from '../src/providers/elevation.js';
import { isProviderError } from '../src/providers/errors.js';
import { FetchTransport } from '../src/providers/fetch-transport.js';
import { loadFixtureFiles, writeFixture } from '../src/providers/fixture-store.js';
import { FixtureTransport, type RecordedExchange } from '../src/providers/fixture-transport.js';
import {
  OverpassPeaksProvider,
  parsePeaksResponse,
  resolvePeakElevations,
  type PeakCandidate,
} from '../src/providers/peaks.js';
import type { Transport, TransportRequest, TransportResponse } from '../src/providers/transport.js';

const FIXTURE_ROOT = fileURLToPath(new URL('../fixtures/api', import.meta.url));

interface Options {
  readonly verify: boolean;
  readonly site: string | undefined;
  readonly lat: number | undefined;
  readonly lon: number | undefined;
  readonly radiusKm: number;
  readonly rays: number;
  readonly samplesPerRay: number;
}

function parseArgs(argv: readonly string[]): Options {
  const flags = new Map<string, string>();
  let verify = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith('--')) continue;
    const name = arg.slice(2);
    if (name === 'verify') {
      verify = true;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`--${name} needs a value`);
    flags.set(name, next);
    i += 1;
  }

  const num = (name: string, fallback: number): number => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got "${raw}"`);
    return value;
  };
  const optionalNum = (name: string): number | undefined => {
    const raw = flags.get(name);
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`--${name} must be a number, got "${raw}"`);
    return value;
  };

  return {
    verify,
    site: flags.get('site'),
    lat: optionalNum('lat'),
    lon: optionalNum('lon'),
    radiusKm: num('radius-km', 15),
    rays: num('rays', 8),
    samplesPerRay: num('samples-per-ray', 15),
  };
}

/** Wraps a real transport and keeps every exchange it saw, in order. */
class RecordingTransport implements Transport {
  private readonly inner: Transport;
  private readonly note: string;
  readonly exchanges: RecordedExchange[] = [];

  constructor(inner: Transport, note: string) {
    this.inner = inner;
    this.note = note;
  }

  async request(req: TransportRequest): Promise<TransportResponse> {
    const res = await this.inner.request(req);
    this.exchanges.push({
      note: this.note,
      request: {
        url: req.url,
        method: req.method ?? 'GET',
        ...(req.body === undefined ? {} : { body: req.body }),
      },
      response: {
        status: res.status,
        headers: { 'content-type': res.headers['content-type'] ?? 'application/json' },
        json: JSON.parse(res.body) as unknown,
      },
    });
    return res;
  }
}

/**
 * A coarse sampling grid around the observer: `rays` bearings out to
 * `radiusKm`, `samplesPerRay` points along each. Enough real terrain for the
 * horizon builder to work with, without abusing a free API.
 */
function samplingGrid(
  center: LatLng,
  radiusKm: number,
  rays: number,
  samplesPerRay: number,
): LatLng[] {
  const points: LatLng[] = [center];
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.32 * Math.cos((center.lat * Math.PI) / 180);

  for (let r = 0; r < rays; r += 1) {
    const bearingRad = (2 * Math.PI * r) / rays;
    for (let s = 1; s <= samplesPerRay; s += 1) {
      const distanceKm = (radiusKm * s) / samplesPerRay;
      points.push({
        lat: center.lat + (distanceKm * Math.cos(bearingRad)) / kmPerDegLat,
        lon: center.lon + (distanceKm * Math.sin(bearingRad)) / kmPerDegLon,
      });
    }
  }
  return points;
}

async function record(options: Options): Promise<number> {
  const { site, lat, lon } = options;
  if (site === undefined || lat === undefined || lon === undefined) {
    console.error(
      'Usage: npm run record:fixtures -- --site <name> --lat <deg> --lon <deg> [--radius-km 15]',
    );
    console.error('       npm run record:fixtures -- --verify [--site <name>]');
    return 2;
  }

  const center: LatLng = { lat, lon };
  const dir = `${FIXTURE_ROOT}/${site}`;
  const note =
    `LIVE RECORDING for site "${site}" (${lat}, ${lon}), ` +
    `captured ${new Date().toISOString()} by scripts/record-fixtures.ts.`;

  const live = new FetchTransport();
  const peaksTransport = new RecordingTransport(live, note);
  const elevationTransport = new RecordingTransport(live, note);

  console.log(`[record] site=${site} center=${lat},${lon} radius=${options.radiusKm} km`);

  const peaks = await new OverpassPeaksProvider(peaksTransport).fetchPeaks(
    { center, radiusKm: options.radiusKm },
    { allowEmpty: true },
  );
  console.log(`[record] overpass: ${peaks.length} named peak(s)`);

  const elevation = new OpenTopoDataElevationProvider(elevationTransport);
  const grid = samplingGrid(center, options.radiusKm, options.rays, options.samplesPerRay);
  console.log(
    `[record] opentopodata: ${grid.length} point(s) in ${elevation.batchCount(grid)} batch(es)`,
  );
  await elevation.fetchElevations(grid);

  // Heights for peaks whose OSM tags carry none — the same call the app makes.
  const tagless = peaks.filter((peak: PeakCandidate) => peak.elevationM === null);
  if (tagless.length > 0) {
    await resolvePeakElevations(peaks, elevation);
    console.log(`[record] opentopodata: heights for ${tagless.length} tag-less peak(s)`);
  }

  for (const exchange of peaksTransport.exchanges) {
    console.log(`[record] wrote ${writeFixture(dir, 'overpass-peaks', exchange)}`);
  }
  elevationTransport.exchanges.forEach((exchange, index) => {
    console.log(`[record] wrote ${writeFixture(dir, `srtm90m-batch${index + 1}`, exchange)}`);
  });

  return 0;
}

/**
 * Offline: replay every recording through the production parsers. This is
 * P2.4's self-check — a recording the providers cannot read is not a fixture.
 */
async function verify(options: Options): Promise<number> {
  const dir = options.site === undefined ? FIXTURE_ROOT : `${FIXTURE_ROOT}/${options.site}`;
  const files = loadFixtureFiles(dir);
  if (files.length === 0) {
    console.error(`[verify] no fixtures found under ${dir}`);
    return 1;
  }

  let failures = 0;
  for (const { path, exchange } of files) {
    const url = exchange.request.url;
    try {
      if (url.includes('/api/interpreter')) {
        const peaks = await replayPeaks(exchange, url);
        const withHeight = peaks.filter((peak) => peak.elevationM !== null).length;
        console.log(
          `[verify] OK  ${path} → ${peaks.length} peak(s), ${peaks.length - withHeight} without a tagged height`,
        );
      } else {
        const results = await replayElevations(exchange, url);
        const noData = results.filter((result) => result.elevationM === null).length;
        console.log(`[verify] OK  ${path} → ${results.length} sample(s), ${noData} no-data`);
      }
    } catch (error) {
      failures += 1;
      const detail = isProviderError(error) ? `${error.code}: ${error.message}` : String(error);
      console.error(`[verify] BAD ${path} → ${detail}`);
    }
  }

  console.log(`[verify] ${files.length - failures}/${files.length} fixture(s) parsed cleanly`);
  return failures === 0 ? 0 : 1;
}

function replayPeaks(exchange: RecordedExchange, url: string): Promise<readonly PeakCandidate[]> {
  const transport = new FixtureTransport([exchange]);
  return transport
    .request({ url, method: 'POST', body: exchange.request.body })
    .then((res) => parsePeaksResponse(JSON.parse(res.body), url));
}

/**
 * Rebuild the request that produced this recording from its own URL, then run
 * it back through the elevation provider — proving key, schema and parser all
 * still line up.
 */
function replayElevations(
  exchange: RecordedExchange,
  url: string,
): Promise<readonly ElevationResult[]> {
  const parsed = new URL(url);
  const locations = parsed.searchParams.get('locations');
  if (locations === null) throw new Error('elevation fixture URL has no locations parameter');

  const points: LatLng[] = locations.split('|').map((pair) => {
    const [latText, lonText] = pair.split(',');
    return { lat: Number(latText), lon: Number(lonText) };
  });

  const interpolation = parsed.searchParams.get('interpolation');
  const provider = new OpenTopoDataElevationProvider(new FixtureTransport([exchange]), {
    url: `${parsed.origin}${parsed.pathname}`,
    ...(interpolation === 'nearest' || interpolation === 'cubic'
      ? { interpolation }
      : { interpolation: 'bilinear' as const }),
    batchSize: points.length,
  });

  return provider.fetchElevations(points);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.verify) {
    process.exitCode = await verify(options);
    return;
  }

  try {
    process.exitCode = await record(options);
  } catch (error) {
    if (isProviderError(error)) {
      console.error(`[record] FAILED (${error.code}): ${error.message}`);
      if (error.code === 'network' || error.code === 'timeout') {
        console.error(
          '[record] the live APIs were not reachable from this environment; no fixtures were written.',
        );
      }
    } else {
      console.error(`[record] FAILED: ${String(error)}`);
    }
    process.exitCode = 1;
  }
}

await main();
