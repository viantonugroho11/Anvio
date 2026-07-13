import type { AgentResult, AgentRuntime, Session } from '@anvio/core';
import type { Workspace } from '@anvio/workspace';
import { storedSessionToRuntime } from './session-runtime.js';

export interface DetachedRunDeps {
  runtime: AgentRuntime;
  workspace: Workspace;
  defaultUserId: string;
}

export interface DetachedRunner {
  /** Load agent, create a detached session on the given channel, run, return the result + session. */
  run(agentId: string, input: string, channel: string): Promise<AgentResult & { session: Session }>;
}

/**
 * One shared implementation of the "load agent → create detached session → run" flow
 * previously duplicated across workflow, blueprint, automation, delegation, and MoA wiring.
 */
export function createDetachedRunner(deps: DetachedRunDeps): DetachedRunner {
  return {
    async run(agentId, input, channel) {
      const agent = await deps.workspace.loader.loadAgent(agentId);
      const stored = await deps.workspace.sessions.create({
        userId: deps.defaultUserId,
        agentName: agentId,
        channel,
        messages: [],
        status: 'idle',
        detached: true,
      });
      const session = storedSessionToRuntime(stored);
      const result = await deps.runtime.run(session, agent, { content: input });
      return { ...result, session };
    },
  };
}
