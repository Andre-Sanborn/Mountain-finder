/**
 * The joining rule, against the `base` values Vite actually produces.
 *
 * Expectations come from Vite's documented meaning of `base` and from the URL
 * a GitHub Pages project site serves — `https://<user>.github.io/<repo>/` — not
 * from running the function.
 */
import { describe, expect, it } from 'vitest';

import { resolveFromBase } from './base-path';

describe('resolveFromBase', () => {
  it('leaves a root deployment untouched', () => {
    expect(resolveFromBase('/', '/terrain/manifest.json')).toBe('/terrain/manifest.json');
    expect(resolveFromBase('/', '/peaks')).toBe('/peaks');
  });

  it('prefixes a project-site subpath', () => {
    expect(resolveFromBase('/Mountain-finder/', '/terrain/manifest.json')).toBe(
      '/Mountain-finder/terrain/manifest.json',
    );
    expect(resolveFromBase('/Mountain-finder/', '/peaks')).toBe('/Mountain-finder/peaks');
  });

  it('does not double the separator, and does not drop it', () => {
    // Vite normalises `base` to a trailing slash, but a hand-set base or a
    // host-provided one may not have one, and two slashes are a different URL.
    expect(resolveFromBase('/Mountain-finder', 'terrain/manifest.json')).toBe(
      '/Mountain-finder/terrain/manifest.json',
    );
    expect(resolveFromBase('/Mountain-finder/', 'terrain/manifest.json')).toBe(
      '/Mountain-finder/terrain/manifest.json',
    );
  });

  it('keeps a relative base relative', () => {
    // `base: './'` is how Vite builds an app whose serving path is unknown.
    expect(resolveFromBase('./', '/terrain/manifest.json')).toBe('./terrain/manifest.json');
  });

  it('accepts an absolute base URL', () => {
    expect(resolveFromBase('https://cdn.example/app/', '/peaks')).toBe(
      'https://cdn.example/app/peaks',
    );
  });

  it('falls back to a root-relative URL when the base is empty', () => {
    expect(resolveFromBase('', '/terrain/manifest.json')).toBe('/terrain/manifest.json');
  });
});
