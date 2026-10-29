import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { listModels, ollamaChat, ollamaImage, ollamaStart, ollamaStop, ollamaChatStream } from './ollama.js';
import { parseUnixHeredoc, writeWorkspaceFile, readWorkspaceFile, listWorkspaceFiles } from './workspace.js';
import { runProject } from './projectRunner.js';
import { defaultWorkspacesRoot, makeWorkspaceStore } from './agentWorkspaces.js';
import { customSkillsRoot, makeSkillLibrary } from './skills.js';

const port = Number(process.env.BRIDGE_PORT || 3210);
const token = process.env.BRIDGE_TOKEN || randomBytes(18).toString('hex');
const origins = new Set([`http://localhost:5173`, `http://127.0.0.1:5173`, `http://localhost:3001`, `http://127.0.0.1:3001`, ...(process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean)]);
const root = resolve(process.env.WORKSPACE_ROOT || process.cwd());
const agentWorkspaces = makeWorkspaceStore();
const skills = makeSkillLibrary();
const maxBody = 4 * 1024 * 1024;

function json(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}) });
  res.end(JSON.stringify(body));
}

function runCommand(workspaceRoot, { command, cwd, shell }, signal) {
  if (typeof command !== 'string' || !command.trim() || command.length > 4000) throw new Error('Enter a command under 4,000 characters.');
  const heredoc = process.platform === 'win32' && parseUnixHeredoc(command);
  if (heredoc) return writeWorkspaceFile(workspaceRoot, heredoc).then(result => ({ exitCode: 0, output: `Wrote ${result.path} (${result.bytes} bytes)`, path: result.path, cwd: workspaceRoot }));
  const workdir = resolve(workspaceRoot, cwd || '.');
  if (workdir !== workspaceRoot && !workdir.startsWith(workspaceRoot + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('Working directory must be inside the configured workspace.');
  const selectedShell = process.platform === 'win32' && shell !== 'cmd' ? 'powershell.exe' : process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const args = selectedShell === 'powershell.exe' ? ['-NoProfile', '-Command', command] : selectedShell === 'cmd.exe' ? ['/d', '/s', '/c', command] : ['-lc', command];
  return new Promise((done, reject) => {
    const child = spawn(selectedShell, args, { cwd: workdir, windowsHide: true, env: process.env });
    let output = '';
    let finished = false;
    let timedOut = false;
    const stop = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
      else child.kill();
    };
    const abort = () => stop();
    const timer = setTimeout(() => { timedOut = true; stop(); }, 60000);
    signal?.addEventListener('abort', abort, { once: true });
    const append = chunk => { output = (output + chunk.toString()).slice(-20000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', code => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      done({ exitCode: timedOut ? -1 : code, output: timedOut ? `${output}\nTimed out after 60 seconds.` : output, cwd: workdir });
    });
    if (signal?.aborted) abort();
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
    else if (req.method === 'POST' && req.url === '/agent-workspace') result = await agentWorkspaces.create(body.chatId);
    else if (req.method === 'GET' && req.url === '/skills') result = { skills: await skills.list(), customRoot: customSkillsRoot };
    else if (req.method === 'POST' && req.url === '/read-skill') result = await skills.read(body.id);
    else if (req.method === 'POST' && req.url === '/exec') {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      result = await runCommand(body.workspaceId ? (await agentWorkspaces.get(body.workspaceId)).path : root, body, controller.signal);
    }
    else if (req.method === 'POST' && req.url === '/write-file') result = await writeWorkspaceFile(body.workspaceId ? (await agentWorkspaces.get(body.workspaceId)).path : root, body);
    else if (req.method === 'POST' && req.url === '/read-file') result = await readWorkspaceFile(body.workspaceId ? (await agentWorkspaces.get(body.workspaceId)).path : root, body);
    else if (req.method === 'POST' && req.url === '/list-files') result = await listWorkspaceFiles(body.workspaceId ? (await agentWorkspaces.get(body.workspaceId)).path : root, body);
    else if (req.method === 'POST' && req.url === '/run-project') {
      const controller = new AbortController();
      res.on('close', () => controller.abort());
      result = await runProject(body.workspaceId ? (await agentWorkspaces.get(body.workspaceId)).path : root, body, controller.signal);
    }
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
  console.log(`Agent chat workspaces: ${defaultWorkspacesRoot}`);
  console.log(`Custom agent skills: ${customSkillsRoot}`);
  if (process.env.APP_ORIGIN) console.log(`Allowed deployed origin: ${process.env.APP_ORIGIN}`);
});
