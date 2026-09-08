import type { Task } from '../types/task.js';
import { A2AClient } from './a2a-client.js';

export interface A2AToolConfig {
  alias: string;
  url: string;
  apiKey?: string;
  bearerToken?: string;
  description?: string;
}

/**
 * Wraps an external A2A agent as a tool callable by Anvio agents.
 *
 * Registered as `a2a_delegate` in packages/tools; the Anvio agent
 * invokes it like any other tool, passing a message and receiving
 * the completed task's artifacts as the tool result.
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
    const task = await this.client.sendMessage(message, {
      contextId,
      configuration: { returnImmediately: false },
    });
    return this.formatResult(task);
  }

  async getAgentInfo(): Promise<{ name: string; description?: string; skills: string[] }> {
    const card = await this.client.getAgentCard();
    return {
      name: card.agentName,
      description: card.description,
      skills: card.skills?.map((s) => s.name) ?? [],
    };
  }

  private formatResult(task: Task): A2AToolResult {
    const textParts: string[] = [];

    for (const artifact of task.artifacts ?? []) {
      for (const part of artifact.parts) {
        if (part.type === 'text') textParts.push(part.text);
        else if (part.type === 'data') textParts.push(JSON.stringify(part.data));
      }
    }

    // Fall back to last agent message if no artifacts
    if (textParts.length === 0 && task.history) {
      const lastAgent = [...task.history].reverse().find((m) => m.role === 'agent');
      if (lastAgent) {
        for (const part of lastAgent.parts) {
          if (part.type === 'text') textParts.push(part.text);
        }
      }
    }

    return {
      taskId: task.id,
      status: task.status.state,
      content: textParts.join('\n'),
    };
  }
}

export interface A2AToolResult {
  taskId: string;
  status: string;
  content: string;
}
