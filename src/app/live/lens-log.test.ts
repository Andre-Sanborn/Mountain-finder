/**
 * Detecting the lens switch iOS does not announce.
 *
 * The expectations follow the module's stated rule: a change of `deviceId`,
 * `width` or `height` is a switch; a change of anything else is not; and the
 * first reading is never a switch because there is nothing to have switched
 * from.
 *
 * The two settings objects in the switch case are the shape of a real 2× lens
 * change — the same virtual device delivering a different frame size — which is
 * the case a `deviceId` comparison alone would miss.
 */

import { describe, expect, it } from 'vitest';

import {
  EMPTY_LENS_LOG,
  lensSwitchWarning,
  recordTrackSettings,
  WATCHED_TRACK_FIELDS,
} from './lens-log';

const WIDE = { deviceId: 'back-triple', width: 1920, height: 1080, frameRate: 30 };
const TELE = { deviceId: 'back-triple', width: 1280, height: 720, frameRate: 30 };

describe('recordTrackSettings', () => {
  it('logs the first reading without calling it a switch', () => {
    const log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]?.changed).toEqual([]);
    expect(log.switches).toHaveLength(0);
    expect(lensSwitchWarning(log)).toBeUndefined();
  });

  it('logs an unchanged reading without calling it a switch', () => {
    let log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    log = recordTrackSettings(log, { ...WIDE }, 1000);
    log = recordTrackSettings(log, { ...WIDE }, 2000);
    expect(log.entries).toHaveLength(3);
    expect(log.switches).toHaveLength(0);
  });

  it('flags a frame-size change on the same device — the iOS 18 case', () => {
    let log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    log = recordTrackSettings(log, TELE, 1000);

    expect(log.switches).toHaveLength(1);
    expect(log.switches[0]?.changed).toEqual(['width', 'height']);
    const warning = lensSwitchWarning(log);
    expect(warning).toContain('1920×1080');
    expect(warning).toContain('1280×720');
    expect(warning).toContain('drag');
  });

  it('flags a device change', () => {
    let log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    log = recordTrackSettings(log, { ...WIDE, deviceId: 'back-ultra' }, 1000);
    expect(log.switches[0]?.changed).toEqual(['deviceId']);
  });

  it('ignores a frame-rate change, which low light causes on its own', () => {
    let log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    log = recordTrackSettings(log, { ...WIDE, frameRate: 15 }, 1000);
    expect(log.switches).toHaveLength(0);
    expect(WATCHED_TRACK_FIELDS).not.toContain('frameRate');
  });

  it('counts repeated switches and reports the latest pair', () => {
    let log = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    log = recordTrackSettings(log, TELE, 1000);
    log = recordTrackSettings(log, WIDE, 2000);
    expect(log.switches).toHaveLength(2);
    const warning = lensSwitchWarning(log);
    // Latest switch: back from 1280×720 to 1920×1080.
    expect(warning).toContain('2 times');
    expect(warning).toContain('from 1280×720 to 1920×1080');
  });

  it('does not mutate the log it is given', () => {
    const first = recordTrackSettings(EMPTY_LENS_LOG, WIDE, 0);
    recordTrackSettings(first, TELE, 1000);
    expect(first.entries).toHaveLength(1);
    expect(first.switches).toHaveLength(0);
    expect(EMPTY_LENS_LOG.entries).toHaveLength(0);
  });

  it('survives a settings object with fields missing', () => {
    // `MediaTrackSettings` fields are all optional, and a browser may omit any
    // of them. A missing field must read as unchanged against another missing
    // one, and as changed against a present one.
    let log = recordTrackSettings(EMPTY_LENS_LOG, {}, 0);
    log = recordTrackSettings(log, {}, 1000);
    expect(log.switches).toHaveLength(0);
    log = recordTrackSettings(log, { width: 1920 }, 2000);
    expect(log.switches[0]?.changed).toEqual(['width']);
    expect(lensSwitchWarning(log)).toContain('?');
  });
});
