import type { MemoryEntry, MemoryProvider, SoulContext, SoulDefinition, SoulStore } from '@anvio/core';
import { AnvioError, parseSoulDefinition, parseSoulDefinitionMd } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml } from 'yaml';

export class FilesystemSoulStore implements SoulStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  async list(): Promise<string[]> {
    const files = await this.storage.list('souls');
    const slugs = new Set<string>();
    for (const file of files) {
      if (file.endsWith('/SOUL.md')) {
        slugs.add(file.split('/').at(-2)!);
      } else if (file.endsWith('.md')) {
        slugs.add(file.replace(/^souls\//, '').replace(/\.md$/, ''));
      } else if (file.endsWith('.yaml') || file.endsWith('.yml')) {
        slugs.add(file.replace(/^souls\//, '').replace(/\.(yaml|yml)$/, ''));
      }
    }
    return [...slugs].filter((s) => !s.startsWith('_'));
  }

  async get(slug: string): Promise<SoulDefinition | null> {
    for (const key of [`souls/${slug}/SOUL.md`, `souls/${slug}.md`]) {
      const raw = await this.storage.read(key);
      if (raw) return parseSoulDefinitionMd(raw, slug);
    }
    for (const ext of ['yaml', 'yml']) {
      const raw = await this.storage.read(`souls/${slug}.${ext}`);
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
    const slug = toSave.metadata.slug;
    const md = renderSoulMd(toSave);
    await this.storage.write(`souls/${slug}/SOUL.md`, md);
    return toSave;
  }

  async delete(slug: string): Promise<boolean> {
    let deleted = false;
    for (const key of [`souls/${slug}/SOUL.md`, `souls/${slug}.md`, `souls/${slug}.yaml`, `souls/${slug}.yml`]) {
      if (await this.storage.exists(key)) {
        await this.storage.delete(key);
        deleted = true;
      }
    }
    return deleted;
  }
}

function renderSoulMd(definition: SoulDefinition): string {
  const { spec, metadata } = definition;
  return `# ${spec.name}

## Identity
- Name: ${spec.name}
${spec.identity.role ? `- Role: ${spec.identity.role}` : ''}
${spec.identity.description ? `- Description: ${spec.identity.description}` : ''}

## Values
${spec.values.map((v) => `- ${v}`).join('\n')}

## Personality
${spec.personality.map((v) => `- ${v}`).join('\n')}

## Preferences
${Object.entries(spec.preferences)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Communication
- Tone: ${spec.communicationStyle.tone}
- Format: ${spec.communicationStyle.format}

## Long-term goals
${spec.longTermGoals.map((v) => `- ${v}`).join('\n')}

## Behavioral tendencies
${spec.behavioralTendencies.map((v) => `- ${v}`).join('\n')}

<!-- anvio soul slug: ${metadata.slug} -->
`;
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
