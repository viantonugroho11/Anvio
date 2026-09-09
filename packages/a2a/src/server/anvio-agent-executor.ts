import { randomUUID } from 'node:crypto';
import type { AgentExecutor, RequestContext, ExecutionEventBus } from '@a2a-js/sdk/server';
import { AgentEvent } from '@a2a-js/sdk/server';
import { TaskState, Role } from '@a2a-js/sdk';
import type { Task, TaskStatusUpdateEvent } from '@a2a-js/sdk';

/**
 * Callback invoked by AnvioAgentExecutor when an A2A message arrives.
 * Implementors bridge this into the Anvio agent runtime (packages/agents).
 *
 * The callback receives the full SDK RequestContext and ExecutionEventBus,
 * giving it control over task lifecycle events.
 */
export type AnvioMessageHandler = (
  requestContext: RequestContext,
  eventBus: ExecutionEventBus,
) => Promise<void>;

/**
 * Bridges Anvio's agent runtime into the official A2A SDK's AgentExecutor interface.
 *
 * The `onMessage` callback receives the RequestContext and EventBus so it can
 * publish task/status/artifact events as the Anvio agent produces output.
 */
export class AnvioAgentExecutor implements AgentExecutor {
  private readonly cancelledTasks = new Set<string>();

  constructor(private readonly onMessage: AnvioMessageHandler) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    const userMessage = requestContext.userMessage;
    const existingTask = requestContext.task;

    // Every streaming turn must begin with a Task or Message event
    const taskSnapshot: Task = existingTask ?? {
      id: taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_SUBMITTED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      artifacts: [],
      history: [userMessage],
      metadata: userMessage.metadata,
    };
    eventBus.publish(AgentEvent.task(taskSnapshot));

    // Publish working status
    const workingUpdate: TaskStatusUpdateEvent = {
      taskId,
      contextId,
      status: {
        state: TaskState.TASK_STATE_WORKING,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      metadata: {},
    };
    eventBus.publish(AgentEvent.statusUpdate(workingUpdate));

    try {
      await this.onMessage(requestContext, eventBus);
    } catch (err) {
      // If handler didn't publish terminal state, publish failed
      const failedUpdate: TaskStatusUpdateEvent = {
        taskId,
        contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          timestamp: new Date().toISOString(),
          message: {
            messageId: randomUUID(),
            role: Role.ROLE_AGENT,
            contextId,
            taskId,
            parts: [{
              content: { $case: 'text' as const, value: err instanceof Error ? err.message : 'Unknown error' },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            }],
            extensions: [],
            metadata: undefined,
            referenceTaskIds: [],
          },
        },
        metadata: {},
      };
      eventBus.publish(AgentEvent.statusUpdate(failedUpdate));
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.cancelledTasks.add(taskId);
    const cancelUpdate: TaskStatusUpdateEvent = {
      taskId,
      contextId: '',
      status: {
        state: TaskState.TASK_STATE_CANCELED,
        timestamp: new Date().toISOString(),
        message: undefined,
      },
      metadata: {},
    };
    eventBus.publish(AgentEvent.statusUpdate(cancelUpdate));
  }

  isCancelled(taskId: string): boolean {
    return this.cancelledTasks.has(taskId);
  }
}
