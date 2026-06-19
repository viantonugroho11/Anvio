import type { EventSubject } from '@anvio/events';
import { EventSubjects } from '@anvio/events';

export interface DelegationEventPublisher {
  publish(subject: EventSubject, type: string, data: unknown): Promise<void>;
}

export interface DelegationProgressSnapshot {
  total: number;
  completed: number;
  failed: number;
  skipped: number;
}

export class DelegationProgressTracker {
  private completed = 0;
  private failed = 0;
  private skipped = 0;

  constructor(
    private readonly total: number,
    private readonly managerSessionId: string,
    private readonly publisher?: DelegationEventPublisher,
  ) {}

  async taskStarted(taskId: string, agentId: string): Promise<void> {
    await this.publish(EventSubjects.DELEGATION_TASK_STARTED, 'anvio.delegation.task.started', {
      managerSessionId: this.managerSessionId,
      taskId,
      agentId,
    });
  }

  async taskCompleted(taskId: string, agentId: string, summary: string): Promise<void> {
    this.completed += 1;
    await this.publish(EventSubjects.DELEGATION_TASK_COMPLETED, 'anvio.delegation.task.completed', {
      managerSessionId: this.managerSessionId,
      taskId,
      agentId,
      summary,
    });
  }

  async taskFailed(taskId: string, agentId: string, error: string): Promise<void> {
    this.failed += 1;
    await this.publish(EventSubjects.DELEGATION_TASK_FAILED, 'anvio.delegation.task.failed', {
      managerSessionId: this.managerSessionId,
      taskId,
      agentId,
      error,
    });
  }

  markSkipped(): void {
    this.skipped += 1;
  }

  snapshot(): DelegationProgressSnapshot {
    return {
      total: this.total,
      completed: this.completed,
      failed: this.failed,
      skipped: this.skipped,
    };
  }

  private async publish(subject: EventSubject, type: string, data: unknown): Promise<void> {
    if (!this.publisher) return;
    await this.publisher.publish(subject, type, data);
  }
}
