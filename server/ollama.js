const ollamaBase = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function request(path, body, signal) {
  const timeoutMs = path === '/api/tags' || path === '/api/show' || body?.keep_alive === 0 ? 10000 : body?.prompt === '' ? 120000 : 300000;
  const response = await fetch(`${ollamaBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(timeoutMs),
  }).catch(error => {
    if (error.name === 'TimeoutError') throw new Error('Ollama did not respond. Check that it is running.');
    throw error;
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Ollama returned ${response.status}.`);
  return data;
}

export function normalizeModel(summary, details) {
  const raw = new Set(details.capabilities || summary.capabilities || []);
  const architecture = details.model_info?.['general.architecture'];
  const context = details.model_info?.[`${architecture}.context_length`] || null;
  return {
    id: summary.name || summary.model,
    name: summary.name || summary.model,
    source: 'ollama',
    size: summary.size || 0,
    context,
    reportedCapabilities: [...raw],
    capabilities: {
      chat: raw.has('completion') || raw.has('chat'),
      vision: raw.has('vision'),
      audio: raw.has('audio'),
      tools: raw.has('tools'),
      thinking: raw.has('thinking'),
      imageGeneration: raw.has('image'),
      file: raw.has('completion') || raw.has('chat'),
    },
  };
}

export async function listModels(signal) {
  const tags = await request('/api/tags', undefined, signal);
  const local = (tags.models || []).filter(summary => !summary.remote_model && !summary.remote_host && !/cloud$/i.test(String(summary.name || summary.model)));
  const models = [];
  for (let index = 0; index < local.length; index += 4) {
    models.push(...await Promise.all(local.slice(index, index + 4).map(async summary => {
      try { return normalizeModel(summary, await request('/api/show', { model: summary.name || summary.model }, signal)); }
      catch { return normalizeModel(summary, {}); }
    })));
  }
  return models.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

export function ollamaChat(body, signal) {
  return request('/api/chat', {
    model: body.model,
    messages: body.messages,
    stream: false,
    tools: body.tools,
    think: body.think,
    options: { num_ctx: body.context, num_predict: body.maxTokens, temperature: body.temperature },
  }, signal);
}

export function ollamaImage(body, signal) {
  return request('/api/generate', { model: body.model, prompt: body.prompt, stream: false }, signal);
}

export function ollamaStart(body, signal) {
  return request('/api/generate', { model: body.model, prompt: '', stream: false, keep_alive: -1 }, signal);
}

export function ollamaStop(body, signal) {
  return request('/api/generate', { model: body.model, prompt: '', stream: false, keep_alive: 0 }, signal);
}

export async function ollamaChatStream(body, signal) {
  const response = await fetch(`${ollamaBase}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({
      model: body.model, messages: body.messages, stream: true,
      think: body.think, tools: body.tools,
      options: { num_ctx: body.context, num_predict: body.maxTokens, temperature: body.temperature },
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Ollama returned ${response.status}.`);
  }
  return response;
}
