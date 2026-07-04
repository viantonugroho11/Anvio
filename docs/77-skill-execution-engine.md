# Skill Execution Engine (v2)

**Status:** Shipped — v1.23.0  
**Refs:** [05-skills.md](./05-skills.md) · [37-skills-catalog.md](./37-skills-catalog.md) · [74-workflow-to-skill-example.md](./74-workflow-to-skill-example.md)

---

## Motivation

Anvio v1 skills were **prompt-injection only**: steps were rendered as prose into the agent's system prompt and the LLM was left to interpret them. Hermes executes skill steps *mechanically* — the runtime calls tools directly, evaluates conditions, retries on error, and threads outputs between steps without LLM involvement. This document describes the v2 engine that closes that gap.

---

## Architecture

```
User message
    │
    ▼
TriggerMatcher ──► auto-activate matching skills
    │
    ▼
ParameterValidator ──► collect + type-check + {{interpolate}} args
    │
    ▼
SkillExecutor ──► iterate steps
    │               ├── evaluate condition
    │               ├── interpolate {{var}} in args
    │               ├── call RuntimeToolPort directly (no LLM)
    │               ├── store output variable
    │               └── handle onError (fail / skip / retry)
    │
    ▼
OutputMap ──► passed to next step / returned to agent
    │
    ▼
skill_call tool ──► LLM can invoke skills mid-session
    │
    ▼
Composable skills ──► skill step can call another skill (skill:slug)
```

---

## Layer 1 — Parameter Validator (`packages/skills/src/param-validator.ts`)

Validates a raw params object against a skill's `parameters[]` definition, then produces an interpolation context for `{{var}}` substitution in step args.

```ts
const ctx = validateAndCollect(skill.spec.parameters, rawParams);
// throws SkillParamError on missing required / wrong type
const interpolated = interpolateArgs({ path: "{{target}}" }, ctx);
// → { path: "src/index.ts" }
```

**Rules:**
- Missing `required: true` param → throws with a user-facing message listing what's needed
- Type coercion: strings → number/boolean when type mismatch and value is parseable
- `enum` validation: throws if value not in allowed list
- `{{varName}}` in any string value is replaced with the corresponding param or step output value

---

## Layer 2 — Skill Executor (`packages/skills/src/executor.ts`)

Runs a skill's `steps[]` array mechanically against a `RuntimeToolPort`.

```ts
const result = await executeSkill({
  skill,
  params: { target: "src/", focus: "security" },
  toolPort,
  ctx: { sessionId, agentId, userId },
});
// result.outputs → { findings: [...], summary: "..." }
// result.steps   → per-step status + output values
```

**Step execution loop:**

1. Evaluate `condition` — simple expression (`"focus == 'security' || focus == 'all'"`) using the params + accumulated outputs as variables. Step skipped when falsy.
2. Interpolate `{{var}}` in `step.args` using params + prior outputs.
3. If `step.tool` is defined → call `toolPort.call({ name, arguments: interpolatedArgs }, ctx)`.
4. Store result in `outputs[step.output]` if `step.output` is defined.
5. On error: honour `step.onError` (`fail` throws, `skip` continues, `retry` repeats up to `maxRetries`).

**Condition evaluator:** restricted `Function` constructor over a safe variable scope — no `eval`, no global access. Only params + output vars visible.

---

## Layer 3 — Trigger Matcher (`packages/skills/src/trigger-matcher.ts`)

Scans all loaded skill definitions and returns slugs whose `triggers[]` match an inbound message.

```ts
const matched = matchTriggers(message, allSkills, { channel: "telegram" });
// → ["code-review"]  if message contains "code review"
```

**Match rules:**
- String trigger: case-insensitive substring match against the message text.
- Object trigger `{event, condition?, channel?}`: `event` matched against message metadata event type; `channel` matched against active channel if specified.
- Matched skills are **merged** into the agent's skill list for that turn (not persisted).

**Integration:** `AgentRuntime.run()` calls `matchTriggers` before assembling the system prompt. Auto-activated skills are appended, deduped, and rendered.

---

## Layer 4 — Composable Skills (`packages/skills/src/composable-registry.ts`)

Skills marked `composable: true` are exposed as callable tools in the gateway with prefix `skill__`.

```
skill__code-review(target: string, focus?: string) → { findings, summary }
```

When `skill__<slug>` is called:
1. `ParameterValidator` validates the call arguments.
2. `SkillExecutor` runs the skill steps.
3. Result `outputs` map is serialised to JSON and returned as the tool result.

**Registration:** `ComposableSkillRegistry.registerAll(skills, toolPort)` produces a `RuntimeToolPort` adapter. `AgentRuntime` calls this after resolving skills so composable skills appear alongside gateway tools.

**Skill calling another skill:** a step can set `tool: "skill:code-review"` — the executor resolves this via `ComposableSkillRegistry` before falling through to the main gateway. This enables skill chains without LLM involvement.

---

## Layer 5 — `skill_call` Gateway Tool (`packages/tools/src/builtins/skill-call.ts`)

Registers `anvio_tools__skill_call` so the LLM can explicitly invoke any skill mid-session.

```json
{
  "name": "anvio_tools__skill_call",
  "arguments": {
    "slug": "code-review",
    "params": { "target": "src/auth/", "focus": "security" }
  }
}
```

The tool resolves the skill via `SkillCatalogResolver`, validates params, runs the executor, and returns the `outputs` map as JSON. If the skill has no steps (prose-only), it returns the rendered instructions so the LLM can apply them.

---

## Skill format recap — what maps to which layer

| Field | Layer that uses it |
|-------|--------------------|
| `parameters[]` | L1 ParameterValidator + L5 skill_call tool schema |
| `steps[].tool` | L2 SkillExecutor → RuntimeToolPort.call() |
| `steps[].condition` | L2 SkillExecutor condition evaluator |
| `steps[].args` / `{{var}}` | L1 interpolateArgs |
| `steps[].onError` / `maxRetries` | L2 SkillExecutor retry loop |
| `steps[].output` | L2 SkillExecutor output accumulator |
| `outputs[]` | L2 SkillExecutor result shape + L4 composable tool return |
| `triggers[]` | L3 TriggerMatcher |
| `composable: true` | L4 ComposableSkillRegistry |
| `timeout` | L2 SkillExecutor — AbortSignal timeout wrapper |

---

## Error types

| Code | When |
|------|------|
| `SKILL_PARAM_MISSING` | Required param not provided |
| `SKILL_PARAM_TYPE` | Value fails type check |
| `SKILL_PARAM_ENUM` | Value not in allowed enum |
| `SKILL_STEP_FAILED` | Step tool call errored with `onError: fail` |
| `SKILL_NOT_FOUND` | `skill_call` given an unknown slug |
| `SKILL_TIMEOUT` | Execution exceeded `timeout` ms |

---

## Files changed

| File | Change |
|------|--------|
| `packages/skills/src/param-validator.ts` | NEW — L1 |
| `packages/skills/src/executor.ts` | NEW — L2 |
| `packages/skills/src/trigger-matcher.ts` | NEW — L3 |
| `packages/skills/src/composable-registry.ts` | NEW — L4 |
| `packages/tools/src/builtins/skill-call.ts` | NEW — L5 |
| `packages/skills/src/index.ts` | Export new modules |
| `packages/agents/src/runtime.ts` | Wire trigger matcher + composable tools |
| `packages/tools/src/gateway.ts` | Register skill_call tool |

---

Terakhir diperbarui: 2026-07-04 (v1.23.0).
