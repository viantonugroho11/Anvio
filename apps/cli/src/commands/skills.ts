// Moved verbatim from main.ts (audit CQ-011); see main.ts for the command dispatcher.
import { parseSkillDefinition } from '@anvio/core';
import {
  KnowledgeBaseStore,
  KnowledgeIngestEngine,
  WorkspaceManifestImporter,
} from '@anvio/knowledge';
import { LearningEngine } from '@anvio/learning';
import { createMemoryProvider } from '@anvio/memory';
import { findRepoRoot, gbrainMemoryOptions, loadAgent } from '@anvio/platform';
import {
  createSkillCatalogResolver,
  createSkillInstaller,
  createSkillTestRunner,
  importSkills,
} from '@anvio/skills';
import { createSoulService } from '@anvio/souls';
import { ToolGateway } from '@anvio/tools';
import { createStreamingSttSession, streamTranscribe, VoicePipeline } from '@anvio/voice';
import { Workspace } from '@anvio/workspace';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveWorkspacePath } from '../cli-context.js';

export async function cmdSkill(sub: string[]) {
  const action = sub[0] ?? 'catalog';
  const wsPath = resolveWorkspacePath();
  const repoRoot = findRepoRoot(wsPath);
  const catalog = createSkillCatalogResolver(wsPath, repoRoot);
  const installer = createSkillInstaller(catalog, wsPath);

  switch (action) {
    case 'catalog': {
      const sourceIdx = sub.indexOf('--source');
      const source = sourceIdx >= 0 ? sub[sourceIdx + 1] : 'all';
      const items = source === 'bundled' ? await catalog.listBundled() : await catalog.listAll();
      for (const item of items) {
        if (typeof item === 'string') console.log(`  ${item}`);
        else console.log(`  ${item.slug} [${item.source}]`);
      }
      break;
    }
    case 'install': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio skill install <slug>');
        process.exit(1);
      }
      const skill = await installer.install(slug);
      console.log(`Installed skill: ${skill.metadata.slug}@${skill.metadata.version}`);
      break;
    }
    case 'import': {
      const source = sub[1];
      if (!source || source.startsWith('--')) {
        console.error(
          'Usage: anvio skill import <dir|git-url> [--path <subdir>] [--name <slug>] [--ref <branch>]',
        );
        process.exit(1);
      }
      const flag = (name: string) => {
        const idx = sub.indexOf(name);
        return idx >= 0 ? sub[idx + 1] : undefined;
      };
      const skills = await importSkills(installer, source, {
        subPath: flag('--path'),
        slug: flag('--name'),
        ref: flag('--ref'),
      });
      for (const skill of skills) {
        console.log(`Imported skill: ${skill.metadata.slug}@${skill.metadata.version}`);
      }
      console.log(`\n${skills.length} skill(s) imported into ${path.join(wsPath, 'skills')}`);
      break;
    }
    case 'validate': {
      const file = sub[1];
      if (!file) {
        console.error('Usage: anvio skill validate <file.yaml>');
        process.exit(1);
      }
      const raw = await fs.readFile(path.resolve(file), 'utf8');
      const skill = parseSkillDefinition(parseYaml(raw));
      console.log(JSON.stringify({ slug: skill.metadata.slug, valid: true }, null, 2));
      break;
    }
    case 'upgrade': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio skill upgrade <slug>');
        process.exit(1);
      }
      const result = await installer.upgrade(slug);
      if (result.upgraded) {
        console.log(
          `Upgraded skill: ${slug}  ${result.previousVersion ?? '?'} → ${result.skill.metadata.version}`,
        );
      } else {
        console.log(`Skill ${slug}@${result.skill.metadata.version} is already up to date.`);
      }
      break;
    }
    case 'test': {
      const slug = sub[1];
      if (!slug) {
        console.error(
          'Usage: anvio skill test <slug> [--params \'{"key":"val"}\'] [--stub \'{"tool_name":"output"}\']',
        );
        process.exit(1);
      }
      const paramsIdx = sub.indexOf('--params');
      const stubIdx = sub.indexOf('--stub');
      const params =
        paramsIdx >= 0 ? (JSON.parse(sub[paramsIdx + 1] ?? '{}') as Record<string, unknown>) : {};
      const stubOutputs =
        stubIdx >= 0 ? (JSON.parse(sub[stubIdx + 1] ?? '{}') as Record<string, unknown>) : {};

      const skill = await catalog.load(slug);
      const runner = createSkillTestRunner(skill, stubOutputs);
      const result = await runner.run(params);

      if (result.passed) {
        console.log(`\n✓ Skill test passed: ${slug}\n`);
        console.log(result.trace);
        if (result.toolCalls.length > 0) {
          console.log(`\nTool calls (${result.toolCalls.length}):`);
          for (const call of result.toolCalls) {
            console.log(`  ${call.name}  args: ${JSON.stringify(call.arguments)}`);
          }
        }
      } else {
        console.error(`\n✗ Skill test failed: ${slug}`);
        console.error(`  Error: ${result.error}`);
        if (result.toolCalls.length > 0) {
          console.error(
            `  Tool calls before failure: ${result.toolCalls.map((c) => c.name).join(', ')}`,
          );
        }
        process.exitCode = 1;
      }
      break;
    }
    case 'drafts':
    case 'draft':
    case 'discard':
    case 'promote':
    case 'promote-session':
    case 'capture':
      // Alias into cmdLearning so users find the learning-loop surface
      // where they look for it (#56 (a)). `anvio learning …` still works.
      await cmdLearning([action, ...sub.slice(1)]);
      break;
    default:
      console.error(
        'Usage: anvio skill catalog|install|validate|upgrade|test|drafts|draft|discard|promote|promote-session|capture',
      );
      process.exit(1);
  }
}

