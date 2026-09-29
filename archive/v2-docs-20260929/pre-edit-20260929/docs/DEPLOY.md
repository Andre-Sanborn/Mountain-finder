# Deploying Mountain Finder

`npm run build` produces a bundle that **cannot find terrain anywhere**. That is
deliberate — which square degrees of the planet a deployment ships is not the
bundler's decision — but it means the build is not, on its own, deployable. This
document is the missing step.

A deployment is **one static directory**. There is no server, no API key and no
runtime dependency on anybody else's service: decision D7 (MISSION.md) makes
elevation an acquisition-time dependency, and the browser only ever fetches
files from the app's own origin.

```
dist/
  index.html                       vite build
  assets/index-*.js  index-*.css   the app — peak data is compiled INTO the JS
  terrain/
    manifest.json                  the index HttpTerrainStore reads first
    tiles/N45E007.hgt              whole 1° SRTM1 tiles          (25.93 MB each)
    tiles/N45E007.hgt.gz           optional precompressed sibling (16.35 MB)
    windows/gornergrat-window.i16be  committed real-SRTM case windows
  peaks/<region>/index.json        imported Overture peak cells — staged, and
  peaks/<region>/cells/N45E007.json  inert until the app fetches them (see below)
  ATTRIBUTION.txt                  generated from the staged data's citations
```

## Producing it

```bash
npm run fetch:tiles -- N45E007 N46E007        # acquisition: the only network step
npm run build                                 # typecheck + bundle
npm run package:deploy -- --gzip              # assemble dist/terrain and dist/peaks
```

`scripts/package-deploy.ts` stages whatever terrain is already on disk —
`data/tiles/*.hgt` and the committed windows in `fixtures/tiles/cases/` — using
the *same* index builder the dev server uses (`buildTerrainManifest` in
`scripts/terrain-server.ts`), so a deployment serves exactly what `npm run dev`
served. Synthetic test tiles are excluded there and therefore here: invented
mountains at real coordinates is the failure mode this project exists to avoid.

Options:

| Flag | Effect |
|---|---|
| `--out <dir>` | build directory to package into (default `dist`) |
| `--tiles N45E007,N46E007` | stage only these whole tiles |
| `--no-tiles` | case windows only — a 1.45 MB deployment |
| `--no-windows` / `--no-peaks` | leave those out |
| `--gzip` | also write `.gz` siblings for every grid |
| `--copy` | real copies instead of hard links |

Files are hard-linked by default, so packaging 130 MB of tiles costs no disk and
no time. Use `--copy` if your upload step follows inodes rather than content.

The script refuses to stage a grid whose byte length disagrees with the geometry
the index claims for it. A truncated `.hgt` is a plausible-looking grid of the
wrong shape; caught here it is a build failure, caught in a browser it is a
wrong horizon.

## What it costs

Measured, not estimated, on the tiles in this repository (SRTM1, 3601 × 3601
int16 = 25 934 402 bytes per 1° tile). "Wire" is gzip level 6.

| Deployment | Files | On disk | On the wire |
|---|---|---|---|
| Case windows only (`--no-tiles`) | 4 windows | 1.45 MB | 0.79 MB |
| The four ground-truth viewpoints as whole tiles | N45E007, N37W122, N47W123, N56W006 | 103.74 MB | 43.29 MB |
| This repository's sixteen tiles + the windows | 20 grids | 417.57 MB | 189.24 MB |
| The Alps, N43–N48 × E004–E016 | 78 tiles | 2 022.88 MB | ≈ 1 275 MB |
| `/peaks/` — all five regions (Q8) | 63 cell files + 5 indexes | 3.48 MB | (served as-is) |

The `/peaks/` directory breaks down by region — california 1.26 MB (3 341
summits), cascades 1.02 MB (2 717), zermatt 0.67 MB (1 786), idaho-central
0.27 MB (709), fort-william 0.26 MB (684). Measured 2026-08-17, after Q8 made
the app read them.

