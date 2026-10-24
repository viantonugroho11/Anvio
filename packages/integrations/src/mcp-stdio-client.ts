import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServerSpec } from '@anvio/core';

export interface McpStdioToolDescriptor {
  name: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Shared by every MCP transport: a single text part is unwrapped (and JSON-parsed when it is JSON). */
export function unwrapCallToolResult(raw: unknown): unknown {
  const result = raw as { content?: Array<{ type: string; text?: string }>; isError?: boolean };
  const textParts = (result.content ?? [])
    .filter((part) => part.type === 'text' && part.text)
    .map((part) => part.text!);

  if (textParts.length === 1) {
    try {
      return JSON.parse(textParts[0]!);
    } catch {
      return textParts[0];
    }
  }

  return { content: result.content, isError: result.isError };
}

export function resolvePlaceholders(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? '');
}

function resolveEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(env)) {
    out[key] = resolvePlaceholders(value);
  }
  return out;
}

/** Minimal MCP client over stdio (JSON-RPC + Content-Length framing). */
/** How long one MCP request may take before it is failed. */
export const MCP_REQUEST_TIMEOUT_MS = 30_000;

export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private started = false;
  private restartCount = 0;

  constructor(
    private readonly spec: McpServerSpec,
    private readonly maxRestarts = 3,
  ) {}

  async start(): Promise<void> {
    if (this.started && this.proc) return;
    await this.spawnProcess();
  }

  private async spawnProcess(): Promise<void> {
    if (!this.spec.command) throw new Error('MCP stdio server has no command');
    const proc = spawn(this.spec.command, this.spec.args, {
      env: resolveEnv(this.spec.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc = proc;
    // Without an 'error' listener a missing binary (ENOENT) or a spawn permission
    // error is an uncaught exception, and the process guard exits the whole
    // daemon — one misconfigured MCP server took every channel down.
    const spawned = new Promise<void>((resolve, reject) => {
      proc.once('spawn', () => resolve());
      proc.once('error', reject);
    });
    proc.on('error', (error) => {
      console.error(`[mcp-stdio] ${this.spec.command}: ${error.message}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.started = false;
      if (this.proc === proc) this.proc = null;
    });
    proc.stdin.on('error', (error) => {
      // EPIPE when the server exits while a request is being written.
      console.error(`[mcp-stdio] stdin: ${error.message}`);
    });

    proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        console.error(`[mcp-stdio] ${text}`);
      }
    });

    proc.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP process exited with code ${code ?? 'unknown'}`));
      }
      this.pending.clear();
      this.started = false;
      if (this.proc === proc) this.proc = null;
    });

    await spawned;
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'anvio', version: '1.0.0' },
    });
    this.notify('notifications/initialized', {});
    this.started = true;
  }

  private async ensureRunning(): Promise<void> {
    if (this.started && this.proc?.stdin.writable) return;
    if (this.restartCount >= this.maxRestarts) {
      throw new Error(`MCP stdio max restarts (${this.maxRestarts}) exceeded`);
    }
    this.restartCount += 1;
    this.buffer = Buffer.alloc(0);
    await this.spawnProcess();
  }

  async listTools(): Promise<McpStdioToolDescriptor[]> {
    await this.ensureRunning();
    const result = (await this.request('tools/list', {})) as { tools?: McpStdioToolDescriptor[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.ensureRunning();
    return unwrapCallToolResult(await this.request('tools/call', { name, arguments: args }));
  }

  getRestartCount(): number {
    return this.restartCount;
  }

  isConnected(): boolean {
    return this.started && this.proc != null && this.proc.stdin.writable;
  }

  async close(): Promise<void> {
    this.proc?.kill();
    this.proc = null;
    this.started = false;
    this.buffer = Buffer.alloc(0);
    this.restartCount = 0;
  }

  /** Drop process state so the next request spawns a fresh MCP server. */
  invalidate(): void {
    this.proc?.kill();
    this.proc = null;
    this.started = false;
    this.buffer = Buffer.alloc(0);
    this.pending.clear();
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.send({ jsonrpc: '2.0', method, params });
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      // Cleared on settle and unref'd: a 30 s timer per request used to keep the
      // process alive after shutdown.
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`MCP request timeout: ${method}`));
      }, MCP_REQUEST_TIMEOUT_MS);
      timer.unref?.();
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      try {
        this.send({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(error as Error);
      }
    });
  }

  /**
   * MCP's stdio transport is newline-delimited JSON-RPC: one message per line, no
   * headers. This client used LSP-style `Content-Length` framing, which servers
   * built on the official SDK never answer — every request waited out its timeout
   * (post-refactoring verification, PR-02).
   */
  private send(message: JsonRpcMessage): void {
    if (!this.proc?.stdin.writable) {
      throw new Error('MCP stdio process not running');
    }
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * Parse newline-delimited messages. `Content-Length` frames are still accepted
   * on input so older non-standard servers keep working.
   */
  private drain(): void {
    for (;;) {
      if (this.buffer.subarray(0, 15).toString('utf-8').toLowerCase() === 'content-length:') {
        if (!this.drainLengthPrefixed()) return;
        continue;
      }
      const newline = this.buffer.indexOf(0x0a);
      if (newline < 0) return;
      const line = this.buffer.subarray(0, newline).toString('utf-8').trim();
      this.buffer = this.buffer.subarray(newline + 1);
      if (line) this.dispatch(line);
    }
  }

  /** Returns false when the frame is incomplete. */
  private drainLengthPrefixed(): boolean {
    const headerEnd = this.buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return false;
    const header = this.buffer.subarray(0, headerEnd).toString('utf-8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      this.buffer = this.buffer.subarray(headerEnd + 4);
      return true;
    }
    const length = Number.parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;
    if (this.buffer.length < bodyStart + length) return false;
    const body = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf-8');
    this.buffer = this.buffer.subarray(bodyStart + length);
    this.dispatch(body);
    return true;
  }

  private dispatch(text: string): void {
    let message: JsonRpcMessage;
    try {
      message = JSON.parse(text) as JsonRpcMessage;
    } catch {
      console.error(`[mcp-stdio] ignoring non-JSON output: ${text.slice(0, 200)}`);
      return;
    }
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id)!;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message));
      } else {
        pending.resolve(message.result);
      }
    }
  }
}

export function createMcpStdioClient(spec: McpServerSpec): McpStdioClient {
  return new McpStdioClient(spec);
}
