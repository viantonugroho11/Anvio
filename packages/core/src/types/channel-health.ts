import type { ChannelType } from '../types/common.js';

export type ChannelHealthState =
  | 'healthy'
  | 'degraded'
  | 'disabled'
  | 'misconfigured'
  | 'unreachable';

export interface ChannelHealthReport {
  channel: ChannelType;
  status: ChannelHealthState;
  message: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface ChannelHealthProbe {
  healthCheck(): Promise<ChannelHealthReport>;
}
