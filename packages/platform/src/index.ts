import { ActionExecutor, createAutomationEngine, type AutomationEngine } from '@anvio/automation';
import { BlueprintExecutor, createCatalogRegistry } from '@anvio/blueprints';
import { createIntegrationRegistry, createMcpBridge, createMcpFirstCallGate, createMcpToolPort, loadMcpToolCatalog, type McpFirstCallGate } from '@anvio/integrations';
import { createHookEngine, type HookEngine } from '@anvio/hooks';
import { DefaultAgentRuntime } from '@anvio/agents';
import { createChannelHub, ChannelHub, FilesystemAgentInbox, type WhatsAppChannel } from '@anvio/channels';
import { createAuthProvider } from '@anvio/auth';
import type {
  AgentDefinition,
  AuthProvider,
  ChannelHubPort,
  AgentInbox,
  ModelProvider,
  Session,
} from '@anvio/core';
import { createEventBus, EventSubjects, type EventBusLike } from '@anvio/events';
import { createMemoryProvider } from '@anvio/memory';
import {
  createModelProviderRegistryFromEnv,
  createModelProviderRegistryInstance,
  allKnownProviderIds,
  type ModelProviderRegistry,
} from '@anvio/models';
import { PersonaService } from '@anvio/personas';
import { createSoulService } from '@anvio/souls';
import { SkillRegistry, createSkillCatalogResolver } from '@anvio/skills';
import { createHarnessFromWorkspace, createHarnessAwareToolPort, type HarnessGateway } from '@anvio/harness';
import { LearningEngine } from '@anvio/learning';
import { ToolGateway } from '@anvio/tools';
import { createCodeExecutor } from '@anvio/execution';
import { DagExecutor, createWorkflowRegistry } from '@anvio/workflows';
import { Workspace } from '@anvio/workspace';
import { findRepoRoot, findWorkspacePath } from './find-workspace.js';
import { createTokenUsageAudit } from './token-usage-audit.js';

export interface PlatformContext {
  workspace: Workspace;
  auth: AuthProvider;
  runtime: DefaultAgentRuntime;
  eventBus: EventBusLike;
  modelProvider: ModelProvider;
  modelProviders: ModelProviderRegistry;
  channelHub: ChannelHubPort;
  inbox: AgentInbox;
  whatsapp?: WhatsAppChannel;
  blueprintExecutor: BlueprintExecutor;
  automationEngine: AutomationEngine;
  hookEngine: HookEngine;
  harness: HarnessGateway;
  learningEngine: LearningEngine;
  toolGateway: ToolGateway;
  mcpFirstCallGate: McpFirstCallGate;
}

export interface PlatformOptions {
  workspacePath?: string;
  anthropicApiKey?: string;
}

