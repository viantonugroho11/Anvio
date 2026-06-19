import { ActionExecutor, createAutomationEngine, type AutomationEngine } from '@anvio/automation';
import { BlueprintExecutor, createCatalogRegistry } from '@anvio/blueprints';
import { createHookEngine, type HookEngine } from '@anvio/hooks';
import { DefaultAgentRuntime } from '@anvio/agents';
import { createChannelHub, FilesystemAgentInbox, type WhatsAppChannel } from '@anvio/channels';
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
import { createModelProvider } from '@anvio/models';
import { PersonaService } from '@anvio/personas';
import { createSoulService } from '@anvio/souls';
import { SkillRegistry } from '@anvio/skills';
import { Workspace } from '@anvio/workspace';
import { findRepoRoot, findWorkspacePath } from './find-workspace.js';

export interface PlatformContext {
  workspace: Workspace;
  auth: AuthProvider;
  runtime: DefaultAgentRuntime;
  eventBus: EventBusLike;
  modelProvider: ModelProvider;
  channelHub: ChannelHubPort;
  inbox: AgentInbox;
  whatsapp?: WhatsAppChannel;
  blueprintExecutor: BlueprintExecutor;
  automationEngine: AutomationEngine;
  hookEngine: HookEngine;
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

  const memoryProvider = createMemoryProvider(spec.memory.provider, workspace.storage);
  const personaService = new PersonaService(workspace.loader);
  const skillRegistry = new SkillRegistry(workspace.loader);
  const soulService = createSoulService(workspace.storage, memoryProvider);

  const apiKey = options.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const modelProvider = apiKey
    ? createModelProvider('anthropic', apiKey)
    : createMockModelProvider();

  const eventBus = await createEventBus(spec.events.provider, {
    url: spec.events.url ?? process.env.NATS_URL,
    source: '/anvio/platform',
  });

  const inbox = new FilesystemAgentInbox(workspace.storage);

  const { hub: channelHub, whatsapp } = createChannelHub({
    sessions: workspace.sessions,
    eventBus,
    defaultAgent,
    defaultUserId: spec.defaultUserId,
    channels: spec.channels,
  });

  const runtime = new DefaultAgentRuntime({
    personaService,
    skillRegistry,
    memoryStore: memoryProvider,
    soulService,
    modelProvider,
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

  const repoRoot = findRepoRoot(workspacePath);
  const catalog = createCatalogRegistry(workspacePath, repoRoot);
  const blueprintExecutor = new BlueprintExecutor({
    catalog,
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

  return {
    workspace,
    auth,
    runtime,
    eventBus,
    modelProvider,
    channelHub,
    inbox,
    whatsapp,
    blueprintExecutor,
    automationEngine,
    hookEngine,
  };
}

function createMockModelProvider(): ModelProvider {
  return {
    providerId: 'mock',
    async chat(request) {
      const last = request.messages.at(-1)?.content ?? '';
      return {
        content: `[Mock — set ANTHROPIC_API_KEY] You said: ${last}`,
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        model: 'mock',
        finishReason: 'end_turn',
      };
    },
    async *stream(request) {
      const last = request.messages.at(-1)?.content ?? '';
      const text = `[Mock — set ANTHROPIC_API_KEY] You said: ${last}`;
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
}): Session {
  return {
    id: session.id,
    userId: session.userId,
    agentId: session.agentName,
    channel: session.channel,
    state: { status: session.status, messages: session.messages },
    lastActiveAt: new Date(session.lastActiveAt),
  };
}

export async function loadAgent(workspace: Workspace, name: string): Promise<AgentDefinition> {
  return workspace.loader.loadAgent(name);
}

export type { ChannelHubPort, AgentInbox, WhatsAppChannel };
export { findRepoRoot, findWorkspacePath } from './find-workspace.js';
