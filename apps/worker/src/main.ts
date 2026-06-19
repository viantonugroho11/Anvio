import { EventSubjects, type AgentRunRequestedData } from '@anvio/events';
import { createPlatform, loadAgent, storedSessionToRuntime } from '@anvio/platform';

async function main() {
  const platform = await createPlatform({
    workspacePath: process.env.ANVIO_WORKSPACE,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { runtime, eventBus, workspace } = platform;
  console.log('Worker ready (workspace-first, auth optional)');

  await eventBus.subscribe<AgentRunRequestedData>(
    EventSubjects.AGENT_RUN_REQUESTED,
    'anvio-worker',
    async (event) => {
      const { sessionId, userId, agentId, content } = event.data;
      const stored = await workspace.sessions.get(sessionId);
      if (!stored) {
        console.error('Session not found:', sessionId);
        return;
      }

      const agent = await loadAgent(workspace, agentId);
      const session = storedSessionToRuntime(stored);
      let fullContent = '';

      for await (const chunk of runtime.stream(session, agent, { content })) {
        if (chunk.type === 'chunk' && chunk.delta) {
          fullContent += chunk.delta;
          await eventBus.publishCore(EventSubjects.AGENT_RUN_CHUNK, 'anvio.agent.run.chunk', {
            sessionId,
            delta: chunk.delta,
          });
        }
        if (chunk.type === 'done' && chunk.usage) {
          await workspace.sessions.update(sessionId, {
            messages: [
              ...stored.messages,
              { role: 'user', content },
              { role: 'assistant', content: fullContent },
            ],
            status: 'completed',
          });
          await eventBus.publishCore(
            EventSubjects.AGENT_RUN_COMPLETED,
            'anvio.agent.run.completed',
            { sessionId, content: fullContent, usage: chunk.usage, status: 'completed' },
          );
          await eventBus.publish(EventSubjects.MEMORY_STORED, 'anvio.memory.stored', {
            sessionId,
            userId,
            type: 'conversation',
          });
        }
        if (chunk.type === 'error') {
          console.error('Agent run error:', chunk.error);
        }
      }
    },
  );

  process.on('SIGINT', async () => {
    await eventBus.close();
    process.exit(0);
  });
}

main().catch(console.error);
