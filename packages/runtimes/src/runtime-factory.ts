import type {
  AgentDefinition,
  AgentRuntime,
  CodeExecutor,
  RuntimeFactoryOptions,
  RuntimeProvider,
  RuntimeProviderId,
} from '@anvio/core';
import { AntigravityRuntimeProvider } from './antigravity/antigravity-runtime.js';
import { ClaudeCodeRuntimeProvider } from './claude-code/claude-code-runtime.js';
import { CodexRuntimeProvider } from './codex/codex-runtime.js';
import { CursorRuntimeProvider } from './cursor/cursor-runtime.js';
import { LocalRuntimeProvider } from './local/local-runtime.js';
import { DockerRuntimeProvider } from './docker/docker-runtime.js';
import { DaytonaRuntimeProvider, ModalRuntimeProvider } from './remote/remote-runtime-stub.js';
import { SshRuntimeProvider } from './ssh/ssh-runtime.js';
import {
  buildAgentRuntimeChain,
  firstConfiguredRuntimeId,
} from './runtime-fallback-chain.js';

export interface RuntimeFactoryDeps {
  agentRuntime: AgentRuntime;
  options?: RuntimeFactoryOptions;
  codeExecutor?: CodeExecutor;
}

export class RuntimeFactory {
  private readonly providers: Map<RuntimeProviderId, RuntimeProvider>;

  constructor(deps: RuntimeFactoryDeps) {
    const opts = deps.options ?? {};
    const resolveConnectionPayload = opts.resolveConnectionPayload;

    this.providers = new Map<RuntimeProviderId, RuntimeProvider>([
      ['local', new LocalRuntimeProvider(deps.agentRuntime)],
      [
        'cursor',
        new CursorRuntimeProvider({
          acpEndpoint: opts.acpEndpoint,
          agentBinary: opts.cursorAgentBinary,
          cwd: opts.claudeCodeCwd,
          resolveConnectionPayload,
        }),
      ],
      [
        'claude-code',
        new ClaudeCodeRuntimeProvider({
          cwd: opts.claudeCodeCwd,
          oauthToken: opts.claudeCodeOAuthToken,
          resolveOAuthToken: opts.resolveClaudeCodeOAuthToken,
        }),
      ],
      [
        'codex',
        new CodexRuntimeProvider({
          binary: opts.codexBinary,
          cwd: opts.codexCwd ?? opts.claudeCodeCwd,
          resolveConnectionPayload,
        }),
      ],
      [
        'antigravity',
        new AntigravityRuntimeProvider({
          binary: opts.antigravityBinary,
          cwd: opts.antigravityCwd ?? opts.claudeCodeCwd,
          resolveConnectionPayload,
        }),
      ],
      ['ssh', new SshRuntimeProvider({ host: opts.sshHost, user: opts.sshUser })],
      ['docker', new DockerRuntimeProvider({ image: opts.dockerImage, codeExecutor: deps.codeExecutor })],
      ['daytona', new DaytonaRuntimeProvider({ apiKey: opts.daytonaApiKey })],
      ['modal', new ModalRuntimeProvider({})],
    ]);
  }

  get(id: RuntimeProviderId): RuntimeProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      return this.providers.get('local')!;
    }
    return provider;
  }

  resolveForAgent(
    agent: AgentDefinition,
    defaultRuntime: RuntimeProviderId = 'local',
  ): RuntimeProvider {
    const chain = buildAgentRuntimeChain(agent, defaultRuntime);
    const selected = firstConfiguredRuntimeId(chain, (id) => this.get(id).isConfigured());
    return this.get(selected);
  }

  resolveChainForAgent(
    agent: AgentDefinition,
    defaultRuntime: RuntimeProviderId = 'local',
  ): RuntimeProviderId[] {
    return buildAgentRuntimeChain(agent, defaultRuntime);
  }

  list(): Array<{ id: RuntimeProviderId; configured: boolean; capabilities: ReturnType<RuntimeProvider['capabilities']> }> {
    return [...this.providers.entries()].map(([id, provider]) => ({
      id,
      configured: provider.isConfigured(),
      capabilities: provider.capabilities(),
    }));
  }
}

export function createRuntimeFactory(deps: RuntimeFactoryDeps): RuntimeFactory {
  return new RuntimeFactory(deps);
}
