import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface ExternalRuntimeOptions {
  runtimeId: 'cursor' | 'claude-code' | 'codex';
  acpEndpoint?: string;
  binary?: string;
}

abstract class ExternalRuntimeStub implements RuntimeProvider {
  abstract readonly runtimeId: 'cursor' | 'claude-code' | 'codex';

  constructor(protected readonly options: ExternalRuntimeOptions) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsSubagents: false,
      supportsMcp: true,
      supportedLanguages: ['typescript', 'python'],
    };
  }

  isConfigured(): boolean {
    return false;
  }

  async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: this.notConfiguredMessage() };
  }

  protected notConfiguredMessage(): string {
    return `${this.runtimeId} runtime is not configured. Set up ACP or install the external CLI.`;
  }
}

export class CursorRuntimeProvider extends ExternalRuntimeStub {
  readonly runtimeId = 'cursor' as const;

  constructor(options: Omit<ExternalRuntimeOptions, 'runtimeId'> = {}) {
    super({ runtimeId: 'cursor', ...options });
  }

  override isConfigured(): boolean {
    return Boolean(this.options.acpEndpoint);
  }

  override async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    if (!this.isConfigured()) {
      throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
    }
    throw new AnvioError(
      'INTERNAL_ERROR',
      'Cursor runtime ACP bridge is stubbed — connect via `anvio acp serve`',
    );
  }
}

export class CodexRuntimeProvider extends ExternalRuntimeStub {
  readonly runtimeId = 'codex' as const;

  constructor(options: Omit<ExternalRuntimeOptions, 'runtimeId'> = {}) {
    super({ runtimeId: 'codex', binary: options.binary ?? 'codex', ...options });
  }
}
