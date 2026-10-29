import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const builtins = ['core', 'java', 'web', 'python', 'debug'];
const builtinsRoot = fileURLToPath(new URL('./skills/', import.meta.url));
export const customSkillsRoot = process.env.AGENT_SKILLS_ROOT
  ? resolve(process.env.AGENT_SKILLS_ROOT)
  : process.platform === 'win32'
    ? join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'LiteChat', 'skills')
    : join(homedir(), '.local', 'share', 'lite-chat', 'skills');

const validId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(id);
const inside = (root, target) => { const part = relative(root, target); return part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part); };

export function makeSkillLibrary(customRoot = customSkillsRoot) {
  async function skillPath(id) {
    if (!validId(id)) throw new Error('Invalid skill name.');
    if (builtins.includes(id)) return join(builtinsRoot, id, 'SKILL.md');
    const root = await realpath(customRoot);
    const path = await realpath(join(root, id, 'SKILL.md'));
    if (!inside(root, path)) throw new Error('Skill file must be inside the skills folder.');
    return path;
  }
  async function read(id) {
    const path = await skillPath(id);
    if ((await stat(path)).size > 16 * 1024) throw new Error('Skill is larger than 16 KB.');
    const content = await readFile(path, 'utf8');
    const name = content.match(/^#\s+(.+)$/m)?.[1] || id;
    const description = content.match(/^Description:\s*(.+)$/m)?.[1] || '';
    return { id, name, description, content };
  }
  async function list() {
    const custom = await readdir(customRoot, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    const ids = [...builtins, ...custom.filter(entry => entry.isDirectory() && validId(entry.name) && !builtins.includes(entry.name)).map(entry => entry.name)];
    const result = await Promise.all(ids.map(id => read(id).catch(() => null)));
    return result.filter(Boolean).map(({ content, ...entry }) => entry);
  }
  return { list, read };
}
