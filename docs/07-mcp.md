# MCP Architecture

MCP is first-class via registry pattern.

## Components

- Registry — discovery, registration
- Client Pool — connection management
- Auth — per-server credentials
- Adapters — bridge to ToolPort

Agents call McpToolPort.execute(), never import servers directly.
