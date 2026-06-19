import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  parseAgentDefinition,
  parsePersonaDefinition,
  parseSkillDefinition,
  parseWorkspaceDefinition,
  type AgentDefinition,
  type ConfigLoader,
  type PersonaProfile,
  type SkillDefinition,
  type StoredSession,
  type SessionStore,
  type WorkspaceDefinition,
  type ArtifactStore,
  type CreateArtifactInput,
  type AgentArtifact,
  type AgentRunStatus,
  personaProfileSchema,
} from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { v4 as uuidv4 } from 'uuid';
import { createWorktreeManager } from './git-worktree-manager.js';
import type { WorktreeManager } from '@anvio/core';

export const WORKSPACE_DIRS = [
  'agents',
  'souls',
  'personas',
  'skills',
  'goals',
  'sessions',
  'memory',
  'workflows',
  'automations',
  'blueprints',
  'kanban',
  'hooks',
  'credentials',
  'providers',
  'batch',
  'audit',
  'tools',
  'mcp',
  'artifacts',
  'worktrees',
  'inbox',
] as const;

export class Workspace {
  readonly rootDir: string;
  readonly config: WorkspaceDefinition;
  readonly storage: FilesystemStorageProvider;
  readonly loader: WorkspaceConfigLoader;
  readonly sessions: FilesystemSessionStore;
  readonly artifacts: FilesystemArtifactStore;
  readonly worktrees: WorktreeManager | null;

  private constructor(rootDir: string, config: WorkspaceDefinition) {
    this.rootDir = rootDir;
    this.config = config;
    this.storage = new FilesystemStorageProvider(rootDir);
    this.loader = new WorkspaceConfigLoader(this.storage);
    this.sessions = new FilesystemSessionStore(this.storage);
    this.artifacts = new FilesystemArtifactStore(this.storage);
    this.worktrees = createWorktreeManager(rootDir, config.spec.worktrees);
  }

  static async open(rootDir: string): Promise<Workspace> {
    const configPath = path.join(rootDir, 'anvio.yaml');
    let config: WorkspaceDefinition;
    try {
      const raw = parseYaml(await fs.readFile(configPath, 'utf-8'));
      config = parseWorkspaceDefinition(raw);
    } catch {
      config = parseWorkspaceDefinition({
        apiVersion: 'anvio.io/v1',
        kind: 'Workspace',
        metadata: { name: 'default' },
        spec: {},
      });
    }
    return new Workspace(rootDir, config);
  }

  static async init(rootDir: string): Promise<Workspace> {
    for (const dir of WORKSPACE_DIRS) {
      await fs.mkdir(path.join(rootDir, dir), { recursive: true });
    }
    await fs.mkdir(path.join(rootDir, 'automations', '_state'), { recursive: true });
    await fs.mkdir(path.join(rootDir, 'memory', 'sessions'), { recursive: true });
    await fs.writeFile(path.join(rootDir, 'anvio.yaml'), defaultAnvioYaml(), 'utf-8');
    return Workspace.open(rootDir);
  }
}

function defaultAnvioYaml(): string {
  return `# Anvio Workspace Configuration
apiVersion: anvio.io/v1
kind: Workspace
metadata:
  name: default
  version: "1.0.0"
spec:
  auth:
    enabled: false
  storage:
    provider: filesystem
    basePath: .
  memory:
    provider: filesystem
    basePath: memory
  events:
    provider: local
  # channels:
  #   telegram:
  #     enabled: true
  #   discord:
  #     enabled: true
  #   slack:
  #     enabled: true
  #     # SLACK_BOT_TOKEN + SLACK_APP_TOKEN (Socket Mode)
  #   whatsapp:
  #     enabled: true
  #     # WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_VERIFY_TOKEN
  #     # Webhook: POST /api/channels/whatsapp/webhook
  worktrees:
    enabled: false
    repoPath: ..
  defaultAgent: architect
  defaultUserId: local-user
`;
}

