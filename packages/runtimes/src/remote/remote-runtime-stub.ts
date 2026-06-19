import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface RemoteRuntimeStubOptions {
  apiKey?: string;
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
      supportedLanguages: ['typescript', 'python'],
    };
  }

  abstract isConfigured(): boolean;

  async run(_request: RuntimeRequest): Promise<RuntimeResult> {
    throw new AnvioError('VALIDATION_ERROR', this.notConfiguredMessage());
  }

  async *stream(_request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'error', error: this.notConfiguredMessage() };
  }

  protected notConfiguredMessage(): string {
    return `${this.runtimeId} runtime is not configured. Set API credentials in environment.`;
  }
}

export class DaytonaRuntimeProvider extends RemoteRuntimeStub {
  readonly runtimeId = 'daytona' as const;

  override isConfigured(): boolean {
    return Boolean(this.options.apiKey ?? process.env.DAYTONA_API_KEY);
  }
}

export class ModalRuntimeProvider extends RemoteRuntimeStub {
  readonly runtimeId = 'modal' as const;

  override isConfigured(): boolean {
    return Boolean(
      process.env.MODAL_TOKEN_ID &&
        process.env.MODAL_TOKEN_SECRET,
    );
  }
}
