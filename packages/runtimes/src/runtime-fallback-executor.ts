import type {
  AgentDefinition,
  RuntimeProvider,
  RuntimeProviderId,
  RuntimeRequest,
  RuntimeResult,
  RuntimeStreamEvent,
} from '@anvio/core';
import {
  buildAgentRuntimeChain,
  isRuntimeFailoverRetryable,
  isRuntimeFailoverRetryableMessage,
  type RuntimeFallbackAttempt,
  type RuntimeFallbackRunResult,
} from './runtime-fallback-chain.js';

export interface RuntimeFactoryLike {
  get(id: RuntimeProviderId): RuntimeProvider;
}

export async function runWithRuntimeFallback(
  factory: RuntimeFactoryLike,
  agent: AgentDefinition,
  request: RuntimeRequest,
  defaultRuntime: RuntimeProviderId = 'local',
): Promise<RuntimeResult & RuntimeFallbackRunResult> {
  const chain = buildAgentRuntimeChain(agent, defaultRuntime);
  const attempts: RuntimeFallbackAttempt[] = [];

  for (let i = 0; i < chain.length; i += 1) {
    const id = chain[i]!;
    const provider = factory.get(id);
    if (!provider.isConfigured()) continue;

    try {
      const result = await provider.run(request);
      if (result.status === 'failed' && isRuntimeFailoverRetryableMessage(result.content)) {
        attempts.push({ runtimeId: id, error: result.content });
        if (i < chain.length - 1) continue;
      }
      return { ...result, failover: attempts.length > 0, attempts };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attempts.push({ runtimeId: id, error: message });
      if (!isRuntimeFailoverRetryable(error) || i === chain.length - 1) {
        throw error;
      }
    }
  }

  throw new Error(
    `Runtime fallback chain exhausted (${chain.join(' → ')}). Attempts: ${attempts.map((a) => a.runtimeId).join(', ') || 'none configured'}`,
  );
}

export async function* streamWithRuntimeFallback(
  factory: RuntimeFactoryLike,
  agent: AgentDefinition,
  request: RuntimeRequest,
  defaultRuntime: RuntimeProviderId = 'local',
): AsyncIterable<RuntimeStreamEvent> {
  const chain = buildAgentRuntimeChain(agent, defaultRuntime);
  const attempts: RuntimeFallbackAttempt[] = [];

  for (let i = 0; i < chain.length; i += 1) {
    const id = chain[i]!;
    const provider = factory.get(id);
    if (!provider.isConfigured()) continue;

    try {
      for await (const event of provider.stream(request)) {
        if (event.type === 'error' && event.error && isRuntimeFailoverRetryableMessage(event.error)) {
          attempts.push({ runtimeId: id, error: event.error });
          throw new Error(event.error);
        }
        yield event;
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!attempts.some((a) => a.runtimeId === id && a.error === message)) {
        attempts.push({ runtimeId: id, error: message });
      }
      if (!isRuntimeFailoverRetryable(error) || i === chain.length - 1) {
        yield { type: 'error', error: message };
        return;
      }
    }
  }

  yield {
    type: 'error',
    error: `Runtime fallback chain exhausted (${chain.join(' → ')})`,
  };
}
