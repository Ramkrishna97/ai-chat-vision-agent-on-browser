import { ggufChat } from './localModels.js';

export async function bridge(path, settings, body, signal) {
  const response = await fetch(`${settings.bridgeUrl.replace(/\/$/, '')}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': settings.bridgeToken },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Local bridge returned ${response.status}.`);
  return data;
}

export async function discoverOllama(settings) {
  return (await bridge('/models', settings)).models;
}

export async function complete(model, messages, settings, signal, tools) {
  if (model.source === 'gguf') return ggufChat(messages, settings, signal, tools);
  const result = await bridge('/chat', settings, {
    model: model.id, messages, tools,
    think: model.capabilities.thinking ? settings.thinking : false,
    context: settings.context,
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
  }, signal);
  return result.message || { content: '' };
}

export async function generateImage(model, prompt, settings, signal) {
  if (model.source !== 'ollama') throw new Error('Image generation needs an Ollama image model.');
  const result = await bridge('/image', settings, { model: model.id, prompt }, signal);
  const image = result.images?.[0] || result.image;
  if (!image) throw new Error('The model did not return an image.');
  return image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
}

export const commandTool = [{ type: 'function', function: {
  name: 'run_command',
  description: 'Run a command in the local workspace. Use it to inspect files, create code, build, and test. Commands run on the user device.',
  parameters: { type: 'object', properties: {
    command: { type: 'string', description: 'Shell command to execute.' },
    cwd: { type: 'string', description: 'Working directory relative to the configured workspace.' },
    shell: { type: 'string', enum: ['cmd', 'powershell'], description: 'Shell to use on Windows.' },
  }, required: ['command'] },
} }];

export async function runAgent(model, userText, history, settings, signal, onStep) {
  if (!model.capabilities.tools) throw new Error('This model does not advertise tool use.');
  if (!settings.bridgeToken) throw new Error('Pair the local bridge in Settings before using Agent mode.');
  const messages = [
    { role: 'system', content: 'You are a local coding agent. First write a concise plan. Then use run_command to inspect, implement, run, and test the task one step at a time. After each command inspect its result. Finish with a clear summary of changes and test results. Never claim a command succeeded unless its output confirms it.' },
    ...history,
    { role: 'user', content: userText },
  ];
  const plan = await complete(model, [
    { role: 'system', content: 'Write a short numbered plan for the user task. Do not call tools yet.' },
    { role: 'user', content: userText },
  ], settings, signal);
  onStep({ kind: 'plan', text: plan.content || 'Plan ready.' });
  for (let i = 0; i < 12; i++) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const reply = await complete(model, messages, settings, signal, commandTool);
    messages.push(reply);
    if (reply.content) onStep({ kind: 'thought', text: reply.content });
    if (!reply.tool_calls?.length) return reply.content || 'Task finished.';
    for (const call of reply.tool_calls) {
      if (call.function?.name !== 'run_command') continue;
      let args;
      try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments; }
      catch { args = { command: '' }; }
      if (!args || typeof args !== 'object') args = { command: '' };
      if (typeof args.cwd !== 'string' || args.cwd.startsWith('/') || /^[A-Za-z]:/.test(args.cwd) || args.cwd.split(/[\\/]/).includes('..')) args.cwd = '.';
      onStep({ kind: 'command', text: args.command });
      let output;
      try { output = await bridge('/exec', settings, args, signal); }
      catch (error) { output = { exitCode: -1, output: error.message }; }
      onStep({ kind: 'result', text: `Exit ${output.exitCode}\n${output.output}` });
      messages.push(model.source === 'gguf'
        ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) }
        : { role: 'tool', content: JSON.stringify(output) });
    }
  }
  return 'Stopped after 12 command rounds. Review the steps above before continuing.';
}
