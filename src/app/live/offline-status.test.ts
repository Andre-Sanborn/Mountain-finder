/**
 * The offline strip's wording and its choice of grid.
 *
 * The byte lengths are the geometry's own arithmetic — rows × cols × 2, which is
 * what `expectedGridByteLength` states and what a truncated download fails
 * against — so they are written out here rather than taken from a run.
 */

import { describe, expect, it } from 'vitest';

import type { OfflineCacheStatus } from '../../offline/offline-cache';
import { TERRAIN_MANIFEST_VERSION, type TerrainManifest } from '../../providers/terrain-manifest';
import {
  downloadProgressSentence,
  downloadResultSentence,
  megabytes,
  offlineOffer,
  offlineStatusSentence,
} from './offline-status';

/** The shape the Bogus Basin package publishes: one mosaic, 3920 × 5427 samples. */
const MOSAIC_ROWS = 3920;
const MOSAIC_COLS = 5427;
const MOSAIC_BYTES = MOSAIC_ROWS * MOSAIC_COLS * 2;

const MANIFEST: TerrainManifest = {
  version: TERRAIN_MANIFEST_VERSION,
  grids: [
    {
      name: 'N43W117',
      url: 'tiles/N43W117.hgt',
      dataset: 'srtm1',
      geometry: {
        northLat: 44,
        westLon: -117,
        rows: 3601,
        cols: 3601,
        latStepDeg: 1 / 3600,
        lonStepDeg: 1 / 3600,
      },
    },
    {
      name: 'bogus-basin-60km',
      url: 'sites/bogus-basin/bogus-basin-60km.i16be',
      dataset: 'srtm1',
      geometry: {
        northLat: 44.31583333333333,
        westLon: -116.84222222222222,
        rows: MOSAIC_ROWS,
        cols: MOSAIC_COLS,
        latStepDeg: 1 / 3600,
        lonStepDeg: 1 / 3600,
      },
    },
  ],
};

const OBSERVER = { lat: 43.77148, lon: -116.08862 };

const READY: OfflineCacheStatus = {
  supported: true,
  controlled: true,
  shell: ['live.html', 'live.js', 'live.css'],
  data: ['terrain/manifest.json'],
  usageBytes: 43_000_000,
  quotaBytes: 1_000_000_000,
};

describe('offlineOffer', () => {
  it('offers the grid the sweep will read, not the smallest or the first listed', () => {
    const offer = offlineOffer(MANIFEST, OBSERVER);
    expect(offer?.grid.name).toBe('bogus-basin-60km');
    // 3920 × 5427 × 2 bytes = 42 547 680, which is 42.5 MB decimal.
    expect(offer?.byteLength).toBe(MOSAIC_BYTES);
    expect(offer?.byteLength).toBe(42_547_680);
    expect(offer?.label).toBe('Download bogus-basin-60km for offline use (42.5 MB)');
  });

  it('offers the whole tile where no mosaic covers the viewpoint', () => {
    const offer = offlineOffer(MANIFEST, { lat: 43.2, lon: -116.9 });
    expect(offer?.grid.name).toBe('N43W117');
    expect(offer?.byteLength).toBe(3601 * 3601 * 2);
  });

  it('offers nothing before a fix, and nothing where no grid covers the fix', () => {
    expect(offlineOffer(MANIFEST, undefined)).toBeUndefined();
    expect(offlineOffer(undefined, OBSERVER)).toBeUndefined();
    expect(offlineOffer(MANIFEST, { lat: 45.98, lon: 7.78 })).toBeUndefined();
  });
});

describe('offlineStatusSentence', () => {
  it('names the counts and the space, in the order a trailhead needs them', () => {
    const sentence = offlineStatusSentence(READY);
    expect(sentence).toContain('3 page files');
    expect(sentence).toContain('1 terrain files');
    expect(sentence).toContain('using 43.0 MB of 1000.0 MB allowed');
  });

  it('says the page is not installed yet, and what to do about it', () => {
    const sentence = offlineStatusSentence({ ...READY, controlled: false });
    expect(sentence).toContain('not installed for offline use yet');
    expect(sentence).toContain('Reload once while you still have a signal');
  });

  it('reports an unknown storage estimate as unknown, never as zero', () => {
    const sentence = offlineStatusSentence({ ...READY, usageBytes: null, quotaBytes: null });
    expect(sentence).toContain('will not say how much space');
    expect(sentence).not.toContain('0.0 MB');
  });

  it('passes a browser’s own refusal straight through', () => {
    const sentence = offlineStatusSentence({
      supported: false,
      controlled: false,
      shell: [],
      data: [],
      usageBytes: null,
      quotaBytes: null,
      error: 'This build does not install an offline cache.',
    });
    expect(sentence).toBe('This build does not install an offline cache.');
  });
});

describe('downloadResultSentence', () => {
  it('says done, with the size and what it bought', () => {
    const sentence = downloadResultSentence(
      { ok: true, gridName: 'bogus-basin-60km', cached: ['a', 'b'], failed: [] },
      MOSAIC_BYTES,
    );
    expect(sentence).toContain('Done');
    expect(sentence).toContain('bogus-basin-60km');
    expect(sentence).toContain('42.5 MB');
    expect(sentence).toContain('works with no signal');
  });

  it('says failed, why, and that nothing works offline yet', () => {
    const sentence = downloadResultSentence(
      { ok: false, cached: [], failed: ['a', 'b'], error: 'the network dropped' },
      MOSAIC_BYTES,
    );
    expect(sentence).toContain('Failed: the network dropped');
    expect(sentence).toContain('2 files were not kept');
    expect(sentence).toContain('Try again');
  });
});

describe('downloadProgressSentence', () => {
  it('names the size and the seconds so far, and says to keep the page open', () => {
    const offer = offlineOffer(MANIFEST, OBSERVER);
    expect(offer).toBeDefined();
    if (offer === undefined) return;
    const sentence = downloadProgressSentence(offer, 12_400);
    expect(sentence).toContain('42.5 MB');
    expect(sentence).toContain('12 s so far');
    expect(sentence).toContain('Keep this page open');
  });
});

describe('megabytes', () => {
  it('is decimal megabytes to one place, the unit a phone’s storage prompt uses', () => {
    expect(megabytes(42_547_680)).toBe('42.5');
    expect(megabytes(0)).toBe('0.0');
  });
});
