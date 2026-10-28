import wasmUrl from '../node_modules/@wllama/wllama/esm/wasm/wllama.wasm?url';

let runtime;
let model;

export async function loadGguf(files, context = 2048) {
  if (!files.length || files.some(file => !file.name.toLowerCase().endsWith('.gguf'))) throw new Error('Choose GGUF model files. Add the matching mmproj GGUF for vision.');
  if (runtime) await runtime.exit();
  const { Wllama } = await import('@wllama/wllama');
  runtime = new Wllama({ default: wasmUrl });
  await runtime.loadModel(files, { n_ctx: context, n_threads: 1, jinja: true });
  const metadata = runtime.getModelMetadata().meta || {};
  const architecture = metadata['general.architecture'];
  model = {
    id: `gguf:${files.map(file => file.name).join('+')}`,
    name: metadata['general.name'] || files[0].name,
    source: 'gguf',
    context: Number(metadata[`${architecture}.context_length`]) || context,
    capabilities: {
      chat: true,
      vision: runtime.supportInputModality('image'),
      audio: runtime.supportInputModality('audio'),
      file: true,
      tools: !!runtime.getChatTemplate() && /tool/i.test(runtime.getChatTemplate()),
      thinking: /think/i.test(runtime.getChatTemplate() || ''),
      imageGeneration: false,
    },
  };
  return model;
}

export function getGgufModel() { return model; }

export async function ggufChat(messages, settings, signal, tools) {
  if (!runtime) throw new Error('Load a GGUF model first.');
  const response = await runtime.createChatCompletion({
    messages, max_tokens: settings.maxTokens, temperature: settings.temperature,
    chat_template_kwargs: { enable_thinking: settings.thinking },
    tools, abortSignal: signal,
  });
  return response.choices?.[0]?.message || { content: '' };
}

export async function unloadGguf() {
  if (runtime) await runtime.exit();
  runtime = undefined;
  model = undefined;
}
