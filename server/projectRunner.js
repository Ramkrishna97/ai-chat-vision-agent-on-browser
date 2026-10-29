import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, delimiter, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

const ignored = new Set(['node_modules', '.git', '.gradle', '.mvn', 'target', 'build', 'dist', 'out']);
const exists = async path => stat(path).then(() => true, () => false);
const inside = (root, path) => { const part = relative(root, path); return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };

async function javaFiles(directory, limit = 300) {
  const found = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (found.length >= limit) throw new Error(`More than ${limit} Java files found. Select a smaller project directory.`);
      const path = join(folder, entry.name);
      if (entry.isDirectory() && !ignored.has(entry.name)) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.java')) found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

async function mainClasses(sources) {
  const found = [];
  for (const source of sources) {
    const text = await readFile(source, 'utf8');
    if (!/static\s+void\s+main\s*\(\s*String\s*(?:\[\s*\]\s*\w+|\.\.\.\s*\w+|\w+\s*\[\s*\])/.test(text)) continue;
    const packageName = text.match(/^\s*package\s+([\w.]+)\s*;/m)?.[1];
    found.push(packageName ? `${packageName}.${basename(source, '.java')}` : basename(source, '.java'));
  }
  return found;
}

async function plainSources(project) {
  if (extname(project.target).toLowerCase() !== '.java') return javaFiles(project.directory);
  const parts = relative(project.workspace, project.target).split(sep);
  const sourceIndex = parts.lastIndexOf('src');
  if (sourceIndex >= 0) {
    const end = parts[sourceIndex + 1] === 'main' && parts[sourceIndex + 2] === 'java' ? sourceIndex + 3 : sourceIndex + 1;
    return javaFiles(join(project.workspace, ...parts.slice(0, end)));
  }
  return javaFiles(dirname(project.target));
}

export async function inspectProject(root, requested = '.') {
  if (typeof requested !== 'string' || !requested.trim() || isAbsolute(requested) || /^[A-Za-z]:/.test(requested) || requested.split(/[\\/]/).includes('..')) throw new Error('Project path must be relative to the workspace.');
  const workspace = await realpath(root);
  const target = await realpath(resolve(workspace, requested));
  if (!inside(workspace, target)) throw new Error('Project path must be inside the workspace.');
  const info = await stat(target);
  const scriptExtension = info.isFile() && extname(target).toLowerCase();
  if (['.py', '.js', '.mjs', '.cjs'].includes(scriptExtension)) return { kind: scriptExtension === '.py' ? 'python' : 'node', workspace, directory: dirname(target), target };
  let folder = info.isDirectory() ? target : dirname(target);
  while (inside(workspace, folder)) {
    if (await exists(join(folder, 'pom.xml'))) return { kind: 'maven', workspace, directory: folder, target };
    if (await exists(join(folder, 'build.gradle')) || await exists(join(folder, 'build.gradle.kts'))) return { kind: 'gradle', workspace, directory: folder, target };
    if (folder === workspace) break;
    folder = dirname(folder);
  }
  if (info.isDirectory() && !(await javaFiles(target)).length) {
    const scripts = (await readdir(target)).filter(name => /\.(?:py|js|mjs|cjs)$/i.test(name));
    if (scripts.length === 1) return { kind: /\.py$/i.test(scripts[0]) ? 'python' : 'node', workspace, directory: target, target: join(target, scripts[0]) };
  }
  if (info.isFile() && extname(target).toLowerCase() !== '.java') throw new Error('Select a Java, Python, or JavaScript source file or a project directory.');
  return { kind: 'java', workspace, directory: info.isDirectory() ? target : dirname(target), target };
}

function stopProcess(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => child.kill());
  else child.kill();
}

function execute(program, args, cwd, { input = '', timeoutMs = 120000, signal, env = process.env } = {}) {
  return new Promise((done, reject) => {
    const windowsBatch = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(program);
    const quoted = value => `'${String(value).replaceAll("'", "''")}'`;
    const command = windowsBatch ? `& ${quoted(program)} ${args.map(quoted).join(' ')}` : undefined;
    const child = windowsBatch
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true, env })
      : spawn(program, args, { cwd, windowsHide: true, env });
    let output = ''; let finished = false; let timedOut = false; let forceTimer;
    const append = chunk => { output = (output + chunk.toString()).slice(-30000); };
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      signal?.removeEventListener('abort', abort);
      child.stdout.destroy(); child.stderr.destroy();
      if (error) reject(error);
      else done({ exitCode: timedOut ? -1 : code, output: timedOut ? `${output}\nTimed out after ${timeoutMs / 1000} seconds.` : output });
    };
    const timer = setTimeout(() => { timedOut = true; stopProcess(child); forceTimer = setTimeout(() => finish(-1), 3000); }, timeoutMs);
    const abort = () => { stopProcess(child); forceTimer = setTimeout(() => finish(-1), 3000); };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => finish(-1, error));
    child.on('exit', code => setTimeout(() => finish(code ?? -1), 200));
    child.on('close', code => finish(code ?? -1));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    if (signal?.aborted) abort();
  });
}

