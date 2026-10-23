# 07 — Security, Configuration & Dependencies

Confirmed findings are backed by code reads or `pnpm audit` output. "Potential" items are labelled and need validation. This is a code-quality audit, not a penetration test; no exploit was executed.

## 1. Security boundaries

| Boundary | Control present | Gap | Finding |
|---|---|---|---|
| Network → API/gateway | `assertSafeBinding` refuses non-loopback bind without auth (`unified-gateway.ts:150-158`); webhook signature checks (`platform/src/webhook-auth.ts`, well tested) | JWT secret defaults to `'dev-secret'` | **CQ-001 (CRITICAL, confirmed)** |
| LLM output → network | enable flags | `http_request`/`web_fetch` on by default, no SSRF/egress policy, full-body buffering | **CQ-002 (HIGH, confirmed)** |
| LLM output → code execution | disabled by default; docker mode with `--network none` | process mode inherits all secrets, no network isolation, direct-child kill only | **CQ-003 (HIGH, confirmed)** |
| LLM output → file system | workspace-root containment | prefix check without separator, no realpath, duplicated ×4 | **CQ-013 (MEDIUM, confirmed)** |
| LLM output → mutating actions | MCP first-use approval; harness approval when model asks | No enforced approval for builtin mutating tools; `tool-bus` policy unused | CQ-024, 05 §3 |
| Secrets at rest | AES-256-GCM + scrypt per record (`credentials/src/encrypted-store.ts`) with random salt/IV | Sync KDF (CQ-031); passphrase from env | OK |
| Secrets in transit/logs | — | Slack app token placed in WebSocket URL query (`slack.ts:189`) | CQ-008 (confirmed in code; impact on logs **potential**) |
| Model API key vs runtime OAuth | Documented and enforced in setup-token messages | — | OK (CLAUDE.md rule respected in code reviewed) |

## 2. Configuration

- **Centralized**: `workspace/anvio.yaml` parsed by zod schemas in `core`; `tools/gateway.yaml` likewise. Good.
- **Fail-open on bad config**: `ToolGateway.load` swallows parse/validation errors and applies defaults (CQ-012). For a security-relevant file this should fail closed.
- **Env reads scattered**: `process.env.*` read at call sites deep in packages (`tool-loop.ts:7`, `web_search` key, `ANVIO_SSH_MOCK`, `ANVIO_DOCKER_IMAGE`, `ANVIO_GATEWAY_*`). There is no single validated env schema; typos silently fall back to defaults.
- **Defaults consistency**: the tool defaults exist twice — YAML string `DEFAULT_TOOL_GATEWAY_YAML` (`gateway.ts:17-176`) and zod `.default()`s (`tool-gateway.schema.ts`). They agree for `http_request`/`web_fetch` today; nothing enforces that they stay in sync.
- **Mock provider fallback** without keys (CQ-030).
- **Test-only env hooks in production code**: `ANVIO_SSH_MOCK=1` turns `execRemote` into local `sh -c` (`ssh-runtime.ts:53-60`). Potential risk if set in a real environment; LOW.

## 3. Input validation

- Config/schema boundaries: strong (zod).
- Webhooks: signature verification module with 386-line spec — strong.
- Tool arguments from the model: coerced, not validated (04 §6). Validating against the advertised JSON schema (ajv or zod-from-schema) would turn silent mis-coercions into model-visible errors.
- Persisted checkpoint: cast without validation (CQ-023).

## 4. Dependencies (`pnpm audit --prod`, executed 2026-10-24)

Result: **32 advisories — 2 critical, 12 high, 17 moderate, 1 low.** Critical and high:

| Severity | Package | Installed | Patched | Path (first) | Advisory |
|---|---|---|---|---|---|
| critical | next | 15.5.24 | ≥15.5.28 | `apps/web > next` | GHSA-2464-fhr4-w9xw |
| critical | proxy-addr | 2.0.7 | ≥2.0.8 | `platform > @a2a-js/sdk > …` | GHSA-jqcg-44mw-7w3h |
| high | next | 15.5.24 | ≥15.5.28 | `apps/web > next` | GHSA-p3m5-59mp-jv5r |
| high | @modelcontextprotocol/sdk | 1.30.0 | ≥1.31.0 / ≥1.32.0 | `platform > runtimes > …` | GHSA-6qxp-vccf-f47h, GHSA-22jm-h49p-29qw, GHSA-46jr-4wx8-v453 |
| high | multer | 2.2.0 | ≥2.3.0 | `apps/api > @nestjs/platform-express` | GHSA-wc9g-mqfw-jrwm, GHSA-qfvm-cv95-jqjf, GHSA-535w-7cp7-47q4 |
| high | brace-expansion | 5.0.9 | ≥5.0.11 | `apps/api > observability > @opentelemetry…` | GHSA-qhr7-859c-m2p7, GHSA-6j4f-fj2g-mc7p |
| high | source-map-js | 1.2.1 | ≥1.2.2 | `apps/web > next > postcss` | GHSA-68fv-2mgg-jv7q |
| high | zod | 3.25.76, 4.4.3 | ≥4.6.6 | `channels > core > zod` | GHSA-mrhx-c7xc-m3w5 |

