import test from 'node:test';
import assert from 'node:assert/strict';
import { failingSourcePath, repairPrompt } from '../src/agentDiagnostics.js';

test('agent repair prompt includes compiler error and the source that failed', () => {
  const paths = ['src/Other.java', 'src/TimeUntilMidnight.java'];
  const output = 'C:\\work\\src\\TimeUntilMidnight.java:9: error: method toEpochSecond cannot be applied to given types; required: ZoneOffset';
  const path = failingSourcePath(paths, output);
  assert.equal(path, 'src/TimeUntilMidnight.java');
  const prompt = repairPrompt({ exitCode: 1, output }, path, 'midnight.toEpochSecond()');
  assert.match(prompt, /required: ZoneOffset/);
  assert.match(prompt, /midnight\.toEpochSecond\(\)/);
  assert.match(prompt, /run the project again/);
});
