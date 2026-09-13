import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import { buildPromptWithHistory } from '../shared/session-history.js';
import { AnvioError } from '@anvio/core';
import type { RuntimeConnectionResolver } from '@anvio/core';
import {
  buildCodexAgentEnv,
  isCodexRuntimeConfigured,
  prepareCodexAuthHome,
  resolveCodexAuthJson,
} from './codex-auth.js';
import { combinedVendorOutput, runVendorCliCommand } from '../shared/vendor-cli-runtime.js';

export interface CodexRuntimeOptions {
  binary?: string;
  cwd?: string;
  authJson?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
  timeoutMs?: number;
  execImpl?: typeof runVendorCliCommand;
}

export class CodexRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'codex' as const;
  private readonly options: CodexRuntimeOptions;
  private readonly exec: typeof runVendorCliCommand;

  constructor(options: CodexRuntimeOptions = {}) {
    this.options = options;
    this.exec = options.execImpl ?? runVendorCliCommand;
  }

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: false,
      supportsSubagents: false,
      supportsMcp: true,
      supportedLanguages: ['typescript', 'python', 'go', 'shell'],
    };
  }

  isConfigured(): boolean {
    return isCodexRuntimeConfigured(this.options);
  }

  private async authHomeForRequest(request: RuntimeRequest): Promise<{ home: string; env: NodeJS.ProcessEnv }> {
    const authJson = await resolveCodexAuthJson({
      ...this.options,
      userId: request.session.userId,
      channel: request.session.channel,
      threadId: request.session.id,
    });

    if (!authJson) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        'Codex runtime is not configured. Run `anvio setup-token --codex` or set CODEX_ACCESS_TOKEN.',
      );
    }

    const home = await prepareCodexAuthHome(authJson, request.session.id);
    return { home, env: buildCodexAgentEnv(home) };
  }

  private execArgs(prompt: string): string[] {
    return [
      'exec',
      '--ask-for-approval',
      'never',
      '--sandbox',
      'workspace-write',
      prompt,
    ];
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const { env } = await this.authHomeForRequest(request);
    const binary = this.options.binary ?? 'codex';
    const cwd = this.options.cwd ?? process.cwd();

    const result = await this.exec({
      binary,
      // `codex exec` is one-shot: replay the transcript so the turn has
      // context (issue #63).
      args: this.execArgs(buildPromptWithHistory(request)),
      cwd,
      env,
      timeoutMs: this.options.timeoutMs,
    });

    const output = combinedVendorOutput(result);
    const content = result.stdout.trim() || output;

    return {
      sessionId: request.session.id,
      content,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      status: result.exitCode === 0 ? 'completed' : 'failed',
      runtimeId: this.runtimeId,
    };
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    try {
      const result = await this.run(request);
      if (result.status === 'failed') {
        yield { type: 'error', error: result.content || 'Codex execution failed' };
        return;
      }
      if (result.content) {
        yield { type: 'chunk', delta: result.content };
      }
      yield { type: 'done', usage: result.usage };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Codex runtime error',
      };
    }
  }
}
