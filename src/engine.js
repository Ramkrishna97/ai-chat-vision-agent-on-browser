import { ggufChat, resumeGguf, unloadGguf } from './localModels.js';

function bridgeBase(settings) {
  const configured = settings.bridgeUrl.replace(/\/$/, '');
  if (/^http:\/\/(?:localhost|127\.0\.0\.1):5173$/.test(location.origin) && /^http:\/\/(?:localhost|127\.0\.0\.1):3210$/.test(configured)) return `${location.origin}/local-bridge`;
  return configured;
}

export function splitThought(content = '', thinking = '') {
  let visible = ''; let hidden = thinking; let rest = content;
  while (rest) {
    const start = rest.indexOf('<think>');
    if (start < 0) { visible += rest; break; }
    visible += rest.slice(0, start);
    rest = rest.slice(start + 7);
    const end = rest.indexOf('</think>');
    if (end < 0) { hidden += rest; break; }
    hidden += rest.slice(0, end);
    rest = rest.slice(end + 8);
  }
  return { content: visible, thinking: hidden };
}

export function bridgeError(error, settings) {
  if (error?.name === 'TimeoutError') return new Error(`The local bridge at ${settings.bridgeUrl} did not answer the browser. Check browser local-network permission, firewall access, and the bridge URL in Settings.`);
  if (error instanceof TypeError) return new Error(`Cannot reach the local bridge at ${settings.bridgeUrl}. Start it on this device; for a deployed site, set APP_ORIGIN to this site's HTTPS origin and allow browser local-network access. A phone cannot use your PC's 127.0.0.1 address.`);
  return error;
}

export async function bridge(path, settings, body, signal) {
  const response = await fetch(`${bridgeBase(settings)}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': settings.bridgeToken },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal || AbortSignal.timeout(path === '/models' ? 15000 : 300000),
  }).catch(error => { throw bridgeError(error, settings); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 403 ? `This site's origin is not allowed by the local bridge. Start the bridge with APP_ORIGIN=${location.origin}.` : data.error || `Local bridge returned ${response.status}.`);
  return data;
}

export async function discoverOllama(settings) {
  return (await bridge('/models', settings)).models;
}

export async function pairLocalBridge(settings) {
  if (!/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(location.origin) || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+\/?$/.test(settings.bridgeUrl)) return settings;
  try {
    const response = await fetch(`${bridgeBase(settings)}/pair-local`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return settings;
    const data = await response.json();
    return data.token ? { ...settings, bridgeToken: data.token } : settings;
  } catch { return settings; }
}

export async function offloadModel(model, settings) {
  if (!model) return;
  if (model.source === 'gguf') return unloadGguf();
  return bridge('/stop', settings, { model: model.id });
}

export async function activateModel(model, settings) {
  if (model.source === 'gguf') return resumeGguf();
  return bridge('/start', settings, { model: model.id });
}

async function streamOllama(body, settings, signal, onUpdate) {
  const response = await fetch(`${bridgeBase(settings)}/chat-stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bridge-Token': settings.bridgeToken },
    body: JSON.stringify(body), signal,
  }).catch(error => { throw bridgeError(error, settings); });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Local bridge returned ${response.status}.`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = ''; let content = ''; let thinking = ''; const toolCalls = [];
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    if (done && buffer.trim()) lines.push(buffer);
    for (const line of lines) {
      if (!line.trim()) continue;
      const part = JSON.parse(line);
      if (part.error) throw new Error(part.error);
      content += part.message?.content || '';
      thinking += part.message?.thinking || '';
      if (part.message?.tool_calls) toolCalls.push(...part.message.tool_calls);
      onUpdate(splitThought(content, thinking));
    }
    if (done) break;
  }
  return { role: 'assistant', ...splitThought(content, thinking), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}

export async function complete(model, messages, settings, signal, tools, onUpdate) {
  if (model.source === 'gguf') {
    const answer = await ggufChat(messages, settings, signal, tools, onUpdate && (update => onUpdate(splitThought(update.content, update.thinking))));
    return { ...answer, ...splitThought(answer.content, answer.thinking || answer.reasoning_content) };
  }
  if (onUpdate) return streamOllama({
    model: model.id, messages, tools, think: model.capabilities.thinking ? settings.thinking : false,
    context: settings.context, maxTokens: settings.maxTokens, temperature: settings.temperature,
  }, settings, signal, onUpdate);
  const result = await bridge('/chat', settings, {
    model: model.id, messages, tools,
    think: model.capabilities.thinking ? settings.thinking : false,
    context: settings.context,
    maxTokens: settings.maxTokens,
    temperature: settings.temperature,
  }, signal);
  const answer = result.message || { content: '' };
  return { ...answer, ...splitThought(answer.content, answer.thinking) };
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
  description: 'Run a command in the local workspace. Use it to inspect, build, and test. On Windows the default shell is PowerShell. Use write_file to create source files.',
  parameters: { type: 'object', properties: {
    command: { type: 'string', description: 'Shell command to execute.' },
    cwd: { type: 'string', description: 'Working directory relative to the configured workspace.' },
    shell: { type: 'string', enum: ['cmd', 'powershell'], description: 'Shell to use on Windows.' },
  }, required: ['command'] },
} }, { type: 'function', function: {
  name: 'write_file',
  description: 'Write a complete UTF-8 text file in the local workspace in one call. Use this for source code. The path must be relative to the workspace.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'Relative file path, e.g. src/TimeUntilMidnight.java.' },
    content: { type: 'string', description: 'The entire file content.' },
  }, required: ['path', 'content'] },
} }, { type: 'function', function: {
  name: 'run_java',
  description: 'Compile and run a Java source file created in the workspace. Use this to verify Java apps; it reports compiler errors and program output.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'Java source path relative to the workspace, e.g. src/TimeUntilMidnight.java.' },
    input: { type: 'string', description: 'Optional standard input for interactive programs.' },
  }, required: ['path'] },
} }];

