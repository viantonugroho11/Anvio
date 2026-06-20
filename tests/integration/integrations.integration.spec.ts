import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { BlueprintExecutor, createCatalogRegistry } from '@anvio/blueprints';
import { createIntegrationRegistry, createMcpBridge } from '@anvio/integrations';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { stringify as stringifyYaml } from 'yaml';

describe('Integration Framework (MCP-first)', () => {
  let tmpDir: string;
  let repoRoot: string;
  let storage: FilesystemStorageProvider;

  beforeEach(async () => {
    repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-mcp-'));
    await Workspace.init(tmpDir);
    storage = new FilesystemStorageProvider(tmpDir);

    await storage.write(
      'mcp/servers.yaml',
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'McpConfig',
        metadata: { name: 'default' },
        spec: {
          servers: {
            github: {
              command: 'npx',
              args: ['-y', '@modelcontextprotocol/server-github'],
              env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
              enabled: true,
              transport: 'stub',
            },
            atlassian: {
              command: 'npx',
              args: ['-y', '@atlassian/mcp-server'],
              enabled: false,
            },
          },
        },
      }),
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('registers MCP servers and lists enabled integrations', async () => {
    const registry = createIntegrationRegistry(storage);
    const entries = await registry.list();
    expect(entries.some((e) => e.id === 'github' && e.enabled)).toBe(true);
    expect(entries.find((e) => e.id === 'atlassian')?.enabled).toBe(false);
  });

  it('lists tools for enabled server', async () => {
    const registry = createIntegrationRegistry(storage);
    const bridge = createMcpBridge(registry);
    const result = await bridge.testServer('github');
    expect(result.ok).toBe(true);
    expect(result.tools.length).toBeGreaterThan(0);
  });

  it('skips disabled integration on tool call', async () => {
    const registry = createIntegrationRegistry(storage);
    const bridge = createMcpBridge(registry);
    const result = await bridge.callTool({
      serverId: 'atlassian',
      toolName: 'create_jira_issue',
    });
    expect(result.status).toBe('skipped');
  });

  it('blueprint mcp step invokes bridge', async () => {
    const registry = createIntegrationRegistry(storage);
    const bridge = createMcpBridge(registry);
    const catalog = createCatalogRegistry(tmpDir, repoRoot);
    const executor = new BlueprintExecutor({ catalog, mcpBridge: bridge });

    const result = await executor.executeDefinition(
      {
        apiVersion: 'anvio.io/v1',
        kind: 'Blueprint',
        metadata: { slug: 'mcp-test', version: '1.0.0' },
        spec: {
          description: 'test',
          inputs: {},
          steps: [{ id: 'gh', type: 'mcp', server: 'github', tool: 'search_code' }],
        },
      },
      {},
      { dryRun: false },
    );

    expect(result.steps[0]?.status).toBe('completed');
    expect(result.steps[0]?.output).toContain('github');
  });
});
