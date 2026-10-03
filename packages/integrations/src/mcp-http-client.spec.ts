import { describe, expect, it } from 'vitest';
import type { McpServerSpec } from '@anvio/core';
import { McpHttpClient } from './mcp-http-client.js';

const URL_ = 'https://mcp.example.com/mcp';

function spec(extra: Partial<McpServerSpec> = {}): McpServerSpec {
  return { url: URL_, transport: 'http', args: [], env: {}, headers: {}, enabled: true, ...extra };
}

interface Seen {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: { id?: number; method?: string };
}

function json(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function sse(events: string, headers: Record<string, string> = {}): Response {
  return new Response(events, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', ...headers },
  });
}

/** Streamable HTTP server stub: answers each JSON-RPC request via `answer`. */
function streamable(answer: (body: { id: number; method: string }) => Response) {
  const seen: Seen[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    seen.push({
      method: init.method ?? 'GET',
      url,
      headers: init.headers as Record<string, string>,
      body,
    });
    if (body?.id == null) return new Response(null, { status: 202 });
    return answer(body);
  }) as unknown as typeof fetch;
  return { seen, fetchImpl };
}

describe('McpHttpClient — Streamable HTTP', () => {
  it('initialises, carries the session id, and lists tools from a JSON reply', async () => {
    const { seen, fetchImpl } = streamable((body) =>
      body.method === 'initialize'
        ? json({ jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': 'sess-1' })
        : json({
            jsonrpc: '2.0',
            id: body.id,
            result: { tools: [{ name: 'search', description: 'Search' }] },
          }),
    );
    process.env.ANVIO_TEST_MCP_TOKEN = 'tok';
    const client = new McpHttpClient(
      spec({ headers: { Authorization: 'Bearer ${ANVIO_TEST_MCP_TOKEN}' } }),
      fetchImpl,
    );

    expect(await client.listTools()).toEqual([{ name: 'search', description: 'Search' }]);

    const list = seen.find((s) => s.body?.method === 'tools/list')!;
    expect(list.headers['Mcp-Session-Id']).toBe('sess-1');
    expect(list.headers.Authorization).toBe('Bearer tok');
    delete process.env.ANVIO_TEST_MCP_TOKEN;
  });

  it('reads the matching reply out of an SSE response and unwraps tool text', async () => {
    const { fetchImpl } = streamable((body) =>
      body.method === 'initialize'
        ? json({ jsonrpc: '2.0', id: body.id, result: {} })
        : sse(
            [
              'event: message',
              'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
              '',
              'event: message',
              `data: {"jsonrpc":"2.0","id":${body.id},"result":{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}}`,
              '',
              '',
            ].join('\n'),
          ),
    );
    const client = new McpHttpClient(spec(), fetchImpl);

    expect(await client.callTool('search', { q: 'x' })).toEqual({ ok: true });
  });

  it('surfaces JSON-RPC errors', async () => {
    const { fetchImpl } = streamable((body) =>
      body.method === 'initialize'
        ? json({ jsonrpc: '2.0', id: body.id, result: {} })
        : json({ jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'no such tool' } }),
    );
    const client = new McpHttpClient(spec(), fetchImpl);

    await expect(client.callTool('nope', {})).rejects.toThrow('no such tool');
  });

  it('does not fall back to legacy SSE on 401', async () => {
    const fetchImpl = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch;
    const client = new McpHttpClient(spec(), fetchImpl);

    await expect(client.listTools()).rejects.toThrow('MCP HTTP 401');
  });
});

describe('McpHttpClient — legacy HTTP+SSE fallback', () => {
  it('opens the SSE stream, posts to the endpoint, and resolves replies from the stream', async () => {
    const encoder = new TextEncoder();
    let push!: (text: string) => void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (text) => controller.enqueue(encoder.encode(text));
      },
    });
    const posts: string[] = [];

    const fetchImpl = (async (url: string, init: RequestInit) => {
      if (init.method === 'POST' && url === URL_) return new Response('use sse', { status: 405 });
      if (init.method === 'GET') {
        queueMicrotask(() => push('event: endpoint\ndata: /messages?sessionId=abc\n\n'));
        return new Response(stream, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      posts.push(url);
      const body = JSON.parse(String(init.body)) as { id?: number; method: string };
      if (body.id != null) {
        const result =
          body.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Echo' }] } : {};
        queueMicrotask(() =>
          push(
            `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: body.id, result })}\n\n`,
          ),
        );
      }
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const client = new McpHttpClient(spec(), fetchImpl);
    expect(await client.listTools()).toEqual([{ name: 'echo', description: 'Echo' }]);
    expect(posts.every((u) => u === 'https://mcp.example.com/messages?sessionId=abc')).toBe(true);
    await client.close();
  });
});
