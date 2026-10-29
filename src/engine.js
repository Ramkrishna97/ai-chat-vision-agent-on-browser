import { ggufChat, resumeGguf, unloadGguf } from './localModels.js';
import { agentRunTarget } from './agentRunTarget.js';
import { textToolCalls } from './agentToolCalls.js';
import { ollamaUsage } from './contextUsage.js';
import { failingSourcePath, repairPrompt } from './agentDiagnostics.js';

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
    signal: signal || AbortSignal.timeout(path === '/models' ? 15000 : ['/image', '/image-model-load'].includes(path) ? 16 * 60_000 : 300000),
  }).catch(error => { throw bridgeError(error, settings); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(response.status === 403 ? `This site's origin is not allowed by the local bridge. Start the bridge with APP_ORIGIN=${location.origin}.` : data.error || `Local bridge returned ${response.status}.`);
  return data;
}

export async function discoverOllama(settings) {
  return (await bridge('/models', settings)).models;
}

export async function discoverImageModels(settings) {
  return bridge('/image-model-options', settings);
}

export async function imageEngineStatus(settings) { return bridge('/image-engine-status', settings); }
export async function startImageEngine(settings, signal) { return bridge('/image-engine-start', settings, {}, signal); }

export async function uploadImageModelFile(file, category, settings, signal) {
  const response = await fetch(`${bridgeBase(settings)}/image-model-file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Bridge-Token': settings.bridgeToken, 'X-File-Name': encodeURIComponent(file.name), 'X-Model-Category': category },
    body: file,
    signal,
  }).catch(error => { throw bridgeError(error, settings); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Image file upload failed (${response.status}).`);
  return data;
}

export async function loadImageModel(recipeId, models, settings, signal) {
  return bridge('/image-model-load', settings, { recipeId, models }, signal);
}

export async function discoverSkills(settings) {
  return bridge('/skills', settings);
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
  return bridge('/stop', settings, { model: model.id, source: model.source });
}

export async function activateModel(model, settings) {
  if (model.source === 'gguf') return resumeGguf();
  return bridge('/start', settings, { model: model.id, source: model.source });
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
  let buffer = ''; let content = ''; let thinking = ''; let usage = null; const toolCalls = [];
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
      usage = ollamaUsage(part) || usage;
      if (part.message?.tool_calls) toolCalls.push(...part.message.tool_calls);
      onUpdate({ ...splitThought(content, thinking), usage });
    }
    if (done) break;
  }
  return { role: 'assistant', ...splitThought(content, thinking), usage, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
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
  return { ...answer, ...splitThought(answer.content, answer.thinking), usage: ollamaUsage(result) };
}

export async function generateImage(model, prompt, settings, signal) {
  if (!['ollama', 'sdcpp'].includes(model.source)) throw new Error('Image generation needs an image model connected through the local bridge.');
  const result = await bridge('/image', settings, { model: model.id, source: model.source, prompt }, signal);
  const image = result.images?.[0] || result.image;
  if (!image) throw new Error('The model did not return an image.');
  return image.startsWith('data:') ? image : `data:image/png;base64,${image}`;
}

export const commandTool = [{ type: 'function', function: {
  name: 'list_files',
  description: 'List files in this chat workspace, skipping build caches. Use to inspect existing projects.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative directory; use . for the workspace root.' } }, required: ['path'] },
} }, { type: 'function', function: {
  name: 'read_file',
  description: 'Read a UTF-8 text file in this chat workspace. Use before editing existing code or diagnosing errors.',
  parameters: { type: 'object', properties: { path: { type: 'string', description: 'Relative path of a text file.' } }, required: ['path'] },
} }, { type: 'function', function: {
  name: 'read_skill',
  description: 'Read the full instructions for an available skill by its ID. Use a relevant skill before doing specialized work.',
  parameters: { type: 'object', properties: { id: { type: 'string', description: 'Skill ID from the available skills list.' } }, required: ['id'] },
} }, { type: 'function', function: {
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
  name: 'run_project',
  description: 'Build, test, or run a plain Java, Maven, or Gradle project, or run a Python or JavaScript file. Select a project directory or source file inside this chat workspace. Use after writing code, inspect failures, and correct them.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: 'Project directory or Java, Python, or JavaScript file relative to this chat workspace.' },
    action: { type: 'string', enum: ['build', 'test', 'run'], description: 'Use run when the task asks for a working application.' },
    mainClass: { type: 'string', description: 'Optional fully qualified Java main class when more than one exists.' },
    task: { type: 'string', description: 'Optional Maven goal or Gradle task when the project needs a custom task.' },
    args: { type: 'array', items: { type: 'string' }, description: 'Optional program arguments.' },
    input: { type: 'string', description: 'Optional standard input for interactive programs.' },
  }, required: ['path', 'action'] },
} }];

