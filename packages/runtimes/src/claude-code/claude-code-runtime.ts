import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
  TokenUsage,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import {
  buildClaudeCodeAgentEnv,
  resolveClaudeCodeOAuthToken,
  type ResolveClaudeCodeOAuthOptions,
} from './claude-code-auth.js';

export interface ClaudeCodeRuntimeOptions extends ResolveClaudeCodeOAuthOptions {
  cwd?: string;
  model?: string;
  permissionMode?: Options['permissionMode'];
  queryImpl?: (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;
}

function mapUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}): TokenUsage {
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function extractStreamDelta(message: SDKMessage): string | null {
  if (message.type !== 'stream_event') return null;
  const event = message.event;
  if (
    event.type === 'content_block_delta' &&
    'delta' in event &&
    event.delta &&
    typeof event.delta === 'object' &&
    'type' in event.delta &&
    event.delta.type === 'text_delta' &&
    'text' in event.delta &&
    typeof event.delta.text === 'string'
  ) {
    return event.delta.text;
  }
  return null;
}

function extractAssistantText(message: SDKMessage): string | null {
  if (message.type !== 'assistant') return null;
  const blocks = message.message.content;
  if (!Array.isArray(blocks)) return null;
  return blocks
    .filter((block): block is Extract<(typeof blocks)[number], { type: 'text' }> => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * The Claude Agent SDK reads a leading `/` as its own CLI slash-command
 * (`/help`, `/model`, `/clear`, …) and returns an empty result — every
 * `/foo` prompt from a channel came back with no content (issue #54(b)).
 * Prefix with a zero-width space so the SDK treats the same text as user
 * input. Invisible in the transcript.
 */
function escapeSdkSlashPrompt(text: string): string {
  return text.startsWith('/') ? `​${text}` : text;
}

export class ClaudeCodeRuntimeProvider implements RuntimeProvider {
  readonly runtimeId = 'claude-code' as const;
  private readonly options: ClaudeCodeRuntimeOptions;
  private readonly runQuery: (params: { prompt: string; options?: Options }) => AsyncIterable<SDKMessage>;
  private configuredToken: string | null | undefined;

  constructor(options: ClaudeCodeRuntimeOptions = {}) {
    this.options = options;
    this.runQuery =
      options.queryImpl ??
      ((params) => query({ prompt: params.prompt, options: params.options }));
  }

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
    return Boolean(
      this.options.oauthToken?.trim() ||
        process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim() ||
        this.options.resolveOAuthToken,
    );
  }

  private async oauthTokenForRequest(request: RuntimeRequest): Promise<string> {
    if (this.configuredToken !== undefined && this.configuredToken !== null) {
      return this.configuredToken;
    }

    const token = await resolveClaudeCodeOAuthToken({
      ...this.options,
      userId: request.session.userId,
      channel: request.session.channel,
      threadId: request.session.id,
    });

    if (!token) {
      throw new AnvioError(
        'VALIDATION_ERROR',
        'Claude Code runtime is not configured. Run `anvio connect login claude-code` or set CLAUDE_CODE_OAUTH_TOKEN.',
      );
    }

    this.configuredToken = token;
    return token;
  }

  private buildQueryOptions(request: RuntimeRequest, oauthToken: string): Options {
    // Prefer the runtime-scoped model. Falling through to `spec.model.model`
    // used to be the only path, which conflated the vendor's model id with
    // the local fallback's model provider config (issue #49). When both are
    // absent, the SDK picks its own default.
    const model =
      this.options.model ??
      request.agent.spec.runtime?.model ??
      (request.agent.spec.model.provider === 'anthropic'
        ? request.agent.spec.model.model
        : undefined);
    return {
      cwd: this.options.cwd ?? process.cwd(),
      model,
      permissionMode: this.options.permissionMode ?? 'default',
      includePartialMessages: true,
      env: buildClaudeCodeAgentEnv(oauthToken),
    };
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const oauthToken = await this.oauthTokenForRequest(request);
    let content = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let status: RuntimeResult['status'] = 'completed';
    let sessionId = request.session.id;

    for await (const message of this.runQuery({
      prompt: escapeSdkSlashPrompt(request.input.content),
      options: this.buildQueryOptions(request, oauthToken),
    })) {
      if (message.type === 'result') {
        sessionId = message.session_id;
        usage = mapUsage(message.usage);
        if (message.subtype === 'success') {
          content = message.result;
          status = 'completed';
        } else {
          status = 'failed';
          content = message.errors.join('\n') || 'Claude Code execution failed';
        }
        continue;
      }

      const assistantText = extractAssistantText(message);
      if (assistantText) {
        content = assistantText;
      }
    }

    return {
      sessionId,
      content,
      usage,
      status,
      runtimeId: this.runtimeId,
    };
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    try {
      const oauthToken = await this.oauthTokenForRequest(request);
      let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      for await (const message of this.runQuery({
        prompt: escapeSdkSlashPrompt(request.input.content),
        options: this.buildQueryOptions(request, oauthToken),
      })) {
        const delta = extractStreamDelta(message);
        if (delta) {
          yield { type: 'chunk', delta };
        }

        if (message.type === 'result') {
          usage = mapUsage(message.usage);
          if (message.subtype !== 'success') {
            yield {
              type: 'error',
              error: message.errors.join('\n') || 'Claude Code execution failed',
            };
            return;
          }
        }
      }

      yield { type: 'done', usage };
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Claude Code runtime error',
      };
    }
  }
}
