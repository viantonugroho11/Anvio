/**
 * Concurrency and load through the real platform (gateway worker, runtime, storage,
 * memory, channel hub). The model is scripted with a fixed latency, so the numbers
 * measure Anvio's own overhead and scheduling — not any real provider.
 *
 * Assertions are about correctness under load (no lost or interleaved turns, the
 * concurrency cap holds, resources are released). Timings are recorded, not
 * asserted, except for coarse "did not hang" bounds. Set ANVIO_LOAD_REPORT to a
 * file path to get the measurements as JSON; ANVIO_LOAD_SESSIONS / _TURNS / _CAP /
 * _LATENCY_MS scale the main scenario.
 */
import fs from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { EventSubjects } from '@anvio/events';
import {
  bootE2E,
  lastUserText,
  ProgrammableProvider,
  removeWorkspace,
  sleep,
  type E2EHarness,
} from './harness.js';

const SESSIONS = Number(process.env.ANVIO_LOAD_SESSIONS ?? 40);
const TURNS = Number(process.env.ANVIO_LOAD_TURNS ?? 3);
const CAP = Number(process.env.ANVIO_LOAD_CAP ?? 8);
const LATENCY_MS = Number(process.env.ANVIO_LOAD_LATENCY_MS ?? 50);

const report: Record<string, unknown> = {
  environment: {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    storage: 'filesystem (Level 1)',
    model: `scripted, ${LATENCY_MS} ms per call`,
  },
};

afterAll(async () => {
  if (process.env.ANVIO_LOAD_REPORT) {
    await fs.writeFile(process.env.ANVIO_LOAD_REPORT, JSON.stringify(report, null, 2));
  }
});

const harnesses: E2EHarness[] = [];
afterEach(async () => {
  delete process.env.ANVIO_MAX_CONCURRENT_RUNS;
  for (const h of harnesses.splice(0)) {
    await h.shutdown();
    await removeWorkspace(h.workspacePath);
  }
});

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

function summarize(latencies: number[]) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    count: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? 0,
  };
}

/** Resource types keeping the loop alive, as a multiset. */
function activeResources(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const type of process.getActiveResourcesInfo()) counts[type] = (counts[type] ?? 0) + 1;
  return counts;
}

function grewBy(
  before: Record<string, number>,
  after: Record<string, number>,
): Record<string, number> {
  const grown: Record<string, number> = {};
  for (const [type, n] of Object.entries(after)) {
    const delta = n - (before[type] ?? 0);
    if (delta > 0) grown[type] = delta;
  }
  return grown;
}

