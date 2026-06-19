import type { ConfigLoader, SkillDefinition } from '@anvio/core';
import { AnvioError, parseSkillDefinition } from '@anvio/core';

export class SkillRegistry {
  constructor(private readonly loader: ConfigLoader) {}

  async getBySlugs(slugs: string[]): Promise<SkillDefinition['spec'][]> {
    if (slugs.length === 0) return [];
    const results: SkillDefinition['spec'][] = [];
    for (const slug of slugs) {
      try {
        const raw = await this.loader.loadSkill(slug);
        const def = parseSkillDefinition(raw);
        results.push(def.spec);
      } catch {
        throw new AnvioError('NOT_FOUND', `Skill not found: ${slug}`);
      }
    }
    return results;
  }

  renderSkillInstructions(skillSpecs: SkillDefinition['spec'][]): string {
    if (skillSpecs.length === 0) return '';
    return skillSpecs
      .map((s) => `## Skill: ${s.name}\n${s.description}\n\n${s.instructions}`)
      .join('\n\n---\n\n');
  }
}
