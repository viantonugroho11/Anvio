#!/usr/bin/env node
/**
 * Minimal MCP stdio server for integration tests.
 * Implements initialize, tools/list, and tools/call for mock tools.
 */
import process from 'node:process';

const TOOLS = [
  {
    name: 'ping',
    description: 'Health check',
    inputSchema: { type: 'object', properties: { message: { type: 'string' } } },
  },
  {
    name: 'search_code',
    description: 'Mock code search',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
  },
];

let buffer = Buffer.alloc(0);

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  drain();
});

function drain() {
  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;

    const header = buffer.subarray(0, headerEnd).toString('utf-8');
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }

    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + length) return;

    const bodyText = buffer.subarray(bodyStart, bodyStart + length).toString('utf-8');
    buffer = buffer.subarray(bodyStart + length);

    let message;
    try {
      message = JSON.parse(bodyText);
    } catch {
      continue;
    }

    handleMessage(message);
  }
}

function send(payload) {
  const json = JSON.stringify(payload);
  const frame = `Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`;
  process.stdout.write(frame);
}

function handleMessage(message) {
  if (message.method === 'notifications/initialized') {
    return;
  }

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'anvio-mock-mcp', version: '1.0.0' },
      },
    });
    return;
  }

  if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { tools: TOOLS },
    });
    return;
  }

  if (message.method === 'tools/call') {
    const params = message.params ?? {};
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              tool: params.name,
              args: params.arguments ?? {},
            }),
          },
        ],
      },
    });
    return;
  }

  if (message.id != null) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    });
  }
}
