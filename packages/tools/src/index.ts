import type { ToolAuditLogger, ToolExecutionInput, ToolExecutionResult } from '@anvio/core';
import type { Database } from '@anvio/db';
import { toolExecutions } from '@anvio/db';

export class PostgresToolAuditLogger implements ToolAuditLogger {
  constructor(private readonly db: Database) {}

  async log(input: ToolExecutionInput, result: ToolExecutionResult): Promise<void> {
    await this.db.insert(toolExecutions).values({
      sessionId: input.sessionId,
      toolName: input.toolName,
      input: input.input,
      output: result.output,
      status: result.status,
    });
  }
}

export class StubToolExecutor {
  async execute(_input: ToolExecutionInput): Promise<ToolExecutionResult> {
    return {
      id: crypto.randomUUID(),
      output: { message: 'Tool execution not implemented in Phase 1' },
      status: 'success',
    };
  }

  async listAvailable(_agentId: string): Promise<string[]> {
    return [];
  }
}
