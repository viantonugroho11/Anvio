import type { AgentDefinition } from '../schemas/agent.schema.js';
import type { AgentRunStatus, TokenUsage } from '../types/common.js';
import type { AgentStreamEvent, Session, UserInput } from './agent-runtime.port.js';

export type RuntimeProviderId =
  | 'local'
  | 'cursor'
  | 'claude-code'
  | 'codex'
  | 'antigravity'
  | 'ssh'
  | 'docker'
  | 'daytona'
  | 'modal'
  | 'singularity';

export interface RuntimeConnectionContext {
  userId: string;
  channel: string;
  threadId: string;
}

export type RuntimeConnectionResolver = (
  input: RuntimeConnectionContext & { service: string },
) => Promise<string | null>;

export interface RuntimeCapabilities {
  supportsTools: boolean;
  supportsStreaming: boolean;
  supportsSubagents: boolean;
  supportsMcp: boolean;
  supportedLanguages: string[];
}

export interface RuntimeRequest {
  session: Session;
  agent: AgentDefinition;
  input: UserInput;
}

export interface RuntimeResult {
  sessionId: string;
  content: string;
  usage: TokenUsage;
  status: AgentRunStatus;
  runtimeId: RuntimeProviderId;
}

export type RuntimeStreamEvent = AgentStreamEvent;

export interface RuntimeProvider {
  readonly runtimeId: RuntimeProviderId;
  capabilities(): RuntimeCapabilities;
  isConfigured(): boolean;
  run(request: RuntimeRequest): Promise<RuntimeResult>;
  stream(request: RuntimeRequest): AsyncIterable<RuntimeStreamEvent>;
}

export interface RuntimeFactoryOptions {
  defaultRuntime?: RuntimeProviderId;
  acpEndpoint?: string;
  claudeCodeBinary?: string;
  claudeCodeCwd?: string;
  claudeCodeOAuthToken?: string;
  resolveClaudeCodeOAuthToken?: (input: RuntimeConnectionContext) => Promise<string | null>;
  resolveConnectionPayload?: RuntimeConnectionResolver;
  codexBinary?: string;
  codexCwd?: string;
  antigravityBinary?: string;
  antigravityCwd?: string;
  cursorAgentBinary?: string;
  sshHost?: string;
  sshUser?: string;
  dockerImage?: string;
  daytonaApiKey?: string;
  modalTokenId?: string;
  modalTokenSecret?: string;
  singularityBinary?: string;
  singularityImage?: string;
}

export interface AgentRuntimeBinding {
  provider?: RuntimeProviderId;
  fallback?: RuntimeProviderId;
  fallbacks?: RuntimeProviderId[];
}
