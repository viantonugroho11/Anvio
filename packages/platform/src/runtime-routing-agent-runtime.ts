import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  ApprovalDecision,
  RuntimeProviderId,
  RuntimeRequest,
  Session,
  UserInput,
} from '@anvio/core';
import type { DefaultAgentRuntime } from '@anvio/agents';
import type { RuntimeFactory } from '@anvio/runtimes';
import { runWithRuntimeFallback, streamWithRuntimeFallback } from '@anvio/runtimes';
import { applySessionOverrides } from './session-overrides.js';

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
    // Fold per-thread /runtime, /provider, /model overrides (ADR-0024)
    // into the agent before the fallback chain resolves. Original agent
    // definition is untouched — the override lives for this call only.
    const effective = applySessionOverrides(agent, session);
    const result = await runWithRuntimeFallback(
      this.factory,
      effective,
      await this.buildRequest(session, effective, input),
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
    const effective = applySessionOverrides(agent, session);
    yield* streamWithRuntimeFallback(
      this.factory,
      effective,
      await this.buildRequest(session, effective, input),
      this.defaultRuntime,
    );
  }

  /**
   * Vendor runtimes run their own loop, so hand them the persona/soul prompt
   * the local runtime would have used (issue #102). Skipped when the chain
   * starts at `local`, which assembles it itself. Best-effort: a persona
   * lookup failure must not block the run.
   */
  private async buildRequest(
    session: Session,
    agent: AgentDefinition,
    input: UserInput,
  ): Promise<RuntimeRequest> {
    const request: RuntimeRequest = { session, agent, input };
    const primary = agent.spec.runtime?.provider ?? this.defaultRuntime;
    if (primary === 'local') return request;
    try {
      request.systemPrompt = await this.local.buildSystemPrompt(agent, session.userId, input.content);
    } catch {
      // persona/soul optional for vendor runtimes
    }
    return request;
  }

  async resume(
    session: Session,
    agent: AgentDefinition,
    approval: ApprovalDecision,
  ): Promise<AgentResult> {
    return this.local.resume(session, agent, approval);
  }
}
