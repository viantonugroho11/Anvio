import type { CodeRuntime } from '@anvio/core';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface ProcessSandboxOptions {
  runtime: CodeRuntime;
  code: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  networkEnabled: boolean;
}

export interface ProcessSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export async function runInProcessSandbox(
  options: ProcessSandboxOptions,
): Promise<ProcessSandboxResult> {
  if (options.runtime === 'docker') {
    return runDockerSandbox(options);
  }

  const started = Date.now();
  const { command, args, cleanup } = await buildCommand(options);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env, ANVIO_NETWORK: options.networkEnabled ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      void cleanup?.();
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr: timedOut ? `${stderr}\nProcess timed out after ${options.timeoutMs}ms`.trim() : stderr,
        durationMs: Date.now() - started,
        timedOut,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      void cleanup?.();
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
  });
}

async function buildCommand(
  options: ProcessSandboxOptions,
): Promise<{ command: string; args: string[]; cleanup?: () => Promise<void> }> {
  switch (options.runtime) {
    case 'shell':
      return { command: 'sh', args: ['-c', options.code] };
    case 'python':
      return { command: 'python3', args: ['-c', options.code] };
    case 'node':
      return { command: 'node', args: ['-e', options.code] };
    case 'go': {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-go-'));
      const file = path.join(tmpDir, 'main.go');
      await fs.writeFile(file, options.code, 'utf8');
      return {
        command: 'go',
        args: ['run', file],
        cleanup: () => fs.rm(tmpDir, { recursive: true, force: true }),
      };
    }
    case 'docker':
      throw new Error('Docker runtime handled at sandbox entry');
    default: {
      const _exhaustive: never = options.runtime;
      throw new Error(`Unsupported runtime: ${_exhaustive}`);
    }
  }
}

async function runDockerSandbox(options: ProcessSandboxOptions): Promise<ProcessSandboxResult> {
  const started = Date.now();
  const image = process.env.ANVIO_DOCKER_IMAGE ?? 'node:20-alpine';
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-docker-'));
  const scriptName = /^(\s*(def |import |from ))/.test(options.code) ? 'script.py' : 'script.js';
  const scriptPath = path.join(tmpDir, scriptName);
  await fs.writeFile(scriptPath, options.code, 'utf8');

  const mount = `${options.cwd}:/workspace`;
  const inner =
    scriptName === 'script.py'
      ? `python3 /tmp/script/${scriptName}`
      : `node /tmp/script/${scriptName}`;

  const args = [
    'run',
    '--rm',
    '-v',
    mount,
    '-v',
    `${tmpDir}:/tmp/script:ro`,
    '-w',
    '/workspace',
    ...(options.networkEnabled ? [] : ['--network', 'none']),
    image,
    'sh',
    '-c',
    inner,
  ];

  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on('data', (c: Buffer) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      void fs.rm(tmpDir, { recursive: true, force: true });
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      void fs.rm(tmpDir, { recursive: true, force: true });
      resolve({
        exitCode: 1,
        stdout,
        stderr: err.message,
        durationMs: Date.now() - started,
        timedOut: false,
      });
    });
  });
}
