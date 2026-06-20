import type { StoredSession } from '@anvio/core';

export interface TrajectoryEntry {
  timestamp: string;
  role: string;
  content: string;
}

export interface TrajectoryExport {
  sessionId: string;
  agentName: string;
  channel: string;
  exportedAt: string;
  entries: TrajectoryEntry[];
}

export function exportSessionTrajectory(session: StoredSession): TrajectoryExport {
  return {
    sessionId: session.id,
    agentName: session.agentName,
    channel: session.channel,
    exportedAt: new Date().toISOString(),
    entries: session.messages.map((msg, index) => ({
      timestamp: new Date(Date.now() - (session.messages.length - index) * 1000).toISOString(),
      role: msg.role,
      content: msg.content,
    })),
  };
}

export function trajectoryToMarkdown(trajectory: TrajectoryExport): string {
  const lines = [
    `# Trajectory — ${trajectory.sessionId}`,
    '',
    `- Agent: ${trajectory.agentName}`,
    `- Channel: ${trajectory.channel}`,
    `- Exported: ${trajectory.exportedAt}`,
    '',
  ];
  for (const entry of trajectory.entries) {
    lines.push(`## ${entry.role} (${entry.timestamp})`, '', entry.content, '');
  }
  return lines.join('\n');
}
