# 05 — Slack & Channel Comparison

## 1. Slack: Slaude vs Anvio

| Aspek              | Slaude (bukti)                                                                                                                                                                 | Anvio (bukti)                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Arsitektur gateway | Gateway terpisah dari node worker; HTTP Events API untuk HA, Socket Mode hanya mono (gateway **menolak boot** di Socket Mode — field note 2026-09-17)                          | Adapter in-process dalam gateway terpadu; Socket Mode saja (`slack.ts:188-196`)   |
| Ingest event       | `http-transport.ts` (verifikasi signing, log `X-Slack-Retry-Num`) atau Bolt Socket Mode                                                                                        | WS manual dengan URL `wss-primary…?app_token=` (P2-CH-07, Unverified dapat konek) |
| Dedup              | **Durable**: `SeenEvents.tryInsert("channel:ts")` atomik (`gateway.ts:1681-1687`), metrik drop                                                                                 | ✗                                                                                 |
| Thread routing     | Kunci unik thread (lihat [04])                                                                                                                                                 | Bridge per channel+thread                                                         |
| Engagement         | Mention-only per thread (durable, `db/mention-only`), `engaged` flag, suppress hook (`UserPromptSubmit` `continue:false`) agar transkrip tetap lengkap tanpa menjalankan model | Harness engagement gate (`mentionedBot`, zona)                                    |
| DM                 | Synthetic thread                                                                                                                                                               | Bridge                                                                            |
| Slash command      | `/model`, `/mention-only`, `/soul`, `/mcp`, `/1on1`, `/remote`, … (`gateway/slack/commands.ts`)                                                                                | Slash registry lintas channel (ADR-0023)                                          |
| Format             | `mdToMrkdwn` URL-safe (`slack/format.ts`)                                                                                                                                      | Split 40k; tidak ada konversi mrkdwn khusus (Unverified)                          |
| Edit pesan         | Status "is thinking…" diedit, teks status **diredaksi** (`core/status-text.ts`)                                                                                                | Buffer sampai `done`                                                              |
| Lampiran           | Ya (`tests/attachments.test.ts`; transport per app)                                                                                                                            | Slack: tidak; Telegram/Discord voice                                              |
| Approval           | Block Kit Approve/Deny durable (`pending_gates`), klik non-approver ditolak tanpa mengonsumsi baris (`approval-gate.ts:120-210`)                                               | Tombol + harness gate (in-memory + rehydrate)                                     |
| Rate limit         | Bergantung WebClient Bolt (retry bawaan); metrik                                                                                                                               | `fetchWithRetry` + `Retry-After`                                                  |
| Duplikat           | Dedup durable + coalescing                                                                                                                                                     | ✗                                                                                 |
| Reconnect          | Bolt (mono) / HTTP stateless (HA)                                                                                                                                              | 5 s tetap; reconnect setelah `stop()`                                             |
| Isolasi kegagalan  | Antrean + node terpisah; guard `unhandledRejection` node dengan circuit breaker (5 dalam 60 s → exit untuk restart pod) — field note 2026-10-10                                | Guard global (T-005, log saja); turn di jalur inbound (P2-CH-01)                  |
| Error ke user      | Pesan kegagalan di thread; OAuth error body **tidak** diekspos (field note 2026-10-01)                                                                                         | `task_failed` dengan error mentah (P2-CH-05)                                      |

## 2. Matriks gap per channel Anvio (mekanisme reliabilitas Slaude)

✔ ada · ✗ tidak · ~ parsial · n/a

| Mekanisme (pola Slaude)         | Slack               | Telegram        | Discord  | WhatsApp             | Teams    | Matrix | Mattermost | Email        | Web | REST/CLI | Signal/GChat/Feishu/SMS |
| ------------------------------- | ------------------- | --------------- | -------- | -------------------- | -------- | ------ | ---------- | ------------ | --- | -------- | ----------------------- |
| Dedup durable id event          | ✗                   | ~ offset memori | ✗        | ✗                    | ✗        | ✗      | ✗          | ~ uid memori | n/a | n/a      | ✗                       |
| Ack cepat, kerja di antrean     | ✗                   | ✗               | ✗        | ✗ (ack setelah turn) | ✗        | ?      | ✗          | ✗            | ✗   | ✗        | ?                       |
| Lock sesi                       | ✗                   | ✗               | ✗        | ✗                    | ✗        | ✗      | ✗          | ✗            | ✗   | ✗        | ✗                       |
| Coalescing pesan saat sibuk     | ✗                   | ✗               | ✗        | ✗                    | ✗        | ✗      | ✗          | ✗            | ✗   | ✗        | ✗                       |
| Approval durable lintas restart | ~ rehydrate harness | ~               | ~        | ~                    | ~        | ?      | ?          | n/a          | ?   | n/a      | ?                       |
| Status/progress ter-redaksi     | ~ typing            | ~ typing        | ~        | ~                    | ~ typing | ✗      | ~          | n/a          | ✗   | n/a      | ✗                       |
| Error user-friendly             | ✗                   | ✗               | ✗        | ✗                    | ✗        | ✗      | ✗          | ✗            | ✗   | ✗        | ✗                       |
| Mention-only durable per thread | ~ harness           | ~               | ~        | n/a                  | ~        | ?      | ~          | n/a          | n/a | n/a      | ?                       |
| Signing/verifikasi inbound      | n/a (WS)            | n/a (poll)      | n/a (WS) | ✔                    | ✔        | ✔      | n/a        | n/a          | ?   | ?        | ?                       |

## 3. Rekomendasi

1. **ADOPT** dedup durable `tryInsert(surface:conversation:eventId)` (tabel/sqlite atau file append-only di Level 1) — satu helper untuk semua adapter (T-014).
2. **ADAPT** ack-cepat + antrean per sesi + coalescing — via `SessionRunQueue` (T-004); untuk Level 1 tanpa Redis.
3. **ADOPT** redaksi status/error: program-name-only untuk shell, basename path, host-only URL, `redactSecrets` (pola `status-text.ts`) sebelum apa pun dikirim ke channel.
4. **ADAPT** HTTP Events API untuk Slack bila Anvio ingin multi-replica (Socket Mode = single-leader).
5. **KEEP CURRENT** registry slash lintas channel dan adapter multi-channel — Slaude sengaja hanya Slack.
