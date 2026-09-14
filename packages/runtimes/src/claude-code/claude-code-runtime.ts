import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type {
  RuntimeApprovalPort,
  RuntimeCapabilities,
  RuntimeProvider,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
  RuntimeToolPort,
  TokenUsage,
} from '@anvio/core';
import { AnvioError } from '@anvio/core';
import {
  buildResumeAwarePrompt,
  readVendorSessionId,
} from '../shared/session-history.js';
import { createAnvioMcpServer, mcpToolName } from './claude-code-tool-bridge.js';
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
  /**
   * Built-in + harness tool surface. When supplied it is served to the SDK
   * as an in-process MCP server and its instructions are appended to the
   * system prompt, so `anvio_channel__reply` /
   * `anvio_channel__request_approval` exist on this runtime the way they do
   * on `local` (issue #69). Omitted in tests and standalone use — the
   * runtime then behaves exactly as before.
   */
  toolPort?: RuntimeToolPort;
  /**
   * Translates the SDK's own tool-permission prompts into harness
   * approvals. Without it the SDK has no permission surface, so every
   * "ask" decision is terminal and the gating is invisible to the user.
   */
  approvalPort?: RuntimeApprovalPort;
}

/** Short one-liner for the approval prompt; the full input goes with it. */
function summarizeToolCall(toolName: string, input: Record<string, unknown>): string {
  const command = input.command ?? input.file_path ?? input.path ?? input.url;
  return typeof command === 'string' && command.trim()
    ? `Run ${toolName}: ${command.trim().slice(0, 300)}`
    : `Run ${toolName}`;
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
  return text.startsWith('/') ? `\u200b${text}` : text;
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
      supportsNativeResume: true,
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

  private buildQueryOptions(
    request: RuntimeRequest,
    oauthToken: string,
    resume?: string,
  ): Options {
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
    const toolPort = this.options.toolPort;
    const toolNames = toolPort?.listTools() ?? [];
    const ctx = {
      sessionId: request.session.id,
      agentId: request.session.agentId,
      userId: request.session.userId,
      channel: request.session.channel,
    };

    return {
      cwd: this.options.cwd ?? process.cwd(),
      model,
      permissionMode: this.options.permissionMode ?? 'default',
      includePartialMessages: true,
      env: buildClaudeCodeAgentEnv(oauthToken),
      // Continue the transcript the SDK already holds for this Anvio
      // session (issue #63). Without it every turn is a cold start.
      ...(resume ? { resume } : {}),
      // Harness tool surface (issue #69). Absent without a tool port, so
      // the standalone runtime keeps its original SDK options.
      ...(toolPort && toolNames.length > 0
        ? {
            mcpServers: { anvio: createAnvioMcpServer(toolPort, ctx) },
            // Only channel tools are auto-approved: prompting for
            // anvio_channel__reply would deadlock the reply behind an
            // approval. Everything else falls through to canUseTool.
            allowedTools: toolNames
              .filter((name) => name.startsWith('anvio_channel__'))
              .map(mcpToolName),
            systemPrompt: {
              type: 'preset' as const,
              preset: 'claude_code' as const,
              append: toolPort.getToolInstructions(),
            },
          }
        : {}),
      ...(this.options.approvalPort ? { canUseTool: this.buildPermissionHandler(request) } : {}),
    };
  }

  /**
   * The SDK asks before running a gated tool; answer from the harness so
   * the SOUL.md approver policy actually applies on this runtime. Anvio's
   * own MCP tools are allowed outright (see `allowedTools`) and never reach
   * here. Fails closed: any error denies.
   */
  private buildPermissionHandler(request: RuntimeRequest): NonNullable<Options['canUseTool']> {
    const approvalPort = this.options.approvalPort!;
    return async (toolName, input) => {
      try {
        const outcome = await approvalPort.requestApproval({
          sessionId: request.session.id,
          agentId: request.session.agentId,
          userId: request.session.userId,
          channel: request.session.channel,
          toolName,
          summary: summarizeToolCall(toolName, input),
          input,
        });
        return outcome.approved
          ? { behavior: 'allow' as const, updatedInput: input }
          : {
              behavior: 'deny' as const,
              message: outcome.reason ?? 'Human approval was not granted.',
            };
      } catch (error) {
        return {
          behavior: 'deny' as const,
          message: error instanceof Error ? error.message : 'Approval failed',
        };
      }
    };
  }

  /**
   * A stored handle can go stale — the SDK's transcript lives under
   * `~/.claude/projects/` keyed by cwd, so a moved workspace, a pruned
   * transcript, or a different machine all invalidate it. Treat that as a
   * cold start rather than a failed turn: the caller retries once without
   * `resume`, replaying history as a prompt prelude.
   */
  private isStaleResumeError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error ?? '');
    return /resume|session.*(not found|does not exist|unknown)|no conversation found/i.test(message);
  }

  async run(request: RuntimeRequest): Promise<RuntimeResult> {
    const oauthToken = await this.oauthTokenForRequest(request);
    const resume = readVendorSessionId(request, this.runtimeId);

    try {
      return await this.runOnce(request, oauthToken, resume);
    } catch (error) {
      if (!resume || !this.isStaleResumeError(error)) throw error;
      // Stored handle no longer resolves — retry cold, with the transcript
      // replayed as a prelude so the turn still has context.
      return await this.runOnce(request, oauthToken, undefined);
    }
  }

  private async runOnce(
    request: RuntimeRequest,
    oauthToken: string,
    resume: string | undefined,
  ): Promise<RuntimeResult> {
    let content = '';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let status: RuntimeResult['status'] = 'completed';
    let sessionId = request.session.id;
    let vendorSessionId: string | undefined;

    for await (const message of this.runQuery({
      prompt: escapeSdkSlashPrompt(buildResumeAwarePrompt(request, resume)),
      options: this.buildQueryOptions(request, oauthToken, resume),
    })) {
      if (message.type === 'result') {
        sessionId = message.session_id;
        vendorSessionId = message.session_id;
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
      vendorSessionId,
    };
  }

  async *stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent> {
    try {
      const oauthToken = await this.oauthTokenForRequest(request);
      const resume = readVendorSessionId(request, this.runtimeId);

      try {
        yield* this.streamOnce(request, oauthToken, resume);
      } catch (error) {
        // Only safe to retry while nothing has been emitted yet —
        // `streamOnce` rethrows a stale-resume failure before its first
        // chunk, so a retry cannot duplicate output the channel already
        // rendered.
        if (!resume || !this.isStaleResumeError(error)) throw error;
        yield* this.streamOnce(request, oauthToken, undefined);
      }
    } catch (error) {
      yield {
        type: 'error',
        error: error instanceof Error ? error.message : 'Claude Code runtime error',
      };
    }
  }

  private async *streamOnce(
    request: RuntimeRequest,
    oauthToken: string,
    resume: string | undefined,
  ): AsyncIterable<RuntimeStreamEvent> {
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let vendorSessionId: string | undefined;
    let emitted = false;

    const iterator = this.runQuery({
      prompt: escapeSdkSlashPrompt(buildResumeAwarePrompt(request, resume)),
      options: this.buildQueryOptions(request, oauthToken, resume),
    })[Symbol.asyncIterator]();

    while (true) {
      let next: IteratorResult<SDKMessage>;
      try {
        next = await iterator.next();
      } catch (error) {
        // Once a chunk is on the wire the turn is no longer retryable —
        // a second attempt would render the reply twice. Report instead.
        if (emitted) {
          yield {
            type: 'error',
            error: error instanceof Error ? error.message : 'Claude Code runtime error',
          };
          return;
        }
        throw error;
      }
      if (next.done) break;
      const message = next.value;

      const delta = extractStreamDelta(message);
      if (delta) {
        emitted = true;
        yield { type: 'chunk', delta };
      }

      if (message.type === 'result') {
        vendorSessionId = message.session_id;
        usage = mapUsage(message.usage);
        if (message.subtype !== 'success') {
          emitted = true;
          yield {
            type: 'error',
            error: message.errors.join('\n') || 'Claude Code execution failed',
          };
          return;
        }
      }
    }

    yield { type: 'done', usage, vendorSessionId, runtimeId: this.runtimeId };
  }
}
