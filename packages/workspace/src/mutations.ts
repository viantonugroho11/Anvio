// Workspace mutation surface — ADR-0025.
//
// Every `/new`, `/edit`, `/rm` mutation from chat funnels through these
// helpers. Writes are append-only to the audit log so the operator can
// reconstruct what happened, and deletions go through `moveToTrash` from
// ./trash.ts rather than `fs.unlink` — pruning is the ONLY hard delete.
//
// This module owns three things:
//   1. Per-primitive filename resolution (agents/*.md, workflows/*.yaml, …)
//   2. Scaffold templates for `/new`
//   3. Audit-log append (`workspace/audit/mutations.jsonl`)

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { moveToTrash, type TrashablePrimitive, type MoveToTrashResult } from './trash.js';

export type MutationAction = 'new' | 'edit' | 'rm' | 'restore';

export interface MutationAuditRecord {
  ts: string;
  actor: string;
  primitive: TrashablePrimitive;
  slug: string;
  action: MutationAction;
  hashBefore?: string;
  hashAfter?: string;
  /** Approval request id (or confirm token) that authorized the mutation. */
  approvalId?: string;
  /** Channel + session where the mutation originated. */
  channel?: string;
  sessionId?: string;
  reason?: string;
}

const PLURAL: Record<TrashablePrimitive, string> = {
  agent: 'agents',
  persona: 'personas',
  soul: 'souls',
  skill: 'skills',
  workflow: 'workflows',
  goal: 'goals',
  blueprint: 'blueprints',
  automation: 'automations',
  hook: 'hooks',
  mcp: 'mcp',
  knowledge: 'knowledge',
};

const DEFAULT_EXT: Record<TrashablePrimitive, string> = {
  agent: '.md',
  persona: '.md',
  soul: '.md',
  skill: '.md',
  workflow: '.yaml',
  goal: '.yaml',
  blueprint: '.yaml',
  automation: '.yaml',
  hook: '.yaml',
  mcp: '.yaml',
  knowledge: '.md',
};

export function primitiveDir(primitive: TrashablePrimitive): string {
  return PLURAL[primitive];
}

export function defaultExtension(primitive: TrashablePrimitive): string {
  return DEFAULT_EXT[primitive];
}

/** Resolve the on-disk path for `<primitive>/<slug>`. Tries known extensions. */
export async function resolvePrimitivePath(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  slug: string,
): Promise<{ path: string; ext: string } | null> {
  const dir = path.join(workspaceRoot, primitiveDir(primitive));
  for (const ext of ['.md', '.yaml', '.yml', '.json']) {
    const p = path.join(dir, `${slug}${ext}`);
    try {
      await fs.access(p);
      return { path: p, ext };
    } catch {
      // try next
    }
  }
  return null;
}

/** SHA-256 of a string, first 12 chars — matches the audit-log convention. */
export function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

export interface ScaffoldOptions {
  actor: string;
  channel?: string;
  sessionId?: string;
  approvalId?: string;
  /** When provided, override the generated body. */
  body?: string;
  /** Overwrite an existing file — off by default. */
  force?: boolean;
}

export interface ScaffoldResult {
  path: string;
  ext: string;
  bytesWritten: number;
  hashAfter: string;
}

