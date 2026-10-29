export async function ggufInfo(file) {
  const buffer = await file.slice(0, 4 * 1024 * 1024).arrayBuffer();
  const view = new DataView(buffer);
  const text = new TextDecoder();
  let offset = 0;
  const need = bytes => { if (offset + bytes > view.byteLength) throw new Error('Incomplete GGUF metadata.'); };
  const u32 = () => { need(4); const value = view.getUint32(offset, true); offset += 4; return value; };
  const u64 = () => { need(8); const value = Number(view.getBigUint64(offset, true)); offset += 8; if (!Number.isSafeInteger(value)) throw new Error('Invalid GGUF metadata.'); return value; };
  const str = () => { const length = u64(); need(length); const value = text.decode(new Uint8Array(buffer, offset, length)); offset += length; return value; };
  const sizes = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const skip = (type, depth = 0) => {
    if (depth > 4) throw new Error('Invalid GGUF metadata.');
    if (type === 8) { str(); return; }
    if (type === 9) { const element = u32(); const count = u64(); if (sizes[element]) { need(count * sizes[element]); offset += count * sizes[element]; } else { for (let i = 0; i < count; i++) skip(element, depth + 1); } return; }
    if (!sizes[type]) throw new Error('Unsupported GGUF metadata type.');
    need(sizes[type]); offset += sizes[type];
  };
  let architecture = null;
  let hasTokenizer = false;
  try {
    need(24);
    if (text.decode(new Uint8Array(buffer, 0, 4)) !== 'GGUF') return { architecture, hasTokenizer, complete: false };
    offset = 4;
    const version = u32();
    if (version < 2 || version > 3) return { architecture, hasTokenizer, complete: false };
    u64();
    const count = u64();
    for (let index = 0; index < count; index++) {
      const key = str();
      const type = u32();
      if (key === 'general.architecture' && type === 8) { architecture = str(); continue; }
      if (key.startsWith('tokenizer.')) hasTokenizer = true;
      skip(type);
    }
    return { architecture, hasTokenizer, complete: true };
  } catch { return { architecture, hasTokenizer, complete: false }; }
}
