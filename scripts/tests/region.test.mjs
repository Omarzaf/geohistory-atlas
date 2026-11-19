import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { CONFIG, formatYear, formatRecordDate, canShowTerritories, normalizeYear, selectSnapshot, historicalName, stepYear } from '../../js/region/model.mjs';
import { MercatorProjector } from '../../js/region/geometry.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const manifest = read('data/region/manifest.json');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'js/region/snapshots.js'), 'utf8'), context);
const snapshots = context.window.ATLAS_SNAPSHOTS;

test('learning paths, recall explanations, and schematic connections resolve real records', () => {
  const learning = read('data/region/learning.json');
  const chronicle = read('data/region/chronicle.json');
  const places = new Set(chronicle.places.map(place => place.id));
  const events = new Set(chronicle.events.map(event => event.id));
  const sources = new Set([...chronicle.sources, ...learning.sources].map(source => source.id));
  const checkSources = item => { assert(item.sourceIds.length >= 1); for (const id of item.sourceIds) assert(sources.has(id), id); };
  for (const story of learning.stories) {
    assert(story.stops.length >= 2); checkSources(story);
    for (const stop of story.stops) {
      assert(places.has(stop.placeId)); if (stop.eventId) assert(events.has(stop.eventId));
      assert(Number.isInteger(stop.year) && stop.year !== 0 && stop.year >= CONFIG.minYear && stop.year <= CONFIG.maxYear);
      assert(stop.question && stop.description && stop.datePrecision); checkSources(stop);
    }
  }
  for (const question of learning.quiz) {
    assert(question.options.length >= 3);
    assert(Number.isInteger(question.answerIndex) && question.answerIndex >= 0 && question.answerIndex < question.options.length);
    assert(question.explanation); checkSources(question);
  }
  for (const connection of learning.connections) {
    assert(connection.placeIds.every(id => places.has(id))); checkSources(connection);
    assert(connection.fromYear <= connection.toYear);
    assert(/schematic|editorial/i.test(connection.geometryNote));
  }
  const ids = [...learning.stories, ...learning.connections, ...learning.quiz].map(item => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('acquisition rejects a changed cached source without replacing its receipt', () => {
  const fixture = fs.mkdtempSync(path.join(tmpdir(), 'geohistory-provenance-'));
  const source = read('receipts/regional-acquisition.json').files[0];
  fs.mkdirSync(path.join(fixture, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(fixture, 'receipts'), { recursive: true });
  fs.mkdirSync(path.dirname(path.join(fixture, source.cachePath)), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/acquire-region.mjs'), path.join(fixture, 'scripts/acquire-region.mjs'));
  fs.writeFileSync(path.join(fixture, source.cachePath), JSON.stringify({ type: 'FeatureCollection', features: [] }));
  const prior = JSON.stringify({ files: [source] }, null, 2) + '\n';
  fs.writeFileSync(path.join(fixture, 'receipts/regional-acquisition.json'), prior);
  const result = spawnSync(process.execPath, ['scripts/acquire-region.mjs'], { cwd: fixture, encoding: 'utf8', timeout: 5000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Source hash mismatch/);
  assert.equal(fs.readFileSync(path.join(fixture, 'receipts/regional-acquisition.json'), 'utf8'), prior);
});

test('civil chronology crosses BCE/CE without a year zero and normalizes malformed links', () => {
  assert.equal(stepYear(-1, 1), 1);
  assert.equal(stepYear(1, -1), -1);
  assert.equal(formatYear(-500), '500 BCE');
  assert.equal(formatYear(1600), '1600 CE');
  assert.equal(formatYear(0), 'Date unknown');
  assert.equal(normalizeYear('hello'), 1600);
  assert.equal(normalizeYear(-1200), -600);
  assert.equal(normalizeYear(2026), 1947);
});

test('unsampled dates never select future geometry; endpoint gaps stay explicit', () => {
  assert.equal(selectSnapshot(manifest.snapshots, -600), null);
  assert.equal(selectSnapshot(manifest.snapshots, -501), null);
  assert.equal(selectSnapshot(manifest.snapshots, -500).year, -500);
  assert.equal(selectSnapshot(manifest.snapshots, 1333).year, 1100);
  assert.equal(selectSnapshot(manifest.snapshots, 1600).year, 1600);
  assert.equal(selectSnapshot(manifest.snapshots, 1947).year, 1914);
  assert(!manifest.snapshots.some(snapshot => [1200, 1945, 1947].includes(snapshot.year)));
});

test('episodes and unknown intervals never silently establish historical name validity', () => {
  const place = { name: 'Modern reference', history: [{ name: 'Unknown ancient name', from: null, to: null }, { name: 'Episode name', from: 10, to: 300 }, { name: 'Dated name', nameValidFrom: 100, nameValidTo: 200 }] };
  assert.equal(historicalName(place, 150), 'Dated name');
  assert.equal(historicalName(place, -100), 'Modern reference');
  assert.equal(historicalName(place, 50), 'Modern reference');
  assert.equal(historicalName(place, 201), 'Modern reference');
  const cairo = { name: 'Cairo', history: [{ name: 'Al-Qahira', from: 969, to: 969 }] };
  assert.equal(historicalName(cairo, 969), 'Cairo');
});

test('reused map projection round-trips points and respects polygon holes', () => {
  const projector = new MercatorProjector(1200, 760, CONFIG.bounds);
  for (const coord of [[31.2, 30], [77.2, 28.6], [73.5, 4.2], [90.4, 27.5]]) {
    const back = projector.toGeo(...projector.toScreen(...coord));
    assert(Math.abs(back[0] - coord[0]) < 1e-9);
    assert(Math.abs(back[1] - coord[1]) < 1e-9);
  }
  const shape = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] };
  assert.equal(MercatorProjector.pointInShape(2, 2, shape), true);
  assert.equal(MercatorProjector.pointInShape(5, 5, shape), false);
  assert.equal(MercatorProjector.pointInShape(15, 5, shape), false);
});

test('regional snapshots have complete provenance and lossless encoder round-trips', () => {
  assert(manifest.snapshots.length >= 8 && manifest.snapshots.length <= 12);
  const sourceIds = new Set(manifest.sources.map(source => source.id));
  const years = manifest.snapshots.map(snapshot => snapshot.year);
  assert.deepEqual(years, [...years].sort((a, b) => a - b));
  const allIds = new Set();
  for (const entry of manifest.snapshots) {
    const source = read(`data/region/${entry.geometryFile}`);
    const decoded = snapshots[entry.id];
    assert(decoded.polities.length >= 3, `${entry.id}: concurrent polities absent`);
    assert.equal(source.features.length, decoded.polities.length);
    source.features.forEach((feature, index) => {
      const p = feature.properties;
      assert(!allIds.has(p.id)); allIds.add(p.id);
      assert.match(p.sourceRevision, /^[a-f0-9]{40}$/);
      assert.match(p.sourceSha256, /^[a-f0-9]{64}$/);
      assert.equal(p.license, 'GPL-3.0');
      assert(p.sourceFeatures.length > 0);
      assert(p.sourceFeatures.every(item => Number.isInteger(item.featureIndex) && item.properties.NAME));
      assert(p.sourceIds.length >= 2 && p.sourceIds.every(id => sourceIds.has(id)));
      assert.deepEqual(p.supportedDate, { from: entry.year, to: entry.year });
      assert.deepEqual(JSON.parse(JSON.stringify(decoded.polities[index].shape)), feature.geometry);
      for (const polygon of feature.geometry.coordinates) for (const ring of polygon) {
        assert(ring.length >= 4);
        assert.deepEqual(ring[0], ring.at(-1));
        let area = 0;
        ring.forEach((point, i) => {
          assert(point.length === 2 && point.every(Number.isFinite));
          assert(Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90);
          if (i) {
            assert.notDeepEqual(point, ring[i - 1]);
            area += ring[i - 1][0] * point[1] - point[0] * ring[i - 1][1];
          }
        });
        assert(Math.abs(area) > 1e-9, `${p.id}: degenerate ring`);
      }
    });
  }
});

test('1600 view connects representative places to concurrent Ottoman, Safavid and Mughal geometry', () => {
  const polities = snapshots.s_c1600.polities;
  for (const [title, lon, lat] of [['Ottoman Empire', 31.24, 30.04], ['Safavid Empire', 51.67, 32.65], ['Mughal Empire', 77.21, 28.61]]) {
    const polity = polities.find(item => item.title === title);
    assert(polity, title);
    assert(MercatorProjector.pointInShape(lon, lat, polity.shape), title);
  }
});

test('dependent, occupied and composite territories retain explicit relationships', () => {
  assert.equal(snapshots.s_c600.polities.find(p => p.title === 'Sasanian dependencies').relationship, 'dependency');
  assert.equal(snapshots.s_c1914.polities.find(p => p.title === 'British India').relationship, 'colonial composite');
  assert.equal(snapshots.s_c1914.polities.find(p => p.title === 'Ceylon').authority, 'United Kingdom');
  assert.match(snapshots.s_c1914.polities.find(p => p.title === 'Egypt').relationship, /occupation/);
  assert.equal(snapshots.s_c1800.polities.find(p => p.title === 'Mysore').relationship, 'subsidiary alliance');
});

test('narrative records resolve sources, places and dated journey stops without invented locations', () => {
  const data = read('data/region/chronicle.json');
  const sourceIds = new Set(data.sources.map(source => source.id));
  assert.equal(sourceIds.size, data.sources.length);
  for (const source of data.sources) { assert.match(source.url, /^https:\/\//); assert(source.title); }
  const checkSources = record => { assert(record.sourceIds?.length, record.id || record.title); assert(record.sourceIds.every(id => sourceIds.has(id)), record.id || record.title); };
  assert(data.places.length >= 30);
  assert(data.events.length >= 20);
  assert(data.journeys.length >= 1);
  const places = new Map(data.places.map(place => [place.id, place]));
  assert.equal(places.size, data.places.length);
  for (const place of data.places) {
    checkSources(place);
    assert(place.precision);
    assert(place.coord === null || (place.coord.length === 2 && place.coord.every(Number.isFinite) && Math.abs(place.coord[0]) <= 180 && Math.abs(place.coord[1]) <= 90));
    for (const name of place.history || []) {
      assert(name.from === null || (Number.isInteger(name.from) && name.from !== 0));
      assert(name.to === null || (Number.isInteger(name.to) && name.to !== 0));
      if (name.from !== null && name.to !== null) assert(name.to >= name.from);
      checkSources(name);
    }
  }
  for (const event of data.events) {
    checkSources(event);
    assert(Number.isInteger(event.year) && event.year !== 0 && event.year >= -600 && event.year <= 1947);
    assert(places.has(event.placeId));
  }
  for (const journey of data.journeys) {
    checkSources(journey);
    assert(journey.stops.length >= 8);
    let previous = -Infinity;
    for (const stop of journey.stops) {
      checkSources(stop);
      assert(places.has(stop.placeId));
      assert(Number.isInteger(stop.year) && stop.year >= previous && stop.year !== 0);
      assert(stop.year >= journey.fromYear && stop.year <= journey.toYear);
      previous = stop.year;
    }
  }
});

test('public build contains current approved assets and excludes upstream restricted layers', () => {
  const release = read('dist/release.json');
  const expected = new Set(['release.json', ...release.files.map(file => file.path)]);
  function walk(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.relative(path.join(root, 'dist'), path.join(dir, entry.name))]); }
  assert.deepEqual(new Set(walk(path.join(root, 'dist'))), expected);
  for (const file of release.files) {
    assert(!/^(data\/atlas|data\/sources|workers|topics|scripts|receipts|\.git|\.cache)\//.test(file.path), file.path);
    const bytes = fs.readFileSync(path.join(root, 'dist', file.path));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
    assert.equal(createHash('sha256').update(fs.readFileSync(path.join(root, file.path))).digest('hex'), file.sha256, `Stale build: ${file.path}`);
  }
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  assert(!/atlas_track|stats\.deanchen|china_geo_data|zh_hant|deanchen\.me\/jiangshan/.test(html));
  assert.match(html, /Geohistory/);
});

test('territory visibility requires an exact date or a deliberate reference choice', () => {
  const snapshot = {year:600};
  assert.equal(canShowTerritories(snapshot,762),false);
  assert.equal(canShowTerritories(snapshot,600),true);
  assert.equal(canShowTerritories(snapshot,762,762),true);
  assert.equal(canShowTerritories(snapshot,763,762),false);
  assert.equal(canShowTerritories(null,762,762),false);
});
test('date labels preserve ranges and centuries instead of promoting anchors to dates', () => {
  assert.equal(formatRecordDate({year:749,earliestYear:749,latestYear:750}), '749 CE–750 CE');
  assert.equal(formatRecordDate({year:450,datePrecision:'fifth century CE; 450 is an editorial navigation anchor'}), 'fifth century CE');
  assert.equal(formatRecordDate({year:1919,displayDate:'March 1919 CE'}), 'March 1919 CE');
  assert.equal(formatRecordDate({year:1334,datePrecision:'circa 1334; exact arrival chronology unresolved'}), 'c. 1334 CE');
});

test('accuracy expansion has claim-level evidence, bounded dates and broader late coverage', () => {
  const chronicle = read('data/region/chronicle.json');
  const sources = new Map(chronicle.sources.map(source => [source.id,source]));
  const places = new Map(chronicle.places.map(place => [place.id,place]));
  assert.equal(sources.size,chronicle.sources.length);
  const newIds = new Set(chronicle.meta.accuracyUpgrade.eventIds);
  const events = chronicle.events.filter(event => newIds.has(event.id));
  assert.equal(events.length,16);
  assert(new Set(events.filter(event => event.year > 1700).map(event => event.placeId)).size >= 6);
  for (const event of events) {
    assert(places.has(event.placeId)); assert(event.earliestYear <= event.year && event.year <= event.latestYear);
    assert(event.displayDate && event.sourceIndependenceNote && event.locationNote);
    assert(event.claims.length >= 2);
    for (const claim of event.claims) {
      assert(claim.text && claim.sourceIds.length);
      for (const id of claim.sourceIds) {
        const source = sources.get(id); assert(source,id);
        assert(source.locator && source.evidenceFamily && source.relationshipNote,id);
        assert(event.sourceIds.includes(id),id);
      }
    }
  }
  assert(chronicle.places.every(place => place.recordType));
  assert.match(events.find(event => event.id === 'abbasid-transition').locationNote,/Kufa/);
});
