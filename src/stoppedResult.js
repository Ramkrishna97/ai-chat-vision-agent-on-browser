export function stoppedResult(mode, answer, steps) {
  if (mode === 'agent' && steps.length) return { text: 'Stopped', steps: steps.map(step => ({ ...step, live: false })) };
  if (mode === 'chat' && (answer?.content || answer?.thinking)) return { text: answer.content || '', thinking: answer.thinking || '' };
  return null;
}
