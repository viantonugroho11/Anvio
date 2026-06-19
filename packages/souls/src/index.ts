import type { MemoryEntry, MemoryProvider, SoulContext, SoulDefinition, SoulStore } from '@anvio/core';
import { AnvioError, parseSoulDefinition } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export class FilesystemSoulStore implements SoulStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  private soulKey(slug: string): string {
    return `souls/${slug}.yaml`;
  }

  async list(): Promise<string[]> {
    const files = await this.storage.list('souls');
    return files
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => f.replace(/^souls\//, '').replace(/\.(yaml|yml)$/, ''));
  }

  async get(slug: string): Promise<SoulDefinition | null> {
    for (const ext of ['yaml', 'yml']) {
      const raw = await this.storage.read(this.soulKey(slug).replace('.yaml', `.${ext}`));
      if (raw) return parseSoulDefinition(parseYaml(raw));
    }
    return null;
  }

  async save(definition: SoulDefinition): Promise<SoulDefinition> {
    const now = new Date().toISOString();
    const toSave: SoulDefinition = {
      ...definition,
      metadata: {
        ...definition.metadata,
        createdAt: definition.metadata.createdAt ?? now,
        updatedAt: now,
      },
    };
    await this.storage.write(this.soulKey(toSave.metadata.slug), stringifyYaml(toSave));
    return toSave;
  }

  async delete(slug: string): Promise<boolean> {
    for (const ext of ['yaml', 'yml']) {
      const key = `souls/${slug}.${ext}`;
      if (await this.storage.exists(key)) {
        await this.storage.delete(key);
        return true;
      }
    }
    return false;
  }
}

export class SoulEngineImpl {
  constructor(
    private readonly store: SoulStore,
    private readonly memory: {
      getByUser(userId: string, type?: MemoryEntry['type'], limit?: number): Promise<MemoryEntry[]>;
    },
  ) {}

  async load(slug: string, userId: string): Promise<SoulContext> {
    const definition = await this.store.get(slug);
    if (!definition) {
      throw new AnvioError('NOT_FOUND', `Soul not found: ${slug}`);
    }
    return this.assembleContext(definition, userId);
  }

  async assembleContext(definition: SoulDefinition, userId: string): Promise<SoulContext> {
    const relationshipFacts = await this.memory.getByUser(userId, 'fact', 20);
    const { spec, metadata } = definition;

    return {
      soulId: metadata.slug,
      name: spec.name,
      identity: {
        role: spec.identity.role,
        description: spec.identity.description,
      },
      values: spec.values,
      personality: spec.personality,
      preferences: spec.preferences,
      communicationStyle: {
        tone: spec.communicationStyle.tone,
        format: spec.communicationStyle.format,
      },
      longTermGoals: spec.longTermGoals,
      behavioralTendencies: spec.behavioralTendencies,
      relationshipFacts,
    };
  }
}

export class SoulService {
  constructor(
    private readonly store: SoulStore,
    private readonly engine: SoulEngineImpl,
  ) {}

  async list(): Promise<string[]> {
    return this.store.list();
  }

  async get(slug: string): Promise<SoulDefinition> {
    const soul = await this.store.get(slug);
    if (!soul) throw new AnvioError('NOT_FOUND', `Soul not found: ${slug}`);
    return soul;
  }

  async create(definition: SoulDefinition): Promise<SoulDefinition> {
    return this.store.save(definition);
  }

  async loadContext(slug: string, userId: string): Promise<SoulContext> {
    return this.engine.load(slug, userId);
  }

  renderSoulContext(context: SoulContext): string {
    const lines = [
      `Soul Identity: ${context.name}`,
      context.identity.role ? `Role: ${context.identity.role}` : null,
      context.identity.description ? `Description: ${context.identity.description}` : null,
      context.values.length ? `Values: ${context.values.join(', ')}` : null,
      context.personality.length ? `Personality: ${context.personality.join(', ')}` : null,
      Object.keys(context.preferences).length
        ? `Preferences: ${Object.entries(context.preferences)
            .map(([k, v]) => `${k}=${v}`)
            .join(', ')}`
        : null,
      `Communication: ${context.communicationStyle.tone}, ${context.communicationStyle.format}`,
      context.longTermGoals.length ? `Long-term goals: ${context.longTermGoals.join('; ')}` : null,
      context.behavioralTendencies.length
        ? `Behavioral tendencies:\n${context.behavioralTendencies.map((b) => `- ${b}`).join('\n')}`
        : null,
      context.relationshipFacts.length
        ? `Relationship memory:\n${context.relationshipFacts.map((f) => `- ${f.content}`).join('\n')}`
        : null,
    ].filter(Boolean);

    return lines.join('\n');
  }
}

export function createSoulService(
  storage: FilesystemStorageProvider,
  memory: MemoryProvider,
): SoulService {
  const store = new FilesystemSoulStore(storage);
  const engine = new SoulEngineImpl(store, memory);
  return new SoulService(store, engine);
}
