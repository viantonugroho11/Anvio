import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  ApprovalDecision,
  ChatMessage,
  RuntimeToolPort,
  Session,
  TokenUsage,
  UserInput,
} from '@anvio/core';
import { ZERO_TOKEN_USAGE } from '@anvio/core';
import type { MemoryStore } from '@anvio/core';
import type { SoulService } from '@anvio/souls';
import type { ModelProviderRegistry } from '@anvio/models';
import { PersonaService } from '@anvio/personas';
import {
  SkillRegistry,
  matchTriggers,
  mergeSkillSlugs,
  createComposableSkillRegistry,
} from '@anvio/skills';
import { classifyTask } from '@anvio/models';
import type { SkillCatalogResolver } from '@anvio/skills';
import { createHash } from 'node:crypto';
import { createLogger } from '@anvio/observability';
import { DEFAULT_MAX_TOOL_ITERATIONS } from './tool-loop.js';
import { runAgentLoop } from './runtime-loop.js';
import { readRunCheckpoint } from './run-checkpoint.js';

export interface AgentRuntimeDeps {
  personaService: PersonaService;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  modelProviders: ModelProviderRegistry;
  soulService?: SoulService;
  toolPort?: RuntimeToolPort;
  skillCatalog?: SkillCatalogResolver;
  /** Returns skill slugs from active goals assigned to this agent — merged into system prompt */
  activeGoalSkillsResolver?: () => Promise<string[]>;
  maxToolIterations?: number;
  onProgress?: (sessionId: string, phase: string) => void;
}

const log = createLogger('agents:runtime');

export class DefaultAgentRuntime implements AgentRuntime {
  private readonly stopRequests = new Set<string>();

  constructor(private readonly deps: AgentRuntimeDeps) {}

  async stop(sessionId: string): Promise<void> {
    this.stopRequests.add(sessionId);
  }

  async run(session: Session, agent: AgentDefinition, input: UserInput): Promise<AgentResult> {
    let content = '';
    let usage: TokenUsage = { ...ZERO_TOKEN_USAGE };
    let status: AgentResult['status'] = 'completed';

    for await (const chunk of this.stream(session, agent, input)) {
      if (chunk.type === 'chunk' && chunk.delta) content += chunk.delta;
      if (chunk.type === 'done' && chunk.usage) usage = chunk.usage;
      if (chunk.type === 'approval_required') status = 'awaiting_approval';
      if (chunk.type === 'error') throw new Error(chunk.error);
    }

    return { sessionId: session.id, content, usage, status };
  }

  async *stream(session: Session, agent: AgentDefinition, input: UserInput) {
    if (this.stopRequests.has(session.id)) {
      this.stopRequests.delete(session.id);
      yield { type: 'error' as const, error: 'Session stopped by user' };
      return;
    }

    try {
      const resumeDecision = input.metadata?.resumeDecision as ApprovalDecision | undefined;
      const checkpoint = readRunCheckpoint(session.state.metadata);

      yield { type: 'progress' as const, phase: 'Assembling context', status: 'running' as const };
      this.deps.onProgress?.(session.id, 'Assembling context');

      const { systemPrompt: baseSystemPrompt, effectiveSpecs } = await this.assembleSystemPrompt(agent, session.userId, input.content);
      let systemPrompt = baseSystemPrompt;
      const baseToolPort = this.deps.toolPort;

      const toolCtx = {
        sessionId: session.id,
        agentId: session.agentId,
        userId: session.userId,
        channel: session.channel,
      };

      // Wire composable skills into the tool port so the LLM can call skill__<slug>
      // and so skill steps can call other skills via "skill:<slug>"
      // Skills are resolved lazily by the catalog — no need to pre-load all specs here.
      const composableReg = createComposableSkillRegistry(
        [],
        this.deps.skillCatalog,
        baseToolPort,
      );
      // Pre-register agent's own skills so they appear in tool definitions immediately
      if (this.deps.skillCatalog) {
        for (const slug of agent.spec.skills) {
          try {
            const def = await this.deps.skillCatalog.load(slug);
            composableReg.register(def);
          } catch (error) {
            // skill may be prose-only or not found — skip
            log.debug({ slug, err: String(error) }, 'skill pre-registration skipped');
          }
        }
      }

      // Wrap tool port: composable skills override + downstream gateway
      const toolPort = composableReg.buildToolPort();

      // Skill routing: if active skills declare a routing hint, pick the best provider for that route
      const skillRoutingHints = effectiveSpecs.flatMap((s) => (s.routing ? [s.routing] : []));
      const route = classifyTask({ agent, skillRoutingHints, message: input.content });
      const routeProvider = this.deps.modelProviders.resolveForRoute?.(route);
      const modelProvider = routeProvider ?? this.deps.modelProviders.resolveForAgent(agent);
      const useNativeTools =
        Boolean(modelProvider.supportsNativeTools) &&
        Boolean(toolPort?.getModelToolDefinitions?.()) &&
        (toolPort?.listTools().length ?? 0) > 0;

      if (toolPort && toolPort.listTools().length > 0 && !useNativeTools) {
        systemPrompt = `${systemPrompt}\n\n---\n\n${toolPort.getToolInstructions()}`;
      }

      // Content-address the exact system prompt sent to the model — reproducibility trail.
      const promptHash = createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
      log.debug({ sessionId: session.id, promptHash }, 'system prompt assembled');

      let messages: ChatMessage[];
      let startIteration = 0;
      let usage: TokenUsage = { ...ZERO_TOKEN_USAGE };

      if (resumeDecision && checkpoint) {
        messages = [...checkpoint.messages];
        startIteration = checkpoint.iteration;
        usage = checkpoint.usage;
        const approvalMsg = resumeDecision.approved
          ? `Human approval granted (${resumeDecision.requestId}) for: ${checkpoint.approvalSummary}. Proceed.`
          : `Human approval denied (${resumeDecision.requestId}) for: ${checkpoint.approvalSummary}. Do not proceed with the mutating action.`;
        messages.push({ role: 'user', content: approvalMsg });
      } else {
        const memoryContext = await this.deps.memoryStore.getContext(session.id, session.userId);
        messages = [...memoryContext.shortTerm, { role: 'user', content: input.content }];
        await this.deps.memoryStore.storeConversation(session.id, session.userId, [
          { role: 'user', content: input.content },
        ]);
      }

      const maxIterations = this.deps.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
      const nativeTools = useNativeTools ? toolPort!.getModelToolDefinitions!() : undefined;

      const loop = yield* runAgentLoop({
        modelProvider,
        systemPrompt,
        messages,
        model: agent.spec.model,
        toolPort,
        toolCtx,
        useNativeTools,
        nativeTools,
        startIteration,
        maxIterations,
        initialUsage: usage,
        shouldStop: () => {
          if (this.stopRequests.has(session.id)) {
            this.stopRequests.delete(session.id);
            return true;
          }
          return false;
        },
        onProgress: (phase) => this.deps.onProgress?.(session.id, phase),
      });

      if (loop.outcome !== 'completed') return;
      usage = loop.usage;

      yield { type: 'progress' as const, phase: 'Storing memory', status: 'running' as const };
      await this.deps.memoryStore.storeConversation(session.id, session.userId, [
        ...loop.messages,
        { role: 'assistant', content: loop.fullContent },
      ]);
      yield { type: 'progress' as const, phase: 'Completed', status: 'completed' as const };
      yield { type: 'done' as const, usage, promptHash };
    } catch (error) {
      yield {
        type: 'error' as const,
        error: error instanceof Error ? error.message : 'Agent runtime error',
      };
    }
  }

