import type { SoulDefinition } from '../schemas/soul.schema.js';
import { parseSoulDefinition } from '../schemas/soul.schema.js';

function sectionBody(source: string, heading: string): string {
  const pattern = new RegExp(`^##\\s+${heading}\\s*$`, 'im');
  const match = pattern.exec(source);
  if (!match) return '';
  const rest = source.slice(match.index + match[0].length);
  const nextHeading = /^##\s+/m.exec(rest);
  return (nextHeading ? rest.slice(0, nextHeading.index) : rest).trim();
}

function bullets(body: string): string[] {
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('-'))
    .map((l) => l.replace(/^-\s*/, '').replace(/;.*$/, '').trim())
    .filter(Boolean);
}

function field(body: string, label: string): string | undefined {
  const re = new RegExp(`^[-*]?\\s*${label}\\s*[:\\-]\\s*(.+)$`, 'im');
  for (const line of body.split('\n')) {
    const m = re.exec(line.trim());
    if (m) return m[1]!.trim();
  }
  return undefined;
}

/** Map Hermes-style SOUL.md to SoulDefinition (identity layer; policy via soul-gate). */
export function parseSoulDefinitionMd(source: string, slug: string): SoulDefinition {
  const titleMatch = source.match(/^#\s+(.+)$/m);
  const identityBody = sectionBody(source, 'Identity');
  const commBody = sectionBody(source, 'Communication');

  return parseSoulDefinition({
    apiVersion: 'anvio.io/v1',
    kind: 'Soul',
    metadata: { slug, version: '1.0.0' },
    spec: {
      name: field(identityBody, 'Name') ?? titleMatch?.[1]?.trim() ?? slug,
      identity: {
        role: field(identityBody, 'Role'),
        description: field(identityBody, 'Description'),
      },
      values: bullets(sectionBody(source, 'Values')),
      personality: bullets(sectionBody(source, 'Personality')),
      preferences: Object.fromEntries(
        bullets(sectionBody(source, 'Preferences')).map((line) => {
          const [k, ...rest] = line.split(':');
          return [k?.trim() ?? line, rest.join(':').trim() || 'true'];
        }),
      ),
      communicationStyle: {
        tone: field(commBody, 'Tone') ?? 'professional',
        format: field(commBody, 'Format') ?? 'clear and concise',
      },
      longTermGoals: bullets(sectionBody(source, 'Long-term goals')).length
        ? bullets(sectionBody(source, 'Long-term goals'))
        : bullets(sectionBody(source, 'Goals')),
      behavioralTendencies: bullets(sectionBody(source, 'Behavioral tendencies')),
      relationshipMemory: { provider: 'filesystem', path: `${slug}/relationship` },
      evolution: { allowAutoUpdate: true, requireApproval: false },
    },
  });
}
