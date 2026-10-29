import { mkdir, realpath, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

function relativePath(path) {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) throw new Error('Path must be relative to the workspace.');
  return path;
}

async function existingPath(root, path) {
  const workspace = await realpath(root);
  const target = await realpath(resolve(workspace, relativePath(path)));
  const part = relative(workspace, target);
  if (part === '..' || part.startsWith(`..${sep}`) || isAbsolute(part)) throw new Error('Path must be inside the workspace.');
  return { workspace, target };
}

export async function readWorkspaceFile(root, { path }) {
  const { workspace, target } = await existingPath(root, path);
  const info = await stat(target);
  if (!info.isFile()) throw new Error('Select a file to read.');
  if (info.size > 256 * 1024) throw new Error('File is larger than the 256 KB read limit.');
  const content = await readFile(target, 'utf8');
  if (content.includes('\0')) throw new Error('Binary files cannot be read as text.');
  return { path: relative(workspace, target), content };
}

export async function listWorkspaceFiles(root, { path = '.' } = {}) {
  const { workspace, target } = await existingPath(root, path);
  if (!(await stat(target)).isDirectory()) throw new Error('Select a directory to list.');
  const ignored = new Set(['node_modules', '.git', '.gradle', '.mvn', 'target', 'build', 'dist']);
  const files = [];
  async function visit(directory, depth) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (files.length >= 200) return;
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const item = resolve(directory, entry.name);
      files.push(relative(workspace, item) + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory() && depth < 3) await visit(item, depth + 1);
    }
  }
  await visit(target, 0);
  return { path: relative(workspace, target) || '.', files, truncated: files.length >= 200 };
}

export async function writeWorkspaceFile(root, { path, content }) {
  if (typeof path !== 'string' || !path.trim() || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) {
    throw new Error('File path must be relative to the workspace.');
  }
  if (typeof content !== 'string' || content.length > 1024 * 1024) throw new Error('File content must be text under 1 MB.');
  const workspace = await realpath(root);
  const destination = resolve(workspace, path);
  if (!relative(workspace, destination) || relative(workspace, destination).startsWith('..')) throw new Error('File path must be inside the workspace.');
  await mkdir(dirname(destination), { recursive: true });
  const parent = await realpath(dirname(destination));
  if (parent !== workspace && relative(workspace, parent).startsWith('..')) throw new Error('File path must be inside the workspace.');
  await writeFile(destination, content, 'utf8');
  return { path: relative(workspace, destination), bytes: Buffer.byteLength(content) };
}

export function parseUnixHeredoc(command) {
  if (typeof command !== 'string') return null;
  const match = command.match(/^cat\s+>\s+([^\s]+)\s+<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\r?\n([\s\S]*?)\r?\n\2\s*$/)
    || command.match(/^cat\s+<<\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?\s+>\s+([^\s]+)\r?\n([\s\S]*?)\r?\n\1\s*$/);
  if (!match) return null;
  return command.indexOf('>') < command.indexOf('<<')
    ? { path: match[1], content: match[3] + '\n' }
    : { path: match[2], content: match[3] + '\n' };
}
