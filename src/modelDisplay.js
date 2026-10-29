export function modelDisplayName(model) {
  const modes = [model.capabilities?.chat && 'chat', model.capabilities?.imageGeneration && 'image generation'].filter(Boolean);
  if (modes.length) return `${model.name} · ${modes.join(' + ')}`;
  return `${model.name} · unsupported${model.reportedCapabilities?.length ? ` (${model.reportedCapabilities.join(', ')})` : ''}`;
}
