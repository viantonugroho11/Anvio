import fs from 'node:fs/promises';
import path from 'node:path';
import { mcpServerSpecSchema, parseMcpConfig, type McpServerSpec } from '@anvio/core';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

function presetPath(workspaceRoot: string, name: string): string {
  return path.join(workspaceRoot, 'mcp', 'presets', `${name}.yaml.example`);
}

function parsePresetServers(raw: string): Record<string, McpServerSpec> {
  const parsed = parseYaml(raw) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Preset must be a YAML map of server id → server spec');
  }
  const servers: Record<string, McpServerSpec> = {};
  for (const [id, spec] of Object.entries(parsed)) {
    servers[id] = mcpServerSpecSchema.parse(spec);
  }
  return servers;
}

/** List preset names from workspace/mcp/presets/*.yaml.example */
export async function listMcpPresets(workspaceRoot: string): Promise<string[]> {
  const dir = path.join(workspaceRoot, 'mcp', 'presets');
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((file) => file.endsWith('.yaml.example') || file.endsWith('.yml.example'))
      .map((file) => file.replace(/\.ya?ml\.example$/, ''))
      .sort();
  } catch {
    return [];
  }
}

/** Merge a preset into workspace/mcp/servers.yaml; returns merged server ids. */
export async function applyMcpPreset(workspaceRoot: string, presetName: string): Promise<string[]> {
  const file = presetPath(workspaceRoot, presetName);
  let raw: string;
  try {
    raw = await fs.readFile(file, 'utf-8');
  } catch {
    throw new Error(`Preset not found: ${presetName} (expected ${file})`);
  }

  const presetServers = parsePresetServers(raw);
  const serversPath = path.join(workspaceRoot, 'mcp', 'servers.yaml');
  let configRaw: string;
  try {
    configRaw = await fs.readFile(serversPath, 'utf-8');
  } catch {
    configRaw = `apiVersion: anvio.io/v1
kind: McpConfig
metadata:
  name: default
spec:
  firstCallApproval: true
  servers: {}
`;
  }

  const config = parseMcpConfig(parseYaml(configRaw));
  for (const [id, server] of Object.entries(presetServers)) {
    config.spec.servers[id] = server;
  }

  await fs.mkdir(path.dirname(serversPath), { recursive: true });
  await fs.writeFile(serversPath, stringifyYaml(config), 'utf-8');
  return Object.keys(presetServers);
}
