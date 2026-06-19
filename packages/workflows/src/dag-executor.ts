import type { WorkflowDefinition, WorkflowNode } from '@anvio/core';
import type { WorkflowRegistry } from './workflow-registry.js';

export interface TemplateContext {
  inputs: Record<string, unknown>;
  nodes: Record<string, { output: string }>;
}

export interface WorkflowNodeResult {
  id: string;
  type: string;
  output: string;
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
}

export interface WorkflowRunResult {
  slug: string;
  status: 'completed' | 'failed' | 'dry_run';
  nodes: WorkflowNodeResult[];
  outputs: Record<string, string>;
}

export interface WorkflowRunOptions {
  dryRun?: boolean;
}

export interface WorkflowExecutionDeps {
  registry: WorkflowRegistry;
  runAgent?: (agentId: string, input: string) => Promise<string>;
  runBlueprint?: (slug: string, inputs: Record<string, unknown>) => Promise<{ outputs: Record<string, string> }>;
  runHook?: (hookPath: string, payload: Record<string, unknown>) => Promise<void>;
  mcpBridge?: {
    callTool(call: {
      serverId: string;
      toolName: string;
      arguments?: Record<string, unknown>;
    }): Promise<{ output: unknown; status: string; error?: string }>;
  };
  onNodeCompleted?: (nodeId: string, result: WorkflowNodeResult) => void | Promise<void>;
}

function renderTemplate(template: string, context: TemplateContext): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, expr: string) => {
    const trimmed = expr.trim();
    if (trimmed === 'date') return new Date().toISOString().slice(0, 10);
    const parts = trimmed.split('.');
    let value: unknown = context;
    for (const part of parts) {
      if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    return value == null ? '' : String(value);
  });
}

function buildDefaultInputs(
  schema: WorkflowDefinition['spec']['inputs'],
  provided: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = { ...provided };
  for (const [key, spec] of Object.entries(schema)) {
    if (resolved[key] === undefined && spec.default !== undefined) {
      resolved[key] = spec.default;
    }
  }
  return resolved;
}

export class DagExecutor {
  constructor(private readonly deps: WorkflowExecutionDeps) {}

