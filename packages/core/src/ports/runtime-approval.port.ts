/**
 * Bridge for runtimes that gate their own tool execution (the Claude Code
 * Agent SDK's `canUseTool`, and any vendor with an equivalent hook).
 *
 * Those runtimes never reach `packages/tools`, so the harness approval flow
 * that hangs off the tool gateway cannot see them — approvals were simply
 * skipped on `runtime: claude-code` (issue #69). A runtime holds its tool
 * call open on the promise this port returns; the platform resolves it when
 * a human answers on the channel, or when the approval times out.
 */
export interface RuntimeApprovalRequest {
  sessionId: string;
  agentId: string;
  userId: string;
  /** Channel the approval prompt should be delivered on. */
  channel: string;
  /** Vendor-side tool name, e.g. `Bash` or `mcp__github__create_issue`. */
  toolName: string;
  /** Human-readable one-line description of what the tool is about to do. */
  summary: string;
  input: Record<string, unknown>;
}

export interface RuntimeApprovalOutcome {
  approved: boolean;
  reason?: string;
}

export interface RuntimeApprovalPort {
  requestApproval(request: RuntimeApprovalRequest): Promise<RuntimeApprovalOutcome>;
}
