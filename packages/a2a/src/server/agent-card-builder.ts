import type { AgentDefinition } from '@anvio/core';
import type { AgentCard, AgentCapabilities, AgentSkill } from '../types/agent-card.js';

export interface AgentCardBuilderOptions {
  baseUrl: string;
  organization?: string;
  organizationUrl?: string;
  enableStreaming?: boolean;
  enablePushNotifications?: boolean;
}

/**
 * Builds an A2A Agent Card from an Anvio AgentDefinition.
 * Maps frontmatter fields to A2A schema.
 */
export function buildAgentCard(
  agent: AgentDefinition,
  options: AgentCardBuilderOptions,
): AgentCard {
  const capabilities: AgentCapabilities = {
    streaming: options.enableStreaming ?? true,
    pushNotifications: options.enablePushNotifications ?? false,
    extendedAgentCard: false,
  };

  const skills: AgentSkill[] = agent.spec.skills.map((skillName, i) => ({
    skillId: `skill_${i}`,
    name: skillName,
    description: skillName,
  }));

  return {
    agentId: agent.metadata.name,
    agentName: agent.metadata.name,
    description: agent.spec.description,
    provider: options.organization
      ? { organization: options.organization, url: options.organizationUrl }
      : undefined,
    capabilities,
    endpoints: [
      {
        url: `${options.baseUrl}/a2a`,
        protocolBinding: 'json-rpc',
      },
      {
        url: `${options.baseUrl}/a2a`,
        protocolBinding: 'http+json',
      },
    ],
    skills: skills.length > 0 ? skills : undefined,
    metadata: {
      anvioVersion: agent.metadata.version,
      runtime: agent.spec.runtime?.provider ?? 'local',
    },
  };
}

/**
 * Builds Agent Cards for all agents in a workspace.
 */
export function buildAgentCards(
  agents: AgentDefinition[],
  options: AgentCardBuilderOptions,
): AgentCard[] {
  return agents.map((a) => buildAgentCard(a, options));
}
