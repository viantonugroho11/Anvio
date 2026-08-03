import type { ModelProvider, SoulDefinition } from '@anvio/core';
import { parseSoulDefinition, parseSoulDefinitionMd } from '@anvio/core';

const SYSTEM_PROMPT = `You extract agent identity/persona data from SOUL.md markdown into JSON.
Respond with ONLY valid JSON (no markdown fences) matching:
{
  "name": "string",
  "identity": { "role": "string|null", "description": "string|null" },
  "values": ["value1", "..."],
  "personality": ["trait1", "..."],
  "preferences": { "key": "value" },
  "communicationStyle": { "tone": "string", "format": "string" },
  "longTermGoals": ["goal1", "..."],
  "behavioralTendencies": ["tendency1", "..."]
}
Rules:
- Only pull items that are actually described in the source; do not invent traits.
- Arrays may be empty; omit fields you cannot ground in the source.
- Preserve the author's wording where reasonable.`;

function isUsableModelProvider(provider: ModelProvider | undefined): provider is ModelProvider {
  return provider != null && provider.providerId !== 'mock';
}

function parseLlmJson<T>(content: string): T | undefined {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/m.exec(trimmed);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

interface LlmSoulData {
  name?: string;
  identity?: { role?: string | null; description?: string | null };
  values?: string[];
  personality?: string[];
  preferences?: Record<string, string>;
  communicationStyle?: { tone?: string; format?: string };
  longTermGoals?: string[];
  behavioralTendencies?: string[];
}

function preferArray<T>(llm: T[] | undefined, baseline: T[]): T[] {
  if (!llm) return baseline;
  if (llm.length === 0) return baseline;
  return llm;
}

function preferString(llm: string | null | undefined, baseline: string | undefined): string | undefined {
  if (llm === null) return baseline;
  const trimmed = llm?.trim();
  if (!trimmed) return baseline;
  return trimmed;
}

function mergeSoulData(baseline: SoulDefinition, llm: LlmSoulData, slug: string): SoulDefinition {
  const spec = baseline.spec;
  return parseSoulDefinition({
    ...baseline,
    metadata: { ...baseline.metadata, slug },
    spec: {
      ...spec,
      name: llm.name?.trim() || spec.name,
      identity: {
        role: preferString(llm.identity?.role, spec.identity.role),
        description: preferString(llm.identity?.description, spec.identity.description),
      },
      values: preferArray(llm.values, spec.values),
      personality: preferArray(llm.personality, spec.personality),
      preferences:
        llm.preferences && Object.keys(llm.preferences).length > 0
          ? { ...spec.preferences, ...llm.preferences }
          : spec.preferences,
      communicationStyle: {
        tone: llm.communicationStyle?.tone?.trim() || spec.communicationStyle.tone,
        format: llm.communicationStyle?.format?.trim() || spec.communicationStyle.format,
      },
      longTermGoals: preferArray(llm.longTermGoals, spec.longTermGoals),
      behavioralTendencies: preferArray(llm.behavioralTendencies, spec.behavioralTendencies),
    },
  });
}

/**
 * LLM projection of SOUL.md → SoulDefinition identity data with regex fallback.
 * Falls back to `parseSoulDefinitionMd` when no usable model provider is supplied,
 * when the LLM response is unparseable, or when the LLM call throws.
 */
export async function extractSoulData(
  source: string,
  slug: string,
  modelProvider?: ModelProvider,
): Promise<SoulDefinition> {
  const baseline = parseSoulDefinitionMd(source, slug);

  if (!isUsableModelProvider(modelProvider)) {
    return baseline;
  }

  try {
    const response = await modelProvider.chat({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: source }],
      maxTokens: 2048,
      temperature: 0,
    });

    const parsed = parseLlmJson<LlmSoulData>(response.content);
    if (!parsed) return baseline;

    return mergeSoulData(baseline, parsed, slug);
  } catch {
    return baseline;
  }
}
