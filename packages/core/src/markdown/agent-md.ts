import type { AgentDefinition } from '../schemas/agent.schema.js';
import { parseAgentDefinition } from '../schemas/agent.schema.js';
import { parseFrontmatter } from './frontmatter.js';

export interface AgentMdFrontmatter {
  description?: string;
  persona?: string;
  soul?: string;
  skills?: string[];
  tools?: string[];
  model?: {
    provider?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    baseUrl?: string;
    apiKeyEnv?: string;
  };
  memory?: AgentDefinition['spec']['memory'];
  orchestration?: AgentDefinition['spec']['orchestration'];
  approvals?: AgentDefinition['spec']['approvals'];
  runtime?: AgentDefinition['spec']['runtime'];
  version?: string;
}

/** Parse Hermes-profile-style AGENT.md into Anvio AgentDefinition. */
export function parseAgentMd(source: string, name: string): AgentDefinition {
  const { frontmatter, body } = parseFrontmatter<AgentMdFrontmatter>(source);
  const titleMatch = body.match(/^#\s+(.+)$/m);

  return parseAgentDefinition({
    apiVersion: 'anvio.io/v1',
    kind: 'Agent',
    metadata: {
      name,
      version: frontmatter.version ?? '1.0.0',
    },
    spec: {
      description:
        frontmatter.description ?? titleMatch?.[1]?.trim() ?? body.split('\n').find((l) => l.trim()) ?? name,
      persona: frontmatter.persona ?? name,
      soul: frontmatter.soul,
      skills: frontmatter.skills ?? [],
      tools: frontmatter.tools ?? [],
      model: {
        provider: frontmatter.model?.provider ?? 'anthropic',
        model: frontmatter.model?.model ?? 'claude-sonnet-4-20250514',
        maxTokens: frontmatter.model?.maxTokens ?? 8192,
        temperature: frontmatter.model?.temperature,
        baseUrl: frontmatter.model?.baseUrl,
        apiKeyEnv: frontmatter.model?.apiKeyEnv,
      },
      memory: frontmatter.memory,
      orchestration: frontmatter.orchestration,
      approvals: frontmatter.approvals,
      runtime: frontmatter.runtime,
    },
  });
}
