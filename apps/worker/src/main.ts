import {
  EventSubjects,
  type AgentInboxInjectedData,
  type AgentRunProgressData,
  type AgentRunRequestedData,
  type AgentRunStopRequestedData,
  type ApprovalDecidedData,
} from '@anvio/events';
import type { ChannelType } from '@anvio/core';
import { createPlatform, loadAgent, storedSessionToRuntime } from '@anvio/platform';

async function main() {
  const platform = await createPlatform({
    workspacePath: process.env.ANVIO_WORKSPACE,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  });

  const { runtime, eventBus, workspace, channelHub, inbox } = platform;
  console.log('Worker ready — Channel Hub active, detached execution enabled');

  await eventBus.subscribeCore<AgentRunProgressData>(
    EventSubjects.AGENT_RUN_PROGRESS,
    async (event) => {
      const { sessionId, phase, status, channel } = event.data;
      await channelHub.sendProgress(channel as ChannelType, sessionId, {
        sessionId,
        phase,
        status,
      });
    },
  );

  await eventBus.subscribe<AgentRunStopRequestedData>(
    EventSubjects.AGENT_RUN_STOP_REQUESTED,
    'anvio-worker-stop',
    async (event) => {
      await runtime.stop?.(event.data.sessionId);
      await workspace.sessions.update(event.data.sessionId, { status: 'failed' });
    },
  );

  await eventBus.subscribe<AgentInboxInjectedData>(
    EventSubjects.AGENT_INBOX_INJECTED,
    'anvio-worker-inbox',
    async (event) => {
      const { sessionId, type, content } = event.data;
      if (type === 'stop') {
        await runtime.stop?.(sessionId);
      } else {
        const drained = await inbox.drain(sessionId);
        if (drained.some((m) => m.type === 'stop')) {
          await runtime.stop?.(sessionId);
        } else if (content) {
          await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
            sessionId,
            userId: (await workspace.sessions.get(sessionId))?.userId ?? 'local-user',
            agentId: (await workspace.sessions.get(sessionId))?.agentName ?? 'architect',
            content: `[Inbox instruction] ${content}`,
            channel: (await workspace.sessions.get(sessionId))?.channel ?? 'rest',
            detached: true,
          });
        }
      }
    },
  );

  await eventBus.subscribe<ApprovalDecidedData>(
    EventSubjects.APPROVAL_DECIDED,
    'anvio-worker-approval',
    async (event) => {
      const stored = await workspace.sessions.get(event.data.sessionId);
      if (!stored) return;
      const agent = await loadAgent(workspace, stored.agentName);
      const session = storedSessionToRuntime(stored);
      await runtime.resume(session, agent, {
        requestId: event.data.requestId,
        approved: event.data.approved,
        reason: event.data.reason,
      });
    },
  );

  await eventBus.subscribe<AgentRunRequestedData>(
    EventSubjects.AGENT_RUN_REQUESTED,
    'anvio-worker',
    async (event) => {
      const { sessionId, userId, agentId, content, channel } = event.data;
      const stored = await workspace.sessions.get(sessionId);
      if (!stored) {
        console.error('Session not found:', sessionId);
        return;
      }

      await workspace.sessions.update(sessionId, { status: 'calling_model' });

      const agent = await loadAgent(workspace, agentId);

      if (agent.spec.workspace?.isolatedWorktree && workspace.worktrees) {
        try {
          const wt = await workspace.worktrees.create(sessionId);
          await workspace.sessions.update(sessionId, {
            metadata: {
              ...stored.metadata,
              worktreePath: wt.path,
              worktreeBranch: wt.branch,
            },
          });
          console.log(`Worktree created: ${wt.path} (${wt.branch})`);
        } catch (err) {
          console.error('Worktree creation failed:', err instanceof Error ? err.message : err);
        }
      }

      const session = storedSessionToRuntime(stored);
      let fullContent = '';

      for await (const chunk of runtime.stream(session, agent, { content })) {
        if (chunk.type === 'progress') {
          await eventBus.publishCore(EventSubjects.AGENT_RUN_PROGRESS, 'anvio.agent.run.progress', {
            sessionId,
            phase: chunk.phase,
            status: chunk.status,
            channel,
          });
        }
        if (chunk.type === 'chunk' && chunk.delta) {
          fullContent += chunk.delta;
          await eventBus.publishCore(EventSubjects.AGENT_RUN_CHUNK, 'anvio.agent.run.chunk', {
            sessionId,
            delta: chunk.delta,
            channel,
          });
          await channelHub.sendMessage(channel as ChannelType, sessionId, {
            sessionId,
            type: 'chunk',
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
            { sessionId, content: fullContent, usage: chunk.usage, status: 'completed', channel },
          );
          await channelHub.sendMessage(channel as ChannelType, sessionId, {
            sessionId,
            type: 'done',
            content: fullContent,
          });
          await channelHub.sendNotification(channel as ChannelType, sessionId, {
            sessionId,
            type: 'task_completed',
            title: 'Task Completed',
            body: `Agent ${agentId} finished.`,
          });
          await eventBus.publish(EventSubjects.MEMORY_STORED, 'anvio.memory.stored', {
            sessionId,
            userId,
            type: 'conversation',
          });
        }
        if (chunk.type === 'error') {
          await workspace.sessions.update(sessionId, { status: 'failed' });
          await eventBus.publishCore(EventSubjects.AGENT_RUN_FAILED, 'anvio.agent.run.failed', {
            sessionId,
            error: chunk.error ?? 'Unknown error',
            channel,
          });
          await channelHub.sendNotification(channel as ChannelType, sessionId, {
            sessionId,
            type: 'task_failed',
            title: 'Task Failed',
            body: chunk.error,
          });
        }
      }
    },
  );

  process.on('SIGINT', async () => {
    await channelHub.stopAll();
    await eventBus.close();
    process.exit(0);
  });
}

main().catch(console.error);
