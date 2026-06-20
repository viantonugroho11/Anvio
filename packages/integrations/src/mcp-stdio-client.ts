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

function resolveEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [key, value] of Object.entries(env)) {
    out[key] = value.replace(/\$\{(\w+)\}/g, (_, name: string) => process.env[name] ?? '');
  }
  return out;
}

/** Minimal MCP client over stdio (JSON-RPC + Content-Length framing). */
export class McpStdioClient {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number | string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
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
    this.proc = spawn(this.spec.command, this.spec.args, {
      env: resolveEnv(this.spec.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.stdout.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.drain();
    });

    this.proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        console.error(`[mcp-stdio] ${text}`);
      }
    });

    this.proc.on('exit', (code) => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`MCP process exited with code ${code ?? 'unknown'}`));
      }
      this.pending.clear();
      this.started = false;
      this.proc = null;
    });

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
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };

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
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: '2.0', id, method, params });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP request timeout: ${method}`));
        }
      }, 30_000);
    });
  }

  private send(message: JsonRpcMessage): void {
    if (!this.proc?.stdin.writable) {
      throw new Error('MCP stdio process not running');
    }
    const json = JSON.stringify(message);
    const frame = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
    this.proc.stdin.write(frame);
  }

  private drain(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;

      const header = this.buffer.subarray(0, headerEnd).toString('utf-8');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number.parseInt(match[1]!, 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return;

      const bodyText = this.buffer.subarray(bodyStart, bodyStart + length).toString('utf-8');
      this.buffer = this.buffer.subarray(bodyStart + length);

      let message: JsonRpcMessage;
      try {
        message = JSON.parse(bodyText) as JsonRpcMessage;
      } catch {
        continue;
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
}

export function createMcpStdioClient(spec: McpServerSpec): McpStdioClient {
  return new McpStdioClient(spec);
}
