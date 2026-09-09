import type { AgentDefinition } from '@anvio/core';
import type { AgentCard } from '@a2a-js/sdk';
import { A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';

export interface AgentCardBuilderOptions {
  baseUrl: string;
  provider?: { organization: string; url: string };
}

/**
 * Converts an Anvio AgentDefinition into an A2A v1.0 AgentCard
 * using the official SDK types.
 */
export function buildAgentCard(
  agent: AgentDefinition,
  options: AgentCardBuilderOptions,
): AgentCard {
  const baseUrl = options.baseUrl.replace(/\/$/, '');

  return {
    name: agent.metadata.name,
    description: agent.spec.description ?? '',
    version: agent.metadata.version ?? '1.0.0',
    provider: options.provider ?? {
      organization: 'Anvio',
      url: baseUrl,
    },
    supportedInterfaces: [
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: 'JSONRPC',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
      {
        url: `${baseUrl}/a2a`,
        protocolBinding: 'HTTP+JSON',
        tenant: '',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    capabilities: {
      streaming: true,
      pushNotifications: true,
      extensions: [],
      extendedAgentCard: false,
    },
    skills: (agent.spec.skills ?? []).map((s: string) => ({
      id: s,
      name: s,
      description: '',
      tags: [],
      examples: [],
      inputModes: ['text'],
      outputModes: ['text'],
      securityRequirements: [],
    })),
    securitySchemes: {},
    securityRequirements: [],
    defaultInputModes: ['text'],
    defaultOutputModes: ['text'],
    documentationUrl: '',
    signatures: [],
  };
}

export function buildAgentCards(
  agents: AgentDefinition[],
  options: AgentCardBuilderOptions,
): AgentCard[] {
  return agents.map((a) => buildAgentCard(a, options));
}
