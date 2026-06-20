import type {
  BuiltinToolCall,
  BuiltinToolResult,
  ModelToolDefinition,
  RuntimeToolContext,
  RuntimeToolPort,
} from '@anvio/core';
import type { HarnessGateway } from './gateway.js';
import { harnessToolDefinitions } from './output-port.js';

export interface HarnessBuiltinToolCaller {
  call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult>;
  listTools(): string[];
  getToolInstructions(): string;
  getModelToolDefinitions?(): ModelToolDefinition[];
}

/** Merges built-in tool gateway with channel-agnostic harness tools. */
export class HarnessAwareToolPort implements RuntimeToolPort {
  constructor(
    private readonly builtin: HarnessBuiltinToolCaller,
    private readonly harness: HarnessGateway,
  ) {}

  listTools(): string[] {
    return [...this.builtin.listTools(), ...this.harness.listChannelTools()];
  }

  getToolInstructions(): string {
    const parts = [this.builtin.getToolInstructions()];
    if (this.harness.enabled) {
      const channelTools = harnessToolDefinitions()
        .map((t) => `- ${t.name}: ${t.description}`)
        .join('\n');
      parts.push(
        [
          '## Channel output tools (all channels)',
          'On external channels, send user-visible text via `anvio_channel__reply`.',
          'Before mutating actions, call `anvio_channel__request_approval` with a plan summary.',
          'Approvers are matched from SOUL.md on any connected channel (Slack, Telegram, WhatsApp, …).',
          '',
          channelTools,
        ].join('\n'),
      );
    }
    return parts.filter(Boolean).join('\n\n');
  }

  getModelToolDefinitions(): ModelToolDefinition[] {
    const defs = this.builtin.getModelToolDefinitions?.() ?? [];
    if (!this.harness.enabled) return defs;
    return [...defs, ...harnessToolDefinitions()];
  }

  async call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult> {
    if (call.name.startsWith('anvio_channel__')) {
      const channel = (ctx.channel ?? 'rest') as import('@anvio/core').ChannelType;
      return this.harness.callChannelTool(call, {
        sessionId: ctx.sessionId,
        channel,
        userId: ctx.userId,
      });
    }
    return this.builtin.call(call, ctx);
  }
}

export function createHarnessAwareToolPort(
  builtin: HarnessBuiltinToolCaller,
  harness: HarnessGateway,
): RuntimeToolPort {
  return new HarnessAwareToolPort(builtin, harness);
}
