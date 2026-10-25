#!/usr/bin/env node
// A real MCP server built with the official @modelcontextprotocol/sdk and its
// stdio transport — used to check protocol compatibility of Anvio's MCP client.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sdk = path.resolve(
  here,
  '../../../../packages/runtimes/node_modules/@modelcontextprotocol/sdk/dist/esm',
);
const { McpServer } = await import(pathToFileURL(path.join(sdk, 'server/mcp.js')).href);
const { StdioServerTransport } = await import(
  pathToFileURL(path.join(sdk, 'server/stdio.js')).href
);
const { z } = await import(
  pathToFileURL(path.resolve(here, '../../../../packages/runtimes/node_modules/zod/index.js')).href
);

const server = new McpServer({ name: 'anvio-e2e-official', version: '1.0.0' });
server.tool(
  'add',
  'Add two numbers given as a and b',
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: 'text', text: String(a + b) }],
  }),
);
server.tool('whoami', 'Report the server identity', async () => ({
  content: [{ type: 'text', text: 'official-sdk-server' }],
}));
await server.connect(new StdioServerTransport());
