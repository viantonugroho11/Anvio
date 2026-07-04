---
name: Architecture
description: System design, architecture review, and technical decision making
version: "2.0.0"
parameters:
  - name: topic
    type: string
    description: System or component to analyze
    required: true
  - name: scope
    type: string
    description: Depth of analysis
    required: false
    enum: [overview, detailed, adr]
    default: overview
steps:
  - id: gather_context
    action: Read existing architecture docs and relevant source files
    tool: file_read
    output: current_state
  - id: identify_drivers
    action: Identify architectural drivers (scalability, security, maintainability)
    output: drivers
  - id: propose_options
    action: Propose design options with tradeoffs
    output: options
  - id: recommend
    action: Recommend a path with clear rationale
    output: recommendation
  - id: document
    action: Write ADR if scope is 'adr'
    condition: "scope == 'adr'"
    tool: file_write
    output: adr_path
outputs:
  - name: recommendation
    type: markdown
    description: Recommended architecture with rationale
  - name: options
    type: array
    description: Evaluated design options with tradeoff analysis
triggers:
  - architecture review
  - system design
  - design this
tags: [engineering, architecture]
composable: true
---

When performing architecture tasks:

1. Understand requirements and constraints first
2. Identify key architectural drivers (scalability, security, maintainability)
3. Propose options with tradeoffs
4. Recommend a path with clear rationale
5. Document decisions as ADRs when requested
