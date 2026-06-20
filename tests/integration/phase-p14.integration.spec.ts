import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { Workspace } from '@anvio/workspace';
import { parseMcpConfig } from '@anvio/core';
import { applyMcpPreset, listMcpPresets } from '@anvio/integrations';
import { browserCdp } from '@anvio/tools';
import { ChannelSessionBridge, FeishuChannel, SmsChannel } from '@anvio/channels';
import { exportSessionTrajectory } from '@anvio/platform';

describe('Phase P14 — P12 partial closure + research tooling', () => {
  it('applies all MCP presets (spotify, feishu, tinker-atropos)', async () => {
    const repoRoot = process.cwd();
    const presets = await listMcpPresets(path.join(repoRoot, 'workspace'));
    expect(presets).toEqual(expect.arrayContaining(['spotify', 'feishu', 'tinker-atropos']));

    for (const name of ['spotify', 'feishu', 'tinker-atropos'] as const) {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), `anvio-p14-${name}-`));
      await Workspace.init(tmp);
      await fs.mkdir(path.join(tmp, 'mcp', 'presets'), { recursive: true });
      await fs.copyFile(
        path.join(repoRoot, `workspace/mcp/presets/${name}.yaml.example`),
        path.join(tmp, 'mcp/presets', `${name}.yaml.example`),
      );
      const merged = await applyMcpPreset(tmp, name);
      expect(merged).toContain(name);
      const raw = await fs.readFile(path.join(tmp, 'mcp/servers.yaml'), 'utf-8');
      expect(parseMcpConfig(parseYaml(raw)).spec.servers[name]).toBeDefined();
    }
  });

  it('browser_cdp blocks extended methods without grant', async () => {
    delete process.env.ANVIO_BROWSER_CDP_GRANT;
    const result = await browserCdp('goto', { url: 'https://example.com' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/ANVIO_BROWSER_CDP_GRANT|not allowed|Playwright/i);
  });

  it('Feishu and SMS channels deliver outbound', async () => {
    const sessions = {
      get: async () => ({
        id: 's1',
        channelThread: { channel: 'sms' as const, threadId: 'sms:+15551234567' },
        metadata: { sms: { from: '+15551234567' } },
        userId: 'u1',
        agentName: 'architect',
        channel: 'sms' as const,
        messages: [],
        status: 'idle' as const,
      }),
    };
    const bridge = new ChannelSessionBridge(sessions as never, {
      defaultAgent: 'architect',
      defaultUserId: 'u1',
    });

    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const feishu = new FeishuChannel({
      sessionBridge: bridge,
      sessions: sessions as never,
      webhookUrl: 'https://feishu.test/hook',
    });
    await feishu.sendMessage('s1', { sessionId: 's1', type: 'done', content: 'Hi Feishu' });
    expect(fetchMock).toHaveBeenCalled();

    const sms = new SmsChannel({
      sessionBridge: bridge,
      sessions: sessions as never,
      accountSid: 'AC123',
      authToken: 'secret',
      fromNumber: '+15559876543',
    });
    await sms.sendMessage('s1', { sessionId: 's1', type: 'done', content: 'Hi SMS' });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);

    vi.unstubAllGlobals();
  });

  it('exports session trajectory for research', async () => {
    const trajectory = exportSessionTrajectory({
      id: 'sess-1',
      userId: 'u1',
      agentName: 'architect',
      channel: 'cli',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
      status: 'completed',
    });
    expect(trajectory.entries).toHaveLength(2);
    expect(trajectory.entries[0]?.role).toBe('user');
  });
});
