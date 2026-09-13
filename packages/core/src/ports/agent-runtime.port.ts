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
  /**
   * `vendorSessionId` is the transcript handle a vendor runtime (Claude
   * Code, Codex, …) keeps on its own side. The gateway persists it per
   * runtime id so the next turn can resume that transcript instead of
   * starting cold (issue #63). Opaque and vendor-scoped — never compare
   * or reuse one across runtimes.
   */
  | { type: 'done'; usage?: TokenUsage; vendorSessionId?: string; runtimeId?: string }
  | { type: 'error'; error?: string }
  | { type: 'approval_required'; request: ApprovalRequest; checkpoint?: Record<string, unknown> };

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
