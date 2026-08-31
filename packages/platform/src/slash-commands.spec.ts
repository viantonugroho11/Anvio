import { describe, it, expect } from 'vitest';
import type { ConfigLoader, SessionStore, StoredSession } from '@anvio/core';
import { createSlashCommandRegistry } from './slash-commands.js';

function fakeLoader(agents: string[], skills: string[] = []): ConfigLoader {
  return {
    async listAgents() {
      return agents;
    },
    async loadAgent(name) {
      return {
        apiVersion: 'anvio.io/v1',
        kind: 'Agent',
        metadata: { name, version: '1.0.0' },
        spec: {
          description: `agent ${name}`,
          persona: 'p',
          skills: [],
          tools: [],
          model: { provider: 'anthropic', model: 'sonnet', maxTokens: 8192 },
        },
      };
    },
    async loadSkill(slug) {
      return {
        apiVersion: 'anvio.io/v1',
        kind: 'Skill',
        metadata: { slug, version: '0.1.0', catalog: 'private' },
        spec: {
          name: slug,
          description: `skill ${slug}`,
          instructions: 'do',
          permissions: [],
          toolRequirements: [],
          contextRequirements: [],
          tags: [],
        },
      };
    },
    async listSkills() {
      return skills;
    },
    async loadPersona() {
      throw new Error('not used');
    },
    async listPersonas() {
      return [];
    },
  } as unknown as ConfigLoader;
}

function fakeSessions(initial?: Partial<StoredSession>): SessionStore {
  let stored: Partial<StoredSession> = { id: 's1', agentName: 'architect', ...initial };
  return {
    async get() {
      return stored as StoredSession;
    },
    async update(_id, patch) {
      stored = { ...stored, ...patch };
      return stored as StoredSession;
    },
    async create(input) {
      stored = input as StoredSession;
      return stored as StoredSession;
    },
    async list() {
      return [];
    },
  } as unknown as SessionStore;
}

const baseCtx = {
  channel: 'telegram',
  sessionId: 's1',
  userId: 'u1',
  threadId: 't1',
  isDm: true,
  argsRaw: '',
  argsList: [] as string[],
};

describe('SlashCommandRegistry', () => {
  it('list() exposes all built-in commands', () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['architect']),
      sessions: fakeSessions(),
      defaultAgent: 'architect',
      workspacePath: '/tmp',
    });
    const names = reg.list().map((c) => c.name);
    expect(names).toEqual(
      expect.arrayContaining(['help', 'whoami', 'agents', 'agent', 'skills', 'reset']),
    );
  });

  it('/help lists available commands', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['architect']),
      sessions: fakeSessions(),
      defaultAgent: 'architect',
      workspacePath: '/tmp',
    });
    const result = await reg.dispatch('/help', baseCtx);
    expect(result?.swallow).toBe(true);
    expect(result?.reply).toContain('/help');
    expect(result?.reply).toContain('/whoami');
  });

  it('/agent <slug> validates against catalog and returns update', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['architect', 'techlead']),
      sessions: fakeSessions(),
      defaultAgent: 'architect',
      workspacePath: '/tmp',
    });
    const ok = await reg.dispatch('/agent techlead', baseCtx);
    expect(ok?.updateSession).toEqual({ agentName: 'techlead' });
    const bad = await reg.dispatch('/agent unknown', baseCtx);
    expect(bad?.updateSession).toBeUndefined();
    expect(bad?.reply).toMatch(/Unknown agent/);
  });

  it('/reset returns updateSession.reset', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['a']),
      sessions: fakeSessions(),
      defaultAgent: 'a',
      workspacePath: '/tmp',
    });
    const r = await reg.dispatch('/reset', baseCtx);
    expect(r?.updateSession).toEqual({ reset: true });
  });

  it('unknown command returns null so the caller can fall through', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['a']),
      sessions: fakeSessions(),
      defaultAgent: 'a',
      workspacePath: '/tmp',
    });
    const r = await reg.dispatch('/nope', baseCtx);
    expect(r).toBeNull();
  });

  it('strips the @botname suffix so `/help@mybot` still matches', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['a']),
      sessions: fakeSessions(),
      defaultAgent: 'a',
      workspacePath: '/tmp',
    });
    const r = await reg.dispatch('/help@mybot', baseCtx);
    expect(r?.swallow).toBe(true);
  });

  it('non-slash input dispatches to null', async () => {
    const reg = createSlashCommandRegistry({
      loader: fakeLoader(['a']),
      sessions: fakeSessions(),
      defaultAgent: 'a',
      workspacePath: '/tmp',
    });
    const r = await reg.dispatch('hello', baseCtx);
    expect(r).toBeNull();
  });
});
