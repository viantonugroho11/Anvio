import type { ExecutionAuditRecord } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { randomUUID } from 'node:crypto';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export class ExecutionAuditLog {
  constructor(private readonly storage: FilesystemStorageProvider) {}

  async write(record: ExecutionAuditRecord): Promise<void> {
    const key = `audit/executions/${record.auditId}.yaml`;
    await this.storage.write(key, stringifyYaml(record));
  }

  createAuditId(): string {
    return `exec-${randomUUID().slice(0, 12)}`;
  }

  async get(auditId: string): Promise<ExecutionAuditRecord | null> {
    const raw = await this.storage.read(`audit/executions/${auditId}.yaml`);
    if (!raw) return null;
    return parseYaml(raw) as ExecutionAuditRecord;
  }
}
