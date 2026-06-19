import type {
  CreateGoalInput,
  GoalDefinition,
  GoalEngine,
  GoalPriority,
  GoalSpec,
  GoalStatus,
  GoalStore,
  UpdateGoalProgressInput,
} from '@anvio/core';
import { AnvioError, goalSpecSchema, parseGoalDefinition, parseGoalIndex } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const PRIORITY_ORDER: Record<GoalPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export class FilesystemGoalStore implements GoalStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  private goalKey(slug: string): string {
    return `goals/${slug}.yaml`;
  }

  private indexKey(): string {
    return 'goals/_index.yaml';
  }

  async list(status?: GoalStatus): Promise<GoalDefinition[]> {
    const files = await this.storage.list('goals');
    const goals: GoalDefinition[] = [];
    for (const file of files.filter(
      (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.includes('_index'),
    )) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      const goal = parseGoalDefinition(parseYaml(raw));
      if (!status || goal.spec.status === status) goals.push(goal);
    }
    return this.sortGoals(goals);
  }

  async get(slug: string): Promise<GoalDefinition | null> {
    const raw = await this.storage.read(this.goalKey(slug));
    if (!raw) return null;
    return parseGoalDefinition(parseYaml(raw));
  }

  async create(input: CreateGoalInput): Promise<GoalDefinition> {
    const existing = await this.get(input.slug);
    if (existing) throw new AnvioError('CONFLICT', `Goal already exists: ${input.slug}`);

    const now = new Date().toISOString();
    const definition: GoalDefinition = {
      apiVersion: 'anvio.io/v1',
      kind: 'Goal',
      metadata: { slug: input.slug, createdAt: now, updatedAt: now },
      spec: goalSpecSchema.parse(input.spec),
    };
    await this.storage.write(this.goalKey(input.slug), stringifyYaml(definition));

    const order = await this.getOrderedSlugs();
    if (!order.includes(input.slug)) {
      await this.setOrder([...order, input.slug]);
    }
    return definition;
  }

  async update(slug: string, patch: Partial<GoalSpec>): Promise<GoalDefinition> {
    const existing = await this.get(slug);
    if (!existing) throw new AnvioError('NOT_FOUND', `Goal not found: ${slug}`);

    const updated: GoalDefinition = {
      ...existing,
      metadata: { ...existing.metadata, updatedAt: new Date().toISOString() },
      spec: { ...existing.spec, ...patch },
    };
    await this.storage.write(this.goalKey(slug), stringifyYaml(updated));
    return updated;
  }

  async delete(slug: string): Promise<boolean> {
    if (!(await this.storage.exists(this.goalKey(slug)))) return false;
    await this.storage.delete(this.goalKey(slug));
    const order = await this.getOrderedSlugs();
    await this.setOrder(order.filter((s) => s !== slug));
    return true;
  }

  async getOrderedSlugs(): Promise<string[]> {
    const raw = await this.storage.read(this.indexKey());
    if (!raw) return [];
    return parseGoalIndex(parseYaml(raw)).spec.order;
  }

  async setOrder(slugs: string[]): Promise<void> {
    await this.storage.write(
      this.indexKey(),
      stringifyYaml({
        apiVersion: 'anvio.io/v1',
        kind: 'GoalIndex',
        spec: { order: slugs },
      }),
    );
  }

  private async sortGoals(goals: GoalDefinition[]): Promise<GoalDefinition[]> {
    const order = await this.getOrderedSlugs();
    const orderMap = new Map(order.map((slug, i) => [slug, i]));

    return [...goals].sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.spec.priority] - PRIORITY_ORDER[b.spec.priority];
      if (priorityDiff !== 0) return priorityDiff;

      if (a.spec.dueDate && b.spec.dueDate) {
        const dueDiff = a.spec.dueDate.localeCompare(b.spec.dueDate);
        if (dueDiff !== 0) return dueDiff;
      }

      const orderA = orderMap.get(a.metadata.slug) ?? Number.MAX_SAFE_INTEGER;
      const orderB = orderMap.get(b.metadata.slug) ?? Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;

      return (b.metadata.updatedAt ?? '').localeCompare(a.metadata.updatedAt ?? '');
    });
  }
}

export class GoalEngineImpl implements GoalEngine {
  constructor(private readonly store: GoalStore) {}

  list(status?: GoalStatus): Promise<GoalDefinition[]> {
    return this.store.list(status);
  }

  get(slug: string): Promise<GoalDefinition | null> {
    return this.store.get(slug);
  }

  create(input: CreateGoalInput): Promise<GoalDefinition> {
    return this.store.create(input);
  }

  async updateProgress(slug: string, input: UpdateGoalProgressInput): Promise<GoalDefinition> {
    const existing = await this.store.get(slug);
    if (!existing) throw new AnvioError('NOT_FOUND', `Goal not found: ${slug}`);

    const progress = { ...existing.spec.progress };
    if (input.percent != null) progress.percent = input.percent;

    if (input.milestone) {
      progress.milestones = progress.milestones.map((m) =>
        m.name === input.milestone!.name
          ? {
              ...m,
              completed: input.milestone!.completed,
              completedAt: input.milestone!.completed ? new Date().toISOString() : undefined,
            }
          : m,
      );
    }

    return this.store.update(slug, { progress });
  }

  async complete(slug: string): Promise<GoalDefinition> {
    const existing = await this.store.get(slug);
    if (!existing) throw new AnvioError('NOT_FOUND', `Goal not found: ${slug}`);
    return this.store.update(slug, {
      status: 'completed',
      progress: { ...existing.spec.progress, percent: 100 },
    });
  }

  pause(slug: string): Promise<GoalDefinition> {
    return this.store.update(slug, { status: 'paused' });
  }

  resume(slug: string): Promise<GoalDefinition> {
    return this.store.update(slug, { status: 'active' });
  }

  prioritize(slugs: string[]): Promise<void> {
    return this.store.setOrder(slugs);
  }
}

export function createGoalEngine(storage: FilesystemStorageProvider): GoalEngine {
  return new GoalEngineImpl(new FilesystemGoalStore(storage));
}
