import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createIntegrationRegistry, createMcpBridge, createMcpFirstCallGate, createMcpToolPort } from '@anvio/integrations';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { stringify as stringifyYaml } from 'yaml';

describe('Phase P7 — MCP first-call approval', () => {
  let tmpDir: string;
  let storage: FilesystemStorageProvider;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p7-'));
    await Workspace.init(tmpDir);
    storage = new FilesystemStorageProvider(tmpDir);
    await storage.write(
      'mcp/servers.yaml',
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'McpConfig',
        metadata: { name: 'default' },
        spec: {
          firstCallApproval: true,
          servers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              enabled: true,
            },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('returns pending_approval on first MCP tool call', async () => {
    const registry = createIntegrationRegistry(storage);
    await registry.load();
    const bridge = createMcpBridge(registry);
    const gate = createMcpFirstCallGate({ enabled: true });
    const inner = {
      listTools: () => [],
      getToolInstructions: () => '',
      call: async () => ({ name: 'x', output: null, status: 'skipped' as const }),
    };
    const port = createMcpToolPort(inner, {
      mcpBridge: bridge,
      gate,
      mcpToolNames: ['anvio_mcp__github__search_code'],
    });

    const first = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: { query: 'anvio' } },
      { sessionId: 'sess-1', agentId: 'architect', userId: 'u1' },
    );
    expect(first.status).toBe('pending_approval');
    expect(first.approvalRequestId).toBeTruthy();

    await gate.approve('sess-1', 'github', 'search_code');
    const second = await port.call(
      { name: 'anvio_mcp__github__search_code', arguments: { query: 'anvio' } },
      { sessionId: 'sess-1', agentId: 'architect', userId: 'u1' },
    );
    expect(second.status).toBe('completed');
  });
});
