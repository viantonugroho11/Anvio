import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
  BuiltinToolCall,
  BuiltinToolResult,
  ModelToolDefinition,
  SoulDefinition,
  ToolGatewaySpec,
} from '@anvio/core';
import { parseToolGatewayConfig } from '@anvio/core';
import { runBuiltinTool, type BuiltinToolContext } from './builtins/index.js';
import { renderToolInstructions } from './tool-descriptions.js';
import { buildModelToolDefinitions } from './tool-schemas.js';

export const DEFAULT_TOOL_GATEWAY_YAML = `# Built-in tool gateway — Phase H
apiVersion: anvio.io/v1
kind: ToolGateway
metadata:
  name: default
spec:
  enabled: true
  tools:
    web_fetch:
      enabled: true
    web_search:
      enabled: false
    file_read:
      enabled: true
    glob_files:
      enabled: true
    grep_search:
      enabled: true
    execute_code:
      enabled: false
    browser:
      enabled: false
    image_generate:
      enabled: false
    text_to_speech:
      enabled: false
    memory_recall:
      enabled: true
    list_dir:
      enabled: true
    edit_file:
      enabled: false
    run_shell:
      enabled: false
    http_request:
      enabled: true
    path_exists:
      enabled: true
    file_delete:
      enabled: false
    append_file:
      enabled: false
    json_parse:
      enabled: true
    datetime_now:
      enabled: true
    web_extract:
      enabled: true
    patch_file:
      enabled: false
    search_files:
      enabled: true
    browser_navigate:
      enabled: false
    browser_snapshot:
      enabled: false
    browser_click:
      enabled: false
    browser_type:
      enabled: false
    browser_scroll:
      enabled: false
    browser_back:
      enabled: false
    browser_press:
      enabled: false
    browser_console:
      enabled: false
    terminal:
      enabled: false
    process:
      enabled: false
    todo:
      enabled: true
    clarify:
      enabled: true
    session_search:
      enabled: true
    vision_analyze:
      enabled: false
    kanban_list:
      enabled: false
    kanban_show:
      enabled: false
    kanban_create:
      enabled: false
    kanban_move:
      enabled: false
    kanban_block:
      enabled: false
    kanban_unblock:
      enabled: false
    kanban_heartbeat:
      enabled: false
    kanban_comment:
      enabled: false
    kanban_link:
      enabled: false
    kanban_complete:
      enabled: false
    browser_get_images:
      enabled: false
    browser_vision:
      enabled: false
    browser_dialog:
      enabled: false
    browser_cdp:
      enabled: false
    delegate_task:
      enabled: false
    cronjob:
      enabled: false
    skills_list:
      enabled: true
    skill_view:
      enabled: true
    send_message:
      enabled: false
    ha_list_entities:
      enabled: false
    ha_get_state:
      enabled: false
    ha_list_services:
      enabled: false
    ha_call_service:
      enabled: false
    mixture_of_agents:
      enabled: false
    x_search:
      enabled: false
    video_analyze:
      enabled: false
    video_generate:
      enabled: false
    computer_use:
      enabled: false
    discord_admin:
      enabled: false
    skill_manage:
      enabled: false
    spotify_search:
      enabled: false
    feishu_doc_read:
      enabled: false
    rl_tool:
      enabled: false
    yb_tool:
      enabled: false
  webSearch:
    provider: brave
    apiKeyEnv: WEB_SEARCH_API_KEY
`;

export interface ToolGatewayCallContext {
  sessionId: string;
  agentId: string;
  userId?: string;
  soul?: SoulDefinition;
}

export type ToolCompletedHandler = (
  ctx: ToolGatewayCallContext,
  call: BuiltinToolCall,
  result: BuiltinToolResult,
) => void | Promise<void>;

export class ToolGateway {
  readonly spec: ToolGatewaySpec;
  private readonly ctx: BuiltinToolContext;
  private onToolCompleted?: ToolCompletedHandler;

  constructor(spec: ToolGatewaySpec, ctx: BuiltinToolContext = {}) {
    this.spec = spec;
    this.ctx = ctx;
  }

  static async load(workspaceRoot: string, ctx: BuiltinToolContext = {}): Promise<ToolGateway> {
    const filePath = path.join(workspaceRoot, 'tools/gateway.yaml');
    try {
      const raw = parseYaml(await fs.readFile(filePath, 'utf-8'));
      return new ToolGateway(parseToolGatewayConfig(raw).spec, { workspaceRoot, ...ctx });
    } catch {
      return new ToolGateway(parseToolGatewayConfig(parseYaml(DEFAULT_TOOL_GATEWAY_YAML)).spec, {
        workspaceRoot,
        ...ctx,
      });
    }
  }

  setOnToolCompleted(handler: ToolCompletedHandler | undefined): void {
    this.onToolCompleted = handler;
  }

  mergeContext(partial: BuiltinToolContext): void {
    Object.assign(this.ctx, partial);
  }

  listTools(): string[] {
    if (!this.spec.enabled) return [];
    return Object.entries(this.spec.tools)
      .filter(([, cfg]) => cfg.enabled)
      .map(([name]) => `anvio_tools__${name}`);
  }

  getToolInstructions(): string {
    return renderToolInstructions(this.listTools());
  }

  getModelToolDefinitions(): ModelToolDefinition[] {
    return buildModelToolDefinitions(this.listTools());
  }

  async call(
    call: BuiltinToolCall,
    runtimeCtx?: ToolGatewayCallContext,
  ): Promise<BuiltinToolResult> {
    const result = await runBuiltinTool(this.spec, call, {
      ...this.ctx,
      userId: runtimeCtx?.userId,
      sessionId: runtimeCtx?.sessionId,
      agentId: runtimeCtx?.agentId,
    });
    if (runtimeCtx && result.status === 'completed' && this.onToolCompleted) {
      await this.onToolCompleted(runtimeCtx, call, result);
    }
    return result;
  }
}

export { runBuiltinTool, webFetch, webSearch, executeCode } from './builtins/index.js';
