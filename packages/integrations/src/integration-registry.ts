import type { McpConfig, McpServerSpec } from '@anvio/core';
import { parseMcpConfig } from '@anvio/core';
import type { FilesystemStorageProvider } from '@anvio/storage';
import { parse as parseYaml } from 'yaml';

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
      this.config = {
        apiVersion: 'anvio.io/v1',
        kind: 'McpConfig',
        metadata: { name: 'default' },
        spec: { servers: {} },
      };
      return this.config;
    }
    this.config = parseMcpConfig(parseYaml(raw));
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
}

export function createIntegrationRegistry(storage: FilesystemStorageProvider): IntegrationRegistry {
  return new IntegrationRegistry(storage);
}
