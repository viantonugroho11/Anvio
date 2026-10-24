import type { ChannelType } from '@anvio/core';
import { KeyedSerialQueue, Semaphore } from '@anvio/core';
import {
  EventSubjects,
  type AgentInboxInjectedData,
  type AgentRunProgressData,
  type AgentRunRequestedData,
  type AgentRunStopRequestedData,
  type ApprovalDecidedData,
  type ApprovalRequestedData,
} from '@anvio/events';
import { EmailChannel } from '@anvio/channels';
import { randomUUID } from 'node:crypto';
import { createLogger, withSpan, type Logger } from '@anvio/observability';
import { finalizeAgentRun } from './agent-run.js';
import { loadAgent, storedSessionToRuntime } from './session-runtime.js';
import type { PlatformContext } from './platform-context.js';

/**
 * Channels where the user is watching messages arrive in real time — the
 * reply itself is the completion signal. Non-chat surfaces (email, sms,
 * webhook) still get the explicit task_completed notification, because
 * there is no streaming bubble for the user to correlate with the run.
 */
const CHAT_CHANNELS: ReadonlySet<string> = new Set([
  'telegram',
  'discord',
  'slack',
  'whatsapp',
  'web-chat',
  'cli',
  'matrix',
  'teams',
  'mattermost',
]);

/**
 * Deliver to a channel without letting the channel take the run down.
 *
 * A Telegram `400 can't parse entities`, a Slack `msg_too_long`, a 429 that
 * outlived its retries — each used to throw out of the stream loop and out of
 * the event-bus dispatch, so the reply was persisted but never sent and every
 * handler queued behind it was skipped (issue #71).
 *
 * This is deliberately *not* done inside `ChannelHub`: the harness's
 * `anvio_channel__reply` tool reports delivery back to the model through that
 * same path, and swallowing there would tell the model a message was
 * delivered when it was not. The run loop is the layer that should degrade.
 */
async function deliver(
  log: Logger,
  what: string,
  sessionId: string,
  channel: string,
  send: () => Promise<void>,
): Promise<void> {
  try {
    await send();
  } catch (error) {
    log.error({ err: error, what, channel, sessionId }, `${what} delivery failed`);
  }
}

const workerLog = createLogger('platform:gateway-worker');

/** Concurrent agent turns across all sessions in one worker process. */
export const DEFAULT_MAX_CONCURRENT_RUNS = 8;

