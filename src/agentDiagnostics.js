export function failingSourcePath(paths, output) {
  const sourcePaths = paths.filter(path => /\.(?:java|py|js|mjs|cjs)$/i.test(path));
  const normalizedOutput = String(output || '').replaceAll('\\', '/').toLowerCase();
  return sourcePaths.findLast(path => normalizedOutput.includes(path.replaceAll('\\', '/').toLowerCase()))
    || sourcePaths.findLast(path => normalizedOutput.includes(path.split(/[\\/]/).at(-1).toLowerCase()))
    || sourcePaths.at(-1)
    || null;
}

export function repairPrompt(status, path, source) {
  const diagnostic = String(status?.output || 'No diagnostic output was returned.').slice(-5000);
  return `The last build or run failed with exit code ${status?.exitCode ?? 'unknown'}. Inspect the exact diagnostic below, correct the cause, then run the project again. Use write_file to replace the complete affected source file if a source change is needed. Do not claim success until the rerun exits 0.\n\nDiagnostic:\n${diagnostic}${path && source != null ? `\n\nCurrent ${path}:\n${String(source).slice(0, 10000)}` : ''}`;
}
