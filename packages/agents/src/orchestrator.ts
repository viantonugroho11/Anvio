import type {
  AgentDefinition,
  AgentOrchestrator,
  AgentRuntime,
  OrchestrationPlan,
  OrchestrationResult,
  OrchestrationTaskResult,
  Session,
  SessionStore,
  StoredSession,
  SubAgentFailurePolicy,
} from '@anvio/core';
import type { EventSubject } from '@anvio/events';
import { EventSubjects } from '@anvio/events';
import { v4 as uuidv4 } from 'uuid';
import { DelegationProgressTracker } from './delegation-progress.js';
import { AgentRunError } from './runtime.js';
import {
  getReadyTasks,
  interpolateTaskInput,
  normalizeTasks,
  resolveTaskOrder,
  shouldSkipDependent,
  type PlannedTask,
} from './task-planner.js';

export interface SupervisorOrchestratorDeps {
  runtime: AgentRuntime;
  sessions: SessionStore;
  loadAgent: (name: string) => Promise<AgentDefinition>;
  storedSessionToRuntime: (stored: StoredSession) => Session;
  publishEvent?: (subject: EventSubject, type: string, data: unknown) => Promise<void>;
  /** Sub-agents run at once in parallel/fan-out/fan-in waves. Default 4. */
  maxConcurrency?: number;
  /** Nested `subPlan` levels allowed. Default 3. */
  maxDepth?: number;
}

export const DEFAULT_ORCHESTRATION_CONCURRENCY = 4;
export const DEFAULT_ORCHESTRATION_DEPTH = 3;

type TaskOutcome = 'completed' | 'failed' | 'skipped' | 'awaiting_approval';

export class SupervisorOrchestrator implements AgentOrchestrator {
  constructor(private readonly deps: SupervisorOrchestratorDeps) {}

  async execute(
    plan: OrchestrationPlan,
    manager: AgentDefinition,
    managerSession: Session,
  ): Promise<OrchestrationResult> {
    return this.executeAtDepth(plan, manager, managerSession, 0);
  }

