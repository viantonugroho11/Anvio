import { AnvioError } from '@anvio/core';
import type { AgentDefinition, ModelProvider } from '@anvio/core';
import { createModelProvider } from './provider-factory.js';

export class ModelProviderRegistry {
  constructor(private readonly providers: Map<string, ModelProvider>) {}

  get(providerId: string): ModelProvider {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new AnvioError(
        'MODEL_PROVIDER_ERROR',
        `Provider "${providerId}" is not configured. Set the corresponding API key or base URL.`,
      );
    }
    return provider;
  }

  getOptional(providerId: string): ModelProvider | undefined {
    return this.providers.get(providerId);
  }

  resolveForAgent(agent: AgentDefinition): ModelProvider {
    const model = agent.spec.model;
    if (model.provider === 'custom' || model.baseUrl || model.apiKeyEnv) {
      return createModelProvider({
        provider: model.provider,
        model: model.model,
        baseUrl: model.baseUrl,
        apiKey: model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined,
      });
    }
    return this.get(model.provider);
  }

  first(): ModelProvider | undefined {
    return this.providers.values().next().value;
  }

  asMap(): Map<string, ModelProvider> {
    return new Map(this.providers);
  }

  listConfigured(): string[] {
    return [...this.providers.keys()];
  }
}

export function createModelProviderRegistryInstance(
  providers: Map<string, ModelProvider>,
): ModelProviderRegistry {
  return new ModelProviderRegistry(providers);
}
