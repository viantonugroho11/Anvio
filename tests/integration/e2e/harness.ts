/**
 * End-to-end harness: a real platform (workspace, storage, memory, tool gateway,
 * event bus, gateway worker, harness, channel hub) booted from a temp copy of the
 * repo's sample workspace. Only the model is scripted, and the channel is the
 * in-process SimulatedChannel — nothing leaves the machine.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChatRequest, ModelProvider, ModelToolCall, StreamChunk } from '@anvio/core';
import { SimulatedChannel } from '@anvio/channels';
import {
  createPlatform,
  prepareSimulationWorkspace,
  registerGatewayWorker,
  type PlatformContext,
} from '@anvio/platform';

export const repoRoot = path.resolve(__dirname, '../../..');

const ZERO = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** What the scripted model does for one call. */
export type ModelStep =
  | { text: string; delayMs?: number }
  | { toolCalls: Array<{ name: string; arguments?: Record<string, unknown> }>; text?: string }
  | { error: string; retryable?: boolean }
  | { stream: (request: ChatRequest) => AsyncIterable<StreamChunk> };

/**
 * Scripted provider. `respond` picks a step from the request, so tests can branch on
 * what the model is shown (system prompt, latest tool result, history).
 */
export class ProgrammableProvider implements ModelProvider {
  readonly providerId = 'scripted';
  readonly supportsNativeTools = true;
  readonly requests: ChatRequest[] = [];
  private seq = 0;
  active = 0;
  peakActive = 0;

  constructor(private readonly respond: (request: ChatRequest, callIndex: number) => ModelStep) {}

  async chat(): Promise<never> {
    throw new Error('chat() not used by the agent loop');
  }