  private async executeAtDepth(
    plan: OrchestrationPlan,
    manager: AgentDefinition,
    managerSession: Session,
    depth: number,
  ): Promise<OrchestrationResult> {
    const maxDepth = this.deps.maxDepth ?? DEFAULT_ORCHESTRATION_DEPTH;
    if (depth > maxDepth) {
      throw new Error(`Orchestration plans nest deeper than ${maxDepth} levels`);
    }
    const tasks = normalizeTasks(plan.tasks);
    const results: OrchestrationTaskResult[] = [];
    const outputs = new Map<string, string>();
    const completed = new Set<string>();
    const failed = new Set<string>();
    const skipped = new Set<string>();
    let aborted = false;

    const progress = new DelegationProgressTracker(
      tasks.length,
      managerSession.id,
      this.deps.publishEvent
        ? { publish: (subject, type, data) => this.deps.publishEvent!(subject, type, data) }
        : undefined,
    );

    await this.deps.publishEvent?.(EventSubjects.ORCHESTRATION_STARTED, 'anvio.orchestration.started', {
      managerSessionId: managerSession.id,
      mode: plan.mode,
      taskCount: tasks.length,
    });

    const recordFailure = async (
      task: PlannedTask,
      policy: SubAgentFailurePolicy,
      message: string,
    ): Promise<TaskOutcome> => {
      failed.add(task.id);
      results.push({ taskId: task.id, agentId: task.agentId, sessionId: '', status: 'failed', error: message });
      await progress.taskFailed(task.id, task.agentId, message);
      if (policy === 'abort') aborted = true;
      return 'failed';
    };

    const runSingleTask = async (task: PlannedTask): Promise<TaskOutcome> => {
      if (aborted) {
        skipped.add(task.id);
        progress.markSkipped();
        results.push({
          taskId: task.id,
          agentId: task.agentId,
          sessionId: '',
          status: 'skipped',
        });
        return 'skipped';
      }

      if (shouldSkipDependent(task, failed, skipped)) {
        skipped.add(task.id);
        progress.markSkipped();
        results.push({
          taskId: task.id,
          agentId: task.agentId,
          sessionId: '',
          status: 'skipped',
        });
        return 'skipped';
      }

      if (task.subPlan) {
        let nested: OrchestrationResult;
        try {
          nested = await this.executeAtDepth(task.subPlan, manager, managerSession, depth + 1);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          failed.add(task.id);
          results.push({ taskId: task.id, agentId: task.agentId, sessionId: '', status: 'failed', error: message });
          await progress.taskFailed(task.id, task.agentId, message);
          if ((task.onFailure ?? 'abort') === 'abort') aborted = true;
          return 'failed';
        }
        for (const nestedResult of nested.results) {
          results.push(nestedResult);
        }
        if (nested.status === 'failed' || nested.status === 'partial') {
          failed.add(task.id);
          await progress.taskFailed(task.id, task.agentId, 'Nested plan failed');
          return 'failed';
        }
        completed.add(task.id);
        const summary = nested.synthesized ?? nested.results.map((r) => r.result?.content ?? '').join('\n');
        outputs.set(task.id, summary);
        await progress.taskCompleted(task.id, task.agentId, summary.slice(0, 200));
        return 'completed';
      }

      const input = interpolateTaskInput(task.input, outputs);
      const policy: SubAgentFailurePolicy = task.onFailure ?? 'abort';
      const maxAttempts = task.maxAttempts ?? (policy === 'retry' ? 3 : 1);

      await progress.taskStarted(task.id, task.agentId);

      let agent: AgentDefinition;
      try {
        agent = await this.deps.loadAgent(task.agentId);
      } catch (err) {
        // An unknown or invalid agent will not load on a second try either.
        return recordFailure(task, policy, err instanceof Error ? err.message : String(err));
      }

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        let sessionId = '';
        try {
          const stored = await this.deps.sessions.create({
            userId: managerSession.userId,
            agentName: task.agentId,
            channel: managerSession.channel,
            messages: [],
            status: 'idle',
            parentSessionId: managerSession.id,
            detached: true,
          });
          sessionId = stored.id;
          const session = this.deps.storedSessionToRuntime(stored);
          const result = await this.deps.runtime.run(session, agent, { content: input });
          outputs.set(task.id, result.content);

          if (result.status === 'awaiting_approval') {
            // The sub-agent paused for a human decision; its output is partial and
            // dependents must not treat it as done (audit CQ-010).
            skipped.add(task.id);
            results.push({ taskId: task.id, agentId: task.agentId, sessionId, result, status: 'awaiting_approval' });
            await progress.taskFailed(task.id, task.agentId, 'Awaiting human approval');
            return 'awaiting_approval';
          }

          completed.add(task.id);
          results.push({ taskId: task.id, agentId: task.agentId, sessionId, result, status: 'completed' });
          await progress.taskCompleted(task.id, task.agentId, result.content.slice(0, 200));
          return 'completed';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (sessionId) {
            await this.deps.sessions.update(sessionId, { status: 'failed' }).catch(() => undefined);
          }
          if (policy === 'retry' && attempt < maxAttempts && isRetryableRunError(err)) {
            await sleep(backoffMs(attempt));
            continue;
          }
          return recordFailure(task, policy, message);
        }
      }

      return 'failed';
    };

