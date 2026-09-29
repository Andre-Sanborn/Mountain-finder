# Recorded API responses

Every offline test replays from this directory through `FixtureTransport`
(AGENTS.md, "Tests are offline"). One file = one request/response exchange:

```jsonc
{
  "note": "provenance — where this came from",
  "request":  { "url": "…", "method": "GET" | "POST", "body": "…" | { "field": "…" } },
  "response": { "status": 200, "json": { … } }        // or "body": "<raw text>"
}
```

Files are addressed by the **canonical key** derived from `request`
(`src/providers/transport.ts` → `fixtureKey`): `METHOD <canonical url>` plus
`| <canonical body>`. Query parameters are sorted, form fields are sorted, and
whitespace inside form values is collapsed, so a recording keeps matching even
if the provider reorders parameters or reflows a query. The file *name* is
cosmetic (`<slug>-<hash of the key>.json`); only the contents are addressed.

## Refreshing

```
npm run record:fixtures -- --site zermatt --lat 45.9833 --lon 7.7847 --radius-km 15
npm run record:fixtures -- --verify        # offline: replay everything here through the parsers
```

`scripts/record-fixtures.ts` is the only code in the repo permitted to make live
network calls.

## Provenance — READ THIS

**All fixtures currently in this directory are HAND-AUTHORED, not live
recordings.** The build environment's egress proxy denies both upstream hosts
(`api.opentopodata.org:443` and `overpass-api.de:443` both answer
`403` to CONNECT — an organization egress-policy denial, not a transient
failure), so `record-fixtures.ts` could not reach them.

They were written against the documented response schemas:

- OpenTopoData — <https://www.opentopodata.org/api/> — `{status, results:[{dataset,
  elevation, location:{lat,lng}}]}`, `elevation: null` over ocean/void, hard cap
  of 100 locations per request.
- Overpass — <https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_API_by_Example>
  — `{version, generator, elements:[{type,id,lat,lon,center,tags}]}`, where
  `out center` supplies `center` for ways.

Coordinates and heights are real-world values for the named summits, but the
OSM element IDs and the exact SRTM samples are plausible inventions. Each file
repeats this in its own `note` field. **Re-record them against the live APIs as
soon as an environment with egress to those hosts is available**; the parsers,
not the numbers, are what these tests are proving.
