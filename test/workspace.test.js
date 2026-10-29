import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseUnixHeredoc, writeWorkspaceFile, readWorkspaceFile, listWorkspaceFiles } from '../server/workspace.js';

test('whole-file writes create a source file and reject paths outside the workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lite-chat-test-'));
  try {
    await writeWorkspaceFile(root, { path: 'src/Hello.java', content: 'class Hello {}\n' });
    assert.equal(await readFile(join(root, 'src/Hello.java'), 'utf8'), 'class Hello {}\n');
    await assert.rejects(() => writeWorkspaceFile(root, { path: '../outside.java', content: '' }), /relative/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Windows agent can recover a Unix heredoc as one file write', () => {
  assert.deepEqual(parseUnixHeredoc('cat > TimeUntilMidnight.java <<EOF\nclass TimeUntilMidnight {}\nEOF'), {
    path: 'TimeUntilMidnight.java', content: 'class TimeUntilMidnight {}\n',
  });
});

test('agent can inspect files in its own workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lite-chat-test-'));
  try {
    await writeWorkspaceFile(root, { path: 'app/main.js', content: 'console.log("ok")\n' });
    const listing = await listWorkspaceFiles(root, { path: '.' });
    assert.ok(listing.files.includes('app/'));
    assert.ok(listing.files.some(path => path.replaceAll('\\', '/') === 'app/main.js'));
    assert.equal((await readWorkspaceFile(root, { path: 'app/main.js' })).content, 'console.log("ok")\n');
    await assert.rejects(() => readWorkspaceFile(root, { path: '../outside.txt' }), /relative/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
