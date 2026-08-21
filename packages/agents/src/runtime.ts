import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ModelToolCall,
  RuntimeToolPort,
  Session,
  TokenUsage,
  UserInput,
} from '@anvio/core';
import { addTokenUsage, ZERO_TOKEN_USAGE } from '@anvio/core';
import type { MemoryStore } from '@anvio/core';
import type { SoulService } from '@anvio/souls';
import type { ModelProviderRegistry, ModelRouter } from '@anvio/models';
import { stripToolCalls } from '@anvio/tools';
import { PersonaService } from '@anvio/personas';
import {
  SkillRegistry,
  mergeSkillSlugs,
  createComposableSkillRegistry,
} from '@anvio/skills';
import { classifyTask } from '@anvio/models';
import type { SkillCatalogResolver } from '@anvio/skills';
import { SkillTriggerCache } from '@anvio/skills';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  executeParsedToolCalls,
  type PendingToolApproval,
} from './tool-loop.js';
import { executeNativeToolCalls } from './native-tool-loop.js';
import { readRunCheckpoint, type AgentRunCheckpoint } from './run-checkpoint.js';

/**
 * Provider stop reasons meaning the model was cut off at the output token limit
 * rather than finishing: Anthropic `max_tokens`, OpenAI `length`, Gemini `MAX_TOKENS`.
 */
const TRUNCATED_FINISH_REASONS = new Set(['max_tokens', 'length']);

function isTruncatedFinishReason(reason?: string): boolean {
  return reason !== undefined && TRUNCATED_FINISH_REASONS.has(reason.toLowerCase());
}

const TRUNCATION_NOTICE =
  '\n\n[Response truncated: the model hit its output token limit. ' +
  'Raise maxTokens in the agent frontmatter, or ask for a shorter answer.]';

export interface AgentRuntimeDeps {
  personaService: PersonaService;
  skillRegistry: SkillRegistry;
  memoryStore: MemoryStore;
  modelProviders: ModelProviderRegistry;
  /**
   * When supplied, model calls go through the router so a target that dies before
   * emitting anything fails over to the route's next provider. Without a
   * `providers/routing.yaml` the router streams from `modelProviders`' own
   * resolution, so supplying it changes nothing until routing is configured.
   */
  modelRouter?: ModelRouter;
  soulService?: SoulService;
  toolPort?: RuntimeToolPort;
  skillCatalog?: SkillCatalogResolver;
  /** Returns skill slugs from active goals assigned to this agent — merged into system prompt */
  activeGoalSkillsResolver?: () => Promise<string[]>;
  maxToolIterations?: number;
  onProgress?: (sessionId: string, phase: string) => void;
}

export class DefaultAgentRuntime implements AgentRuntime {
  private readonly stopRequests = new Set<string>();
  private triggerCache: SkillTriggerCache | undefined;

