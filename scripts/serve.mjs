#!/usr/bin/env node
// Minimal static server for development: `node scripts/serve.mjs [port]`.
// WebXR needs a secure context: on the headset either use https (e.g. GitHub Pages / a tunnel)
// or forward the port with `adb reverse tcp:8080 tcp:8080` and open http://localhost:8080.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 8080);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const file = path.normalize(path.join(root, urlPath));
  if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Cross-Origin-Opener-Policy': 'same-origin' });
    fs.createReadStream(file).pipe(res);
  });
}).listen(port, () => {
  console.log(`Punching Master dev server → http://localhost:${port}`);
  console.log('Quest tip: adb reverse tcp:' + port + ' tcp:' + port + '  then open http://localhost:' + port + ' in the Quest Browser.');
});
