import type {
  BuiltinToolCall,
  BuiltinToolResult,
  ModelToolDefinition,
  RuntimeToolContext,
  RuntimeToolPort,
  SkillDefinition,
} from '@anvio/core';
import { executeSkill } from './executor.js';
import { validateParams } from './param-validator.js';
import type { SkillCatalogResolver } from './catalog-resolver.js';

const SKILL_TOOL_PREFIX = 'skill__';

/**
 * Wraps composable skills as a RuntimeToolPort so the agent runtime
 * and SkillExecutor can invoke them identically to gateway tools.
 */
export class ComposableSkillRegistry {
  private readonly skills = new Map<string, SkillDefinition>();

  constructor(
    private readonly catalog?: SkillCatalogResolver,
    private readonly downstreamPort?: RuntimeToolPort,
  ) {}

  register(skill: SkillDefinition): void {
    if (skill.spec.composable) {
      this.skills.set(skill.metadata.slug, skill);
    }
  }

  registerAll(skills: SkillDefinition[]): void {
    for (const s of skills) this.register(s);
  }

  has(slug: string): boolean {
    return this.skills.has(slug);
  }

  async resolve(slug: string): Promise<SkillDefinition | null> {
    if (this.skills.has(slug)) return this.skills.get(slug)!;
    if (this.catalog) {
      try {
        const def = await this.catalog.load(slug);
        return def;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Build a RuntimeToolPort that serves all composable skills as tools
   * named "skill__<slug>", delegating non-skill calls to downstreamPort.
   */
  buildToolPort(): RuntimeToolPort {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    return {
      listTools(): string[] {
        const skillTools = [...self.skills.keys()].map((s) => `${SKILL_TOOL_PREFIX}${s}`);
        const downstream = self.downstreamPort?.listTools() ?? [];
        return [...skillTools, ...downstream];
      },

      getToolInstructions(): string {
        const lines: string[] = [];
        for (const [slug, skill] of self.skills) {
          lines.push(`- \`${SKILL_TOOL_PREFIX}${slug}\`: ${skill.spec.description}`);
        }
        const downstream = self.downstreamPort?.getToolInstructions() ?? '';
        return [lines.join('\n'), downstream].filter(Boolean).join('\n');
      },

      getModelToolDefinitions(): ModelToolDefinition[] {
        const defs: ModelToolDefinition[] = [];
        for (const [slug, skill] of self.skills) {
          const properties: Record<string, unknown> = {};
          const required: string[] = [];
          for (const p of skill.spec.parameters) {
            properties[p.name] = {
              type: p.type,
              description: p.description ?? p.name,
              ...(p.enum ? { enum: p.enum } : {}),
            };
            if (p.required) required.push(p.name);
          }
          defs.push({
            name: `${SKILL_TOOL_PREFIX}${slug}`,
            description: skill.spec.description,
            inputSchema: { type: 'object', properties, required },
          });
        }
        return [...defs, ...(self.downstreamPort?.getModelToolDefinitions?.() ?? [])];
      },

      async call(call: BuiltinToolCall, ctx: RuntimeToolContext): Promise<BuiltinToolResult> {
        if (call.name.startsWith(SKILL_TOOL_PREFIX)) {
          const slug = call.name.slice(SKILL_TOOL_PREFIX.length);
          const skill = self.skills.get(slug);
          if (!skill) {
            return { name: call.name, status: 'failed', output: null, error: `Composable skill "${slug}" not found` };
          }

          try {
            const params = (call.arguments ?? {}) as Record<string, unknown>;
            validateParams(skill.spec.parameters, params);
            const result = await executeSkill({
              skill,
              params,
              toolPort: self.downstreamPort,
              ctx,
              resolveSkill: (s) => self.resolve(s),
            });
            return {
              name: call.name,
              status: 'completed',
              output: JSON.stringify(result.outputs),
            };
          } catch (err) {
            return {
              name: call.name,
              status: 'failed',
              output: null,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        }

        if (self.downstreamPort) {
          return self.downstreamPort.call(call, ctx);
        }

        return { name: call.name, status: 'failed', output: null, error: `Unknown tool: ${call.name}` };
      },
    };
  }
}

export function createComposableSkillRegistry(
  skills: SkillDefinition[],
  catalog?: SkillCatalogResolver,
  downstreamPort?: RuntimeToolPort,
): ComposableSkillRegistry {
  const reg = new ComposableSkillRegistry(catalog, downstreamPort);
  reg.registerAll(skills);
  return reg;
}
