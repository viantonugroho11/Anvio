# 03 — Perbandingan dengan Hermes Agent, OpenClaw, Orca

## 1. Versi referensi & sumber

| Referensi                    | Versi / commit                                             | Sumber yang dibaca                                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hermes Agent (Nous Research) | `NousResearch/hermes-agent@bf0203a794a0` (HEAD 2026-10-23) | `hermes-agent.nousresearch.com/docs`, `/docs/developer-guide/architecture`, `/docs/developer-guide/agent-loop`, `/docs/developer-guide/context-compression-and-caching` |
| OpenClaw                     | `openclaw/openclaw@c2ee4ec64560`                           | `docs.openclaw.ai/platforms`, `docs.openclaw.ai/concepts/agent-loop`                                                                                                    |
| Orca (StablyAI)              | `stablyai/orca@2f2a0bca5e3c`                               | README repo GitHub                                                                                                                                                      |
| ACP                          | lihat [05](05-acp-compatibility.md)                        | —                                                                                                                                                                       |

Keterbatasan: perbandingan referensi berbasis dokumentasi resmi; source code referensi tidak dikloning dan dieksekusi. Klaim yang tidak tertulis di dokumentasi ditandai "tidak terdokumentasi".

## 2. Ringkasan tiap referensi (hanya yang relevan)

### Hermes Agent

- `AIAgent` sinkron; loop di `agent/conversation_loop.py` + modul turn-phase. Tiga API mode: `chat_completions`, `codex_responses`, `anthropic_messages`.
- Budget iterasi default **500** (`agent.max_turns`), subagent default **50** (`delegation.max_iterations`). Pada 100% budget: berhenti dan mengembalikan ringkasan. Budget warning diinjeksi sebagai prompt layer ephemeral.
- Tool call jamak dieksekusi **paralel** (ThreadPoolExecutor); tool interaktif memaksa sekuensial; hasil dikembalikan sesuai urutan call.
- Interrupt: API call di thread background, dibatalkan oleh pesan baru / `/stop` / sinyal; respons parsial tidak masuk history.
- Fallback provider pada 429 / 5xx / 401-403 (dengan refresh credential lebih dulu).
- Kompresi context: trigger 50% context window (floor 0.75 untuk window <512K), head 3 pesan dilindungi, tail ~20 pesan / berbasis token, pruning output tool lama >200 char tanpa LLM call, summary model auxiliary.
- Session: SQLite + FTS5, lineage parent/child lintas kompresi, atomic write.
- Memory provider pluggable (satu aktif), Honcho untuk user modeling.
- ACP adapter (`acp_adapter/`) via stdio/JSON-RPC untuk VS Code, Zed, JetBrains.

### OpenClaw

- Core TypeScript/Node; Gateway sebagai service OS (LaunchAgent/systemd/Scheduled Task).
- RPC `agent` mengembalikan `runId` segera; `runEmbeddedAgent` melakukan reservasi turn per sesi sebelum kapasitas global, resolve model + auth profile, stream, enforce timeout.
- **Serialisasi per sesi** via session controller; `activeWriterRunId` + `expectedWriterRunId` di tiap write transkrip sehingga run yang tersalip tidak bisa commit; SQLite writer queue; lock state-directory.
- Timeout default: 48 jam per model attempt, idle model 120 s (cloud) / 300 s (self-hosted), progress deadline 2× idle.
- Event stream: `lifecycle`, `assistant`, `tool` (start/update/end), `compaction`.
- Plugin hooks termasuk `before_tool_call` yang dapat `{ block: true }`.
- Argumen tool **divalidasi terhadap schema** sebelum eksekusi; tool call malformed mendapat satu continuation.
- Cancellation mencabut otoritas tool dan approval seketika; timeout dihitung sebagai turn gagal.
- Auto-compaction dengan retry terbatas; overflow terkonfirmasi → kompaksi.

### Orca

- Desktop IDE/orchestrator (Electron), mobile companion, relay cloud, CLI. Menjalankan ~30 agent CLI (Codex, Claude Code, OpenCode, Pi) **berdampingan, masing-masing di git worktree sendiri**.
- Tidak mendokumentasikan abstraksi model, loop agent, atau provider API — karena memang bukan agent runtime.
- **Konsekuensi audit:** semua baris "agent brain" untuk Orca = Not Applicable. Yang relevan hanya pola isolasi worktree dan orkestrasi agent CLI eksternal.

## 3. Matriks perbandingan 14 dimensi

Legenda status Anvio: Implemented / Partial / Configured Only / Missing.

