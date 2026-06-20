import { z } from 'zod';

export const toolGatewayToolSchema = z.object({
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});

export const toolGatewaySpecSchema = z.object({
  enabled: z.boolean().default(true),
  tools: z
    .object({
      web_fetch: toolGatewayToolSchema.default({}),
      web_search: toolGatewayToolSchema.default({ enabled: false }),
      execute_code: toolGatewayToolSchema.default({ enabled: false }),
      file_read: toolGatewayToolSchema.default({ enabled: true }),
      file_write: toolGatewayToolSchema.default({ enabled: false }),
      glob_files: toolGatewayToolSchema.default({ enabled: true }),
      grep_search: toolGatewayToolSchema.default({ enabled: true }),
      execute_code_pipeline: toolGatewayToolSchema.default({ enabled: false }),
      image_generate: toolGatewayToolSchema.default({ enabled: false }),
      text_to_speech: toolGatewayToolSchema.default({ enabled: false }),
      memory_recall: toolGatewayToolSchema.default({ enabled: true }),
      browser: toolGatewayToolSchema.default({ enabled: false }),
    })
    .default({}),
  webSearch: z
    .object({
      provider: z.enum(['brave', 'tavily', 'mock']).default('mock'),
      apiKeyEnv: z.string().default('WEB_SEARCH_API_KEY'),
    })
    .default({}),
});

export const toolGatewayConfigSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('ToolGateway'),
  metadata: z.object({ name: z.string().default('default') }),
  spec: toolGatewaySpecSchema,
});

export type ToolGatewayConfig = z.infer<typeof toolGatewayConfigSchema>;
export type ToolGatewaySpec = z.infer<typeof toolGatewaySpecSchema>;

export function parseToolGatewayConfig(input: unknown): ToolGatewayConfig {
  return toolGatewayConfigSchema.parse(input);
}

export interface BuiltinToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface BuiltinToolResult {
  name: string;
  output: unknown;
  status: 'completed' | 'failed' | 'skipped' | 'pending_approval';
  error?: string;
  approvalRequestId?: string;
}