  async run(
    slug: string,
    inputs: Record<string, unknown> = {},
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunResult> {
    const workflow = await this.deps.registry.load(slug);
    return this.executeDefinition(workflow, inputs, options);
  }

  async executeDefinition(
    workflow: WorkflowDefinition,
    inputs: Record<string, unknown> = {},
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRunResult> {
    const resolvedInputs = buildDefaultInputs(workflow.spec.inputs, inputs);
    const context: TemplateContext = { inputs: resolvedInputs, nodes: {} };
    const nodeResults: WorkflowNodeResult[] = [];
    const nodes = workflow.spec.nodes;

    if (options.dryRun) {
      for (const node of nodes) {
        nodeResults.push({
          id: node.id,
          type: node.type,
          output: `[dry-run] ${node.type}`,
          status: 'skipped',
        });
      }
      return {
        slug: workflow.metadata.slug,
        status: 'dry_run',
        nodes: nodeResults,
        outputs: this.collectOutputs(workflow, context),
      };
    }

    const pending = new Set(nodes.map((n) => n.id));
    const completed = new Set<string>();
    const resultById = new Map<string, WorkflowNodeResult>();

    while (pending.size > 0) {
      const ready = nodes.filter(
        (n) => pending.has(n.id) && (n.dependsOn ?? []).every((dep) => completed.has(dep)),
      );

      if (ready.length === 0) {
        return {
          slug: workflow.metadata.slug,
          status: 'failed',
          nodes: nodeResults,
          outputs: {},
        };
      }

      const batchResults = await Promise.all(ready.map((node) => this.executeNode(node, context)));
      for (const result of batchResults) {
        pending.delete(result.id);
        completed.add(result.id);
        resultById.set(result.id, result);
        nodeResults.push(result);
        context.nodes[result.id] = { output: result.output };
        await this.deps.onNodeCompleted?.(result.id, result);

        if (result.status === 'failed') {
          const node = nodes.find((n) => n.id === result.id);
          if (node?.onFailure === 'halt') {
            return {
              slug: workflow.metadata.slug,
              status: 'failed',
              nodes: nodeResults,
              outputs: {},
            };
          }
        }
      }
    }

    return {
      slug: workflow.metadata.slug,
      status: 'completed',
      nodes: nodeResults,
      outputs: this.collectOutputs(workflow, context),
    };
  }

  private async executeNode(node: WorkflowNode, context: TemplateContext): Promise<WorkflowNodeResult> {
    try {
      switch (node.type) {
        case 'transform': {
          const input = node.input ? renderTemplate(node.input, context) : '';
          const output = node.template ? renderTemplate(node.template, context) : input;
          return { id: node.id, type: node.type, output, status: 'completed' };
        }
        case 'agent': {
          if (!node.agent) throw new Error(`Agent node ${node.id} missing agent`);
          const input = renderTemplate(node.input ?? '', context);
          if (!this.deps.runAgent) {
            return { id: node.id, type: node.type, output: `[no-agent-runner] ${input}`, status: 'completed' };
          }
          const output = await this.deps.runAgent(node.agent, input);
          return { id: node.id, type: node.type, output, status: 'completed' };
        }
        case 'blueprint': {
          if (!node.blueprint) throw new Error(`Blueprint node ${node.id} missing blueprint`);
          if (!this.deps.runBlueprint) {
            return { id: node.id, type: node.type, output: `[no-blueprint-runner]`, status: 'skipped' };
          }
          const nested = await this.deps.runBlueprint(node.blueprint, context.inputs);
          const output = nested.outputs.summary ?? Object.values(nested.outputs)[0] ?? '';
          return { id: node.id, type: node.type, output, status: 'completed' };
        }
        case 'workflow': {
          if (!node.workflow) throw new Error(`Workflow node ${node.id} missing workflow`);
          const nested = await this.run(node.workflow, context.inputs);
          const output = nested.outputs.summary ?? nested.nodes.at(-1)?.output ?? '';
          return {
            id: node.id,
            type: node.type,
            output,
            status: nested.status === 'failed' ? 'failed' : 'completed',
          };
        }
        case 'channel': {
          const message = renderTemplate(node.message ?? node.input ?? '', context);
          return { id: node.id, type: node.type, output: message, status: 'completed' };
        }
        case 'hook': {
          const hookPath = node.hook ?? node.input ?? '';
          if (this.deps.runHook && hookPath) {
            await this.deps.runHook(hookPath, { node: node.id, context });
          }
          return { id: node.id, type: node.type, output: hookPath, status: 'completed' };
        }
        case 'parallel': {
          const nested = node.steps ?? node.nodes ?? [];
          const results = await Promise.all(nested.map((n) => this.executeNode(n, context)));
          for (const r of results) context.nodes[r.id] = { output: r.output };
          const output = results.map((r) => r.output).join('\n');
          const failed = results.some((r) => r.status === 'failed');
          return { id: node.id, type: node.type, output, status: failed ? 'failed' : 'completed' };
        }
        case 'conditional': {
          const condition = renderTemplate(node.condition ?? 'false', context);
          const branch = condition === 'true' || condition === '1' ? node.then : node.else;
          const results: WorkflowNodeResult[] = [];
          for (const s of branch ?? []) {
            const r = await this.executeNode(s, context);
            results.push(r);
            context.nodes[r.id] = { output: r.output };
          }
          return {
            id: node.id,
            type: node.type,
            output: results.map((r) => r.output).join('\n'),
            status: results.some((r) => r.status === 'failed') ? 'failed' : 'completed',
          };
        }
        case 'mcp': {
          if (!this.deps.mcpBridge || !node.server || !node.tool) {
            return { id: node.id, type: node.type, output: '[mcp not configured]', status: 'skipped' };
          }
          const result = await this.deps.mcpBridge.callTool({
            serverId: node.server,
            toolName: node.tool,
            arguments: node.args,
          });
          return {
            id: node.id,
            type: node.type,
            output: JSON.stringify(result.output),
            status: result.status === 'completed' ? 'completed' : 'failed',
            error: result.error,
          };
        }
        case 'batch': {
          return { id: node.id, type: node.type, output: '[batch not configured]', status: 'skipped' };
        }
        default: {
          const _exhaustive: never = node.type;
          throw new Error(`Unknown node type: ${_exhaustive}`);
        }
      }
    } catch (error) {
      return {
        id: node.id,
        type: node.type,
        output: '',
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private collectOutputs(workflow: WorkflowDefinition, context: TemplateContext): Record<string, string> {
    const outputs: Record<string, string> = {};
    if (!workflow.spec.outputs) return outputs;

    for (const [key, spec] of Object.entries(workflow.spec.outputs)) {
      outputs[key] = renderTemplate(`{{${spec.from}}}`, context);
    }
    return outputs;
  }
}