| #   | Dimensi             | Anvio                                                      | Hermes                                                 | OpenClaw                                    | Orca                       | Catatan gap                                                                           |
| --- | ------------------- | ---------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| 1   | Agent brain         | Partial — model-driven, tanpa planner/critic               | Model-driven + budget warning, ephemeral prompt layers | Model-driven + hooks                        | N/A                        | Planning eksplisit bukan keharusan; warning budget & langkah penutup adalah keharusan |
| 2   | Execution loop      | Partial (5 iterasi, bug P1/P2/P4/P5)                       | 500 iterasi, paralel tool, interrupt                   | Session controller, timeout, retry          | N/A                        | Lihat [02](02-agent-brain-and-loop.md)                                                |
| 3   | Model abstraction   | Implemented (port + 3 adapter)                             | 3 API mode + resolver bersama                          | Model + auth profile resolution             | N/A (pakai CLI vendor)     | Anvio kurang registry kapabilitas                                                     |
| 4   | Context management  | Partial (count-based, default off)                         | Token-based compression + pruning                      | Auto-compaction + retry                     | N/A                        | High                                                                                  |
| 5   | Memory architecture | Partial (recall tidak diinjeksi)                           | Pluggable provider, FTS5 recall, Honcho                | SQLite transcript                           | N/A                        | Medium                                                                                |
| 6   | Tool execution      | Partial (serial, tanpa schema validation/timeout)          | Paralel, interactive gating                            | Schema validation, before/after hooks       | N/A                        | High                                                                                  |
| 7   | MCP integration     | Partial (schema dibuang, `isError` hilang)                 | MCP servers sebagai tool                               | Plugin/tools                                | Bergantung agent CLI       | Medium                                                                                |
| 8   | ACP compatibility   | Missing (HTTP kustom)                                      | ACP adapter stdio                                      | (tidak diverifikasi di dokumen yang dibaca) | N/A                        | Critical bila ACP adalah requirement                                                  |
| 9   | Multi-agent         | Partial (orchestrator DAG baik; delegate tool tanpa guard) | Subagent dengan budget terpisah                        | Agent runtimes                              | Paralel agent per worktree | Medium                                                                                |
| 10  | Runtime lifecycle   | Partial (gateway daemon, tanpa lock per-sesi)              | Gateway + cron                                         | Service OS, lock, writer claims             | Desktop host               | High                                                                                  |
| 11  | Reliability         | Partial                                                    | Fallback + retries                                     | Timeouts, retry budget, durable writes      | —                          | High                                                                                  |
| 12  | Security            | Partial/Configured Only                                    | Command approval, container isolation                  | Exec approvals, `before_tool_call` block    | Worktree isolation         | High                                                                                  |
| 13  | Observability       | Unverified (span + metrics ada)                            | Callbacks                                              | Event stream, audit ledger                  | Usage tracking             | —                                                                                     |
| 14  | Extensibility       | Implemented (skills, MCP, runtimes, channels, YAML)        | Skills (agentskills.io), plugins, MCP                  | Plugins + hooks                             | Skills/plugins             | Anvio kuat di sini                                                                    |

## 4. Di mana Anvio setara atau lebih baik

Untuk menghindari "forced parity", berikut area di mana Anvio sudah sebanding:

- **Failover streaming yang cermat**: router hanya failover sebelum konten pertama dan me-replay chunk yang dibuffer (`model-router.ts:187-288`), plus event `failover` agar UI tidak diam-diam mengganti "suara". Ini desain yang baik dan teruji (`model-router-stream.spec.ts`).
- **Credential pool rotation dengan fingerprint** untuk invalidasi cache saat secret diganti (`model-router.ts:347-369`).
- **Penyelamatan jawaban parsial** saat provider mati di tengah (`runtime.ts:270-283`).
- **Surface ekstensibilitas** (skills, souls, goals, blueprints, 14 channel, 9+ runtime backend) lebih luas dari kebutuhan inti.
- **Orkestrator DAG** dengan cycle detection, kebijakan `abort/continue/retry`, fan-in synthesis (`orchestrator.ts`, `task-planner.ts`) — teruji di `tests/integration/delegation.integration.spec.ts` (7 test lulus).

## 5. Area yang **tidak** direkomendasikan untuk diadopsi hanya demi paritas

- Budget 500 iterasi ala Hermes: cukup jadikan configurable dengan default moderat (mis. 25) + warning.
- Session controller + writer claims ala OpenClaw secara penuh: untuk Level 1 filesystem, mutex in-process per `sessionId` + write atomik sudah cukup.
- UI/worktree orchestration ala Orca: fitur produk berbeda; hanya tegakkan `isolatedWorktree` yang sudah ada di schema bila memang dibutuhkan.
