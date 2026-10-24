import type {
  AgentDefinition,
  AgentResult,
  AgentRuntime,
  AgentStopReason,
  AgentStreamEvent,
  ApprovalDecision,
  ApprovalRequest,
  ChatMessage,
  ModelProvider,
  ModelToolCall,
  ModelToolDefinition,
  RuntimeToolContext,
  RuntimeToolPort,
  Session,
  SkillDefinition,
  StreamChunk,
  TokenUsage,
  UserInput,
} from '@anvio/core';
import { addTokenUsage, ZERO_TOKEN_USAGE } from '@anvio/core';
import type { MemoryStore } from '@anvio/core';
import type { SoulService } from '@anvio/souls';
import type { ModelProviderRegistry, ModelRouter } from '@anvio/models';
import { parseToolCalls, stripToolCalls } from '@anvio/tools';
import { PersonaService } from '@anvio/personas';
import {
  SkillRegistry,
  mergeSkillSlugs,
  createComposableSkillRegistry,
} from '@anvio/skills';
import type { TaskRoute } from '@anvio/models';
import type { SkillCatalogResolver } from '@anvio/skills';
import { SkillNotFoundError, SkillTriggerCache } from '@anvio/skills';
import {
  DEFAULT_MAX_TOOL_ITERATIONS,
  executeToolRound,
  type PendingToolApproval,
  type ToolCallFormat,
} from './tool-round.js';
import { buildRunCheckpoint, readRunCheckpoint } from './run-checkpoint.js';

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

/**
 * Shown when a provider dies part-way through an answer.
 *
 * The router can only fail over before the first content chunk, so a failure past
 * that point ends this turn — but the text already generated is real and the user
 * has already read it. Keeping it turns a dead session into a short answer.
 */
function interruptedNotice(reason?: string): string {
  return (
    `\n\n[Response interrupted: ${reason ?? 'the provider stopped responding'}. ` +
    'The partial answer above was kept — ask to continue if you need the rest.]'
  );
}

/** The loop used to end silently at the cap, returning whatever text was left (audit CQ-005). */
function iterationLimitNotice(maxIterations: number): string {
  return (
    `\n\n[Stopped after ${maxIterations} tool rounds: the agent still wanted to call tools ` +
    'when the tool-call limit was reached. Ask it to continue, or raise maxToolIterations.]'
  );
}

/**
 * How long a model stream may stay silent before the turn gives up on it. Generous
 * on purpose: reasoning models can think for minutes before the first token, and
 * adapters do not forward keep-alive events. Tune with ANVIO_MODEL_IDLE_TIMEOUT_MS.
 */
export const DEFAULT_MODEL_IDLE_TIMEOUT_MS = 300_000;

/** Approval requests expire after a day unless the harness policy says otherwise. */
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

const STOPPED_MESSAGE = 'Session stopped by user';

/** Abort reason when `stop()` is called for a running session. */
export class RunStoppedError extends Error {
  constructor() {
    super(STOPPED_MESSAGE);
    this.name = 'RunStoppedError';
  }
}

/** A model stream produced nothing for longer than the idle timeout. */
export class ModelIdleTimeoutError extends Error {
  constructor(readonly idleMs: number) {
    super(`the model stream was idle for ${Math.round(idleMs / 1000)}s`);
    this.name = 'ModelIdleTimeoutError';
  }
}

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
  /** Milliseconds without a stream chunk before a model call is abandoned. 0 disables. */
  modelIdleTimeoutMs?: number;
  /**
   * Mirror of the `progress` events the stream yields. Optional and not needed by
   * stream consumers — they already receive every phase.
   */
  onProgress?: (sessionId: string, phase: string) => void;
  /** Where best-effort failures (skill load, soul, memory write) are reported. */
  warn?: (message: string, error?: unknown) => void;
}

/** Everything a turn needs that is fixed before the first model call. */
interface PreparedTurn {
  systemPrompt: string;
  toolPort?: RuntimeToolPort;
  hasTools: boolean;
  format: ToolCallFormat;
  nativeTools?: ModelToolDefinition[];
  modelProvider: ModelProvider;
  requestModel?: string;
  skillRoutingHints: string[];
}

interface IterationResult {
  content: string;
  toolCalls: ModelToolCall[];
  interrupted: boolean;
  provider?: string;
  model?: string;
}