export async function createPlatform(options: PlatformOptions = {}): Promise<PlatformContext> {
  const workspacePath = options.workspacePath ?? findWorkspacePath();
  const workspace = await Workspace.open(workspacePath);
  const { spec } = workspace.config;
  const defaultAgent = spec.defaultAgent ?? 'architect';

  const auth = createAuthProvider(spec.auth, {
    jwtSecret: process.env.JWT_SECRET,
    defaultUserId: spec.defaultUserId,
  });

  const memoryProvider = createMemoryProvider(spec.memory.provider, workspace.storage, undefined, {
    fts: spec.memory.fts,
  });
  const repoRoot = findRepoRoot(workspacePath);
  const personaService = new PersonaService(workspace.loader);
  const skillCatalog = createSkillCatalogResolver(workspacePath, repoRoot);
  const skillRegistry = new SkillRegistry(workspace.loader, skillCatalog);
  const soulService = createSoulService(workspace.storage, memoryProvider);

  const providerMap = createModelProviderRegistryFromEnv({
    anthropicApiKey: options.anthropicApiKey,
  });
  if (providerMap.size === 0) {
    const mock = createMockModelProvider();
    for (const id of allKnownProviderIds()) {
      providerMap.set(id, mock);
    }
  }
  const modelProviders = createModelProviderRegistryInstance(providerMap);
  const modelProvider =
    modelProviders.getOptional('anthropic') ??
    modelProviders.first() ??
    createMockModelProvider();

  const eventBus = await createEventBus(spec.events.provider, {
    url: spec.events.url ?? process.env.NATS_URL,
    source: '/anvio/platform',
  });

  const inbox = new FilesystemAgentInbox(workspace.storage);

  let soulDefinition;
  if (spec.defaultSoul) {
    try {
      soulDefinition = await soulService.get(spec.defaultSoul);
    } catch {
      soulDefinition = undefined;
    }
  }

  const channelHub = new ChannelHub();
  const harness = await createHarnessFromWorkspace({
    workspaceRoot: workspacePath,
    channelHub,
    sessions: workspace.sessions,
    soulDefinition,
    modelProvider:
      modelProviders.getOptional('anthropic') ??
      (modelProviders.first()?.providerId !== 'mock' ? modelProviders.first() : undefined),
    onApprovalTimedOut: async (sessionId, requestId) => {
      await workspace.sessions.update(sessionId, {
        pendingApproval: undefined,
        status: 'failed',
        metadata: { approvalTimeout: requestId },
      });
      await eventBus.publish(EventSubjects.APPROVAL_DECIDED, 'anvio.approval.decided', {
        sessionId,
        requestId,
        approved: false,
        reason: 'approval_timeout',
      });
    },
  });

  const { whatsapp } = createChannelHub({
    hub: channelHub,
    sessions: workspace.sessions,
    eventBus,
    defaultAgent,
    defaultUserId: spec.defaultUserId,
    channels: spec.channels,
    harness,
    onApproval: async (sessionId, requestId, approved, userId) => {
      if (harness.enabled && userId) {
        const ok = await harness.resolveApproval(sessionId, requestId, userId, approved);
        if (!ok) return;
      } else {
        await workspace.sessions.update(sessionId, { pendingApproval: undefined });
      }
      await eventBus.publish(EventSubjects.APPROVAL_DECIDED, 'anvio.approval.decided', {
        sessionId,
        requestId,
        approved,
      });
    },
  });

  const learningModelProvider =
    modelProviders.getOptional('anthropic') ??
    modelProviders.first();
  const learningEngine = new LearningEngine(memoryProvider, workspacePath, {
    modelProvider:
      learningModelProvider && learningModelProvider.providerId !== 'mock'
        ? learningModelProvider
        : undefined,
  });
  const codeExecutor = createCodeExecutor({
    storage: workspace.storage,
    workspaceRoot: workspacePath,
    allowedRuntimes: ['shell', 'python', 'node', 'go', 'docker'],
  });
  const toolGateway = await ToolGateway.load(workspacePath, {
    codeExecutor,
    workspaceRoot: workspacePath,
    memoryRecall: async (userId, query, limit) => {
      if (memoryProvider.search) {
        return memoryProvider.search(query, { userId, limit });
      }
      return [];
    },
  });

  toolGateway.setOnToolCompleted(async (ctx, call, result) => {
    let soul = ctx.soul;
    if (!soul) {
      try {
        const agent = await workspace.loader.loadAgent(ctx.agentId);
        if (agent.spec.soul) {
          soul = await soulService.get(agent.spec.soul);
        }
      } catch {
        soul = undefined;
      }
    }
    if (!soul && spec.defaultSoul) {
      try {
        soul = await soulService.get(spec.defaultSoul);
      } catch {
        soul = undefined;
      }
    }

    const outcome =
      result.error != null
        ? `${result.error}\n${JSON.stringify(result.output ?? null)}`
        : JSON.stringify(result.output ?? null);

    await learningEngine.onToolUseCompleted({
      sessionId: ctx.sessionId,
      agentId: ctx.agentId,
      toolName: call.name,
      outcome,
      soul,
    });
  });

  const integrationRegistry = createIntegrationRegistry(workspace.storage);
  const mcpConfig = await integrationRegistry.load();
  const mcpBridge = createMcpBridge(integrationRegistry);
  const enabledMcpServers = (await integrationRegistry.listEnabled()).map((entry) => entry.id);
  const mcpCatalog = await loadMcpToolCatalog(mcpBridge, enabledMcpServers);

  const mcpFirstCallGate = createMcpFirstCallGate({
    enabled: mcpConfig.spec.firstCallApproval !== false,
    getApproved: async (sessionId) => {
      const stored = await workspace.sessions.get(sessionId);
      const keys = stored?.metadata?.mcpApprovedTools;
      return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
    },
    persistApproved: async (sessionId, keys) => {
      const stored = await workspace.sessions.get(sessionId);
      if (!stored) return;
      await workspace.sessions.update(sessionId, {
        metadata: { ...stored.metadata, mcpApprovedTools: keys },
      });
    },
  });

  let toolPort = harness.enabled
    ? createHarnessAwareToolPort(toolGateway, harness)
    : toolGateway;

  if (mcpCatalog.names.length > 0) {
    toolPort = createMcpToolPort(toolPort, {
      mcpBridge,
      gate: mcpFirstCallGate,
      mcpToolNames: mcpCatalog.names,
      mcpToolDefinitions: mcpCatalog.definitions,
    });
  }

  const runtime = new DefaultAgentRuntime({
    personaService,
    skillRegistry,
    memoryStore: memoryProvider,
    soulService,
    modelProviders,
    toolPort,
    onProgress: (sessionId, phase) => {
      void eventBus.publishCore(EventSubjects.AGENT_RUN_PROGRESS, 'anvio.agent.run.progress', {
        sessionId,
        phase,
        status: 'running' as const,
        channel: 'cli',
      });
    },
  });

  await channelHub.startAll();

  const catalog = createCatalogRegistry(workspacePath, repoRoot);
  const workflowRegistry = createWorkflowRegistry(workspacePath, repoRoot);
  const workflowExecutor = new DagExecutor({
    registry: workflowRegistry,
    runAgent: async (agentId, input) => {
      const agent = await workspace.loader.loadAgent(agentId);
      const stored = await workspace.sessions.create({
        userId: spec.defaultUserId,
        agentName: agentId,
        channel: 'automation',
        messages: [],
        status: 'idle',
        detached: true,
      });
      const session = storedSessionToRuntime(stored);
      const result = await runtime.run(session, agent, { content: input });
      return result.content;
    },
    runBlueprint: async (slug, inputs) => {
      const bp = await catalog.load(slug);
      const executor = new BlueprintExecutor({ catalog, mcpBridge });
      const result = await executor.executeDefinition(bp, inputs);
      return { outputs: result.outputs };
    },
    mcpBridge,
  });
  const blueprintExecutor = new BlueprintExecutor({
    catalog,
    mcpBridge,
    runWorkflow: async (slug, inputs) => {
      const result = await workflowExecutor.run(slug, inputs);
      await eventBus.publishCore(EventSubjects.WORKFLOW_COMPLETED, 'anvio.workflow.completed.v1', {
        workflowId: slug,
        status: result.status,
      });
      return { outputs: result.outputs, status: result.status };
    },
    runAgent: async (agentId, input) => {
      const agent = await workspace.loader.loadAgent(agentId);
      const stored = await workspace.sessions.create({
        userId: spec.defaultUserId,
        agentName: agentId,
        channel: 'automation',
        messages: [],
        status: 'idle',
        detached: true,
      });
      const session = storedSessionToRuntime(stored);
      const result = await runtime.run(session, agent, { content: input });
      return result.content;
    },
  });

  const actionExecutor = new ActionExecutor({
    blueprintExecutor,
    runAgent: async (agentId, input) => {
      const agent = await workspace.loader.loadAgent(agentId);
      const stored = await workspace.sessions.create({
        userId: spec.defaultUserId,
        agentName: agentId,
        channel: 'automation',
        messages: [],
        status: 'idle',
        detached: true,
      });
      const session = storedSessionToRuntime(stored);
      const result = await runtime.run(session, agent, { content: input });
      return result.content;
    },
    summarizeSessions: async () => {
      const sessions = await workspace.sessions.list(spec.defaultUserId);
      return learningEngine.summarizeStaleSessions(
        sessions.map((s) => ({
          id: s.id,
          userId: s.userId,
          messages: s.messages,
          status: s.status,
        })),
      );
    },
  });

  const automationEngine = createAutomationEngine({
    storage: workspace.storage,
    actionExecutor,
    userId: spec.defaultUserId,
    eventBus: {
      subscribeCore: (subject, handler) => eventBus.subscribeCore(subject as typeof EventSubjects.SESSION_STARTED, handler),
      publish: (subject, type, data) => eventBus.publish(subject as typeof EventSubjects.SESSION_STARTED, type, data),
    },
  });

  const hookEngine = createHookEngine(workspacePath, eventBus);
  await hookEngine.start();
  await automationEngine.start();

  const tokenUsageAudit = createTokenUsageAudit(workspace.storage);

  await eventBus.subscribeCore(EventSubjects.AGENT_RUN_COMPLETED, async (event) => {
    const data = event.data as {
      sessionId: string;
      content?: string;
      channel?: string;
      usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
    };
    const stored = await workspace.sessions.get(data.sessionId);
    if (!stored) return;

    if (data.usage && data.usage.totalTokens > 0) {
      let model: string | undefined;
      try {
        const agent = await workspace.loader.loadAgent(stored.agentName);
        model = agent.spec.model.model;
      } catch {
        model = undefined;
      }
      await tokenUsageAudit.record({
        sessionId: stored.id,
        channel: data.channel ?? stored.channel,
        agentId: stored.agentName,
        userId: stored.userId,
        provider: modelProvider.providerId,
        model,
        usage: data.usage,
      });
    }

    const soulSlug = spec.defaultSoul;
    let soul;
    if (soulSlug) {
      try {
        soul = await soulService.get(soulSlug);
      } catch {
        soul = undefined;
      }
    }
    await learningEngine.onSessionCompleted({
      sessionId: stored.id,
      userId: stored.userId,
      agentId: stored.agentName,
      messages: stored.messages,
      soul,
    });
  });

  return {
    workspace,
    auth,
    runtime,
    eventBus,
    modelProvider,
    modelProviders,
    channelHub,
    inbox,
    whatsapp,
    blueprintExecutor,
    automationEngine,
    hookEngine,
    harness,
    learningEngine,
    toolGateway,
    mcpFirstCallGate,
  };
}

function createMockModelProvider(): ModelProvider {
  return {
    providerId: 'mock',
    async chat(request) {
      const last = request.messages.at(-1)?.content ?? '';
      return {
        content: `[Mock — set a model API key] You said: ${last}`,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'mock',
        finishReason: 'end_turn',
      };
    },
    async *stream(request) {
      const last = request.messages.at(-1)?.content ?? '';
      const text = `[Mock — set a model API key] You said: ${last}`;
      yield { type: 'text_delta', delta: text };
      yield {
        type: 'done',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      };
    },
  };
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

export async function loadAgent(workspace: Workspace, name: string): Promise<AgentDefinition> {
  return workspace.loader.loadAgent(name);
}

export type { ChannelHubPort, AgentInbox, WhatsAppChannel };
export { findRepoRoot, findWorkspacePath } from './find-workspace.js';
export { publishAgentRunCompleted, finalizeAgentRun } from './agent-run.js';
export {
  createTokenUsageAudit,
  estimateTokenCostUsd,
  TokenUsageAudit,
} from './token-usage-audit.js';
