# Geohistory attribution and data notes

Geohistory is a regional adaptation of [Jiangshan Atlas](https://github.com/DeanChensj/jiangshan-map), by DeanChensj and contributors, pinned to commit `b42b256275c3718ab85c8f02e1d810ec3c228485`. The original Mercator projection, polygon hit testing and VLQ geometry encoder are reused under GPL-3.0. See [LICENSE](LICENSE).

Territory geometry is a curated, rounded subset of [Historical Basemaps](https://github.com/aourednik/historical-basemaps), by André Ourednik and contributors, revision `4b5039e50d8d2464b065bd76ad6086cd4597108d`, under GPL-3.0. Each feature retains its source file, source feature indices, original properties, revision and checksum. The raw download receipts and selection audit are retained in the source repository.

Natural Earth physical geography is [public domain](https://www.naturalearthdata.com/about/terms-of-use/). Land, rivers and lakes are modern reference geography, sourced from `nvkelso/natural-earth-vector` revision `ca96624a56bd078437bca8184e78163e5039ad19`. Individual narrative place records state their coordinate source and precision separately.

The regional shaded relief is separately derived from [Natural Earth 1:50m Shaded Relief](https://www.naturalearthdata.com/downloads/50m-raster-data/50m-shaded-relief/), with grayscale shading based on SRTM Plus elevation data. The official page advertises 3.2.0 while the downloaded archive identifies 2.0.0; `data/region/relief-source.json` preserves both labels and exact source/output hashes. The image is reprojected with the atlas's Mercator engine and clipped to modern land. It does not reconstruct historical terrain. Made with Natural Earth.

This source release excludes Jiangshan's CHGIS/Hartwell prefecture geometry, DataV provincial geometry, guqin recordings, original terrain imagery and analytics. It contains the regional application, selected source-derived data, the reused geometry encoder, and the build and provenance tooling needed for this adaptation. Only the explicit generated `dist/` manifest is the website's public surface; source-only selection records, acquisition receipts and maintenance scripts are not served as web pages. The excluded upstream datasets are not licensed for redistribution by this release.

Historical descriptions are concise newly written summaries with links to their supporting institutional, scholarly and primary sources. Citations do not license reproduction of the linked texts or images. No third-party historical map images have been copied.

## Reading this atlas

- It covers selected territories, places and events, not every state or community in either region.
- Navigation spans 600 BCE–1947. The ten selected territorial source dates run from 500 BCE to 1914 CE. The map's reference date is shown separately from the reader's chosen year.
- Boundaries are schematic reconstructions, not surveyed borders or precise statements of sovereignty. Source precision codes are preserved without treating them as independently established confidence scores.
- Unfilled land means a coverage gap. It does not mean uninhabited, ungoverned, independent or unclaimed territory.
- The 1200 and 1945 candidate maps were rejected after chronology screening. No annual interpolation, inferred partition boundary or automatic source relabeling fills those gaps.
- Chronology screening by an agent is separate from human scholarly review. Polygon accuracy remains limited by the source dataset.
- Modern reference coordinates can differ from ancient settlement footprints. Unknown locations stay unpinned. Journey lines connect selected documented stops and do not reconstruct the exact path traveled.