type RuntimeEvent = AgentStreamEvent;

export class DefaultAgentRuntime implements AgentRuntime {
  /** One controller per running session; `stop()` aborts it. */
  private readonly activeRuns = new Map<string, AbortController>();
  private triggerCache: SkillTriggerCache | undefined;

  constructor(private readonly deps: AgentRuntimeDeps) {
    if (deps.skillCatalog) {
      this.triggerCache = SkillTriggerCache.fromResolver(deps.skillCatalog);
    }
  }

  /**
   * Abort the session's in-flight turn: the model stream and any tool call it is
   * waiting on. A stop for a session with nothing running is a no-op — it used to
   * be remembered and kill that session's *next* turn instead (audit CQ-006).
   */
  async stop(sessionId: string): Promise<void> {
    this.activeRuns.get(sessionId)?.abort(new RunStoppedError());
  }

  /** True while a turn for `sessionId` is executing. */
  isRunning(sessionId: string): boolean {
    return this.activeRuns.has(sessionId);
  }

  async run(session: Session, agent: AgentDefinition, input: UserInput): Promise<AgentResult> {
    let content = '';
    let usage: TokenUsage = { ...ZERO_TOKEN_USAGE };
    let status: AgentResult['status'] = 'completed';

    for await (const chunk of this.stream(session, agent, input)) {
      if (chunk.type === 'chunk' && chunk.delta) content += chunk.delta;
      if (chunk.type === 'done' && chunk.usage) usage = chunk.usage;
      if (chunk.type === 'approval_required') status = 'awaiting_approval';
      if (chunk.type === 'error') {
        throw new AgentRunError(chunk.error ?? 'Agent runtime error', chunk.code, chunk.retryable);
      }
    }

    return { sessionId: session.id, content, usage, status };
  }

