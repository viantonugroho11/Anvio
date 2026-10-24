/**
 * Scheduler (automation engine) through the real platform: cron dispatch, run
 * state persistence across restart, failure isolation, bad definitions.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { EventSubjects } from '@anvio/events';
import {
  bootE2E,
  gatewayYaml,
  lastToolResult,
  lastUserText,
  ProgrammableProvider,
  removeWorkspace,
  type E2EHarness,
} from './harness.js';

/**
 * Engine start runs one real-time tick, so fixtures use schedules that cannot
 * match "now" (24 February) and the tests drive ticks with synthetic times.
 */
const NEVER_NOW = '0 0 1 1 *';
function automation(slug: string, agent: string, input: string, schedule = NEVER_NOW): string {
  return [
    'apiVersion: anvio.io/v1',
    'kind: Automation',
    'metadata:',
    `  slug: ${slug}`,
    '  enabled: true',
    'spec:',
    '  trigger:',
    '    type: cron',
    `    schedule: "${schedule}"`,
    '    timezone: UTC',
    '  action:',
    '    type: agent',
    `    agent: ${agent}`,
    `    input: ${JSON.stringify(input)}`,
  ].join('\n');
}

const harnesses: E2EHarness[] = [];
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.shutdown();
    await removeWorkspace(h.workspacePath);
  }
});

describe('scheduler', () => {
  it('SCH-01 manual run executes the agent action and records state', async () => {
    const provider = new ProgrammableProvider((req) => ({ text: `ran: ${lastUserText(req)}` }));
    const h = await bootE2E({
      provider,
      files: { 'automations/daily.yaml': automation('daily', 'e2e', 'daily report') },
    });
    harnesses.push(h);
    const completed: string[] = [];
    await h.platform.eventBus.subscribeCore(EventSubjects.AUTOMATION_COMPLETED, async (e) => {
      completed.push((e.data as { slug: string }).slug);
    });
    await h.platform.automationEngine.run('daily');
    expect(provider.requests.some((r) => lastUserText(r) === 'daily report')).toBe(true);
    expect(completed).toEqual(['daily']);
  });

  it('SCH-02 cron tick fires once per minute and survives a restart without re-firing', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'ok' }));
    const files = {
      'automations/every-minute.yaml': automation('every-minute', 'e2e', 'tick', '* 10 24 2 *'),
    };
    const first = await bootE2E({ provider, files });
    const now = new Date('2027-02-24T10:15:00Z');
    const scheduler = first.platform.automationEngine.getCronScheduler();
    expect(await scheduler.tick(now)).toEqual(['every-minute']);
    expect(await scheduler.tick(new Date(now.getTime() + 20_000))).toEqual([]);
    await first.shutdown();

    const second = await bootE2E({ provider, workspacePath: first.workspacePath });
    harnesses.push(second);
    const again = second.platform.automationEngine.getCronScheduler();
    expect(await again.tick(new Date(now.getTime() + 30_000))).toEqual([]);
    expect(await again.tick(new Date(now.getTime() + 60_000))).toEqual(['every-minute']);
  });

  it('SCH-03 a failing automation does not stop the others in the same tick', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'ok' }));
    const h = await bootE2E({
      provider,
      files: {
        'automations/a-broken.yaml': automation('a-broken', 'no-such-agent', 'x', '0 11 24 2 *'),
        'automations/b-healthy.yaml': automation('b-healthy', 'e2e', 'healthy run', '0 11 24 2 *'),
      },
    });
    harnesses.push(h);
    const failed: string[] = [];
    await h.platform.eventBus.subscribeCore(EventSubjects.AUTOMATION_FAILED, async (e) => {
      failed.push((e.data as { slug: string }).slug);
    });
    const fired = await h.platform.automationEngine
      .getCronScheduler()
      .tick(new Date('2027-02-24T11:00:00Z'));
    expect(fired).toContain('b-healthy');
    expect(failed).toEqual(['a-broken']);
    expect(provider.requests.some((r) => lastUserText(r) === 'healthy run')).toBe(true);
  }, 20_000);

  it('SCH-05 schedules are evaluated in the automation timezone', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'ok' }));
    const tz = automation('jakarta-9am', 'e2e', 'morning', '0 9 24 2 *').replace(
      'timezone: UTC',
      'timezone: Asia/Jakarta',
    );
    const h = await bootE2E({ provider, files: { 'automations/jakarta.yaml': tz } });
    harnesses.push(h);
    const scheduler = h.platform.automationEngine.getCronScheduler();
    // 09:00 in Jakarta (UTC+7) is 02:00 UTC.
    expect(await scheduler.tick(new Date('2027-02-24T09:00:00Z'))).toEqual([]);
    expect(await scheduler.tick(new Date('2027-02-24T02:00:00Z'))).toEqual(['jakarta-9am']);
  });

  it('SCH-04 a malformed automation file does not prevent boot or the valid automations', async () => {
    const provider = new ProgrammableProvider(() => ({ text: 'ok' }));
    const h = await bootE2E({
      provider,
      files: {
        'automations/bad.yaml':
          'apiVersion: anvio.io/v1\nkind: Automation\nmetadata: {}\nspec: [not, valid',
        'automations/good.yaml': automation('good', 'e2e', 'still scheduled', '0 12 24 2 *'),
      },
    });
    harnesses.push(h);
    const fired = await h.platform.automationEngine
      .getCronScheduler()
      .tick(new Date('2027-02-24T12:00:00Z'));
    expect(fired).toEqual(['good']);
  });

  it('SCH-06 cronjob create stores model-supplied text as data, not as YAML structure', async () => {
    // A prompt that, pasted into a YAML template, would rewrite the trigger.
    const injected = 'hi\n  trigger:\n    type: cron\n    schedule: "* * * * *"';
    const provider = new ProgrammableProvider((req) => {
      const tool = lastToolResult(req);
      if (!tool) {
        return {
          toolCalls: [
            {
              name: 'anvio_tools__cronjob',
              arguments: {
                action: 'create',
                slug: 'nightly',
                schedule: '0 3 * * *',
                agent: 'e2e',
                prompt: injected,
              },
            },
            {
              name: 'anvio_tools__cronjob',
              arguments: {
                action: 'create',
                slug: '../escape',
                schedule: '0 3 * * *',
                agent: 'e2e',
              },
            },
            {
              name: 'anvio_tools__cronjob',
              arguments: {
                action: 'create',
                slug: 'bad-cron',
                schedule: 'every day',
                agent: 'e2e',
              },
            },
          ],
        };
      }
      return { text: 'done' };
    });
    const h = await bootE2E({
      provider,
      files: { 'tools/gateway.yaml': gatewayYaml(['cronjob']) },
    });
    harnesses.push(h);
    const sessionId = await h.say('schedule it');
    await h.reply(sessionId);

    const stored = parseYaml(
      await fs.readFile(path.join(h.workspacePath, 'automations/nightly.yaml'), 'utf-8'),
    );
    expect(stored.spec.trigger).toMatchObject({
      type: 'cron',
      schedule: '0 3 * * *',
      timezone: 'UTC',
    });
    expect(stored.spec.action.input).toBe(injected);
    const results = provider.requests
      .at(-1)!
      .messages.filter((m) => m.role === 'tool')
      .map((m) => m.content);
    expect(results.filter((r) => r.includes('failed'))).toHaveLength(2);
    await expect(fs.stat(path.join(h.workspacePath, 'escape.yaml'))).rejects.toThrow();
  });
});
