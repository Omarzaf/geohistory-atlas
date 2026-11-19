/** Serve the explicit built public manifest on loopback. No directory browsing or fallback routes. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const port = Number(process.env.ATLAS_PORT || 8767);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8' };
if (!fs.existsSync(path.join(root, 'release.json'))) throw new Error('Build first: node scripts/build-region.cjs');
http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end('Bad request'); return; }
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'release.json'), 'utf8'));
  const allowed = new Set([...manifest.files.map(file => file.path), 'release.json']);
  if (!allowed.has(relative)) { response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) { response.writeHead(404).end('Not found'); return; }
  response.writeHead(200, { 'Content-Type': types[path.extname(filename)] || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (request.method === 'HEAD') response.end();
  else fs.createReadStream(filename).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Local: http://127.0.0.1:${port}/`));
