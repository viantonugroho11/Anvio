export const EventSubjects = {
  SESSION_STARTED: 'anvio.session.started.v1',
  SESSION_ENDED: 'anvio.session.ended.v1',
  AGENT_RUN_REQUESTED: 'anvio.agent.run.requested.v1',
  AGENT_RUN_COMPLETED: 'anvio.agent.run.completed.v1',
  AGENT_RUN_CHUNK: 'anvio.agent.run.chunk.v1',
  TOOL_EXECUTED: 'anvio.tool.executed.v1',
  MEMORY_STORED: 'anvio.memory.stored.v1',
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
}

export interface AgentRunCompletedData {
  sessionId: string;
  content: string;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  status: string;
}

export interface AgentRunChunkData {
  sessionId: string;
  delta: string;
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
