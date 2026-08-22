import { createHash, randomBytes } from 'node:crypto';
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
import { AnvioError, parseProviderRouting } from '@anvio/core';
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

  /**
   * Cached SDK clients, one per `provider:credentialId:model`. Each entry carries
   * a fingerprint of the credential *value*, because the id alone cannot see a
   * credential replaced in place — `anvio credentials add <pool> --id key1 --value $NEW`
   * and the settings page both reuse the id. Keying on the id alone left the cached
   * client holding the old secret until restart, which is the worst shape for a
   * rotation: the operator believes the leaked key is out of use (issue #33).
   */
  private readonly pooledProviders = new Map<
    string,
    { fingerprint: string; provider: ModelProvider }
  >();

  /**
   * Per-instance salt. The fingerprint only has to be stable inside this process,
   * so salting it keeps a value that identifies a secret from being comparable
   * across processes — or against a rainbow table — if one ever reaches a log.
   */
  private readonly fingerprintSalt = randomBytes(16);

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

    if (chain.failover) {
      const abandoned = chain.attempts.find((attempt) => attempt.error);
      if (abandoned) {
        // Emitted before any buffered content, so a surface can say the answer is
        // coming from elsewhere rather than silently substituting a second voice.
        yield {
          type: 'failover',
          from: abandoned.target.provider,
          to: chain.target.provider,
          reason: abandoned.error,
        };
      }
    }

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

    // Adapters cannot know they were routed, so the router records who served the
    // call — otherwise a failed-over answer is indistinguishable from the one the
    // agent asked for.
    const stamp = (chunk: StreamChunk): StreamChunk =>
      chunk.type === 'done' ? { ...chunk, provider, model } : chunk;

    for (const chunk of buffered) {
      charge(chunk);
      yield stamp(chunk);
    }

    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      charge(next.value);
      yield stamp(next.value);
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

  /**
   * Salted digest of a credential value, used only as a cache-invalidation marker.
   * Never logged, never returned, and never compared against anything a caller
   * supplies — it exists so the router can tell "same secret" from "replaced
   * secret" without holding a second plaintext copy of the key.
   */
  private fingerprintOf(value: string): string {
    return createHash('sha256').update(this.fingerprintSalt).update(value, 'utf8').digest('hex');
  }

  private async resolveProvider(target: RouteTarget): Promise<ModelProvider> {
    // A configured pool is the authority for this target's key. Previously the
    // acquired key was dropped on the floor and the registry's provider returned
    // instead — so rotation counters advanced on every call while the request
    // went out under the env-var key, and no pooled credential was ever used.
    if (target.pool && this.deps.credentialPools) {
      const acquired = await this.deps.credentialPools.acquire(target.pool);
      // Cached per credential, so rotation still yields a different client while
      // a stable credential does not rebuild an SDK client per request.
      const cacheKey = `${target.provider}:${acquired.credentialId}:${target.model ?? ''}`;
      const fingerprint = this.fingerprintOf(acquired.value);
      const cached = this.pooledProviders.get(cacheKey);
      // Same fingerprint means the same secret, so the cached client is still
      // correct. A different one means the credential was replaced under its id:
      // overwrite the entry, which both picks up the new secret on the very next
      // request and drops the stale client rather than keeping the old secret
      // alive in a map that would otherwise grow by one entry per rotation.
      if (cached && cached.fingerprint === fingerprint) return cached.provider;

      const provider = createModelProvider(target.provider, acquired.value, target.model);
      this.pooledProviders.set(cacheKey, { fingerprint, provider });
      return provider;
    }

    // Read through on every call rather than cached: `ModelProviderRegistry.upsert`
    // writes into this same map, so a key added at runtime must take effect here.
    const existing = this.deps.providers.get(target.provider);
    if (existing) return existing;

    throw new AnvioError(
      'MODEL_PROVIDER_ERROR',
      `Route target "${target.provider}" is neither a registered provider nor backed by a credential pool`,
    );
  }
}

export function createModelRouter(deps: ModelRouterDeps): ModelRouter {
  return new ModelRouter(deps);
}
