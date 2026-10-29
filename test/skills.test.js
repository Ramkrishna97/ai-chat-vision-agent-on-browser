import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSkillLibrary } from '../server/skills.js';

test('built-in and custom agent skills are listed and readable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lite-chat-skills-test-'));
  try {
    await mkdir(join(root, 'my_skill'));
    await writeFile(join(root, 'my_skill', 'SKILL.md'), '# My skill\nDescription: Verify outputs.\n\nRun the result.\n');
    const library = makeSkillLibrary(root);
    const catalog = await library.list();
    assert.ok(catalog.some(skill => skill.id === 'core'));
    assert.ok(catalog.some(skill => skill.id === 'my_skill' && skill.description === 'Verify outputs.'));
    assert.match((await library.read('my_skill')).content, /Run the result/);
    await assert.rejects(() => library.read('../outside'), /Invalid skill/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
