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

/** Routes agent runs to external runtime providers when configured; otherwise uses local model loop. */
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
    const provider = this.factory.resolveForAgent(agent, this.defaultRuntime);
    if (provider.runtimeId !== 'local') {
      const result = await provider.run({ session, agent, input });
      return {
        sessionId: result.sessionId,
        content: result.content,
        usage: result.usage,
        status: result.status,
      };
    }
    return this.local.run(session, agent, input);
  }

  async *stream(session: Session, agent: AgentDefinition, input: UserInput) {
    const provider = this.factory.resolveForAgent(agent, this.defaultRuntime);
    if (provider.runtimeId !== 'local') {
      yield* provider.stream({ session, agent, input });
      return;
    }
    yield* this.local.stream(session, agent, input);
  }

  async resume(
    session: Session,
    agent: AgentDefinition,
    approval: ApprovalDecision,
  ): Promise<AgentResult> {
    return this.local.resume(session, agent, approval);
  }
}
