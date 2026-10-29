import test from 'node:test';
import assert from 'node:assert/strict';
import { textToolCalls } from '../src/agentToolCalls.js';

test('agent accepts a valid textual tool call from a small model', () => {
  const calls = textToolCalls('```json\n{"name":"write_file","arguments":{"path":"Hello.js","content":"console.log(1)"}}\n```');
  assert.equal(calls[0].function.name, 'write_file');
  assert.equal(calls[0].function.arguments.path, 'Hello.js');
});

test('agent rejects malformed textual tool calls', () => {
  assert.deepEqual(textToolCalls('```json\n{"name":"write_file","arguments":{"path":".","path content":"bad"}}\n```'), []);
  assert.deepEqual(textToolCalls('Here is my answer.'), []);
});

test('agent can recover a requested filename when a small model uses dot as the path', () => {
  const calls = textToolCalls('{"name":"write_file","arguments":{"path":".","content":"print(1)"}}', 'Create Hello.py');
  assert.equal(calls[0].function.arguments.path, 'Hello.py');
  const duplicate = textToolCalls('{"name":"write_file","arguments":{"path":"Hello.js","content":"console.log(1)","path":"."}}', 'Create Hello.js');
  assert.equal(duplicate[0].function.arguments.path, 'Hello.js');
});
