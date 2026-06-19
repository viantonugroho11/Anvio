export interface WorktreeInfo {
  sessionId: string;
  path: string;
  branch: string;
  repoPath: string;
  createdAt: string;
}

export interface WorktreeManager {
  create(sessionId: string): Promise<WorktreeInfo>;
  get(sessionId: string): Promise<WorktreeInfo | null>;
  remove(sessionId: string): Promise<void>;
  list(): Promise<WorktreeInfo[]>;
}
