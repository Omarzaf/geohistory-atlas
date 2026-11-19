/** Reproject the pinned public-domain Natural Earth relief to the regional SVG viewport.
 * Build-time tools only: Node, unzip, macOS sips, cwebp and webpmux. No application dependency.
 * First acquisition: node scripts/build-region-relief.mjs --fetch
 * Offline rebuild: node scripts/build-region-relief.mjs
 * The source cache and intermediate rasters are excluded from the public artifact.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MercatorProjector } from '../js/region/geometry.mjs';
import { CONFIG } from '../js/region/model.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache/natural-earth-relief/3.2.0');
const archiveUrl = 'https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip';
const archiveHash = 'ff810f5f2747463fd8ffa612b23e5f5e5d593a345218976872b6749610976ab7';
const tifHash = 'aff6ec6905554ed489087edf46e61cbf68c810fe99f2a1d2cddda7e986a540a2';
const worldHash = '7f1cc97126a52814c874ec326a8275c7ded3edc4d7bced417f76d71a995069bd';
const archive = path.join(cache, 'SR_50M.zip');
const tif = path.join(cache, 'SR_50M.tif');
const bmp = path.join(cache, 'SR_50M.bmp');
const ppm = path.join(cache, 'region-relief.ppm');
const encoded = path.join(cache, 'region-relief.webp');
const metadata = path.join(cache, 'region-relief.xmp');
const output = path.join(root, 'assets/region/relief.webp');
const receiptPath = path.join(root, 'data/region/relief-source.json');
const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw result.error || new Error(`${command}: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

fs.mkdirSync(cache, { recursive: true });
if (!fs.existsSync(archive)) {
  if (!process.argv.includes('--fetch')) throw new Error('Pinned source is absent. Run with --fetch to acquire the public-domain source, then rebuild offline.');
  run('curl', ['--fail', '--location', '--max-time', '120', '--output', archive, archiveUrl]);
}
const archiveBytes = fs.readFileSync(archive);
if (sha256(archiveBytes) !== archiveHash) throw new Error('Natural Earth archive differs from the reviewed source. Do not rebuild until the new source has been reviewed.');
if (!fs.existsSync(tif)) run('unzip', ['-n', archive, '-d', cache]);
if (sha256(fs.readFileSync(tif)) !== tifHash) throw new Error('Cached TIFF differs from the pinned source.');
run('sips', ['-s', 'format', 'bmp', tif, '--out', bmp]);
const bitmap = fs.readFileSync(bmp);
if (bitmap.toString('ascii', 0, 2) !== 'BM' || bitmap.readUInt16LE(28) !== 24 || bitmap.readUInt32LE(30) !== 0) throw new Error('Expected uncompressed 24-bit BMP output from sips.');
const pixelOffset = bitmap.readUInt32LE(10);
const sourceWidth = bitmap.readInt32LE(18);
const signedHeight = bitmap.readInt32LE(22);
const sourceHeight = Math.abs(signedHeight);
const rowStride = Math.ceil(sourceWidth * 3 / 4) * 4;
const topDown = signedHeight < 0;
const worldFile = fs.readFileSync(path.join(cache, 'SR_50M.tfw'), 'utf8');
if (sha256(Buffer.from(worldFile)) !== worldHash) throw new Error('Cached georeferencing differs from the pinned source.');
const [pixelLng, rotateY, rotateX, pixelLat, originLng, originLat] = worldFile.trim().split(/\s+/).map(Number);
if (rotateX || rotateY || sourceWidth !== 10800 || sourceHeight !== 5400) throw new Error('Unexpected source extent or rotation.');
const width = 2400;
const height = 1520;
const viewBox = { x: 0, y: 0, width: 1200, height: 760 };
const projector = new MercatorProjector(viewBox.width, viewBox.height, CONFIG.bounds);
const pixels = Buffer.alloc(width * height * 3);

function grayAt(x, y) {
  const row = topDown ? y : sourceHeight - 1 - y;
  const offset = pixelOffset + row * rowStride + x * 3;
  return .2126 * bitmap[offset + 2] + .7152 * bitmap[offset + 1] + .0722 * bitmap[offset];
}

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const [lng, lat] = projector.toGeo((x + .5) * viewBox.width / width, (y + .5) * viewBox.height / height);
    const sx = Math.max(0, Math.min(sourceWidth - 1.000001, (lng - originLng) / pixelLng));
    const sy = Math.max(0, Math.min(sourceHeight - 1.000001, (lat - originLat) / pixelLat));
    const x0 = Math.floor(sx), y0 = Math.floor(sy), dx = sx - x0, dy = sy - y0;
    const top = grayAt(x0, y0) * (1 - dx) + grayAt(x0 + 1, y0) * dx;
    const bottom = grayAt(x0, y0 + 1) * (1 - dx) + grayAt(x0 + 1, y0 + 1) * dx;
    const shade = Math.round(top * (1 - dy) + bottom * dy);
    const offset = (y * width + x) * 3;
    pixels[offset] = shade; pixels[offset + 1] = shade; pixels[offset + 2] = shade;
  }
}
fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`), pixels]));
fs.mkdirSync(path.dirname(output), { recursive: true });
run('cwebp', ['-quiet', '-q', '86', '-m', '6', '-metadata', 'none', ppm, '-o', encoded]);
fs.writeFileSync(metadata, `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:xmpRights="http://ns.adobe.com/xap/1.0/rights/" dc:source="${archiveUrl}" xmpRights:Marked="False"><dc:description><rdf:Alt><rdf:li xml:lang="x-default">Natural Earth 1:50m shaded relief, public domain. Modern physical reference reprojected to Geohistory's Mercator SVG viewport with bilinear sampling. Source archive SHA-256 ${archiveHash}. Full provenance: data/region/relief-source.json.</rdf:li></rdf:Alt></dc:description><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">Public domain; https://www.naturalearthdata.com/about/terms-of-use/</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>`);
run('webpmux', ['-set', 'xmp', metadata, encoded, '-o', output]);
const outputBytes = fs.readFileSync(output);
if (outputBytes.length >= 500_000) throw new Error(`Relief exceeds the 500 KB asset budget: ${outputBytes.length} bytes.`);
const receipt = {
  id: 'natural-earth-50m-shaded-relief',
  title: 'Natural Earth 1:50m Shaded Relief',
  publisher: 'Natural Earth',
  sourceUrl: 'https://www.naturalearthdata.com/downloads/50m-raster-data/50m-shaded-relief/',
  archiveUrl,
  advertisedVersion: '3.2.0',
  embeddedVersion: fs.readFileSync(path.join(cache, 'SR_50M.VERSION.txt'), 'utf8').trim(),
  versionNote: 'The official page advertises version 3.2.0; the downloaded archive contains VERSION.txt 2.0.0. Both are retained. The exact inputs are identified by hashes.',
  retrievedOn: '2026-11-19',
  archive: { bytes: archiveBytes.length, sha256: archiveHash },
  raster: { file: 'SR_50M.tif', width: sourceWidth, height: sourceHeight, sha256: tifHash, crs: 'WGS 84 geographic coordinates', worldFile, worldFileSha256: worldHash },
  license: 'Public domain',
  licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
  attribution: 'Made with Natural Earth. Grayscale relief derived by Natural Earth from downsampled SRTM Plus elevation data.',
  purpose: 'Modern physical relief for orientation. This layer does not reconstruct historical terrain or validate historical borders.',
  derivation: {
    script: 'scripts/build-region-relief.mjs',
    projection: 'The same MercatorProjector and CONFIG.bounds used by the SVG atlas',
    bounds: CONFIG.bounds,
    viewBox,
    sampleMethod: 'Bilinear interpolation from source pixel centers; output samples at SVG pixel centers',
    treatment: 'Grayscale without additional hillshading, elevation inference, or contrast transformation. Clip to the atlas land geometry when displayed.',
    encoder: `cwebp ${run('cwebp', ['-version'])}`,
    encoderArguments: '-q 86 -m 6 -metadata none',
    metadata: 'Source, public-domain rights and archive hash embedded as XMP with webpmux',
  },
  output: { path: 'assets/region/relief.webp', width, height, bytes: outputBytes.length, sha256: sha256(outputBytes) },
};
fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(`Built ${width}×${height} projected relief (${outputBytes.length} bytes). SHA-256 ${receipt.output.sha256}`);
