import test from 'node:test';
import assert from 'node:assert/strict';
import { contextLimit, estimatedConversationTokens, ollamaUsage } from '../src/contextUsage.js';

test('context display uses model limit and actual Ollama token counts when present', () => {
  assert.equal(contextLimit({ context: 8192 }, { context: 4096 }), 4096);
  assert.deepEqual(ollamaUsage({ prompt_eval_count: 120, eval_count: 30 }), { prompt: 120, output: 30, used: 150, estimated: false });
  assert.equal(ollamaUsage({}), null);
  assert.equal(estimatedConversationTokens([{ text: '12345678' }], '1234'), 3);
});
