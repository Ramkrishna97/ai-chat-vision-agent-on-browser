import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, listModels, ollamaImage, ollamaChatStream, ollamaStart, ollamaStop } from '../server/ollama.js';

test('Ollama capabilities map to the controls shown in the UI', () => {
  const model = normalizeModel({ name: 'local:small', size: 100 }, {
    capabilities: ['completion', 'vision', 'tools', 'thinking'],
    model_info: { 'general.architecture': 'llama', 'llama.context_length': 8192 },
  });
  assert.deepEqual(model.capabilities, {
    chat: true, vision: true, audio: false, tools: true, thinking: true,
    imageGeneration: false, file: true,
  });
  assert.equal(model.context, 8192);
});

test('discovery lists all local models and reports unsupported capabilities', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => ({ models: [
      { name: 'large', size: 1000 }, { name: 'remote:cloud', size: 10 },
      { name: 'small', size: 100 }, { name: 'embed', size: 50 },
    ] }) };
    const name = JSON.parse(options.body).model;
    return { ok: true, json: async () => ({ capabilities: name === 'embed' ? ['embedding'] : ['completion'] }) };
  };
  try {
    const models = await listModels();
    assert.deepEqual(models.map(model => model.id), ['embed', 'large', 'small']);
    assert.equal(models[0].capabilities.imageGeneration, false);
    assert.deepEqual(models[0].reportedCapabilities, ['embedding']);
  }
  finally { globalThis.fetch = original; }
});

test('image models use Ollama generation without a separate image app', async () => {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ image: 'iVBORw0KGgo=' }) };
  };
  try {
    const model = normalizeModel({ name: 'local-image' }, { capabilities: ['image'] });
    assert.equal(model.capabilities.imageGeneration, true);
    assert.equal((await ollamaImage({ model: model.id, prompt: 'A tree' })).image, 'iVBORw0KGgo=');
    assert.equal(request.url.endsWith('/api/generate'), true);
    assert.equal(request.body.stream, false);
  } finally { globalThis.fetch = original; }
});

test('model switching requests unload and preload, and chat streams chunks', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ done: true }), body: new ReadableStream() };
  };
  try {
    await ollamaStop({ model: 'old' });
    await ollamaStart({ model: 'new' });
    await ollamaChatStream({ model: 'new', messages: [{ role: 'user', content: 'Hi' }], tools: [{ type: 'function' }] });
    assert.deepEqual(calls.map(call => [call.body.model, call.body.keep_alive, call.body.stream]), [
      ['old', 0, false], ['new', -1, false], ['new', undefined, true],
    ]);
    assert.deepEqual(calls[2].body.tools, [{ type: 'function' }]);
  } finally { globalThis.fetch = original; }
});
