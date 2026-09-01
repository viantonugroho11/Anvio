// Workspace soft-delete: ADR-0025.
//
// `/rm <primitive> <slug>` and `anvio <primitive> rm <slug>` never call
// `fs.unlink`. They call `moveToTrash`, which relocates the file to
//
//   workspace/_trash/<primitive>/<slug>-<UTC-timestamp>.<ext>
//
// The primitive/slug pair is preserved in the trash-entry name so
// `restoreFromTrash` can put it back without extra metadata. Timestamps are
// deterministic (UTC ISO with `:` and `.` stripped) so the sort order in
// `listTrash` matches deletion order.
//
// Trash lives inside the workspace root, never in a system temp — it is
// part of the workspace's own state and gets committed/backed-up alongside
// the workspace by whatever tooling the operator uses.

import fs from 'node:fs/promises';
import path from 'node:path';

export const TRASH_DIRNAME = '_trash';

/** Primitives that participate in soft-delete. Matches ADR-0025 §Mutation. */
export type TrashablePrimitive =
  | 'agent'
  | 'persona'
  | 'soul'
  | 'skill'
  | 'workflow'
  | 'goal'
  | 'blueprint'
  | 'automation'
  | 'hook'
  | 'mcp'
  | 'knowledge';

export interface TrashEntry {
  primitive: TrashablePrimitive;
  /** Original slug the file was stored under. */
  slug: string;
  /** UTC ISO timestamp of deletion, `:` and `.` stripped for path-safety. */
  timestamp: string;
  /** File extension the trashed file kept (`.md`, `.yaml`, …). */
  ext: string;
  /** Trash-entry filename: `<slug>-<timestamp><ext>`. */
  entryName: string;
  /** Absolute path to the trashed file. */
  path: string;
  /** ms since epoch — for pruning by age. */
  deletedAtMs: number;
}

function primitiveDir(primitive: TrashablePrimitive): string {
  // The workspace stores each primitive under a plural directory (see
  // WORKSPACE_DIRS). `mcp` is the exception — no plural.
  const plural: Record<TrashablePrimitive, string> = {
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
  return plural[primitive];
}

function safeTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseTimestamp(stamped: string): number {
  // Reverse of safeTimestamp: `2026-09-01T12-34-56-789Z` → epoch ms.
  // Reinsert the two `:` in the time portion and the `.` before `Z`.
  const m = stamped.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!m) return Number.NaN;
  const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
  return Date.parse(iso);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export interface MoveToTrashResult {
  entry: TrashEntry;
  /** Command the operator can paste to restore. */
  restoreCommand: string;
}

/**
 * Move `workspace/<primitiveDir>/<slug>.<ext>` to the trash. Returns the
 * entry descriptor and the copy-pasteable restore command. Throws if the
 * source file does not exist — callers should surface a not-found reply to
 * the user rather than silently no-op.
 */
export async function moveToTrash(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  slug: string,
  opts: { ext?: string } = {},
): Promise<MoveToTrashResult> {
  const srcDir = path.join(workspaceRoot, primitiveDir(primitive));
  const ext = opts.ext ?? (await guessExtension(srcDir, slug));
  const src = path.join(srcDir, `${slug}${ext}`);
  await fs.access(src); // throws ENOENT if missing — bubble to caller

  const timestamp = safeTimestamp();
  const entryName = `${slug}-${timestamp}${ext}`;
  const destDir = path.join(workspaceRoot, TRASH_DIRNAME, primitive);
  await ensureDir(destDir);
  const dest = path.join(destDir, entryName);
  await fs.rename(src, dest);

  return {
    entry: {
      primitive,
      slug,
      timestamp,
      ext,
      entryName,
      path: dest,
      deletedAtMs: parseTimestamp(timestamp),
    },
    restoreCommand: `anvio trash restore ${primitive} ${entryName}`,
  };
}

async function guessExtension(dir: string, slug: string): Promise<string> {
  // Most primitives are `.md`; workflows/automations/hooks/mcp/knowledge
  // may be `.yaml` or `.yml`. Look, don't assume.
  for (const ext of ['.md', '.yaml', '.yml', '.json']) {
    try {
      await fs.access(path.join(dir, `${slug}${ext}`));
      return ext;
    } catch {
      // try next
    }
  }
  // Fall back to `.md` — the caller's `fs.access` will report ENOENT with
  // a useful message that names the `.md` path.
  return '.md';
}

/**
 * List trash entries for one primitive (or all when omitted). Newest first
 * by deletion timestamp.
 */
export async function listTrash(
  workspaceRoot: string,
  primitive?: TrashablePrimitive,
): Promise<TrashEntry[]> {
  const root = path.join(workspaceRoot, TRASH_DIRNAME);
  const out: TrashEntry[] = [];

  const primitives: TrashablePrimitive[] = primitive
    ? [primitive]
    : ([
        'agent',
        'persona',
        'soul',
        'skill',
        'workflow',
        'goal',
        'blueprint',
        'automation',
        'hook',
        'mcp',
        'knowledge',
      ] as const);

  for (const p of primitives) {
    const dir = path.join(root, p);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const entryName of names) {
      const parsed = parseEntryName(entryName);
      if (!parsed) continue;
      out.push({
        primitive: p,
        slug: parsed.slug,
        timestamp: parsed.timestamp,
        ext: parsed.ext,
        entryName,
        path: path.join(dir, entryName),
        deletedAtMs: parseTimestamp(parsed.timestamp),
      });
    }
  }

  out.sort((a, b) => b.deletedAtMs - a.deletedAtMs);
  return out;
}

