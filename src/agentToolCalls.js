const names = new Set(['run_command', 'write_file', 'run_project', 'read_file', 'list_files', 'read_skill']);

export function textToolCalls(content = '', request = '') {
  const blocks = [...String(content).matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1]);
  if (!blocks.length) blocks.push(String(content).trim());
  for (const block of blocks) {
    let parsed;
    try { parsed = JSON.parse(block); } catch { continue; }
    const candidates = Array.isArray(parsed) ? parsed : Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [parsed];
    const calls = [];
    for (const candidate of candidates) {
      const fn = candidate?.function || candidate;
      if (!names.has(fn?.name)) continue;
      let args = fn.arguments;
      if (typeof args === 'string') { try { args = JSON.parse(args); } catch { continue; } }
      if (!args || typeof args !== 'object' || Array.isArray(args)) continue;
      if (fn.name === 'write_file' && args.path === '.' && typeof args.content === 'string') {
        const requestedFile = request.match(/(?:^|[\s`"'])((?:[\w.-]+[\\/])*[\w.-]+\.(?:java|js|mjs|cjs|py))(?:\b|$)/i)?.[1];
        if (requestedFile) args = { ...args, path: requestedFile };
      }
      if (fn.name === 'write_file' && (typeof args.path !== 'string' || args.path === '.' || typeof args.content !== 'string')) continue;
      if (fn.name === 'run_command' && typeof args.command !== 'string') continue;
      if (fn.name === 'run_project' && (typeof args.path !== 'string' || !['run', 'build', 'test'].includes(args.action))) continue;
      if (['read_file', 'list_files'].includes(fn.name) && typeof args.path !== 'string') continue;
      if (fn.name === 'read_skill' && typeof args.id !== 'string') continue;
      calls.push({ id: `text-tool-${calls.length}`, type: 'function', function: { name: fn.name, arguments: args } });
    }
    if (calls.length) return calls;
  }
  return [];
}
