/**
 * The two ways a field bundle leaves the phone, and the one way it may not.
 *
 * The decisive test is the last one: this module holds no `fetch`, no
 * `XMLHttpRequest` and no URL, asserted against its own source text rather than
 * against a mock. A network call added here would be a privacy failure that no
 * behavioural test would catch, because it would still share the files.
 *
 * The bundle and its frames have to arrive together — truth is a pixel in the
 * frame, so a bundle whose photographs were left behind cannot be graded. The
 * partial-save case is therefore reported as a failure, not as a save.
 */

import { describe, expect, it } from 'vitest';

import {
  BUNDLE_MIME,
  FRAME_MIME,
  browserBundleShareTarget,
  shareFieldFiles,
  type BundleShareTarget,
  type ShareableFile,
} from './field-share';

const FILES: readonly ShareableFile[] = [
  { name: 'mountain-finder-field-bundle.json', mime: BUNDLE_MIME, body: '{"format":"…"}' },
  { name: 'c1.jpg', mime: FRAME_MIME, body: 'jpeg-bytes-stand-in' },
  { name: 'c2.jpg', mime: FRAME_MIME, body: 'jpeg-bytes-stand-in' },
];

function target(overrides: Partial<BundleShareTarget> = {}): BundleShareTarget {
  return {
    canShareFiles: () => true,
    shareFiles: async () => undefined,
    saveFiles: (files) => files.length,
    ...overrides,
  };
}

describe('sharing a field bundle', () => {
  it('hands the share sheet every file in one call', async () => {
    const calls: (readonly ShareableFile[])[] = [];
    const result = await shareFieldFiles(
      FILES,
      target({
        shareFiles: async (files) => {
          calls.push(files);
        },
      }),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.map((file) => file.name)).toEqual([
      'mountain-finder-field-bundle.json',
      'c1.jpg',
      'c2.jpg',
    ]);
    expect(result.outcome).toBe('shared');
    expect(result.message).toContain('3 files');
    expect(result.message).toContain('Nothing was uploaded');
  });

  it('reads a cancelled share sheet as a cancellation, not a failure', async () => {
    const abort = new Error('user cancelled');
    abort.name = 'AbortError';
    const result = await shareFieldFiles(
      FILES,
      target({
        shareFiles: () => Promise.reject(abort),
        saveFiles: () => {
          throw new Error('a cancelled share must not fall through to a download');
        },
      }),
    );
    expect(result.outcome).toBe('cancelled');
    expect(result.message).toContain('still here');
  });

  it('falls back to downloads when the platform cannot share files', async () => {
    const saved: string[] = [];
    const result = await shareFieldFiles(
      FILES,
      target({
        canShareFiles: () => false,
        saveFiles: (files) => {
          for (const file of files) saved.push(file.name);
          return files.length;
        },
      }),
    );
    expect(saved).toHaveLength(3);
    expect(result.outcome).toBe('saved');
    expect(result.message).toContain('all together');
  });

  it('falls back to downloads when the share sheet throws for any other reason', async () => {
    const result = await shareFieldFiles(
      FILES,
      target({ shareFiles: () => Promise.reject(new Error('not allowed')) }),
    );
    expect(result.outcome).toBe('saved');
  });

  it('calls a partial save a failure, because the frames must travel with the file', async () => {
    const result = await shareFieldFiles(
      FILES,
      target({ canShareFiles: () => false, saveFiles: () => 1 }),
    );
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('Only 1 of 3');
    expect(result.message).toContain('travel together');
  });

  it('says so when neither route worked', async () => {
    const result = await shareFieldFiles(
      FILES,
      target({ canShareFiles: () => false, saveFiles: () => 0 }),
    );
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('neither share nor save');
  });

  it('refuses to claim a share when there is nothing to send', async () => {
    const result = await shareFieldFiles([], target());
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('take a capture first');
  });
});

describe('the browser target', () => {
  it('reports no file share when the platform has none', () => {
    expect(browserBundleShareTarget(undefined, undefined).canShareFiles(FILES)).toBe(false);
    expect(browserBundleShareTarget({}, undefined).canShareFiles(FILES)).toBe(false);
  });

  it('reports no file share when canShare throws on the files key', () => {
    const built = browserBundleShareTarget(
      {
        share: async () => undefined,
        canShare: () => {
          throw new TypeError('files is not a recognised member');
        },
      },
      undefined,
    );
    expect(built.canShareFiles(FILES)).toBe(false);
  });

  it('asks the platform about every file, not just the first', () => {
    let asked = 0;
    const built = browserBundleShareTarget(
      {
        share: async () => undefined,
        canShare: (data) => {
          asked = data.files.length;
          return true;
        },
      },
      undefined,
    );
    expect(built.canShareFiles(FILES)).toBe(true);
    expect(asked).toBe(3);
  });

  it('saves nothing when there is no document to build a link in', () => {
    expect(browserBundleShareTarget({}, undefined).saveFiles(FILES)).toBe(0);
  });
});

describe('the module itself', () => {
  it('holds no network call and no URL of its own', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(fileURLToPath(new URL('./field-share.ts', import.meta.url)), 'utf8');
    // The comments name these to explain the rule, so only code is searched:
    // every line that is not a comment or blank.
    const code = source
      .split('\n')
      .filter((line) => {
        const trimmed = line.trim();
        return trimmed.length > 0 && !trimmed.startsWith('*') && !trimmed.startsWith('//') && trimmed !== '/**';
      })
      .join('\n');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'http://', 'https://', 'sendBeacon']) {
      expect(code, banned).not.toContain(banned);
    }
  });
});
