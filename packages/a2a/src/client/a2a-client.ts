import { randomUUID } from 'node:crypto';
import type { AgentCard } from '../types/agent-card.js';
import type { Task } from '../types/task.js';
import type { Message } from '../types/message.js';
import type { SendMessageRequest, SendMessageConfiguration } from '../types/requests.js';
import type { StreamEvent } from '../types/index.js';
import { AgentDiscovery } from './agent-discovery.js';

export interface A2AClientOptions {
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
}

/**
 * A2A v1.0 client — invokes remote A2A agents.
 * Supports both JSON-RPC and REST bindings.
 */
export class A2AClient {
  private readonly discovery = new AgentDiscovery();
  private cachedCard?: AgentCard;

  constructor(private readonly options: A2AClientOptions) {}

  async getAgentCard(): Promise<AgentCard> {
    if (!this.cachedCard) {
      this.cachedCard = await this.discovery.discover(this.options.baseUrl);
    }
    return this.cachedCard;
  }

  async sendMessage(
    content: string,
    options?: {
      contextId?: string;
      configuration?: SendMessageConfiguration;
      metadata?: Record<string, unknown>;
    },
  ): Promise<Task> {
    const message: Message = {
      messageId: randomUUID(),
      contextId: options?.contextId,
      role: 'user',
      parts: [{ type: 'text', text: content }],
    };

    const request: SendMessageRequest = {
      message,
      configuration: options?.configuration,
      metadata: options?.metadata,
    };

    return this.jsonRpc<Task>('sendMessage', request as unknown as Record<string, unknown>);
  }

  async sendStreamingMessage(
    content: string,
    onEvent: (event: StreamEvent) => void,
    options?: { contextId?: string },
  ): Promise<void> {
    const message: Message = {
      messageId: randomUUID(),
      contextId: options?.contextId,
      role: 'user',
      parts: [{ type: 'text', text: content }],
    };

    const card = await this.getAgentCard();
    const endpoint = this.resolveEndpoint(card);

    const res = await fetch(`${endpoint}/messages:stream`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ message }),
    });

    if (!res.ok) {
      throw new Error(`A2A streaming failed: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body for streaming');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6)) as StreamEvent;
            onEvent(event);
          } catch {
            // skip unparseable SSE lines
          }
        }
      }
    }
  }

  async getTask(taskId: string): Promise<Task> {
    return this.jsonRpc<Task>('getTask', { id: taskId });
  }

  async cancelTask(taskId: string): Promise<Task> {
    return this.jsonRpc<Task>('cancelTask', { id: taskId });
  }

  // ── JSON-RPC transport ──────────────────────────────────────

  private async jsonRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const card = await this.getAgentCard();
    const endpoint = this.resolveEndpoint(card);

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: randomUUID(),
        method,
        params,
      }),
    });

    if (!res.ok) {
      throw new Error(`A2A RPC failed: ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as { result?: T; error?: { code: number; message: string } };
    if (body.error) {
      throw new Error(`A2A RPC error [${body.error.code}]: ${body.error.message}`);
    }
    return body.result as T;
  }

  private resolveEndpoint(card: AgentCard): string {
    const jsonRpcEndpoint = card.endpoints.find((e) => e.protocolBinding === 'json-rpc');
    const restEndpoint = card.endpoints.find((e) => e.protocolBinding === 'http+json');
    const ep = jsonRpcEndpoint ?? restEndpoint ?? card.endpoints[0];
    return ep?.url ?? this.options.baseUrl;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'A2A-Version': '1.0',
    };
    if (this.options.bearerToken) {
      headers['Authorization'] = `Bearer ${this.options.bearerToken}`;
    } else if (this.options.apiKey) {
      headers['X-API-Key'] = this.options.apiKey;
    }
    return headers;
  }
}
