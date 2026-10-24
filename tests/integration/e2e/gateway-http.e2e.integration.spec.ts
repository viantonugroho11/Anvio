/**
 * Real HTTP + WebSocket against the unified gateway on a loopback port.
 * Model scripted; transport, routing, worker, storage are production code.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  prepareSimulationWorkspace,
  startUnifiedGateway,
  type UnifiedGatewayHandle,
} from '@anvio/platform';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  agentMd,
  lastUserText,
  ProgrammableProvider,
  removeWorkspace,
  repoRoot,
} from './harness.js';

let handle: UnifiedGatewayHandle;
let base: string;
let workspacePath: string;
const provider = new ProgrammableProvider((req) => ({
  text: `reply to ${lastUserText(req)}`,
  delayMs: 800,
}));

beforeAll(async () => {
  workspacePath = await prepareSimulationWorkspace(path.join(repoRoot, 'workspace'));
  await fs.writeFile(path.join(workspacePath, 'agents/e2e.md'), agentMd('e2e'));
  handle = await startUnifiedGateway({
    workspacePath,
    port: 0,
    host: '127.0.0.1',
    platform: { simulation: { modelProvider: provider } },
  });
  base = `http://127.0.0.1:${handle.port}`;
}, 30_000);

afterAll(async () => {
  await handle.shutdown();
  await removeWorkspace(workspacePath);
});

async function post(
  pathname: string,
  body: string,
  timeoutMs = 3_000,
): Promise<{ status: number; json: unknown; ms: number }> {
  const started = Date.now();
  const res = await fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, ms: Date.now() - started };
}

async function waitForMessages(id: string, count: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await fetch(`${base}/api/sessions/${id}`);
    const session = (await res.json()) as { messages: Array<{ content: string }>; status: string };
    if (session.messages.length >= count) return session;
    if (Date.now() > deadline)
      throw new Error(`session ${id} has ${session.messages.length} messages`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('unified gateway over real HTTP', () => {
  it('GW-01 health endpoint', async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok', auth: false });
  });

  it('GW-02 create session → post message → 202 without waiting for the turn → reply stored', async () => {
    const created = await post('/api/sessions', JSON.stringify({ agentName: 'e2e' }));
    expect(created.status).toBe(201);
    const { id } = created.json as { id: string };
    const queued = await post(`/api/sessions/${id}/messages`, JSON.stringify({ content: 'ping' }));
    expect(queued.status).toBe(202);
    // The model takes 800 ms; "queued" must not mean "finished".
    expect(queued.ms).toBeLessThan(500);
    const session = await waitForMessages(id, 2);
    expect(session.messages.map((m) => m.content)).toEqual(['ping', 'reply to ping']);
  });

  it('GW-03 WebSocket message → streamed chunk → done', async () => {
    const created = await post('/api/sessions', JSON.stringify({ agentName: 'e2e' }));
    const { id } = created.json as { id: string };
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?sessionId=${id}`);
    const events: Array<{ type: string; content?: string; delta?: string }> = [];
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('ws error'));
    });
    const done = new Promise<void>((resolve) => {
      ws.onmessage = (ev) => {
        const event = JSON.parse(String(ev.data)) as { type: string };
        events.push(event);
        if (event.type === 'done') resolve();
      };
    });
    ws.send(JSON.stringify({ type: 'message', sessionId: id, content: 'over ws' }));
    await done;
    ws.close();
    expect(events.some((e) => e.type === 'chunk' && e.delta === 'reply to over ws')).toBe(true);
    expect(events.find((e) => e.type === 'done')?.content).toBe('reply to over ws');
  });

  it('GW-04 malformed JSON is rejected with 400, not left hanging', async () => {
    const res = await post('/api/sessions', '{"agentName": ', 2_000);
    expect(res.status).toBe(400);
    const msg = await post('/api/sessions/does-not-matter/messages', 'not json', 2_000);
    expect([400, 404]).toContain(msg.status);
  });

  it('GW-05 oversized bodies are refused with 413', async () => {
    const big = JSON.stringify({ agentName: 'e2e', pad: 'x'.repeat(2_000_000) });
    const res = await post('/api/sessions', big, 5_000);
    expect(res.status).toBe(413);
  });

  it('GW-06 unknown agent → 404; unknown route → 404; missing content → 400', async () => {
    expect((await post('/api/sessions', JSON.stringify({ agentName: 'nobody' }))).status).toBe(404);
    expect((await fetch(`${base}/api/nope`)).status).toBe(404);
    const created = await post('/api/sessions', JSON.stringify({ agentName: 'e2e' }));
    const { id } = created.json as { id: string };
    expect((await post(`/api/sessions/${id}/messages`, JSON.stringify({}))).status).toBe(400);
  });

  it('GW-07 invalid WebSocket frames get an error frame, connection stays usable', async () => {
    const created = await post('/api/sessions', JSON.stringify({ agentName: 'e2e' }));
    const { id } = created.json as { id: string };
    const ws = new WebSocket(`ws://127.0.0.1:${handle.port}/ws?sessionId=${id}`);
    await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
    const frames: string[] = [];
    ws.onmessage = (ev) => frames.push(String(ev.data));
    ws.send('{{{');
    await new Promise((r) => setTimeout(r, 200));
    expect(frames.some((f) => f.includes('Invalid message format'))).toBe(true);
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });
});
