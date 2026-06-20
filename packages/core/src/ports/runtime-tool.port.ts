import type { BuiltinToolCall, BuiltinToolResult } from '../schemas/tool-gateway.schema.js';
import type { ModelToolDefinition } from '../types/model-tools.js';

export interface RuntimeToolContext {
  sessionId: string;
  agentId: string;
  userId?: string;
  /** Active channel for harness output/approval tools (slack, telegram, whatsapp, …). */
  channel?: string;
}

export interface RuntimeToolPort {
  listTools(): string[];
  getToolInstructions(): string;
  getModelToolDefinitions?(): ModelToolDefinition[];
  call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult>;
}