Per-tile, the numbers vary with how mountainous the tile is — flat and sea
compress well:

| Tile | Raw | gzip -6 | Ratio |
|---|---|---|---|
| N45E007 (Zermatt) | 25.93 MB | 16.35 MB | 63.0 % |
| N46E007 (Bernese Alps) | 25.93 MB | 16.08 MB | 62.0 % |
| N37W122 (San Francisco Bay) | 25.93 MB | 10.08 MB | 38.9 % |
| N56W006 (Hebrides, mostly sea) | 25.93 MB | 8.98 MB | 34.6 % |
| N47W123 (Puget Sound) | 25.93 MB | 7.88 MB | 30.4 % |

The Alps row is a box, not a mask: 6 × 13 whole degrees around the Alpine
Convention perimeter, gzip estimated at the 63 % ratio measured on its own
alpine tiles. A real Alpine deployment would drop the lowland corners and land
nearer 1.3 GB on disk. The unit to budget with is **25.93 MB / 16.35 MB per
mountainous degree square**.

**The windows-only row is a demo, not a deployment.** `--no-tiles` produces a
working app in ~5.3 MB (windows + peaks + bundle). `--no-peaks` is no longer a
valid trim: since Q8 the app READS `/peaks/`, and `verifyPeaksAreServed` fails
the packaging rather than ship an app that fetches 404s. But those windows
were cut to the terrain each *acceptance case* turns on, not to the app's 30 km
sweep: the Gornergrat window is 361 × 1009 samples, about 11 km × 22 km. Rays
run off the edge of it, and a ridge outside the cut cannot occlude anything, so
this configuration can report a summit **visible** that a whole tile would show
as hidden. Ship it to demo the pipeline; ship tiles to be right.

**What one visitor downloads is not that total.** `selectTerrainGrid` picks the
single largest grid covering the viewpoint, so terrain costs *one grid* per
session: 16.35 MB gzipped for an alpine tile, 0.47 MB if the deployment ships
only the tuned case window. Peaks cost the CELLS the query's bounding box
touches, fetched from `/peaks/` on demand (Q8) — at the default 200 km radius
that is at most a region's whole directory, so **≤ 1.26 MB today** (california,
the largest) and typically a few hundred KB; regions the viewpoint is nowhere
near are pruned by their bundled indexes before any request leaves. The JS
bundle itself is 340.21 kB, 110.63 kB gzipped (measured 2026-08-17, region
indexes and attribution footer included; it was 318.40/104.34 kB before Q8).

## Serving it

Any static host. Three things are worth configuring:

1. **Precompression.** `--gzip` writes `foo.hgt.gz` next to `foo.hgt`. Serve it
   for requests that accept gzip, with `Content-Encoding: gzip`, and the browser
   inflates it before the app sees a byte. `HttpTerrainStore` checks the length
   of the *decoded* body, so nothing in the app changes — proved by the
   deployment check below, which watches a 25 934 402-byte tile arrive as
   16 345 818 bytes and still produce the right overlay.

   ```nginx
   location /terrain/ {
     gzip_static on;                      # serves .hgt.gz for .hgt
     add_header Cache-Control "public, max-age=31536000, immutable";
   }
   ```

   Caddy: `file_server { precompressed gzip }`. On S3/CloudFront there is no
   negotiation — upload the `.gz` file *as* the object name with
   `Content-Encoding: gzip` metadata set, or drop `--gzip` and let CloudFront
   compress (it will not: it skips bodies over 10 MB, so precompress).

2. **Caching.** The elevation of a fixed square of the planet does not change.
   `immutable` with a one-year max-age on `/terrain/` and `/peaks/` turns the
   second visit into zero bytes.

3. **No rewrite rule.** Do not fall back to `index.html` for unknown paths. A
   missing tile must 404; if `index.html` arrives where a grid was expected, the
   store reports a truncated download instead of an absent one.

`npm run serve:dist` runs `scripts/static-server.ts` — a plain file server with
exactly these rules — for local checking. It is a harness, not a production
server.