    switch (plan.mode) {
      case 'sequential':
      case 'hierarchical': {
        const ordered = resolveTaskOrder(tasks);
        for (const task of ordered) {
          await runSingleTask(task);
        }
        break;
      }
      case 'parallel':
      case 'fan-out': {
        await this.runParallelWaves(tasks, runSingleTask, completed, failed, skipped);
        break;
      }
      case 'fan-in': {
        await this.runParallelWaves(tasks, runSingleTask, completed, failed, skipped);
        const subResults = results.filter((r) => r.taskId && tasks.some((t) => t.id === r.taskId));
        const summary = subResults
          .map((r) => `[${r.agentId}]: ${r.result?.content ?? r.error ?? 'skipped'}`)
          .join('\n\n');
        const managerAgent = await this.deps.loadAgent(plan.managerAgentId);
        // Synthesize in a child session. Running it on the manager's own session
        // re-entered the turn that started this plan (delegation runs inside a
        // manager tool call) and appended a synthetic "Synthesize…" message to the
        // user's conversation.
        const synthesisStored = await this.deps.sessions.create({
          userId: managerSession.userId,
          agentName: plan.managerAgentId,
          channel: managerSession.channel,
          messages: [],
          status: 'idle',
          parentSessionId: managerSession.id,
          detached: true,
        });
        const fanInResult = await this.deps.runtime.run(
          this.deps.storedSessionToRuntime(synthesisStored),
          managerAgent,
          { content: `Synthesize subagent results:\n\n${summary}` },
        );
        results.push({
          taskId: 'fan-in',
          agentId: plan.managerAgentId,
          sessionId: synthesisStored.id,
          result: fanInResult,
          status: 'completed',
        });
        return this.finalize(managerSession.id, results, fanInResult.content);
      }
      default: {
        const _exhaustive: never = plan.mode;
        throw new Error(`Unknown orchestration mode: ${_exhaustive}`);
      }
    }

    return this.finalize(managerSession.id, results);
  }

  private async runParallelWaves(
    tasks: PlannedTask[],
    runSingleTask: (task: PlannedTask) => Promise<TaskOutcome>,
    completed: Set<string>,
    failed: Set<string>,
    skipped: Set<string>,
  ): Promise<void> {
    const pending = new Set(tasks.map((t) => t.id));

    while (pending.size > 0) {
      const ready = getReadyTasks(tasks, completed, failed, skipped).filter((t) => pending.has(t.id));
      if (ready.length === 0) {
        for (const taskId of pending) {
          const task = tasks.find((t) => t.id === taskId);
          if (!task) continue;
          skipped.add(taskId);
          pending.delete(taskId);
        }
        break;
      }

      for (const task of ready) pending.delete(task.id);
      await mapWithConcurrency(
        ready,
        this.deps.maxConcurrency ?? DEFAULT_ORCHESTRATION_CONCURRENCY,
        runSingleTask,
      );
    }
  }

  private finalize(
    managerSessionId: string,
    results: OrchestrationTaskResult[],
    synthesized?: string,
  ): OrchestrationResult {
    const hasFailed = results.some((r) => r.status === 'failed');
    const hasPaused = results.some((r) => r.status === 'awaiting_approval');
    const hasCompleted = results.some((r) => r.status === 'completed');
    let status: OrchestrationResult['status'] = 'completed';
    if (results.length === 0 || (!hasCompleted && !hasPaused && hasFailed)) {
      status = 'failed';
    } else if (hasFailed || hasPaused) {
      status = 'partial';
    }

    // Fire-and-forget, but never an unhandled rejection.
    this.deps
      .publishEvent?.(EventSubjects.ORCHESTRATION_COMPLETED, 'anvio.orchestration.completed', {
        managerSessionId,
        status,
        resultCount: results.length,
      })
      .catch((error: unknown) => {
        console.error(
          '[orchestrator] publishing orchestration.completed failed:',
          error instanceof Error ? error.message : error,
        );
      });

    return { managerSessionId, results, status, synthesized };
  }
}

export function createOrchestrationPlan(
  managerAgentId: string,
  mode: OrchestrationPlan['mode'],
  tasks: OrchestrationPlan['tasks'],
): OrchestrationPlan {
  return {
    managerAgentId,
    mode,
    tasks: tasks.map((t, i) => ({
      ...t,
      id: t.id ?? `${t.agentId}-${i}`,
      sessionId: t.sessionId ?? uuidv4(),
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff capped at 8 s, with ±25 % jitter so parallel retries spread out. */
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** (attempt - 1), 8000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/**
 * Retry only failures that a second attempt could fix. A stop, an invalid resume
 * or a client-side (4xx) error fails the same way every time.
 */
export function isRetryableRunError(error: unknown): boolean {
  if (error instanceof AgentRunError) {
    if (error.retryable !== undefined) return error.retryable;
    return error.code !== 'stopped' && error.code !== 'invalid_checkpoint';
  }
  const statusCode = (error as { statusCode?: unknown } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) return false;
  return true;
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
