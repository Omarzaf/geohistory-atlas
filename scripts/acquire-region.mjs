/** Download immutable public source files. No dependencies or target-code execution. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hb = '4b5039e50d8d2464b065bd76ad6086cd4597108d';
const ne = 'ca96624a56bd078437bca8184e78163e5039ad19';
const years = [-500, -200, 200, 600, 900, 1100, 1200, 1500, 1600, 1800, 1914, 1945];
const files = years.map(year => ({
  id: `world_${year}`, filename: `world_${year < 0 ? `bc${-year}` : year}.geojson`,
  folder: 'historical-basemaps', revision: hb, license: 'GPL-3.0', year,
})).concat([
  { id: 'land', filename: 'ne_50m_land.geojson' },
  { id: 'rivers', filename: 'ne_50m_rivers_lake_centerlines.geojson' },
  { id: 'lakes', filename: 'ne_50m_lakes.geojson' },
].map(file => ({ ...file, folder: 'natural-earth', revision: ne, license: 'Public domain' })));
const receipts = [];
const receiptPath = path.join(root, 'receipts/regional-acquisition.json');
let priorFiles = [];
try { priorFiles = JSON.parse(await readFile(receiptPath, 'utf8')).files; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const priorByUrl = new Map(priorFiles.map(file => [file.url, file]));
for (const file of files) {
  const directory = path.join(root, '.cache', file.folder, file.revision);
  await mkdir(directory, { recursive: true });
  const destination = path.join(directory, file.filename);
  const repository = file.folder === 'historical-basemaps' ? 'aourednik/historical-basemaps' : 'nvkelso/natural-earth-vector';
  const url = `https://raw.githubusercontent.com/${repository}/${file.revision}/geojson/${file.filename}`;
  const prior = priorByUrl.get(url);
  let bytes;
  let cached = false;
  try { bytes = await readFile(destination); cached = true; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    // Parse before preserving a response: never cache an error page as a dataset.
    const data = JSON.parse(bytes);
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`Not GeoJSON: ${url}`);
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  const data = JSON.parse(bytes);
  if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`Not GeoJSON: ${url}`);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (cached && !prior) throw new Error(`Unreceipted cache file: ${destination}. Review it before acquisition; no source receipt was changed.`);
  if (prior && prior.sha256 !== sha256) throw new Error(`Source hash mismatch: ${destination}. Existing receipt preserved; do not accept altered cached bytes.`);
  receipts.push(prior || { ...file, url, cachePath: path.relative(root, destination), sha256, bytes: bytes.length, features: data.features.length, acquiredAt: new Date().toISOString() });
  console.log(`${file.id}: ${data.features.length} features, ${(bytes.length / 1e6).toFixed(2)} MB`);
}
await mkdir(path.join(root, 'receipts'), { recursive: true });
await writeFile(receiptPath, JSON.stringify({ files: receipts }, null, 2) + '\n');
