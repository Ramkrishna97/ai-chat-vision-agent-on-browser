import { Wllama } from '@wllama/wllama';
import wasmUrl from '../node_modules/@wllama/wllama/esm/wasm/wllama.wasm?url';
import { ggufInfo } from './ggufKind.js';

let runtime;
let model;
let selectedFiles;
let selectedContext;

function readableError(error) {
  if (error?.name === 'NotReadableError' || /File read failed|NotReadableError/i.test(String(error?.message))) {
    return new Error('The browser lost access to the GGUF file. Keep the file on local storage, close programs moving or syncing it, then choose the GGUF file again.');
  }
  return error;
}

export async function validateGguf(files) {
  if (!files.length || files.some(file => !file.name.toLowerCase().endsWith('.gguf'))) throw new Error('Choose GGUF model files. Add the matching mmproj GGUF for vision.');
  for (const file of files) {
    let magic;
    try { magic = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()); }
    catch (error) { throw readableError(error); }
    if (magic !== 'GGUF') throw new Error(`${file.name} is not a valid GGUF file.`);
  }
}

export async function loadGguf(files, context = 2048) {
  await validateGguf(files);
  const fileInfo = await Promise.all(files.map(ggufInfo));
  if (fileInfo.every(item => item.complete && !item.hasTokenizer)) throw new Error('This GGUF has no text tokenizer, so the browser chat runtime cannot use it. If it is an image model, choose Load image model and a compatible local diffusion recipe.');
  await unloadGguf(true);
  const nextRuntime = new Wllama({ default: wasmUrl });
  try { await nextRuntime.loadModel(files, { n_ctx: context, n_threads: 1, jinja: true }); }
  catch (error) { await nextRuntime.exit().catch(() => {}); throw readableError(error); }
  runtime = nextRuntime;
  selectedFiles = files;
  selectedContext = context;
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
export function isGgufLoaded() { return !!runtime; }
export async function resumeGguf() {
  if (runtime) return model;
  if (!selectedFiles) throw new Error('Choose the GGUF file again to load it.');
  return loadGguf(selectedFiles, selectedContext);
}

export async function ggufChat(messages, settings, signal, tools, onUpdate) {
  if (!runtime) throw new Error('Load a GGUF model first.');
  try {
  if (onUpdate) {
    const stream = await runtime.createChatCompletion({
      messages, max_tokens: settings.maxTokens, temperature: settings.temperature,
      chat_template_kwargs: { enable_thinking: settings.thinking },
      tools, abortSignal: signal, stream: true,
    });
    let content = ''; let thinking = ''; const toolCalls = [];
    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta || {};
      content += delta.content || '';
      thinking += delta.reasoning_content || delta.thinking || '';
      for (const call of delta.tool_calls || []) {
        const index = call.index ?? toolCalls.length;
        const previous = toolCalls[index] || { id: call.id, type: 'function', function: { name: '', arguments: '' } };
        if (call.id) previous.id = call.id;
        previous.function.name += call.function?.name || '';
        previous.function.arguments += call.function?.arguments || '';
        toolCalls[index] = previous;
      }
      onUpdate({ content, thinking });
    }
    return { role: 'assistant', content, thinking, ...(toolCalls.length ? { tool_calls: toolCalls.filter(Boolean) } : {}) };
  }
  const response = await runtime.createChatCompletion({
    messages, max_tokens: settings.maxTokens, temperature: settings.temperature,
    chat_template_kwargs: { enable_thinking: settings.thinking },
    tools, abortSignal: signal,
  });
  return response.choices?.[0]?.message || { content: '' };
  } catch (error) {
    if (/File read failed|NotReadableError/i.test(String(error?.message)) || error?.name === 'NotReadableError') await unloadGguf(true).catch(() => {});
    throw readableError(error);
  }
}

export async function unloadGguf(forget = false) {
  const previous = runtime;
  runtime = undefined;
  if (forget) { model = undefined; selectedFiles = undefined; selectedContext = undefined; }
  if (previous) await previous.exit().catch(() => {});
}