async function findJdk17() {
  const candidates = [process.env.JDK17_HOME, process.env.JAVA17_HOME, process.env.JAVA_HOME_17_X64];
  if (process.platform === 'win32') {
    const javaFolder = join(process.env.ProgramFiles || 'C:\\Program Files', 'Java');
    for (const name of await readdir(javaFolder).catch(() => [])) if (/^jdk-17(?:[.-]|$)/i.test(name)) candidates.push(join(javaFolder, name));
  }
  for (const candidate of candidates.filter(Boolean)) {
    if (await exists(join(candidate, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')) && await exists(join(candidate, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'))) return candidate;
  }
  return null;
}

export async function runProject(root, { path = '.', action = 'run', mainClass, task, args = [], input = '' } = {}, signal) {
  if (!['build', 'test', 'run'].includes(action)) throw new Error('Action must be build, test, or run.');
  if (mainClass !== undefined && (typeof mainClass !== 'string' || !/^[\w$]+(?:\.[\w$]+)*$/.test(mainClass))) throw new Error('Invalid Java main class.');
  if (task !== undefined && (typeof task !== 'string' || !task.trim() || !/^[\w.: -]+$/.test(task))) throw new Error('Invalid build task.');
  if (!Array.isArray(args) || args.length > 20 || args.some(value => typeof value !== 'string' || value.length > 200)) throw new Error('Program arguments must be short strings.');
  if (typeof input !== 'string' || input.length > 10000) throw new Error('Program input must be text under 10 KB.');
  const project = await inspectProject(root, path);
  const projectPath = relative(project.workspace, project.directory) || '.';
  const steps = [];
  const run = async (program, commandArgs, options = {}) => {
    const result = await execute(program, commandArgs, project.directory, { signal, ...options });
    steps.push({ command: `${basename(program)} ${commandArgs.join(' ')}`, ...result });
    return result;
  };
  if (project.kind === 'python' || project.kind === 'node') {
    const script = basename(project.target);
    if (project.kind === 'python') await run(process.platform === 'win32' ? 'python' : 'python3', [script, ...args], { input, timeoutMs: 30000 });
    else await run('node', [script, ...args], { input, timeoutMs: 30000 });
  } else if (project.kind === 'java') {
    const sources = await plainSources(project);
    if (!sources.length) throw new Error('No Java source files found in this directory.');
    const buildDir = await mkdtemp(join(tmpdir(), 'lite-chat-project-'));
    try {
      const compile = await run('javac', ['-encoding', 'UTF-8', '-d', buildDir, ...sources]);
      if (compile.exitCode === 0 && action !== 'build') {
        const discovered = await mainClasses(sources);
        const entry = mainClass || (discovered.length === 1 ? discovered[0] : null);
        if (!entry) steps.push({ command: 'Select main class', exitCode: 1, output: discovered.length ? `Multiple main classes found: ${discovered.join(', ')}. Pass mainClass.` : 'No main method found. Pass mainClass or create one.' });
        else await run('java', ['-cp', buildDir, entry, ...args], { input, timeoutMs: 30000 });
      }
    } finally {
      const temporaryRoot = await realpath(tmpdir());
      if (inside(temporaryRoot, buildDir) && basename(buildDir).startsWith('lite-chat-project-')) await rm(buildDir, { recursive: true, force: true });
    }
  } else {
    const wrapper = project.kind === 'maven' ? (process.platform === 'win32' ? 'mvnw.cmd' : 'mvnw') : (process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    const program = await exists(join(project.directory, wrapper)) ? join(project.directory, wrapper) : project.kind === 'maven' ? (process.platform === 'win32' ? 'mvn.cmd' : 'mvn') : (process.platform === 'win32' ? 'gradle.bat' : 'gradle');
    if (project.kind === 'maven') {
      const goals = task ? task.trim().split(/\s+/) : action === 'build' ? ['package'] : ['test'];
      const build = await run(program, ['-B', ...goals], { timeoutMs: 180000 });
      if (build.exitCode === 0 && action === 'run' && !task) {
        const pom = await readFile(join(project.directory, 'pom.xml'), 'utf8');
        if (/spring-boot-maven-plugin/.test(pom)) {
          await run(program, ['-B', 'spring-boot:run', ...(args.length ? [`-Dspring-boot.run.arguments=${args.join(' ')}`] : [])], { input, timeoutMs: 30000 });
        } else {
          const sources = await exists(join(project.directory, 'src', 'main', 'java')) ? await javaFiles(join(project.directory, 'src', 'main', 'java')) : [];
          const discovered = await mainClasses(sources);
          const entry = mainClass || (discovered.length === 1 ? discovered[0] : null);
          if (!entry) steps.push({ command: 'Select main class', exitCode: 1, output: 'Set mainClass for this Maven project, or define a single main method.' });
          else await run(program, ['-B', 'exec:java', `-Dexec.mainClass=${entry}`, ...(args.length ? [`-Dexec.args=${args.join(' ')}`] : [])], { input, timeoutMs: 30000 });
        }
      }
    } else {
      const buildTasks = task ? task.trim().split(/\s+/) : [action === 'build' ? 'build' : 'test'];
      let gradleEnv = process.env;
      let build = await run(program, ['--no-daemon', '--console=plain', ...buildTasks], { timeoutMs: 180000, env: gradleEnv });
      if (build.exitCode !== 0 && /Unsupported class file major version/i.test(build.output)) {
        const jdk17 = await findJdk17();
        if (jdk17) {
          gradleEnv = { ...process.env, JAVA_HOME: jdk17 };
          const pathKey = Object.keys(gradleEnv).find(key => key.toLowerCase() === 'path') || 'PATH';
          gradleEnv[pathKey] = `${join(jdk17, 'bin')}${delimiter}${gradleEnv[pathKey] || ''}`;
          steps.push({ command: 'Retry Gradle with JDK 17', exitCode: 0, output: `JAVA_HOME=${jdk17}` });
          build = await run(program, ['--no-daemon', '--console=plain', ...buildTasks], { timeoutMs: 180000, env: gradleEnv });
        }
      }
      if (build.exitCode === 0 && action === 'run' && !task) {
        const buildFile = await readFile(await exists(join(project.directory, 'build.gradle')) ? join(project.directory, 'build.gradle') : join(project.directory, 'build.gradle.kts'), 'utf8');
        const runTask = /org\.springframework\.boot/.test(buildFile) ? 'bootRun' : 'run';
        await run(program, ['--no-daemon', '--console=plain', runTask, ...(args.length ? [`--args=${args.join(' ')}`] : [])], { input, timeoutMs: 30000, env: gradleEnv });
      }
    }
  }
  const last = steps.at(-1);
  return { kind: project.kind, path: projectPath, exitCode: last?.exitCode ?? -1, steps, output: steps.map(step => `$ ${step.command}\nExit ${step.exitCode}\n${step.output}`).join('\n\n') };
}
