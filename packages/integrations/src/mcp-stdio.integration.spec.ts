import { describe, expect, it, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIntegrationRegistry, createMcpBridge } from '@anvio/integrations';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { stringify as stringifyYaml } from 'yaml';
import fs from 'node:fs/promises';
import os from 'node:os';

const mockServerPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../scripts/mock-mcp-server.mjs',
);

describe('McpStdioClient', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('lists and calls tools over stdio transport', async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mcp-stdio-'));
    await Workspace.init(tmpDir);
    const storage = new FilesystemStorageProvider(tmpDir);

    await storage.write(
      'mcp/servers.yaml',
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'McpConfig',
        metadata: { name: 'default' },
        spec: {
          firstCallApproval: false,
          servers: {
            mock: {
              command: 'node',
              args: [mockServerPath],
              transport: 'stdio',
              enabled: true,
            },
          },
        },
      }),
    );

    const registry = createIntegrationRegistry(storage);
    await registry.load();
    const bridge = createMcpBridge(registry);

    const tools = await bridge.listTools('mock');
    expect(tools.some((tool) => tool.name === 'ping')).toBe(true);

    const result = await bridge.callTool({
      serverId: 'mock',
      toolName: 'ping',
      arguments: { message: 'hello' },
    });

    expect(result.status).toBe('completed');
    expect(result.transport).toBe('stdio');
    expect(result.output).toMatchObject({ ok: true, tool: 'ping' });

    await bridge.close();
  });
});
