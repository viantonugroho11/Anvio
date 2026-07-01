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
  buildAntigravityAgentEnv,
  isAntigravityRuntimeConfigured,
  resolveAntigravityOAuthToken,
} from './antigravity-auth.js';
import { DEFAULT_ANTIGRAVITY_BINARY } from '../setup-token/antigravity-setup-token.js';
import { combinedVendorOutput, runVendorCliCommand } from '../shared/vendor-cli-runtime.js';

export interface AntigravityRuntimeOptions {
  binary?: string;
  cwd?: string;
  oauthToken?: string;
  resolveConnectionPayload?: RuntimeConnectionResolver;
  timeoutMs?: number;
  execImpl?: typeof runVendorCliCommand;
}

export class AntigravityRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'antigravity' as const;
  private readonly options: AntigravityRuntimeOptions;
  private readonly exec: typeof runVendorCliCommand;

  constructor(options: AntigravityRuntimeOptions = {}) {
    this.options = options;
    this.exec = options.execImpl ?? runVendorCliCommand;
  }

  capabilities(): RuntimeCapabilities {
    return {
      supportsTools: true,
      supportsStreaming: false,
      supportsSubagents: true,
      supportsMcp: true,
      supportedLanguages: ['typescript', 'python', 'go', 'shell'],
    };
  }

  isConfigured(): boolean {
    return isAntigravityRuntimeConfigured(this.options);
  }

  private async envForRequest(request: RuntimeRequest): Promise<NodeJS.ProcessEnv> {
    const token = await resolveAntigravityOAuthToken({
      ...this.options,
      userId: request.session.userId,
      channel: request.session.channel,
      threadId: request.session.id,
    });

    // Token optional when agy session exists in system keyring after setup-token.
    return buildAntigravityAgentEnv(token);
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const env = await this.envForRequest(request);
    const binary = this.options.binary ?? DEFAULT_ANTIGRAVITY_BINARY;
    const cwd = this.options.cwd ?? process.cwd();

    const result = await this.exec({
      binary,
      args: ['-p', request.input.content],
      cwd,
      env,
      timeoutMs: this.options.timeoutMs,
    });

    const output = combinedVendorOutput(result);
    const content = result.stdout.trim() || output;

    if (result.exitCode !== 0 && !content) {
      throw new AnvioError(
        'INTERNAL_ERROR',
        `Antigravity CLI failed (exit ${result.exitCode ?? 'unknown'}): ${output || 'no output'}`,
      );
    }

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
        yield { type: 'error', error: result.content || 'Antigravity execution failed' };
        return;
      }
      if (result.content) {
        yield { type: 'chunk', delta: result.content };
      }
      yield { type: 'done', usage: result.usage };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Antigravity runtime error',
      };
    }
  }
}
