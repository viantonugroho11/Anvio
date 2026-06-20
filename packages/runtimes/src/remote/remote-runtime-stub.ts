import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface RemoteExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RemoteRuntimeStubOptions {
  apiKey?: string;
  apiUrl?: string;
  mockEnvKey?: string;
}

abstract class RemoteRuntimeStub implements RuntimeProvider {
  abstract readonly runtimeId: 'daytona' | 'modal';

  constructor(protected readonly options: RemoteRuntimeStubOptions) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsSubagents: false,
      supportsMcp: false,
      supportedLanguages: ['typescript', 'python', 'shell'],
    };
  }

  abstract isConfigured(): boolean;

  async execRemote(command: string): Promise<RemoteExecResult> {
    if (this.isMockMode()) {
      const { spawnSync } = await import('node:child_process');
      const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' });
      return {
        stdout: (result.stdout ?? '').trim(),
        stderr: (result.stderr ?? '').trim(),
        exitCode: result.status ?? 1,
      };
    }
    if (!this.isConfigured()) {
      throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
    }
    const apiUrl = this.options.apiUrl ?? this.defaultApiUrl();
    const res = await fetch(`${apiUrl.replace(/\/$/, '')}/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.authHeaders(),
      },
      body: JSON.stringify({ command, runtime: this.runtimeId }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new AnvioError('VALIDATION_ERROR', `${this.runtimeId} exec failed (${res.status}): ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as Partial<RemoteExecResult>;
    return {
      stdout: json.stdout ?? '',
      stderr: json.stderr ?? '',
      exitCode: json.exitCode ?? 1,
    };
  }

  async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: this.notConfiguredMessage() };
  }

  protected isMockMode(): boolean {
    const key = this.options.mockEnvKey ?? `ANVIO_${this.runtimeId.toUpperCase()}_MOCK`;
    return process.env[key] === '1';
  }

  protected abstract defaultApiUrl(): string;
  protected abstract authHeaders(): Record<string, string>;

  protected notConfiguredMessage(): string {
    return `${this.runtimeId} runtime is not configured. Set API credentials in environment.`;
  }
}

export class DaytonaRuntimeProvider extends RemoteRuntimeStub {
  readonly runtimeId = 'daytona' as const;

  override isConfigured(): boolean {
    return this.isMockMode() || Boolean(this.options.apiKey ?? process.env.DAYTONA_API_KEY);
  }

  protected defaultApiUrl(): string {
    return process.env.DAYTONA_API_URL ?? 'https://api.daytona.io';
  }

  protected authHeaders(): Record<string, string> {
    const key = this.options.apiKey ?? process.env.DAYTONA_API_KEY;
    return key ? { Authorization: `Bearer ${key}` } : {};
  }
}

export class ModalRuntimeProvider extends RemoteRuntimeStub {
  readonly runtimeId = 'modal' as const;

  override isConfigured(): boolean {
    return (
      this.isMockMode() ||
      Boolean(process.env.MODAL_TOKEN_ID && process.env.MODAL_TOKEN_SECRET)
    );
  }

  protected defaultApiUrl(): string {
    return process.env.MODAL_API_URL ?? 'https://api.modal.com';
  }

  protected authHeaders(): Record<string, string> {
    const id = process.env.MODAL_TOKEN_ID;
    const secret = process.env.MODAL_TOKEN_SECRET;
    if (!id || !secret) return {};
    return { Authorization: `Bearer ${id}:${secret}` };
  }
}
