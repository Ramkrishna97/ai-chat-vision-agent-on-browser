import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { listModels, ollamaChat, ollamaImage, ollamaStart, ollamaStop, ollamaChatStream } from './ollama.js';
import { parseUnixHeredoc, writeWorkspaceFile } from './workspace.js';
import { runJava } from './java.js';

const port = Number(process.env.BRIDGE_PORT || 3210);
const token = process.env.BRIDGE_TOKEN || randomBytes(18).toString('hex');
const origins = new Set([`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3001`, `http://127.0.0.1:3001`, ...(process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)]);
const root = resolve(process.env.WORKSPACE_ROOT || process.cwd());
const maxBody = 4 * 1024 * 1024;

function json(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
  res.end(JSON.stringify(body));
}

function runCommand({ command, cwd, shell }) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Enter a command under 4,000 characters.');
  const heredoc = process.platform === 'win32' && parseUnixHeredoc(command);
  if (heredoc) return writeWorkspaceFile(root, heredoc).then(result => ({ exitCode: 0, output: `Wrote ${result.path} (${result.bytes} bytes)`, path: result.path, cwd: root }));
  const workdir = resolve(root, cwd || '.');
  if (workdir !== root && !workdir.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Working directory must be inside the configured workspace.');
  const selectedShell = process.platform === 'win32' && shell !== 'cmd' ? 'powershell.exe' : process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const args = selectedShell === 'powershell.exe' ? ['-NoProfile', '-Command', command] : selectedShell === 'cmd.exe' ? ['/d', '/s', '/c', command] : ['-lc', command];
  return new Promise((done, reject) => {
    const child = spawn(selectedShell, args, { cwd: workdir, windowsHide: true, env: process.env });
    let output = '';
    let finished = false;
    const timer = setTimeout(() => child.kill(), 60000);
    const append = chunk => { output = (output + chunk.toString()).slice(-20000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', reject);
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      done({ exitCode: code, output, cwd: workdir });
    });
  });
}

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) { json(res, 403, { error: 'Origin not allowed.' }); return; }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': origin || '', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Bridge-Token', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Max-Age': '600', Vary: 'Origin' });
    res.end(); return;
  }
  const localOrigins = new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001', 'http://127.0.0.1:3001']);
  let refererOrigin = '';
  try { refererOrigin = new URL(req.headers.referer).origin; } catch {}
  const pairingOrigin = origin || (req.headers['sec-fetch-site'] === 'same-origin' ? refererOrigin : '');
  if (req.method === 'GET' && req.url === '/pair-local' && localOrigins.has(pairingOrigin) && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
    json(res, 200, { token }, origin); return;
  }
  const supplied = req.headers['x-bridge-token'];
  const a = Buffer.from(typeof supplied === 'string' ? supplied : '');
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) { json(res, 401, { error: 'Enter the pairing code printed by the local bridge.' }, origin); return; }
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > maxBody) throw new Error('Request is too large.');
    }
    const body = raw ? JSON.parse(raw) : {};
    let result;
    if (req.method === 'GET' && req.url === '/models') result = { models: await listModels(), platform: process.platform };
    else if (req.method === 'POST' && req.url === '/chat') result = await ollamaChat(body);
    else if (req.method === 'POST' && req.url === '/image') result = await ollamaImage(body);
    else if (req.method === 'POST' && req.url === '/start') result = await ollamaStart(body);
    else if (req.method === 'POST' && req.url === '/stop') result = await ollamaStop(body);
    else if (req.method === 'POST' && req.url === '/chat-stream') {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      const upstream = await ollamaChatStream(body, controller.signal);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
      for await (const chunk of upstream.body) res.write(chunk);
      res.end(); return;
    }
    else if (req.method === 'POST' && req.url === '/exec') result = await runCommand(body);
    else if (req.method === 'POST' && req.url === '/write-file') result = await writeWorkspaceFile(root, body);
    else if (req.method === 'POST' && req.url === '/run-java') result = await runJava(root, body);
    else { json(res, 404, { error: 'Not found.' }, origin); return; }
    json(res, 200, result, origin);
  } catch (error) {
    if (res.headersSent) {
      if (!res.destroyed) res.end(JSON.stringify({ error: error.message || 'Local bridge failed.' }) + '\n');
    } else json(res, 500, { error: error.message || 'Local bridge failed.' }, origin);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local bridge: http://127.0.0.1:${port}`);
  console.log(`Pairing code: ${token}`);
  console.log(`Command workspace: ${root}`);
  if (process.env.APP_ORIGIN) console.log(`Allowed deployed origin: ${process.env.APP_ORIGIN}`);
});
