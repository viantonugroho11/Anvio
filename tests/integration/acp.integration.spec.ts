import { describe, it, expect, afterEach } from 'vitest';
import { createAcpServer } from '@anvio/acp';

describe('ACP Editor Integration', () => {
  let server: ReturnType<typeof createAcpServer> | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  it('starts server and health endpoint responds', async () => {
    server = createAcpServer({ host: '127.0.0.1', port: 0 }, async () => ({
      sessionId: 's1',
      content: 'ok',
      status: 'completed',
    }));

    const port = await server.start();
    expect(server.getStatus().running).toBe(true);

    const health = await fetchJson(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe('ok');
    expect(health.protocol).toBe('anvio-acp/v1');
  });

  it('prompt via ACP triggers run handler', async () => {
    let called = false;
    server = createAcpServer({ host: '127.0.0.1', port: 0 }, async (req) => {
      called = true;
      return {
        sessionId: 'sess-acp',
        content: `echo: ${req.message}`,
        status: 'completed',
      };
    });

    const port = await server.start();
    const response = await fetchJson(`http://127.0.0.1:${port}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'architect', message: 'Hello ACP' }),
    });

    expect(called).toBe(true);
    expect(response.content).toBe('echo: Hello ACP');
    expect(response.sessionId).toBe('sess-acp');
  });

  it('handles disconnect gracefully on stop', async () => {
    server = createAcpServer({ host: '127.0.0.1', port: 0 }, async () => ({
      sessionId: 's',
      content: 'ok',
      status: 'completed',
    }));
    await server.start();
    await server.stop();
    expect(server.getStatus().running).toBe(false);
  });
});

async function fetchJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, init);
  return (await res.json()) as Record<string, unknown>;
}
