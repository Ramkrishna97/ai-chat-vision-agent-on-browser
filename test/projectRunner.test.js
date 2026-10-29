import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProject, runProject } from '../server/projectRunner.js';

async function workspace(run) {
  const root = await mkdtemp(join(tmpdir(), 'lite-chat-project-test-'));
  try { return await run(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('plain Java project compiles multiple files and runs its main class', {
  skip: spawnSync('javac', ['-version']).error ? 'JDK unavailable' : false,
}, () => workspace(async root => {
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'Main.java'), 'package demo; public class Main { public static void main(String[] args) { System.out.println(Helper.message()); } }');
  await writeFile(join(root, 'src', 'Helper.java'), 'package demo; class Helper { static String message() { return "working"; } }');
  const result = await runProject(root, { path: 'src', action: 'run' });
  assert.equal(result.kind, 'java');
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /working/);
  const fileResult = await runProject(root, { path: 'src/Main.java', action: 'run' });
  assert.equal(fileResult.exitCode, 0, fileResult.output);
  await assert.rejects(() => runProject(root, { path: '../outside', action: 'run' }), /relative/);
}));

async function fakeWrapper(directory, base) {
  const name = process.platform === 'win32' ? `${base}${base === 'mvnw' ? '.cmd' : '.bat'}` : base;
  const file = join(directory, name);
  await writeFile(file, process.platform === 'win32' ? '@echo off\r\necho %*\r\n' : '#!/bin/sh\nprintf "%s\\n" "$*"\n');
  if (process.platform !== 'win32') await chmod(file, 0o755);
}

test('Maven project is detected from a nested source and uses its wrapper', () => workspace(async root => {
  await writeFile(join(root, 'pom.xml'), '<project/>');
  await fakeWrapper(root, 'mvnw');
  await mkdir(join(root, 'src', 'main', 'java'), { recursive: true });
  await writeFile(join(root, 'src', 'main', 'java', 'App.java'), 'public class App { public static void main(String[] args) {} }');
  assert.equal((await inspectProject(root, 'src/main/java/App.java')).kind, 'maven');
  const result = await runProject(root, { path: 'src/main/java/App.java', action: 'run' });
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /exec:java/);
  assert.match(result.output, /-Dexec.mainClass=App/);
}));

test('Gradle project uses its wrapper for test and run tasks', () => workspace(async root => {
  await writeFile(join(root, 'build.gradle'), "plugins { id 'application' }");
  await fakeWrapper(root, 'gradlew');
  const result = await runProject(root, { action: 'run' });
  assert.equal(result.kind, 'gradle');
  assert.equal(result.exitCode, 0, result.output);
  assert.match(result.output, /test/);
  assert.match(result.output, /run/);
}));

test('Gradle retries with JDK 17 when its current JDK is incompatible', () => workspace(async root => {
  const jdk = join(root, 'jdk-17');
  await mkdir(join(jdk, 'bin'), { recursive: true });
  await writeFile(join(jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), '');
  await writeFile(join(jdk, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac'), '');
  await writeFile(join(root, 'build.gradle'), "plugins { id 'java' }");
  const wrapper = join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
  await writeFile(wrapper, process.platform === 'win32'
    ? '@echo off\r\nif "%JAVA_HOME%"=="%JDK17_HOME%" (echo RETRY_OK& exit /b 0)\r\necho Unsupported class file major version 69\r\nexit /b 1\r\n'
    : '#!/bin/sh\nif [ "$JAVA_HOME" = "$JDK17_HOME" ]; then echo RETRY_OK; exit 0; fi\necho Unsupported class file major version 69\nexit 1\n');
  if (process.platform !== 'win32') await chmod(wrapper, 0o755);
  const previous = process.env.JDK17_HOME;
  process.env.JDK17_HOME = jdk;
  try {
    const result = await runProject(root, { action: 'build' });
    assert.equal(result.exitCode, 0, result.output);
    assert.match(result.output, /Retry Gradle with JDK 17/);
    assert.match(result.output, /RETRY_OK/);
  } finally {
    if (previous === undefined) delete process.env.JDK17_HOME;
    else process.env.JDK17_HOME = previous;
  }
}));
