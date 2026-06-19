export const EventSubjects = {
  SESSION_STARTED: 'anvio.session.started.v1',
  SESSION_ENDED: 'anvio.session.ended.v1',
  AGENT_RUN_REQUESTED: 'anvio.agent.run.requested.v1',
  AGENT_RUN_COMPLETED: 'anvio.agent.run.completed.v1',
  AGENT_RUN_FAILED: 'anvio.agent.run.failed.v1',
  AGENT_RUN_CHUNK: 'anvio.agent.run.chunk.v1',
  AGENT_RUN_PROGRESS: 'anvio.agent.run.progress.v1',
  AGENT_RUN_STOP_REQUESTED: 'anvio.agent.run.stop.v1',
  AGENT_INBOX_INJECTED: 'anvio.agent.inbox.injected.v1',
  APPROVAL_REQUESTED: 'anvio.approval.requested.v1',
  APPROVAL_DECIDED: 'anvio.approval.decided.v1',
  NOTIFICATION_SENT: 'anvio.notification.sent.v1',
  TOOL_EXECUTED: 'anvio.tool.executed.v1',
  MEMORY_STORED: 'anvio.memory.stored.v1',
  ARTIFACT_CREATED: 'anvio.artifact.created.v1',
  ORCHESTRATION_STARTED: 'anvio.orchestration.started.v1',
  ORCHESTRATION_COMPLETED: 'anvio.orchestration.completed.v1',
  GOAL_CREATED: 'anvio.goal.created.v1',
  GOAL_PROGRESS_UPDATED: 'anvio.goal.progress.updated.v1',
  GOAL_COMPLETED: 'anvio.goal.completed.v1',
  GOAL_PAUSED: 'anvio.goal.paused.v1',
  GOAL_RESUMED: 'anvio.goal.resumed.v1',
  SOUL_UPDATED: 'anvio.soul.updated.v1',
  AUTOMATION_STARTED: 'anvio.automation.started.v1',
  AUTOMATION_COMPLETED: 'anvio.automation.completed.v1',
  AUTOMATION_FAILED: 'anvio.automation.failed.v1',
  WORKFLOW_COMPLETED: 'anvio.workflow.completed.v1',
  TASK_ASSIGNED: 'anvio.task.assigned.v1',
  TASK_COMPLETED: 'anvio.task.completed.v1',
  DELEGATION_TASK_STARTED: 'anvio.delegation.task.started.v1',
  DELEGATION_TASK_COMPLETED: 'anvio.delegation.task.completed.v1',
  DELEGATION_TASK_FAILED: 'anvio.delegation.task.failed.v1',
} as const;

export type EventSubject = (typeof EventSubjects)[keyof typeof EventSubjects];

export interface AnvioEvent<T = unknown> {
  specversion: '1.0';
  type: string;
  source: string;
  id: string;
  time: string;
  subject?: string;
  data: T;
}

export interface SessionStartedData {
  sessionId: string;
  userId: string;
  agentId: string;
  channel: string;
  detached?: boolean;
  channelThreadId?: string;
}

export interface SessionEndedData {
  sessionId: string;
  reason: string;
}

export interface AgentRunRequestedData {
  sessionId: string;
  userId: string;
  agentId: string;
  content: string;
  channel: string;
  detached?: boolean;
}

export interface AgentRunCompletedData {
  sessionId: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  status: string;
  channel: string;
}

export interface AgentRunFailedData {
  sessionId: string;
  error: string;
  channel: string;
}

export interface AgentRunChunkData {
  sessionId: string;
  delta: string;
  channel: string;
}

export interface AgentRunProgressData {
  sessionId: string;
  phase: string;
  status: 'running' | 'completed' | 'failed';
  channel: string;
}

export interface AgentRunStopRequestedData {
  sessionId: string;
  reason?: string;
}

export interface AgentInboxInjectedData {
  sessionId: string;
  messageId: string;
  type: string;
  content: string;
}

export interface ApprovalRequestedData {
  sessionId: string;
  requestId: string;
  toolName: string;
  reason: string;
  channel: string;
}

export interface ApprovalDecidedData {
  sessionId: string;
  requestId: string;
  approved: boolean;
  reason?: string;
}

export interface NotificationSentData {
  sessionId: string;
  type: string;
  title: string;
  body?: string;
  channel: string;
}

export interface ToolExecutedData {
  sessionId: string;
  toolName: string;
  status: string;
}

export interface MemoryStoredData {
  sessionId: string;
  userId: string;
  type: string;
}

export interface ArtifactCreatedData {
  sessionId: string;
  artifactId: string;
  kind: string;
  title: string;
  path: string;
}

export interface OrchestrationStartedData {
  managerSessionId: string;
  mode: string;
  taskCount: number;
}

export interface OrchestrationCompletedData {
  managerSessionId: string;
  status: string;
  resultCount: number;
}

export interface GoalCreatedData {
  goalSlug: string;
  title: string;
}

export interface GoalProgressUpdatedData {
  goalSlug: string;
  percent: number;
}

export interface GoalCompletedData {
  goalSlug: string;
}

export interface GoalPausedData {
  goalSlug: string;
}

export interface GoalResumedData {
  goalSlug: string;
}

export interface SoulUpdatedData {
  soulSlug: string;
}
