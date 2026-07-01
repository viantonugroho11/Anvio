import type { AgentDefinition } from '../schemas/agent.schema.js';
import type { AgentRunStatus, TokenUsage } from '../types/common.js';
import type { AgentStreamEvent, Session, UserInput } from './agent-runtime.port.js';

export type RuntimeProviderId =
  | 'local'
  | 'cursor'
  | 'claude-code'
  | 'codex'
  | 'ssh'
  | 'docker'
  | 'daytona'
  | 'modal';

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
  resolveClaudeCodeOAuthToken?: (input: {
    userId: string;
    channel: string;
    threadId: string;
  }) => Promise<string | null>;
  codexBinary?: string;
  sshHost?: string;
  sshUser?: string;
  dockerImage?: string;
  daytonaApiKey?: string;
  modalTokenId?: string;
  modalTokenSecret?: string;
}

export interface AgentRuntimeBinding {
  provider?: RuntimeProviderId;
  fallback?: RuntimeProviderId;
}
