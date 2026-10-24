/**
 * E2E-01 … E2E-10: representative user workflows through the real platform.
 * Model: scripted (ProgrammableProvider). Channel: SimulatedChannel. Everything
 * else — gateway worker, runtime, tool gateway, builtins, storage, memory, skills,
 * orchestration — is the production code path.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { EventSubjects } from '@anvio/events';
import {
  agentMd,
  bootE2E,
  gatewayYaml,
  lastToolResult,
  lastUserText,
  personaMd,
  ProgrammableProvider,
  removeWorkspace,
  sleep,
  type E2EHarness,
} from './harness.js';

let server: http.Server;
let base: string;
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 3_000).unref();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ temperature: 21, unit: 'C' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const harnesses: E2EHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.shutdown();
    await removeWorkspace(h.workspacePath);
  }
});

async function boot(...args: Parameters<typeof bootE2E>): Promise<E2EHarness> {
  const h = await bootE2E(...args);
  harnesses.push(h);
  return h;
}

describe('E2E workflows', () => {
  it('E2E-01 user message → agent → LLM → response', async () => {
    const provider = new ProgrammableProvider((req) => ({ text: `echo: ${lastUserText(req)}` }));
    const h = await boot({ provider });
    const sessionId = await h.say('hello agent');
    const { text } = await h.reply(sessionId);
    expect(text).toBe('echo: hello agent');
    await h.waitForStatus(sessionId, 'completed');
    const stored = await h.platform.workspace.sessions.get(sessionId);
    expect(stored?.messages.map((m) => m.content)).toEqual(['hello agent', 'echo: hello agent']);
  });

  it('E2E-02 user message → tool (real HTTP) → LLM → response', async () => {
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (!tool)
        return {
          toolCalls: [{ name: 'anvio_tools__http_request', arguments: { url: `${base}/weather` } }],
        };
      return {
        text: `tool said: ${tool.includes('"temperature": 21') || tool.includes('temperature') ? '21C' : tool}`,
      };
    });
    const h = await boot({
      provider,
      files: { 'tools/gateway.yaml': gatewayYaml(['http_request'], { allowHosts: ['127.0.0.1'] }) },
    });
    const sessionId = await h.say('what is the weather?');
    const { text } = await h.reply(sessionId);
    expect(text).toBe('tool said: 21C');
    expect(hits).toContain('GET /weather');
    expect(provider.requests).toHaveLength(2);
  });

  it('E2E-03 multiple tool calls in one round and across rounds → final response', async () => {
    const provider = new ProgrammableProvider((req, i) => {
      if (i === 0) {
        return {
          toolCalls: [
            { name: 'anvio_tools__datetime_now', arguments: {} },
            { name: 'anvio_tools__json_parse', arguments: { text: '{"a":1}' } },
          ],
        };
      }
      if (i === 1)
        return {
          toolCalls: [{ name: 'anvio_tools__file_read', arguments: { path: 'agents/e2e.md' } }],
        };
      const toolMessages = req.messages.filter((m) => m.role === 'tool');
      return { text: `saw ${toolMessages.length} tool results` };
    });
    const h = await boot({ provider });
    const sessionId = await h.say('do three things');
    const { text } = await h.reply(sessionId);
    expect(text).toBe('saw 3 tool results');
    const fileResult = provider.requests[2]!.messages.filter((m) => m.role === 'tool').at(
      -1,
    )!.content;
    expect(fileResult).toContain('e2e agent');
  });

  it('E2E-04 skill discovery → skill execution (composable YAML skill)', async () => {
    const skill = [
      'apiVersion: anvio.io/v1',
      'kind: Skill',
      'metadata:',
      '  slug: e2e-parse',
      'spec:',
      '  name: e2e-parse',
      '  description: Parse a JSON payload and optionally stamp the time',
      '  instructions: Use for JSON payloads.',
      '  composable: true',
      '  parameters:',
      '    - { name: payload, type: string }',
      '    - { name: stamp, type: boolean, required: false }',
      '  steps:',
      '    - { id: parse, action: parse, tool: json_parse, args: { text: "{{payload}}" }, output: parsed }',
      '    - { id: when, action: time, tool: datetime_now, condition: "stamp == true", output: now }',
    ].join('\n');
    const provider = new ProgrammableProvider((req, i) => {
      if (i === 0) return { toolCalls: [{ name: 'anvio_tools__skills_list', arguments: {} }] };
      if (i === 1) {
        expect(lastToolResult(req)).toContain('e2e-parse');
        return {
          toolCalls: [
            { name: 'skill__e2e-parse', arguments: { payload: '{"ok":true}', stamp: false } },
          ],
        };
      }
      return { text: `skill result: ${lastToolResult(req)}` };
    });
    const h = await boot({
      provider,
      files: {
        'skills/e2e-parse.yaml': skill,
        'agents/e2e.md': agentMd('e2e', { skills: ['e2e-parse'] }),
      },
    });
    const sessionId = await h.say('parse this');
    const { text } = await h.reply(sessionId);
    // Step outputs come back to the model; the conditional step was skipped (stamp=false).
    expect(text).toContain('skill result: Tool skill__e2e-parse result:');
    expect(text).toContain('"parsed":{"valid":true,"value":{"ok":true}}');
    expect(text).not.toContain('"now"');
  });

  it('E2E-05 memory save → process restart → memory retrieval', async () => {
    const provider = new ProgrammableProvider((req) => ({
      text: req.messages.some((m) => m.content.includes('my name is Ada'))
        ? 'I remember you, Ada'
        : 'noted',
    }));
    const first = await bootE2E({ provider });
    const sessionId = await first.say('my name is Ada');
    await first.reply(sessionId);
    await first.waitForStatus(sessionId, 'completed');
    await first.shutdown();

    // Same workspace, fresh process state.
    const second = await boot({ provider, workspacePath: first.workspacePath });
    const again = await second.say('who am I?');
    expect(again).toBe(sessionId);
    const { text } = await second.reply(again);
    expect(text).toBe('I remember you, Ada');
  });

  it('E2E-06 LLM provider failure → user is told → next message recovers', async () => {
    let fail = true;
    const provider = new ProgrammableProvider(() =>
      fail ? { error: 'HTTP 503 overloaded', retryable: true } : { text: 'back online' },
    );
    const h = await boot({ provider });
    const failed: unknown[] = [];
    await h.platform.eventBus.subscribeCore(
      EventSubjects.AGENT_RUN_FAILED,
      async (e) => void failed.push(e.data),
    );
    const sessionId = await h.say('first try');
    await h.waitForStatus(sessionId, 'failed');
    expect(failed).toHaveLength(1);
    fail = false;
    const cursor = h.channel.outbox.length;
    await h.say('second try');
    const { text } = await h.reply(sessionId, cursor);
    expect(text).toBe('back online');
    const stored = await h.platform.workspace.sessions.get(sessionId);
    expect(stored?.status).toBe('completed');
  });

  it('E2E-07 tool timeout → error reported to the model → turn completes', async () => {
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (!tool) {
        return {
          toolCalls: [
            {
              name: 'anvio_tools__http_request',
              arguments: { url: `${base}/slow`, timeoutMs: 200 },
            },
          ],
        };
      }
      return { text: tool.includes('failed') ? 'the service timed out' : 'unexpected success' };
    });
    const h = await boot({
      provider,
      files: { 'tools/gateway.yaml': gatewayYaml(['http_request'], { allowHosts: ['127.0.0.1'] }) },
    });
    const started = Date.now();
    const sessionId = await h.say('call the slow service');
    const { text } = await h.reply(sessionId);
    expect(text).toBe('the service timed out');
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it('E2E-08 channel message → agent → channel response, threads isolated', async () => {
    const provider = new ProgrammableProvider((req) => ({
      text: `history=${req.messages.filter((m) => m.role === 'user').length}`,
    }));
    const h = await boot({ provider });
    const a = await h.say('one', 'thread-a', 'webchat:alice');
    await h.reply(a);
    await h.waitForStatus(a, 'completed');
    const b = await h.say('two', 'thread-b', 'webchat:bob');
    const { text } = await h.reply(b, 0);
    expect(b).not.toBe(a);
    expect(text).toBe('history=1');
  });

  it('E2E-09 streaming response → user stops it → session reusable', async () => {
    const provider = new ProgrammableProvider((req, i) =>
      i === 0
        ? {
            stream: async function* () {
              yield { type: 'text_delta', delta: 'partial…' };
              await sleep(10_000, req.signal);
              yield { type: 'done' };
            },
          }
        : { text: 'fresh answer' },
    );
    const h = await boot({ provider });
    const chunks: string[] = [];
    await h.platform.eventBus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async (e) => {
      chunks.push((e.data as { delta: string }).delta);
    });
    const sayPromise = h.say('long answer please');
    const deadline = Date.now() + 3_000;
    while (!chunks.includes('partial…') && Date.now() < deadline) await sleep(10);
    expect(chunks).toContain('partial…');
    const [stored] = await h.platform.workspace.sessions.list();
    const started = Date.now();
    await h.platform.eventBus.publish(
      EventSubjects.AGENT_RUN_STOP_REQUESTED,
      'anvio.agent.run.stop',
      {
        sessionId: stored!.id,
      },
    );
    const sessionId = await sayPromise;
    expect(Date.now() - started).toBeLessThan(2_000);
    await h.waitForStatus(sessionId, 'failed');
    const cursor = h.channel.outbox.length;
    await h.say('try again');
    const { text } = await h.reply(sessionId, cursor);
    expect(text).toBe('fresh answer');
  });

  it('E2E-10 multi-agent delegation → sub-agent result aggregated by the manager', async () => {
    const provider = new ProgrammableProvider((req) => {
      const system = req.systemPrompt ?? '';
      if (system.includes('You are researcher')) return { text: 'research: 42 sources' };
      const tool = lastToolResult(req);
      if (!tool) {
        return {
          toolCalls: [
            {
              name: 'anvio_tools__delegate_task',
              arguments: { agent: 'researcher', task: 'find sources' },
            },
          ],
        };
      }
      return {
        text: `manager summary <${tool.includes('42 sources') ? 'got sub-agent result' : tool}>`,
      };
    });
    const h = await boot({
      provider,
      files: {
        'agents/researcher.md': agentMd('researcher', { persona: 'researcher' }),
        'personas/researcher.md': personaMd('researcher', 'You are researcher.'),
        'tools/gateway.yaml': gatewayYaml(['delegate_task']),
      },
    });
    const sessionId = await h.say('research this');
    const { text } = await h.reply(sessionId, 0, 10_000);
    expect(text).toBe('manager summary <got sub-agent result>');
    const sessions = await h.platform.workspace.sessions.list();
    expect(sessions.some((s) => s.agentName === 'researcher')).toBe(true);
  });
});
