/** A2A v1.0 request/response types for protocol operations. */

import type { Message } from './message.js';
import type { Task } from './task.js';
import type { TaskPushNotificationConfig } from './push-notification.js';

export interface SendMessageRequest {
  tenant?: string;
  message: Message;
  configuration?: SendMessageConfiguration;
  metadata?: Record<string, unknown>;
}

export interface SendMessageConfiguration {
  acceptedOutputModes?: string[];
  taskPushNotificationConfig?: TaskPushNotificationConfig;
  historyLength?: number;
  returnImmediately?: boolean;
}

export interface GetTaskRequest {
  id: string;
  historyLength?: number;
}

export interface ListTasksRequest {
  contextId?: string;
  pageSize?: number;
  pageToken?: string;
}

export interface ListTasksResponse {
  tasks: Task[];
  nextPageToken: string;
  pageSize: number;
  totalSize: number;
}

export interface CancelTaskRequest {
  id: string;
}
