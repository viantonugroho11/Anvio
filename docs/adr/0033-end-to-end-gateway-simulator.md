# ADR 0033: End-to-End Gateway Simulator Without Live Channels

## Status

Proposed

## Context

slaude ships `bun run sim`: the same `createGateway` used in production, wired to an in-memory transport, so engagement, approvals and replies can be verified with no Slack workspace. Its CI relies on it heavily (299 test files vs Anvio's 126 spec files).

Anvio has a narrower piece of this:

- `packages/harness/src/simulation/transport.ts` (`SimulationTransport`, `runSimulationScenario`) and `anvio harness simulate` replay `InboundEnvelope`s through `HarnessGateway.handleInbound`.
- That only exercises the **inbound gate** (`InboundGateResult`). It does not run the agent turn, tool calls, approval prompts and their resolution, outbound formatting (`formatForChannel`), or session resume.
- End-to-end checks today require real channel credentials or ad-hoc mocks per test.

## Decision

Grow the existing simulator into a full-turn harness rather than adding a second one:

1. **`SimulatedChannelAdapter`** in `packages/channels` implementing the normal adapter interface, recording outbound messages, edits, uploads and approval prompts in memory, and accepting scripted inbound events (messages, button clicks / approval responses).
2. **Platform wiring.** `createPlatform({ channels: 'simulated' })` registers only the simulated adapter, so the real `ChannelHub`, harness, runtime and tool gateway run unchanged.
3. **Deterministic model.** A `scripted` model provider in `packages/models` returns canned responses and tool calls from the scenario file, so scenarios need no API key and are reproducible in CI.
4. **Scenario format.** YAML under `tests/simulation/*.scenario.yaml` with `steps` (inbound event or approval response) and `expect` (engagement state, outbound text after channel formatting, approval requested/resolved, tool executed). `anvio harness simulate --scenario <file>` runs one; `tests/integration` runs all.

## Consequences

- Engagement (ADR 0032), approvals and channel formatting become testable end-to-end at Level 1 with no credentials.
- The scripted model provider must stay out of production routing: it is registered only when the platform is created in simulation mode.
- Scenario files become a contract for harness behaviour; changing approval or engagement semantics requires updating them, which is intended.
- Live-channel quirks (rate limits, Slack `mrkdwn` edge cases, webhook auth from ADR 0021) remain untested by the simulator and still need adapter-level unit tests.

## Alternatives considered

- **Mock each adapter per test.** Rejected: that is the status quo and drifts from production wiring.
- **Record/replay real Slack traffic.** Rejected for now: needs credentials and leaks workspace data into fixtures.
