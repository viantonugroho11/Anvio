import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SkillEvolutionWriter } from './skill-evolution.js';

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'anvio-skill-'));
}

describe('SkillEvolutionWriter draft lifecycle', () => {
  let draftsDir: string;
  let writer: SkillEvolutionWriter;

  beforeEach(async () => {
    draftsDir = await tempDir();
    writer = new SkillEvolutionWriter(draftsDir);
  });

  it('proposeDraft emits lineage under source: key', async () => {
    const { path: p } = await writer.proposeDraft({
      slug: 'tech-lead',
      sessionId: 'sess-abcdefgh',
      agentId: 'tech-lead',
      topic: 'x',
      instructions: 'do',
      sourceExcerpt: 'ex',
      sourceChannel: 'telegram',
      sourceUserId: 'telegram:42',
      sourceMessages: 6,
    });
    const raw = await fs.readFile(p, 'utf-8');
    expect(raw).toContain('source:');
    expect(raw).toContain('sessionId: sess-abcdefgh');
    expect(raw).toContain('agentId: tech-lead');
    expect(raw).toContain('channel: telegram');
    expect(raw).toContain('userId: telegram:42');
    expect(raw).toContain('messages: 6');
    expect(raw).toMatch(/capturedAt: \d{4}-\d{2}-\d{2}T/);
  });

  it('slug includes sessionShort and timestamp', async () => {
    const { path: p } = await writer.proposeDraft({
      slug: 'ag',
      sessionId: 'session_1234567890',
      agentId: 'ag',
      topic: 'x',
      instructions: 'i',
      sourceExcerpt: 'e',
    });
    expect(path.basename(p)).toMatch(/^ag-session_-\d+\.md$/);
  });

  it('discardDraft moves the file to _discarded/', async () => {
    const { path: p } = await writer.proposeDraft({
      slug: 'x',
      sessionId: 'abcdefgh',
      agentId: 'x',
      topic: 'x',
      instructions: 'x',
      sourceExcerpt: 'x',
    });
    const slug = path.basename(p, '.md');
    const result = await writer.discardDraft(slug);
    expect(result).not.toBeNull();
    expect(result?.path).toContain('_discarded');
    await expect(fs.access(p)).rejects.toThrow();
    await expect(fs.access(result!.path)).resolves.toBeUndefined();
    // Discarded drafts don't reappear in listDrafts.
    const remaining = await writer.listDrafts();
    expect(remaining).toEqual([]);
  });

  it('getDraft returns the raw content', async () => {
    const { path: p } = await writer.proposeDraft({
      slug: 'x',
      sessionId: 'sess1234',
      agentId: 'x',
      topic: 'x',
      instructions: 'body',
      sourceExcerpt: 'e',
    });
    const slug = path.basename(p, '.md');
    const draft = await writer.getDraft(slug);
    expect(draft?.content).toContain('body');
  });

  it('pruneDrafts removes files older than the threshold', async () => {
    const { path: oldP } = await writer.proposeDraft({
      slug: 'old',
      sessionId: 'aaaaaaaa',
      agentId: 'old',
      topic: 'x',
      instructions: 'x',
      sourceExcerpt: 'x',
    });
    // Backdate the mtime — 10 days old
    const backdate = new Date(Date.now() - 10 * 86_400_000);
    await fs.utimes(oldP, backdate, backdate);

    await writer.proposeDraft({
      slug: 'new',
      sessionId: 'bbbbbbbb',
      agentId: 'new',
      topic: 'x',
      instructions: 'x',
      sourceExcerpt: 'x',
    });

    const removed = await writer.pruneDrafts(7 * 86_400_000);
    expect(removed).toEqual([oldP]);
    const left = await writer.listDrafts();
    expect(left.some((f) => f.startsWith('new-'))).toBe(true);
    expect(left.some((f) => f.startsWith('old-'))).toBe(false);
  });

  it('promoteDraft refuses to overwrite when content differs; --force applies', async () => {
    const targetDir = await tempDir();
    const first = await writer.proposeDraft({
      slug: 'x',
      sessionId: 'sess1',
      agentId: 'x',
      topic: 'first',
      instructions: 'first',
      sourceExcerpt: 'e',
    });
    const firstSlug = path.basename(first.path, '.md');
    const initial = await writer.promoteDraft(firstSlug, targetDir);
    expect(initial.alreadyExisted).toBe(false);

    const second = await writer.proposeDraft({
      slug: 'x',
      sessionId: 'sess2',
      agentId: 'x',
      topic: 'second',
      instructions: 'second',
      sourceExcerpt: 'e',
    });
    const secondSlug = path.basename(second.path, '.md');
    const refused = await writer.promoteDraft(secondSlug, targetDir);
    expect(refused.alreadyExisted).toBe(true);
    expect(refused.diff).toBeDefined();
    expect(refused.diff).toMatch(/[+-]/);

    const forced = await writer.promoteDraft(secondSlug, targetDir, { force: true });
    expect(forced.alreadyExisted).toBe(true);
    expect(forced.diff).toBeUndefined();
    const content = await fs.readFile(forced.path, 'utf-8');
    expect(content).toContain('name: second');
  });
});