export async function cmdTools(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const gateway = await ToolGateway.load(wsPath);

  switch (action) {
    case 'list': {
      const tools = gateway.listTools();
      console.log(
        tools.length ? tools.join('\n') : 'No tools enabled in workspace/tools/gateway.yaml',
      );
      break;
    }
    case 'test': {
      const tool = sub[1] ?? 'anvio_tools__web_fetch';
      const url = sub[2] ?? 'https://example.com';
      const result = await gateway.call({
        name: tool,
        arguments: tool.includes('web_search') ? { query: url } : { url, code: 'return 1+1' },
      });
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio tools list|test [tool] [arg]');
      process.exit(1);
  }
}

export async function cmdKb(sub: string[]) {
  const action = sub[0] ?? 'list';
  const wsPath = resolveWorkspacePath();
  const store = new KnowledgeBaseStore(wsPath);
  const ingest = new KnowledgeIngestEngine(store);

  switch (action) {
    case 'list': {
      const bases = await store.listBases();
      console.log(bases.length ? bases.join('\n') : 'No knowledge bases yet');
      break;
    }
    case 'ingest':
    case 'sync': {
      const slug = sub[1];
      if (!slug) {
        console.error(`Usage: anvio kb ${action} <slug>`);
        process.exit(1);
      }
      const result = await ingest.ingest(slug);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'import-manifest':
    case 'import-slaude': {
      const manifestPath =
        sub[1] ??
        path.join(
          process.cwd(),
          action === 'import-slaude' ? 'slaude.json' : 'workspace-manifest.json',
        );
      const importer = new WorkspaceManifestImporter(wsPath);
      const result = await importer.importFromFile(manifestPath);
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error('Usage: anvio kb list|ingest|sync|import-manifest [manifest.json]');
      process.exit(1);
  }
}

export async function cmdLearning(sub: string[]) {
  const action = sub[0] ?? 'drafts';
  const wsPath = resolveWorkspacePath();
  const workspace = await Workspace.open(wsPath);
  const memory = createMemoryProvider(
    workspace.config.spec.memory.provider,
    workspace.storage,
    undefined,
    gbrainMemoryOptions(workspace.config.spec.memory),
  );
  const engine = new LearningEngine(memory, wsPath);

  switch (action) {
    case 'consolidate': {
      // ADR 0035: fold gbrain episodic timelines of recently active sessions into facts.
      // Schedule it nightly with an automation that runs `anvio learning consolidate`.
      const sinceIdx = sub.indexOf('--since');
      const since =
        sinceIdx >= 0 ? new Date(sub[sinceIdx + 1] ?? '') : new Date(Date.now() - 24 * 3600_000);
      if (Number.isNaN(since.getTime())) {
        console.error('Usage: anvio learning consolidate [--since YYYY-MM-DD]');
        process.exit(1);
      }
      if (
        workspace.config.spec.memory.provider !== 'gbrain' ||
        !workspace.config.spec.memory.gbrain?.episodic
      ) {
        console.log(
          'Nothing to do: requires memory.provider: gbrain with memory.gbrain.episodic: true',
        );
        process.exit(0);
      }
      const souls = createSoulService(workspace.storage, memory);
      const recent = (await workspace.sessions.list()).filter(
        (s) => new Date(s.lastActiveAt) >= since,
      );
      const items = await Promise.all(
        recent.map(async (s) => {
          const agent = await loadAgent(workspace, s.agentName).catch(() => null);
          const soulSlug = agent?.spec.soul;
          const soul = soulSlug
            ? ((await souls.get(soulSlug).catch(() => null)) ?? undefined)
            : undefined;
          return { sessionId: s.id, soul };
        }),
      );
      const result = await engine.consolidateEpisodic(items);
      console.log(
        `Consolidated ${result.consolidated} session(s), skipped ${result.skipped} (since ${since.toISOString().slice(0, 10)}).`,
      );
      // The gbrain MCP child process keeps the event loop alive.
      process.exit(0);
      break;
    }
    case 'drafts': {
      if (sub[1] === 'prune') {
        const olderIdx = sub.indexOf('--older-than');
        const spec = olderIdx >= 0 ? (sub[olderIdx + 1] ?? '') : '7d';
        const ms = parseDurationMs(spec);
        if (ms == null) {
          console.error('Usage: anvio learning drafts prune [--older-than 7d|24h|60m]');
          process.exit(1);
        }
        const removed = await engine.pruneDrafts(ms);
        console.log(removed.length ? `Pruned:\n${removed.join('\n')}` : 'Nothing to prune.');
        break;
      }
      const drafts = await engine.listDrafts();
      console.log(
        drafts.length ? drafts.join('\n') : 'No skill drafts in workspace/skills/_drafts/',
      );
      break;
    }
    case 'draft': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio learning draft <slug>');
        process.exit(1);
      }
      const draft = await engine.getDraft(slug);
      if (!draft) {
        console.error(`Draft not found: ${slug}`);
        process.exit(1);
      }
      console.log(draft.content);
      break;
    }
    case 'discard': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio learning discard <slug>');
        process.exit(1);
      }
      const result = await engine.discardDraft(slug);
      if (!result) {
        console.error(`Draft not found: ${slug}`);
        process.exit(1);
      }
      console.log(`Discarded → ${result.path}`);
      break;
    }
    case 'promote': {
      const slug = sub[1];
      if (!slug) {
        console.error('Usage: anvio learning promote <draft-slug> [--force]');
        process.exit(1);
      }
      const force = sub.includes('--force');
      const result = await engine.promoteDraft(slug, wsPath, { force });
      if (result.diff) {
        console.log(`Refusing to overwrite ${result.path} — re-run with --force to apply.`);
        console.log('');
        console.log(result.diff);
        process.exit(1);
      }
      const verb = result.alreadyExisted ? 'Overwrote' : 'Promoted';
      console.log(`${verb} to ${result.path}`);
      break;
    }
    case 'promote-session': {
      const sid = sub[1];
      if (!sid) {
        console.error('Usage: anvio learning promote-session <sessionId> [--force]');
        process.exit(1);
      }
      const force = sub.includes('--force');
      const stored = await workspace.sessions.get(sid);
      if (!stored) {
        console.error(`Session not found: ${sid}`);
        process.exit(1);
      }
      const draft = await engine.captureFromSession({
        sessionId: stored.id,
        userId: stored.userId,
        agentId: stored.agentName,
        messages: stored.messages,
        channel: stored.channel,
        force,
      });
      if (!draft) {
        console.error('Nothing to capture — the session is too short.');
        process.exit(1);
      }
      console.log(`Captured draft: ${draft.slug}\n  ${draft.path}`);
      break;
    }
    case 'capture': {
      const msgsIdx = sub.indexOf('--messages');
      const agentIdx = sub.indexOf('--agent');
      const agentId = agentIdx >= 0 ? sub[agentIdx + 1] : undefined;
      const messagesPath = msgsIdx >= 0 ? sub[msgsIdx + 1] : undefined;
      if (!messagesPath || !agentId) {
        console.error('Usage: anvio learning capture --messages <path.json> --agent <slug>');
        process.exit(1);
      }
      const raw = await fs.readFile(path.resolve(messagesPath), 'utf-8');
      const messages = JSON.parse(raw) as Array<{ role: string; content: string }>;
      const draft = await engine.captureFromTranscript({
        agentId,
        messages: messages as never,
      });
      if (!draft) {
        console.error('Nothing to capture from the supplied transcript.');
        process.exit(1);
      }
      console.log(`Captured draft: ${draft.slug}\n  ${draft.path}`);
      break;
    }
    case 'summarize-sessions': {
      const sessions = await workspace.sessions.list(workspace.config.spec.defaultUserId);
      const result = await engine.summarizeStaleSessions(
        sessions.map((s) => ({
          id: s.id,
          userId: s.userId,
          messages: s.messages,
          status: s.status,
        })),
      );
      console.log(JSON.stringify(result, null, 2));
      break;
    }
    default:
      console.error(
        'Usage: anvio learning drafts [prune]|draft <slug>|discard <slug>|promote <slug> [--force]|promote-session <sid> [--force]|capture --messages <path> --agent <slug>|summarize-sessions',
      );
      process.exit(1);
  }
}

