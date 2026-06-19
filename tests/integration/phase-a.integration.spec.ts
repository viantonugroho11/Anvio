import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseSoulDefinition, parseGoalDefinition } from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import { createSoulService } from '@anvio/souls';
import { createGoalEngine } from '@anvio/goals';
import { createMemoryProvider } from '@anvio/memory';

describe('Phase A — Advanced Agent OS Foundation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-phase-a-'));
    await Workspace.init(tmpDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('initializes workspace with Advanced OS directories', async () => {
    for (const dir of ['souls', 'goals', 'automations', 'blueprints', 'kanban', 'hooks']) {
      const stat = await fs.stat(path.join(tmpDir, dir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  it('creates and loads a soul with context assembly', async () => {
    const storage = new FilesystemStorageProvider(tmpDir);
    const memory = createMemoryProvider('filesystem', storage);
    const souls = createSoulService(storage, memory);

    await souls.create(
      parseSoulDefinition({
        apiVersion: 'anvio.io/v1',
        kind: 'Soul',
        metadata: { slug: 'architect-soul', version: '1.0.0' },
        spec: {
          name: 'Architect Soul',
          identity: { role: 'Senior Software Architect' },
          values: ['simplicity', 'maintainability'],
          personality: ['thoughtful', 'structured'],
          preferences: { conversation: 'professional' },
          longTermGoals: ['help build maintainable systems'],
          behavioralTendencies: ['consider tradeoffs before recommending'],
        },
      }),
    );

    await memory.store({
      sessionId: 's1',
      userId: 'local-user',
      type: 'fact',
      content: 'User prefers architecture diagrams in reviews',
    });

    const context = await souls.loadContext('architect-soul', 'local-user');
    expect(context.name).toBe('Architect Soul');
    expect(context.values).toContain('simplicity');
    expect(context.relationshipFacts.some((f) => f.content.includes('diagrams'))).toBe(true);

    const rendered = souls.renderSoulContext(context);
    expect(rendered).toContain('Architect Soul');
    expect(rendered).toContain('simplicity');
  });

  it('manages goal lifecycle on filesystem', async () => {
    const storage = new FilesystemStorageProvider(tmpDir);
    const goals = createGoalEngine(storage);

    const created = await goals.create({
      slug: 'learn-golang',
      spec: { title: 'Learn Golang', description: 'Master Go basics' },
    });
    expect(created.spec.status).toBe('active');

    const updated = await goals.updateProgress('learn-golang', { percent: 40 });
    expect(updated.spec.progress.percent).toBe(40);

    await goals.pause('learn-golang');
    const paused = await goals.get('learn-golang');
    expect(paused?.spec.status).toBe('paused');

    await goals.resume('learn-golang');
    const resumed = await goals.get('learn-golang');
    expect(resumed?.spec.status).toBe('active');

    const completed = await goals.complete('learn-golang');
    expect(completed.spec.status).toBe('completed');
    expect(completed.spec.progress.percent).toBe(100);
  });

  it('memory provider health check passes for filesystem', async () => {
    const storage = new FilesystemStorageProvider(tmpDir);
    const memory = createMemoryProvider('filesystem', storage);
    const health = await memory.healthCheck();
    expect(health.ok).toBe(true);

    await memory.storeConversation('sess-1', 'local-user', [{ role: 'user', content: 'hi' }]);
    const ctx = await memory.getContext('sess-1', 'local-user');
    expect(ctx.shortTerm[0].content).toBe('hi');
  });

  it('parses goal definition schema', () => {
    const goal = parseGoalDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Goal',
      metadata: { slug: 'project-refactor' },
      spec: { title: 'Finish refactor', status: 'active', priority: 'high' },
    });
    expect(goal.metadata.slug).toBe('project-refactor');
    expect(goal.spec.priority).toBe('high');
  });
});
