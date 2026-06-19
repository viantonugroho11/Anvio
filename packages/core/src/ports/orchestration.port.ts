import type { AgentDefinition } from '../schemas/agent.schema.js';
import type { OrchestrationPlan } from '../types/channel.js';
import type { AgentResult, Session } from './agent-runtime.port.js';

export interface OrchestrationResult {
  managerSessionId: string;
  results: Array<{ agentId: string; sessionId: string; result: AgentResult }>;
  status: 'completed' | 'failed' | 'partial';
}

export interface AgentOrchestrator {
  execute(
    plan: OrchestrationPlan,
    manager: AgentDefinition,
    managerSession: Session,
  ): Promise<OrchestrationResult>;
}
