import type { FilesystemStorageProvider } from '@anvio/storage';

export interface AutomationRunState {
  slug: string;
  lastRunAt: string | null;
  lastStatus: 'completed' | 'failed' | 'skipped';
  runCount: number;
}

export class FilesystemAutomationStateStore {
  constructor(
    private readonly storage: FilesystemStorageProvider,
    private readonly prefix = 'automations/_state',
  ) {}

  private key(slug: string): string {
    return `${this.prefix}/${slug}.json`;
  }

  async get(slug: string): Promise<AutomationRunState> {
    const existing = await this.storage.readJson<AutomationRunState>(this.key(slug));
    return (
      existing ?? {
        slug,
        lastRunAt: null,
        lastStatus: 'skipped',
        runCount: 0,
      }
    );
  }

  async recordRun(slug: string, status: AutomationRunState['lastStatus']): Promise<void> {
    const state = await this.get(slug);
    await this.storage.writeJson(this.key(slug), {
      ...state,
      lastRunAt: new Date().toISOString(),
      lastStatus: status,
      runCount: state.runCount + 1,
    });
  }
}