  async *stream(request: ChatRequest): AsyncIterable<StreamChunk> {
    const index = this.requests.length;
    this.requests.push(request);
    this.active++;
    this.peakActive = Math.max(this.peakActive, this.active);
    try {
      const step = this.respond(request, index);
      if ('stream' in step) {
        yield* step.stream(request);
        return;
      }
      if ('error' in step) {
        yield { type: 'error', error: step.error, retryable: step.retryable };
        return;
      }
      if ('toolCalls' in step) {
        if (step.text) yield { type: 'text_delta', delta: step.text };
        const calls: ModelToolCall[] = step.toolCalls.map((c) => ({
          id: `call-${++this.seq}`,
          name: c.name,
          arguments: c.arguments ?? {},
        }));
        for (const toolCall of calls) yield { type: 'tool_use', toolCall };
        yield { type: 'done', usage: ZERO, finishReason: 'tool_use' };
        return;
      }
      if (step.delayMs) await sleep(step.delayMs, request.signal);
      yield { type: 'text_delta', delta: step.text };
      yield { type: 'done', usage: ZERO, finishReason: 'end_turn' };
    } finally {
      this.active--;
    }
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Last tool-result message the model was shown, if any. */
export function lastToolResult(request: ChatRequest): string | undefined {
  return [...request.messages].reverse().find((m) => m.role === 'tool')?.content;
}

export function lastUserText(request: ChatRequest): string {
  return [...request.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
}

export interface E2EOptions {
  provider: ModelProvider;
  /** Extra files written into the workspace before boot (path relative to the workspace). */
  files?: Record<string, string>;
  /** Reuse an existing workspace directory (for restart tests). */
  workspacePath?: string;
  channelType?: 'webchat' | 'slack' | 'telegram' | 'discord';
}

export interface E2EHarness {
  platform: PlatformContext;
  channel: SimulatedChannel;
  workspacePath: string;
  /** Send a DM to the agent on `thread`; resolves once the inbound handler returns. */
  say(text: string, thread?: string, userId?: string): Promise<string>;
  /** Wait for the next outbound message on a session after the given cursor. */
  reply(
    sessionId: string,
    from?: number,
    timeoutMs?: number,
  ): Promise<{ text: string; index: number }>;
  /** Wait until a session's stored status matches. */
  waitForStatus(sessionId: string, status: string | string[], timeoutMs?: number): Promise<void>;
  shutdown(): Promise<void>;
}

/** A gateway.yaml enabling the given builtin tools on top of the defaults. */
export function gatewayYaml(enable: string[], network?: { allowHosts?: string[] }): string {
  const tools = enable.map((t) => `    ${t}:\n      enabled: true`).join('\n');
  const net = network?.allowHosts
    ? `  network:\n    allowPrivateNetwork: false\n    allowHosts: [${network.allowHosts.map((h) => `"${h}"`).join(', ')}]\n`
    : '';
  return `apiVersion: anvio.io/v1\nkind: ToolGateway\nmetadata:\n  name: e2e\nspec:\n  enabled: true\n  tools:\n${tools}\n${net}`;
}

/**
 * Persona file. The system prompt comes from the persona, not from the agent's
 * Markdown body (which only feeds the description), so tests that branch on the
 * system prompt need a persona of their own.
 */
export function personaMd(name: string, prompt: string): string {
  return `---\nname: ${name}\ndescription: ${name} e2e persona\nversion: "1.0.0"\n---\n\n# ${name}\n\n${prompt}\n`;
}

/** Minimal local agent: no soul, no vendor runtime. */
export function agentMd(
  name: string,
  opts: { skills?: string[]; system?: string; persona?: string } = {},
): string {
  const skills = opts.skills?.length
    ? `skills:\n${opts.skills.map((s) => `  - ${s}`).join('\n')}\n`
    : 'skills: []\n';
  return `---\npersona: ${opts.persona ?? 'architect'}\n${skills}model:\n  provider: anthropic\n  model: scripted-model\n  maxTokens: 1024\ndescription: ${name} e2e agent\n---\n\n${opts.system ?? `You are ${name}.`}\n`;
}

export async function bootE2E(options: E2EOptions): Promise<E2EHarness> {
  const workspacePath =
    options.workspacePath ?? (await prepareSimulationWorkspace(path.join(repoRoot, 'workspace')));
  const files = { 'agents/e2e.md': agentMd('e2e'), ...(options.files ?? {}) };
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(workspacePath, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
  }

  let channel: SimulatedChannel | undefined;
  const platform = await createPlatform({
    workspacePath,
    repoRoot,
    simulation: {
      modelProvider: options.provider,
      adapters: ({ sessionBridge, onApproval }) => {
        channel = new SimulatedChannel({
          channelType: options.channelType ?? 'webchat',
          sessionBridge,
          onApproval,
          defaultAgent: 'e2e',
        });
        return [channel];
      },
    },
  });
  await registerGatewayWorker(platform);
  const sim = channel!;

  return {
    platform,
    channel: sim,
    workspacePath,
    // Slack's profile only lets the manager DM the bot, so there the message is an
    // in-thread mention; elsewhere a DM.
    say: (text, thread = 't1', userId = 'webchat:u1') =>
      sim.say({
        userId,
        threadId: thread,
        text,
        isDm: options.channelType !== 'slack',
        mentionedBot: true,
      }),
    async reply(sessionId, from = 0, timeoutMs = 5_000) {
      const hit = await sim.waitFor(
        // Progress bubbles ("🔄 Calling model") are messages too on non-live surfaces.
        (e) =>
          e.sessionId === sessionId &&
          e.kind === 'message' &&
          !e.metadata?.progress &&
          sim.outbox.indexOf(e) >= from,
        timeoutMs,
      );
      return { text: hit.kind === 'message' ? hit.text : '', index: sim.outbox.indexOf(hit) };
    },
    async waitForStatus(sessionId, status, timeoutMs = 5_000) {
      const wanted = Array.isArray(status) ? status : [status];
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const stored = await platform.workspace.sessions.get(sessionId);
        if (stored && wanted.includes(stored.status)) return;
        if (Date.now() > deadline) {
          throw new Error(
            `session ${sessionId} status ${stored?.status} never became ${wanted.join('|')}`,
          );
        }
        await sleep(20);
      }
    },
    shutdown: () => platform.shutdown(),
  };
}

export async function removeWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
