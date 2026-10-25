# Detached documentation (historical, non-authoritative)

> **Do not use these files as a description of the current system.**
> Everything under `docs/_detached/` is kept only for traceability: earlier release plans, superseded gap registers and designs, the pre-2026-10-25 vision statement, and the previous root README.

## Rules

- **Not authoritative.** The current source code, the active documentation indexed in [docs/README.md](../README.md), and the accepted ADRs in [docs/adr/](../adr/README.md) override anything here.
- **Not in normal navigation.** Nothing in the active documentation index links into this directory. The only links are from [MANIFEST.md](MANIFEST.md) and from the maintenance report.
- **Excluded from AI coding-agent context where the tool supports it.** See [§ AI context exclusion](../documentation-maintenance-report.md#8-ai-context-exclusion-mechanisms-configured) for what each tool does and does not enforce.
- **Read only on request.** Agents and contributors open these files only when someone explicitly asks for historical investigation, migration analysis, or a review of an earlier decision.
- **Never deleted.** Files are moved here with `git mv`, so `git log --follow` keeps their full history.

## Layout

| Directory                                  | Contents                                                                                                             |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| [historical-plans/](historical-plans/)     | Phase/release priority plans (Phase K, P1–P14, L6), the June 2026 implementation plans, and the old numbered roadmap |
| [superseded-designs/](superseded-designs/) | Hermes/slaude parity audits, gap registers and the Hermes tool-mapping catalog                                       |
| [obsolete-docs/](obsolete-docs/)           | The original "local-first" vision statement                                                                          |
| [old-readmes/](old-readmes/)               | The root README as it was before the 2026-10-25 rewrite (v2.10.0)                                                    |

There is no `archived-audits/` directory yet. Every audit under `docs/audit/` and `docs/audits/` still contains open findings that feed [docs/ROADMAP.md](../ROADMAP.md), so none has been archived.

The full list of moved files, with their original paths and replacements, is in [MANIFEST.md](MANIFEST.md).
