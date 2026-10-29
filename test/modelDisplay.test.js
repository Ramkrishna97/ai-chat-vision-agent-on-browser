import test from 'node:test';
import assert from 'node:assert/strict';
import { modelDisplayName } from '../src/modelDisplay.js';

test('model choices show image generation only when advertised', () => {
  assert.equal(modelDisplayName({ name: 'A', capabilities: { chat: true, imageGeneration: false } }), 'A · chat');
  assert.equal(modelDisplayName({ name: 'B', capabilities: { chat: false, imageGeneration: true } }), 'B · image generation');
  assert.equal(modelDisplayName({ name: 'C', capabilities: {}, reportedCapabilities: ['embedding'] }), 'C · unsupported (embedding)');
});
