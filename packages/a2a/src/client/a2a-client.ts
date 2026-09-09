import { randomUUID } from 'node:crypto';
import type { AgentCard, Task, Message, SendMessageRequest } from '@a2a-js/sdk';
import { Role } from '@a2a-js/sdk';
import {
  ClientFactory,
  JsonRpcTransportFactory,
  RestTransportFactory,
  type Client,
} from '@a2a-js/sdk/client';

export interface A2AClientOptions {
  baseUrl: string;
  apiKey?: string;
  bearerToken?: string;
  preferredTransport?: 'JSONRPC' | 'HTTP+JSON';
}

export class A2AClient {
  private sdkClient?: Client;
  private cachedCard?: AgentCard;
  private readonly options: A2AClientOptions;

  constructor(options: A2AClientOptions) {
    this.options = options;
  }

  async getAgentCard(): Promise<AgentCard> {
    if (!this.cachedCard) {
      await this.getClient();
      this.cachedCard = (this.sdkClient as any).agentCard ?? await this.fetchCard();
    }
    return this.cachedCard!;
  }

  async sendMessage(
    content: string,
    opts?: { contextId?: string; metadata?: Record<string, unknown> },
  ): Promise<Task> {
    const client = await this.getClient();
    const message = this.buildMessage(content, opts?.contextId);
    const request: SendMessageRequest = {
      tenant: '',
      message,
      metadata: opts?.metadata as any,
      configuration: undefined,
    };
    const result = await client.sendMessage(request);
    return result as Task;
  }

  async *sendStreamingMessage(
    content: string,
    opts?: { contextId?: string },
  ): AsyncGenerator<any> {
    const client = await this.getClient();
    const message = this.buildMessage(content, opts?.contextId);
    const request: SendMessageRequest = {
      tenant: '',
      message,
      configuration: undefined,
      metadata: undefined,
    };
    const stream = client.sendMessageStream(request);
    for await (const event of stream) {
      yield event;
    }
  }

  async getTask(taskId: string): Promise<Task> {
    const client = await this.getClient();
    return client.getTask({ id: taskId, tenant: '' });
  }

  async cancelTask(taskId: string): Promise<Task> {
    const client = await this.getClient();
    return client.cancelTask({ id: taskId, tenant: '', metadata: undefined });
  }

  private async getClient(): Promise<Client> {
    if (!this.sdkClient) {
      const factory = new ClientFactory({
        transports: [
          new JsonRpcTransportFactory(),
          new RestTransportFactory(),
        ],
        preferredTransports: [this.options.preferredTransport ?? 'JSONRPC'],
      });

      this.sdkClient = await factory.createFromUrl(this.options.baseUrl);
    }
    return this.sdkClient;
  }

  private buildMessage(content: string, contextId?: string): Message {
    return {
      messageId: randomUUID(),
      contextId: contextId ?? '',
      taskId: '',
      role: Role.ROLE_USER,
      parts: [{
        content: { $case: 'text' as const, value: content },
        metadata: undefined,
        filename: '',
        mediaType: 'text/plain',
      }],
      metadata: undefined,
      extensions: [],
      referenceTaskIds: [],
    };
  }

  private async fetchCard(): Promise<AgentCard> {
    const url = `${this.options.baseUrl.replace(/\/$/, '')}/.well-known/agent.json`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Agent Card fetch failed: ${res.status}`);
    return (await res.json()) as AgentCard;
  }
}
