/** Build only the regional public surface, using Jiangshan's native VLQ encoder. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { encodeBundle } = require('./build_atlas.js');
const root = path.resolve(__dirname, '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const manifest = read('data/region/manifest.json');
const doc = { features: [], snapshots: {} };
for (const entry of manifest.snapshots) {
  const source = read(`data/region/${entry.geometryFile}`);
  const indices = source.features.map(feature => {
    const index = doc.features.length;
    doc.features.push({ ...feature.properties, shape: feature.geometry });
    return index;
  });
  doc.snapshots[entry.id] = { ...entry, polities: indices, prefectures: [], regions: [] };
}
const bundle = '/** Geohistory regional geometry. GPL-3.0. Historical Basemaps source revisions are embedded per feature. No CHGIS/DataV layers. */\n' + encodeBundle(doc);
const context = { window: {} };
vm.runInNewContext(bundle, context);
if (Object.keys(context.window.ATLAS_SNAPSHOTS).length !== manifest.snapshots.length) throw new Error('Bundle round-trip failed');
const bundlePath = path.join(root, 'js/region/snapshots.js');
if (process.argv.includes('--check')) {
  if (!fs.existsSync(bundlePath) || fs.readFileSync(bundlePath, 'utf8') !== bundle) throw new Error('Regional bundle is stale; run node scripts/build-region.cjs');
  console.log('Regional polygon bundle is reproducible and current.');
  process.exit(0);
}
fs.writeFileSync(bundlePath, bundle);
if (process.argv.includes('--geometry-only')) { console.log('Regional geometry bundle generated.'); process.exit(0); }
const files = [
  'index.html', 'css/region.css', 'js/region/app.mjs', 'js/region/embed.mjs', 'js/region/learning.mjs', 'js/region/mapDetails.mjs', 'js/region/timeline.mjs', 'js/region/model.mjs', 'js/region/geometry.mjs', 'js/region/snapshots.js',
  'data/region/manifest.json', 'data/region/base.geojson', 'data/region/chronicle.json', 'data/region/learning.json',
  'assets/region/favicon.svg', 'assets/region/relief.webp', 'data/region/relief-source.json', 'LICENSE', 'ATTRIBUTION.md',
];
for (const entry of manifest.snapshots) files.push(`data/region/${entry.geometryFile}`);
for (const relative of files) if (!fs.existsSync(path.join(root, relative))) throw new Error(`Build input missing: ${relative}`);
const dist = path.join(root, 'dist');
fs.mkdirSync(dist, { recursive: true });
const publicManifest = [];
for (const relative of files) {
  const bytes = fs.readFileSync(path.join(root, relative));
  const target = path.join(dist, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  publicManifest.push({ path: relative, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
}
const release = { title: 'Geohistory', upstreamCommit: 'b42b256275c3718ab85c8f02e1d810ec3c228485', snapshots: manifest.snapshots.map(({ id, year }) => ({ id, year })), files: publicManifest };
fs.writeFileSync(path.join(dist, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`Built ${publicManifest.length + 1} public files (${(publicManifest.reduce((size, file) => size + file.bytes, 0) / 1e6).toFixed(2)} MB) to dist/. Upstream source, restricted data and private receipts excluded.`);
