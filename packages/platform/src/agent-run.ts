import type { TokenUsage } from '@anvio/core';
import { EventSubjects, type EventBusLike } from '@anvio/events';

export async function publishAgentRunCompleted(
  eventBus: EventBusLike,
  input: {
    sessionId: string;
    content: string;
    channel: string;
    usage?: TokenUsage;
    status?: 'completed' | 'failed';
    /** Provider/model that actually served the run, when the runtime reported it. */
    provider?: string;
    model?: string;
  },
): Promise<void> {
  await eventBus.publishCore(EventSubjects.AGENT_RUN_COMPLETED, 'anvio.agent.run.completed', {
    sessionId: input.sessionId,
    content: input.content,
    usage: input.usage,
    status: input.status ?? 'completed',
    channel: input.channel,
    provider: input.provider,
    model: input.model,
  });
}

export async function finalizeAgentRun(
  eventBus: EventBusLike,
  input: {
    sessionId: string;
    content: string;
    channel: string;
    usage?: TokenUsage;
    provider?: string;
    model?: string;
  },
): Promise<void> {
  await publishAgentRunCompleted(eventBus, input);
}
