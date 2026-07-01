import type {
  AgentDefinition,
  AgentRuntime,
  CodeExecutor,
  RuntimeFactoryOptions,
  RuntimeProvider,
  RuntimeProviderId,
} from '@anvio/core';
import { ClaudeCodeRuntimeProvider } from './claude-code/claude-code-runtime.js';
import { CodexRuntimeProvider } from './codex/codex-runtime.js';
import { CursorRuntimeProvider } from './cursor/cursor-runtime.js';
import { LocalRuntimeProvider } from './local/local-runtime.js';
import { DockerRuntimeProvider } from './docker/docker-runtime.js';
import { DaytonaRuntimeProvider, ModalRuntimeProvider } from './remote/remote-runtime-stub.js';
import { SshRuntimeProvider } from './ssh/ssh-runtime.js';

export interface RuntimeFactoryDeps {
  agentRuntime: AgentRuntime;
  options?: RuntimeFactoryOptions;
  codeExecutor?: CodeExecutor;
}

export class RuntimeFactory {
  private readonly providers: Map<RuntimeProviderId, RuntimeProvider>;

  constructor(deps: RuntimeFactoryDeps) {
    const opts = deps.options ?? {};
    this.providers = new Map<RuntimeProviderId, RuntimeProvider>([
      ['local', new LocalRuntimeProvider(deps.agentRuntime)],
      ['cursor', new CursorRuntimeProvider({ acpEndpoint: opts.acpEndpoint })],
      [
        'claude-code',
        new ClaudeCodeRuntimeProvider({
          cwd: opts.claudeCodeCwd,
          oauthToken: opts.claudeCodeOAuthToken,
          resolveOAuthToken: opts.resolveClaudeCodeOAuthToken,
        }),
      ],
      ['codex', new CodexRuntimeProvider({ binary: opts.codexBinary })],
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
    const preferred = agent.spec.runtime?.provider ?? defaultRuntime;
    const fallback = agent.spec.runtime?.fallback ?? 'local';
    const primary = this.get(preferred);
    if (primary.isConfigured()) return primary;
    return this.get(fallback);
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
