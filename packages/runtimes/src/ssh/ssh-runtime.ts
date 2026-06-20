import { spawnSync } from 'node:child_process';
import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface SshRuntimeOptions {
  host?: string;
  user?: string;
  port?: number;
}

export class SshRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'ssh' as const;

  constructor(private readonly options: SshRuntimeOptions = {}) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: false,
      supportsStreaming: false,
      supportsSubagents: false,
      supportsMcp: false,
      supportedLanguages: ['shell'],
    };
  }

  isConfigured(): boolean {
    return Boolean(this.options.host) || process.env.ANVIO_SSH_MOCK === '1';
  }

  async testConnection(): Promise<{ ok: boolean; output: string }> {
    if (process.env.ANVIO_SSH_MOCK === '1') {
      const result = spawnSync('echo', ['remote-ok'], { encoding: 'utf-8' });
      return { ok: result.status === 0, output: (result.stdout ?? '').trim() };
    }
    if (!this.options.host) {
      return { ok: false, output: 'SSH host not configured' };
    }
    const target = this.sshTarget();
    const result = spawnSync('ssh', [...target, 'echo', 'remote-ok'], { encoding: 'utf-8' });
    return {
      ok: result.status === 0,
      output: (result.stdout ?? result.stderr ?? '').trim(),
    };
  }

  /** Execute a shell command on the remote host via SSH. */
  async execRemote(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (process.env.ANVIO_SSH_MOCK === '1') {
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
      return {
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
        exitCode: result.status ?? 1,
      };
    }
    if (!this.isConfigured()) {
      throw new AnvioError('VALIDATION_ERROR', 'SSH host not configured (set ANVIO_SSH_HOST)');
    }
    const target = this.sshTarget();
    const result = spawnSync('ssh', [...target, command], { encoding: 'utf-8' });
    return {
      stdout: (result.stdout ?? '').trim(),
      stderr: (result.stderr ?? '').trim(),
      exitCode: result.status ?? 1,
    };
  }

  async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    throw new AnvioError(
      'VALIDATION_ERROR',
      'SSH runtime executes remote shell only — use `anvio runtime test ssh` for connectivity',
    );
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: 'SSH runtime does not support agent streaming yet' };
  }

  private sshTarget(): string[] {
    const user = this.options.user ?? process.env.ANVIO_SSH_USER ?? 'root';
    const host = this.options.host ?? process.env.ANVIO_SSH_HOST!;
    const port = this.options.port ?? Number(process.env.ANVIO_SSH_PORT ?? '22');
    return ['-p', String(port), `${user}@${host}`];
  }
}
