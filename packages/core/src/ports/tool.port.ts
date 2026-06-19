export interface ToolExecutionInput {
  sessionId: string;
  toolName: string;
  input: Record<string, unknown>;
  agentId: string;
}

export interface ToolExecutionResult {
  id: string;
  output: Record<string, unknown>;
  status: 'success' | 'failed' | 'pending_approval';
}

export interface ToolExecutor {
  execute(input: ToolExecutionInput): Promise<ToolExecutionResult>;
  listAvailable(agentId: string): Promise<string[]>;
}

export interface ToolAuditLogger {
  log(input: ToolExecutionInput, result: ToolExecutionResult): Promise<void>;
}
