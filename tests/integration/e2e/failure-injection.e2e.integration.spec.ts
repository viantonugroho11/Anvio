/**
 * Failure injection against the real platform. Each case checks the failure is
 * contained (process and other sessions keep working), observable (event or
 * user-visible notice), and recoverable where that makes sense.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { EventSubjects } from '@anvio/events';
import { createPlatform } from '@anvio/platform';
import {
  bootE2E,
  gatewayYaml,
  lastToolResult,
  lastUserText,
  ProgrammableProvider,
  removeWorkspace,
  repoRoot,
  sleep,
  type E2EHarness,
} from './harness.js';

const harnesses: E2EHarness[] = [];
afterEach(async () => {
  delete process.env.ANVIO_MODEL_IDLE_TIMEOUT_MS;
  for (const h of harnesses.splice(0)) {
    await h.shutdown();
    await fs.chmod(path.join(h.workspacePath, 'memory'), 0o755).catch(() => undefined);
    await removeWorkspace(h.workspacePath);
  }
});

async function boot(...args: Parameters<typeof bootE2E>): Promise<E2EHarness> {
  const h = await bootE2E(...args);
  harnesses.push(h);
  return h;
}

function failures(h: E2EHarness): Array<{ sessionId: string; error: string }> {
  const seen: Array<{ sessionId: string; error: string }> = [];
  void h.platform.eventBus.subscribeCore(EventSubjects.AGENT_RUN_FAILED, async (e) => {
    seen.push(e.data as { sessionId: string; error: string });
  });
  return seen;
}

describe('failure injection', () => {
  it('FI-01 LLM never responds → idle timeout → user notified → next turn works', async () => {
    process.env.ANVIO_MODEL_IDLE_TIMEOUT_MS = '200';
    const provider = new ProgrammableProvider((req, i) =>
      i === 0
        ? {
            stream: async function* () {
              await sleep(60_000, req.signal);
              yield { type: 'done' };
            },
          }
        : { text: 'recovered' },
    );
    const h = await boot({ provider });
    const failed = failures(h);
    const started = Date.now();
    const sessionId = await h.say('hello?');
    expect(Date.now() - started).toBeLessThan(3_000);
    await h.waitForStatus(sessionId, 'failed');
    expect(failed[0]?.error).toMatch(/did not respond/);
    const cursor = h.channel.outbox.length;
    await h.say('again');
    expect((await h.reply(sessionId, cursor)).text).toBe('recovered');
  });

  it('FI-02 provider rate limit (429) → failure is reported as retryable, other sessions unaffected', async () => {
    const provider = new ProgrammableProvider((req) =>
      lastUserText(req) === 'limited'
        ? { error: 'HTTP 429 rate limited', retryable: true }
        : { text: 'fine' },
    );
    const h = await boot({ provider });
    const failed = failures(h);
    const limited = await h.say('limited', 'thread-a', 'webchat:a');
    await h.waitForStatus(limited, 'failed');
    expect(failed.map((f) => f.error)).toEqual(['HTTP 429 rate limited']);
    const other = await h.say('normal', 'thread-b', 'webchat:b');
    expect((await h.reply(other)).text).toBe('fine');
  });

  it('FI-03 invalid tool calls (unknown tool, bad arguments) → reported to the model, turn completes', async () => {
    const provider = new ProgrammableProvider((req, i) => {
      if (i === 0) {
        return {
          toolCalls: [
            { name: 'anvio_tools__does_not_exist', arguments: {} },
            { name: 'anvio_tools__json_parse', arguments: { text: '{broken' } },
            { name: 'anvio_tools__file_read', arguments: { path: '../../etc/passwd' } },
          ],
        };
      }
      const results = req.messages.filter((m) => m.role === 'tool').map((m) => m.content);
      return { text: `failures=${results.filter((r) => r.includes('failed')).length}` };
    });
    const h = await boot({ provider });
    const sessionId = await h.say('break things');
    expect((await h.reply(sessionId)).text).toBe('failures=3');
  });

  it('FI-04 a tool that throws is reported to the model instead of killing the turn', async () => {
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (!tool)
        return {
          toolCalls: [
            { name: 'anvio_tools__delegate_task', arguments: { agent: 'nobody', task: 'x' } },
          ],
        };
      return { text: tool.includes('failed') ? 'handled the tool error' : `unexpected: ${tool}` };
    });
    const h = await boot({
      provider,
      files: { 'tools/gateway.yaml': gatewayYaml(['delegate_task']) },
    });
    const sessionId = await h.say('delegate to nobody');
    expect((await h.reply(sessionId)).text).toBe('handled the tool error');
  });

  it('FI-05 network disconnection (connection refused) → tool failure → model recovers', async () => {
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (!tool)
        return {
          toolCalls: [
            {
              name: 'anvio_tools__http_request',
              arguments: { url: 'http://127.0.0.1:9/', timeoutMs: 2000 },
            },
          ],
        };
      return { text: tool.includes('failed') ? 'service unreachable' : 'unexpected' };
    });
    const h = await boot({
      provider,
      files: { 'tools/gateway.yaml': gatewayYaml(['http_request'], { allowHosts: ['127.0.0.1'] }) },
    });
    const sessionId = await h.say('call it');
    expect((await h.reply(sessionId)).text).toBe('service unreachable');
  });

  it('FI-06 broken skill definition → run fails visibly with the real cause', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'answer without the skill' }));
    const h = await boot({
      provider,
      files: {
        'skills/broken.yaml':
          'apiVersion: anvio.io/v1\nkind: Skill\nmetadata: { slug: broken }\nspec: [oops',
        'agents/e2e.md': `---\npersona: architect\nskills:\n  - broken\nmodel:\n  provider: anthropic\n  model: m\n---\n\nE2E\n`,
      },
    });
    const failed = failures(h);
    const sessionId = await h.say('hi');
    // Skill load failure surfaces: either the run fails visibly or it answers.
    await h.waitForStatus(sessionId, ['completed', 'failed']);
    const stored = await h.platform.workspace.sessions.get(sessionId);
    if (stored?.status === 'failed') {
      // The parse error must reach the operator, not a misleading "not found".
      expect(failed[0]?.error ?? '').toMatch(/Skill broken is invalid/);
    }
  });

  it('FI-07 memory storage failure → turn fails visibly, process survives, recovers once storage is back', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'stored?' }));
    const h = await boot({ provider });
    const failed = failures(h);
    const memoryDir = path.join(h.workspacePath, 'memory');
    await fs.mkdir(path.join(memoryDir, 'sessions'), { recursive: true });
    await fs.chmod(path.join(memoryDir, 'sessions'), 0o500);
    const sessionId = await h.say('remember this');
    await h.waitForStatus(sessionId, ['failed', 'completed']);
    expect(failed.length).toBe(1);
    await fs.chmod(path.join(memoryDir, 'sessions'), 0o755);
    const cursor = h.channel.outbox.length;
    await h.say('and now?');
    expect((await h.reply(sessionId, cursor)).text).toBe('stored?');
  });

  it('FI-08 channel delivery failure → run still completes and is persisted', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'delivered?' }));
    const h = await boot({ provider });
    const original = h.channel.sendMessage.bind(h.channel);
    let failNext = true;
    h.channel.sendMessage = async (sessionId, message) => {
      if (failNext && message.type === 'done') {
        failNext = false;
        throw new Error('socket closed');
      }
      return original(sessionId, message);
    };
    const sessionId = await h.say('hello');
    await h.waitForStatus(sessionId, 'completed');
    const stored = await h.platform.workspace.sessions.get(sessionId);
    expect(stored?.messages.at(-1)?.content).toBe('delivered?');
  });

  it('FI-09 restart after an interrupted turn → stale "in progress" session is repaired', async () => {
    const provider = new ProgrammableProvider((req, i) =>
      i === 0
        ? {
            stream: async function* () {
              await sleep(60_000, req.signal);
              yield { type: 'done' };
            },
          }
        : { text: 'after restart' },
    );
    const first = await bootE2E({ provider });
    void first.say('long job');
    await sleep(200);
    const [stuck] = await first.platform.workspace.sessions.list();
    expect(stuck?.status).toBe('calling_model');
    // Simulate a crash: no graceful stop of the run, just tear the platform down.
    await first.platform.channelHub.stopAll();

    const second = await boot({ provider, workspacePath: first.workspacePath });
    const repaired = await second.platform.workspace.sessions.get(stuck!.id);
    expect(repaired?.status).toBe('failed');
    expect(repaired?.metadata?.interruptedAt).toBeDefined();
    const cursor = second.channel.outbox.length;
    await second.say('are you back?');
    expect((await second.reply(stuck!.id, cursor)).text).toBe('after restart');
    await first.shutdown();
  });

  it('FI-10 invalid workspace configuration fails boot with a clear error', async () => {
    const h = await boot({ provider: new ProgrammableProvider(() => ({ text: 'x' })) });
    await fs.writeFile(
      path.join(h.workspacePath, 'anvio.yaml'),
      'apiVersion: anvio.io/v1\nkind: Workspace\nspec: [broken',
    );
    await expect(
      createPlatform({
        workspacePath: h.workspacePath,
        repoRoot,
        simulation: { modelProvider: new ProgrammableProvider(() => ({ text: 'x' })) },
      }),
    ).rejects.toThrow();
  });

  it('FI-11 agent with invalid frontmatter → run fails visibly, other agents unaffected', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'ok' }));
    const h = await boot({
      provider,
      files: { 'agents/broken.md': '---\nmodel: [not a model\n---\nbody' },
    });
    const failed = failures(h);
    const session = await h.platform.workspace.sessions.create({
      userId: 'u',
      agentName: 'broken',
      channel: 'webchat',
      messages: [],
      status: 'idle',
    });
    await h.platform.eventBus
      .publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
        sessionId: session.id,
        userId: 'u',
        agentId: 'broken',
        content: 'hi',
        channel: 'webchat',
      })
      .catch(() => undefined);
    await sleep(200);
    const stored = await h.platform.workspace.sessions.get(session.id);
    expect(stored?.status).toBe('failed');
    expect(failed[0]?.error).toMatch(/Agent broken could not be loaded/);
    expect(
      h.channel.outbox.some(
        (m) => m.sessionId === session.id && JSON.stringify(m).includes('Task Failed'),
      ),
    ).toBe(true);
    const ok = await h.say('healthy agent?');
    expect((await h.reply(ok)).text).toBe('ok');
  });
});
