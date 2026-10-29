import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeWorkspaceStore } from '../server/agentWorkspaces.js';
import { runProject } from '../server/projectRunner.js';
import { writeWorkspaceFile } from '../server/workspace.js';
import { agentRunTarget } from '../src/agentRunTarget.js';

test('each chat has a persistent, separate workspace where generated code runs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lite-chat-workspaces-test-'));
  const store = makeWorkspaceStore(root);
  const firstId = '11111111-1111-4111-8111-111111111111';
  const secondId = '22222222-2222-4222-8222-222222222222';
  try {
    const first = await store.create(firstId);
    const again = await store.create(firstId);
    const second = await store.create(secondId);
    assert.equal(first.path, again.path);
    assert.notEqual(first.path, second.path);
    await writeWorkspaceFile(first.path, { path: 'Hello.js', content: 'console.log("chat one works")\n' });
    assert.equal(await readFile(join(first.path, 'Hello.js'), 'utf8'), 'console.log("chat one works")\n');
    await assert.rejects(() => readFile(join(second.path, 'Hello.js')));
    const run = await runProject(first.path, { path: 'Hello.js', action: 'run' });
    assert.equal(run.exitCode, 0);
    assert.match(run.output, /chat one works/);
    await assert.rejects(() => store.get('../outside'), /Invalid chat/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('automatic run target prefers a build manifest and otherwise uses source', () => {
  assert.equal(agentRunTarget(['app/src/Main.java', 'app/pom.xml']), 'app');
  assert.equal(agentRunTarget(['demo.py']), 'demo.py');
  assert.equal(agentRunTarget(['notes.txt']), null);
});
