---
layout: home

hero:
  name: Anvio
  text: An extensible AI agent platform
  tagline: Define agents in Markdown, infrastructure in YAML. Run them in a tool loop with 18 model providers, MCP servers, skills, memory and 15 chat channels — from one CLI process, no database required.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /02-architecture
    - theme: alt
      text: GitHub
      link: https://github.com/viantonugroho11/Anvio

features:
  - icon: 🔁
    title: Multi-turn tool loop
    details: Native tool_use or fenced-block fallback, approval checkpoints, cancellation, detached runs and per-session serialisation.
    link: /03-runtime
  - icon: 🧭
    title: 18 model providers
    details: Per-agent provider and model, opt-in routing, fallback chains, circuit breakers, spend budgets and encrypted key pools.
    link: /36-provider-routing
  - icon: 🧰
    title: 76 built-in tools + MCP
    details: Allow-listed tool gateway with egress policy, plus an MCP client over stdio and HTTP with first-call approval.
    link: /reference/builtin-tools
  - icon: 🤝
    title: Delegation & A2A
    details: Sub-agents, mixture-of-agents, external A2A agents and vendor runtimes (Claude Code, Cursor, Codex, Antigravity).
    link: /40-subagent-delegation
  - icon: 🧠
    title: Souls, memory, learning
    details: Long-lived identity with gated self-evolution, filesystem / SQLite FTS5 / Honcho / gbrain memory, and a learning loop.
    link: /25-soul-system
  - icon: 💬
    title: 15 channels, one runtime
    details: Slack, Discord, Telegram, WhatsApp, Teams, Matrix, Email and more behind a harness for engagement, formatting and approvals.
    link: /41-channel-harness
---
