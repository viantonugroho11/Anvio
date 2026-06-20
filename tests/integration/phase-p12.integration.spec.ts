import { describe, expect, it, vi, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Workspace } from '@anvio/workspace';
import { parseMcpConfig } from '@anvio/core';
import {
  applyMcpPreset,
  createIntegrationRegistry,
  createMcpBridge,
  listMcpPresets,
  loadMcpToolCatalog,
} from '@anvio/integrations';
import { FilesystemStorageProvider } from '@anvio/storage';
import { createHarnessGateway, createHarnessAwareToolPort } from '@anvio/harness';
import { ToolGateway } from '@anvio/tools';
import { ChannelHub } from '@anvio/channels';
import { parseHarnessConfig } from '@anvio/core';

describe('Phase P12 — MCP presets, allowlist, harness surface', () => {
  it('lists and applies MCP presets from workspace', async () => {
    const repoRoot = process.cwd();
    const presets = await listMcpPresets(path.join(repoRoot, 'workspace'));
    expect(presets).toContain('spotify');

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p12-preset-'));
    await Workspace.init(tmp);
    await fs.mkdir(path.join(tmp, 'mcp', 'presets'), { recursive: true });
    await fs.copyFile(
      path.join(repoRoot, 'workspace/mcp/presets/spotify.yaml.example'),
      path.join(tmp, 'mcp/presets/spotify.yaml.example'),
    );

    const merged = await applyMcpPreset(tmp, 'spotify');
    expect(merged).toEqual(['spotify']);

    const raw = await fs.readFile(path.join(tmp, 'mcp/servers.yaml'), 'utf-8');
    const config = parseMcpConfig(parseYaml(raw));
    expect(config.spec.servers.spotify?.command).toBe('npx');
    expect(config.spec.servers.spotify?.enabled).toBe(false);
  });

  it('filters MCP catalog by allowedTools', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p12-allow-'));
    await Workspace.init(tmp);
    const storage = new FilesystemStorageProvider(tmp);
    await storage.write(
      'mcp/servers.yaml',
      `apiVersion: anvio.io/v1
kind: McpConfig
metadata: { name: default }
spec:
  firstCallApproval: true
  servers:
    demo:
      command: echo
      args: [stub]
      transport: stub
      enabled: true
      allowedTools: [ping]
`,
    );

    const registry = createIntegrationRegistry(storage);
    await registry.load();
    const bridge = createMcpBridge(registry);
    const catalog = await loadMcpToolCatalog(bridge, [{ id: 'demo', allowedTools: ['ping'] }]);
    expect(catalog.names).toEqual(['anvio_mcp__demo__ping']);
  });

  it('harness mcp_and_channel hides built-in gateway tools', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-p12-surface-'));
    await Workspace.init(tmp);
    const hub = new ChannelHub();
    const ws = await Workspace.open(tmp);
    const harness = createHarnessGateway({
      defaults: parseHarnessConfig(
        parseYaml(`apiVersion: anvio.io/v1
kind: HarnessDefaults
metadata: { name: default }
spec:
  enabled: true
  toolSurface: mcp_and_channel
  suppressRawOutput: true
  connectBroker: { enabled: false }`),
      ).spec,
      profiles: [],
      policy: (await import('@anvio/soul-gate')).parseSoulMd('## Identity\n- Name: Test\n'),
      channelHub: hub,
      sessions: ws.sessions,
    });

    const gateway = await ToolGateway.load(tmp);
    const port = createHarnessAwareToolPort(gateway, harness);
    const tools = port.listTools();
    expect(tools.some((t) => t.startsWith('anvio_tools__'))).toBe(false);
    expect(tools).toContain('anvio_channel__reply');
    expect(tools).toContain('anvio_channel__set_status');
  });
});

describe('Phase P12 — Signal REST delivery', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.SIGNAL_CLI_REST_URL;
  });

  it('POSTs outbound message to signal-cli REST', async () => {
    process.env.SIGNAL_CLI_REST_URL = 'http://127.0.0.1:8080';

    const calls: RequestInit[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const { SignalChannel } = await import('@anvio/channels');
    const { ChannelSessionBridge } = await import('@anvio/channels');

    const sessions = {
      get: async () => ({
        id: 'sess-1',
        channelThread: { channel: 'signal' as const, threadId: '+15551234567' },
        userId: 'u1',
        agentName: 'architect',
        channel: 'signal' as const,
        messages: [],
        status: 'idle' as const,
      }),
    };

    const bridge = new ChannelSessionBridge(sessions as never, {
      defaultAgent: 'architect',
      defaultUserId: 'u1',
    });
    const channel = new SignalChannel({
      sessionBridge: bridge,
      sessions: sessions as never,
      phoneNumber: '+15559876543',
    });

    await channel.sendMessage('sess-1', {
      sessionId: 'sess-1',
      type: 'done',
      content: 'Hello Signal',
    });

    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0]?.body));
    expect(body.message).toBe('Hello Signal');
    expect(body.recipients).toEqual(['+15551234567']);
  });
});
