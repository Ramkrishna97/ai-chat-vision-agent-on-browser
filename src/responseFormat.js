export function splitFencedCode(value = '') {
  const text = String(value);
  const parts = [];
  const fence = /```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n?```/g;
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    if (match.index > cursor) parts.push({ type: 'text', text: text.slice(cursor, match.index) });
    parts.push({ type: 'code', language: match[1].trim(), text: match[2] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}
