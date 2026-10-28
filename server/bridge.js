import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { listModels, ollamaChat, ollamaImage } from './ollama.js';

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
  const workdir = resolve(root, cwd || '.');
  if (workdir !== root && !workdir.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Working directory must be inside the configured workspace.');
  const selectedShell = shell === 'powershell' && process.platform === 'win32' ? 'powershell.exe' : process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
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
    if (req.method === 'GET' && req.url === '/models') result = { models: await listModels() };
    else if (req.method === 'POST' && req.url === '/chat') result = await ollamaChat(body);
    else if (req.method === 'POST' && req.url === '/image') result = await ollamaImage(body);
    else if (req.method === 'POST' && req.url === '/exec') result = await runCommand(body);
    else { json(res, 404, { error: 'Not found.' }, origin); return; }
    json(res, 200, result, origin);
  } catch (error) { json(res, 500, { error: error.message || 'Local bridge failed.' }, origin); }
}).listen(port, '127.0.0.1', () => {
  console.log(`Local bridge: http://127.0.0.1:${port}`);
  console.log(`Pairing code: ${token}`);
  console.log(`Command workspace: ${root}`);
});
