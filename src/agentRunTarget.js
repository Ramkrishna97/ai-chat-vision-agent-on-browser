export function agentRunTarget(paths) {
  const files = paths.filter(path => typeof path === 'string');
  const manifest = files.findLast(path => /(?:^|[\\/])(?:pom\.xml|build\.gradle(?:\.kts)?)$/i.test(path));
  if (manifest) return manifest.replace(/[\\/][^\\/]+$/, '') || '.';
  return files.findLast(path => /\.(?:java|py|js|mjs|cjs)$/i.test(path)) || null;
}
