/**
 * The seam's small pure parts. The seam's *behaviour* is proved in the browser
 * by `tests/e2e/app.spec.ts` ("a photo with terrain gets a real overlay…"),
 * which drives the REAL pipeline, renderer and compositor — as of archive/v2-docs-20260929/TODO.md Q1
 * there are no probe implementations left to drive.
 */

import { describe, expect, it } from 'vitest';

import { annotatedFileName } from './seam';

describe('annotatedFileName', () => {
  it('swaps the photo extension for an annotated PNG name', () => {
    expect(annotatedFileName('chamonix-north-east.jpg')).toBe('chamonix-north-east-annotated.png');
    expect(annotatedFileName('IMG_0042.JPEG')).toBe('IMG_0042-annotated.png');
  });

  it('copes with dots in the stem and with no extension at all', () => {
    expect(annotatedFileName('walk.2026-08-16.jpg')).toBe('walk.2026-08-16-annotated.png');
    expect(annotatedFileName('photo')).toBe('photo-annotated.png');
  });

  it('never produces a bare "-annotated.png" from an empty name', () => {
    expect(annotatedFileName('')).toBe('photo-annotated.png');
    expect(annotatedFileName('.jpg')).toBe('photo-annotated.png');
  });
});
