/**
 * The two ways off the phone, and the one route that does not exist.
 *
 * The module has no network call of any kind, and the last test asserts that by
 * reading the source: a `fetch` added later would be caught here rather than in
 * a review. Everything else drives the decision between the share sheet and the
 * download with fake platforms.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { shareRecording, type ShareTarget, type SharedRecordingFile } from './home-session-share';

const FILE: SharedRecordingFile = {
  name: 'mountain-finder-home-session.json',
  json: '{"format":"mountain-finder/home-session-recording@1"}',
};

function target(overrides: Partial<ShareTarget>): { target: ShareTarget; calls: string[] } {
  const calls: string[] = [];
  const base: ShareTarget = {
    canShareFile: () => {
      calls.push('canShareFile');
      return false;
    },
    shareFile: () => {
      calls.push('shareFile');
      return Promise.resolve();
    },
    saveFile: () => {
      calls.push('saveFile');
      return true;
    },
  };
  return { target: { ...base, ...overrides }, calls };
}

describe('shareRecording', () => {
  it('hands the file to the share sheet when the platform can take one', async () => {
    let shared: SharedRecordingFile | undefined;
    const { target: platform, calls } = target({
      canShareFile: () => true,
      shareFile: (file) => {
        shared = file;
        return Promise.resolve();
      },
    });
    const result = await shareRecording(FILE, platform);
    expect(result.outcome).toBe('shared');
    expect(shared).toEqual(FILE);
    expect(calls).not.toContain('saveFile');
    expect(result.message).toContain('Nothing was uploaded');
  });

  it('saves to the phone when the platform cannot share files', async () => {
    const { target: platform } = target({ canShareFile: () => false });
    const result = await shareRecording(FILE, platform);
    expect(result.outcome).toBe('saved');
    expect(result.message).toContain('saved');
  });

  it('treats a closed share sheet as nothing sent, not as a failure', async () => {
    const abort = new Error('the user cancelled');
    abort.name = 'AbortError';
    const { target: platform, calls } = target({
      canShareFile: () => true,
      shareFile: () => Promise.reject(abort),
    });
    const result = await shareRecording(FILE, platform);
    expect(result.outcome).toBe('cancelled');
    // Not silently downloaded behind their back either.
    expect(calls).not.toContain('saveFile');
    expect(result.message).toContain('still here');
  });

  it('falls back to the save when the share sheet errors for any other reason', async () => {
    const { target: platform, calls } = target({
      canShareFile: () => true,
      shareFile: () => Promise.reject(new Error('NotAllowedError')),
    });
    const result = await shareRecording(FILE, platform);
    expect(result.outcome).toBe('saved');
    expect(calls).toContain('saveFile');
  });

  it('says so plainly when neither route works', async () => {
    const { target: platform } = target({ canShareFile: () => false, saveFile: () => false });
    const result = await shareRecording(FILE, platform);
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('Copy the text');
  });
});

describe('the module itself', () => {
  it('contains no network call', () => {
    // A capture travels by the user's own action. An upload added here would be
    // a privacy regression that no behavioural test would notice, because the
    // share path would keep working.
    const source = readFileSync(new URL('./home-session-share.ts', import.meta.url), 'utf8')
      // Comments are stripped first, so the prose that explains the rule cannot
      // be what satisfies the check.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource']) {
      expect(source, banned).not.toContain(banned);
    }
  });
});