export async function runAgent(model, userText, history, settings, signal, onStep) {
  if (!model.capabilities.tools) throw new Error('This model does not advertise tool use.');
  if (!settings.bridgeToken) throw new Error('Pair the local bridge in Settings before using Agent mode.');
  const messages = [
    { role: 'system', content: 'You are a local coding agent. First write a concise plan. Use write_file to create complete source files and run_command to inspect, build, and test. For Java files use run_java to compile and run the source; write_file also runs Java files automatically so you can see and fix compiler/runtime errors. On Windows, run_command uses PowerShell by default. Never use Unix heredocs such as cat <<EOF or one echo command per source line. Inspect each tool result before proceeding. Finish with a clear summary of changes and test results. Never claim a command succeeded unless its output confirms it.' },
    ...history,
    { role: 'user', content: userText },
  ];
  const plan = await complete(model, [
    { role: 'system', content: 'Write a short numbered plan for the user task. Do not call tools yet.' },
    { role: 'user', content: userText },
  ], settings, signal, undefined, update => onStep({ kind: 'plan', text: update.content || update.thinking || 'Planning…', live: true, replace: true }));
  onStep({ kind: 'plan', text: plan.content || plan.thinking || 'Plan ready.', live: false, replace: true });
  let toolsUsed = 0;
  let retryNeeded = 0;
  let javaStatus;
  for (let i = 0; i < 30; i++) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const reply = await complete(model, messages, settings, signal, commandTool, update => {
      const text = [update.thinking, update.content].filter(Boolean).join('\n\n');
      if (text) onStep({ kind: 'thought', text, live: true, replace: true });
    });
    messages.push(reply);
    if (reply.content || reply.thinking) onStep({ kind: 'thought', text: [reply.thinking, reply.content].filter(Boolean).join('\n\n'), live: false, replace: true });
    if (!reply.tool_calls?.length) {
      if ((!toolsUsed || (javaStatus && javaStatus.exitCode !== 0)) && retryNeeded++ < 2) {
        messages.push({ role: 'user', content: javaStatus && javaStatus.exitCode !== 0 ? 'The Java app did not compile or run successfully. Correct the source and run it again with the tools.' : 'You have not created or tested any files yet. Use the available tools before giving a final answer.' });
        continue;
      }
      if (javaStatus && javaStatus.exitCode !== 0) return `Java run failed. Review the tool result above.\n${javaStatus.output}`;
      if (!toolsUsed) return 'The model did not use the available tools, so no files were created or run.';
      return reply.content || 'Task finished.';
    }
    for (const call of reply.tool_calls) {
      if (!['run_command', 'write_file', 'run_java'].includes(call.function?.name)) continue;
      toolsUsed++;
      let args;
      try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments; }
      catch { args = {}; }
      if (!args || typeof args !== 'object') args = {};
      if (call.function.name === 'run_command' && (typeof args.cwd !== 'string' || args.cwd.startsWith('/') || /^[A-Za-z]:/.test(args.cwd) || args.cwd.split(/[\\/]/).includes('..'))) args.cwd = '.';
      onStep({ kind: 'command', text: call.function.name === 'write_file' ? `Write ${args.path || '(invalid path)'}` : call.function.name === 'run_java' ? `Compile and run ${args.path || '(invalid path)'}` : args.command || '(invalid command)' });
      let output;
      try { output = await bridge(call.function.name === 'write_file' ? '/write-file' : call.function.name === 'run_java' ? '/run-java' : '/exec', settings, args, signal); }
      catch (error) { output = { exitCode: -1, output: error.message }; }
      if (call.function.name !== 'run_java' && output.path?.toLowerCase().endsWith('.java')) {
        try { output.javaCheck = await bridge('/run-java', settings, { path: output.path }, signal); }
        catch (error) { output.javaCheck = { exitCode: -1, output: error.message }; }
      }
      if (call.function.name === 'run_java') javaStatus = output;
      else if (output.javaCheck) javaStatus = output.javaCheck;
      onStep({ kind: 'result', text: output.bytes !== undefined ? `Wrote ${output.path} (${output.bytes} bytes)${output.javaCheck ? `\nJava check: ${output.javaCheck.output}` : ''}` : `Exit ${output.exitCode}\n${output.output}${output.javaCheck ? `\nJava check: ${output.javaCheck.output}` : ''}` });
      messages.push(model.source === 'gguf'
        ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) }
        : { role: 'tool', content: JSON.stringify(output) });
    }
  }
  return 'Stopped after 30 tool rounds. Review the steps above before continuing.';
}
