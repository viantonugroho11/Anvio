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
import { createMemoryStore } from '@anvio/memory';
import { createModelProvider } from '@anvio/models';
import { PersonaService } from '@anvio/personas';
import { SkillRegistry } from '@anvio/skills';
import { Workspace } from '@anvio/workspace';
import { findWorkspacePath } from './find-workspace.js';

export interface PlatformContext {
  workspace: Workspace;
  auth: AuthProvider;
  runtime: DefaultAgentRuntime;
  eventBus: EventBusLike;
  modelProvider: ModelProvider;
  channelHub: ChannelHubPort;
  inbox: AgentInbox;
  whatsapp?: WhatsAppChannel;
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

  const memoryStore = createMemoryStore(spec.memory.provider, workspace.storage);
  const personaService = new PersonaService(workspace.loader);
  const skillRegistry = new SkillRegistry(workspace.loader);

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
    memoryStore,
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

  return { workspace, auth, runtime, eventBus, modelProvider, channelHub, inbox, whatsapp };
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
