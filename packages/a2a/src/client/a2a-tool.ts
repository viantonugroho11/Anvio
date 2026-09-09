import type { Task } from '@a2a-js/sdk';
import { A2AClient } from './a2a-client.js';

export interface A2AToolConfig {
  alias: string;
  url: string;
  apiKey?: string;
  bearerToken?: string;
  description?: string;
}

export interface A2AToolResult {
  taskId: string;
  status: string;
  content: string;
}

/**
 * Wraps an external A2A agent as a tool callable by Anvio agents.
 * Uses the official SDK-backed A2AClient under the hood.
 */
export class A2ATool {
  private readonly client: A2AClient;
  readonly alias: string;
  readonly description: string;

  constructor(config: A2AToolConfig) {
    this.alias = config.alias;
    this.description = config.description ?? `Delegate to A2A agent: ${config.alias}`;
    this.client = new A2AClient({
      baseUrl: config.url,
      apiKey: config.apiKey,
      bearerToken: config.bearerToken,
    });
  }

  async invoke(message: string, contextId?: string): Promise<A2AToolResult> {
    const task = await this.client.sendMessage(message, { contextId });
    return this.formatResult(task);
  }

  async getAgentInfo(): Promise<{ name: string; description?: string; skills: string[] }> {
    const card = await this.client.getAgentCard();
    return {
      name: card.name,
      description: card.description,
      skills: card.skills?.map((s) => s.name) ?? [],
    };
  }

  private formatResult(task: Task): A2AToolResult {
    const textParts: string[] = [];

    for (const artifact of task.artifacts ?? []) {
      for (const part of artifact.parts) {
        if (part.content?.$case === 'text') textParts.push(part.content.value);
        else if (part.content?.$case === 'data') textParts.push(JSON.stringify(part.content.value));
      }
    }

    // Fall back to last agent message if no artifacts
    if (textParts.length === 0 && task.history) {
      const lastAgent = [...task.history].reverse().find((m) => m.role === 1 || m.role === 2);
      if (lastAgent) {
        for (const part of lastAgent.parts) {
          if (part.content?.$case === 'text') textParts.push(part.content.value);
        }
      }
    }

    return {
      taskId: task.id,
      status: String(task.status?.state ?? 'unknown'),
      content: textParts.join('\n'),
    };
  }
}
