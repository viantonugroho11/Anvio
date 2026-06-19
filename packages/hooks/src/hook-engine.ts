import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { EventSubjects } from '@anvio/events';
import { parseHookRegistry } from '@anvio/core';
import type { HookEventName, HookHandler, HookRegistry } from '@anvio/core';
import type { EventBusLike } from '@anvio/events';
import { runMcpHandler } from './handlers/mcp.js';
import { runScriptHandler } from './handlers/script.js';
import { runWebhookHandler } from './handlers/webhook.js';

const HOOK_TO_SUBJECT: Record<HookEventName, (typeof EventSubjects)[keyof typeof EventSubjects]> = {
  onSessionStart: EventSubjects.SESSION_STARTED,
  onSessionEnd: EventSubjects.SESSION_ENDED,
  onGoalCreated: EventSubjects.GOAL_CREATED,
  onGoalCompleted: EventSubjects.GOAL_COMPLETED,
  onTaskAssigned: EventSubjects.TASK_ASSIGNED,
  onTaskCompleted: EventSubjects.TASK_COMPLETED,
  onToolExecuted: EventSubjects.TOOL_EXECUTED,
  onWorkflowCompleted: EventSubjects.WORKFLOW_COMPLETED,
  onSoulEvolved: EventSubjects.SOUL_UPDATED,
  onAutomationFailed: EventSubjects.AUTOMATION_FAILED,
};

export class HookEngine {
  private unsubscribers: Array<() => void | Promise<void>> = [];
  private registry: HookRegistry = { apiVersion: 'anvio.io/v1', kind: 'HookRegistry', spec: { hooks: [] } };

  constructor(
    private readonly workspaceRoot: string,
    private readonly eventBus: EventBusLike,
  ) {}

  async load(): Promise<void> {
    const registryPath = path.join(this.workspaceRoot, 'hooks/hooks.yaml');
    try {
      const raw = parseYaml(await fs.readFile(registryPath, 'utf-8'));
      this.registry = parseHookRegistry(raw);
    } catch {
      this.registry = { apiVersion: 'anvio.io/v1', kind: 'HookRegistry', spec: { hooks: [] } };
    }
  }

  async start(): Promise<void> {
    await this.load();
    await this.stop();

    for (const binding of this.registry.spec.hooks) {
      const subject = HOOK_TO_SUBJECT[binding.event];
      if (!subject) continue;

      const unsub = await this.eventBus.subscribeCore(subject, async (event) => {
        await this.dispatch(binding.event, binding.handlers, event.data as Record<string, unknown>);
      });
      this.unsubscribers.push(unsub);
    }
  }

  async stop(): Promise<void> {
    for (const unsub of this.unsubscribers) {
      await unsub();
    }
    this.unsubscribers = [];
  }

  async dispatchEvent(event: HookEventName, payload: Record<string, unknown>): Promise<void> {
    const binding = this.registry.spec.hooks.find((h) => h.event === event);
    if (!binding) return;
    await this.dispatch(event, binding.handlers, payload);
  }

  async test(event: HookEventName, payload: Record<string, unknown> = {}): Promise<void> {
    await this.load();
    await this.dispatchEvent(event, payload);
  }

  private async dispatch(
    event: HookEventName,
    handlers: HookHandler[],
    payload: Record<string, unknown>,
  ): Promise<void> {
    for (const handler of handlers) {
      if (handler.filter && !matchesFilter(handler.filter, payload)) continue;

      try {
        switch (handler.type) {
          case 'script':
            await runScriptHandler(this.workspaceRoot, handler.path, { event, ...payload }, handler.timeoutMs);
            break;
          case 'webhook':
            await runWebhookHandler(
              { event, ...payload },
              {
                url: handler.url,
                method: handler.method,
                headers: handler.headers,
                body: handler.body,
                timeoutMs: handler.timeoutMs,
              },
            );
            break;
          case 'mcp':
            await runMcpHandler({ event, ...payload }, {
              server: handler.server,
              tool: handler.tool,
              args: handler.args,
            });
            break;
          default: {
            const _exhaustive: never = handler;
            throw new Error(`Unknown handler type: ${(_exhaustive as HookHandler).type}`);
          }
        }
      } catch (error) {
        console.error(`Hook handler failed for ${event}:`, error);
      }
    }
  }
}

function matchesFilter(filter: Record<string, string>, payload: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => String(payload[key] ?? '') === expected);
}

export function createHookEngine(workspaceRoot: string, eventBus: EventBusLike): HookEngine {
  return new HookEngine(workspaceRoot, eventBus);
}
