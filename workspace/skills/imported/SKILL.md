---
name: memory-maintenance
description: Consolidate Hermes MEMORY.md and USER.md within char limits
tags: [memory, maintenance]
---

# Memory Maintenance

## When to use

User asks to clean memory, memory is full, or facts are stale/outdated.

## Rules (Hermes)

- MEMORY.md: facts only (~2200 chars), not procedures
- USER.md: user preferences (~1375 chars)
- Changes apply next session, not mid-session prompt

## Steps

1. Read current MEMORY.md and USER.md
2. Remove duplicates, obsolete facts, and any procedures (move to skills)
3. Merge related bullets; keep highest-signal facts
4. Drop episodic task logs — use PGVector episodes if needed
5. Confirm char count under limits

## Validation

- No workflow steps in MEMORY
- No coding standards blocks (use `/repo-conventions`)
- Each line is a durable fact or pointer

## Failure handling

If over limit: prioritize env URLs, team IDs, active project names; archive rest to ADR or PGVector index.