export async function runAgent(model, userText, history, settings, signal, onStep, chatId, media = []) {
  if (!model.capabilities.tools) throw new Error('This model does not advertise tool use.');
  if (!settings.bridgeToken) throw new Error('Pair the local bridge in Settings before using Agent mode.');
  const workspace = await bridge('/agent-workspace', settings, { chatId }, signal);
  onStep({ kind: 'workspace', text: workspace.path });
  const catalog = await discoverSkills(settings);
  const available = catalog.skills.filter(skill => !(settings.disabledSkills || []).includes(skill.id));
  const automatic = available.filter(skill => skill.id === 'core'
    || skill.id === 'java' && /\b(java|javac|maven|mvn|gradle|jar|spring)\b/i.test(userText)
    || skill.id === 'python' && /\b(python|\.py|pip)\b/i.test(userText)
    || skill.id === 'web' && /\b(javascript|node|npm|react|web|html|css|\.js)\b/i.test(userText)
    || skill.id === 'debug' && /\b(fix|debug|error|fail|broken|repair)\b/i.test(userText)
    || !['core', 'java', 'python', 'web', 'debug'].includes(skill.id) && new RegExp(`\\b${skill.id}\\b`, 'i').test(userText));
  const loadedSkills = await Promise.all(automatic.map(skill => bridge('/read-skill', settings, { id: skill.id }, signal)));
  if (loadedSkills.length) onStep({ kind: 'skill', text: loadedSkills.map(skill => skill.name).join(', ') });
  const requiresCode = /\b(create|build|write|make|develop|implement|generate)\b/i.test(userText) && /\b(app|program|code|script|project|file|java|python|javascript|js)\b|\.(?:java|js|mjs|cjs|py)\b/i.test(userText);
  if (model.source === 'ollama' && media.some(item => item.type === 'audio')) throw new Error('Audio agent input is available only for a compatible browser GGUF model.');
  const taskMessage = model.source === 'ollama'
    ? { role: 'user', content: userText, ...(media.length ? { images: media.filter(item => item.type === 'image').map(item => item.base64) } : {}) }
    : { role: 'user', content: media.length ? [...media.map(item => ({ type: item.type, data: item.bytes })), { type: 'text', text: userText }] : userText };
  const messages = [
    { role: 'system', content: `You are a local coding agent. Tools operate in a separate workspace for this chat. Create files relative to its root. Use write_file for whole source files, list_files and read_file to inspect, run_project to build and run, and run_command for other commands. On Windows, run_command uses PowerShell by default. Never use Unix heredocs or one echo command per source line. After creating code, actually run it and inspect the result. Fix failures and retry. Never claim success without a zero exit code. Available skills: ${available.map(skill => `${skill.id}: ${skill.description}`).join('; ')}. Use read_skill when another skill is relevant.\n\n${loadedSkills.map(skill => skill.content).join('\n\n')}` },
    ...history,
    taskMessage,
  ];
  const plan = await complete(model, [
    { role: 'system', content: 'Write a short numbered plan for the user task. Do not call tools yet.' },
    taskMessage,
  ], settings, signal, undefined, update => onStep({ kind: 'plan', text: update.content || update.thinking || 'Planning…', live: true, replace: true }));
  onStep({ kind: 'plan', text: plan.content || plan.thinking || 'Plan ready.', live: false, replace: true });
  let toolsUsed = 0;
  let retryNeeded = 0;
  let repairRetries = 0;
  let projectStatus;
  let projectFilesWritten = false;
  let projectRunSucceeded = false;
  let projectRunAttempted = false;
  const writtenPaths = [];
  async function failureFeedback(status) {
    const path = failingSourcePath(writtenPaths, status?.output);
    let source;
    if (path) {
      try { source = (await bridge('/read-file', settings, { workspaceId: workspace.id, path }, signal)).content; }
      catch { /* The compiler output is still enough to guide a retry. */ }
    }
    return repairPrompt(status, path, source);
  }
  for (let i = 0; i < 30; i++) {
    if (signal.aborted) throw new DOMException('Stopped', 'AbortError');
    const tail = messages.slice(-12);
    while (tail[0]?.role === 'tool') tail.shift();
    const recentMessages = messages.length > 18 ? [messages[0], taskMessage, ...tail] : messages;
    const reply = await complete(model, recentMessages, settings, signal, commandTool, update => {
      const text = [update.thinking, update.content].filter(Boolean).join('\n\n');
      if (text) onStep({ kind: 'thought', text, live: true, replace: true });
    });
    if (!reply.tool_calls?.length) {
      const parsedCalls = textToolCalls(reply.content, userText);
      if (parsedCalls.length) reply.tool_calls = parsedCalls;
    }
    messages.push(reply);
    if (reply.content || reply.thinking) onStep({ kind: 'thought', text: [reply.thinking, reply.content].filter(Boolean).join('\n\n'), live: false, replace: true });
    if (!reply.tool_calls?.length) {
      const target = agentRunTarget(writtenPaths) || (projectFilesWritten ? '.' : null);
      if (target && !projectRunAttempted && !projectRunSucceeded) {
        projectRunAttempted = true;
        onStep({ kind: 'command', text: `Run project ${target}` });
        try { projectStatus = await bridge('/run-project', settings, { workspaceId: workspace.id, path: target, action: 'run' }, signal); }
        catch (error) { projectStatus = { exitCode: -1, output: error.message }; }
        projectRunSucceeded = projectStatus.exitCode === 0;
        onStep({ kind: 'result', text: `Exit ${projectStatus.exitCode}\n${projectStatus.output}` });
        messages.push({ role: 'user', content: projectRunSucceeded ? `The project ran successfully. Output:\n${String(projectStatus.output || '').slice(-3000)}\nSummarize the verified result.` : await failureFeedback(projectStatus) });
        continue;
      }
      if (projectStatus && projectStatus.exitCode !== 0 && repairRetries++ < 4) {
        messages.push({ role: 'user', content: await failureFeedback(projectStatus) });
        continue;
      }
      if ((!toolsUsed || requiresCode && !projectFilesWritten || (projectFilesWritten && !projectRunSucceeded && !projectStatus)) && retryNeeded++ < 2) {
        messages.push({ role: 'user', content: projectFilesWritten ? 'You created code files but have not run the project. Call run_project with action run, inspect its output, and fix any failure.' : 'No source file has been created. An echo command is not a created program. Call write_file now. If you cannot return a native tool call, reply with only valid JSON like {"name":"write_file","arguments":{"path":"Hello.js","content":"console.log(1)"}}. Use the actual requested filename and complete source code.' });
        continue;
      }
      if (projectStatus && projectStatus.exitCode !== 0) return `Project run failed. Review the tool result above.\n${projectStatus.output}`;
      if (requiresCode && !projectFilesWritten) return 'The model did not create a source file, so the requested code could not be tested. Try a model that reliably follows tool calls.';
      if (projectFilesWritten && !projectRunSucceeded) return 'Project files were created but the app was not run successfully. Review the tool steps above.';
      if (!toolsUsed) return 'The model did not use the available tools, so no files were created or run.';
      return reply.content || 'Task finished.';
    }
    for (const call of reply.tool_calls) {
      if (!['run_command', 'write_file', 'run_project', 'read_file', 'list_files', 'read_skill'].includes(call.function?.name)) continue;
      toolsUsed++;
      let args;
      try { args = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments; }
      catch { args = {}; }
      if (!args || typeof args !== 'object') args = {};
      if (call.function.name === 'run_command' && (typeof args.cwd !== 'string' || args.cwd.startsWith('/') || /^[A-Za-z]:/.test(args.cwd) || args.cwd.split(/[\\/]/).includes('..'))) args.cwd = '.';
      onStep({ kind: 'command', text: call.function.name === 'write_file' ? `Write ${args.path || '(invalid path)'}` : call.function.name === 'run_project' ? `${args.action || 'Run'} project ${args.path || '.'}` : call.function.name === 'read_file' ? `Read ${args.path || '(invalid path)'}` : call.function.name === 'list_files' ? `List ${args.path || '.'}` : call.function.name === 'read_skill' ? `Read skill ${args.id || '(invalid ID)'}` : args.command || '(invalid command)' });
      let output;
      try {
        if (call.function.name === 'read_skill' && !available.some(skill => skill.id === args.id)) throw new Error('Skill is unavailable or disabled.');
        const route = { write_file: '/write-file', run_project: '/run-project', run_command: '/exec', read_file: '/read-file', list_files: '/list-files', read_skill: '/read-skill' }[call.function.name];
        output = await bridge(route, settings, { ...args, workspaceId: workspace.id }, signal);
      }
      catch (error) { output = { exitCode: -1, output: error.message }; }
      if (output.path && /(?:\.(?:java|py|js|mjs|cjs)|(?:^|[\\/])pom\.xml|(?:^|[\\/])build\.gradle(?:\.kts)?)$/i.test(output.path)) { projectFilesWritten = true; projectRunSucceeded = false; projectRunAttempted = false; writtenPaths.push(output.path); }
      if (call.function.name === 'run_command' && output.exitCode === 0 && /(?:\b(?:Set-Content|Out-File|Add-Content|New-Item)\b|\s>{1,2}\s*\S)/i.test(args.command || '')) { projectFilesWritten = true; projectRunSucceeded = false; projectRunAttempted = false; }
      if (call.function.name === 'run_project') {
        projectStatus = output;
        projectRunAttempted = true;
        if (args.action === 'run' && output.exitCode === 0) projectRunSucceeded = true;
      } else if (call.function.name === 'run_command' && output.exitCode === 0 && /\b(?:java(?:\.exe)?\s+(?!-version\b)|mvn(?:w)?\S*\s+[^\n]*(?:exec:java|spring-boot:run)|gradle(?:w)?\S*\s+[^\n]*(?:\brun\b|bootRun))/i.test(args.command || '')) {
        projectStatus = output;
        projectRunSucceeded = true;
      }
      onStep({ kind: 'result', text: output.bytes !== undefined ? `Wrote ${output.path} (${output.bytes} bytes)` : output.files ? output.files.join('\n') || '(empty folder)' : output.content !== undefined ? String(output.content).slice(0, 12000) || '(empty file)' : `Exit ${output.exitCode}\n${output.output}` });
      const feedback = output.bytes !== undefined ? output : output.files ? output : output.content !== undefined ? { id: output.id, path: output.path, content: output.content.slice(0, 6000) } : { exitCode: output.exitCode, output: String(output.output || '').slice(-2500), path: output.path, kind: output.kind };
      messages.push(model.source === 'gguf'
        ? { role: 'tool', tool_call_id: call.id, content: JSON.stringify(feedback) }
        : { role: 'tool', content: JSON.stringify(feedback) });
    }
    if (projectStatus?.exitCode !== undefined && projectStatus.exitCode !== 0 && projectRunAttempted) {
      messages.push({ role: 'user', content: await failureFeedback(projectStatus) });
    }
  }
  const lastTarget = agentRunTarget(writtenPaths) || (projectFilesWritten ? '.' : null);
  if (lastTarget && !projectRunAttempted && !projectRunSucceeded && !signal.aborted) {
    onStep({ kind: 'command', text: `Run project ${lastTarget}` });
    try { projectStatus = await bridge('/run-project', settings, { workspaceId: workspace.id, path: lastTarget, action: 'run' }, signal); }
    catch (error) { projectStatus = { exitCode: -1, output: error.message }; }
    onStep({ kind: 'result', text: `Exit ${projectStatus.exitCode}\n${projectStatus.output}` });
  }
  if (projectStatus?.exitCode === 0) return `The code ran successfully.\n${String(projectStatus.output || '').slice(-3000)}`;
  if (projectStatus) return `The code was run, but it failed.\n${String(projectStatus.output || '').slice(-3000)}`;
  return 'Stopped after 30 tool rounds. Review the steps above before continuing.';
}
