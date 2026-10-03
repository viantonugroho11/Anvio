# ADR-0036: Agent-managed skills and MCP servers

- **Status:** Accepted
- **Date:** 2026-10-03
- **Related:** ADR-0006 (MCP architecture), ADR-0023 (slash commands / skill promotion), `docs/77-skill-execution-engine.md`

## Context

Users asked an agent (over Telegram) to "add a skill" or "install an MCP server" and it could not. Inspection showed why:

- **Skills.** The agent-facing surface was `skills_list`, `skill_view`, `skill_call` (read/invoke) and `skill_manage`, which was disabled by default and only offered `list_drafts` and `promote`. The only way a new skill came into being was the learning loop at session end.
- **MCP.** `IntegrationRegistry` was read-only (`load/list/get`), and `platform` built the MCP tool catalog **once at boot** (`loadMcpToolCatalog`) and froze it into `McpToolPort`, which was only constructed when the catalog was non-empty. No tool exposed the registry to the agent, so even a hand-edited `servers.yaml` needed a restart.

## Decision

Evolve the existing pieces, don't add a subsystem.

1. **`skill_manage` gains `create`.** `create` writes a draft through the learning engine's existing `SkillEvolutionWriter` (`LearningEngine.createDraft`), so it lands in `workspace/skills/_drafts`. Going live is still `promote`, the same step every learning-loop draft passes through. The agent cannot write straight into `workspace/skills/`.
2. **New `mcp_manage` built-in tool** (`list | add | remove`), wired in `platform`:
   - `IntegrationRegistry.upsert/remove` persist `mcp/servers.yaml`. They edit the **raw YAML document**: the parsed config has `${ENV}` placeholders expanded, and writing it back would put every other server's secrets on disk in plain text. The result is validated with `parseMcpConfig` before it is written.
   - `McpToolPort.setCatalog()` swaps the catalog in place. Platform now **always** wraps the tool port with `McpToolPort` (a pass-through when empty), so a server added at runtime has somewhere to land. New tools appear on the agent's next turn.
   - `McpBridge.invalidate(id)` drops a cached stdio client after add/remove.
3. **Guard rails**
   - Both tools stay **`enabled: false`** by default in the tool gateway. An operator opts in per workspace.
   - `add` only accepts a bare `command` whose name is in the new `McpConfig.spec.agentAllowedCommands` (default `npx, uvx, node, python3, docker`). Paths are rejected. Humans editing `servers.yaml` directly are not constrained.
   - The existing MCP **first-call approval** gate still applies to every new tool, so a newly registered server cannot act until a human approves each tool once per session.
   - Ids and slugs are validated (lowercase, short) because they become file names and tool-name segments.

## Consequences

- An agent can now extend itself without a restart, behind two opt-ins (tool enabled, command allow-listed) and the per-tool approval gate.
- `add` spawns the server process to list its tools. That is code execution chosen by the model. The allow-list limits _which launcher_ runs, not _which package_: `npx -y <anything>` is still arbitrary code. That is why the tool is off by default. Operators who enable it in a channel exposed to untrusted users should narrow `agentAllowedCommands` or leave `mcp_manage` off.
- `env` passed by the agent is written in plain text. The tool description and ADR say to keep secrets in `${VAR}` placeholders.
- Removing a server whose tools were already approved leaves stale approval keys in session metadata. They are harmless because the tool no longer exists.

## Alternatives considered

- **Route add/remove through `anvio_channel__request_approval`.** Rejected for now: the approval flow pauses the run with a checkpoint, and resuming a built-in tool call after approval is not wired for built-ins. The first-call gate already gives a human checkpoint before any new tool runs. Revisit if built-in approval resume lands.
- **Let `create` write directly to `workspace/skills/`.** Rejected: it would bypass the soul-gated review that ADR-0023 established for drafts.