function resolveMaxConcurrentRuns(): number {
  const parsed = Number.parseInt(process.env.ANVIO_MAX_CONCURRENT_RUNS ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CONCURRENT_RUNS;
}

/** Agent run consumer — Hermes GatewayRunner agent dispatch equivalent. */
export async function registerGatewayWorker(platform: PlatformContext): Promise<void> {
  const { runtime, eventBus, workspace, channelHub, inbox, harness, mcpFirstCallGate } = platform;

  await repairInterruptedSessions(platform);

  const emailAdapter = channelHub.getAdapter('email');
  if (emailAdapter instanceof EmailChannel) {
    await emailAdapter.start();
    console.log('[gateway] Email IMAP watch enabled');
  }

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
    'anvio-gateway-stop',
    async (event) => {
      await runtime.stop?.(event.data.sessionId);
      await workspace.sessions.update(event.data.sessionId, { status: 'failed' });
    },
  );

  await eventBus.subscribe<AgentInboxInjectedData>(
    EventSubjects.AGENT_INBOX_INJECTED,
    'anvio-gateway-inbox',
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
    'anvio-gateway-approval',
    async (event) => {
      const stored = await workspace.sessions.get(event.data.sessionId);
      if (!stored) return;

      const pendingToolName = stored.pendingApproval?.toolName;
      if (event.data.approved && pendingToolName?.startsWith('anvio_mcp__')) {
        await mcpFirstCallGate.approveToolName(event.data.sessionId, pendingToolName);
      }

      // A runtime that gates its own tools is still inside the turn,
      // blocked on the decision — it continues by itself (issue #69).
      // Re-dispatching the run here would execute the turn twice.
      if (stored.metadata?.inlineApprovalRequestId === event.data.requestId) return;

      await workspace.sessions.update(event.data.sessionId, {
        pendingApproval: undefined,
        status: 'calling_model',
      });
      await eventBus.publish(EventSubjects.AGENT_RUN_REQUESTED, 'anvio.agent.run.requested', {
        sessionId: event.data.sessionId,
        userId: stored.userId,
        agentId: stored.agentName,
        content: '',
        channel: stored.channel,
        detached: true,
        resumeApproval: event.data,
      });
    },
  );

  // One turn per session at a time, a bounded number overall. Without this two
  // messages in one Slack thread ran concurrently and the second history write
  // discarded the first turn (audit CQ-007).
  const runQueue = new KeyedSerialQueue();
  const runSlots = new Semaphore(resolveMaxConcurrentRuns());
  const runSerialized = async (sessionId: string, task: () => Promise<void>): Promise<void> => {
    const queuedBehindAnotherTurn = runQueue.isBusy(sessionId);
    const job = runQueue.run(sessionId, () => runSlots.use(task));
    if (queuedBehindAnotherTurn) {
      // Do not block the publisher on the turn ahead of it: it may be the very
      // turn that is waiting for this publisher (an approval answered mid-turn).
      workerLog.info({ sessionId }, 'run queued behind the current turn for this session');
      void job.catch((error: unknown) => {
        workerLog.error({ err: error, sessionId }, 'queued run failed');
      });
      return;
    }
    await job;
  };

  await eventBus.subscribe<AgentRunRequestedData>(
    EventSubjects.AGENT_RUN_REQUESTED,
    'anvio-gateway-worker',
    (event) =>
      runSerialized(event.data.sessionId, async () => {
        // One id per turn, on every log line and the span, so a failure can be traced
        // from the channel message through the run to its tool calls (audit CQ-018).
        const runId = randomUUID();
        await withSpan(
          'agent.run',
          {
            runId,
            sessionId: event.data.sessionId,
            agentId: event.data.agentId,
            channel: event.data.channel,
          },
          async () => {
            const { sessionId, userId, agentId, content, channel } = event.data;
            const log = workerLog.child({ runId, sessionId, agentId, channel });
            const stored = await workspace.sessions.get(sessionId);
            if (!stored) {
              log.error('session not found');
              return;
            }
            log.info({ resume: Boolean(event.data.resumeApproval) }, 'agent run started');

            await workspace.sessions.update(sessionId, { status: 'calling_model' });
            harness.resetReplyTracking(sessionId);

            const failRun = async (error: string): Promise<void> => {
              await workspace.sessions.update(sessionId, { status: 'failed' });
              await eventBus.publishCore(EventSubjects.AGENT_RUN_FAILED, 'anvio.agent.run.failed', {
                sessionId,
                error,
                channel,
              });
              await deliver(log, 'failure notice', sessionId, channel, () =>
                channelHub.sendNotification(channel as ChannelType, sessionId, {
                  sessionId,
                  type: 'task_failed',
                  title: 'Task Failed',
                  body: error,
                }),
              );
            };

            // A broken agent file used to throw here, after the session was marked
            // calling_model: the turn vanished, the session stayed "in progress" and
            // the user got no answer at all.
            let agent: Awaited<ReturnType<typeof loadAgent>>;
            try {
              agent = await loadAgent(workspace, agentId);
            } catch (err) {
              log.error({ err }, 'agent could not be loaded');
              await failRun(
                `Agent ${agentId} could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
              );
              return;
            }

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
              } catch (err) {
                log.error({ err }, 'worktree creation failed');
              }
            }

            const session = storedSessionToRuntime(stored);
            const input = event.data.resumeApproval
              ? {
                  content: '',
                  metadata: {
                    runId,
                    resumeDecision: {
                      requestId: event.data.resumeApproval.requestId,
                      approved: event.data.resumeApproval.approved,
                      reason: event.data.resumeApproval.reason,
                    },
                  },
                }
              : { content, metadata: { runId } };
            let fullContent = '';

            // Native "working on it" indicator for channels that have one.
            // Vendor runtimes emit no progress events at all, so without
            // this the user sees pure silence for the whole turn (issue #70).
            await channelHub.setTyping?.(channel as ChannelType, sessionId, true);
            try {
              for await (const chunk of runtime.stream(session, agent, input)) {
                if (chunk.type === 'progress') {
                  await eventBus.publishCore(
                    EventSubjects.AGENT_RUN_PROGRESS,
                    'anvio.agent.run.progress',
                    {
                      sessionId,
                      phase: chunk.phase,
                      status: chunk.status,
                      channel,
                    },
                  );
                }
                if (chunk.type === 'chunk' && chunk.delta) {
                  fullContent += chunk.delta;
                  await eventBus.publishCore(
                    EventSubjects.AGENT_RUN_CHUNK,
                    'anvio.agent.run.chunk',
                    {
                      sessionId,
                      delta: chunk.delta,
                      channel,
                    },
                  );
                  if (!harness.shouldSuppressRawOutput(channel as ChannelType)) {
                    await deliver(log, 'chunk', sessionId, channel, () =>
                      channelHub.sendMessage(channel as ChannelType, sessionId, {
                        sessionId,
                        type: 'chunk',
                        delta: chunk.delta,
                      }),
                    );
                  }
                }
                if (chunk.type === 'approval_required') {
                  await workspace.sessions.update(sessionId, {
                    status: 'awaiting_approval',
                    pendingApproval: chunk.request,
                    metadata: {
                      ...stored.metadata,
                      agentRunCheckpoint: chunk.checkpoint,
                    },
                  });
                  await eventBus.publish(
                    EventSubjects.APPROVAL_REQUESTED,
                    'anvio.approval.requested',
                    {
                      sessionId,
                      requestId: chunk.request.id,
                      toolName: chunk.request.toolName,
                      reason: chunk.request.reason,
                      channel,
                    } satisfies ApprovalRequestedData,
                  );
                  // sendNotification renders plain text with no controls, so the
                  // Approve/Reject buttons every adapter already builds were
                  // never shown (issue #68). Route through the harness so the
                  // request is also registered with the approval gate —
                  // otherwise the button callback resolves an id the gate has
                  // never seen and silently no-ops.
                  await deliver(log, 'approval request', sessionId, channel, async () => {
                    if (harness.enabled) {
                      await harness.registerRuntimeApproval(sessionId, channel as ChannelType, {
                        requestId: chunk.request.id,
                        toolName: chunk.request.toolName,
                        reason: chunk.request.reason,
                      });
                    } else {
                      await channelHub.sendApprovalRequest(channel as ChannelType, sessionId, {
                        sessionId,
                        requestId: chunk.request.id,
                        toolName: chunk.request.toolName,
                        reason: chunk.request.reason,
                        actions: ['approve', 'reject'],
                      });
                    }
                  });
                  return;
                }
                if (chunk.type === 'done') {
                  log.info(
                    {
                      stopReason: chunk.stopReason,
                      provider: chunk.provider,
                      model: chunk.model,
                      usage: chunk.usage,
                    },
                    'agent run completed',
                  );
                }
                if (chunk.type === 'done' && chunk.usage) {
                  await workspace.sessions.update(sessionId, {
                    messages: [
                      ...stored.messages,
                      { role: 'user', content },
                      { role: 'assistant', content: fullContent },
                    ],
                    status: 'completed',
                    pendingApproval: undefined,
                    metadata: {
                      ...stored.metadata,
                      agentRunCheckpoint: undefined,
                      // Vendor runtimes keep their own transcript; store the
                      // handle so the next turn resumes it instead of starting
                      // cold (issue #63). Keyed per runtime id — a fallback
                      // chain must not hand one vendor another's session.
                      ...(chunk.vendorSessionId && chunk.runtimeId
                        ? {
                            vendorSessions: {
                              ...((stored.metadata?.vendorSessions as
                                Record<string, string> | undefined) ?? {}),
                              [chunk.runtimeId ?? 'unknown']: chunk.vendorSessionId,
                            },
                          }
                        : {}),
                    },
                  });
                  await finalizeAgentRun(eventBus, {
                    sessionId,
                    content: fullContent,
                    usage: chunk.usage,
                    channel,
                    provider: chunk.provider,
                    model: chunk.model,
                  });
                  if (!harness.shouldSuppressRawOutput(channel as ChannelType)) {
                    await deliver(log, 'reply', sessionId, channel, () =>
                      channelHub.sendMessage(channel as ChannelType, sessionId, {
                        sessionId,
                        type: 'done',
                        content: fullContent,
                      }),
                    );
                  } else if (fullContent.trim() && !harness.hasDeliveredReply(sessionId)) {
                    // Strict mode used to drop the whole answer here, so a model
                    // that forgot anvio_channel__reply left the user with nothing
                    // (or only an earlier one-line status ping). Deliver the raw
                    // turn instead — silence is never the better failure.
                    log.warn(
                      'harness strict: run completed without anvio_channel__reply; delivering raw output',
                    );
                    await deliver(log, 'reply', sessionId, channel, () =>
                      channelHub.sendMessage(channel as ChannelType, sessionId, {
                        sessionId,
                        type: 'done',
                        content: fullContent,
                      }),
                    );
                  }
                  // task_completed used to fire unconditionally, so every chat
                  // reply was followed by a second "Task Completed / Agent X
                  // finished." bubble (issue #54(a)). For chat channels the
                  // user already saw the reply arrive; the notification is only
                  // meaningful for non-streaming surfaces (email/sms/webhook).
                  if (!CHAT_CHANNELS.has(channel)) {
                    await deliver(log, 'completion notice', sessionId, channel, () =>
                      channelHub.sendNotification(channel as ChannelType, sessionId, {
                        sessionId,
                        type: 'task_completed',
                        title: 'Task Completed',
                        body: `Agent ${agentId} finished.`,
                      }),
                    );
                  }
                  await eventBus.publish(EventSubjects.MEMORY_STORED, 'anvio.memory.stored', {
                    sessionId,
                    userId,
                    type: 'conversation',
                  });
                }
                if (chunk.type === 'error') {
                  log.warn(
                    { code: chunk.code, retryable: chunk.retryable, error: chunk.error },
                    'agent run failed',
                  );
                  await failRun(chunk.error ?? 'Unknown error');
                }
              }
            } catch (err) {
              // Runtimes report failures as error chunks; anything thrown instead
              // (storage, a bug) must still end the turn visibly.
              log.error({ err }, 'agent run threw');
              await failRun(err instanceof Error ? err.message : String(err));
            } finally {
              // Covers the approval_required early return and any thrown
              // error too — a leaked keepalive would leave the indicator
              // spinning forever.
              await channelHub.setTyping?.(channel as ChannelType, sessionId, false);
            }
          },
        );
      }),
  );
}

/**
 * A process that dies mid-turn leaves its sessions in calling_model forever: the
 * session API reports them busy and nothing will ever finish them. On start no
 * turn of this worker is running yet, so any such session was interrupted.
 * awaiting_approval is a real paused state and is left alone.
 */
async function repairInterruptedSessions(platform: PlatformContext): Promise<void> {
  const { workspace } = platform;
  const interruptedAt = new Date().toISOString();
  for (const session of await workspace.sessions.list()) {
    if (session.status !== 'calling_model') continue;
    await workspace.sessions.update(session.id, {
      status: 'failed',
      metadata: { ...session.metadata, interruptedAt },
    });
    workerLog.warn(
      { sessionId: session.id },
      'session was interrupted by a restart; marked failed',
    );
  }
}
