/**
 * Public surface of the overlay renderer (archive/v2-docs-20260929/PLAN.md P4.1).
 *
 * Everything exported here is pure: a scene of plain data goes in, pixel
 * geometry or an SVG string comes out. No DOM, no canvas, no filesystem, no
 * network, no clock, no randomness.
 *
 * The PNG compositor (P4.2) is deliberately NOT re-exported from here. It needs
 * a real browser — `Image`, `<canvas>`, `toBlob` — and keeping it behind its own
 * import path (`src/render/composite`) means the purity of this entry point is
 * visible in the import graph rather than merely asserted in a comment.
 */

export * from './types';
export * from './xml';
export * from './text-metrics';
export * from './geometry';
export * from './layout';
export * from './svg';
export * from './crowding';