/**
 * Parse durations like `7d`, `24h`, `60m`, `3600s` into milliseconds.
 * Returns null when the input doesn't match, so the CLI can print usage
 * rather than pruning against `NaN`.
 */
export function parseDurationMs(spec: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(spec);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return n * 1000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
  }
  return null;
}

export async function cmdVoice(sub: string[]) {
  const action = sub[0] ?? 'speak';
  const pipeline = new VoicePipeline();

  switch (action) {
    case 'transcribe': {
      const audioPath = sub[1];
      if (!audioPath) {
        console.error('Usage: anvio voice transcribe <audio-file>');
        process.exit(1);
      }
      const text = await pipeline.transcribe(path.resolve(audioPath));
      console.log(text);
      break;
    }
    case 'stream-transcribe':
    case 'realtime-transcribe': {
      const audioPath = sub[1];
      const useRealtime = action === 'realtime-transcribe' || sub.includes('--realtime');
      if (!audioPath || audioPath.startsWith('--')) {
        console.error('Usage: anvio voice stream-transcribe|realtime-transcribe <audio-file>');
        process.exit(1);
      }
      const fsMod = await import('node:fs/promises');
      const buffer = await fsMod.readFile(path.resolve(audioPath));
      const session = createStreamingSttSession({ realtime: useRealtime });
      async function* chunks() {
        const size = 4096;
        for (let i = 0; i < buffer.length; i += size) {
          yield buffer.subarray(i, i + size);
        }
      }
      for await (const part of streamTranscribe(session, chunks())) {
        console.log(JSON.stringify(part));
      }
      break;
    }
    case 'speak': {
      const text = sub.slice(1).join(' ') || 'Hello from Anvio voice pipeline';
      const audio = await pipeline.speak(text);
      console.log(
        JSON.stringify({ mimeType: audio.mimeType, bytes: audio.audioBase64.length }, null, 2),
      );
      break;
    }
    default:
      console.error('Usage: anvio voice transcribe|stream-transcribe|realtime-transcribe|speak');
      process.exit(1);
  }
}
