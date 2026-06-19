import { z } from 'zod';
import { blueprintInputSchema } from './blueprint.schema.js';

export const workflowNodeTypeSchema = z.enum([
  'agent',
  'blueprint',
  'workflow',
  'parallel',
  'conditional',
  'transform',
  'channel',
  'hook',
  'batch',
  'mcp',
]);

export type WorkflowNodeType = z.infer<typeof workflowNodeTypeSchema>;

export type WorkflowNode = {
  id: string;
  type: WorkflowNodeType;
  dependsOn?: string[];
  agent?: string;
  blueprint?: string;
  workflow?: string;
  input?: string;
  template?: string;
  channel?: string;
  message?: string;
  hook?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  nodes?: WorkflowNode[];
  steps?: WorkflowNode[];
  condition?: string;
  then?: WorkflowNode[];
  else?: WorkflowNode[];
  onFailure?: 'halt' | 'continue';
};

export const workflowNodeSchema: z.ZodType<WorkflowNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: workflowNodeTypeSchema,
    dependsOn: z.array(z.string()).default([]),
    agent: z.string().optional(),
    blueprint: z.string().optional(),
    workflow: z.string().optional(),
    input: z.string().optional(),
    template: z.string().optional(),
    channel: z.string().optional(),
    message: z.string().optional(),
    hook: z.string().optional(),
    server: z.string().optional(),
    tool: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    nodes: z.array(workflowNodeSchema).optional(),
    steps: z.array(workflowNodeSchema).optional(),
    condition: z.string().optional(),
    then: z.array(workflowNodeSchema).optional(),
    else: z.array(workflowNodeSchema).optional(),
    onFailure: z.enum(['halt', 'continue']).default('halt'),
  }),
);

export const workflowSpecSchema = z.object({
  description: z.string().default(''),
  inputs: z.record(blueprintInputSchema).default({}),
  nodes: z.array(workflowNodeSchema).default([]),
  outputs: z.record(z.object({ from: z.string() })).optional(),
});

export const workflowDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Workflow'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
    catalog: z.enum(['bundled', 'community', 'team', 'private']).default('private'),
  }),
  spec: workflowSpecSchema,
});

export type WorkflowDefinition = z.infer<typeof workflowDefinitionSchema>;
export type WorkflowSpec = z.infer<typeof workflowSpecSchema>;

export function parseWorkflowDefinition(input: unknown): WorkflowDefinition {
  return workflowDefinitionSchema.parse(input);
}
