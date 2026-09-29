# Mountain Finder

Point it at a photo of mountains — it works out which peaks you are looking at and plants
labelled flags on their summits. It runs offline: terrain comes from local SRTM `.hgt` tiles,
summits from a local peak database, and nothing talks to an API at runtime.

The web app is the base product. A computer-vision pass aligns the computed skyline to the
photograph, and an Expo shell in [`mobile/`](mobile/README.md) carries the same pure code onto
a phone.

## Running the gates

Nothing here is done until its check has been run and watched to pass. These are the checks.

| Command | What it proves |
|---|---|
| `npm run check` | typecheck + lint + the full unit suite, offline and deterministic |
| `npm run test:e2e` | Playwright against real Chromium |
| `npm run test:acceptance` | ground-truth cases; a pass means the *yardstick* is sound |
| `npm run build` | typecheck + production bundle |
| `npm run package:deploy` | assembles `dist/terrain/` + `dist/peaks/` into a deployable static directory |
| `npm run test:deploy` | the packaged `dist/` behind a plain static server, no Vite |
| `npm run check:mobile` | typecheck + lint + a real Metro/Hermes build of the Expo shell |
| `npm run demo -- <case>` | runs a real case end to end and writes `out/annotated.png` |
| `npm run annotate` | annotates a real photograph, with `--auto-trim` for the CV suggestion |
| `npm run fetch:tiles` | acquisition only: pulls SRTM tiles from AWS Open Data |

## Where to read further

| Document | Purpose |
|---|---|
| [MISSION.md](MISSION.md) | What we are building, the prime directive, the decision record (D1–D10), what real SRTM data taught us |
| [AGENTS.md](AGENTS.md) | How an agent session works here: the orchestrator's remit, the review steps, the engineering rules |
| [TODO.md](TODO.md) | The open checklist, one line per item |
| [IMPLEMENTATION.md](IMPLEMENTATION.md) | Decisions and why, the design, every product's self-check, measurements, rejected alternatives, known limits |
| [HANDOFF.md](HANDOFF.md) | Operational state: branch, gate status and its date, where the data lives, what is blocked |
| [docs/FINDINGS.md](docs/FINDINGS.md) | Index of every confirmed finding, with stable ids, severity and fix status |
| [docs/REVIEW-LOG.md](docs/REVIEW-LOG.md) | The append-only log of nightly strategy reviews |
| [docs/](docs/) | Deployment, near-field terrain, real-photo pose, the CV findings, the Idaho photo cases |
| [mobile/README.md](mobile/README.md) | Running the Expo shell on a phone with Expo Go — no Mac, no Xcode, no Apple Developer account |
| [archive/](archive/) | History, intact and read-only: the v2 governance documents and the retired v1 Expo attempt |
