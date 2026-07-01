import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  ApprovalDecision,
  RuntimeProviderId,
  Session,
  UserInput,
} from '@anvio/core';
import type { DefaultAgentRuntime } from '@anvio/agents';
import type { RuntimeFactory } from '@anvio/runtimes';
import { runWithRuntimeFallback, streamWithRuntimeFallback } from '@anvio/runtimes';

/** Routes agent runs through runtime fallback chain (A→B→C) with auth failure failover. */
export class RuntimeRoutingAgentRuntime implements AgentRuntime {
  constructor(
    private readonly local: DefaultAgentRuntime,
    private readonly factory: RuntimeFactory,
    private readonly defaultRuntime: RuntimeProviderId = 'local',
  ) {}

  async stop(sessionId: string): Promise<void> {
    await this.local.stop(sessionId);
  }

  async run(session: Session, agent: AgentDefinition, input: UserInput): Promise<AgentResult> {
    const result = await runWithRuntimeFallback(
      this.factory,
      agent,
      { session, agent, input },
      this.defaultRuntime,
    );

    return {
      sessionId: result.sessionId,
      content: result.content,
      usage: result.usage,
      status: result.status,
    };
  }

  async *stream(session: Session, agent: AgentDefinition, input: UserInput) {
    yield* streamWithRuntimeFallback(
      this.factory,
      agent,
      { session, agent, input },
      this.defaultRuntime,
    );
  }

  async resume(
    session: Session,
    agent: AgentDefinition,
    approval: ApprovalDecision,
  ): Promise<AgentResult> {
    return this.local.resume(session, agent, approval);
  }
}
