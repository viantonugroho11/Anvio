import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import type { RuntimeConnectionResolver } from '@anvio/core';
import {
  hasCursorCliSession,
  isCursorRuntimeConfigured,
} from './cursor-auth.js';
import { combinedVendorOutput, runVendorCliCommand } from '../shared/vendor-cli-runtime.js';

export interface CursorRuntimeOptions {
  acpEndpoint?: string;
  agentBinary?: string;
  cwd?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
  timeoutMs?: number;
  execImpl?: typeof runVendorCliCommand;
}

/** Cursor runtime — ACP bridge or Cursor agent CLI (subscription OAuth via setup-token). */
export class CursorRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'cursor' as const;
  private readonly options: CursorRuntimeOptions;
  private readonly exec: typeof runVendorCliCommand;

  constructor(options: CursorRuntimeOptions = {}) {
    this.options = options;
    this.exec = options.execImpl ?? runVendorCliCommand;
  }

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
    return isCursorRuntimeConfigured(this.options);
  }

  private endpoint(): string | null {
    const base = this.options.acpEndpoint ?? process.env.ANVIO_ACP_ENDPOINT;
    return base ? base.replace(/\/$/, '') : null;
  }

  private async runViaAcp(request: RuntimeRequest): Promise<RuntimeResult> {
    const base = this.endpoint();
    if (!base) {
      throw new AnvioError('VALIDATION_ERROR', 'ACP endpoint not configured');
    }

    const res = await fetch(`${base}/prompt`, {
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

  private async runViaAgentCli(request: RuntimeRequest): Promise<RuntimeResult> {
    const loggedIn = await hasCursorCliSession({
      resolveConnectionPayload: this.options.resolveConnectionPayload,
      userId: request.session.userId,
      channel: request.session.channel,
      threadId: request.session.id,
    });

    if (!loggedIn && !this.options.resolveConnectionPayload) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        'Cursor runtime is not configured. Run `anvio setup-token --cursor` or start `anvio acp serve`.',
      );
    }

    const binary = this.options.agentBinary ?? 'agent';
    const result = await this.exec({
      binary,
      args: ['-p', request.input.content],
      cwd: this.options.cwd ?? process.cwd(),
      timeoutMs: this.options.timeoutMs,
    });

    const output = combinedVendorOutput(result);
    const content = result.stdout.trim() || output;

    return {
      sessionId: request.session.id,
      content,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      status: result.exitCode === 0 ? 'completed' : 'failed',
      runtimeId: 'cursor',
    };
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    if (this.endpoint()) {
      return this.runViaAcp(request);
    }
    return this.runViaAgentCli(request);
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    if (this.endpoint()) {
      yield* this.streamViaAcp(request);
      return;
    }

    try {
      const result = await this.runViaAgentCli(request);
      if (result.status === 'failed') {
        yield { type: 'error', error: result.content || 'Cursor agent failed' };
        return;
      }
      if (result.content) yield { type: 'chunk', delta: result.content };
      yield { type: 'done', usage: result.usage };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Cursor runtime error',
      };
    }
  }

  private async *streamViaAcp(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    const base = this.endpoint();
    if (!base) {
      yield { type: 'error', error: 'ACP endpoint not configured' };
      return;
    }

    const res = await fetch(`${base}/prompt/stream`, {
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
          if (event.type === 'done') {
            yield { type: 'done', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } };
          }
        } catch {
          // ignore malformed sse line
        }
      }
    }
  }
}