describe('load and concurrency', () => {
  it(`LOAD-01 ${SESSIONS} sessions × ${TURNS} turns concurrently — every turn answered, histories intact, cap ${CAP} holds`, async () => {
    process.env.ANVIO_MAX_CONCURRENT_RUNS = String(CAP);
    const resourcesBefore = activeResources();
    const provider = new ProgrammableProvider((req) => ({
      text: `ack ${lastUserText(req)}`,
      delayMs: LATENCY_MS,
    }));
    const h = await bootE2E({ provider });

    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    if (global.gc) global.gc();
    const memBefore = process.memoryUsage();
    const cpuBefore = process.cpuUsage();
    const failures: string[] = [];
    await h.platform.eventBus.subscribeCore(EventSubjects.AGENT_RUN_FAILED, async (e) => {
      failures.push((e.data as { error: string }).error);
    });

    const latencies: number[] = [];
    const sessionIds: string[] = [];
    const started = performance.now();
    await Promise.all(
      Array.from({ length: SESSIONS }, async (_, s) => {
        const thread = `load-${s}`;
        const user = `webchat:load-${s}`;
        for (let t = 0; t < TURNS; t++) {
          const cursor = h.channel.outbox.length;
          const sent = performance.now();
          const sessionId = await h.say(`s${s}-t${t}`, thread, user);
          const { text } = await h.reply(sessionId, cursor, 60_000);
          latencies.push(performance.now() - sent);
          expect(text).toBe(`ack s${s}-t${t}`);
          if (t === 0) sessionIds[s] = sessionId;
        }
      }),
    );
    const wallMs = performance.now() - started;
    loop.disable();
    const cpu = process.cpuUsage(cpuBefore);
    const memAfter = process.memoryUsage();

    // Every session holds exactly its own turns, in order.
    for (let s = 0; s < SESSIONS; s++) {
      const stored = await h.platform.workspace.sessions.get(sessionIds[s]!);
      const expected = Array.from({ length: TURNS }, (_, t) => [
        `s${s}-t${t}`,
        `ack s${s}-t${t}`,
      ]).flat();
      expect(stored?.messages.map((m) => m.content)).toEqual(expected);
      expect(stored?.status).toBe('completed');
    }
    expect(failures).toEqual([]);
    expect(provider.peakActive).toBeLessThanOrEqual(CAP);

    await h.shutdown();
    await removeWorkspace(h.workspacePath);
    await sleep(200);
    const leaked = grewBy(resourcesBefore, activeResources());

    report.load01 = {
      sessions: SESSIONS,
      turnsPerSession: TURNS,
      concurrencyCap: CAP,
      turns: latencies.length,
      wallMs: Math.round(wallMs),
      throughputTurnsPerSec: Number(((latencies.length / wallMs) * 1000).toFixed(1)),
      latencyMs: Object.fromEntries(
        Object.entries(summarize(latencies)).map(([k, v]) => [k, Math.round(v)]),
      ),
      errorRate: failures.length / latencies.length,
      peakConcurrentModelCalls: provider.peakActive,
      eventLoopDelayMs: {
        p50: Number((loop.percentile(50) / 1e6).toFixed(1)),
        p99: Number((loop.percentile(99) / 1e6).toFixed(1)),
        max: Number((loop.max / 1e6).toFixed(1)),
      },
      cpuMs: { user: Math.round(cpu.user / 1000), system: Math.round(cpu.system / 1000) },
      memoryMB: {
        rssBefore: Math.round(memBefore.rss / 1048576),
        rssAfter: Math.round(memAfter.rss / 1048576),
        heapUsedBefore: Math.round(memBefore.heapUsed / 1048576),
        heapUsedAfter: Math.round(memAfter.heapUsed / 1048576),
      },
      activeResourcesLeftAfterShutdown: leaked,
    };
    expect(leaked).toEqual({});
  }, 300_000);

  it('LOAD-02 burst of 10 messages into one session → turns serialized, none lost', async () => {
    const provider = new ProgrammableProvider((req) => ({
      text: `ack ${lastUserText(req)}`,
      delayMs: 30,
    }));
    const h = await bootE2E({ provider });
    harnesses.push(h);
    const first = await h.say('m0', 'burst', 'webchat:burst');
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => h.say(`m${i + 1}`, 'burst', 'webchat:burst')),
    );
    const deadline = Date.now() + 15_000;
    for (;;) {
      const stored = await h.platform.workspace.sessions.get(first);
      if (stored?.messages.length === 20 && stored.status === 'completed') break;
      if (Date.now() > deadline) throw new Error(`only ${stored?.messages.length} messages stored`);
      await sleep(25);
    }
    const stored = await h.platform.workspace.sessions.get(first);
    const users = stored!.messages.filter((m) => m.role === 'user').map((m) => m.content);
    expect(new Set(users)).toEqual(new Set(Array.from({ length: 10 }, (_, i) => `m${i}`)));
    // Each answer directly follows its question: no interleaving.
    for (let i = 0; i < 20; i += 2) {
      expect(stored!.messages[i + 1]!.content).toBe(`ack ${stored!.messages[i]!.content}`);
    }
    expect(provider.peakActive).toBe(1);
    report.load02 = {
      messages: 10,
      stored: stored!.messages.length,
      peakConcurrentModelCalls: provider.peakActive,
    };
  }, 30_000);

  it('LOAD-03 stopping half of 20 in-flight streams → stopped ones end fast, the rest complete', async () => {
    const provider = new ProgrammableProvider((req) => {
      const text = lastUserText(req);
      if (text.startsWith('stop-')) {
        return {
          stream: async function* () {
            yield { type: 'text_delta', delta: 'working…' };
            await sleep(30_000, req.signal);
            yield { type: 'done' };
          },
        };
      }
      return { text: `done ${text}`, delayMs: 300 };
    });
    process.env.ANVIO_MAX_CONCURRENT_RUNS = '32';
    const h = await bootE2E({ provider });
    harnesses.push(h);

    // Only the to-be-stopped streams emit "working…", which tells us their session ids.
    const toStop = new Set<string>();
    await h.platform.eventBus.subscribeCore(EventSubjects.AGENT_RUN_CHUNK, async (e) => {
      const { sessionId, delta } = e.data as { sessionId: string; delta: string };
      if (delta === 'working…') toStop.add(sessionId);
    });
    const pending = Array.from({ length: 20 }, (_, i) =>
      h.say(`${i % 2 === 0 ? 'stop' : 'keep'}-${i}`, `c-${i}`, `webchat:c-${i}`),
    );
    const deadline = Date.now() + 5_000;
    while ((provider.active < 20 || toStop.size < 10) && Date.now() < deadline) await sleep(10);
    expect(provider.active).toBe(20);
    expect(toStop.size).toBe(10);

    const stopStarted = performance.now();
    await Promise.all(
      [...toStop].map((sessionId) =>
        h.platform.eventBus.publish(
          EventSubjects.AGENT_RUN_STOP_REQUESTED,
          'anvio.agent.run.stop',
          { sessionId },
        ),
      ),
    );
    const ids = await Promise.all(pending);
    const settledMs = performance.now() - stopStarted;

    let stopped = 0;
    let completed = 0;
    for (const id of ids) {
      const stored = await h.platform.workspace.sessions.get(id);
      if (stored?.status === 'failed') stopped++;
      if (stored?.status === 'completed') completed++;
    }
    expect(stopped).toBe(10);
    expect(completed).toBe(10);
    // The stopped streams were sleeping for 30 s; ending well before that proves cancellation.
    expect(settledMs).toBeLessThan(5_000);
    expect(provider.active).toBe(0);
    report.load03 = {
      inFlight: 20,
      stopped,
      completed,
      allSettledAfterStopMs: Math.round(settledMs),
    };
  }, 30_000);

  it('LOAD-04 shutdown with 10 turns in flight (cap 8) → shutdown returns, restart repairs running sessions, none stuck', async () => {
    const provider = new ProgrammableProvider((req) => ({
      stream: async function* () {
        await sleep(30_000, req.signal);
        yield { type: 'done' };
      },
    }));
    const first = await bootE2E({ provider });
    const inFlight = Array.from({ length: 10 }, (_, i) =>
      first.say(`long-${i}`, `sd-${i}`, `webchat:sd-${i}`),
    );
    const deadline = Date.now() + 5_000;
    while (provider.active < 8 && Date.now() < deadline) await sleep(10);
    await sleep(100);
    // Default cap: 8 run, 2 wait for a slot.
    expect(provider.active).toBe(8);

    const shutdownStarted = performance.now();
    await first.shutdown();
    const shutdownMs = performance.now() - shutdownStarted;
    const activeAfterShutdown = provider.active;

    const second = await bootE2E({
      provider: new ProgrammableProvider(() => ({ text: 'back' })),
      workspacePath: first.workspacePath,
    });
    harnesses.push(second);
    const statuses: Record<string, number> = {};
    let repaired = 0;
    for (const s of await second.platform.workspace.sessions.list()) {
      const stored = await second.platform.workspace.sessions.get(s.id);
      statuses[stored!.status] = (statuses[stored!.status] ?? 0) + 1;
      if (stored?.metadata?.interruptedAt) repaired++;
    }
    // Nothing may be left looking "in progress" after a restart.
    expect(statuses.calling_model ?? 0).toBe(0);
    expect(repaired).toBe(8);
    report.load04 = {
      sentBeforeShutdown: 10,
      runningAtShutdown: 8,
      queuedAtShutdown: 2,
      shutdownMs: Math.round(shutdownMs),
      modelCallsStillRunningAfterShutdown: activeAfterShutdown,
      sessionStatusesAfterRestart: statuses,
      repairedOnRestart: repaired,
    };
    // Shutdown does not cancel turns already running; abandon them so the file can end.
    void Promise.allSettled(inFlight);
  }, 30_000);
});
