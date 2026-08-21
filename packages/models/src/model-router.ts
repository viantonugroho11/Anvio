import type {
  AgentDefinition,
  ChatRequest,
  ChatResponse,
  CredentialPoolManager,
  ModelProvider,
  ProviderRouting,
  RouteTarget,
  StreamChunk,
} from '@anvio/core';
import { parseProviderRouting } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml } from 'yaml';
import { createModelProvider } from './provider-factory.js';
import { walkFallbackChain } from './fallback-chain.js';
import type { ProviderCircuitBreaker } from './circuit-breaker.js';
import { providerStreamError } from './provider-error.js';
import { classifyTask, type TaskRoute } from './task-classifier.js';
import { SpendBudgetLedger } from './spend-budget.js';
import { costInputFromUsage, estimateModelCostUsd } from './model-descriptor.js';

export interface ModelRouterDeps {
  storage: FilesystemStorageProvider;
  providers: Map<string, ModelProvider>;
  credentialPools?: CredentialPoolManager;
  /** Optional per-key USD budget ledger; when set, router charges every successful call. */
  spendBudget?: SpendBudgetLedger;
  /**
   * Skips targets whose circuit is open, on both `chat` and `stream`. Optional so
   * a router built for inspection (`anvio routing show`) carries no health state.
   */
  breaker?: ProviderCircuitBreaker;
}

/**
 * A provider stream advanced far enough to know the call is alive, with the
 * chunks consumed in the process kept for replay.
 */
interface PrimedStream {
  buffered: StreamChunk[];
  iterator: AsyncIterator<StreamChunk>;
}

