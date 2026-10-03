import type { McpServerSpec } from '@anvio/core';
import {
  resolvePlaceholders,
  unwrapCallToolResult,
  type McpStdioToolDescriptor,
} from './mcp-stdio-client.js';

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

interface SseEvent {
  event: string;
  data: string;
}

const PROTOCOL_VERSION = '2025-03-26';
const REQUEST_TIMEOUT_MS = 30_000;

/** Parse a `text/event-stream` body into events. */
export async function* readSseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
    let boundary = buffer.indexOf('\n\n');
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');
      let event = 'message';
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      if (data.length > 0) yield { event, data: data.join('\n') };
    }
  }
}

function toError(message: JsonRpcMessage): Error {
  return new Error(
    `MCP error ${message.error?.code ?? ''}: ${message.error?.message ?? 'unknown'}`.trim(),
  );
}

/**
 * MCP client for remote servers (ADR-0037). Speaks Streamable HTTP; when the
 * endpoint rejects the initialize POST with a 4xx it falls back to the legacy
 * HTTP+SSE transport (GET opens the stream, `endpoint` event names the POST URL).
 * Same surface as McpStdioClient so McpBridge can pool either.
 */
export class McpHttpClient {
  private nextId = 1;
  private started = false;
  private everStarted = false;
  private restartCount = 0;
  private sessionId: string | undefined;
  private mode: 'streamable' | 'legacy' = 'streamable';
  // Legacy SSE state.
  private legacyEndpoint: string | undefined;
  private legacyAbort: AbortController | undefined;
  private readonly pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    private readonly spec: McpServerSpec,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!spec.url) throw new Error('MCP http server has no url');
  }

  private get url(): string {
    return this.spec.url!;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.spec.headers ?? {})) {
      out[key] = resolvePlaceholders(value);
    }
    return { ...out, ...extra };
  }

  async start(): Promise<void> {
    if (this.started) return;
    const init = {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'anvio', version: '1.0.0' },
    };
    try {
      this.mode = 'streamable';
      await this.request('initialize', init);
    } catch (error) {
      if (!(error instanceof HttpStatusError) || error.status < 400 || error.status >= 500)
        throw error;
      if (error.status === 401 || error.status === 403) throw error;
      this.mode = 'legacy';
      await this.openLegacyStream();
      await this.request('initialize', { ...init, protocolVersion: '2024-11-05' });
    }
    await this.notify('notifications/initialized');
    this.started = true;
    this.everStarted = true;
  }

  async listTools(): Promise<McpStdioToolDescriptor[]> {
    await this.ensureStarted();
    const result = (await this.request('tools/list', {})) as { tools?: McpStdioToolDescriptor[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureStarted();
    return unwrapCallToolResult(await this.request('tools/call', { name, arguments: args }));
  }

  getRestartCount(): number {
    return this.restartCount;
  }

  isConnected(): boolean {
    return this.started;
  }

  async close(): Promise<void> {
    this.invalidate();
    this.restartCount = 0;
  }

  invalidate(): void {
    this.legacyAbort?.abort();
    this.legacyAbort = undefined;
    this.legacyEndpoint = undefined;
    this.sessionId = undefined;
    this.started = false;
    for (const p of this.pending.values()) p.reject(new Error('MCP http client invalidated'));
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (this.everStarted) this.restartCount += 1;
    await this.start();
  }

  private async notify(method: string): Promise<void> {
    const message = { jsonrpc: '2.0', method, params: {} };
    if (this.mode === 'legacy') {
      await this.postLegacy(message);
      return;
    }
    await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.streamableHeaders(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    const message: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };
    return this.mode === 'legacy' ? this.requestLegacy(message) : this.requestStreamable(message);
  }

  private streamableHeaders(): Record<string, string> {
    return this.headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}),
      ...(this.started ? { 'MCP-Protocol-Version': PROTOCOL_VERSION } : {}),
    });
  }

  private async requestStreamable(message: JsonRpcMessage): Promise<unknown> {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: this.streamableHeaders(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 404 && this.sessionId) {
      // Server dropped our session: next call re-initialises.
      this.invalidate();
    }
    if (!response.ok) throw new HttpStatusError(response.status, await safeText(response));

    const session = response.headers.get('mcp-session-id');
    if (session) this.sessionId = session;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream') && response.body) {
      for await (const event of readSseEvents(response.body)) {
        const reply = parseJson(event.data);
        if (reply && reply.id === message.id) return settle(reply);
      }
      throw new Error(`MCP stream ended without a reply to ${message.method}`);
    }
    const reply = (await response.json()) as JsonRpcMessage | JsonRpcMessage[];
    const match = Array.isArray(reply) ? reply.find((r) => r.id === message.id) : reply;
    if (!match) throw new Error(`MCP response missing reply to ${message.method}`);
    return settle(match);
  }

  private async openLegacyStream(): Promise<void> {
    this.legacyAbort = new AbortController();
    const response = await this.fetchImpl(this.url, {
      method: 'GET',
      headers: this.headers({ Accept: 'text/event-stream' }),
      signal: this.legacyAbort.signal,
    });
    if (!response.ok || !response.body) {
      throw new HttpStatusError(response.status, await safeText(response));
    }
    const events = readSseEvents(response.body);
    const first = await withTimeout(events.next(), REQUEST_TIMEOUT_MS, 'MCP SSE endpoint event');
    if (first.done || first.value.event !== 'endpoint') {
      throw new Error('MCP SSE server did not send an endpoint event');
    }
    this.legacyEndpoint = new URL(first.value.data.trim(), this.url).toString();
    void this.pumpLegacy(events);
  }

  private async pumpLegacy(events: AsyncGenerator<SseEvent>): Promise<void> {
    try {
      for await (const event of events) {
        if (event.event !== 'message') continue;
        const reply = parseJson(event.data);
        if (reply?.id == null) continue;
        const waiter = this.pending.get(reply.id);
        if (!waiter) continue;
        this.pending.delete(reply.id);
        if (reply.error) waiter.reject(toError(reply));
        else waiter.resolve(reply.result);
      }
    } catch {
      // Aborted or dropped: fall through and fail whatever is still waiting.
    }
    this.started = false;
    for (const p of this.pending.values()) p.reject(new Error('MCP SSE stream closed'));
    this.pending.clear();
  }

  private requestLegacy(message: JsonRpcMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = message.id!;
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timeout: ${message.method}`));
      }, REQUEST_TIMEOUT_MS);
      this.postLegacy(message).catch((error: unknown) => {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private async postLegacy(message: JsonRpcMessage): Promise<void> {
    if (!this.legacyEndpoint) throw new Error('MCP SSE stream not open');
    const response = await this.fetchImpl(this.legacyEndpoint, {
      method: 'POST',
      headers: this.headers({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new HttpStatusError(response.status, await safeText(response));
  }
}

export class HttpStatusError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`MCP HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
  }
}

function settle(reply: JsonRpcMessage): unknown {
  if (reply.error) throw toError(reply);
  return reply.result;
}

function parseJson(text: string): JsonRpcMessage | null {
  try {
    return JSON.parse(text) as JsonRpcMessage;
  } catch {
    return null;
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createMcpHttpClient(spec: McpServerSpec, fetchImpl?: typeof fetch): McpHttpClient {
  return new McpHttpClient(spec, fetchImpl);
}
