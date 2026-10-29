import test from 'node:test';
import assert from 'node:assert/strict';
import { ggufInfo } from '../src/ggufKind.js';

function modelHeader(architecture, tokenizer = false) {
  const entries = [['general.architecture', architecture], ...(tokenizer ? [['tokenizer.ggml.model', 'llama']] : [])];
  const encoded = entries.map(([key, value]) => {
    const name = Buffer.from(key);
    const data = Buffer.from(value);
    const entry = Buffer.alloc(8 + name.length + 4 + 8 + data.length);
    entry.writeBigUInt64LE(BigInt(name.length), 0);
    name.copy(entry, 8);
    entry.writeUInt32LE(8, 8 + name.length);
    entry.writeBigUInt64LE(BigInt(data.length), 12 + name.length);
    data.copy(entry, 20 + name.length);
    return entry;
  });
  const buffer = Buffer.alloc(24);
  buffer.write('GGUF', 0);
  buffer.writeUInt32LE(3, 4);
  buffer.writeBigUInt64LE(BigInt(entries.length), 16);
  return new Blob([buffer, ...encoded]);
}

test('GGUF metadata detects chat tokenizers without naming model families', async () => {
  assert.deepEqual(await ggufInfo(modelHeader('qwen_image21')), { architecture: 'qwen_image21', hasTokenizer: false, complete: true });
  assert.deepEqual(await ggufInfo(modelHeader('llama', true)), { architecture: 'llama', hasTokenizer: true, complete: true });
});
