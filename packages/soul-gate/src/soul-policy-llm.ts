import type { ModelProvider, SoulPolicy } from '@anvio/core';
import { parseSoulPolicy } from '@anvio/core';
import { parseSoulMd } from './soul-md-parser.js';
import { verifyPolicyIds } from './verifier.js';

const SYSTEM_PROMPT = `You extract enforceable agent policy from SOUL.md markdown.
Respond with ONLY valid JSON matching this shape (no markdown fences):
{
  "soulSlug": "optional-slug",
  "identity": { "name": "string", "role": "string", "voice": "string" },
  "manager": { "channel": "*", "userId": "id-from-source" },
  "backupManager": { "channel": "*", "userId": "id" },
  "allowedZones": [{ "channel": "*", "ids": ["channel-or-zone-ids"] }],
  "trustedZones": [{ "channel": "*", "ids": ["ids"] }],
  "blockedUsers": [{ "channel": "*", "userId": "id-from-source" }],
  "approvers": [{ "channel": "slack|telegram|*|...", "userId": "id", "scope": "keywords", "catchall": false }],
  "redactPatterns": ["regex-or-token"],
  "approvalTimeoutSeconds": 0,
  "mandate": "string",
  "values": ["value1"]
}
Rules:
- ONLY include user/channel ids that appear verbatim in the source SOUL.md.
- Do not invent approvers, managers, or blocked users.
- Parse Approvers lines like "slack:U123: database migrations ; catchall".`;

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

function isUsableModelProvider(provider: ModelProvider | undefined): provider is ModelProvider {
  return provider != null && provider.providerId !== 'mock';
}

/** LLM projection of SOUL.md → SoulPolicy with regex fallback. */
export async function extractSoulPolicy(
  source: string,
  slug: string | undefined,
  modelProvider?: ModelProvider,
): Promise<SoulPolicy> {
  const regexPolicy = parseSoulMd(source, slug);

  if (!isUsableModelProvider(modelProvider)) {
    return regexPolicy;
  }

  try {
    const response = await modelProvider.chat({
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: source }],
      maxTokens: 4096,
      temperature: 0,
    });

    const parsed = parseLlmJson<Partial<SoulPolicy>>(response.content);
    if (!parsed) return regexPolicy;

    const merged = parseSoulPolicy({
      ...regexPolicy,
      ...parsed,
      soulSlug: parsed.soulSlug ?? slug ?? regexPolicy.soulSlug,
      identity: { ...regexPolicy.identity, ...parsed.identity },
    });

    return verifyPolicyIds(source, merged);
  } catch {
    return regexPolicy;
  }
}
