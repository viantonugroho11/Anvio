import { z } from 'zod';

export const toolGatewayToolSchema = z.object({
  enabled: z.boolean().default(true),
  description: z.string().optional(),
});

export const toolGatewaySpecSchema = z.object({
  enabled: z.boolean().default(true),
  tools: z
    .object({
      web_fetch: toolGatewayToolSchema.prefault({}),
      web_search: toolGatewayToolSchema.prefault({ enabled: false }),
      execute_code: toolGatewayToolSchema.prefault({ enabled: false }),
      file_read: toolGatewayToolSchema.prefault({ enabled: true }),
      file_write: toolGatewayToolSchema.prefault({ enabled: false }),
      glob_files: toolGatewayToolSchema.prefault({ enabled: true }),
      grep_search: toolGatewayToolSchema.prefault({ enabled: true }),
      execute_code_pipeline: toolGatewayToolSchema.prefault({ enabled: false }),
      image_generate: toolGatewayToolSchema.prefault({ enabled: false }),
      text_to_speech: toolGatewayToolSchema.prefault({ enabled: false }),
      memory_recall: toolGatewayToolSchema.prefault({ enabled: true }),
      browser: toolGatewayToolSchema.prefault({ enabled: false }),
      list_dir: toolGatewayToolSchema.prefault({ enabled: true }),
      edit_file: toolGatewayToolSchema.prefault({ enabled: false }),
      run_shell: toolGatewayToolSchema.prefault({ enabled: false }),
      http_request: toolGatewayToolSchema.prefault({ enabled: true }),
      path_exists: toolGatewayToolSchema.prefault({ enabled: true }),
      file_delete: toolGatewayToolSchema.prefault({ enabled: false }),
      append_file: toolGatewayToolSchema.prefault({ enabled: false }),
      json_parse: toolGatewayToolSchema.prefault({ enabled: true }),
      datetime_now: toolGatewayToolSchema.prefault({ enabled: true }),
      web_extract: toolGatewayToolSchema.prefault({ enabled: true }),
      patch_file: toolGatewayToolSchema.prefault({ enabled: false }),
      search_files: toolGatewayToolSchema.prefault({ enabled: true }),
      browser_navigate: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_snapshot: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_click: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_type: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_scroll: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_back: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_press: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_console: toolGatewayToolSchema.prefault({ enabled: false }),
      terminal: toolGatewayToolSchema.prefault({ enabled: false }),
      process: toolGatewayToolSchema.prefault({ enabled: false }),
      todo: toolGatewayToolSchema.prefault({ enabled: true }),
      clarify: toolGatewayToolSchema.prefault({ enabled: true }),
      session_search: toolGatewayToolSchema.prefault({ enabled: true }),
      vision_analyze: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_list: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_show: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_create: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_move: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_block: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_unblock: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_heartbeat: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_comment: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_link: toolGatewayToolSchema.prefault({ enabled: false }),
      kanban_complete: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_get_images: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_vision: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_dialog: toolGatewayToolSchema.prefault({ enabled: false }),
      browser_cdp: toolGatewayToolSchema.prefault({ enabled: false }),
      delegate_task: toolGatewayToolSchema.prefault({ enabled: false }),
      a2a_delegate: toolGatewayToolSchema.prefault({ enabled: false }),
      cronjob: toolGatewayToolSchema.prefault({ enabled: false }),
      skills_list: toolGatewayToolSchema.prefault({ enabled: true }),
      skill_view: toolGatewayToolSchema.prefault({ enabled: true }),
      send_message: toolGatewayToolSchema.prefault({ enabled: false }),
      ha_list_entities: toolGatewayToolSchema.prefault({ enabled: false }),
      ha_get_state: toolGatewayToolSchema.prefault({ enabled: false }),
      ha_list_services: toolGatewayToolSchema.prefault({ enabled: false }),
      ha_call_service: toolGatewayToolSchema.prefault({ enabled: false }),
      mixture_of_agents: toolGatewayToolSchema.prefault({ enabled: false }),
      x_search: toolGatewayToolSchema.prefault({ enabled: false }),
      video_analyze: toolGatewayToolSchema.prefault({ enabled: false }),
      video_generate: toolGatewayToolSchema.prefault({ enabled: false }),
      computer_use: toolGatewayToolSchema.prefault({ enabled: false }),
      discord_admin: toolGatewayToolSchema.prefault({ enabled: false }),
      skill_manage: toolGatewayToolSchema.prefault({ enabled: false }),
      mcp_manage: toolGatewayToolSchema.prefault({ enabled: false }),
      spotify_search: toolGatewayToolSchema.prefault({ enabled: false }),
      feishu_doc_read: toolGatewayToolSchema.prefault({ enabled: false }),
      rl_tool: toolGatewayToolSchema.prefault({ enabled: false }),
      yb_tool: toolGatewayToolSchema.prefault({ enabled: false }),
      honcho_tool: toolGatewayToolSchema.prefault({ enabled: false }),
      skill_call: toolGatewayToolSchema.prefault({ enabled: true }),
    })
    .prefault({}),
  webSearch: z
    .object({
      provider: z.enum(['brave', 'tavily', 'mock']).default('mock'),
      apiKeyEnv: z.string().default('WEB_SEARCH_API_KEY'),
    })
    .prefault({}),
  /**
   * Egress policy for tools that fetch model-chosen URLs (web_fetch, web_extract,
   * http_request). Loopback, link-local, private and metadata addresses are refused
   * unless `allowPrivateNetwork` is set or the host is listed in `allowHosts`.
   */
  network: z
    .object({
      allowPrivateNetwork: z.boolean().default(false),
      allowHosts: z.array(z.string()).default([]),
      maxResponseBytes: z.number().int().positive().default(2_000_000),
    })
    .prefault({}),
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
