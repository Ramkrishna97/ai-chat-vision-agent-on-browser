export function estimateTokens(text = '') {
  return Math.ceil(String(text).length / 4);
}

export function contextLimit(settings, model) {
  const configured = Number(settings?.context) || 2048;
  const supported = Number(model?.context);
  return supported > 0 ? Math.min(configured, supported) : configured;
}

export function estimatedConversationTokens(messages, liveText = '') {
  return estimateTokens(messages.slice(-12).map(item => item.text || '').join('\n') + liveText);
}

export function ollamaUsage(part) {
  const prompt = Number(part?.prompt_eval_count);
  const output = Number(part?.eval_count);
  if (!Number.isFinite(prompt) || !Number.isFinite(output)) return null;
  return { prompt, output, used: prompt + output, estimated: false };
}
