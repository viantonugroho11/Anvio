import type { ConfigLoader, SkillDefinition } from '@anvio/core';
import { AnvioError, parseSkillDefinition } from '@anvio/core';
import type { SkillCatalogResolver } from './catalog-resolver.js';

export class SkillRegistry {
  constructor(
    private readonly loader: ConfigLoader,
    private readonly catalog?: SkillCatalogResolver,
  ) {}

  async getBySlugs(slugs: string[]): Promise<SkillDefinition['spec'][]> {
    if (slugs.length === 0) return [];
    const results: SkillDefinition['spec'][] = [];
    for (const slug of slugs) {
      try {
        const def = this.catalog
          ? await this.catalog.load(slug)
          : parseSkillDefinition(await this.loader.loadSkill(slug));
        results.push(def.spec);
      } catch {
        throw new AnvioError('NOT_FOUND', `Skill not found: ${slug}`);
      }
    }
    return results;
  }

  renderSkillInstructions(skillSpecs: SkillDefinition['spec'][]): string {
    if (skillSpecs.length === 0) return '';
    return skillSpecs.map((s) => renderOneSkill(s)).join('\n\n---\n\n');
  }
}

function renderOneSkill(s: SkillDefinition['spec']): string {
  const parts: string[] = [`## Skill: ${s.name}`, s.description, ''];

  if (s.parameters.length > 0) {
    parts.push('### Parameters');
    for (const p of s.parameters) {
      const req = p.required ? '(required)' : '(optional)';
      const desc = p.description ? ` — ${p.description}` : '';
      const def = p.default !== undefined ? ` [default: ${JSON.stringify(p.default)}]` : '';
      const vals = p.enum?.length ? ` (values: ${p.enum.join(', ')})` : '';
      parts.push(`- \`${p.name}\`: ${p.type} ${req}${desc}${def}${vals}`);
    }
    parts.push('');
  }

  parts.push(s.instructions);

  if (s.steps.length > 0) {
    parts.push('', '### Steps');
    for (let i = 0; i < s.steps.length; i++) {
      const step = s.steps[i];
      let line = `${i + 1}. **${step.action}**`;
      if (step.tool) line += ` → tool: \`${step.tool}\``;
      if (step.condition) line += ` (when: ${step.condition})`;
      if (step.output) line += ` → $${step.output}`;
      parts.push(line);
    }
    parts.push('');
  }

  if (s.outputs.length > 0) {
    parts.push('### Outputs');
    for (const o of s.outputs) {
      const desc = o.description ? ` — ${o.description}` : '';
      parts.push(`- \`${o.name}\`: ${o.type}${desc}`);
    }
    parts.push('');
  }

  return parts.join('\n');
}

export {
  SkillCatalogResolver,
  createSkillCatalogResolver,
} from './catalog-resolver.js';
export { SkillInstaller, createSkillInstaller } from './skill-installer.js';
