import type { McpConfig, McpServerSpec } from '@anvio/core';
import { expandEnvDeep, parseMcpConfig } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface IntegrationEntry {
  id: string;
  server: McpServerSpec;
  enabled: boolean;
}

export class IntegrationRegistry {
  private config: McpConfig | null = null;

  constructor(private readonly storage: FilesystemStorageProvider) {}

  async load(): Promise<McpConfig> {
    const raw = await this.storage.read('mcp/servers.yaml');
    if (!raw) {
      const config = parseMcpConfig({
        apiVersion: 'anvio.io/v1',
        kind: 'McpConfig',
        metadata: { name: 'default' },
        spec: { firstCallApproval: true, servers: {} },
      });
      this.config = config;
      return config;
    }
    this.config = parseMcpConfig(expandEnvDeep(parseYaml(raw)));
    return this.config;
  }

  async list(): Promise<IntegrationEntry[]> {
    const config = this.config ?? (await this.load());
    return Object.entries(config.spec.servers).map(([id, server]) => ({
      id,
      server,
      enabled: server.enabled,
    }));
  }

  async get(id: string): Promise<IntegrationEntry | null> {
    const config = this.config ?? (await this.load());
    const server = config.spec.servers[id];
    if (!server) return null;
    return { id, server, enabled: server.enabled };
  }

  async listEnabled(): Promise<IntegrationEntry[]> {
    return (await this.list()).filter((entry) => entry.enabled);
  }

  /** Add or replace a server and persist servers.yaml (ADR-0036). */
  async upsert(id: string, server: McpServerSpec): Promise<void> {
    await this.editRaw((servers) => {
      servers[id] = server;
    });
  }

  /** Remove a server; returns false when it was not registered. */
  async remove(id: string): Promise<boolean> {
    const config = this.config ?? (await this.load());
    if (!config.spec.servers[id]) return false;
    await this.editRaw((servers) => {
      delete servers[id];
    });
    return true;
  }

  /**
   * Edits the raw YAML document, not the parsed config: the parsed copy has
   * `${ENV}` placeholders expanded, and writing it back would put every other
   * server's secrets on disk in plain text.
   */
  private async editRaw(mutate: (servers: Record<string, unknown>) => void): Promise<void> {
    const raw = await this.storage.read('mcp/servers.yaml');
    const doc = (raw ? parseYaml(raw) : null) ?? {
      apiVersion: 'anvio.io/v1',
      kind: 'McpConfig',
      metadata: { name: 'default' },
      spec: { firstCallApproval: true, servers: {} },
    };
    doc.spec ??= {};
    doc.spec.servers ??= {};
    mutate(doc.spec.servers);
    // Validate before writing so a bad spec never lands on disk.
    parseMcpConfig(expandEnvDeep(doc));
    await this.storage.write('mcp/servers.yaml', stringifyYaml(doc));
    await this.load();
  }
}

export function createIntegrationRegistry(storage: FilesystemStorageProvider): IntegrationRegistry {
  return new IntegrationRegistry(storage);
}
