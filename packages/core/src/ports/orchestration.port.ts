import type { AgentDefinition } from '../schemas/agent.schema.js';
import type { OrchestrationPlan } from '../types/channel.js';
import type { AgentResult, Session } from './agent-runtime.port.js';

export interface OrchestrationTaskResult {
  taskId?: string;
  agentId: string;
  sessionId: string;
  result?: AgentResult;
  status: 'completed' | 'failed' | 'skipped';
  error?: string;
}

export interface OrchestrationResult {
  managerSessionId: string;
  results: OrchestrationTaskResult[];
  status: 'completed' | 'failed' | 'partial';
  synthesized?: string;
}

export interface AgentOrchestrator {
  execute(
    plan: OrchestrationPlan,
    manager: AgentDefinition,
    managerSession: Session,
  ): Promise<OrchestrationResult>;
}
