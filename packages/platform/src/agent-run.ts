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
  },
): Promise<void> {
  await eventBus.publishCore(EventSubjects.AGENT_RUN_COMPLETED, 'anvio.agent.run.completed', {
    sessionId: input.sessionId,
    content: input.content,
    usage: input.usage,
    status: input.status ?? 'completed',
    channel: input.channel,
  });
}

export async function finalizeAgentRun(
  eventBus: EventBusLike,
  input: {
    sessionId: string;
    content: string;
    channel: string;
    usage?: TokenUsage;
  },
): Promise<void> {
  await publishAgentRunCompleted(eventBus, input);
}