export async function scaffoldPrimitive(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  slug: string,
  opts: ScaffoldOptions,
): Promise<ScaffoldResult> {
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(slug)) {
    throw new Error(`Invalid slug: ${slug} (use letters, digits, ., _, - only, ≤64 chars)`);
  }
  const dir = path.join(workspaceRoot, primitiveDir(primitive));
  await fs.mkdir(dir, { recursive: true });
  const ext = defaultExtension(primitive);
  const dest = path.join(dir, `${slug}${ext}`);
  if (!opts.force) {
    try {
      await fs.access(dest);
      throw new Error(`Already exists: ${dest}. Use --force to overwrite (existing file trashed first).`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  } else {
    try {
      await fs.access(dest);
      await moveToTrash(workspaceRoot, primitive, slug, { ext });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const body = opts.body ?? scaffoldTemplate(primitive, slug, opts.actor);
  await fs.writeFile(dest, body, 'utf-8');
  const hashAfter = shortHash(body);
  await appendMutationAudit(workspaceRoot, {
    ts: new Date().toISOString(),
    actor: opts.actor,
    primitive,
    slug,
    action: 'new',
    hashAfter,
    approvalId: opts.approvalId,
    channel: opts.channel,
    sessionId: opts.sessionId,
  });
  return { path: dest, ext, bytesWritten: Buffer.byteLength(body, 'utf-8'), hashAfter };
}

export interface RemoveOptions {
  actor: string;
  channel?: string;
  sessionId?: string;
  approvalId?: string;
  reason?: string;
}

export interface RemoveResult {
  trash: MoveToTrashResult;
  hashBefore: string;
}

export async function removePrimitive(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  slug: string,
  opts: RemoveOptions,
): Promise<RemoveResult> {
  const resolved = await resolvePrimitivePath(workspaceRoot, primitive, slug);
  if (!resolved) {
    throw new Error(`Not found: ${primitive}/${slug}`);
  }
  const before = await fs.readFile(resolved.path, 'utf-8');
  const hashBefore = shortHash(before);
  const trash = await moveToTrash(workspaceRoot, primitive, slug, { ext: resolved.ext });
  await appendMutationAudit(workspaceRoot, {
    ts: new Date().toISOString(),
    actor: opts.actor,
    primitive,
    slug,
    action: 'rm',
    hashBefore,
    approvalId: opts.approvalId,
    channel: opts.channel,
    sessionId: opts.sessionId,
    reason: opts.reason,
  });
  return { trash, hashBefore };
}

export interface EditOptions extends ScaffoldOptions {
  /** Full replacement body — required for edit. */
  body: string;
}

export interface EditResult {
  path: string;
  ext: string;
  hashBefore: string;
  hashAfter: string;
  bytesWritten: number;
}

export async function editPrimitive(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  slug: string,
  opts: EditOptions,
): Promise<EditResult> {
  const resolved = await resolvePrimitivePath(workspaceRoot, primitive, slug);
  if (!resolved) {
    throw new Error(`Not found: ${primitive}/${slug} — use /new ${primitive} ${slug} to create it.`);
  }
  const before = await fs.readFile(resolved.path, 'utf-8');
  const hashBefore = shortHash(before);
  // Trash the current file so edits are reversible via `anvio trash restore`.
  await moveToTrash(workspaceRoot, primitive, slug, { ext: resolved.ext });
  await fs.writeFile(resolved.path, opts.body, 'utf-8');
  const hashAfter = shortHash(opts.body);
  await appendMutationAudit(workspaceRoot, {
    ts: new Date().toISOString(),
    actor: opts.actor,
    primitive,
    slug,
    action: 'edit',
    hashBefore,
    hashAfter,
    approvalId: opts.approvalId,
    channel: opts.channel,
    sessionId: opts.sessionId,
  });
  return {
    path: resolved.path,
    ext: resolved.ext,
    hashBefore,
    hashAfter,
    bytesWritten: Buffer.byteLength(opts.body, 'utf-8'),
  };
}

export async function appendMutationAudit(
  workspaceRoot: string,
  record: MutationAuditRecord,
): Promise<void> {
  const dir = path.join(workspaceRoot, 'audit');
  await fs.mkdir(dir, { recursive: true });
  const line = JSON.stringify(record) + '\n';
  await fs.appendFile(path.join(dir, 'mutations.jsonl'), line, 'utf-8');
}

export async function readMutationAudit(
  workspaceRoot: string,
  limit = 50,
): Promise<MutationAuditRecord[]> {
  const file = path.join(workspaceRoot, 'audit', 'mutations.jsonl');
  try {
    const raw = await fs.readFile(file, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const parsed: MutationAuditRecord[] = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line) as MutationAuditRecord);
      } catch {
        // skip malformed
      }
    }
    return parsed.slice(-limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function scaffoldTemplate(
  primitive: TrashablePrimitive,
  slug: string,
  actor: string,
): string {
  const iso = new Date().toISOString();
  switch (primitive) {
    case 'agent':
      return [
        '---',
        `name: ${slug}`,
        'description: TODO — one sentence about what this agent does.',
        'model:',
        '  provider: anthropic',
        '  model: claude-sonnet-4-5',
        'runtime:',
        '  provider: local',
        '---',
        '',
        `# ${slug}`,
        '',
        'System prompt goes here.',
        '',
      ].join('\n');
    case 'persona':
      return [
        '---',
        `name: ${slug}`,
        'description: TODO — one sentence about this persona.',
        'voice: neutral',
        '---',
        '',
        'Traits, tone, and boundaries.',
        '',
      ].join('\n');
    case 'soul':
      return [
        '---',
        `name: ${slug}`,
        'identity:',
        '  role: TODO',
        '  description: TODO',
        'values: []',
        'evolution:',
        '  allowAutoUpdate: false',
        '  captureOn: never',
        '---',
        '',
        '# SOUL.md',
        '',
        'Purpose, values, and evolution policy.',
        '',
      ].join('\n');
    case 'skill':
      return [
        '---',
        `name: ${slug}`,
        'description: TODO — when should the agent invoke this skill?',
        '---',
        '',
        '# Instructions',
        '',
        'Step-by-step procedure the agent follows.',
        '',
      ].join('\n');
    case 'workflow':
      return [
        'apiVersion: anvio.io/v1',
        'kind: Workflow',
        'metadata:',
        `  slug: ${slug}`,
        `  createdBy: ${actor}`,
        `  createdAt: "${iso}"`,
        'spec:',
        '  description: TODO',
        '  nodes: []',
        '',
      ].join('\n');
    case 'goal':
      return [
        'apiVersion: anvio.io/v1',
        'kind: Goal',
        'metadata:',
        `  slug: ${slug}`,
        'spec:',
        '  title: TODO',
        '  status: active',
        '  priority: medium',
        '  progress:',
        '    percent: 0',
        '',
      ].join('\n');
    case 'blueprint':
      return [
        'apiVersion: anvio.io/v1',
        'kind: Blueprint',
        'metadata:',
        `  slug: ${slug}`,
        'spec:',
        '  description: TODO',
        '  steps: []',
        '',
      ].join('\n');
    case 'automation':
      return [
        'apiVersion: anvio.io/v1',
        'kind: Automation',
        'metadata:',
        `  slug: ${slug}`,
        '  enabled: false',
        'spec:',
        '  trigger:',
        '    type: cron',
        '    schedule: "0 * * * *"',
        '  action:',
        '    type: run-agent',
        '    agent: TODO',
        '',
      ].join('\n');
    case 'hook':
      return [
        'apiVersion: anvio.io/v1',
        'kind: Hook',
        'metadata:',
        `  slug: ${slug}`,
        'spec:',
        '  event: SESSION_STARTED',
        '  handlers: []',
        '',
      ].join('\n');
    case 'mcp':
      return [
        'apiVersion: anvio.io/v1',
        'kind: McpServer',
        'metadata:',
        `  id: ${slug}`,
        '  enabled: true',
        'server:',
        '  command: TODO',
        '  args: []',
        '',
      ].join('\n');
    case 'knowledge':
      return [
        `# ${slug}`,
        '',
        `Created by ${actor} at ${iso}.`,
        '',
        'Notes go here.',
        '',
      ].join('\n');
  }
}
