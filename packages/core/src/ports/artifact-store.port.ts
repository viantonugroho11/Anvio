import type { AgentArtifact, ArtifactKind } from '../types/channel.js';

export interface CreateArtifactInput {
  sessionId: string;
  agentId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface ArtifactStore {
  create(input: CreateArtifactInput): Promise<AgentArtifact>;
  get(id: string): Promise<AgentArtifact | null>;
  list(sessionId?: string): Promise<AgentArtifact[]>;
}
