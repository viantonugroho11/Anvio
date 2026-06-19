# Phase P1 — Channel Harness & Contextual Connections (2026)

**Status:** Active  
**Depends on:** [52-phase-k-priorities.md](./52-phase-k-priorities.md) P0 complete (v1.4.0)

P1 closes harness depth and per-user contextual connections before voice/desktop breadth (P2).

---

## Priority stack

| ID | Deliverable | Status |
|----|-------------|--------|
| C3 | Harness enabled + multi-channel regression suite | ✅ Phase P1 |
| S4 | OAuth login-host callback (local grant capture) | ✅ Phase P1 |
| S5 | Per-user connection isolation + thread grants | ✅ Phase P1 |

---

## 1. Channel Harness depth (C3)

- `workspace/harness/defaults.yaml` → `enabled: true`
- Regression tests: Slack, Telegram, Discord, Web engagement + output suppression
- CLI: `anvio harness status|simulate`

**Profiles:** `workspace/harness/channel-profiles.yaml`

---

## 2. Contextual Connections (S4–S5)

| Component | Package |
|-----------|---------|
| Encrypted store (AES-256-GCM) | `@anvio/harness` `ConnectionStore` |
| Thread-scoped broker | `ConnectionBroker` |
| OAuth callback host | `startLoginHost()` |
| Per-user isolation | `getPayloadForAccess()` + grants |

**CLI:**

```bash
export ANVIO_CONNECTION_ENCRYPTION_KEY='your-secret'
anvio connect list
anvio connect put --service github --payload '{"token":"..."}' --thread T1
anvio connect login-host --service github --port 9876
anvio connect revoke --service github
```

**Config:** `workspace/harness/defaults.yaml` → `connectBroker.enabled: true`

---

## Success criteria (P1)

1. Harness simulation passes for telegram/discord/web-chat profiles
2. User A connection payload not readable by User B without grant
3. Borrowed grant works only on granted thread
4. Login-host captures OAuth callback query params
5. `anvio connect list` shows encrypted connection metadata (no plaintext)

---

## Related

- [41-channel-harness.md](./41-channel-harness.md)
- [39-editor-integration.md](./39-editor-integration.md)
- [51-gap-hermes-slaude.md](./51-gap-hermes-slaude.md)
