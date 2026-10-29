import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('paired bridge discovers and generates from a local image server without Ollama models', async () => {
  const paths = [];
  const modelDir = await mkdtemp(join(tmpdir(), 'lite-image-bridge-'));
  const imageServer = http.createServer(async (req, res) => {
    paths.push(req.url);
    let body = '';
    for await (const chunk of req) body += chunk;
    let data = {};
    if (req.url === '/api/tags') data = { models: [] };
    else if (req.url === '/sdcpp/v1/model-files') data = { files: [
      { id: 'diffusion_models/qwen-image-2.1-UC-Q4_K_M.gguf', name: 'qwen-image-2.1-UC-Q4_K_M.gguf', category: 'diffusion_models' },
      { id: 'text_encoders/Qwen3VL-8B-Instruct-Q4_K_M.gguf', name: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf', category: 'text_encoders' },
      { id: 'vae/qwen_image_2.1_vae_bf16.safetensors', name: 'qwen_image_2.1_vae_bf16.safetensors', category: 'vae' },
    ] };
    else if (req.url === '/sdcpp/v1/recipes') data = { recipes: [{ id: 'qwen-image-21', slots: [
      { id: 'diffusion_model', required: true, categories: ['diffusion_models'] },
      { id: 'llm', required: true, categories: ['text_encoders'] },
      { id: 'vae', required: true, categories: ['vae'] },
    ] }] };
    else if (req.url === '/sdcpp/v1/models/load') data = { state: 'ready', recipe: 'qwen-image-21' };
    else if (req.url === '/sdcpp/v1/models/status') data = { state: 'ready', recipe: 'z-image-turbo' };
    else if (req.url === '/sdcpp/v1/capabilities') data = { supported_modes: ['img_gen'], model: { name: 'Local image model' } };
    else if (req.url === '/sdcpp/v1/img_gen') {
      assert.equal(JSON.parse(body).prompt, 'A tree');
      data = { id: 'job_test', status: 'queued' };
    } else if (req.url === '/sdcpp/v1/jobs/job_test') data = { status: 'completed', result: { images: [{ b64_json: 'iVBORw0KGgo=' }] } };
    else if (req.url === '/sdcpp/v1/models/unload') data = { state: 'empty' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  const imagePort = await listen(imageServer);
  const reservation = http.createServer();
  const bridgePort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ['server/bridge.js'], {
    cwd: process.cwd(), windowsHide: true, stdio: 'ignore',
    env: { ...process.env, BRIDGE_PORT: String(bridgePort), BRIDGE_TOKEN: 'test-image-token', SD_SERVER_URL: `http://127.0.0.1:${imagePort}`, SD_MODEL_DIR: modelDir, OLLAMA_URL: `http://127.0.0.1:${imagePort}` },
  });
  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  const call = (path, body) => fetch(bridgeUrl + path, { method: body ? 'POST' : 'GET', headers: { 'X-Bridge-Token': 'test-image-token', 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) }).then(async response => {
    const text = await response.text();
    assert.equal(response.status, 200, `${path}: ${text}`);
    return JSON.parse(text);
  });
  try {
    let models;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { models = await call('/models'); break; } catch { await new Promise(resolve => setTimeout(resolve, 50)); }
    }
    assert.equal(models.models[0].source, 'sdcpp');
    const upload = await fetch(bridgeUrl + '/image-model-file', { method: 'POST', headers: { 'X-Bridge-Token': 'test-image-token', 'X-File-Name': 'qwen-image-2.1-UC-Q4_K_M.gguf', 'X-Model-Category': 'diffusion_models' }, body: Buffer.from('GGUF-test') });
    assert.equal(upload.status, 200);
    assert.equal((await readFile(join(modelDir, 'diffusion_models', 'qwen-image-2.1-UC-Q4_K_M.gguf'))).toString(), 'GGUF-test');
    assert.equal((await call('/image-model-options')).recipes[0].id, 'qwen-image-21');
    assert.equal((await call('/image-model-load', { recipeId: 'qwen-image-21', models: { diffusion_model: 'diffusion_models/qwen-image-2.1-UC-Q4_K_M.gguf', llm: 'text_encoders/Qwen3VL-8B-Instruct-Q4_K_M.gguf', vae: 'vae/qwen_image_2.1_vae_bf16.safetensors' } })).ready, true);
    assert.ok(paths.includes('/sdcpp/v1/models/load'));
    const result = await call('/image', { source: 'sdcpp', model: 'sd-cpp-local', prompt: 'A tree' });
    assert.equal(result.images[0], 'iVBORw0KGgo=');
    await call('/stop', { source: 'sdcpp', model: 'sd-cpp-local' });
    assert.ok(paths.includes('/sdcpp/v1/models/unload'));
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit').catch(() => {}); }
    await new Promise(resolve => imageServer.close(resolve));
    await rm(modelDir, { recursive: true, force: true });
  }
});
