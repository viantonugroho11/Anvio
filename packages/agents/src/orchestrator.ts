import type {
  AgentDefinition,
  AgentOrchestrator,
  AgentResult,
  AgentRuntime,
  OrchestrationPlan,
  OrchestrationResult,
  Session,
  SessionStore,
  StoredSession,
} from '@anvio/core';
import { v4 as uuidv4 } from 'uuid';

export interface SupervisorOrchestratorDeps {
  runtime: AgentRuntime;
  sessions: SessionStore;
  loadAgent: (name: string) => Promise<AgentDefinition>;
  storedSessionToRuntime: (stored: StoredSession) => Session;
}

export class SupervisorOrchestrator implements AgentOrchestrator {
  constructor(private readonly deps: SupervisorOrchestratorDeps) {}

  async execute(
    plan: OrchestrationPlan,
    _manager: AgentDefinition,
    managerSession: Session,
  ): Promise<OrchestrationResult> {
    const results: OrchestrationResult['results'] = [];
    let status: OrchestrationResult['status'] = 'completed';

    const runTask = async (task: OrchestrationPlan['tasks'][number]): Promise<void> => {
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
      try {
        const result = await this.deps.runtime.run(session, agent, { content: task.input });
        results.push({ agentId: task.agentId, sessionId: stored.id, result });
      } catch {
        status = 'partial';
      }
    };

    switch (plan.mode) {
      case 'sequential':
        for (const task of plan.tasks) {
          await runTask(task);
        }
        break;
      case 'parallel':
      case 'fan-out':
        await Promise.all(plan.tasks.map(runTask));
        break;
      case 'fan-in': {
        const subResults = await Promise.all(
          plan.tasks.map(async (task) => {
            await runTask(task);
            return results.at(-1)!;
          }),
        );
        const summary = subResults.map((r) => `[${r.agentId}]: ${r.result.content}`).join('\n\n');
        const managerAgent = await this.deps.loadAgent(plan.managerAgentId);
        const fanInResult = await this.deps.runtime.run(managerSession, managerAgent, {
          content: `Synthesize subagent results:\n\n${summary}`,
        });
        results.push({
          agentId: plan.managerAgentId,
          sessionId: managerSession.id,
          result: fanInResult,
        });
        break;
      }
      default: {
        const _exhaustive: never = plan.mode;
        throw new Error(`Unknown orchestration mode: ${_exhaustive}`);
      }
    }

    if (results.length === 0) status = 'failed';
    else if (status === 'partial') status = 'partial';

    return { managerSessionId: managerSession.id, results, status };
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
    tasks: tasks.map((t) => ({ ...t, sessionId: t.sessionId ?? uuidv4() })),
  };
}
