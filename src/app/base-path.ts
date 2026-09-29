/**
 * Where the app's own static data lives when the app is not at the site root.
 *
 * The browser build fetches two things from its own origin — the terrain index
 * at `/terrain/manifest.json` and the peak cells under `/peaks/` (decision D7:
 * no third-party call at runtime). Those paths are written root-relative, which
 * is correct for a site served at `https://host/` and wrong for a GitHub Pages
 * *project* site served at `https://user.github.io/Mountain-finder/`: the
 * bundler rewrites the URLs it generated itself (`/assets/…`) to match `base`,
 * but a string in application code is not one of those. A root-relative fetch
 * from a subpath deployment asks the wrong server directory and gets 404 —
 * which the app then reports, honestly but uselessly, as a deployment holding
 * no terrain at all.
 *
 * So the entry point (`main.tsx`) resolves those two paths against Vite's
 * `import.meta.env.BASE_URL` using the function below. The default `'/'` leaves
 * every URL exactly as it was, so a root deployment is byte-identical to before.
 *
 * Pure on purpose: `import.meta.env` is read at the one place that already
 * touches the DOM, and the joining rule is tested without a browser.
 */

/**
 * Join a Vite `base` with a root-relative application path.
 *
 * `base` is whatever `import.meta.env.BASE_URL` holds: `'/'` by default,
 * `'/Mountain-finder/'` for a project site, and possibly `'./'` or an absolute
 * URL for other hosts. `path` is the path this code would use at the root,
 * with or without its leading slash.
 */
export function resolveFromBase(base: string, path: string): string {
  const relative = path.startsWith('/') ? path.slice(1) : path;
  if (base === '') return `/${relative}`;
  return base.endsWith('/') ? `${base}${relative}` : `${base}/${relative}`;
}
