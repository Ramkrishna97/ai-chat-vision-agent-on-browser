import { spawn } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function execute(program, args, cwd, input = '') {
  return new Promise((resolveResult, reject) => {
    const child = spawn(program, args, { cwd, windowsHide: true });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 30000);
    const append = data => { output = (output + data.toString()).slice(-20000); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      resolveResult({ exitCode: timedOut ? -1 : code, output: timedOut ? output + '\nTimed out after 30 seconds.' : output });
    });
    child.stdin.end(input);
  });
}

export async function runJava(root, { path, input = '' }) {
  if (typeof path !== 'string' || !path.toLowerCase().endsWith('.java') || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.split(/[\\/]/).includes('..')) throw new Error('Choose a Java source file inside the workspace.');
  if (typeof input !== 'string' || input.length > 10000) throw new Error('Java input must be text under 10 KB.');
  const workspace = await realpath(root);
  const source = await realpath(resolve(workspace, path));
  const within = relative(workspace, source);
  if (!within || within.startsWith('..') || isAbsolute(within)) throw new Error('Java source must be inside the workspace.');
  const text = await readFile(source, 'utf8');
  const packageName = text.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1];
  const className = basename(source, '.java');
  const buildDir = await mkdtemp(join(tmpdir(), 'lite-chat-java-'));
  try {
    const compile = await execute('javac', ['-encoding', 'UTF-8', '-d', buildDir, source], workspace);
    if (compile.exitCode !== 0) return { path: within, exitCode: compile.exitCode, output: `Compile failed:\n${compile.output}` };
    const run = await execute('java', ['-cp', buildDir, packageName ? `${packageName}.${className}` : className], workspace, input);
    return { path: within, exitCode: run.exitCode, output: `Compile succeeded.\nRun exit ${run.exitCode}:\n${run.output}` };
  } finally {
    const temporaryRoot = await realpath(tmpdir());
    if (relative(temporaryRoot, buildDir).startsWith('lite-chat-java-')) await rm(buildDir, { recursive: true, force: true });
  }
}
