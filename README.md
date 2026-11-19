# Geohistory — Middle East and South Asia

A source-linked historical atlas in one continuous scrolling page: maps, selected historical records, journeys, stories, and sources. It adapts the map projection and geometry encoder of [Jiangshan Atlas](https://github.com/DeanChensj/jiangshan-map/tree/b42b256275c3718ab85c8f02e1d810ec3c228485), with attribution preserved in [ATTRIBUTION.md](ATTRIBUTION.md).

## Run locally

Requires Node.js 22 or later. There are no package dependencies or installation steps.

```sh
node scripts/build-region.cjs
node scripts/verify-region.mjs
node scripts/serve-region.mjs
```

Open <http://127.0.0.1:8767/>. Set `ATLAS_PORT` to use another port. The local server serves only files listed in the generated `dist/release.json`; it does not expose source, receipts, or directories.

## Explore the atlas

- Ten dated maps: 500 BCE, 200 BCE, 200, 600, 900, 1100, 1500, 1600, 1800, and 1914 CE.
- Selected territories, reference places, events, and twelve documented stops from Ibn Battuta's travels.
- Five guided stories, ten recall questions, and four explicitly schematic connections.
- Search and aliases, dated playback, timeline zoom, source links, and restorable selections.

Header links scroll to sections in the same document. Selected records open inline. Scroll normally over the map to move through the page; use the zoom controls, keyboard +/−, or Ctrl + scroll to zoom the map. On touch screens, one finger scrolls the page and two fingers move the map. The Sources section includes an expandable bibliography.

Navigation spans 600 BCE–1947, a wider range than the accepted territorial maps. Unsampled years keep older boundaries hidden unless the reader explicitly requests a dated reference. There is no interpolated annual map or accepted 1947 boundary reconstruction. Unknown locations remain unpinned. Journey lines connect selected stops and do not reconstruct roads, sea lanes, or a complete itinerary. Source screening is separate from independent human scholarly review, which remains pending.

## Verification

The build and static/data checks run offline using the included data. GitHub Actions runs the same two commands on pushes and pull requests.

Browser checks require an already-installed Playwright package and Google Chrome:

```sh
node scripts/run-confluence-qa.mjs
```

Set `PLAYWRIGHT_MODULE` to that installation's `index.mjs` if the package is not otherwise resolvable. `ATLAS_ORIGIN` selects the running local server. Set `ATLAS_HEADLESS=0` to use an isolated visible Chrome window. The runner does not install packages or reuse personal browser profiles. Receipts and captures are written to `.impeccable/review/continuous-page/` and are not part of the source release or deployed website. Browser checks are separate from the offline CI checks; local Chrome emulation does not certify Safari or physical devices.

## Source provenance and maintenance

- [Territorial selection](data/region/selection.json) records the accepted source maps and rejected candidates.
- [Acquisition receipt](receipts/regional-acquisition.json) preserves pinned revisions and raw-source hashes.
- [Import review](receipts/regional-import-review.json) records selected features and screening decisions.
- [Territory manifest](data/region/manifest.json) and individual geometry records preserve source relationships.
- [Relief provenance](data/region/relief-source.json) records the Natural Earth source and generated image hashes.

Optional maintenance commands are `scripts/acquire-region.mjs`, `scripts/import-region.mjs`, and `scripts/build-region-relief.mjs`. Acquisition makes outbound requests to pinned public sources; it is not required for ordinary builds. Import requires the corresponding cache. Relief regeneration requires its source archive and the external image tools documented in that script. Review the evidence and generated changes before accepting new source data.

`scripts/build_atlas.js` is retained as the upstream geometry encoder used by `build-region.cjs`; use the regional build command above. The upstream China-specific datasets and original application are not included in this source release.

## Deployment and embedding

`vercel.json` builds and verifies the site, then publishes only `dist/`. There is no application server, database, package installation, or catch-all rewrite. Build scripts, source-only selection records, and acquisition receipts are excluded from the deployed surface.

The Content Security Policy permits embedding by the atlas's own origin and by `https://umarzafar.vercel.app` and `https://hateforsale.vercel.app`. Other embedding origins require an explicit configuration change. Inline styles remain allowed because the atlas creates SVG and layout styles at runtime; scripts are restricted to the site's own origin.

The Website integration uses `?embed=1` with an origin-checked parent handshake for document sizing and section navigation. The bridge validates the parent window, origin, message version, and numeric viewport values before enabling this behavior. The query parameter alone does not authorize another embedding origin.

## Attribution and terms

Code and reused territorial geometry retain GPL-3.0 notices; see [LICENSE](LICENSE) and [ATTRIBUTION.md](ATTRIBUTION.md). Natural Earth physical reference geography and shaded relief are public domain. Linked historical sources retain their own terms: a citation does not grant permission to reproduce their text or images. The release excludes the upstream CHGIS/Hartwell prefecture data, DataV provincial data, recordings, tracking code, and unrelated upstream assets.
