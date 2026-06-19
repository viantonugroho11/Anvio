import type { AutomationDefinition } from '@anvio/core';
import { parseAutomationDefinition } from '@anvio/core';
import { EventSubjects } from '@anvio/events';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml } from 'yaml';
import { cronMatches } from './cron-parser.js';
import type { ActionExecutor } from './action-executor.js';
import { FilesystemAutomationStateStore } from './filesystem-state-store.js';

export interface AutomationEventBus {
  subscribeCore(
    subject: string,
    handler: (event: { data: unknown }) => Promise<void>,
  ): Promise<() => void>;
  publish(subject: string, type: string, data: unknown): Promise<void>;
}

export interface AutomationEngineOptions {
  userId: string;
  eventBus: AutomationEventBus;
}

export class CronScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private automations: AutomationDefinition[] = [];

  constructor(
    private readonly stateStore: FilesystemAutomationStateStore,
    private readonly onTrigger: (automation: AutomationDefinition) => Promise<void>,
  ) {}

  setAutomations(automations: AutomationDefinition[]): void {
    this.automations = automations.filter(
      (a) => a.metadata.enabled && a.spec.trigger.type === 'cron',
    );
  }

  start(intervalMs = 60_000): void {
    this.stop();
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(now = new Date()): Promise<string[]> {
    const triggered: string[] = [];
    for (const automation of this.automations) {
      const trigger = automation.spec.trigger;
      if (trigger.type !== 'cron') continue;
      if (!cronMatches(trigger.schedule, now)) continue;

      const state = await this.stateStore.get(automation.metadata.slug);
      if (state.lastRunAt) {
        const last = new Date(state.lastRunAt);
        if (
          last.getFullYear() === now.getFullYear() &&
          last.getMonth() === now.getMonth() &&
          last.getDate() === now.getDate() &&
          last.getHours() === now.getHours() &&
          last.getMinutes() === now.getMinutes()
        ) {
          continue;
        }
      }

      await this.onTrigger(automation);
      triggered.push(automation.metadata.slug);
    }
    return triggered;
  }

  listCronAutomations(): AutomationDefinition[] {
    return this.automations;
  }
}

export class AutomationRegistry {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  async loadAll(): Promise<AutomationDefinition[]> {
    const files = await this.storage.list('automations');
    const automations: AutomationDefinition[] = [];

    for (const file of files.filter(
      (f) => (f.endsWith('.yaml') || f.endsWith('.yml')) && !f.includes('_state'),
    )) {
      const raw = await this.storage.read(file);
      if (!raw) continue;
      automations.push(parseAutomationDefinition(parseYaml(raw)));
    }

    return automations;
  }

  async get(slug: string): Promise<AutomationDefinition | null> {
    for (const ext of ['yaml', 'yml']) {
      const raw = await this.storage.read(`automations/${slug}.${ext}`);
      if (raw) return parseAutomationDefinition(parseYaml(raw));
    }
    return null;
  }
}

export class AutomationEngine {
  private cronScheduler: CronScheduler;
  private unsubscribers: Array<() => void | Promise<void>> = [];

  constructor(
    private readonly registry: AutomationRegistry,
    private readonly stateStore: FilesystemAutomationStateStore,
    private readonly actionExecutor: ActionExecutor,
    private readonly options: AutomationEngineOptions,
  ) {
    this.cronScheduler = new CronScheduler(stateStore, (automation) => this.runAutomation(automation));
  }

  async start(): Promise<void> {
    await this.stop();
    const automations = await this.registry.loadAll();
    this.cronScheduler.setAutomations(automations);

    for (const automation of automations) {
      if (!automation.metadata.enabled) continue;
      await this.subscribeAutomation(automation);
    }

    this.cronScheduler.start();
  }

  async stop(): Promise<void> {
    this.cronScheduler.stop();
    for (const unsub of this.unsubscribers) await unsub();
    this.unsubscribers = [];
  }

  async run(slug: string, force = false): Promise<void> {
    const automation = await this.registry.get(slug);
    if (!automation) throw new Error(`Automation not found: ${slug}`);
    if (!automation.metadata.enabled && !force) throw new Error(`Automation disabled: ${slug}`);
    await this.runAutomation(automation);
  }

  async list(): Promise<AutomationDefinition[]> {
    return this.registry.loadAll();
  }

  getCronScheduler(): CronScheduler {
    return this.cronScheduler;
  }

  private async subscribeAutomation(automation: AutomationDefinition): Promise<void> {
    const trigger = automation.spec.trigger;
    if (trigger.type === 'event') {
      const unsub = await this.options.eventBus.subscribeCore(trigger.event, async (event) => {
        if (trigger.filter && !matchesFilter(trigger.filter, event.data as Record<string, unknown>)) {
          return;
        }
        await this.runAutomation(automation, event.data as Record<string, unknown>);
      });
      this.unsubscribers.push(unsub);
    }

    if (trigger.type === 'goal') {
      const subjectMap = {
        'goal.created': EventSubjects.GOAL_CREATED,
        'goal.completed': EventSubjects.GOAL_COMPLETED,
        'goal.progress.updated': EventSubjects.GOAL_PROGRESS_UPDATED,
      } as const;
      const subject = subjectMap[trigger.event];
      const unsub = await this.options.eventBus.subscribeCore(subject, async (event) => {
        const data = event.data as { goalSlug?: string };
        if (trigger.goalSlug && trigger.goalSlug !== data.goalSlug) return;
        await this.runAutomation(automation, data as Record<string, unknown>);
      });
      this.unsubscribers.push(unsub);
    }
  }

  private async runAutomation(
    automation: AutomationDefinition,
    eventPayload?: Record<string, unknown>,
  ): Promise<void> {
    const slug = automation.metadata.slug;
    await this.options.eventBus.publish(
      EventSubjects.AUTOMATION_STARTED,
      'anvio.automation.started',
      { slug },
    );

    const result = await this.actionExecutor.execute(automation, {
      userId: this.options.userId,
      eventPayload,
    });

    await this.stateStore.recordRun(slug, result.status === 'completed' ? 'completed' : 'failed');

    if (result.status === 'completed') {
      await this.options.eventBus.publish(
        EventSubjects.AUTOMATION_COMPLETED,
        'anvio.automation.completed',
        { slug },
      );
      await this.options.eventBus.publish(
        EventSubjects.WORKFLOW_COMPLETED,
        'anvio.workflow.completed',
        { workflowId: slug, status: 'completed' },
      );
    } else {
      await this.options.eventBus.publish(EventSubjects.AUTOMATION_FAILED, 'anvio.automation.failed', {
        slug,
        error: result.error,
      });
    }
  }
}

function matchesFilter(filter: Record<string, string>, payload: Record<string, unknown>): boolean {
  return Object.entries(filter).every(([key, expected]) => String(payload[key] ?? '') === expected);
}

export function createAutomationEngine(deps: {
  storage: FilesystemStorageProvider;
  actionExecutor: ActionExecutor;
  userId: string;
  eventBus: AutomationEventBus;
}): AutomationEngine {
  return new AutomationEngine(
    new AutomationRegistry(deps.storage),
    new FilesystemAutomationStateStore(deps.storage),
    deps.actionExecutor,
    { userId: deps.userId, eventBus: deps.eventBus },
  );
}
