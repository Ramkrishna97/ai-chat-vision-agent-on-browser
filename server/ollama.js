const ollamaBase = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

async function request(path, body, signal) {
  const response = await fetch(`${ollamaBase}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
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
  const local = (tags.models || []).filter(summary => !summary.remote_model && !summary.remote_host && !String(summary.name).endsWith(':cloud'));
  const models = await Promise.all(local.map(async summary => {
    try { return normalizeModel(summary, await request('/api/show', { model: summary.name }, signal)); }
    catch { return normalizeModel(summary, {}); }
  }));
  return models.filter(model => model.capabilities.chat || model.capabilities.imageGeneration)
    .sort((a, b) => (a.size || Infinity) - (b.size || Infinity));
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
