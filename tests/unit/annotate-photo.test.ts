/**
 * `scripts/annotate-photo.ts` — what the report says about the heading.
 *
 * The script annotates a real photograph from its own EXIF, so the whole
 * picture rests on `GPSImgDirection`. Finding X-10 measured that tag 92.4°
 * wrong on `hdr-gainmap-7270.heic`: 280.336° recorded, 187.9° ± 0.9° solved,
 * with `GPSImgDirectionRef` reading `T` and the frame upright, so neither a
 * magnetic conversion nor a rotation explains it. The run's seven labels named
 * summits the frame does not contain.
 *
 * Nothing in the file distinguishes that frame from the seven that agree with
 * their own sun or solved pose, so the warning belongs on every EXIF heading.
 * These tests hold it to that: present whenever EXIF supplies the heading,
 * absent whenever `--heading` replaces it.
 */

import { describe, expect, it } from 'vitest';

import { headingNotes } from '../../scripts/annotate-photo.js';

const fromExif = headingNotes({ overridden: false, imgDirectionRef: 'T' }).join('\n');

describe('headingNotes — the EXIF heading is a hint, not a pose', () => {
  it('warns on a heading that came from EXIF', () => {
    expect(fromExif).toMatch(/GPSImgDirection/);
    expect(fromExif).toMatch(/WARNING/);
  });

  it('says the tag is a hint to be checked, never a documented pose', () => {
    expect(fromExif).toMatch(/hint to\s+be checked against the picture/);
    expect(fromExif).toMatch(/never a documented pose/);
  });

  it('names the three second instruments that can check it', () => {
    expect(fromExif).toMatch(/identify a summit/);
    expect(fromExif).toMatch(/the sun/);
    expect(fromExif).toMatch(/auto-trim/);
    expect(fromExif).toMatch(/compass\s+budget/);
  });

  it('cites the measurement and where it is written down', () => {
    expect(fromExif).toContain('280.336');
    expect(fromExif).toContain('187.9');
    expect(fromExif).toContain('92.4');
    expect(fromExif).toContain('X-10');
  });

  it('says what is at stake: every label below rests on the number', () => {
    expect(fromExif).toMatch(/every label below rests on this\s+one number/i);
  });

  it('warns the same way when the tag carries no reference at all', () => {
    // A missing ref is a different defect (the heading may be magnetic and
    // nobody can tell), and it does not excuse the run from the X-10 check.
    expect(headingNotes({ overridden: false }).join('\n')).toMatch(/GPSImgDirection/);
  });

  it('is silent once --heading has replaced the tag', () => {
    // The operator supplied the number themselves. Telling them their own
    // heading is an unchecked EXIF tag would be false, and a warning that
    // fires on the wrong runs stops being read on the right ones.
    expect(headingNotes({ overridden: true, imgDirectionRef: 'T' })).toEqual([]);
    expect(headingNotes({ overridden: true, imgDirectionRef: 'M' })).toEqual([]);
  });
});

describe('headingNotes — the magnetic warning', () => {
  it('fires on a magnetic reference, alongside the X-10 warning', () => {
    const magnetic = headingNotes({ overridden: false, imgDirectionRef: 'M' }).join('\n');
    expect(magnetic).toMatch(/MAGNETIC/);
    expect(magnetic).toMatch(/declination/);
    expect(magnetic).toMatch(/GPSImgDirection is a hint/);
  });

  it('stays off for a true-north reference', () => {
    expect(fromExif).not.toMatch(/MAGNETIC/);
  });
});
