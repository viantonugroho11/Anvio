import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemStorageProvider } from '@anvio/storage';
import { IntegrationRegistry } from './integration-registry.js';

describe('IntegrationRegistry upsert/remove (ADR-0036)', () => {
  let dir: string;
  let storage: FilesystemStorageProvider;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'anvio-mcp-'));
    storage = new FilesystemStorageProvider(dir);
  });
  afterEach(async () => {
    delete process.env.ANVIO_TEST_MCP_SECRET;
    await rm(dir, { recursive: true, force: true });
  });

  it('creates servers.yaml when absent and persists the server', async () => {
    const registry = new IntegrationRegistry(storage);
    await registry.upsert('fs', {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: {},
      enabled: true,
      transport: 'stdio',
    });

    const reloaded = new IntegrationRegistry(storage);
    expect((await reloaded.get('fs'))?.server.command).toBe('npx');
  });

  it('never writes expanded ${ENV} secrets of other servers back to disk', async () => {
    process.env.ANVIO_TEST_MCP_SECRET = 'super-secret';
    await storage.write(
      'mcp/servers.yaml',
      [
        'apiVersion: anvio.io/v1',
        'kind: McpConfig',
        'metadata: { name: default }',
        'spec:',
        '  servers:',
        '    gh:',
        '      command: npx',
        '      env: { TOKEN: "${ANVIO_TEST_MCP_SECRET}" }',
      ].join('\n'),
    );
    const registry = new IntegrationRegistry(storage);
    expect((await registry.get('gh'))?.server.env.TOKEN).toBe('super-secret');

    await registry.upsert('fs', {
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
      transport: 'stdio',
    });

    const raw = (await storage.read('mcp/servers.yaml')) ?? '';
    expect(raw).not.toContain('super-secret');
    expect(raw).toContain('${ANVIO_TEST_MCP_SECRET}');
  });

  it('remove reports whether the server existed', async () => {
    const registry = new IntegrationRegistry(storage);
    await registry.upsert('fs', {
      command: 'npx',
      args: [],
      env: {},
      enabled: true,
      transport: 'stdio',
    });
    expect(await registry.remove('fs')).toBe(true);
    expect(await registry.remove('fs')).toBe(false);
    expect(await registry.list()).toEqual([]);
  });
});
