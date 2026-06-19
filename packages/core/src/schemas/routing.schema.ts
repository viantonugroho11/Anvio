import { z } from 'zod';

export const routingStrategySchema = z.enum([
  'cheapest',
  'fastest',
  'highest_quality',
  'coding_optimized',
  'research_optimized',
]);

export const routeTargetSchema = z.object({
  provider: z.string().min(1),
  model: z.string().optional(),
  pool: z.string().optional(),
  runtime: z.string().optional(),
});

export const routeDefinitionSchema = z.object({
  strategy: routingStrategySchema.optional(),
  primary: routeTargetSchema,
  fallback: z.array(routeTargetSchema).default([]),
});

export const providerRoutingSpecSchema = z.object({
  defaultStrategy: routingStrategySchema.default('highest_quality'),
  routes: z.record(routeDefinitionSchema).default({}),
});

export const providerRoutingSchema = z.object({
  apiVersion: z.literal('anvio.io/v1'),
  kind: z.literal('ProviderRouting'),
  metadata: z.object({
    name: z.string().default('default'),
  }),
  spec: providerRoutingSpecSchema,
});

export type RoutingStrategy = z.infer<typeof routingStrategySchema>;
export type RouteTarget = z.infer<typeof routeTargetSchema>;
export type RouteDefinition = z.infer<typeof routeDefinitionSchema>;
export type ProviderRouting = z.infer<typeof providerRoutingSchema>;

export function parseProviderRouting(input: unknown): ProviderRouting {
  return providerRoutingSchema.parse(input);
}
