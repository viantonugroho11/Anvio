# Soul Gate (Phase G)

Enforces harness policy from Hermes/slaude-style **SOUL.md** — trust boundaries, approvers, allowed channels.

## Import & validate

```bash
anvio soul import path/to/SOUL.md
anvio soul validate-policy path/to/SOUL.md
```

`parseSoulMd` (regex-first) extracts policy fields:

| Section | Policy field |
|---------|----------------|
| Identity | name, role, voice |
| Reporting | manager, backup |
| Allowed channels | allowedZones |
| Trusted channels | trustedZones |
| Blocked | blockedUsers |
| Approvers | approvers |
| Redaction | redactPatterns |
| Mandate | mandate |

Verified policies are cached under `workspace/souls/_cache/`.

## Soul identity vs policy

| File | Purpose |
|------|---------|
| `souls/<slug>/SOUL.md` | Identity layer (values, personality, goals) — Hermes-style |
| Root or channel `SOUL.md` | Policy gate for harness (slaude-style) |

Both formats are markdown. YAML souls remain supported for legacy workspaces.

## Related

- [25-soul-system.md](./25-soul-system.md)
- [41-channel-harness.md](./41-channel-harness.md)