Observations:
- The root `pnpm.overrides` already target several of these, but with floors that are now stale: `"multer@<2.2.0": ">=2.2.0"` and `"brace-expansion": ">=5.0.9"` resolve to the vulnerable versions. Overrides were written as one-off patches and not revisited.
- Two zod majors (3.25 and 4.4) are installed concurrently.
- Exploitability per advisory (e.g. whether `apps/web` is internet-exposed, whether A2A uses `trust proxy`) **NOT VERIFIED**. Treat as CQ-016 (HIGH) until triaged.
- Deprecated/abandoned packages and unused dependencies: not analysed with tooling (depcheck/knip not installed) — **NOT VERIFIED**. Manual evidence of one unused dependency edge: `tools → @anvio/db` (CQ-024).

## 5. Secret management

- Credentials encrypted at rest; passphrase supplied via `ANVIO_CREDENTIALS_PASSPHRASE`; pool manager absent when unset (documented in `platform-context.ts:26`).
- Runtime OAuth tokens stored under `workspace/connections/` (encrypted per ADR-0009; implementation not re-audited here).
- Secrets exposure paths found: sandbox env inheritance (CQ-003), Slack token in URL (CQ-008), JWT default (CQ-001). Logs: 384 `console.*` calls — a sampled subset prints `error.message` only; no evidence of secrets logged was found, but there is no redaction layer (**potential**).

## 6. Unsafe dynamic behaviour

- Dynamic `import('@anvio/events')` in `local-event-bus.ts:87` for NATS — static specifier, safe.
- `new Function` in two places (grep over `apps/*/src`, `packages/*/src`, non-spec):
  - `skills/src/executor.ts:190` — skill step conditions from YAML evaluated as host JavaScript → **CQ-034 (HIGH)**. Third-party skill import makes this a supply-chain trust boundary.
  - `tools/src/builtins/index.ts:139` — `execute_code` in-process fallback when no executor is injected → **CQ-033 (MEDIUM)**.
- No `eval(` / `vm.Script` in source.
- Skill YAML and SOUL.md parsing via `yaml` — safe loader by default (the parse is safe; what the skill *does* is not — see CQ-034).

## 7. Confirmed vs potential

| Confirmed | Potential (needs validation) |
|---|---|
| CQ-001 JWT default secret | Slack token appearing in proxy/access logs |
| CQ-034 skill conditions run as host JS; CQ-033 in-process eval fallback | Whether bundled/imported catalog skills already use non-trivial conditions |
| CQ-002 SSRF/exfil-capable defaults | DNS-rebinding bypass of any future host filter (design concern) |
| CQ-003 sandbox env leak / no net isolation | Breaker opened by one tenant affecting others (06 §6) |
| CQ-013 containment prefix bug | `ANVIO_SSH_MOCK` misuse |
| CQ-016 advisories present in lockfile | Reachability of each advisory |
| CQ-024 policy layer unused | Secrets in logs |

## 8. Recommendations

1. CQ-001 fail-fast (S) — ship immediately.
2. CQ-002: default `http_request` off, egress guard, streamed body cap (M).
3. CQ-003: env allowlist, process-group kill, output cap (S). CQ-034: replace `new Function` skill conditions with a restricted evaluator (S–M); CQ-033: remove in-process `execute_code` fallback (S).
4. CQ-016: bump `next`, MCP SDK, `@a2a-js/sdk`, NestJS; fix override floors; add `pnpm audit --audit-level=high` to CI (S–M).
5. CQ-013: shared `resolveInside` with realpath (S).
6. Make `tools/gateway.yaml` load fail closed (S).
7. One validated env schema in `core` for all `ANVIO_*` variables (M).
