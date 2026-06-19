import type { BlueprintDefinition, BlueprintStep } from '@anvio/core';
import type { BlueprintCatalogRegistry } from './catalog-registry.js';
import { buildDefaultInputs, renderTemplate, type TemplateContext } from './template-engine.js';

export interface BlueprintRunOptions {
  dryRun?: boolean;
}

export interface BlueprintStepResult {
  id: string;
  type: string;
  output: string;
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
}

export interface BlueprintRunResult {
  slug: string;
  status: 'completed' | 'failed' | 'dry_run';
  steps: BlueprintStepResult[];
  outputs: Record<string, string>;
}

export interface BlueprintExecutionDeps {
  catalog: BlueprintCatalogRegistry;
  runAgent?: (agentId: string, input: string) => Promise<string>;
  runWorkflow?: (
    slug: string,
    inputs: Record<string, unknown>,
  ) => Promise<{ outputs: Record<string, string>; status: string }>;
  runHook?: (hookPath: string, payload: Record<string, unknown>) => Promise<void>;
  mcpBridge?: {
    callTool(call: {
      serverId: string;
      toolName: string;
      arguments?: Record<string, unknown>;
    }): Promise<{ output: unknown; status: string; error?: string }>;
  };
}

export class BlueprintExecutor {
  constructor(private readonly deps: BlueprintExecutionDeps) {}

  async run(
    slug: string,
    inputs: Record<string, unknown> = {},
    options: BlueprintRunOptions = {},
  ): Promise<BlueprintRunResult> {
    const blueprint = await this.deps.catalog.load(slug);
    return this.executeDefinition(blueprint, inputs, options);
  }

  async executeDefinition(
    blueprint: BlueprintDefinition,
    inputs: Record<string, unknown> = {},
    options: BlueprintRunOptions = {},
  ): Promise<BlueprintRunResult> {
    const resolvedInputs = buildDefaultInputs(blueprint.spec.inputs, inputs);
    const context: TemplateContext = { inputs: resolvedInputs, steps: {} };
    const steps: BlueprintStepResult[] = [];

    if (options.dryRun) {
      for (const step of blueprint.spec.steps) {
        steps.push({
          id: step.id,
          type: step.type,
          output: `[dry-run] ${step.type}`,
          status: 'skipped',
        });
      }
      return {
        slug: blueprint.metadata.slug,
        status: 'dry_run',
        steps,
        outputs: this.collectOutputs(blueprint, context),
      };
    }

    try {
      for (const step of blueprint.spec.steps) {
        const result = await this.executeStep(step, context);
        steps.push(result);
        context.steps[step.id] = { output: result.output };
        if (result.status === 'failed' && step.onFailure === 'halt') {
          return {
            slug: blueprint.metadata.slug,
            status: 'failed',
            steps,
            outputs: {},
          };
        }
      }

      return {
        slug: blueprint.metadata.slug,
        status: 'completed',
        steps,
        outputs: this.collectOutputs(blueprint, context),
      };
    } catch (error) {
      return {
        slug: blueprint.metadata.slug,
        status: 'failed',
        steps,
        outputs: {},
      };
    }
  }

  private async executeStep(step: BlueprintStep, context: TemplateContext): Promise<BlueprintStepResult> {
    try {
      switch (step.type) {
        case 'transform': {
          const input = step.input ? renderTemplate(step.input, context) : '';
          const output = step.template ? renderTemplate(step.template, context) : input;
          return { id: step.id, type: step.type, output, status: 'completed' };
        }
        case 'agent': {
          if (!step.agent) throw new Error(`Agent step ${step.id} missing agent`);
          const input = renderTemplate(step.input ?? '', context);
          if (!this.deps.runAgent) {
            return { id: step.id, type: step.type, output: `[no-agent-runner] ${input}`, status: 'completed' };
          }
          const output = await this.deps.runAgent(step.agent, input);
          return { id: step.id, type: step.type, output, status: 'completed' };
        }
        case 'blueprint': {
          if (!step.blueprint) throw new Error(`Blueprint step ${step.id} missing blueprint`);
          const nested = await this.run(step.blueprint, context.inputs);
          const output = nested.outputs.summary ?? nested.steps.at(-1)?.output ?? '';
          return { id: step.id, type: step.type, output, status: nested.status === 'failed' ? 'failed' : 'completed' };
        }
        case 'workflow': {
          if (!step.workflow) throw new Error(`Workflow step ${step.id} missing workflow`);
          if (!this.deps.runWorkflow) {
            return { id: step.id, type: step.type, output: `[no-workflow-runner] ${step.workflow}`, status: 'skipped' };
          }
          const nested = await this.deps.runWorkflow(step.workflow, context.inputs);
          const output = nested.outputs.summary ?? Object.values(nested.outputs)[0] ?? '';
          return {
            id: step.id,
            type: step.type,
            output,
            status: nested.status === 'failed' ? 'failed' : 'completed',
          };
        }
        case 'channel': {
          const message = renderTemplate(step.message ?? step.input ?? '', context);
          return { id: step.id, type: step.type, output: message, status: 'completed' };
        }
        case 'hook': {
          const hookPath = step.hook ?? step.input ?? '';
          if (this.deps.runHook && hookPath) {
            await this.deps.runHook(hookPath, { step: step.id, context });
          }
          return { id: step.id, type: step.type, output: hookPath, status: 'completed' };
        }
        case 'parallel': {
          const nested = step.steps ?? [];
          const results = await Promise.all(nested.map((s) => this.executeStep(s, context)));
          for (const r of results) context.steps[r.id] = { output: r.output };
          const output = results.map((r) => r.output).join('\n');
          const failed = results.some((r) => r.status === 'failed');
          return { id: step.id, type: step.type, output, status: failed ? 'failed' : 'completed' };
        }
        case 'conditional': {
          const condition = renderTemplate(step.condition ?? 'false', context);
          const branch = condition === 'true' || condition === '1' ? step.then : step.else;
          const results: BlueprintStepResult[] = [];
          for (const s of branch ?? []) {
            const r = await this.executeStep(s, context);
            results.push(r);
            context.steps[r.id] = { output: r.output };
          }
          return {
            id: step.id,
            type: step.type,
            output: results.map((r) => r.output).join('\n'),
            status: results.some((r) => r.status === 'failed') ? 'failed' : 'completed',
          };
        }
        case 'mcp': {
          if (!this.deps.mcpBridge || !step.server || !step.tool) {
            return {
              id: step.id,
              type: step.type,
              output: '[mcp not configured]',
              status: 'skipped',
            };
          }
          const result = await this.deps.mcpBridge.callTool({
            serverId: step.server,
            toolName: step.tool,
            arguments: step.args,
          });
          return {
            id: step.id,
            type: step.type,
            output: JSON.stringify(result.output),
            status: result.status === 'completed' ? 'completed' : 'failed',
            error: result.error,
          };
        }
        case 'batch': {
          return {
            id: step.id,
            type: step.type,
            output: '[batch not configured]',
            status: 'skipped',
          };
        }
        default: {
          const _exhaustive: never = step.type;
          throw new Error(`Unknown step type: ${_exhaustive}`);
        }
      }
    } catch (error) {
      return {
        id: step.id,
        type: step.type,
        output: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private collectOutputs(blueprint: BlueprintDefinition, context: TemplateContext): Record<string, string> {
    const outputs: Record<string, string> = {};
    if (!blueprint.spec.outputs) return outputs;

    for (const [key, spec] of Object.entries(blueprint.spec.outputs)) {
      const value = renderTemplate(`{{${spec.from}}}`, context);
      outputs[key] = value;
    }
    return outputs;
  }
}
