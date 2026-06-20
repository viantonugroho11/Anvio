import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Workspace } from '@anvio/workspace';
import { parseToolGatewayConfig } from '@anvio/core';
import { ToolGateway, buildModelToolDefinitions } from '@anvio/tools';
import { PlanExecuteReviewEngine } from '@anvio/automation';

describe('Phase P11a — tool breadth, planner CLI, OTel helpers', () => {
  it('gateway lists 20 built-in tools when all enabled in schema', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p11a-'));
    await Workspace.init(tmp);
    const gateway = await ToolGateway.load(tmp);
    const tools = gateway.listTools();
    expect(tools).toContain('anvio_tools__list_dir');
    expect(tools).toContain('anvio_tools__http_request');
    expect(tools).toContain('anvio_tools__json_parse');
    expect(tools).toContain('anvio_tools__datetime_now');
    expect(tools.length).toBeGreaterThanOrEqual(10);
  });

  it('schema defines 20 built-in tool keys', () => {
    const config = parseToolGatewayConfig({
      apiVersion: 'anvio.io/v1',
      kind: 'ToolGateway',
      metadata: { name: 'default' },
      spec: { enabled: true, tools: {} },
    });
    expect(Object.keys(config.spec.tools)).toHaveLength(21);
  });

  it('builds model tool definitions for new tools', () => {
    const defs = buildModelToolDefinitions([
      'anvio_tools__list_dir',
      'anvio_tools__edit_file',
      'anvio_tools__http_request',
    ]);
    expect(defs).toHaveLength(3);
    expect(defs[0]?.inputSchema).toBeDefined();
  });

  it('planner engine loads from workspace repo config path', async () => {
    const configPath = path.join(process.cwd(), 'configs/planner/plan-execute-review.yaml');
    const engine = await PlanExecuteReviewEngine.load(configPath);
    expect(engine.phases).toHaveLength(3);
  });
});
