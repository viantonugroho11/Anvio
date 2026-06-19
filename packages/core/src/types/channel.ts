import type { ChannelType } from './common.js';

export type NotificationType =
  | 'task_completed'
  | 'task_failed'
  | 'approval_required'
  | 'agent_waiting'
  | 'workflow_finished';

export type ProgressStatus = 'running' | 'completed' | 'failed';

export type InboxMessageType = 'instruction' | 'stop' | 'redirect';

export interface AgentNotification {
  sessionId: string;
  type: NotificationType;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
}

export interface ProgressUpdate {
  sessionId: string;
  phase: string;
  status: ProgressStatus;
  emoji?: string;
}

export interface ApprovalRequestMessage {
  sessionId: string;
  requestId: string;
  toolName: string;
  reason: string;
  actions: Array<'approve' | 'reject'>;
}

export interface ChannelThreadRef {
  channel: ChannelType;
  /** External thread/topic/conversation ID from the channel platform */
  threadId: string;
  metadata?: Record<string, unknown>;
}

export interface InboxMessage {
  id: string;
  sessionId: string;
  type: InboxMessageType;
  content: string;
  createdAt: string;
}

export type OrchestrationMode = 'sequential' | 'parallel' | 'fan-out' | 'fan-in';

export interface SubAgentTask {
  agentId: string;
  input: string;
  sessionId?: string;
}

export interface OrchestrationPlan {
  managerAgentId: string;
  mode: OrchestrationMode;
  tasks: SubAgentTask[];
}

export type ArtifactKind =
  | 'markdown-report'
  | 'architecture-diagram'
  | 'code-review'
  | 'pull-request'
  | 'documentation'
  | 'research-report'
  | 'other';

export interface AgentArtifact {
  id: string;
  sessionId: string;
  agentId: string;
  kind: ArtifactKind;
  title: string;
  path: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}
