export interface WebhookHandlerOptions {
  url: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

export async function runWebhookHandler(
  payload: Record<string, unknown>,
  options: WebhookHandlerOptions,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  try {
    const response = await fetch(options.url, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      body: JSON.stringify({ ...options.body, payload }),
      signal: controller.signal,
    });

    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}
