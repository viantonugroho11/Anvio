/**
 * MCP over a real stdio child process running a server built with the official
 * @modelcontextprotocol/sdk, reached through the agent loop, including the
 * first-use human approval → resume path.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { McpStdioClient } from '@anvio/integrations';
import {
  bootE2E,
  lastToolResult,
  ProgrammableProvider,
  removeWorkspace,
  type E2EHarness,
} from './harness.js';

const officialServer = path.join(__dirname, 'fixtures/official-mcp-server.mjs');

/**
 * Approvers are matched from SOUL.md. Only slack/telegram/whatsapp/discord/cli ids
 * are recognised there, so these tests run on a Slack thread.
 */
const APPROVER = 'slack:U_APPROVER1';

const SOUL = [
  '# Architect Soul',
  '## Identity',
  '- Name: Architect Soul',
  '## Reporting',
  '- Manager: slack:U_APPROVER1',
  '## Trusted channels',
  '- C0E2E',
  '## Approvers',
  '- slack:U_APPROVER1: anything ; catchall',
].join('\n');

function mcpConfig(tag?: string): string {
  return stringifyYaml({
    apiVersion: 'anvio.io/v1',
    kind: 'McpConfig',
    metadata: { name: 'default' },
    spec: {
      servers: {
        calc: {
          command: process.execPath,
          args: tag ? [officialServer, tag] : [officialServer],
          enabled: true,
          transport: 'stdio',
        },
      },
    },
  });
}

const harnesses: E2EHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.shutdown();
    await removeWorkspace(h.workspacePath);
  }
});

describe('MCP (official SDK server over stdio)', () => {
  it('MCP-01 client lists and calls tools on an official-SDK server', async () => {
    const client = new McpStdioClient({
      command: process.execPath,
      args: [officialServer],
      env: {},
    } as never);
    try {
      await client.start();
      const tools = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['add', 'whoami']);
      // Text content is unwrapped and JSON-decoded by the client.
      expect(await client.callTool('add', { a: 2, b: 40 })).toBe(42);
    } finally {
      await client.close();
    }
  }, 20_000);

  it('MCP-02 agent → MCP tool → first-use approval → approve → resume → answer', async () => {
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (
        !tool ||
        tool.includes('awaiting human approval') ||
        req.messages.at(-1)?.content.includes('approval granted')
      ) {
        if (tool?.includes('result:\n42')) return { text: `answer: 42` };
        return { toolCalls: [{ name: 'anvio_mcp__calc__add', arguments: { a: 40, b: 2 } }] };
      }
      return { text: `answer: ${tool.includes('42') ? '42' : tool}` };
    });
    const h = await bootE2E({
      provider,
      files: { 'mcp/servers.yaml': mcpConfig(), 'souls/architect-soul/SOUL.md': SOUL },
      channelType: 'slack',
    });
    harnesses.push(h);

    const sessionId = await h.say('what is 40 + 2?', 'C0E2E', APPROVER);
    const approval = await h.channel.waitFor(
      (e) => e.sessionId === sessionId && e.kind === 'approval',
      10_000,
    );
    expect(approval.kind === 'approval' && approval.toolName).toBe('anvio_mcp__calc__add');
    await h.waitForStatus(sessionId, 'awaiting_approval');

    const cursor = h.channel.outbox.length;
    const outcome = await h.channel.decideApproval(
      sessionId,
      approval.kind === 'approval' ? approval.requestId : '',
      true,
      APPROVER,
    );
    expect(outcome.status).toBe('resolved');
    const { text } = await h.reply(sessionId, cursor, 15_000);
    expect(text).toBe('answer: 42');
    await h.waitForStatus(sessionId, 'completed');
  }, 40_000);

  it('MCP-03 rejected approval → mutating MCP call is not executed', async () => {
    let mcpCalled = false;
    const provider = new ProgrammableProvider((req) => {
      const last = req.messages.at(-1)?.content ?? '';
      if (last.includes('approval denied')) return { text: 'ok, not doing it' };
      if (lastToolResult(req)?.includes('result:')) mcpCalled = true;
      return { toolCalls: [{ name: 'anvio_mcp__calc__add', arguments: { a: 1, b: 1 } }] };
    });
    const h = await bootE2E({
      provider,
      files: { 'mcp/servers.yaml': mcpConfig(), 'souls/architect-soul/SOUL.md': SOUL },
      channelType: 'slack',
    });
    harnesses.push(h);
    const sessionId = await h.say('add one and one', 'C0E2E', APPROVER);
    const approval = await h.channel.waitFor(
      (e) => e.sessionId === sessionId && e.kind === 'approval',
      10_000,
    );
    const cursor = h.channel.outbox.length;
    await h.channel.decideApproval(
      sessionId,
      approval.kind === 'approval' ? approval.requestId : '',
      false,
      APPROVER,
    );
    const { text } = await h.reply(sessionId, cursor, 15_000);
    expect(text).toBe('ok, not doing it');
    expect(mcpCalled).toBe(false);
  }, 40_000);

  it('MCP-04 a broken MCP server does not stop the platform from booting or answering', async () => {
    const broken = stringifyYaml({
      apiVersion: 'anvio.io/v1',
      kind: 'McpConfig',
      metadata: { name: 'default' },
      spec: {
        servers: {
          ghost: {
            command: '/nonexistent/mcp-binary',
            args: [],
            enabled: true,
            transport: 'stdio',
          },
        },
      },
    });
    const provider = new ProgrammableProvider(() => ({ text: 'still here' }));
    const h = await bootE2E({ provider, files: { 'mcp/servers.yaml': broken } });
    harnesses.push(h);
    const sessionId = await h.say('hi');
    expect((await h.reply(sessionId)).text).toBe('still here');
  }, 30_000);

  it('MCP-05 platform shutdown stops the MCP server processes it spawned', async () => {
    const tag = `--e2e-tag=${randomUUID()}`;
    const running = (): number => {
      try {
        return execFileSync('pgrep', ['-f', '--', tag], { encoding: 'utf-8' })
          .trim()
          .split('\n')
          .filter(Boolean).length;
      } catch {
        return 0; // pgrep exits 1 when nothing matches
      }
    };
    const provider = new ProgrammableProvider(() => ({ text: 'up' }));
    const h = await bootE2E({ provider, files: { 'mcp/servers.yaml': mcpConfig(tag) } });
    expect(running()).toBeGreaterThan(0);
    await h.shutdown();
    const deadline = Date.now() + 3_000;
    while (running() > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(running()).toBe(0);
    await removeWorkspace(h.workspacePath);
  }, 30_000);
});
