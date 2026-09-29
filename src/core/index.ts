/**
 * Public surface of the pure geometry core.
 *
 * Everything exported here is a deterministic function of its arguments: no
 * network, no DOM, no filesystem, no clock, no randomness. Downstream layers
 * (providers, exif, render, app) depend on this module; it depends on nothing
 * but the TypeScript standard library.
 */

export * from './types';
export * from './geodesy';
export * from './declination';
export * from './sightline';
export * from './horizon';
export * from './projection';
export * from './visibility';
export * from './celestial';
