# Security

## Default: No Authentication

Anvio runs with `auth.enabled: false` by default. Local tools work without login:

- Filesystem
- Local browser
- Local memory
- Local sessions

## Optional Auth Plugin

Enable only when required (MCP OAuth for GitHub, Google, Slack):

```yaml
spec:
  auth:
    enabled: true
    provider: oauth2
```

Providers: `none` (default), `jwt`, `oauth2`

## RBAC (Level 3+)

Role-based access when multi-user PostgreSQL deployment is enabled.

## Audit

Tool execution audit logs stored in `workspace/` (filesystem) or PostgreSQL (Level 3).

## Secrets

Environment variables for API keys. Vault/SSM for Level 4.

## Tool Bus policy layer (since v1.26.0)

`@anvio/tool-bus` provides a layered `ToolPolicy` schema that gates which tools an agent may invoke. Precedence chain: **default → tenant → project → agent**.

```ts
import { mergeToolPolicies, decideToolCall } from '@anvio/tool-bus';

const policy = mergeToolPolicies([
  { layer: 'default', policy: { denied: ['fs_delete'], requireApproval: ['exec'] } },
  { layer: 'project', policy: { allowed: ['fs_*', 'web_fetch'] } },
  { layer: 'agent',   policy: { allowed: ['fs_read', 'web_fetch'] } },
]);
// merged.allowed === ['fs_read', 'web_fetch']   (agent narrows project)
// merged.denied  contains  'fs_delete'          (denies union)
// merged.requireApproval contains 'exec'        (approval union)

const verdict = decideToolCall(policy, 'exec');
// { allowed: false, reason: 'notInAllowList' }
```

Merge semantics — enforced by 11 tests in `packages/tool-bus/src/policy.spec.ts`:

- **`allowed`**: intersects across layers; agent cannot broaden beyond project. Glob (`fs_*`) matches by prefix.
- **`denied`**: union — denies never soften.
- **`requireApproval`**: union — an approval gate at any layer applies.
- **`argumentOverrides` / `note`**: last non-empty layer wins.

`decideToolCall(policy, name)` returns `{ allowed: true, requiresApproval }` or `{ allowed: false, reason: 'blocked' | 'notInAllowList' }`. Denies win over the allow-list (a tool in `allowed` but also `denied` is `blocked`).

Runtime enforcement wiring is pending — schema + merge shipped v1.26.0, `DefaultAgentRuntime` consumption is the next slice.

## Spend budget enforcement (since v1.27.0)

`SpendBudgetLedger` (`@anvio/models`) enforces per-key USD caps at the router boundary:

```ts
const ledger = new SpendBudgetLedger();
ledger.setCap('tenant:acme', 100);   // 100 USD hard cap
const router = new ModelRouter({ storage, providers, spendBudget: ledger });
await router.chat({ messages, budgetKey: 'tenant:acme' });
```

- Router charges the ledger post-call using `estimateModelCostUsd` from the `ModelDescriptor` registry.
- Charges that would exceed the cap throw `AnvioError` code `MODEL_SPEND_BUDGET_EXCEEDED` (HTTP `402`) **without** being recorded — prior spend stays exact.
- Ledger is process-local. Multi-process budget enforcement is deferred to Epic 0 substrate ([ADR-0013 D3](adr/0013-model-gateway-evolution.md)).

## Soul-gated auto-evolution

`SoulDefinition.spec.evolution.allowAutoUpdate` — set `false` on a soul to block the runtime learning loop from writing skill drafts or memory nudges after a session. Enforced at both `onSessionCompleted` and `onToolUseCompleted` boundaries (see `packages/learning/src/index.ts`).

## Two-layer model auth

Model API keys and runtime OAuth are distinct and must not be conflated — see [ADR-0011](adr/0011-model-provider-auth-and-switching.md) D1. Setting `ANTHROPIC_API_KEY` in the same environment as `runtime.provider: claude-code` silently bills API credits instead of the OAuth subscription.