  constructor(private readonly deps: AgentRuntimeDeps) {
    if (deps.skillCatalog) {
      this.triggerCache = SkillTriggerCache.fromResolver(deps.skillCatalog);
    }
  }

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
          } catch {
            // skill may be prose-only or not found — skip
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
      let fullContent = '';
      let lastIterationContent = '';

      for (let iteration = startIteration; iteration < maxIterations; iteration++) {
        if (this.stopRequests.has(session.id)) {
          this.stopRequests.delete(session.id);
          yield { type: 'error' as const, error: 'Session stopped by user' };
          return;
        }

        yield {
          type: 'progress' as const,
          phase: iteration === startIteration ? 'Calling model' : 'Calling model after tools',
          status: 'running' as const,
        };
        this.deps.onProgress?.(
          session.id,
          iteration === startIteration ? 'Calling model' : 'Calling model after tools',
        );

        let iterationContent = '';
        const iterationToolCalls: ModelToolCall[] = [];
        const modelRequest = {
          systemPrompt,
          messages,
          maxTokens: agent.spec.model.maxTokens,
          temperature: agent.spec.model.temperature,
          model: agent.spec.model.model,
          tools: nativeTools,
        };
        // The router hands back the resolved provider's own stream when no route
        // matches, so this is the same call it always was until routing.yaml exists.
        const modelStream = this.deps.modelRouter
          ? this.deps.modelRouter.stream(
              { ...modelRequest, agent, message: input.content, skillRoutingHints },
              modelProvider,
            )
          : modelProvider.stream(modelRequest);

        for await (const chunk of modelStream) {
          if (this.stopRequests.has(session.id)) {
            this.stopRequests.delete(session.id);
            yield { type: 'error' as const, error: 'Session stopped by user' };
            return;
          }
          if (chunk.type === 'text_delta' && chunk.delta) {
            iterationContent += chunk.delta;
            yield { type: 'chunk' as const, delta: chunk.delta };
          }
          if (chunk.type === 'tool_use') {
            iterationToolCalls.push(chunk.toolCall);
          }
          if (chunk.type === 'done') {
            if (chunk.usage) usage = addTokenUsage(usage, chunk.usage);
            if (chunk.toolCalls?.length) {
              for (const call of chunk.toolCalls) {
                if (!iterationToolCalls.some((c) => c.id === call.id)) {
                  iterationToolCalls.push(call);
                }
              }
            }
            if (isTruncatedFinishReason(chunk.finishReason)) {
              iterationContent += TRUNCATION_NOTICE;
              yield { type: 'chunk' as const, delta: TRUNCATION_NOTICE };
            }
          }
          if (chunk.type === 'error') {
            yield { type: 'error' as const, error: chunk.error };
            return;
          }
        }

        if (!toolPort || toolPort.listTools().length === 0) {
          fullContent = iterationContent;
          break;
        }

        lastIterationContent = iterationContent;

        if (useNativeTools && iterationToolCalls.length > 0) {
          const toolRound = await executeNativeToolCalls({
            toolPort,
            ctx: toolCtx,
            toolCalls: iterationToolCalls,
            callbacks: {
              onProgress: (phase) => this.deps.onProgress?.(session.id, phase),
            },
          });
          if (toolRound.pendingApproval) {
            yield {
              type: 'approval_required' as const,
              request: toApprovalRequest(toolRound.pendingApproval),
              checkpoint: buildCheckpoint(
                messages,
                iteration + 1,
                lastIterationContent,
                usage,
                toolRound.pendingApproval,
              ),
            };
            return;
          }
          messages.push({
            role: 'assistant',
            content: iterationContent,
            toolCalls: iterationToolCalls,
          });
          messages.push(...toolRound.toolMessages);
          continue;
        }

        const toolRound = await executeParsedToolCalls({
          toolPort,
          ctx: toolCtx,
          assistantContent: iterationContent,
          callbacks: {
            onProgress: (phase) => this.deps.onProgress?.(session.id, phase),
          },
        });

        if (toolRound.pendingApproval) {
          yield {
            type: 'approval_required' as const,
            request: toApprovalRequest(toolRound.pendingApproval),
            checkpoint: buildCheckpoint(
              messages,
              iteration + 1,
              lastIterationContent,
              usage,
              toolRound.pendingApproval,
            ),
          };
          return;
        }

        if (!toolRound.hadTools) {
          fullContent = iterationContent;
          break;
        }

        messages.push({ role: 'assistant', content: iterationContent });
        messages.push(...toolRound.toolMessages);
      }

      if (!fullContent) {
        fullContent = stripToolCalls(lastIterationContent);
      }

      yield { type: 'progress' as const, phase: 'Storing memory', status: 'running' as const };
      await this.deps.memoryStore.storeConversation(session.id, session.userId, [
        ...messages,
        { role: 'assistant', content: fullContent },
      ]);
      yield { type: 'progress' as const, phase: 'Completed', status: 'completed' as const };
      yield { type: 'done' as const, usage };
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
      } catch {
        // goal resolution is best-effort
      }
    }

    // Auto-activate skills whose triggers[] match the inbound message.
    // Uses SkillTriggerCache — re-parses only YAML files whose mtime changed.
    if (message && this.triggerCache) {
      try {
        const autoSlugs = await this.triggerCache.matchAll(message);
        effectiveSlugs = mergeSkillSlugs(effectiveSlugs, autoSlugs);
      } catch {
        // trigger matching is best-effort
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
      } catch {
        // Soul optional — fall back to persona-only context
      }
    }

    return {
      systemPrompt: parts.filter(Boolean).join('\n\n---\n\n'),
      effectiveSpecs,
    };
  }
}

function toApprovalRequest(pending: PendingToolApproval): ApprovalRequest {
  return {
    id: pending.requestId,
    toolName: pending.toolName,
    input: { summary: pending.summary },
    reason: pending.summary,
    expiresAt: new Date(Date.now() + 86_400_000),
  };
}

function buildCheckpoint(
  messages: ChatMessage[],
  iteration: number,
  lastIterationContent: string,
  usage: TokenUsage,
  pending: PendingToolApproval,
): Record<string, unknown> {
  const checkpoint: AgentRunCheckpoint = {
    messages,
    iteration,
    lastIterationContent,
    usage,
    approvalRequestId: pending.requestId,
    approvalSummary: pending.summary,
  };
  return checkpoint as unknown as Record<string, unknown>;
}

export * from './orchestrator.js';
