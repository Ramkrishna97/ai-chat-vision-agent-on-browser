import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedImageFiles, suggestedImageRecipe } from '../src/imageSelection.js';

test('image setup identifies a recipe from the selected diffusion file without a hardcoded model list', () => {
  const catalog = { recipes: [
    { id: 'other-image', name: 'Other Image' },
    { id: 'qwen-image-2.1', name: 'Qwen Image 2.1' },
    { id: 'qwen-image-2.1-turbo', name: 'Qwen Image 2.1 Turbo' },
  ], files: [] };
  assert.equal(suggestedImageRecipe(catalog, [{ name: 'qwen-image-2.1-UC-Q4_K_M.gguf' }]), 'qwen-image-2.1');
  assert.equal(suggestedImageRecipe(catalog), '');
});

test('image setup only fills unambiguous component slots', () => {
  const recipe = { slots: [
    { id: 'diffusion', required: true, categories: ['diffusion_models'] },
    { id: 'encoder', required: true, categories: ['text_encoders'] },
    { id: 'projector', categories: ['text_encoders'] },
    { id: 'vae', categories: ['vae'] },
  ] };
  const catalog = { files: [
    { id: 'diffusion.gguf', category: 'diffusion_models' },
    { id: 'encoder.gguf', category: 'text_encoders' },
    { id: 'vae.safetensors', category: 'vae' },
  ] };
  assert.deepEqual(suggestedImageFiles(recipe, catalog), { diffusion: 'existing:diffusion.gguf', vae: 'existing:vae.safetensors' });
});