function parseEntryName(
  name: string,
): { slug: string; timestamp: string; ext: string } | null {
  // `<slug>-<yyyy-mm-ddThh-mm-ss-mmmZ><ext>`. `slug` may itself contain
  // hyphens, so anchor on the timestamp shape at the end.
  const m = name.match(/^(.+)-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(\.[A-Za-z0-9]+)$/);
  if (!m) return null;
  return { slug: m[1], timestamp: m[2], ext: m[3] };
}

export interface RestoreResult {
  primitive: TrashablePrimitive;
  slug: string;
  destPath: string;
  overwritten: boolean;
}

/**
 * Restore a trashed entry. `entryName` is the full trash filename
 * (`<slug>-<timestamp><ext>`). When `force` is false and the destination
 * exists, throws with a message the caller can surface. When true, the
 * live file is itself moved to trash first (so restore is reversible).
 */
export async function restoreFromTrash(
  workspaceRoot: string,
  primitive: TrashablePrimitive,
  entryName: string,
  opts: { force?: boolean } = {},
): Promise<RestoreResult> {
  const parsed = parseEntryName(entryName);
  if (!parsed) {
    throw new Error(
      `Not a trash entry name: ${entryName} (expected "<slug>-<timestamp>.<ext>")`,
    );
  }
  const src = path.join(workspaceRoot, TRASH_DIRNAME, primitive, entryName);
  await fs.access(src);

  const destDir = path.join(workspaceRoot, primitiveDir(primitive));
  await ensureDir(destDir);
  const dest = path.join(destDir, `${parsed.slug}${parsed.ext}`);

  let overwritten = false;
  try {
    await fs.access(dest);
    if (!opts.force) {
      throw new Error(
        `Refusing to overwrite ${dest} — re-run with --force to trash the current file first.`,
      );
    }
    // Trash the current file so the restore is itself undoable.
    await moveToTrash(workspaceRoot, primitive, parsed.slug, { ext: parsed.ext });
    overwritten = true;
  } catch (error) {
    // ENOENT is fine — dest doesn't exist, nothing to overwrite. Anything
    // else (including the "refusing to overwrite" above) bubbles.
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (!overwritten) throw error;
    }
  }

  await fs.rename(src, dest);
  return { primitive, slug: parsed.slug, destPath: dest, overwritten };
}

export interface PruneOptions {
  /** Delete entries older than this many days. Default 30. */
  olderThanDays?: number;
  /** When true, walk and report but don't unlink. */
  dryRun?: boolean;
}

export interface PruneResult {
  scanned: number;
  removed: TrashEntry[];
}

/**
 * Hard-delete trash entries older than the cutoff. This is the ONLY
 * function that actually calls `fs.unlink` on workspace content — every
 * other path in this module preserves the file.
 */
export async function pruneTrash(
  workspaceRoot: string,
  opts: PruneOptions = {},
): Promise<PruneResult> {
  const cutoffDays = opts.olderThanDays ?? 30;
  const cutoffMs = Date.now() - cutoffDays * 24 * 60 * 60 * 1000;
  const entries = await listTrash(workspaceRoot);
  const removed: TrashEntry[] = [];
  for (const entry of entries) {
    if (Number.isNaN(entry.deletedAtMs) || entry.deletedAtMs >= cutoffMs) continue;
    if (!opts.dryRun) await fs.unlink(entry.path);
    removed.push(entry);
  }
  return { scanned: entries.length, removed };
}
