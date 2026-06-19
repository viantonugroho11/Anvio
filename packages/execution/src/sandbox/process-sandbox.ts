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
    return {
      exitCode: 1,
      stdout: '',
      stderr: 'Docker sandbox is not implemented (Level 3 stub)',
      durationMs: 0,
      timedOut: false,
    };
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
    default: {
      const _exhaustive: never = options.runtime;
      throw new Error(`Unsupported runtime: ${_exhaustive}`);
    }
  }
}
