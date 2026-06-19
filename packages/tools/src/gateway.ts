import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BuiltinToolCall, BuiltinToolResult, ToolGatewaySpec } from '@anvio/core';
import { parseToolGatewayConfig } from '@anvio/core';
import { runBuiltinTool, type BuiltinToolContext } from './builtins/index.js';

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
    execute_code:
      enabled: false
    browser:
      enabled: false
    image_generate:
      enabled: false
    text_to_speech:
      enabled: false
  webSearch:
    provider: brave
    apiKeyEnv: WEB_SEARCH_API_KEY
`;

export class ToolGateway {
  readonly spec: ToolGatewaySpec;
  private readonly ctx: BuiltinToolContext;

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

  listTools(): string[] {
    if (!this.spec.enabled) return [];
    return Object.entries(this.spec.tools)
      .filter(([, cfg]) => cfg.enabled)
      .map(([name]) => `anvio_tools__${name}`);
  }

  async call(call: BuiltinToolCall): Promise<BuiltinToolResult> {
    return runBuiltinTool(this.spec, call, this.ctx);
  }
}

export { runBuiltinTool, webFetch, webSearch, executeCode } from './builtins/index.js';
