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
import { HOST_ONLY_TOOLS, REMOTE_ROUTED_TOOLS, runRemoteTool } from './remote-dispatch.js';
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
    a2a_delegate:
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
    mcp_manage:
      enabled: false
    spotify_search:
      enabled: false
    feishu_doc_read:
      enabled: false
    rl_tool:
      enabled: false
    yb_tool:
      enabled: false
    honcho_tool:
      enabled: false
    skill_call:
      enabled: true
  webSearch:
    provider: brave
    apiKeyEnv: WEB_SEARCH_API_KEY
  # web_fetch / web_extract / http_request refuse loopback, private and metadata
  # addresses unless allowed here.
  network:
    allowPrivateNetwork: false
    allowHosts: []
`;

export interface ToolGatewayCallContext {
  sessionId: string;
  agentId: string;
  userId?: string;
  soul?: SoulDefinition;
  /** Aborted when the agent run is stopped. */
  signal?: AbortSignal;
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

  /**
   * Loads `tools/gateway.yaml`, or the built-in defaults when the file does not exist.
   *
   * A file that exists but cannot be parsed or validated is an error. It used to
   * fall back to the defaults silently, which re-enabled tools the operator had
   * switched off with a typo-ed file (audit CQ-012).
   */
  static async load(workspaceRoot: string, ctx: BuiltinToolContext = {}): Promise<ToolGateway> {
    const filePath = path.join(workspaceRoot, 'tools/gateway.yaml');
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return new ToolGateway(parseToolGatewayConfig(parseYaml(DEFAULT_TOOL_GATEWAY_YAML)).spec, {
        workspaceRoot,
        ...ctx,
      });
    }
    try {
      return new ToolGateway(parseToolGatewayConfig(parseYaml(raw)).spec, { workspaceRoot, ...ctx });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid tool gateway config ${filePath}: ${reason}`, { cause: error });
    }
  }

  setOnToolCompleted(handler: ToolCompletedHandler | undefined): void {
    this.onToolCompleted = handler;
  }

  /** Boot-time wiring only: the context is shared by every session using this gateway. */
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

  private async dispatch(
    call: BuiltinToolCall,
    runtimeCtx?: ToolGatewayCallContext,
  ): Promise<BuiltinToolResult> {
    const toolKey = call.name.replace(/^anvio_tools__/, '');
    const target =
      runtimeCtx?.sessionId && this.ctx.resolveExecTarget
        ? await this.ctx.resolveExecTarget(runtimeCtx.sessionId, runtimeCtx.userId)
        : undefined;
    if (target) {
      if (!this.spec.enabled || !this.spec.tools[toolKey as keyof ToolGatewaySpec['tools']]?.enabled) {
        return { name: call.name, output: null, status: 'skipped', error: 'Tool disabled' };
      }
      if (REMOTE_ROUTED_TOOLS.has(toolKey)) return runRemoteTool(target, toolKey, call);
      if (HOST_ONLY_TOOLS.has(toolKey)) {
        return {
          name: call.name,
          output: null,
          status: 'failed',
          error: `${toolKey} runs on the Anvio host and is unavailable while this session is bound to ${target.label} (/remote off to use it)`,
        };
      }
    }
    return runBuiltinTool(this.spec, call, {
      ...this.ctx,
      userId: runtimeCtx?.userId,
      sessionId: runtimeCtx?.sessionId,
      agentId: runtimeCtx?.agentId,
      signal: runtimeCtx?.signal,
    });
  }

  async call(
    call: BuiltinToolCall,
    runtimeCtx?: ToolGatewayCallContext,
  ): Promise<BuiltinToolResult> {
    const result = await this.dispatch(call, runtimeCtx);
    if (runtimeCtx && result.status === 'completed' && this.onToolCompleted) {
      // The tool already ran. A failing observer must not turn that into a failed
      // call, or the model retries a side effect that happened (audit CQ-032).
      try {
        await this.onToolCompleted(runtimeCtx, call, result);
      } catch (error) {
        console.error(
          `[tools] onToolCompleted hook failed for ${call.name}:`,
          error instanceof Error ? (error.stack ?? error.message) : error,
        );
      }
    }
    return result;
  }
}

export { REMOTE_ROUTED_TOOLS, HOST_ONLY_TOOLS, runRemoteTool } from './remote-dispatch.js';
export { runBuiltinTool, webFetch, webSearch } from './builtins/index.js';
