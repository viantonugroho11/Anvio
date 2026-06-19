import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';

export interface CursorRuntimeOptions {
  acpEndpoint?: string;
}

/** Cursor runtime — delegates agent runs to a local ACP server (`anvio acp serve`). */
export class CursorRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'cursor' as const;

  constructor(private readonly options: CursorRuntimeOptions = {}) {}

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
    return Boolean(this.options.acpEndpoint ?? process.env.ANVIO_ACP_ENDPOINT);
  }

  private endpoint(): string {
    const base = this.options.acpEndpoint ?? process.env.ANVIO_ACP_ENDPOINT;
    if (!base) throw new AnvioError('VALIDATION_ERROR', 'ACP endpoint not configured');
    return base.replace(/\/$/, '');
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const res = await fetch(`${this.endpoint()}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: request.agent.metadata.name,
        message: request.input.content,
        userId: request.session.userId,
        sessionId: request.session.id,
      }),
    });

    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AnvioError('INTERNAL_ERROR', err.error ?? `ACP HTTP ${res.status}`);
    }

    const body = (await res.json()) as { sessionId: string; content: string; status: string };
    return {
      sessionId: body.sessionId,
      content: body.content,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      status: body.status === 'completed' ? 'completed' : 'failed',
      runtimeId: 'cursor',
    };
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    const res = await fetch(`${this.endpoint()}/prompt/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent: request.agent.metadata.name,
        message: request.input.content,
        userId: request.session.userId,
        sessionId: request.session.id,
      }),
    });

    if (!res.ok || !res.body) {
      yield { type: 'error', error: `ACP stream failed: HTTP ${res.status}` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const event = JSON.parse(line.slice(6)) as { type: string; delta?: string; error?: string };
          if (event.type === 'chunk' && event.delta) yield { type: 'chunk', delta: event.delta };
          if (event.type === 'error') yield { type: 'error', error: event.error ?? 'stream error' };
          if (event.type === 'done') yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
        } catch {
          // ignore malformed sse line
        }
      }
    }
  }
}
