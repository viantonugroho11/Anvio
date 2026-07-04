# Skills

Reusable capability modules attachable to any agent. A skill adds typed inputs, structured execution steps, and defined outputs to an agent's system prompt — making authoring explicit and composable rather than free-form prose.

## Skill format

Skills are Markdown files with YAML frontmatter (or plain `.yaml`). The minimal form is just `name` + `description` + body instructions. The full structured form adds parameters, steps, outputs, and triggers.

### Minimal (prose-only)

```markdown
---
name: Research
description: Deep research and synthesis
---

When researching a topic:
1. Gather sources from multiple angles
2. Cross-check claims
3. Synthesise into a clear summary
```

### Structured (v2 — parameters, steps, outputs, triggers)

```markdown
---
name: Code Review
description: Structured code review with findings output
version: "2.0.0"
parameters:
  - name: target
    type: string          # string | number | boolean | array | object
    description: File path or PR URL to review
    required: true
  - name: focus
    type: string
    required: false
    enum: [correctness, security, performance, style, all]
    default: "all"
steps:
  - id: gather
    action: Read code changes
    tool: file_read        # gateway tool key
    output: code_content   # stores result as $code_content
  - id: security_scan
    action: Check for OWASP top 10 vulnerabilities
    condition: "focus == 'security' || focus == 'all'"
    output: security_findings
    onError: skip          # fail | skip | retry
  - id: report
    action: Merge and rank findings by severity
    output: final_report
outputs:
  - name: findings
    type: array            # string | number | boolean | array | object | markdown
    description: Review findings with file, line, severity
  - name: summary
    type: markdown
    description: Prioritised review summary
triggers:
  - code review            # string pattern
  - review this PR
  - event: pull_request    # structured event trigger
    channel: github
composable: true           # can be called from other skills
timeout: 120000            # ms
---

When reviewing code:
1. Check correctness and edge cases
2. Identify security vulnerabilities
3. Prioritise findings by severity (critical → error → warning → info)
```

## Schema reference

| Field | Type | Description |
|-------|------|-------------|
| `parameters[]` | array | Typed inputs the agent must collect |
| `parameters[].name` | string | Input name |
| `parameters[].type` | enum | `string` `number` `boolean` `array` `object` |
| `parameters[].required` | bool | Default `true` |
| `parameters[].default` | any | Used when not required and not provided |
| `parameters[].enum` | string[] | Allowed values |
| `steps[]` | array | Ordered execution steps |
| `steps[].id` | string | Unique step identifier |
| `steps[].action` | string | Human-readable description of what this step does |
| `steps[].tool` | string | Gateway tool key to call (optional) |
| `steps[].args` | object | Tool arguments, supports `{{param}}` interpolation |
| `steps[].condition` | string | Expression — step skipped when falsy |
| `steps[].onError` | enum | `fail` (default) `skip` `retry` |
| `steps[].maxRetries` | int | Used with `onError: retry` |
| `steps[].output` | string | Variable name to store step result |
| `outputs[]` | array | Defined result values the skill produces |
| `triggers[]` | array | String patterns or `{event, condition, channel}` objects |
| `composable` | bool | Skill can be called from other skills |
| `timeout` | int | Max execution time in ms |

## Bundled skills

Available in `configs/skills/` — no install needed:

| Skill | Category | v2 structured |
|-------|----------|---------------|
| `code-review` | Engineering | ✅ |
| `architecture` | Engineering | ✅ |
| `coding` | Engineering | — |
| `debugging` | Engineering | — |
| `research` | Knowledge | — |
| `planning` | Productivity | — |
| `documentation` | Knowledge | — |
| `finance` | Domain | — |
| `coach` | Personal | — |
| `assistant` | General | — |
| `project-manager` | Productivity | — |

## Attach skills to an agent

```markdown
---
# workspace/agents/reviewer.md
persona: reviewer
skills:
  - code-review
  - architecture
---
You are a senior code reviewer.
```

## CLI

```bash
anvio skill catalog            # list all bundled + workspace skills
anvio skill catalog --source bundled
anvio skill install aws        # install optional skill
anvio skill list               # list installed
```

## Skill resolution order

1. `workspace/skills/{slug}.md` or `.yaml` (user override wins)
2. `configs/skills/{slug}.yaml` (bundled)
3. Remote catalog (future)

## Learning loop

When a session ends and the soul's `evolution.allowAutoUpdate` is enabled, the learning loop (`packages/learning`) may auto-draft a skill from the session pattern. Drafts land in `workspace/skills/_drafts/` and can be promoted via:

```bash
anvio skill promote <draft-slug>
```