## Where terrain is missing

Nothing is drawn, and the app says why. It names the position, the SRTM tile
that position needs and every grid the deployment *is* serving, and it states
outright that silence is not a verdict:

> No terrain data for 45.92370, 6.86940. That position needs SRTM tile N45E006,
> which this deployment does not hold. It is serving: N37W122, N45E007, …
> Without it there is no horizon and no visibility verdict here, so nothing is
> drawn — an empty overlay would look like "no peaks are visible", which is a
> different claim. Photographs taken over the terrain this build does ship are
> unaffected. (Running Mountain Finder from a source checkout? "npm run
> fetch:tiles -- N45E006" downloads that tile into data/tiles/, which is served
> at /terrain/.)

**Written for both audiences, in that order** (`noTerrainMessage` in
`src/app/overlay-builder.ts`). A visitor to a published site is told what is
true of the deployment — this build does not hold that square degree, and that
is a gap in what was published rather than a verdict about the view — and is
never told to run a command they have no checkout for. The command survives,
last and explicitly conditional, because it is still the one sentence that
closes the gap for whoever *can* run it.

## Peaks

**The app does not fetch peaks.** `src/app/main.tsx` imports
`fixtures/peaks/ground-truth-peaks.json` (15 cited summits, 12 KB), so Vite
compiles it into the JS bundle. Packaging asserts this is still true by looking
for a summit name in the built JS, and fails loudly if it is not — the day the
app switches to HTTP peaks, that is a packaging failure rather than an empty
overlay in front of a user.

The imported Overture regions (`fixtures/peaks/regions/`, thousands of summits,
3.2 MB) are far too large to inline. They are staged at `/peaks/<region>/` in
the layout `TiledPeakStore` expects — `index.json` beside a `cells/` directory,
one 1° cell per file, named exactly like the SRTM tiles — so the switch is a
change inside `src/app/` and *not* also a deployment change: `main.tsx` builds a
`TiledPeakStore` over `/peaks/` instead of importing the JSON, and
`peakDataReadByThisBuild` in `data-credits.ts` moves to `'regions'` in the same
commit so the footer stops saying "not read by this build yet". Until then those
files are served and unused.

## Attribution — displayed by the app (gap closed 2026-08-16)

**The running app shows a data credit in a footer, visible without any
interaction, on first paint.** It names OpenStreetMap and ODbL-1.0 for the
Overture summits and credits NASA/USGS SRTM for the terrain. Grepping the built
bundle now answers:

```
$ npm run build && grep -o "OpenStreetMap" dist/assets/*.js | wc -l
13
```

The same grep returning **nothing** is what proved the gap in the first place.
It is now the cheapest check that the gap is still closed, and it is worth
running before any publish.

| Data | Licence | Obligation |
|---|---|---|
| SRTM 1 arc-second (terrain) | Public domain (NASA/USGS) | None. Credit is courtesy. |
| Overture Maps `base/land` summits | **ODbL-1.0**, © OpenStreetMap contributors | Attribution **required**, in the app, visible to users; licence must be named; a modified database must be offered under the same terms. |
| The 15 cited ground-truth summits | Facts, cited to Wikipedia/USGS GNIS per source | Citations kept in the dataset; no display obligation for the facts themselves. |

`npm run package:deploy` still writes `dist/ATTRIBUTION.txt` from the staged
data's own citation records — a deployer needs a file to publish — but that file
is not what discharges the obligation. The footer is. What it renders today:

> **Summits** — 8,528 summits, 4 regions (california, cascades, fort-william,
> zermatt) — shipped at /peaks/, not read by this build yet: © OpenStreetMap
> contributors, ODbL-1.0, via Overture Maps Foundation. *Attribution required by
> ODbL-1.0.* [ODbL-1.0] [OpenStreetMap copyright]
>
> **Elevation** — terrain horizon and occlusion, from /terrain/: NASA/USGS SRTM
> 1 arc-second global — public domain. *Credit is courtesy, not a condition.*
>
> **Summits** — 15 cited summits — the ones this build labels:
> en.wikipedia.org, www.outdooractive.com. *Cited facts, no licence attached —
> credit is courtesy.*

