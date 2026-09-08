/** A2A v1.0 Push Notification Config — webhook delivery for async updates. */

export interface AuthenticationInfo {
  apiKey?: string;
  basicAuth?: { username: string; password: string };
  bearerToken?: string;
  custom?: { headerName: string; headerValue: string };
}

export interface TaskPushNotificationConfig {
  id?: string;
  taskId?: string;
  url: string;
  token?: string;
  authentication?: AuthenticationInfo;
}
