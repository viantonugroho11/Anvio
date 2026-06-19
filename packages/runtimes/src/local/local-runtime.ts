import type {
  AgentRuntime,
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';

export class LocalRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'local' as const;

  constructor(private readonly agentRuntime: AgentRuntime) {}

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: true,
      supportsSubagents: true,
      supportsMcp: true,
      supportedLanguages: ['typescript', 'python', 'go', 'shell'],
    };
  }

  isConfigured(): boolean {
    return true;
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const result = await this.agentRuntime.run(request.session, request.agent, request.input);
    return { ...result, runtimeId: this.runtimeId };
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    yield* this.agentRuntime.stream(request.session, request.agent, request.input);
  }
}