  async resume(
    session: Session,
    agent: AgentDefinition,
    approval: ApprovalDecision,
  ): Promise<AgentResult> {
    return this.run(session, agent, {
      content: '',
      metadata: { resumeDecision: approval },
    });
  }

  private async assembleSystemPrompt(
    agent: AgentDefinition,
    userId: string,
    message = '',
  ): Promise<{ systemPrompt: string; effectiveSpecs: import('@anvio/core').SkillDefinition['spec'][] }> {
    const [persona, skillSpecs] = await Promise.all([
      this.deps.personaService.getBySlug(agent.spec.persona),
      this.deps.skillRegistry.getBySlugs(agent.spec.skills),
    ]);

    // Auto-activate skills from active goals assigned to this agent
    let effectiveSlugs = agent.spec.skills;
    if (this.deps.activeGoalSkillsResolver) {
      try {
        const goalSkills = await this.deps.activeGoalSkillsResolver();
        effectiveSlugs = mergeSkillSlugs(effectiveSlugs, goalSkills);
      } catch (error) {
        // goal resolution is best-effort
        log.debug({ err: String(error) }, 'active-goal skill resolution failed');
      }
    }

    // Auto-activate skills whose triggers[] match the inbound message
    if (message && this.deps.skillCatalog) {
      try {
        const validSkills = await this.deps.skillCatalog.loadAll();
        const autoSlugs = matchTriggers(message, validSkills);
        effectiveSlugs = mergeSkillSlugs(effectiveSlugs, autoSlugs);
      } catch (error) {
        // trigger matching is best-effort
        log.debug({ err: String(error) }, 'skill trigger matching failed');
      }
    }

    const effectiveSpecs = effectiveSlugs === agent.spec.skills
      ? skillSpecs
      : await this.deps.skillRegistry.getBySlugs(effectiveSlugs);

    const personaPrompt = this.deps.personaService.renderSystemPrompt(persona);
    const skillPrompt = this.deps.skillRegistry.renderSkillInstructions(effectiveSpecs);

    const parts = [personaPrompt, skillPrompt];

    const soulSlug = agent.spec.soul;
    if (soulSlug && this.deps.soulService) {
      try {
        const soulContext = await this.deps.soulService.loadContext(soulSlug, userId);
        parts.push(this.deps.soulService.renderSoulContext(soulContext));
      } catch (error) {
        // Soul optional — fall back to persona-only context
        log.debug({ soul: soulSlug, err: String(error) }, 'soul context load failed');
      }
    }

    return {
      systemPrompt: parts.filter(Boolean).join('\n\n---\n\n'),
      effectiveSpecs,
    };
  }
}

export * from './orchestrator.js';
