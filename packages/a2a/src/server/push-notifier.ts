import type { TaskPushNotificationConfig } from '../types/push-notification.js';
import type { StreamEvent } from '../types/index.js';

/**
 * Delivers A2A push notification webhooks.
 * Manages per-task webhook configs and delivers events via HTTP POST.
 */
export class PushNotifier {
  private readonly configs = new Map<string, TaskPushNotificationConfig[]>();
  private idCounter = 0;

  addConfig(taskId: string, config: TaskPushNotificationConfig): TaskPushNotificationConfig {
    const stored: TaskPushNotificationConfig = {
      ...config,
      id: config.id ?? `pnc_${++this.idCounter}`,
      taskId,
    };
    const list = this.configs.get(taskId) ?? [];
    list.push(stored);
    this.configs.set(taskId, list);
    return stored;
  }

  getConfig(taskId: string, configId: string): TaskPushNotificationConfig | undefined {
    return this.configs.get(taskId)?.find((c) => c.id === configId);
  }

  listConfigs(taskId: string): TaskPushNotificationConfig[] {
    return this.configs.get(taskId) ?? [];
  }

  deleteConfig(taskId: string, configId: string): boolean {
    const list = this.configs.get(taskId);
    if (!list) return false;
    const idx = list.findIndex((c) => c.id === configId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    return true;
  }

  async deliver(taskId: string, event: StreamEvent): Promise<void> {
    const list = this.configs.get(taskId);
    if (!list?.length) return;

    const body = JSON.stringify(event);
    const deliveries = list.map(async (config) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (config.authentication?.bearerToken) {
          headers['Authorization'] = `Bearer ${config.authentication.bearerToken}`;
        } else if (config.authentication?.apiKey) {
          headers['X-API-Key'] = config.authentication.apiKey;
        } else if (config.authentication?.custom) {
          headers[config.authentication.custom.headerName] =
            config.authentication.custom.headerValue;
        }
        await fetch(config.url, { method: 'POST', headers, body });
      } catch (err) {
        console.error(
          `[A2A] Push notification delivery failed for ${config.url}:`,
          err instanceof Error ? err.message : err,
        );
      }
    });

    await Promise.allSettled(deliveries);
  }
}
