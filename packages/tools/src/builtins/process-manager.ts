import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { CodeExecutor } from '@anvio/core';
import { executeCodeWithExecutor } from './filesystem.js';

interface ManagedProcess {
  id: string;
  command: string;
  proc: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  startedAt: number;
  exitCode: number | null;
}

const processes = new Map<string, ManagedProcess>();
let processCounter = 0;

export async function runTerminal(
  executor: CodeExecutor | undefined,
  command: string,
  background = false,
): Promise<{ command: string; stdout: string; stderr: string; exitCode: number; backgroundId?: string }> {
  if (background) {
    const id = `proc-${++processCounter}`;
    const proc = spawn('sh', ['-c', command], { env: process.env });
    const managed: ManagedProcess = {
      id,
      command,
      proc,
      stdout: '',
      stderr: '',
      startedAt: Date.now(),
      exitCode: null,
    };
    proc.stdout.on('data', (chunk: Buffer) => {
      managed.stdout += chunk.toString();
      if (managed.stdout.length > 32_000) managed.stdout = managed.stdout.slice(-32_000);
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      managed.stderr += chunk.toString();
      if (managed.stderr.length > 16_000) managed.stderr = managed.stderr.slice(-16_000);
    });
    proc.on('close', (code) => {
      managed.exitCode = code ?? 1;
    });
    processes.set(id, managed);
    return { command, stdout: '', stderr: '', exitCode: 0, backgroundId: id };
  }
  if (!executor) {
    throw new Error('codeExecutor required for foreground terminal');
  }
  const out = await executeCodeWithExecutor(executor, command, 'shell');
  return { command, ...out };
}

export function manageProcess(
  action: 'list' | 'poll' | 'log' | 'kill',
  processId?: string,
): { processes?: Array<{ id: string; command: string; running: boolean; exitCode: number | null }>; output?: string; killed?: boolean } {
  if (action === 'list') {
    return {
      processes: [...processes.values()].map((p) => ({
        id: p.id,
        command: p.command,
        running: p.exitCode == null,
        exitCode: p.exitCode,
      })),
    };
  }
  if (!processId) {
    throw new Error('processId required');
  }
  const p = processes.get(processId);
  if (!p) {
    throw new Error(`Process not found: ${processId}`);
  }
  switch (action) {
    case 'poll':
      return { output: p.stdout.slice(-4000), processes: [{ id: p.id, command: p.command, running: p.exitCode == null, exitCode: p.exitCode }] };
    case 'log':
      return { output: `${p.stdout}\n${p.stderr}`.slice(-16_000) };
    case 'kill':
      p.proc.kill('SIGTERM');
      p.exitCode = p.exitCode ?? 137;
      return { killed: true };
    default: {
      const _exhaustive: never = action;
      throw new Error(`Unknown action: ${String(_exhaustive)}`);
    }
  }
}
