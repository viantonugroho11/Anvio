#!/usr/bin/env tsx
/**
 * P1.S6 — Golden trajectory capture.
 *
 * Read StoredSession records from the workspace SessionStore, export each via
 * `exportSessionTrajectory`, and write JSON to `evals/goldens/v1-seed/<sessionId>.json`.
 *
 * Usage (from repo root):
 *   ANVIO_WORKSPACE=./workspace pnpm --filter @anvio/cli exec \
 *     tsx scripts/capture-goldens.ts \
 *     [--out ../../evals/goldens/v1-seed] [--min-messages 4] [--limit 50] [--tag chat]
 *
 * Idempotent: skips sessions already present in --out unless --force.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Workspace } from '@anvio/workspace';
import { exportSessionTrajectory } from '@anvio/platform';

interface Args {
  workspace: string;
  out: string;
  minMessages: number;
  limit: number;
  tag?: string;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    workspace: process.env.ANVIO_WORKSPACE ?? './workspace',
    out: path.resolve(process.cwd(), '../../evals/goldens/v1-seed'),
    minMessages: 4,
    limit: 50,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = argv[++i]!;
    else if (a === '--min-messages') args.minMessages = Number(argv[++i]);
    else if (a === '--limit') args.limit = Number(argv[++i]);
    else if (a === '--tag') args.tag = argv[++i];
    else if (a === '--force') args.force = true;
    else if (a === '--workspace') args.workspace = argv[++i]!;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const ws = await Workspace.open(args.workspace);
  const all = await ws.sessions.list();
  const eligible = all
    .filter((s) => s.messages.length >= args.minMessages)
    .slice(0, args.limit);

  await fs.mkdir(args.out, { recursive: true });

  let written = 0;
  let skipped = 0;
  const index: Array<{ id: string; agent: string; channel: string; messages: number; tag?: string }> = [];

  for (const session of eligible) {
    const outPath = path.join(args.out, `${session.id}.json`);
    if (!args.force) {
      try {
        await fs.access(outPath);
        skipped++;
        continue;
      } catch {
        // not present; fall through
      }
    }
    const trajectory = exportSessionTrajectory(session);
    const payload = { ...trajectory, tag: args.tag, capturedAt: new Date().toISOString() };
    await fs.writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    index.push({
      id: session.id,
      agent: session.agentName,
      channel: session.channel,
      messages: session.messages.length,
      tag: args.tag,
    });
    written++;
  }

  const indexPath = path.join(args.out, 'index.json');
  let prevIndex: typeof index = [];
  try {
    prevIndex = JSON.parse(await fs.readFile(indexPath, 'utf8'));
  } catch {
    // no prior index
  }
  const merged = [...prevIndex.filter((p) => !index.find((n) => n.id === p.id)), ...index];
  await fs.writeFile(indexPath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

  console.log(`captured ${written} golden(s), skipped ${skipped} existing, index: ${indexPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
