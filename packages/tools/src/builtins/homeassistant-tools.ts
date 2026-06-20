import type { BuiltinToolResult } from '@anvio/core';

function haConfig(): { baseUrl: string; token: string } | null {
  const baseUrl = process.env.HOME_ASSISTANT_URL ?? process.env.HA_URL;
  const token = process.env.HOME_ASSISTANT_TOKEN ?? process.env.HA_TOKEN;
  if (!baseUrl || !token) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

async function haFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = haConfig();
  if (!cfg) throw new Error('Set HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN (or HA_URL / HA_TOKEN)');
  return fetch(`${cfg.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });
}

function haFail(tool: string, error: unknown): BuiltinToolResult {
  return {
    name: `anvio_tools__${tool}`,
    output: null,
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
  };
}

export async function haListEntities(domain?: string): Promise<BuiltinToolResult> {
  try {
    const res = await haFetch('/api/states');
    if (!res.ok) return haFail('ha_list_entities', `HTTP ${res.status}`);
    const states = (await res.json()) as Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }>;
    const filtered = domain
      ? states.filter((s) => s.entity_id.startsWith(`${domain}.`))
      : states;
    return {
      name: 'anvio_tools__ha_list_entities',
      output: {
        count: filtered.length,
        entities: filtered.slice(0, 100).map((s) => ({
          entity_id: s.entity_id,
          state: s.state,
          friendly_name: s.attributes.friendly_name,
        })),
      },
      status: 'completed',
    };
  } catch (error) {
    return haFail('ha_list_entities', error);
  }
}

export async function haGetState(entityId: string): Promise<BuiltinToolResult> {
  try {
    const res = await haFetch(`/api/states/${encodeURIComponent(entityId)}`);
    if (!res.ok) return haFail('ha_get_state', `HTTP ${res.status}`);
    const state = await res.json();
    return { name: 'anvio_tools__ha_get_state', output: { state }, status: 'completed' };
  } catch (error) {
    return haFail('ha_get_state', error);
  }
}

export async function haListServices(): Promise<BuiltinToolResult> {
  try {
    const res = await haFetch('/api/services');
    if (!res.ok) return haFail('ha_list_services', `HTTP ${res.status}`);
    const services = await res.json();
    return { name: 'anvio_tools__ha_list_services', output: { services }, status: 'completed' };
  } catch (error) {
    return haFail('ha_list_services', error);
  }
}

export async function haCallService(
  domain: string,
  service: string,
  entityId?: string,
  data?: Record<string, unknown>,
): Promise<BuiltinToolResult> {
  try {
    const body: Record<string, unknown> = { ...(data ?? {}) };
    if (entityId) body.entity_id = entityId;
    const res = await haFetch(`/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (!res.ok) return haFail('ha_call_service', `HTTP ${res.status}`);
    const result = await res.json().catch(() => ({}));
    return {
      name: 'anvio_tools__ha_call_service',
      output: { domain, service, entityId, result },
      status: 'completed',
    };
  } catch (error) {
    return haFail('ha_call_service', error);
  }
}