  async *stream(session: Session, agent: AgentDefinition, input: UserInput): AsyncGenerator<RuntimeEvent> {
    if (this.activeRuns.has(session.id)) {
      yield {
        type: 'error',
        error: 'Another turn is already running for this session',
        code: 'session_busy',
        retryable: true,
      };
      return;
    }
    const controller = new AbortController();
    this.activeRuns.set(session.id, controller);
    const signal = controller.signal;

    let unfinishedTurnHistory: ChatMessage[] | undefined;
    try {
      const resumeDecision = input.metadata?.resumeDecision as ApprovalDecision | undefined;

      yield* this.progress(session.id, 'Assembling context');
      const turn = await this.prepareTurn(session, agent, input);

      const toolCtx: RuntimeToolContext = {
        sessionId: session.id,
        agentId: session.agentId,
        userId: session.userId,
        channel: session.channel,
      };

      let messages: ChatMessage[];
      let startIteration = 0;
      let usage: TokenUsage = { ...ZERO_TOKEN_USAGE };

      if (resumeDecision) {
        const read = readRunCheckpoint(session.state.metadata);
        if (read.status !== 'ok') {
          // Resuming without a usable checkpoint used to run a fresh turn with an
          // empty user message; refuse instead so the user sees what happened.
          yield {
            type: 'error',
            error:
              read.status === 'absent'
                ? 'Cannot resume: no paused turn was found for this session'
                : `Cannot resume: the saved checkpoint is invalid (${read.reason})`,
            code: 'invalid_checkpoint',
            retryable: false,
          };
          return;
        }
        const checkpoint = read.checkpoint;
        messages = [...checkpoint.messages];
        startIteration = checkpoint.iteration;
        usage = checkpoint.usage;
        messages.push({
          role: 'user',
          content: resumeDecision.approved
            ? `Human approval granted (${resumeDecision.requestId}) for: ${checkpoint.approvalSummary}. Proceed.`
            : `Human approval denied (${resumeDecision.requestId}) for: ${checkpoint.approvalSummary}. Do not proceed with the mutating action.`,
        });
      } else {
        const memoryContext = await this.deps.memoryStore.getContext(session.id, session.userId);
        messages = [...memoryContext.shortTerm, { role: 'user', content: input.content }];
        // Persisted in `finally` only if the turn does not complete. Writing just the
        // user message here overwrote the whole short-term history, so any error,
        // stop or approval pause left the session with one message (audit G-01).
        unfinishedTurnHistory = [...messages];
      }

      const maxIterations = this.deps.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
      let finalContent: string | undefined;
      let lastIterationContent = '';
      let stopReason: AgentStopReason = 'end_turn';
      let servedBy: { provider?: string; model?: string } = {};

      for (let iteration = startIteration; iteration < maxIterations; iteration++) {
        signal.throwIfAborted();
        yield* this.progress(
          session.id,
          iteration === startIteration ? 'Calling model' : 'Calling model after tools',
        );

        const modelCall = this.streamModelIteration(turn, messages, agent, input, signal);
        let step = await modelCall.next();
        while (!step.done) {
          yield step.value;
          step = await modelCall.next();
        }
        const result = step.value;
        usage = addTokenUsage(usage, result.usage);
        servedBy = { provider: result.provider ?? servedBy.provider, model: result.model ?? servedBy.model };

        if (result.interrupted) {
          // A half-finished turn has no reliable tool calls.
          finalContent = result.content;
          stopReason = 'interrupted';
          break;
        }
        if (!turn.hasTools) {
          finalContent = result.content;
          break;
        }

        lastIterationContent = result.content;
        // Native-tool providers normally return structured calls; a fenced
        // `anvio_tool` block in the text is still honoured, as before.
        const format: ToolCallFormat =
          turn.format === 'native' && result.toolCalls.length > 0 ? 'native' : 'parsed';
        const calls =
          format === 'native'
            ? result.toolCalls
            : parseToolCalls(result.content).map((call, index) => ({
                id: `parsed-${iteration}-${index}`,
                name: call.name,
                arguments: call.arguments,
              }));
        if (calls.length === 0) {
          finalContent = result.content;
          break;
        }

        const assistantTurn: ChatMessage =
          format === 'native'
            ? { role: 'assistant', content: result.content, toolCalls: calls }
            : { role: 'assistant', content: result.content };

        const round = executeToolRound({
          toolPort: turn.toolPort!,
          ctx: toolCtx,
          calls,
          format,
          signal,
        });
        let roundStep = await round.next();
        while (!roundStep.done) {
          yield* this.progress(session.id, roundStep.value.phase);
          roundStep = await round.next();
        }
        const { toolMessages, pendingApproval } = roundStep.value;
        messages.push(assistantTurn, ...toolMessages);

        if (pendingApproval) {
          yield {
            type: 'approval_required',
            request: toApprovalRequest(pendingApproval),
            checkpoint: buildRunCheckpoint({
              messages,
              iteration: iteration + 1,
              lastIterationContent,
              usage,
              pending: pendingApproval,
            }) as unknown as Record<string, unknown>,
          };
          return;
        }
      }

      if (finalContent === undefined) {
        // Ran out of iterations while the model still asked for tools.
        stopReason = 'iteration_limit';
        const notice = iterationLimitNotice(maxIterations);
        finalContent = stripToolCalls(lastIterationContent) + notice;
        yield { type: 'chunk', delta: notice };
        yield* this.progress(session.id, 'Tool iteration limit reached');
        this.warn(`[agents] session ${session.id} hit maxToolIterations (${maxIterations})`);
      }

      yield* this.progress(session.id, 'Storing memory');
      await this.deps.memoryStore.storeConversation(session.id, session.userId, [
        ...messages,
        { role: 'assistant', content: finalContent },
      ]);
      unfinishedTurnHistory = undefined;
      yield { type: 'progress', phase: 'Completed', status: 'completed' };
      yield { type: 'done', usage, stopReason, ...servedBy };
    } catch (error) {
      yield toErrorEvent(error, signal);
    } finally {
      this.activeRuns.delete(session.id);
      // Keep the prior history plus this user message, so the next turn still
      // sees both. Best-effort: a failed write must not mask the turn's own outcome.
      if (unfinishedTurnHistory) {
        try {
          await this.deps.memoryStore.storeConversation(
            session.id,
            session.userId,
            unfinishedTurnHistory,
          );
        } catch (error) {
          this.warn(`[agents] could not save history for unfinished turn ${session.id}`, error);
        }
      }
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

  /**
   * Persona + skills + soul prompt for vendor runtimes that run their own
   * loop and cannot call `assembleSystemPrompt` themselves (issue #102).
   */
  async buildSystemPrompt(agent: AgentDefinition, userId: string, message = ''): Promise<string> {
    return (await this.assembleSystemPrompt(agent, userId, message)).systemPrompt;
  }

  private *progress(sessionId: string, phase: string): Generator<RuntimeEvent> {
    yield { type: 'progress', phase, status: 'running' };
    this.deps.onProgress?.(sessionId, phase);
  }

  private warn(message: string, error?: unknown): void {
    if (this.deps.warn) {
      this.deps.warn(message, error);
      return;
    }
    console.warn(message, error instanceof Error ? error.message : (error ?? ''));
  }

  /** Prompt, tool surface and provider for the turn. */
  private async prepareTurn(
    session: Session,
    agent: AgentDefinition,
    input: UserInput,
  ): Promise<PreparedTurn> {
    const { systemPrompt: baseSystemPrompt, effectiveSpecs } = await this.assembleSystemPrompt(
      agent,
      session.userId,
      input.content,
    );

    // Wire composable skills into the tool port so the LLM can call skill__<slug>
    // and so skill steps can call other skills via "skill:<slug>". Skills are
    // resolved lazily by the catalog — no need to pre-load all specs here.
    const composableReg = createComposableSkillRegistry([], this.deps.skillCatalog, this.deps.toolPort);
    // Pre-register agent's own skills so they appear in tool definitions immediately
    if (this.deps.skillCatalog) {
      for (const slug of agent.spec.skills) {
        try {
          composableReg.register(await this.deps.skillCatalog.load(slug));
        } catch (error) {
          // Prose-only skills have no executable definition; anything else is worth knowing.
          if (!(error instanceof SkillNotFoundError)) {
            this.warn(`[agents] skill "${slug}" not registered as a tool`, error);
          }
        }
      }
    }
    const toolPort = composableReg.buildToolPort();

    // The agent's own provider wins unless the agent or one of its skills opts
    // into a route. Inferring a route from the message text let a word like
    // "implement" move an Anthropic agent onto OpenAI (audit G-02).
    const skillRoutingHints = effectiveSpecs.flatMap((s) => (s.routing ? [s.routing] : []));
    const route = explicitRoute(agent, skillRoutingHints);
    const routeProvider = route ? this.deps.modelProviders.resolveForRoute?.(route) : undefined;
    const modelProvider = routeProvider ?? this.deps.modelProviders.resolveForAgent(agent);
    // The agent's model id belongs to the agent's provider. A route that lands on
    // a different provider sends no id, so that provider uses its own default.
    const requestModel =
      routeProvider && routeProvider.providerId !== agent.spec.model.provider
        ? undefined
        : agent.spec.model.model;

    const hasTools = Boolean(toolPort) && (toolPort?.listTools().length ?? 0) > 0;
    const nativeDefinitions = hasTools ? toolPort?.getModelToolDefinitions?.() : undefined;
    const format: ToolCallFormat =
      hasTools && modelProvider.supportsNativeTools && nativeDefinitions ? 'native' : 'parsed';

    let systemPrompt = baseSystemPrompt;
    if (hasTools && format === 'parsed') {
      systemPrompt = `${systemPrompt}\n\n---\n\n${toolPort!.getToolInstructions()}`;
    }

    return {
      systemPrompt,
      toolPort,
      hasTools,
      format,
      nativeTools: format === 'native' ? nativeDefinitions : undefined,
      modelProvider,
      requestModel,
      skillRoutingHints,
    };
  }

  /**
   * One model call. Yields user-visible chunks and returns the text, tool calls
   * and who served it. Provider failures after output has started are folded into
   * the text (`interrupted`); failures before any output are thrown.
   */
  private async *streamModelIteration(
    turn: PreparedTurn,
    messages: ChatMessage[],
    agent: AgentDefinition,
    input: UserInput,
    runSignal: AbortSignal,
  ): AsyncGenerator<RuntimeEvent, IterationResult & { usage: TokenUsage }> {
    const idleMs = this.deps.modelIdleTimeoutMs ?? resolveModelIdleTimeoutMs();
    const callController = new AbortController();
    const signal = AbortSignal.any([runSignal, callController.signal]);
    const modelRequest = {
      systemPrompt: turn.systemPrompt,
      messages,
      maxTokens: agent.spec.model.maxTokens,
      temperature: agent.spec.model.temperature,
      model: turn.requestModel,
      tools: turn.nativeTools,
      signal,
    };
    // The router hands back the resolved provider's own stream when no route
    // matches, so this is the same call it always was until routing.yaml exists.
    const source = this.deps.modelRouter
      ? this.deps.modelRouter.stream(
          { ...modelRequest, agent, message: input.content, skillRoutingHints: turn.skillRoutingHints },
          turn.modelProvider,
        )
      : turn.modelProvider.stream(modelRequest);

    const result: IterationResult & { usage: TokenUsage } = {
      content: '',
      toolCalls: [],
      interrupted: false,
      usage: { ...ZERO_TOKEN_USAGE },
    };

    const interrupt = (reason: string): RuntimeEvent => {
      const notice = interruptedNotice(reason);
      result.content += notice;
      result.interrupted = true;
      return { type: 'chunk', delta: notice };
    };

    try {
      for await (const chunk of guardStream(source, { idleMs, signal: runSignal, onIdle: (e) => callController.abort(e) })) {
        const event = this.handleModelChunk(chunk, result);
        if (event === 'interrupt') {
          if (!result.content) {
            throw new ProviderStreamError(chunk.type === 'error' ? chunk.error : undefined, chunk.type === 'error' ? chunk.retryable : undefined);
          }
          // Output already reached the user and cannot be retracted, so end the
          // turn with what exists instead of discarding it (see issue #20).
          yield interrupt(chunk.type === 'error' ? (chunk.error ?? 'provider error') : 'provider error');
          break;
        }
        if (event) yield event;
      }
    } catch (error) {
      if (error instanceof ModelIdleTimeoutError && result.content) {
        yield interrupt(error.message);
      } else {
        throw error;
      }
    }
    return result;
  }

  /** Apply one provider chunk to the iteration; returns what to yield, or `'interrupt'`. */
  private handleModelChunk(
    chunk: StreamChunk,
    result: IterationResult & { usage: TokenUsage },
  ): RuntimeEvent | 'interrupt' | undefined {
    switch (chunk.type) {
      case 'text_delta':
        if (!chunk.delta) return undefined;
        result.content += chunk.delta;
        return { type: 'chunk', delta: chunk.delta };
      case 'tool_use':
        result.toolCalls.push(chunk.toolCall);
        return undefined;
      case 'done':
        if (chunk.usage) result.usage = addTokenUsage(result.usage, chunk.usage);
        for (const call of chunk.toolCalls ?? []) {
          if (!result.toolCalls.some((c) => c.id === call.id)) result.toolCalls.push(call);
        }
        result.provider = chunk.provider ?? result.provider;
        result.model = chunk.model ?? result.model;
        if (isTruncatedFinishReason(chunk.finishReason)) {
          result.content += TRUNCATION_NOTICE;
          return { type: 'chunk', delta: TRUNCATION_NOTICE };
        }
        return undefined;
      case 'failover':
        return { type: 'progress', phase: `Switched to ${chunk.to} — ${chunk.from} failed`, status: 'running' };
      case 'error':
        return 'interrupt';
      default:
        return undefined;
    }
  }

  private async assembleSystemPrompt(
    agent: AgentDefinition,
    userId: string,
    message = '',
  ): Promise<{ systemPrompt: string; effectiveSpecs: SkillDefinition['spec'][] }> {
    const [persona, skillSpecs] = await Promise.all([
      this.deps.personaService.getBySlug(agent.spec.persona),
      this.deps.skillRegistry.getBySlugs(agent.spec.skills),
    ]);

    // Auto-activate skills from active goals assigned to this agent
    let effectiveSlugs = agent.spec.skills;
    if (this.deps.activeGoalSkillsResolver) {
      try {
        effectiveSlugs = mergeSkillSlugs(effectiveSlugs, await this.deps.activeGoalSkillsResolver());
      } catch (error) {
        this.warn('[agents] goal skill resolution failed; continuing without goal skills', error);
      }
    }

    // Auto-activate skills whose triggers[] match the inbound message.
    // Uses SkillTriggerCache — re-parses only YAML files whose mtime changed.
    if (message && this.triggerCache) {
      try {
        effectiveSlugs = mergeSkillSlugs(effectiveSlugs, await this.triggerCache.matchAll(message));
      } catch (error) {
        this.warn('[agents] skill trigger matching failed; continuing without triggered skills', error);
      }
    }

    const effectiveSpecs =
      effectiveSlugs === agent.spec.skills
        ? skillSpecs
        : await this.deps.skillRegistry.getBySlugs(effectiveSlugs);

    const parts = [
      this.deps.personaService.renderSystemPrompt(persona),
      this.deps.skillRegistry.renderSkillInstructions(effectiveSpecs),
    ];

    const soulSlug = agent.spec.soul;
    if (soulSlug && this.deps.soulService) {
      try {
        const soulContext = await this.deps.soulService.loadContext(soulSlug, userId);
        parts.push(this.deps.soulService.renderSoulContext(soulContext));
      } catch (error) {
        // Soul optional — fall back to persona-only context, but say so.
        this.warn(`[agents] soul "${soulSlug}" could not be loaded; using persona only`, error);
      }
    }

    return {
      systemPrompt: parts.filter(Boolean).join('\n\n---\n\n'),
      effectiveSpecs,
    };
  }
}

/** Thrown by `run()` for an `error` event, carrying its code and retryability. */
export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly retryable?: boolean,
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

/** A provider reported an error before producing any output. */
class ProviderStreamError extends Error {
  constructor(
    message: string | undefined,
    readonly retryable: boolean | undefined,
  ) {
    super(message ?? 'Model provider error');
    this.name = 'ProviderStreamError';
  }
}

function toErrorEvent(error: unknown, signal: AbortSignal): RuntimeEvent {
  if (signal.aborted && signal.reason instanceof RunStoppedError) {
    return { type: 'error', error: STOPPED_MESSAGE, code: 'stopped', retryable: false };
  }
  if (error instanceof ModelIdleTimeoutError) {
    return { type: 'error', error: `Model did not respond: ${error.message}`, code: 'model_idle_timeout', retryable: true };
  }
  if (error instanceof ProviderStreamError) {
    return { type: 'error', error: error.message, code: 'provider_error', retryable: error.retryable };
  }
  return {
    type: 'error',
    error: error instanceof Error ? error.message : 'Agent runtime error',
  };
}

export function resolveModelIdleTimeoutMs(): number {
  const raw = process.env.ANVIO_MODEL_IDLE_TIMEOUT_MS;
  if (raw === undefined) return DEFAULT_MODEL_IDLE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MODEL_IDLE_TIMEOUT_MS;
}

/**
 * Iterate `source`, failing with {@link ModelIdleTimeoutError} when no chunk
 * arrives within `idleMs` and with the abort reason when `signal` fires. Neither
 * depends on the provider honouring its own `signal`.
 */
export async function* guardStream<T>(
  source: AsyncIterable<T>,
  options: { idleMs: number; signal?: AbortSignal; onIdle?: (error: ModelIdleTimeoutError) => void },
): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  let finished = false;
  try {
    for (;;) {
      const next = await nextWithin(iterator, options);
      if (next.done) {
        finished = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!finished) {
      // Do not await: a provider stuck in `next()` would block the turn's cleanup.
      void Promise.resolve(iterator.return?.()).catch(() => undefined);
    }
  }
}

function nextWithin<T>(
  iterator: AsyncIterator<T>,
  options: { idleMs: number; signal?: AbortSignal; onIdle?: (error: ModelIdleTimeoutError) => void },
): Promise<IteratorResult<T>> {
  const { idleMs, signal, onIdle } = options;
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(signal!.reason);
    };
    if (idleMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        const error = new ModelIdleTimeoutError(idleMs);
        onIdle?.(error);
        reject(error);
      }, idleMs);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    iterator.next().then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** A route the agent or one of its skills asked for; never inferred from the message. */
function explicitRoute(
  agent: AgentDefinition,
  skillRoutingHints: string[],
): TaskRoute | undefined {
  const routes: readonly string[] = ['coding', 'review', 'chat', 'research', 'default'];
  const chosen =
    agent.spec.model.routing ?? skillRoutingHints.find((hint) => routes.includes(hint));
  return chosen as TaskRoute | undefined;
}

function toApprovalRequest(pending: PendingToolApproval): ApprovalRequest {
  return {
    id: pending.requestId,
    toolName: pending.toolName,
    input: { summary: pending.summary },
    reason: pending.summary,
    expiresAt: new Date(Date.now() + APPROVAL_TTL_MS),
  };
}
