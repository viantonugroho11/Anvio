import { describe, expect, it } from 'vitest';
import { LearningEngine } from '@anvio/learning';
import { ToolGateway } from '@anvio/tools';
import { KnowledgeBaseStore, KnowledgeIngestEngine } from '@anvio/knowledge';
import { createMemoryProvider } from '@anvio/memory';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace } from '@anvio/workspace';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

describe('Phase H — Learning, Tools, Knowledge', () => {
  it('memory nudge stores user preference facts', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-h-'));
    await Workspace.init(tmp);
    const ws = await Workspace.open(tmp);
    const memory = createMemoryProvider('filesystem', ws.storage);
    const engine = new LearningEngine(memory, tmp);

    const result = await engine.onSessionCompleted({
      sessionId: 's1',
      userId: 'local-user',
      agentId: 'architect',
      messages: [
        { role: 'user', content: 'Remember that user prefers architecture diagrams in reviews' },
        { role: 'assistant', content: 'I will include diagrams in architecture reviews.' },
      ],
    });

    expect(result.memoryNudge.factsStored).toBeGreaterThan(0);
    expect(result.skillDraft?.slug).toBeDefined();
  });

  it('tool gateway lists and runs web_fetch', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-h-tools-'));
    await Workspace.init(tmp);
    const gateway = await ToolGateway.load(tmp);
    expect(gateway.listTools()).toContain('anvio_tools__web_fetch');
    const result = await gateway.call({
      name: 'anvio_tools__web_fetch',
      arguments: { url: 'https://example.com' },
    });
    expect(result.status).toBe('completed');
  });

  it('knowledge ingest synthesizes wiki from raw', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-h-kb-'));
    await Workspace.init(tmp);
    const store = new KnowledgeBaseStore(tmp);
    await store.appendRaw('playbook', 'note.md', '# Deployment\n\nAlways run tests first.');
    const ingest = new KnowledgeIngestEngine(store);
    const result = await ingest.ingest('playbook');
    expect(result.rawCount).toBe(1);
    expect(result.wikiFiles).toHaveLength(1);
    const wiki = await fs.readFile(path.join(store.wikiDir('playbook'), result.wikiFiles[0]!), 'utf-8');
    expect(wiki).toContain('Deployment');
  });

  it('honcho provider delegates to filesystem', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-honcho-'));
    const storage = new FilesystemStorageProvider(tmp);
    const provider = createMemoryProvider('honcho', storage);
    expect(provider.providerId).toBe('honcho');
    const health = await provider.healthCheck();
    expect(health.ok).toBe(true);
  });
});
