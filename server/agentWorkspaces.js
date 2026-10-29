import { mkdir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

export const defaultWorkspacesRoot = process.env.AGENT_WORKSPACES_ROOT
  ? resolve(process.env.AGENT_WORKSPACES_ROOT)
  : process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'LiteChat', 'workspaces')
    : join(homedir(), '.local', 'share', 'lite-chat', 'workspaces');

const validId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
const inside = (root, target) => {
  const part = relative(root, target);
  return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part);
};

export function makeWorkspaceStore(base = defaultWorkspacesRoot) {
  const folder = resolve(base);
  async function workspace(id, create = false) {
    if (!validId(id)) throw new Error('Invalid chat workspace ID.');
    if (create) await mkdir(join(folder, id), { recursive: true });
    const root = await realpath(folder);
    const path = await realpath(join(root, id));
    if (!inside(root, path) || path === root) throw new Error('Chat workspace must stay inside the workspace folder.');
    return { id, path };
  }
  return { create: id => workspace(id, true), get: id => workspace(id) };
}
