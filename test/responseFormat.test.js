import test from 'node:test';
import assert from 'node:assert/strict';
import { splitFencedCode } from '../src/responseFormat.js';

test('response keeps fenced code separate for its copy button', () => {
  assert.deepEqual(splitFencedCode('Try this:\n```java\nclass Hello {}\n```\nDone.'), [
    { type: 'text', text: 'Try this:\n' },
    { type: 'code', language: 'java', text: 'class Hello {}' },
    { type: 'text', text: '\nDone.' },
  ]);
  assert.deepEqual(splitFencedCode('plain response'), [{ type: 'text', text: 'plain response' }]);
});
