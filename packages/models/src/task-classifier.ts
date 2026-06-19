import type { AgentDefinition } from '@anvio/core';
import type { RoutingStrategy } from '@anvio/core';

export type TaskRoute = 'coding' | 'review' | 'chat' | 'research' | 'default';

export interface ClassificationInput {
  agent?: AgentDefinition;
  skillRoutingHints?: string[];
  message?: string;
}

export function classifyTask(input: ClassificationInput): TaskRoute {
  const override = input.agent?.spec.model as { routing?: string } | undefined;
  if (override?.routing && isTaskRoute(override.routing)) {
    return override.routing;
  }

  for (const hint of input.skillRoutingHints ?? []) {
    if (isTaskRoute(hint)) return hint;
  }

  const agentSkills = input.agent?.spec.skills ?? [];
  if (agentSkills.some((s) => ['coding', 'debugging'].includes(s))) return 'coding';
  if (agentSkills.some((s) => ['code-review'].includes(s))) return 'review';
  if (agentSkills.some((s) => ['research', 'planning'].includes(s))) return 'research';

  const message = (input.message ?? '').toLowerCase();
  if (/\b(implement|refactor|fix bug|code)\b/.test(message)) return 'coding';
  if (/\b(review|audit|pr)\b/.test(message)) return 'review';
  if (/\b(research|analyze|investigate)\b/.test(message)) return 'research';

  return 'default';
}

export function strategyForRoute(route: TaskRoute, defaultStrategy: RoutingStrategy): RoutingStrategy {
  switch (route) {
    case 'coding':
      return 'coding_optimized';
    case 'research':
      return 'research_optimized';
    case 'chat':
      return 'cheapest';
    case 'review':
      return 'highest_quality';
    default:
      return defaultStrategy;
  }
}

function isTaskRoute(value: string): value is TaskRoute {
  return ['coding', 'review', 'chat', 'research', 'default'].includes(value);
}
