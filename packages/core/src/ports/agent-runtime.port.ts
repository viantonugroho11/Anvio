import type { AgentRunStatus, ChatMessage, TokenUsage } from '../types/common.js';
import type { AgentDefinition } from '../schemas/agent.schema.js';

export interface Session {
  id: string;
  userId: string;
  agentId: string;
  channel: string;
  state: SessionState;
  lastActiveAt: Date;
}

export interface SessionState {
  status: AgentRunStatus;
  messages: ChatMessage[];
  pendingApproval?: ApprovalRequest;
  metadata?: Record<string, unknown>;
}

export interface UserInput {
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  expiresAt: Date;
}

export interface ApprovalDecision {
  requestId: string;
  approved: boolean;
  reason?: string;
}

export interface AgentResult {
  sessionId: string;
  content: string;
  usage: TokenUsage;
  status: AgentRunStatus;
}

export interface AgentRuntimeContext {
  session: Session;
  agent: AgentDefinition;
  systemPrompt: string;
  messages: ChatMessage[];
}

export type AgentStreamEvent =
  | { type: 'chunk'; delta?: string }
  | { type: 'progress'; phase: string; status: 'running' | 'completed' | 'failed' }
  | { type: 'done'; usage?: TokenUsage }
  | { type: 'error'; error?: string }
  | { type: 'approval_required'; request: ApprovalRequest };

export interface AgentRuntime {
  run(session: Session, agent: AgentDefinition, input: UserInput): Promise<AgentResult>;
  stream(session: Session, agent: AgentDefinition, input: UserInput): AsyncIterable<AgentStreamEvent>;
  resume(
    session: Session,
    agent: AgentDefinition,
    approval: ApprovalDecision,
  ): Promise<AgentResult>;
  stop?(sessionId: string): Promise<void>;
}
