import type { MemoryEntry } from './memory.port.js';
import type { SoulDefinition } from '../schemas/soul.schema.js';

export interface SoulContext {
  soulId: string;
  name: string;
  identity: Record<string, string | undefined>;
  values: string[];
  personality: string[];
  preferences: Record<string, string>;
  communicationStyle: Record<string, string>;
  longTermGoals: string[];
  behavioralTendencies: string[];
  relationshipFacts: MemoryEntry[];
}

export interface SoulStore {
  list(): Promise<string[]>;
  get(slug: string): Promise<SoulDefinition | null>;
  /**
   * `source` is the SOUL.md text the definition came from, when there is one.
   * Sections the definition has no field for (`## Approvers`, `## Mandate`, …)
   * are carried over from it so saving never drops policy.
   */
  save(definition: SoulDefinition, source?: string): Promise<SoulDefinition>;
  delete(slug: string): Promise<boolean>;
}

export interface SoulEngine {
  load(slug: string, userId: string): Promise<SoulContext>;
  assembleContext(definition: SoulDefinition, userId: string): Promise<SoulContext>;
}
