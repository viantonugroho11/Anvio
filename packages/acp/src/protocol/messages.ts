export interface AcpHealthResponse {
  status: 'ok';
  version: string;
  protocol: 'anvio-acp/v1';
}

export interface AcpPromptRequest {
  agent: string;
  message: string;
  userId?: string;
  sessionId?: string;
}

export interface AcpPromptResponse {
  sessionId: string;
  content: string;
  status: string;
}

export interface AcpErrorResponse {
  error: string;
  code?: string;
}

export type AcpRunHandler = (request: AcpPromptRequest) => Promise<AcpPromptResponse>;

export interface AcpServerConfig {
  host: string;
  port: number;
}

export interface AcpServerStatus {
  running: boolean;
  host: string;
  port: number;
  connections: number;
}
