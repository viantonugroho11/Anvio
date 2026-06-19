import type { ConfigLoader, PersonaProfile } from '@anvio/core';
import { AnvioError, personaProfileSchema } from '@anvio/core';

export class PersonaService {
  constructor(private readonly loader: ConfigLoader) {}

  async getBySlug(slug: string): Promise<PersonaProfile> {
    try {
      const profile = await this.loader.loadPersona(slug);
      return personaProfileSchema.parse(profile);
    } catch {
      throw new AnvioError('NOT_FOUND', `Persona not found: ${slug}`);
    }
  }

  renderSystemPrompt(profile: PersonaProfile): string {
    const behaviorLines = profile.behavior.map((b) => `- ${b}`).join('\n');
    return `${profile.systemPrompt}

Communication style: ${profile.communicationStyle}
Tone: ${profile.tone}
${behaviorLines ? `\nBehavior guidelines:\n${behaviorLines}` : ''}`.trim();
  }
}

export { PersonaService as PersonaLoader };