**Nothing in that text is typed into the UI.** `src/app/attribution.ts` derives
it from the same `sources[]` citation records packaging reads: the licence id
comes from a table matched against the citation's own words (a bare `ODbL` is
reported as `ODbL`, never promoted to `ODbL-1.0` — a licence id is a legal
claim), the holder from the citation's `©` clause, the publisher from the first
clause of its title. `src/app/data-credits.ts` collects the region indexes with
a glob, so **adding `fixtures/peaks/regions/<anything>/` puts it in the footer
under its own licence with no code change**, and removing every region removes
the notice. Consequences worth knowing before you package:

* Credits a licence *requires* are rendered before courtesy credits, so the ODbL
  line is the one that survives a footer clipped on a short screen.
* Required vs courtesy is stated in words, never by colour alone; the footer is
  the document's `contentinfo` landmark and its links are keyboard-reachable.
* The footer is `position: sticky` — on a page tall enough to hide a
  document-end credit it stays on screen, which is the entire point.
* The wording says whether the app *reads* a dataset or merely ships it. That
  one claim is a constant (`peakDataReadByThisBuild` in `data-credits.ts`),
  because it is a fact about `main.tsx` that no data file knows; flipping
  `main.tsx` to the HTTP regions means flipping it in the same commit.

Proved by `src/app/attribution.test.ts` (the derivation, and that the shipped
citations name OpenStreetMap and ODbL-1.0), `tests/e2e/attribution.spec.ts` (on
screen unscrolled, opaque, ≥ 4.5:1 contrast in both colour schemes, keyboard
reachable) and one assertion in the deploy check below, which runs against the
built bundle behind the static server.

## The published site — GitHub Pages

`.github/workflows/pages.yml` publishes this repository to GitHub Pages on every
push to the development branch, and on demand from Actions → pages → Run
workflow. A phone needs an HTTPS origin before the browser will grant camera,
orientation or geolocation, and a Pages site is one at no cost in servers.

It runs the three commands above, with three differences that matter:

1. **It fetches the tiles first.** `npm run fetch:tiles -- N45E007` — tiles are
   not in git, so the runner downloads the square degree the deployment serves.
2. **It builds for a subpath.** A project site is served at
   `https://<owner>.github.io/<repo>/`, so the build is
   `npm run build -- --base=/<repo>/`. The app resolves `/terrain/manifest.json`
   and `/peaks/` against that base at runtime (`src/app/base-path.ts`), because
   Vite rewrites only the URLs it generated itself. The deployment check runs
   against that same subpath build, through a directory that mounts `dist/`
   under the repository name:

   ```bash
   mkdir -p _site-serve && ln -s "$PWD/dist" _site-serve/Mountain-finder
   DEPLOY_CHECK_SERVE_DIR=_site-serve DEPLOY_CHECK_BASE_PATH=/Mountain-finder/ \
     npm run test:deploy
   ```

3. **It refuses to publish photographs.** `npm run check:deploy-privacy` walks
   the package and fails on anything named like or byte-identical to a file in
   `fixtures/photos/real/`, and on any image carrying GPS EXIF. Nothing stages a
   photograph today; the gate is what notices the day something does, before a
   public URL makes it permanent.

A failing deployment check or privacy gate stops the artifact being uploaded, so
the live site keeps serving the last good build.

**Pages has no `gzip_static` equivalent.** `--gzip` stages `.hgt.gz` siblings
that nginx or Caddy would serve in place of `.hgt`; Pages serves the object that
was asked for. So the app's request for `N45E007.hgt` gets the 25.93 MB file
unless the Pages CDN happens to compress it on the fly, and the `.gz` siblings
are 17.8 MB of artifact that may never be read. Measure what arrives on the
phone before budgeting for the gzipped figure. Everything in "Reducing the 25 MB" below that needs no
content negotiation — pre-cut windows, `Cache-Control` on a real host, a service
worker — still applies.

