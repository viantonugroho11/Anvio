import type { A2AConfig, AgentDefinition, AgentRuntime } from '@anvio/core';
import { A2AServer } from '@anvio/a2a';
import type { A2AServerConfig } from '@anvio/a2a';
import { TaskState } from '@a2a-js/sdk';
import { AgentEvent } from '@a2a-js/sdk/server';
import type { Workspace } from '@anvio/workspace';
import { storedSessionToRuntime } from './session-runtime.js';

export interface A2ABootstrapOptions {
  config: A2AConfig;
  workspace: Workspace;
  runtime: AgentRuntime;
  gatewayBaseUrl: string;
  userBuilder?: A2AServerConfig['userBuilder'];
}

export async function bootstrapA2A(options: A2ABootstrapOptions): Promise<A2AServer> {
  const { config, workspace, runtime, gatewayBaseUrl } = options;

  const allAgents = await workspace.loader.listAgents();
  const agentDefs: AgentDefinition[] = [];

  for (const name of allAgents) {
    if (config.agents !== '*' && !config.agents.includes(name)) continue;
    try {
      agentDefs.push(await workspace.loader.loadAgent(name));
    } catch {
      // skip agents that fail to load
    }
  }

  if (agentDefs.length === 0) {
    throw new Error('A2A enabled but no agents found to expose');
  }

  const defaultAgent = agentDefs[0]!;

  const onMessage: A2AServerConfig['onMessage'] = async (requestContext, eventBus) => {
    const textParts = requestContext.userMessage.parts
      .filter((p) => p.content?.$case === 'text')
      .map((p) => (p.content as { $case: 'text'; value: string }).value);

    const content = textParts.join('\n');

    const stored = await workspace.sessions.create({
      userId: 'a2a-remote',
      agentName: defaultAgent.metadata.name,
      channel: 'a2a',
      messages: [],
      status: 'idle',
    });

    const session = storedSessionToRuntime(stored);
    const input = { content };

    try {
      const result = await runtime.run(session, defaultAgent, input);

      eventBus.publish(AgentEvent.statusUpdate({
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: {
          state: TaskState.TASK_STATE_COMPLETED,
          message: {
            messageId: `${requestContext.taskId}-response`,
            contextId: requestContext.contextId,
            taskId: requestContext.taskId,
            role: 2, // ROLE_AGENT
            parts: [{
              content: { $case: 'text' as const, value: result.content },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            }],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }));
    } catch (error) {
      eventBus.publish(AgentEvent.statusUpdate({
        taskId: requestContext.taskId,
        contextId: requestContext.contextId,
        status: {
          state: TaskState.TASK_STATE_FAILED,
          message: {
            messageId: `${requestContext.taskId}-error`,
            contextId: requestContext.contextId,
            taskId: requestContext.taskId,
            role: 2,
            parts: [{
              content: {
                $case: 'text' as const,
                value: error instanceof Error ? error.message : String(error),
              },
              metadata: undefined,
              filename: '',
              mediaType: 'text/plain',
            }],
            metadata: undefined,
            extensions: [],
            referenceTaskIds: [],
          },
          timestamp: new Date().toISOString(),
        },
        metadata: undefined,
      }));
    }
  };

  const server = new A2AServer({
    host: '0.0.0.0',
    port: 0,
    agents: agentDefs,
    cardOptions: {
      baseUrl: gatewayBaseUrl,
      provider: config.provider,
    },
    onMessage,
    enablePushNotifications: config.pushNotifications,
    userBuilder: options.userBuilder,
  });

  return server;
}
