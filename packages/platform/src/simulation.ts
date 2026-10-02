import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChannelType } from '@anvio/core';
import { SimulatedChannel, type SimulatedOutbound } from '@anvio/channels';
import { createScriptedModelProvider, type ScriptedTurn } from '@anvio/models';
import { parse as parseYaml } from 'yaml';
import { findRepoRoot } from './find-workspace.js';
import { registerGatewayWorker } from './gateway-worker.js';
import { createPlatform } from './index.js';

/**
 * End-to-end scenario (ADR 0033): inbound messages and approval clicks on a simulated
 * channel, a scripted model, and expectations on what the platform sends back.
 */
export interface SimulationScenario {
  name: string;
  channel: ChannelType;
  model: ScriptedTurn[];
  steps: SimulationStep[];
  /** Files written into the workspace copy before boot (e.g. a SOUL.md naming test users). */
  workspaceFiles?: Record<string, string>;
}

export type SimulationStep =
  | {
      say: {
        user: string;
        thread: string;
        text: string;
        mentionedBot?: boolean;
        mentionedOther?: boolean;
        isDm?: boolean;
      };
    }
  | { approve: SimulatedApproval }
  | { reject: SimulatedApproval }
  | {
      expect: {
        thread: string;
        /** Next message on the thread contains this text. */
        replyContains?: string;
        /** Next approval prompt on the thread is for this tool. */
        approval?: string;
        /** Nothing new arrives on the thread within timeoutMs. */
        silent?: boolean;
        timeoutMs?: number;
      };
    };

export interface SimulatedApproval {
  user: string;
  thread: string;
  /** Expected harness outcome; defaults to `resolved`. Use `not_authorized` to test the gate. */
  expectStatus?: 'resolved' | 'not_authorized' | 'not_found' | 'already_resolved';
}

export interface SimulationResult {
  name: string;
  passed: boolean;
  failures: string[];
  outbox: SimulatedOutbound[];
}

/** Directories never copied into a simulation workspace: runtime state and secrets. */
const SKIP_DIRS = new Set(['sessions', 'memory', 'connections', 'credentials', 'inbox', '.gateway', 'worktrees', 'artifacts']);

/** Copy a workspace's configuration (not its runtime state or secrets) into a temp dir. */
export async function prepareSimulationWorkspace(source: string): Promise<string> {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'anvio-sim-'));
  await fs.cp(source, target, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(source, src);
      return !rel || !SKIP_DIRS.has(rel.split(path.sep)[0]!) && !rel.endsWith('state.db');
    },
  });
  return target;
}

export function parseSimulationScenario(yamlText: string): SimulationScenario {
  const raw = parseYaml(yamlText) as Partial<SimulationScenario>;
  if (!raw?.name || !raw.channel || !Array.isArray(raw.steps)) {
    throw new Error('Scenario needs name, channel and steps');
  }
  return {
    name: raw.name,
    channel: raw.channel,
    model: raw.model ?? [],
    steps: raw.steps,
    workspaceFiles: raw.workspaceFiles,
  };
}

/**
 * Run one scenario against a full platform (harness, runtime, tool gateway) in
 * simulation mode. `workspacePath` should be a disposable copy — see
 * prepareSimulationWorkspace — because sessions are written to it.
 */
export async function runSimulation(
  scenario: SimulationScenario,
  options: { workspacePath: string; repoRoot?: string; defaultTimeoutMs?: number },
): Promise<SimulationResult> {
  for (const [rel, content] of Object.entries(scenario.workspaceFiles ?? {})) {
    const file = path.resolve(options.workspacePath, rel);
    if (!file.startsWith(path.resolve(options.workspacePath) + path.sep)) {
      throw new Error(`workspaceFiles path escapes the workspace: ${rel}`);
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  const model = createScriptedModelProvider(scenario.model);
  let channel: SimulatedChannel | undefined;
  const platform = await createPlatform({
    workspacePath: options.workspacePath,
    // The workspace is a temp copy, so walking up from it never finds configs/.
    repoRoot: options.repoRoot ?? findRepoRoot(),
    simulation: {
      modelProvider: model,
      adapters: ({ sessionBridge, onApproval }) => {
        channel = new SimulatedChannel({
          channelType: scenario.channel,
          sessionBridge,
          onApproval,
        });
        return [channel];
      },
    },
  });
  if (!channel) throw new Error('Simulated channel was not registered');
  await registerGatewayWorker(platform);

  const sim = channel;
  const failures: string[] = [];
  const sessionByThread = new Map<string, string>();
  const cursorBySession = new Map<string, number>();
  const timeout = options.defaultTimeoutMs ?? 5000;

  const nextFor = async (
    thread: string,
    match: (e: SimulatedOutbound) => boolean,
    ms: number,
  ): Promise<SimulatedOutbound> => {
    const sessionId = sessionByThread.get(thread);
    if (!sessionId) throw new Error(`No session for thread "${thread}" — say something first`);
    const from = cursorBySession.get(sessionId) ?? 0;
    const hit = await sim.waitFor(
      (e) => e.sessionId === sessionId && sim.outbox.indexOf(e) >= from && match(e),
      ms,
    );
    cursorBySession.set(sessionId, sim.outbox.indexOf(hit) + 1);
    return hit;
  };

  try {
    for (const [index, step] of scenario.steps.entries()) {
      const label = `step ${index + 1}`;
      try {
        if ('say' in step) {
          const { user, thread, text, ...facts } = step.say;
          sessionByThread.set(thread, await sim.say({ userId: user, threadId: thread, text, ...facts }));
        } else if ('approve' in step || 'reject' in step) {
          const { user, thread, expectStatus = 'resolved' } = 'approve' in step ? step.approve : step.reject;
          const sessionId = sessionByThread.get(thread);
          // Reuse the latest prompt on the thread so several users can act on one request.
          const prompt =
            [...sim.outbox].reverse().find((e) => e.kind === 'approval' && e.sessionId === sessionId) ??
            (await nextFor(thread, (e) => e.kind === 'approval', timeout));
          if (prompt.kind !== 'approval') continue;
          const outcome = await sim.decideApproval(prompt.sessionId, prompt.requestId, 'approve' in step, user);
          if (outcome.status !== expectStatus) {
            failures.push(`${label}: expected approval ${expectStatus}, got ${outcome.status}`);
          }
        } else if ('expect' in step) {
          const exp = step.expect;
          const ms = exp.timeoutMs ?? (exp.silent ? 500 : timeout);
          if (exp.silent) {
            const got = await nextFor(exp.thread, () => true, ms).catch(() => null);
            if (got) failures.push(`${label}: expected silence, got ${got.kind} "${'text' in got ? got.text : got.toolName}"`);
          } else if (exp.approval) {
            const got = await nextFor(exp.thread, (e) => e.kind === 'approval', ms);
            if (got.kind === 'approval' && got.toolName !== exp.approval) {
              failures.push(`${label}: expected approval for ${exp.approval}, got ${got.toolName}`);
            }
          } else if (exp.replyContains != null) {
            await nextFor(exp.thread, (e) => e.kind === 'message' && e.text.includes(exp.replyContains!), ms);
          }
        }
      } catch (error) {
        failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await platform.channelHub.stopAll();
    await platform.eventBus.close();
  }

  return { name: scenario.name, passed: failures.length === 0, failures, outbox: sim.outbox };
}