## The self-check

```bash
npm run build
npm run package:deploy -- --gzip
npm run test:deploy
```

`npm run test:deploy` is a separate Playwright project
(`scripts/deploy-check/`), and separate on purpose: the root config starts
`npm run dev`, so every spec there runs against Vite and its terrain plugin —
the exact machinery a deployment does not have. The deploy config starts nothing
but the plain static server over `dist/`, and asserts:

* `/terrain/manifest.json` is **byte-identical to the packaged file** (a dev
  server generates it per request; a deployment cannot), and every grid it
  promises answers a HEAD request;
* the served HTML is the built one — no `/@vite/client`;
* the Gornergrat fixture photo produces a live overlay naming the Matterhorn,
  with the summit marker within 12 px of the closed-form projection derived in
  `tests/e2e/app.spec.ts`;
* a 25.93 MB tile arrives gzipped and still passes the store's length check;
* **every request the page makes is same-origin** — decision D7, enforced rather
  than asserted;
* a viewpoint with no tile produces the named absence above, not a blank
  overlay;
* the staged peak cells resolve the way `TiledPeakStore` would resolve them;
* **the served page displays the ODbL notice** — visible, unscrolled, naming
  OpenStreetMap and ODbL-1.0, and agreeing with `dist/ATTRIBUTION.txt`.

## Reducing the 25 MB

One alpine tile is 25.93 MB (16.35 MB gzipped) for a sweep that reads a 30 km
disc around one point. The options, measured:

| Option | Cost per session | Trade-off |
|---|---|---|
| Whole tile, uncompressed (today's default) | 25.93 MB | Nothing to build. |
| **Whole tile, gzip (`--gzip`)** | **16.35 MB** | None: zero app code, one server setting, already proved. |
| Pre-cut 30 km window per viewpoint | 10.85 MB raw / 7.13 MB gz | Needs a packaging step that mosaics across tile edges — a 30 km box is 0.54° × 0.78°, so it straddles a 1° boundary for ~90 % of viewpoints. A window cut too small produces **false visible** peaks (`src/pipeline/testing/case-terrain.ts`), which is the expensive kind of wrong. |
| HTTP Range per grid row | 5.6 KB × 1 941 rows = 10.85 MB | Exactly the window's bytes, but **uncompressed**: a byte range addresses the stored object, so ranges and a precompressed `.gz` are mutually exclusive. 1 941 round trips, or multipart/byteranges parsing. Worse than the pre-cut window on the wire *and* in code, where an off-by-one row is invisible. |
| SRTM3 (3 arc-second) | 2.88 MB per tile (11 %) | 90 m postings against a 90 m sweep step: ridge crests get smoothed away, and a missed crest is a false *visible*. Not acceptable for the occluder that hides the summit; only defensible for terrain far beyond the 30 km sweep, which this app does not read. |
| Service worker / Cache Storage | 16.35 MB once, then 0 | Orthogonal, and additive to any row above. Turns a re-opened photo on a train into zero bytes. |

**Recommendation, in order.**

1. **Ship `--gzip` and set `gzip_static` / `precompressed`.** 37 % off the wire
   for one line of server config, no app change, proved by `npm run test:deploy`.
2. **Set `Cache-Control: immutable`.** The second visit is free; this is the
   largest real-world win after gzip and costs nothing.
3. Then, if it still matters, **pre-cut windows at packaging time** — not Range
   requests. The manifest format was built for it (a grid is any rectangle with
   its own corner and step, which is what the case windows already are) and the
   tile reader already parses one, so it needs no new runtime code, only a
   packaging step that cuts a mosaic spanning tile boundaries and a rule for the
   radius (sweep 30 km + margin). 7.13 MB gzipped for an alpine viewpoint.
4. **Do not reach for SRTM3**, and do not mix resolutions within the sweep. The
   whole point of the 25 MB is being able to prove an occlusion.
