import type { CodeRuntime } from '@anvio/core';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSandboxEnv } from '@anvio/core';

export interface ProcessSandboxOptions {
  runtime: CodeRuntime;
  code: string;
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  /**
   * Honoured by the docker runtime (`--network none`). Host runtimes (shell, python,
   * node, go) have no network isolation; the flag is only exported as `ANVIO_NETWORK`.
   */
  networkEnabled: boolean;
  /** Per-stream capture limit. Output beyond it is dropped and marked truncated. */
  maxOutputBytes?: number;
}

export interface ProcessSandboxResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

/** Accumulates a stream up to a byte limit; the rest is counted, not kept. */
class CappedOutput {
  private readonly chunks: Buffer[] = [];
  private kept = 0;
  private dropped = 0;

  constructor(private readonly limit: number) {}

  push(chunk: Buffer): void {
    const room = this.limit - this.kept;
    if (room <= 0) {
      this.dropped += chunk.byteLength;
      return;
    }
    const slice = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    this.chunks.push(slice);
    this.kept += slice.byteLength;
    this.dropped += chunk.byteLength - slice.byteLength;
  }

  toString(): string {
    const text = Buffer.concat(this.chunks).toString('utf-8');
    return this.dropped > 0 ? `${text}\n[output truncated: ${this.dropped} more bytes]` : text;
  }
}

/** Kill the child and anything it spawned: it runs as its own process group. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    // Already exited between the timeout firing and the kill.
  }
}

export async function runInProcessSandbox(
  options: ProcessSandboxOptions,
): Promise<ProcessSandboxResult> {
  if (options.runtime === 'docker') {
    return runDockerSandbox(options);
  }

  const started = Date.now();
  const { command, args, cleanup } = await buildCommand(options);
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: buildSandboxEnv(options.env, options.networkEnabled),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });

    const stdout = new CappedOutput(maxOutput);
    const stderr = new CappedOutput(maxOutput);
    let timedOut = false;
    let settled = false;

    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);

    const finish = (exitCode: number, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void cleanup?.().catch((error: unknown) => {
        console.error('[execution] sandbox cleanup failed:', error instanceof Error ? error.message : error);
      });
      const err = errorMessage ?? stderr.toString();
      resolve({
        exitCode: timedOut ? 124 : exitCode,
        stdout: stdout.toString(),
        stderr: timedOut ? `${err}\nProcess timed out after ${options.timeoutMs}ms`.trim() : err,
        durationMs: Date.now() - started,
        timedOut,
      });
    };

    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => finish(1, err.message));
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
  const maxOutput = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  // Named so a timeout can remove the container: killing the docker CLI alone
  // leaves the container running.
  const containerName = `anvio-sandbox-${randomBytes(6).toString('hex')}`;

  const mount = `${options.cwd}:/workspace`;
  const inner =
    scriptName === 'script.py'
      ? `python3 /tmp/script/${scriptName}`
      : `node /tmp/script/${scriptName}`;

  const args = [
    'run',
    '--rm',
    '--name',
    containerName,
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
    const stdout = new CappedOutput(maxOutput);
    const stderr = new CappedOutput(maxOutput);
    let timedOut = false;
    let settled = false;
    child.stdout?.on('data', (c: Buffer) => stdout.push(c));
    child.stderr?.on('data', (c: Buffer) => stderr.push(c));
    const timer = setTimeout(() => {
      timedOut = true;
      spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' }).on('error', () => {});
      child.kill('SIGKILL');
    }, options.timeoutMs);
    const finish = (exitCode: number, errorMessage?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      const err = errorMessage ?? stderr.toString();
      resolve({
        exitCode: timedOut ? 124 : exitCode,
        stdout: stdout.toString(),
        stderr: timedOut ? `${err}\nProcess timed out after ${options.timeoutMs}ms`.trim() : err,
        durationMs: Date.now() - started,
        timedOut,
      });
    };
    child.on('close', (code) => finish(code ?? 1));
    child.on('error', (err) => finish(1, err.message));
  });
}
