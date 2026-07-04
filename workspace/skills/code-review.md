---
name: Code Review
description: Structured code review with findings output
version: "2.0.0"
parameters:
  - name: target
    type: string
    description: File path or PR URL to review
    required: true
  - name: focus
    type: string
    description: Review lens
    required: false
    enum: [correctness, security, performance, style, all]
    default: "all"
steps:
  - id: gather
    action: Read code changes
    tool: file_read
  - id: analyze
    action: Check correctness and edge cases
    output: correctness_findings
  - id: security_scan
    action: Check for OWASP top 10 vulnerabilities
    condition: "focus == 'security' || focus == 'all'"
    output: security_findings
  - id: report
    action: Merge and rank findings by severity
    output: final_report
outputs:
  - name: findings
    type: array
    description: Review findings with file, line, severity, and description
  - name: summary
    type: markdown
    description: Prioritized review summary
triggers:
  - code review
  - review this PR
tags: [engineering, review]
---

When reviewing code:

1. Check correctness and edge cases
2. Evaluate readability and maintainability
3. Identify security vulnerabilities
4. Suggest improvements with examples
5. Prioritize findings by severity

For each finding, include:
- **File** and **line** reference
- **Severity**: critical / error / warning / info
- **Description**: what's wrong and why
- **Suggestion**: concrete fix or improvement
