import type { AutomationAction, AutomationDefinition } from '@anvio/core';
import type { BlueprintExecutor } from '@anvio/blueprints';

export interface ActionExecutionContext {
  userId: string;
  eventPayload?: Record<string, unknown>;
}

export interface ActionExecutionResult {
  status: 'completed' | 'failed';
  output?: string;
  error?: string;
}

export interface ActionExecutorDeps {
  blueprintExecutor: BlueprintExecutor;
  runAgent?: (agentId: string, input: string) => Promise<string>;
  runHook?: (hookPath: string, payload: Record<string, unknown>) => Promise<void>;
}

export class ActionExecutor {
  constructor(private readonly deps: ActionExecutorDeps) {}

  async execute(
    automation: AutomationDefinition,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult> {
    const action = automation.spec.action;
    const attempts = automation.spec.retry.maxAttempts;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const output = await this.executeOnce(action, context);
        return { status: 'completed', output };
      } catch (error) {
        if (attempt >= attempts) {
          return {
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          };
        }
        const delay = automation.spec.retry.backoff === 'exponential' ? 2 ** (attempt - 1) * 1000 : 1000;
        await sleep(delay);
      }
    }

    return { status: 'failed', error: 'Retry exhausted' };
  }

  private async executeOnce(
    action: AutomationAction,
    context: ActionExecutionContext,
  ): Promise<string> {
    switch (action.type) {
      case 'blueprint': {
        const result = await this.deps.blueprintExecutor.run(action.blueprint, {
          userId: context.userId,
          ...action.inputs,
        });
        if (result.status === 'failed') throw new Error(`Blueprint failed: ${action.blueprint}`);
        return result.outputs.summary ?? result.steps.at(-1)?.output ?? '';
      }
      case 'agent': {
        if (!this.deps.runAgent) throw new Error('Agent runner not configured');
        return this.deps.runAgent(action.agent, action.input);
      }
      case 'hook': {
        if (!this.deps.runHook) throw new Error('Hook runner not configured');
        await this.deps.runHook(action.hook, context.eventPayload ?? {});
        return action.hook;
      }
      case 'batch':
        throw new Error('Batch action requires Phase C (U13)');
      default: {
        const _exhaustive: never = action;
        throw new Error(`Unknown action type: ${(_exhaustive as AutomationAction).type}`);
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
