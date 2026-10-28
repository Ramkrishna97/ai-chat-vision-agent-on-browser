import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const port = Number(process.env.PORT || 3001);
const dist = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };

http.createServer(async (req, res) => {
  try {
    let path = resolve(dist, '.' + decodeURIComponent(req.url?.split('?')[0] || '/'));
    if (path !== dist && !path.startsWith(dist + sep)) throw new Error('Invalid path');
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    try { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(join(dist, 'index.html'))); }
    catch { res.writeHead(404); res.end('Build the app first with npm run build.'); }
  }
}).listen(port, () => console.log(`Lite Chat running on http://localhost:${port}`));
