const BASE = process.env.NEXT_PUBLIC_API_URL ?? '';

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, { next: { revalidate: 5 } });
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

export interface Overview {
  sessions: { total: number; active: number };
  agents: { total: number };
  tools: { total: number; enabled: number };
  health: { status: string; uptime: number };
}

export interface Session {
  id: string;
  agentName: string;
  channel: string;
  status: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
  messages?: Array<{ role: string; content: string; timestamp?: string }>;
}

export interface Agent {
  name: string;
  description?: string;
  spec: Record<string, unknown>;
}

export interface ToolEntry {
  name: string;
  enabled: boolean;
}
