export interface HttpRequestInput {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export async function httpRequest(input: HttpRequestInput): Promise<{
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}> {
  const method = (input.method ?? 'GET').toUpperCase();
  const timeoutMs = input.timeoutMs ?? 15_000;
  const res = await fetch(input.url, {
    method,
    headers: input.headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : input.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.text();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return {
    url: input.url,
    status: res.status,
    headers,
    body: body.slice(0, 32_000),
  };
}
