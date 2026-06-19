import type {
  CodeExecutionRequest,
  CodeExecutionResult,
  CodeExecutor,
  CodeRuntime,
} from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { ExecutionAuditLog } from './audit-log.js';
import { runInProcessSandbox } from './sandbox/process-sandbox.js';

export interface CodeExecutorDeps {
  storage: FilesystemStorageProvider;
  workspaceRoot: string;
  defaultTimeoutMs?: number;
  networkEnabled?: boolean;
  allowedRuntimes?: CodeRuntime[];
}

export class DefaultCodeExecutor implements CodeExecutor {
  private readonly audit: ExecutionAuditLog;

  constructor(private readonly deps: CodeExecutorDeps) {
    this.audit = new ExecutionAuditLog(deps.storage);
  }

  async execute(request: CodeExecutionRequest): Promise<CodeExecutionResult> {
    const allowed = this.deps.allowedRuntimes ?? ['shell', 'python', 'node', 'go'];
    if (!allowed.includes(request.runtime)) {
      throw new Error(`Runtime not allowed: ${request.runtime}`);
    }

    const auditId = this.audit.createAuditId();
    const startedAt = new Date().toISOString();
    const cwd = request.cwd ?? this.deps.workspaceRoot;
    const networkEnabled = request.networkEnabled ?? this.deps.networkEnabled ?? false;

    const sandbox = await runInProcessSandbox({
      runtime: request.runtime,
      code: request.code,
      cwd,
      env: request.env ?? {},
      timeoutMs: request.timeoutMs || this.deps.defaultTimeoutMs || 30_000,
      networkEnabled,
    });

    const completedAt = new Date().toISOString();
    const result: CodeExecutionResult = {
      exitCode: sandbox.exitCode,
      stdout: sandbox.stdout,
      stderr: sandbox.stderr,
      durationMs: sandbox.durationMs,
      auditId,
    };

    await this.audit.write({
      auditId,
      runtime: request.runtime,
      code: request.code,
      cwd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      startedAt,
      completedAt,
      networkEnabled,
    });

    return result;
  }
}

export function createCodeExecutor(deps: CodeExecutorDeps): CodeExecutor {
  return new DefaultCodeExecutor(deps);
}
