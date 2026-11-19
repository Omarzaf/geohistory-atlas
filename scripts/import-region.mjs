/** Deterministic, provenance-preserving regional import. Run acquisition separately. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { CONFIG } from '../js/region/model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const acquisition = read('receipts/regional-acquisition.json');
const selection = read('data/region/selection.json');
const out = 'data/region';
const write = (relative, value) => {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), JSON.stringify(value) + '\n');
};
const load = receipt => {
  if (!receipt) throw new Error('Required source has not been acquired');
  const bytes = fs.readFileSync(path.join(root, receipt.cachePath));
  if (createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw new Error(`Source changed: ${receipt.id}`);
  return JSON.parse(bytes);
};
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const rounded = value => Math.round(value * 100) / 100;
function ring(points) {
  const result = [];
  for (const point of points) {
    const next = point.slice(0, 2).map(rounded);
    if (!next.every(Number.isFinite) || Math.abs(next[0]) > 180 || Math.abs(next[1]) > 90) throw new Error('Invalid coordinate');
    if (!result.length || !same(result[result.length - 1], next)) result.push(next);
  }
  if (result.length && !same(result[0], result.at(-1))) result.push([...result[0]]);
  if (new Set(result.map(point => point.join(','))).size < 3) return null;
  let area = 0;
  for (let i = 1; i < result.length; i++) area += result[i - 1][0] * result[i][1] - result[i][0] * result[i - 1][1];
  if (Math.abs(area) < 1e-9) return null;
  return result;
}
function geometry(source) {
  const polygons = source.type === 'Polygon' ? [source.coordinates] : source.coordinates;
  const normalized = polygons.flatMap(polygon => {
    const outer = ring(polygon[0]);
    return outer ? [[outer, ...polygon.slice(1).map(ring).filter(Boolean)]] : [];
  });
  return normalized.length ? { type: 'MultiPolygon', coordinates: normalized } : null;
}
function intersects(geom) {
  const coordinates = geom.coordinates.flat(geom.type === 'Polygon' ? 1 : geom.type === 'MultiPolygon' ? 2 : geom.type === 'MultiLineString' ? 1 : 0);
  if (!coordinates.length) return false;
  const xs = coordinates.map(point => point[0]);
  const ys = coordinates.map(point => point[1]);
  return Math.max(...xs) >= 20 && Math.min(...xs) <= 104 && Math.max(...ys) >= -8 && Math.min(...ys) <= 48;
}
const palette = ['#9a634d', '#728267', '#ad8950', '#698b98', '#a06e7d', '#8e8260', '#7878a0', '#8a9958', '#b77852', '#63917f', '#9d7863', '#729ca1'];
const canonical = {
  'Eastern Roman Empire': 'Byzantine Empire', 'Satavahanihara': 'Satavahana', 'Gurjara Pratihara': 'Gurjara-Pratihara',
  'Palas': 'Pala kingdoms', 'Cholas': 'Chola', 'Mamluke Sultanate': 'Mamluk Sultanate',
  'Emirate of the White Sheep Turks': 'Aq Qoyunlu', 'Sultanate of Delhi': 'Delhi Sultanate',
  'Persia': 'Iran (Persia)', 'Sikhs': 'Sikh territories', 'British Raj': 'British India',
};
const colors = new Map();
function tint(name) {
  if (!colors.has(name)) colors.set(name, palette[colors.size % palette.length]);
  return colors.get(name);
}
function relationship(year, name, authority) {
  if (name === 'Sasanian dependencies') return 'dependency';
  if (year === 1914 && name === 'British Raj') return 'colonial composite';
  if (year === 1914 && name === 'Egypt') return 'occupation / protectorate transition';
  if (year === 1914 && name === 'Ceylon') return 'colony';
  if (year === 1800 && ["Nizam's Dominions", 'Mysore'].includes(name)) return 'subsidiary alliance';
  if (authority && authority !== name) return 'authority differs from region name';
  return 'schematic polity';
}
const manifest = {
  title: 'Geohistory', config: CONFIG, snapshots: [],
  reviewScope: selection.reviewScope,
  coverageNote: 'Selected territorial snapshots, 500 BCE–1914 CE. Navigation and narratives span 600 BCE–1947. Blank land is unreviewed coverage, not ungoverned territory. No annual interpolation.',
  baseNote: 'Modern physical reference from Natural Earth. Ancient river courses and coastlines may differ.',
  sources: selection.sources,
  excludedSnapshots: selection.excludedSnapshots,
};
const audit = [];
for (const entry of selection.snapshots) {
  const receipt = acquisition.files.find(file => file.year === entry.year);
  const source = load(receipt);
  const matched = new Set();
  const grouped = new Map();
  const rejected = [];
  source.features.forEach((feature, index) => {
    const name = feature.properties?.NAME;
    if (!feature.geometry || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type) || !intersects(feature.geometry)) return;
    if (!entry.include.includes(name)) { rejected.push({ index, name: name || null, reason: 'Outside the curated selection; no unchecked source identities imported' }); return; }
    const normalized = geometry(feature.geometry);
    if (!normalized) { rejected.push({ index, name, reason: 'Geometry collapsed at upstream 0.01 degree precision; omitted rather than inventing area' }); return; }
    matched.add(name);
    const title = canonical[name] || name;
    const authority = entry.year === 1914 && name === 'Ceylon' ? 'United Kingdom' : feature.properties.SUBJECTO || null;
    const key = `${title}/${authority}`;
    const original = { featureIndex: index, properties: feature.properties };
    if (grouped.has(key)) {
      const existing = grouped.get(key);
      existing.geometry.coordinates.push(...normalized.coordinates);
      existing.properties.sourceFeatures.push(original);
      return;
    }
    const id = `${entry.year < 0 ? 'b' : 'c'}${Math.abs(entry.year)}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    grouped.set(key, { type: 'Feature', id, properties: {
      id, title, sourceName: name, authority, partOf: feature.properties.PARTOF || null,
      relationship: relationship(entry.year, name, authority), borderPrecision: feature.properties.BORDERPRECISION ?? null,
      tint: tint(title), sourceUrl: receipt.url, sourceRevision: receipt.revision, sourceSha256: receipt.sha256,
      snapshotYear: entry.year, supportedDate: { from: entry.year, to: entry.year },
      license: receipt.license, acquiredAt: receipt.acquiredAt, sourceFeatures: [original],
      reviewStatus: 'Chronology screened; schematic geometry', sourceIds: entry.references,
      geometryNote: 'Source coordinates rounded to 0.01° using the upstream encoder precision; tiny collapsed rings omitted. No new borders inferred. Composite areas do not imply uniform direct rule.',
      ...(entry.year === 1914 && name === 'Ceylon' ? { interpretationNote: 'Colonial authority corrected to United Kingdom; original source fields retained below.' } : {}),
    }, geometry: normalized });
  });
  for (const name of entry.include) if (!matched.has(name)) throw new Error(`Missing expected feature ${entry.year}/${name}`);
  const id = `s_${entry.year < 0 ? 'b' : 'c'}${Math.abs(entry.year)}`;
  const features = [...grouped.values()];
  const metadata = { id, year: entry.year, title: entry.title, description: entry.description,
    note: entry.notes || 'Partial regional coverage. All boundaries are approximate.',
    sourceUrl: receipt.url, sourceRevision: receipt.revision, sourceSha256: receipt.sha256,
    sourceIds: entry.references, reviewStatus: 'Chronology screened; schematic geometry',
    geometryFile: `snapshots/${id}.geojson`, polityCount: features.length };
  write(`${out}/${metadata.geometryFile}`, { type: 'FeatureCollection', license: 'GPL-3.0', attribution: 'Historical Basemaps by André Ourednik and contributors; Geohistory regional selection. Approximate boundaries, not surveyed borders.', snapshot: metadata, features });
  manifest.snapshots.push(metadata);
  audit.push({ year: entry.year, accepted: features.map(feature => ({ id: feature.id, name: feature.properties.title, sourceFeatureIndices: feature.properties.sourceFeatures.map(item => item.featureIndex) })), excluded: rejected });
}
const baseFeatures = [];
for (const kind of ['land', 'rivers', 'lakes']) {
  const receipt = acquisition.files.find(file => file.id === kind);
  for (const [index, feature] of load(receipt).features.entries()) {
    if (!feature.geometry || !intersects(feature.geometry)) continue;
    let geom = feature.geometry;
    if (['Polygon', 'MultiPolygon'].includes(geom.type)) geom = geometry(geom);
    if (!geom) continue;
    baseFeatures.push({ type: 'Feature', id: `ne-${kind}-${index}`, properties: {
      kind: { land: 'land', rivers: 'river', lakes: 'lake' }[kind],
      name: feature.properties.name || feature.properties.name_en || null,
      sourceUrl: receipt.url, sourceRevision: receipt.revision, sourceSha256: receipt.sha256,
      sourceFeatureIndex: index, license: 'Public domain', reference: 'Modern physical geography',
    }, geometry: geom });
  }
}
write(`${out}/base.geojson`, { type: 'FeatureCollection', features: baseFeatures });
write(`${out}/manifest.json`, manifest);
write('receipts/regional-import-review.json', { reviewScope: selection.reviewScope, excludedSnapshots: selection.excludedSnapshots, snapshots: audit, baseFeatures: baseFeatures.length });
console.log(`Imported ${manifest.snapshots.length} curated snapshots, ${audit.reduce((count, item) => count + item.accepted.length, 0)} polity records, ${baseFeatures.length} physical reference features.`);
