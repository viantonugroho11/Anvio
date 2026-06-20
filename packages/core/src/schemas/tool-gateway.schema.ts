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
      list_dir: toolGatewayToolSchema.default({ enabled: true }),
      edit_file: toolGatewayToolSchema.default({ enabled: false }),
      run_shell: toolGatewayToolSchema.default({ enabled: false }),
      http_request: toolGatewayToolSchema.default({ enabled: true }),
      path_exists: toolGatewayToolSchema.default({ enabled: true }),
      file_delete: toolGatewayToolSchema.default({ enabled: false }),
      append_file: toolGatewayToolSchema.default({ enabled: false }),
      json_parse: toolGatewayToolSchema.default({ enabled: true }),
      datetime_now: toolGatewayToolSchema.default({ enabled: true }),
      web_extract: toolGatewayToolSchema.default({ enabled: true }),
      patch_file: toolGatewayToolSchema.default({ enabled: false }),
      search_files: toolGatewayToolSchema.default({ enabled: true }),
      browser_navigate: toolGatewayToolSchema.default({ enabled: false }),
      browser_snapshot: toolGatewayToolSchema.default({ enabled: false }),
      browser_click: toolGatewayToolSchema.default({ enabled: false }),
      browser_type: toolGatewayToolSchema.default({ enabled: false }),
      browser_scroll: toolGatewayToolSchema.default({ enabled: false }),
      browser_back: toolGatewayToolSchema.default({ enabled: false }),
      browser_press: toolGatewayToolSchema.default({ enabled: false }),
      browser_console: toolGatewayToolSchema.default({ enabled: false }),
      terminal: toolGatewayToolSchema.default({ enabled: false }),
      process: toolGatewayToolSchema.default({ enabled: false }),
      todo: toolGatewayToolSchema.default({ enabled: true }),
      clarify: toolGatewayToolSchema.default({ enabled: true }),
      session_search: toolGatewayToolSchema.default({ enabled: true }),
      vision_analyze: toolGatewayToolSchema.default({ enabled: false }),
      kanban_list: toolGatewayToolSchema.default({ enabled: false }),
      kanban_show: toolGatewayToolSchema.default({ enabled: false }),
      kanban_create: toolGatewayToolSchema.default({ enabled: false }),
      kanban_move: toolGatewayToolSchema.default({ enabled: false }),
      kanban_block: toolGatewayToolSchema.default({ enabled: false }),
      kanban_unblock: toolGatewayToolSchema.default({ enabled: false }),
      kanban_heartbeat: toolGatewayToolSchema.default({ enabled: false }),
      kanban_comment: toolGatewayToolSchema.default({ enabled: false }),
      kanban_link: toolGatewayToolSchema.default({ enabled: false }),
      kanban_complete: toolGatewayToolSchema.default({ enabled: false }),
      browser_get_images: toolGatewayToolSchema.default({ enabled: false }),
      browser_vision: toolGatewayToolSchema.default({ enabled: false }),
      browser_dialog: toolGatewayToolSchema.default({ enabled: false }),
      browser_cdp: toolGatewayToolSchema.default({ enabled: false }),
      delegate_task: toolGatewayToolSchema.default({ enabled: false }),
      cronjob: toolGatewayToolSchema.default({ enabled: false }),
      skills_list: toolGatewayToolSchema.default({ enabled: true }),
      skill_view: toolGatewayToolSchema.default({ enabled: true }),
      send_message: toolGatewayToolSchema.default({ enabled: false }),
      ha_list_entities: toolGatewayToolSchema.default({ enabled: false }),
      ha_get_state: toolGatewayToolSchema.default({ enabled: false }),
      ha_list_services: toolGatewayToolSchema.default({ enabled: false }),
      ha_call_service: toolGatewayToolSchema.default({ enabled: false }),
      mixture_of_agents: toolGatewayToolSchema.default({ enabled: false }),
      x_search: toolGatewayToolSchema.default({ enabled: false }),
      video_analyze: toolGatewayToolSchema.default({ enabled: false }),
      video_generate: toolGatewayToolSchema.default({ enabled: false }),
      computer_use: toolGatewayToolSchema.default({ enabled: false }),
      discord_admin: toolGatewayToolSchema.default({ enabled: false }),
      skill_manage: toolGatewayToolSchema.default({ enabled: false }),
      spotify_search: toolGatewayToolSchema.default({ enabled: false }),
      feishu_doc_read: toolGatewayToolSchema.default({ enabled: false }),
      rl_tool: toolGatewayToolSchema.default({ enabled: false }),
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
