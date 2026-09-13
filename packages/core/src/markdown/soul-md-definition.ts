import type { SoulDefinition } from '../schemas/soul.schema.js';
import { parseSoulDefinition } from '../schemas/soul.schema.js';
import { parseFrontmatter } from './frontmatter.js';

interface SoulMdFrontmatter {
  evolution?: {
    allowAutoUpdate?: boolean;
    requireApproval?: boolean;
    captureOn?: string;
  };
}

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
  // The evolution policy used to be hardcoded here, so a SOUL.md workspace
  // had no way to turn auto-capture off — `SoulService.get()` prefers
  // SOUL.md over the YAML forms, making the field unreachable (issue #64).
  // Frontmatter now wins; the previous values remain the default.
  const { frontmatter, body: markdown } = parseFrontmatter<SoulMdFrontmatter>(source);
  const titleMatch = markdown.match(/^#\s+(.+)$/m);
  const identityBody = sectionBody(markdown, 'Identity');
  const commBody = sectionBody(markdown, 'Communication');

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
      values: bullets(sectionBody(markdown, 'Values')),
      personality: bullets(sectionBody(markdown, 'Personality')),
      preferences: Object.fromEntries(
        bullets(sectionBody(markdown, 'Preferences')).map((line) => {
          const [k, ...rest] = line.split(':');
          return [k?.trim() ?? line, rest.join(':').trim() || 'true'];
        }),
      ),
      communicationStyle: {
        tone: field(commBody, 'Tone') ?? 'professional',
        format: field(commBody, 'Format') ?? 'clear and concise',
      },
      longTermGoals: bullets(sectionBody(markdown, 'Long-term goals')).length
        ? bullets(sectionBody(markdown, 'Long-term goals'))
        : bullets(sectionBody(markdown, 'Goals')),
      behavioralTendencies: bullets(sectionBody(markdown, 'Behavioral tendencies')),
      relationshipMemory: { provider: 'filesystem', path: `${slug}/relationship` },
      evolution: {
        allowAutoUpdate: frontmatter.evolution?.allowAutoUpdate ?? true,
        requireApproval: frontmatter.evolution?.requireApproval ?? false,
        ...(frontmatter.evolution?.captureOn
          ? { captureOn: frontmatter.evolution.captureOn }
          : {}),
      },
    },
  });
}
