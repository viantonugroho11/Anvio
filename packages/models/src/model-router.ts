import type {
  AgentDefinition,
  ChatRequest,
  ChatResponse,
  CredentialPoolManager,
  ModelProvider,
  ProviderRouting,
  RouteTarget,
} from '@anvio/core';
import { parseProviderRouting } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml } from 'yaml';
import { createModelProvider } from './provider-factory.js';
import { walkFallbackChain } from './fallback-chain.js';
import { classifyTask, type TaskRoute } from './task-classifier.js';

export interface ModelRouterDeps {
  storage: FilesystemStorageProvider;
  providers: Map<string, ModelProvider>;
  credentialPools?: CredentialPoolManager;
}

export interface RoutedChatRequest extends ChatRequest {
  agent?: AgentDefinition;
  message?: string;
  skillRoutingHints?: string[];
  routeOverride?: TaskRoute;
}

export interface RoutedChatResponse extends ChatResponse {
  selectedProvider: string;
  selectedModel?: string;
  failover: boolean;
  route: TaskRoute;
}

export class ModelRouter {
  private routing: ProviderRouting | null = null;

  constructor(private readonly deps: ModelRouterDeps) {}

  async loadRouting(): Promise<ProviderRouting | null> {
    const raw = await this.deps.storage.read('providers/routing.yaml');
    if (!raw) {
      this.routing = null;
      return null;
    }
    this.routing = parseProviderRouting(parseYaml(raw));
    return this.routing;
  }

  async chat(request: RoutedChatRequest): Promise<RoutedChatResponse> {
    if (!this.routing) await this.loadRouting();

    const agentOverride = request.agent?.spec.model as {
      override?: { provider?: string; model?: string };
    };
    if (agentOverride?.override?.provider) {
      const provider = this.deps.providers.get(agentOverride.override.provider);
      if (!provider) {
        throw new Error(`Override provider not registered: ${agentOverride.override.provider}`);
      }
      const result = await provider.chat({
        ...request,
        model: agentOverride.override.model ?? request.model,
      });
      return {
        ...result,
        selectedProvider: agentOverride.override.provider,
        selectedModel: agentOverride.override.model ?? result.model,
        failover: false,
        route: 'default',
      };
    }

    const routeName = request.routeOverride ?? classifyTask({
      agent: request.agent,
      skillRoutingHints: request.skillRoutingHints,
      message: request.message ?? request.messages.at(-1)?.content,
    });

    const routeDef = this.routing?.spec.routes[routeName] ?? this.routing?.spec.routes.coding;
    if (!routeDef) {
      const fallback = this.deps.providers.values().next().value;
      if (!fallback) throw new Error('No model providers registered');
      const result = await fallback.chat(request);
      return {
        ...result,
        selectedProvider: fallback.providerId,
        selectedModel: result.model,
        failover: false,
        route: routeName,
      };
    }

    const chainResult = await walkFallbackChain(routeDef, async (target) => {
      const provider = await this.resolveProvider(target);
      return provider.chat({
        ...request,
        model: target.model ?? request.model,
      });
    });

    return {
      ...chainResult.result,
      selectedProvider: chainResult.target.provider,
      selectedModel: chainResult.target.model ?? chainResult.result.model,
      failover: chainResult.failover,
      route: routeName,
    };
  }

  private async resolveProvider(target: RouteTarget): Promise<ModelProvider> {
    let apiKey: string | undefined;
    if (target.pool && this.deps.credentialPools) {
      const acquired = await this.deps.credentialPools.acquire(target.pool);
      apiKey = acquired.value;
    }

    const existing = this.deps.providers.get(target.provider);
    if (existing) return existing;

    if (!apiKey) {
      throw new Error(`Provider not registered: ${target.provider}`);
    }

    return createModelProvider(target.provider, apiKey, target.model);
  }
}

export function createModelRouter(deps: ModelRouterDeps): ModelRouter {
  return new ModelRouter(deps);
}