export class WorkspaceConfigLoader implements ConfigLoader {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  async listAgents(): Promise<string[]> {
    const files = await this.storage.list('agents');
    return files
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => path.basename(f, path.extname(f)));
  }

  async loadAgent(name: string): Promise<AgentDefinition> {
    const yaml = await this.readYaml(`agents/${name}.yaml`, `agents/${name}.yml`);
    return parseAgentDefinition(yaml);
  }

  async loadPersona(slug: string): Promise<PersonaProfile> {
    const yaml = await this.readYaml(`personas/${slug}.yaml`, `personas/${slug}.yml`);
    const def = parsePersonaDefinition(yaml);
    return personaProfileSchema.parse(def.spec);
  }

  async loadSkill(slug: string): Promise<SkillDefinition> {
    const yaml = await this.readYaml(`skills/${slug}.yaml`, `skills/${slug}.yml`);
    return parseSkillDefinition(yaml);
  }

  async listSkills(): Promise<string[]> {
    const files = await this.storage.list('skills');
    return files
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => path.basename(f, path.extname(f)));
  }

  async listPersonas(): Promise<string[]> {
    const files = await this.storage.list('personas');
    return files
      .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
      .map((f) => path.basename(f, path.extname(f)));
  }

  private async readYaml(...candidates: string[]): Promise<unknown> {
    for (const key of candidates) {
      const raw = await this.storage.read(key);
      if (raw) return parseYaml(raw);
    }
    throw new Error(`Config not found: ${candidates.join(' or ')}`);
  }
}

export class FilesystemSessionStore implements SessionStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  private key(id: string): string {
    return `sessions/${id}.json`;
  }

  async create(
    session: Omit<StoredSession, 'id' | 'createdAt' | 'lastActiveAt'>,
  ): Promise<StoredSession> {
    const now = new Date().toISOString();
    const stored: StoredSession = {
      ...session,
      id: uuidv4(),
      createdAt: now,
      lastActiveAt: now,
    };
    await this.storage.writeJson(this.key(stored.id), stored);
    return stored;
  }

  async get(id: string): Promise<StoredSession | null> {
    return this.storage.readJson<StoredSession>(this.key(id));
  }

  async update(id: string, patch: Partial<StoredSession>): Promise<StoredSession | null> {
    const existing = await this.get(id);
    if (!existing) return null;
    const updated: StoredSession = {
      ...existing,
      ...patch,
      lastActiveAt: new Date().toISOString(),
    };
    await this.storage.writeJson(this.key(id), updated);
    return updated;
  }

  async list(userId?: string): Promise<StoredSession[]> {
    const files = await this.storage.list('sessions');
    const sessions: StoredSession[] = [];
    for (const file of files.filter((f) => f.endsWith('.json'))) {
      const s = await this.storage.readJson<StoredSession>(file);
      if (s && (!userId || s.userId === userId)) sessions.push(s);
    }
    return sessions;
  }

  async getByChannelThread(channel: string, threadId: string): Promise<StoredSession | null> {
    const sessions = await this.list();
    return (
      sessions.find((s) => s.channelThread?.channel === channel && s.channelThread?.threadId === threadId) ??
      null
    );
  }

  async listActive(userId?: string): Promise<StoredSession[]> {
    const active: AgentRunStatus[] = [
      'assembling_context',
      'calling_model',
      'tool_executing',
      'awaiting_approval',
      'storing_memory',
    ];
    const sessions = await this.list(userId);
    return sessions.filter((s) => active.includes(s.status));
  }
}

export class FilesystemArtifactStore implements ArtifactStore {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  private indexKey(id: string): string {
    return `artifacts/${id}.json`;
  }

  async create(input: CreateArtifactInput): Promise<AgentArtifact> {
    const id = uuidv4();
    const filename = `${id}.md`;
    const path = `artifacts/${input.sessionId}/${filename}`;
    await this.storage.write(path, input.content);
    const artifact: AgentArtifact = {
      id,
      sessionId: input.sessionId,
      agentId: input.agentId,
      kind: input.kind,
      title: input.title,
      path,
      createdAt: new Date().toISOString(),
      metadata: input.metadata,
    };
    await this.storage.writeJson(this.indexKey(id), artifact);
    return artifact;
  }

  async get(id: string): Promise<AgentArtifact | null> {
    return this.storage.readJson<AgentArtifact>(this.indexKey(id));
  }

  async list(sessionId?: string): Promise<AgentArtifact[]> {
    const files = await this.storage.list('artifacts');
    const artifacts: AgentArtifact[] = [];
    for (const file of files.filter((f) => f.endsWith('.json') && !f.includes('/'))) {
      const a = await this.storage.readJson<AgentArtifact>(file);
      if (a && (!sessionId || a.sessionId === sessionId)) artifacts.push(a);
    }
    return artifacts;
  }
}

export { createWorktreeManager, GitWorktreeManager } from './git-worktree-manager.js';
