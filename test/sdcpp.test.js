import test from 'node:test';
import assert from 'node:assert/strict';
import { listImageModels, generateLocalImage, checkLocalImageModel, unloadLocalImageModel, imageModelId, loadImageModel, saveImageModelFile, getImageModelOptions } from '../server/sdcpp.js';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('loaded stable-diffusion.cpp model is discoverable and generates an image', async () => {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) });
    const data = url.endsWith('/models/status') ? { state: 'ready', recipe: 'z-image-turbo' }
      : url.endsWith('/capabilities') ? { supported_modes: ['img_gen'], model: { name: 'Ready image model' } }
      : url.endsWith('/img_gen') ? { id: 'job_1', status: 'queued' }
        : url.endsWith('/jobs/job_1') ? { status: 'completed', result: { images: [{ b64_json: 'iVBORw0KGgo=' }] } }
          : { state: 'empty' };
    return { ok: true, json: async () => data };
  };
  try {
    const models = await listImageModels();
    assert.equal(models[0].id, imageModelId);
    assert.equal(models[0].name, 'Ready image model');
    assert.equal(models[0].capabilities.imageGeneration, true);
    assert.equal(models[0].capabilities.chat, false);
    assert.deepEqual(await generateLocalImage({ model: imageModelId, prompt: 'A tree' }), { images: ['iVBORw0KGgo='] });
    assert.deepEqual(requests.find(item => item.url.endsWith('/img_gen')).body, { prompt: 'A tree', batch_count: 1, output_format: 'png' });
    await checkLocalImageModel();
    await unloadLocalImageModel();
    assert.ok(requests.some(item => item.url.endsWith('/sdcpp/v1/models/unload')));
  } finally { globalThis.fetch = original; }
});

test('image model is hidden until loaded and missing image output is reported', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/models/status') ? { state: 'empty' } : url.endsWith('/img_gen') ? { id: 'job_2' } : { status: 'completed', result: { images: [] } } });
  try {
    assert.deepEqual(await listImageModels(), []);
    await assert.rejects(checkLocalImageModel(), /Load an image model/);
    await assert.rejects(generateLocalImage({ model: imageModelId, prompt: 'A tree' }), /completed without an image/);
  } finally { globalThis.fetch = original; }
});

test('ready model without advertised image mode is not offered for generation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/models/status') ? { state: 'ready' } : { supported_modes: ['vid_gen'] } });
  try {
    assert.deepEqual(await listImageModels(), []);
    await assert.rejects(checkLocalImageModel(), /does not advertise image generation/);
  } finally { globalThis.fetch = original; }
});

test('stop cancels a stable-diffusion.cpp image job', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(url);
    return { ok: true, json: async () => url.endsWith('/img_gen') ? { id: 'job_3' } : { status: 'queued' } };
  };
  try {
    const controller = new AbortController();
    const pending = generateLocalImage({ model: imageModelId, prompt: 'A tree' }, controller.signal);
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(pending);
    assert.ok(calls.some(url => url.endsWith('/jobs/job_3/cancel')));
  } finally { globalThis.fetch = original; }
});

test('image components upload as files without buffering the whole request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lite-image-test-'));
  const original = process.env.SD_MODEL_DIR;
  const originalFetch = globalThis.fetch;
  process.env.SD_MODEL_DIR = root;
  globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/recipes') ? { recipes: [{ slots: [{ id: 'model', categories: ['diffusion_models'] }] }] } : { files: [] } });
  try {
    await saveImageModelFile(Readable.from(['GGUF', 'body']), { name: encodeURIComponent('qwen-image-2.1-UC-Q4_K_M.gguf'), category: 'diffusion_models' });
    assert.equal((await readFile(join(root, 'diffusion_models', 'qwen-image-2.1-UC-Q4_K_M.gguf'))).toString(), 'GGUFbody');
    await saveImageModelFile(Readable.from(['weights']), { name: 'custom.ckpt', category: 'diffusion_models' });
    assert.equal((await readFile(join(root, 'diffusion_models', 'custom.ckpt'))).toString(), 'weights');
    await assert.rejects(saveImageModelFile(Readable.from(['x']), { name: '../bad.gguf', category: 'diffusion_models' }), /Invalid/);
  } finally {
    if (original === undefined) delete process.env.SD_MODEL_DIR; else process.env.SD_MODEL_DIR = original;
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test('image model catalog and recipe slots determine loading without filename rules', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const files = [
    { id: 'diffusion', name: 'custom-edit.gguf', category: 'diffusion_models' },
    { id: 'encoder', name: 'custom-encoder.gguf', category: 'text_encoders' },
    { id: 'vae', name: 'custom-vae.safetensors', category: 'vae' },
  ];
  const recipe = { id: 'custom-edit', slots: [
    { id: 'diffusion_model', required: true, categories: ['diffusion_models'] },
    { id: 'llm', required: true, categories: ['text_encoders'] },
    { id: 'vae', categories: ['vae'] },
  ], required_any: [['vae']] };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: options.body && JSON.parse(options.body) });
    const data = url.endsWith('/model-files') ? { files }
      : url.endsWith('/recipes') ? { recipes: [recipe] }
        : url.endsWith('/capabilities') ? { supported_modes: ['img_gen'] }
        : { state: 'ready' };
    return { ok: true, json: async () => data };
  };
  try {
    assert.equal((await getImageModelOptions()).recipes[0].id, 'custom-edit');
    assert.equal((await loadImageModel({ recipeId: recipe.id, models: { diffusion_model: 'diffusion', llm: 'encoder', vae: 'vae' } })).imageGeneration, true);
    assert.deepEqual(requests.find(item => item.url.endsWith('/models/load')).body, {
      recipe: 'custom-edit', models: { diffusion_model: 'diffusion', llm: 'encoder', vae: 'vae' },
    });
    assert.deepEqual((await loadImageModel({ recipeId: recipe.id, models: { diffusion_model: 'diffusion', llm: 'encoder' } })).missing, ['one of vae']);
    await assert.rejects(loadImageModel({ recipeId: recipe.id, models: { diffusion_model: 'encoder', llm: 'diffusion', vae: 'vae' } }), /allowed category/);
  } finally { globalThis.fetch = original; }
});

