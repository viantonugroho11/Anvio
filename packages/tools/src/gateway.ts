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
    });
    if (runtimeCtx && result.status === 'completed' && this.onToolCompleted) {
      await this.onToolCompleted(runtimeCtx, call, result);
    }
    return result;
  }
}

export { runBuiltinTool, webFetch, webSearch, executeCode } from './builtins/index.js';
