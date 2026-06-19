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
}

type TaskOutcome = 'completed' | 'failed' | 'skipped';

export class SupervisorOrchestrator implements AgentOrchestrator {
  constructor(private readonly deps: SupervisorOrchestratorDeps) {}

  async execute(
    plan: OrchestrationPlan,
    _manager: AgentDefinition,
    managerSession: Session,
  ): Promise<OrchestrationResult> {
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
        const nested = await this.execute(task.subPlan, _manager, managerSession);
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

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const agent = await this.deps.loadAgent(task.agentId);
          const stored = await this.deps.sessions.create({
            userId: managerSession.userId,
            agentName: task.agentId,
            channel: managerSession.channel,
            messages: [],
            status: 'idle',
            parentSessionId: managerSession.id,
            detached: true,
          });
          const session = this.deps.storedSessionToRuntime(stored);
          const result = await this.deps.runtime.run(session, agent, { content: input });
          outputs.set(task.id, result.content);
          completed.add(task.id);
          results.push({
            taskId: task.id,
            agentId: task.agentId,
            sessionId: stored.id,
            result,
            status: 'completed',
          });
          await progress.taskCompleted(task.id, task.agentId, result.content.slice(0, 200));
          return 'completed';
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isLastAttempt = attempt >= maxAttempts;

          if (policy === 'retry' && !isLastAttempt) {
            await sleep(Math.min(1000 * 2 ** (attempt - 1), 8000));
            continue;
          }

          failed.add(task.id);
          results.push({
            taskId: task.id,
            agentId: task.agentId,
            sessionId: '',
            status: 'failed',
            error: message,
          });
          await progress.taskFailed(task.id, task.agentId, message);

          if (policy === 'abort') {
            aborted = true;
          }
          return 'failed';
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
        const fanInResult = await this.deps.runtime.run(managerSession, managerAgent, {
          content: `Synthesize subagent results:\n\n${summary}`,
        });
        results.push({
          taskId: 'fan-in',
          agentId: plan.managerAgentId,
          sessionId: managerSession.id,
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

      await Promise.all(
        ready.map(async (task) => {
          pending.delete(task.id);
          await runSingleTask(task);
        }),
      );
    }
  }

  private finalize(
    managerSessionId: string,
    results: OrchestrationTaskResult[],
    synthesized?: string,
  ): OrchestrationResult {
    const hasFailed = results.some((r) => r.status === 'failed');
    const hasCompleted = results.some((r) => r.status === 'completed');
    let status: OrchestrationResult['status'] = 'completed';
    if (results.length === 0 || (!hasCompleted && hasFailed)) {
      status = 'failed';
    } else if (hasFailed) {
      status = 'partial';
    }

    void this.deps.publishEvent?.(
      EventSubjects.ORCHESTRATION_COMPLETED,
      'anvio.orchestration.completed',
      {
        managerSessionId,
        status,
        resultCount: results.length,
      },
    );

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
