# ADR-0012: zod 3 → 4 migration — deferred

## Status

Proposed — deferred to a dedicated migration story.

## Context

`@anthropic-ai/claude-agent-sdk >=0.3.228` peer-requires `zod@^4.0.0`. Anvio currently uses `zod@^3.25.28` in `packages/core` and `packages/knowledge` (via 51 schema files). Attempting a naive `zod: ^4.0.0` bump surfaces two systemic breaking changes:

1. **`z.record(schema)` signature change** — zod 4 requires an explicit key schema: `z.record(z.string(), schema)`. 26 call sites in `packages/core/src/schemas/*`.
2. **`.default({})` no longer accepts partial object** — zod 4 requires the default literal (or factory) to match the full inferred type of the parent object schema. 25 call sites in `packages/core/src/schemas/*`, plus every nested schema with `.default({ someKey: 'x' })` where sibling keys have their own `.default(...)`. This cascades through `workspace.schema.ts`, `tool-gateway.schema.ts`, `workflow.schema.ts`, `automation.schema.ts`, and `harness.schema.ts`.

Additional zod 4 changes to verify per-file: discriminated-union API rewrite, `.superRefine()` renamed to `.check()`, `z.function()` removed, error format flatter (`error.issues` vs `error.errors`), `.optional().default()` interaction, `z.string().datetime()` → `z.iso.datetime()`.

## Decision

Do not force zod 4 as part of the security/observability release train. Keep zod 3 pinned; treat the peer-dep warning from `@anthropic-ai/claude-agent-sdk` as advisory. The Claude Code runtime path is exercised via integration tests today and no runtime zod incompatibility has been observed.

Schedule a dedicated migration story before the next SDK major bump that hard-requires zod 4:

1. Codemod pass: `z.record(x)` → `z.record(z.string(), x)` across `packages/core/src/schemas/**` and `packages/knowledge/src/**`.
2. Audit every `.default(...)` and either (a) provide the complete literal, (b) convert to `.default(() => …)` factory returning the fully-typed shape, or (c) mark the field `.optional()` and shift the default into the consumer.
3. Rename `.superRefine` → `.check`, replace `z.function()` usages, update error handling paths that read `.errors` to read `.issues`.
4. Bump `@anthropic-ai/sdk` to the version tagged for zod 4 compatibility (see ADR-0013 candidate: SDK 0.52 → 0.93 bump) in the same story so the peer graph resolves cleanly.
5. Run the full 291-test suite plus the P1.S6 golden trajectory replay (once captured) to catch any silent parse-shape drift.

## Consequences

- **Positive**: current release ships with zero regressions; schema-parsing surface stays stable.
- **Negative**: the peer warning persists on `pnpm install`. New Claude Agent SDK features that assume zod 4 idioms cannot be consumed without doing the migration first.
- **Mitigation**: gate this ADR on the SDK-side dependency actually failing at runtime (not just at install-time). Reopen the story when a shipping SDK feature requires a zod 4 idiom in Anvio call sites.
