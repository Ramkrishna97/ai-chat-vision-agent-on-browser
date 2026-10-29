import { setTimeout as delay } from 'node:timers/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, access, readdir } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';

const defaultUrl = 'http://127.0.0.1:1234';
let imageServerProcess;
let activeServerUrl = process.env.SD_SERVER_URL || defaultUrl;
let installation;
const engineRoot = () => resolve(process.env.SD_SERVER_DIR || join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'LiteChat', 'stable-diffusion.cpp'));
async function runTar(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('tar', args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolveRun(output) : reject(new Error(`Could not unpack the image engine: ${output.slice(-500)}`)));
  });
}
async function findExecutableUnder(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isFile() && entry.name === 'sd-server.exe') return path;
    if (entry.isDirectory()) { const found = await findExecutableUnder(path); if (found) return found; }
  }
  return '';
}
async function installImageEngine() {
  if (process.platform !== 'win32') throw new Error('Automatic image-engine installation currently supports Windows.');
  if (installation) return installation;
  installation = (async () => {
    const response = await fetch('https://api.github.com/repos/leejet/stable-diffusion.cpp/releases/latest', { headers: { 'User-Agent': 'LiteChat' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Could not check image-engine releases (${response.status}).`);
    const release = await response.json();
    const asset = release.assets?.find(item => /^sd-.*-bin-win-cpu-x64\.zip$/i.test(item.name));
    if (!asset?.browser_download_url || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest || '')) throw new Error('The latest Windows CPU release has no verifiable archive.');
    const root = engineRoot();
    const staging = `${root}.install-${randomUUID()}`;
    const archive = `${staging}.zip`;
    await mkdir(staging, { recursive: true });
    try {
      const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(180000) });
      if (!download.ok) throw new Error(`Could not download the image engine (${download.status}).`);
      const hash = createHash('sha256');
      await pipeline(Readable.fromWeb(download.body), new Transform({ transform(chunk, _, done) { hash.update(chunk); done(null, chunk); } }), createWriteStream(archive, { flags: 'wx' }));
      if (hash.digest('hex').toLowerCase() !== asset.digest.slice(7).toLowerCase()) throw new Error('Image-engine download checksum mismatch.');
      const entries = (await runTar(['-tf', archive])).split(/\r?\n/).filter(Boolean);
      if (entries.some(name => name.startsWith('/') || name.startsWith('\\') || name.split(/[\\/]/).includes('..'))) throw new Error('Image-engine archive contains an unsafe path.');
      await runTar(['-xf', archive, '-C', staging]);
      const executable = await findExecutableUnder(staging);
      if (!executable) throw new Error('The Windows release did not contain sd-server.exe.');
      await mkdir(root, { recursive: true });
      await rename(dirname(executable), join(root, 'managed'));
      return join(root, 'managed', 'sd-server.exe');
    } finally { await rm(archive, { force: true }).catch(() => {}); await rm(staging, { recursive: true, force: true }).catch(() => {}); }
  })().finally(() => { installation = undefined; });
  return installation;
}
async function availableImagePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolvePort(port));
    });
  });
}
export const imageModelId = 'sd-cpp-local';
export const imageModelsRoot = () => resolve(process.env.SD_MODEL_DIR || join(process.env.LOCALAPPDATA || process.env.HOME || process.cwd(), 'LiteChat', 'image-models'));

export async function imageEngineStatus() {
  try {
    const status = await request('/sdcpp/v1/models/status');
    if (!['empty', 'loading', 'ready', 'error'].includes(status.state)) throw new Error('This port is not a stable-diffusion.cpp image engine.');
    return { running: true, modelDir: imageModelsRoot(), status };
  }
  catch { return { running: false, modelDir: imageModelsRoot(), executable: await findImageServer() }; }
}

async function findImageServer() {
  const root = engineRoot();
  const candidates = [process.env.SD_SERVER_EXE, join(root, 'managed', 'sd-server.exe'), join(root, 'sd-server.exe'), join(process.cwd(), 'sd-server.exe')].filter(Boolean);
  for (const file of candidates) { try { await access(file); return file; } catch {} }
  return '';
}

export async function startImageEngine() {
  if ((await imageEngineStatus()).running) return imageEngineStatus();
  if (imageServerProcess && imageServerProcess.exitCode === null) throw new Error('The image engine is still starting. Retry in a few seconds.');
  const executable = await findImageServer() || await installImageEngine();
  await mkdir(imageModelsRoot(), { recursive: true });
  const port = process.env.SD_SERVER_URL ? Number(new URL(process.env.SD_SERVER_URL).port || 80) : await availableImagePort();
  activeServerUrl = `http://127.0.0.1:${port}`;
  imageServerProcess = spawn(executable, ['--model-dir', imageModelsRoot(), '--listen-ip', '127.0.0.1', '--listen-port', String(port)], { cwd: dirname(executable), windowsHide: true, detached: false, stdio: 'ignore' });
  const child = imageServerProcess;
  child.unref();
  child.on('error', () => { if (imageServerProcess === child) imageServerProcess = undefined; });
  child.on('exit', () => { if (imageServerProcess === child) imageServerProcess = undefined; });
  for (let i = 0; i < 30; i++) {
    const status = await imageEngineStatus();
    if (status.running) return status;
    if (child.exitCode !== null) throw new Error('The image engine exited before becoming ready. Check that the release includes its required DLL files.');
    await delay(1000);
  }
  throw new Error(`stable-diffusion.cpp started but did not become ready at ${activeServerUrl}.`);
}

async function imageCatalog(refresh = false) {
  if (refresh) await request('/sdcpp/v1/models/refresh', {});
  const [recipes, files, status] = await Promise.all([request('/sdcpp/v1/recipes'), request('/sdcpp/v1/model-files'), request('/sdcpp/v1/models/status')]);
  return { recipes: recipes.recipes || [], files: files.files || [], status, errors: [...(recipes.errors || []), ...(files.errors || [])] };
}

export async function getImageModelOptions(refresh = false) {
  const catalog = await imageCatalog(refresh);
  if (!catalog.recipes.length) throw new Error('The local diffusion server reported no image recipes. Install a recent stable-diffusion.cpp sd-server release with model management support, then retry.');
  return { ...catalog, modelDir: imageModelsRoot() };
}

function slotCategories(slot) {
  return Array.isArray(slot.categories) && slot.categories.length ? slot.categories : slot.category ? [slot.category] : [];
}

export async function saveImageModelFile(stream, { name, category }) {
  const { recipes } = await imageCatalog();
  const categories = new Set(recipes.flatMap(recipe => (recipe.slots || []).flatMap(slotCategories)));
  if (typeof category !== 'string' || !categories.has(category) || !/^[a-z][a-z0-9_]*$/.test(category)) throw new Error('Choose a valid image model component.');
  const filename = decodeURIComponent(String(name || ''));
  if (!filename || filename !== basename(filename) || /[\\/:*?"<>|\x00-\x1f]/.test(filename) || !/\.[A-Za-z0-9]{1,12}$/.test(filename)) throw new Error('Invalid image model filename.');
  const directory = join(imageModelsRoot(), category);
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `.${randomUUID()}.upload`);
  let bytes = 0;
  const limit = 25 * 1024 ** 3;
  const bound = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > limit ? new Error('Image model file exceeds the 25 GB upload limit.') : null, chunk);
  } });
  try {
    await pipeline(stream, bound, createWriteStream(temporary, { flags: 'wx' }));
    if (!bytes) throw new Error('The selected model file is empty.');
    await rename(temporary, join(directory, filename));
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return { name: filename, category, bytes };
}

function baseUrl() {
  return activeServerUrl.replace(/\/$/, '');
}

async function request(path, body, signal) {
  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal || AbortSignal.timeout(path.endsWith('/status') ? 2000 : path.endsWith('/models/load') ? 16 * 60_000 : 300000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError') throw new Error('The stable-diffusion.cpp image server did not respond.');
    throw new Error(`Cannot reach the stable-diffusion.cpp image server at ${baseUrl()}: ${error.message}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Image server returned ${response.status}.`);
  return data;
}

export async function listImageModels() {
  const status = await request('/sdcpp/v1/models/status');
  if (status.state !== 'ready') return [];
  const capabilities = await request('/sdcpp/v1/capabilities').catch(() => null);
  if (!capabilities?.supported_modes?.includes('img_gen')) return [];
  return [{
    id: imageModelId,
    name: capabilities.model?.name || (status.recipe ? `Image: ${status.recipe}` : 'Image: stable-diffusion.cpp'),
    source: 'sdcpp',
    context: null,
    capabilities: { chat: false, vision: false, audio: false, tools: false, thinking: false, imageGeneration: true, file: false },
  }];
}

export async function generateLocalImage({ model, prompt }, signal) {
  if (model !== imageModelId) throw new Error('Select the loaded stable-diffusion.cpp image model.');
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('Enter an image prompt.');
  const submitted = await request('/sdcpp/v1/img_gen', { prompt, batch_count: 1, output_format: 'png' }, signal);
  if (typeof submitted.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(submitted.id)) throw new Error('The image server returned an invalid job ID.');
  const jobPath = `/sdcpp/v1/jobs/${submitted.id}`;
  const cancel = () => { void request(`${jobPath}/cancel`, {}).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    if (signal?.aborted) { cancel(); throw new Error('Image generation stopped.'); }
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      const job = await request(jobPath, undefined, signal);
      if (job.status === 'completed') {
        const image = job.result?.images?.[0]?.b64_json;
        if (!image) throw new Error('The image server completed without an image.');
        return { images: [image] };
      }
      if (job.status === 'failed' || job.status === 'cancelled') throw new Error(job.error?.message || `Image generation ${job.status}.`);
      await delay(1000, undefined, { signal });
    }
    cancel();
    throw new Error('Image generation timed out after 15 minutes.');
  } finally { signal?.removeEventListener('abort', cancel); }
}

export async function checkLocalImageModel() {
  const status = await request('/sdcpp/v1/models/status');
  if (status.state !== 'ready') throw new Error('Load an image model in stable-diffusion.cpp first, then refresh models in Lite Chat.');
  const capabilities = await request('/sdcpp/v1/capabilities');
  if (!capabilities.supported_modes?.includes('img_gen')) throw new Error('The loaded local model does not advertise image generation.');
  return { ready: true };
}

export async function unloadLocalImageModel() {
  return request('/sdcpp/v1/models/unload', {});
}

export async function loadImageModel({ recipeId, models }) {
  const catalog = await imageCatalog(true);
  const recipe = catalog.recipes.find(item => item.id === recipeId);
  if (!recipe) throw new Error('The selected image recipe is unavailable. Refresh the image model list.');
  if (!models || typeof models !== 'object' || Array.isArray(models)) throw new Error('Choose image model files for this recipe.');
  const selected = {};
  for (const slot of recipe.slots || []) {
    const fileId = models[slot.id];
    if (!fileId) continue;
    const file = catalog.files.find(item => item.id === fileId);
    if (!file || !slotCategories(slot).includes(file.category)) throw new Error(`${slot.label || slot.id} must use a file from its allowed category.`);
    selected[slot.id] = fileId;
  }
  if (Object.keys(models).some(key => !(recipe.slots || []).some(slot => slot.id === key))) throw new Error('An unknown image model slot was selected.');
  const missing = (recipe.slots || []).filter(slot => slot.required && !selected[slot.id]).map(slot => slot.label || slot.id);
  for (const group of recipe.required_any || []) if (!group.some(slotId => selected[slotId])) missing.push(`one of ${group.map(slotId => recipe.slots.find(slot => slot.id === slotId)?.label || slotId).join(' or ')}`);
  if (missing.length) return { missing, modelDir: imageModelsRoot() };
  const status = await request('/sdcpp/v1/models/load', { recipe: recipeId, models: selected });
  if (status.state !== 'ready') throw new Error(status.error || 'The image model did not finish loading.');
  const capabilities = await request('/sdcpp/v1/capabilities');
  return { ready: true, imageGeneration: capabilities.supported_modes?.includes('img_gen') || false, supportedModes: capabilities.supported_modes || [], modelDir: imageModelsRoot(), recipe: recipeId };
}
