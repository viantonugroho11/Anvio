export type CodeRuntime = 'shell' | 'python' | 'node' | 'go' | 'docker';

export interface CodeExecutionRequest {
  runtime: CodeRuntime;
  code: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  memoryLimitMb?: number;
  networkEnabled?: boolean;
}

export interface CodeExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  auditId: string;
}

export interface CodeExecutor {
  execute(request: CodeExecutionRequest): Promise<CodeExecutionResult>;
}

export interface ExecutionAuditRecord {
  auditId: string;
  runtime: CodeRuntime;
  code: string;
  cwd?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  networkEnabled: boolean;
}
