import { describe, it, expect } from 'vitest';
import { parseAgentMd, parseWorkspaceDefinition } from '@anvio/core';
import { FilesystemStorageProvider } from '@anvio/storage';
import { Workspace, WorkspaceConfigLoader } from '@anvio/workspace';
import { createAuthProvider } from '@anvio/auth';
import { createMemoryStore } from '@anvio/memory';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '../..');

describe('Local-First Architecture', () => {
  it('parses workspace config with auth disabled by default', () => {
    const config = parseWorkspaceDefinition({
      apiVersion: 'anvio.io/v1',
      kind: 'Workspace',
      metadata: { name: 'test' },
      spec: {},
    });
    expect(config.spec.auth.enabled).toBe(false);
    expect(config.spec.storage.provider).toBe('filesystem');
    expect(config.spec.memory.provider).toBe('filesystem');
    expect(config.spec.events.provider).toBe('local');
  });

  it('NoAuthProvider allows immediate access', async () => {
    const auth = createAuthProvider({ enabled: false, provider: 'none' });
    const ctx = await auth.authenticate();
    expect(ctx?.userId).toBe('local-user');
    expect(auth.enabled).toBe(false);
  });

  it('loads architect agent from workspace/', () => {
    const configPath = path.join(root, 'workspace/agents/architect.md');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const agent = parseAgentMd(raw, 'architect');
    expect(agent.metadata.name).toBe('architect');
  });

  it('filesystem storage reads and writes', async () => {
    const tmpDir = path.join(root, 'workspace');
    const storage = new FilesystemStorageProvider(tmpDir);
    await storage.write('memory/test-write.json', '{"ok":true}');
    const data = await storage.read('memory/test-write.json');
    expect(data).toBe('{"ok":true}');
    await storage.delete('memory/test-write.json');
  });

  it('filesystem memory store persists conversation', async () => {
    const storage = new FilesystemStorageProvider(path.join(root, 'workspace'));
    const memory = createMemoryStore('filesystem', storage);
    await memory.storeConversation('test-session', 'local-user', [
      { role: 'user', content: 'hello' },
    ]);
    const ctx = await memory.getContext('test-session', 'local-user');
    expect(ctx.shortTerm).toHaveLength(1);
    expect(ctx.shortTerm[0].content).toBe('hello');
    await storage.delete('memory/sessions/test-session.json');
  });
});

describe('Production Readiness Checklist', () => {
  const checklist = [
    'workspace/anvio.yaml',
    'workspace/agents/architect.md',
    'workspace/skills/architecture.md',
    'workspace/souls/architect-soul/SOUL.md',
    'packages/storage/src/filesystem.ts',
    'packages/workspace/src/index.ts',
    'packages/auth/src/index.ts',
    'packages/platform/src/index.ts',
    'apps/cli/src/main.ts',
    'packages/memory/src/filesystem-memory.ts',
    'docs/02-architecture.md',
  ];

  for (const file of checklist) {
    it(`has required file: ${file}`, () => {
      expect(fs.existsSync(path.join(root, file))).toBe(true);
    });
  }
});