export interface RoutedChatRequest extends ChatRequest {
  agent?: AgentDefinition;
  message?: string;
  skillRoutingHints?: string[];
  routeOverride?: TaskRoute;
  /** Ledger key to charge for this call; ignored when `deps.spendBudget` unset. */
  budgetKey?: string;
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
      this.chargeBudget(request, agentOverride.override.provider, result.model, result.usage);
      return {
        ...result,
        selectedProvider: agentOverride.override.provider,
        selectedModel: agentOverride.override.model ?? result.model,
        failover: false,
        route: 'default',
      };
    }

    const routeName =
      request.routeOverride ??
      classifyTask({
        agent: request.agent,
        skillRoutingHints: request.skillRoutingHints,
        message: request.message ?? request.messages.at(-1)?.content,
      });

    const routeDef = this.routing?.spec.routes[routeName] ?? this.routing?.spec.routes.coding;
    if (!routeDef) {
      const fallback = this.deps.providers.values().next().value;
      if (!fallback) throw new Error('No model providers registered');
      const result = await fallback.chat(request);
      this.chargeBudget(request, fallback.providerId, result.model, result.usage);
      return {
        ...result,
        selectedProvider: fallback.providerId,
        selectedModel: result.model,
        failover: false,
        route: routeName,
      };
    }

    const chainResult = await walkFallbackChain(
      routeDef,
      async (target) => {
        const provider = await this.resolveProvider(target);
        return provider.chat({
          ...request,
          model: target.model ?? request.model,
        });
      },
      { breaker: this.deps.breaker },
    );

    this.chargeBudget(
      request,
      chainResult.target.provider,
      chainResult.target.model ?? chainResult.result.model,
      chainResult.result.usage,
    );

    return {
      ...chainResult.result,
      selectedProvider: chainResult.target.provider,
      selectedModel: chainResult.target.model ?? chainResult.result.model,
      failover: chainResult.failover,
      route: routeName,
    };
  }

  /**
   * Streams a routed call, failing over to the next target when the chosen provider
   * dies **before emitting anything**.
   *
   * That qualifier is the whole design. Once a `text_delta` or `tool_use` has been
   * yielded it is already on the user's screen and cannot be retracted, so the
   * failover window closes there and any later failure is surfaced as-is. To make
   * the window exist at all, each candidate is advanced to its first content chunk
   * before the chain commits — see `primeStream`. That costs nothing extra in the
   * common case: the chunks pulled while priming are replayed, not discarded.
   *
   * `directProvider` is used when no route matches, so a workspace with no
   * `providers/routing.yaml` behaves exactly as it did before the router existed —
   * the caller's own resolved provider, not an arbitrary first entry.
   */
  async *stream(
    request: RoutedChatRequest,
    directProvider?: ModelProvider,
  ): AsyncIterable<StreamChunk> {
    if (!this.routing) await this.loadRouting();

    const routeName =
      request.routeOverride ??
      classifyTask({
        agent: request.agent,
        skillRoutingHints: request.skillRoutingHints,
        message: request.message ?? request.messages.at(-1)?.content,
      });

    const routeDef = this.routing?.spec.routes[routeName] ?? this.routing?.spec.routes.coding;
    if (!routeDef) {
      const direct = directProvider ?? this.deps.providers.values().next().value;
      if (!direct) throw new Error('No model providers registered');
      yield* this.drain(
        direct.stream(request)[Symbol.asyncIterator](),
        [],
        request,
        direct.providerId,
        request.model,
      );
      return;
    }

    const chain = await walkFallbackChain(
      routeDef,
      async (target) => {
        const provider = await this.resolveProvider(target);
        return this.primeStream(provider, target, request);
      },
      { breaker: this.deps.breaker },
    );

    yield* this.drain(
      chain.result.iterator,
      chain.result.buffered,
      request,
      chain.target.provider,
      chain.target.model ?? request.model,
    );
  }

  /**
   * Advances a provider's stream until the call has proven itself — first content,
   * a terminal error, or completion — keeping whatever it consumed for replay.
   *
   * A retryable error seen here is thrown rather than returned: adapters report
   * failures as `error` chunks, and `walkFallbackChain` only reacts to exceptions.
   * Nothing has been emitted to the caller at this point, which is what makes the
   * failover invisible.
   */
  private async primeStream(
    provider: ModelProvider,
    target: RouteTarget,
    request: RoutedChatRequest,
  ): Promise<PrimedStream> {
    const source = provider.stream({ ...request, model: target.model ?? request.model });
    const iterator = source[Symbol.asyncIterator]();
    const buffered: StreamChunk[] = [];

    for (;;) {
      const next = await iterator.next();
      if (next.done) return { buffered, iterator };

      const chunk = next.value;
      if (chunk.type === 'error') {
        if (chunk.retryable) {
          throw providerStreamError(
            target.provider,
            chunk.error ?? 'stream failed before producing output',
            true,
          );
        }
        buffered.push(chunk);
        return { buffered, iterator };
      }

      buffered.push(chunk);
      // Content is committed from here on; so is the choice of provider.
      if (chunk.type === 'text_delta' || chunk.type === 'tool_use' || chunk.type === 'done') {
        return { buffered, iterator };
      }
    }
  }

  private async *drain(
    iterator: AsyncIterator<StreamChunk>,
    buffered: StreamChunk[],
    request: RoutedChatRequest,
    provider: string,
    model: string | undefined,
  ): AsyncIterable<StreamChunk> {
    const charge = (chunk: StreamChunk) => {
      if (chunk.type === 'done' && chunk.usage && model) {
        this.chargeBudget(request, provider, model, chunk.usage);
      }
    };

    for (const chunk of buffered) {
      charge(chunk);
      yield chunk;
    }

    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      charge(next.value);
      yield next.value;
    }
  }

  private chargeBudget(
    request: RoutedChatRequest,
    provider: string,
    model: string,
    usage: ChatResponse['usage'],
  ): void {
    if (!this.deps.spendBudget || !request.budgetKey) return;
    // usage.inputTokens already includes the cache counts, so the buckets must be
    // made disjoint before costing or cached tokens are billed twice.
    const usd = estimateModelCostUsd(provider, model, costInputFromUsage(usage));
    if (usd == null || usd === 0) return;
    // Throws MODEL_SPEND_BUDGET_EXCEEDED (typed AnvioError, HTTP 402) when cap would be exceeded.
    this.deps.spendBudget.charge(request.budgetKey, usd);
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
