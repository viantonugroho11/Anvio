import { z } from 'zod';

export const blueprintInputSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'file', 'directory']).default('string'),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
});

export type BlueprintStep = {
  id: string;
  type:
    | 'agent'
    | 'blueprint'
    | 'parallel'
    | 'conditional'
    | 'transform'
    | 'channel'
    | 'hook'
    | 'batch'
    | 'mcp';
  agent?: string;
  blueprint?: string;
  input?: string;
  template?: string;
  channel?: string;
  message?: string;
  hook?: string;
  server?: string;
  tool?: string;
  args?: Record<string, unknown>;
  steps?: BlueprintStep[];
  condition?: string;
  then?: BlueprintStep[];
  else?: BlueprintStep[];
  onFailure?: 'halt' | 'continue';
};

export const blueprintStepSchema: z.ZodType<BlueprintStep> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.enum([
      'agent',
      'blueprint',
      'parallel',
      'conditional',
      'transform',
      'channel',
      'hook',
      'batch',
      'mcp',
    ]),
    agent: z.string().optional(),
    blueprint: z.string().optional(),
    input: z.string().optional(),
    template: z.string().optional(),
    channel: z.string().optional(),
    message: z.string().optional(),
    hook: z.string().optional(),
    server: z.string().optional(),
    tool: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    steps: z.array(blueprintStepSchema).optional(),
    condition: z.string().optional(),
    then: z.array(blueprintStepSchema).optional(),
    else: z.array(blueprintStepSchema).optional(),
    onFailure: z.enum(['halt', 'continue']).default('halt'),
  }),
);

export const blueprintSpecSchema = z.object({
  description: z.string().default(''),
  inputs: z.record(blueprintInputSchema).default({}),
  steps: z.array(blueprintStepSchema).default([]),
  outputs: z.record(z.object({ from: z.string() })).optional(),
});

export const blueprintDefinitionSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('Blueprint'),
  metadata: z.object({
    slug: z.string().min(1),
    version: z.string().default('1.0.0'),
    catalog: z.enum(['bundled', 'community', 'team', 'private']).default('bundled'),
  }),
  spec: blueprintSpecSchema,
});

export type BlueprintDefinition = z.infer<typeof blueprintDefinitionSchema>;
export type BlueprintSpec = z.infer<typeof blueprintSpecSchema>;

export function parseBlueprintDefinition(input: unknown): BlueprintDefinition {
  return blueprintDefinitionSchema.parse(input);
}
