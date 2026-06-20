import type { BuiltinToolCall, BuiltinToolResult } from '../schemas/tool-gateway.schema.js';

export interface RuntimeToolContext {
  sessionId: string;
  agentId: string;
  userId?: string;
}

export interface RuntimeToolPort {
  listTools(): string[];
  getToolInstructions(): string;
  call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult>;
}
