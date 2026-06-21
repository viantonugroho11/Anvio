import type { AgentDefinition, Session } from '@anvio/core';
import type { Workspace } from '@anvio/workspace';

export async function loadAgent(workspace: Workspace, name: string): Promise<AgentDefinition> {
  return workspace.loader.loadAgent(name);
}

export function storedSessionToRuntime(session: {
  id: string;
  userId: string;
  agentName: string;
  channel: string;
  messages: Session['state']['messages'];
  status: Session['state']['status'];
  lastActiveAt: string;
  pendingApproval?: Session['state']['pendingApproval'];
  metadata?: Record<string, unknown>;
}): Session {
  return {
    id: session.id,
    userId: session.userId,
    agentId: session.agentName,
    channel: session.channel,
    state: {
      status: session.status,
      messages: session.messages,
      pendingApproval: session.pendingApproval,
      metadata: session.metadata,
    },
    lastActiveAt: new Date(session.lastActiveAt),
  };
}
