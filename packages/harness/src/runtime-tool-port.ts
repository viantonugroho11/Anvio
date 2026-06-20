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

function mcpAndChannelOnly(harness: HarnessGateway): boolean {
  return harness.enabled && harness.defaults.toolSurface === 'mcp_and_channel';
}

function filterForToolSurface(tools: string[], harness: HarnessGateway): string[] {
  if (!mcpAndChannelOnly(harness)) return tools;
  return tools.filter(
    (name) => name.startsWith('anvio_mcp__') || name.startsWith('anvio_channel__'),
  );
}

/** Merges built-in tool gateway with channel-agnostic harness tools. */
export class HarnessAwareToolPort implements RuntimeToolPort {
  constructor(
    private readonly builtin: HarnessBuiltinToolCaller,
    private readonly harness: HarnessGateway,
  ) {}

  listTools(): string[] {
    const merged = [...this.builtin.listTools(), ...this.harness.listChannelTools()];
    return filterForToolSurface(merged, this.harness);
  }

  getToolInstructions(): string {
    const parts: string[] = [];
    if (!mcpAndChannelOnly(this.harness)) {
      parts.push(this.builtin.getToolInstructions());
    } else {
      parts.push(
        [
          '## MCP-only tool surface',
          'Built-in gateway tools are hidden. Use MCP tools and channel output tools only.',
        ].join('\n'),
      );
    }
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
    const merged = this.harness.enabled ? [...defs, ...harnessToolDefinitions()] : defs;
    const names = new Set(filterForToolSurface(merged.map((d) => d.name), this.harness));
    return merged.filter((d) => names.has(d.name));
  }

  async call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult> {
    if (mcpAndChannelOnly(this.harness) && call.name.startsWith('anvio_tools__')) {
      return {
        name: call.name,
        output: null,
        status: 'failed',
        error: 'Built-in tools unavailable in mcp_and_channel tool surface mode',
      };
    }
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
