# 05 — Channel Inventory & Error Handling

Sumber inventaris: `packages/channels/src/create-channels.ts:193-400` (registrasi), `packages/channels/src/*.ts` (adapter), `packages/platform/src/gateway-http.ts` dan `apps/api/src/*.controller.ts` (endpoint webhook), `packages/platform/src/gateway-worker.ts` (dispatch & delivery).

## 1. Lapisan bersama (berlaku ke semua channel)

| Komponen                          | Perilaku                                                                                                                                                                                         | Bukti                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `BaseChannelAdapter`              | buffer delta stream sampai `done`; split pesan sesuai `maxMessageLength`; typing keepalive; `httpRequest` → `fetchWithRetry`                                                                     | `base-channel-adapter.ts:21-209`                  |
| `fetchWithRetry`                  | retry 3× untuk 429/5xx/network error; backoff eksponensial 200 ms→5 s; menghormati `Retry-After`/`retry_after` (≤60 s). **Tanpa jitter, tanpa timeout per request, me-retry POST non-idempoten** | `fetch-retry.ts:57-88`; probe Q6                  |
| `ChannelHub`                      | registry; `sendMessage` ke channel tak terdaftar **diam-diam no-op**; `startAll` = `Promise.all`                                                                                                 | `channel-hub.ts:30-38,76-78`; probe Q5            |
| Inbound handler                   | slash command → harness gate → `eventBus.publish(AGENT_RUN_REQUESTED)`                                                                                                                           | `create-channels.ts:441-526`                      |
| Event bus lokal (Level 1 default) | `publish` **menunggu semua handler selesai**, handler diisolasi dari error satu sama lain                                                                                                        | `events/src/local-event-bus.ts:16-23,60-71`       |
| Worker                            | jalankan turn penuh di dalam handler; `deliver()` menelan error kirim (log saja); kirim `task_failed` dengan teks error mentah                                                                   | `gateway-worker.ts:47-61,153-392`                 |
| Proses                            | **Tidak ada** handler `unhandledRejection`/`uncaughtException` di `apps/` maupun `packages/` (grep)                                                                                              | Node v24: unhandled rejection menghentikan proses |

### P2-CH-01 — Head-of-line blocking & deadlock approval (Critical untuk Level 1)

Rantai sinkron pada bus lokal:

```text
adapter loop (Telegram pollLoop / WS onmessage / webhook HTTP handler)
  → await dispatchInbound → await onInbound → await eventBus.publish(AGENT_RUN_REQUESTED)
    → await worker handler → await runtime.stream(...) seluruh turn
```

Akibat:

1. **Telegram**: `pollLoop` meng-`await handleUpdate` per update (`telegram.ts:276-296`), jadi seluruh bot terserialisasi — satu turn 2 menit menunda semua chat lain 2 menit.
2. **Deadlock approval inline**: runtime vendor yang memanggil `runtimeApprovalPort.requestApprovalAndWait` menunggu klik approve, tetapi klik itu (`callback_query`) hanya bisa dibaca oleh poll loop yang sedang memblokir turn tersebut → menunggu sampai timeout approval lalu ditolak. Probe Q4 mereproduksi pola ini dengan `LocalEventBus` (handler menunggu "approval" yang hanya bisa datang setelah `publish` selesai → 305 ms = timeout penuh).
3. **Webhook**: `POST /api/channels/whatsapp/webhook` dan `/teams/webhook` menjawab 200 **setelah** `handleWebhook`/`handleActivity` selesai (`gateway-http.ts:224-226,262`; `apps/api/src/whatsapp.controller.ts:96-97`) — yaitu setelah turn agent selesai. Meta dan Bot Framework mengharapkan ack cepat; keterlambatan memicu retry dari platform → turn duplikat (tidak ada dedup message-id di WhatsApp).

Confidence: tinggi untuk rantai `await` (code-read lengkap) dan pola bus (probe Q4); deadlock end-to-end dengan Telegram nyata **tidak dieksekusi** (butuh bot token).

### P2-CH-02 — Satu channel gagal start menggagalkan boot semua channel (High, probe Q5)

```text
[Q5] {"startAllRejected":"401 Unauthorized","healthyStarted":true,"unknownChannelSend":"resolved silently"}
```

Adapter sehat sudah start, tetapi `startAll` reject → `createPlatform` (`platform/src/index.ts` `await channelHub.startAll()`) gagal. Satu token Discord kedaluwarsa = gateway tidak bisa boot. Adapter yang start secara async (Telegram `void this.pollLoop()`) tidak terkena, adapter yang `await` koneksi terkena.

### P2-CH-03 — Retry POST menghasilkan pesan ganda (Medium, probe Q6)

```text
[Q6] {"postsReceived":3}
```

502 dari gateway platform setelah pesan sebenarnya terkirim → pesan dikirim ulang. Tidak ada idempotency key (mis. Slack `client_msg_id`, Telegram tidak punya; Discord `nonce` + `enforce_nonce`).

### P2-CH-04 — Tanpa timeout HTTP (Medium)

`fetch` tanpa `AbortSignal.timeout` di `fetchWithRetry` → satu request menggantung = turn menggantung (delivery di-`await` di worker) = (via P2-CH-01) channel menggantung.

### P2-CH-05 — Error mentah ke user (Low–Medium)

`task_failed` mengirim `chunk.error` apa adanya (`gateway-worker.ts:376-385`), mis. pesan HTTP provider; tidak ada pesan yang dapat ditindaklanjuti ("coba lagi", "agent sibuk").

## 2. Inventaris & matriks kapabilitas

| Channel     | Lokasi                                           | Transport                          | Auth inbound                                                     | Session mapping                          | Streaming                        | Attachment                   | Command                                       | Status                               |
| ----------- | ------------------------------------------------ | ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------- | -------------------------------- | ---------------------------- | --------------------------------------------- | ------------------------------------ |
| CLI         | `cli-channel.ts`                                 | stdout                             | — (lokal)                                                        | per proses                               | buffer→print                     | —                            | slash via CLI                                 | Implemented                          |
| Web chat    | `web-chat.ts`                                    | WS client registry                 | Tergantung API/gateway (tidak diaudit)                           | `sessionId` dari klien                   | kirim per chunk JSON             | —                            | slash                                         | Implemented (minimal)                |
| REST        | `rest-api.ts`                                    | polling/callback                   | API auth (tidak diaudit)                                         | `sessionId`                              | buffer                           | —                            | slash                                         | Implemented                          |
| Telegram    | `telegram.ts` (541)                              | long polling `getUpdates`          | bot token                                                        | `channel-session-bridge` per chat/thread | buffer→`sendMessage`, split 4096 | voice → STT (`@anvio/voice`) | `setMyCommands` + slash                       | Implemented                          |
| Slack       | `slack.ts` (295)                                 | Socket Mode WS                     | app token                                                        | per channel+thread_ts                    | buffer, split 40k                | —                            | slash + `approve/reject` teks + block actions | Partial (lihat §3)                   |
| Discord     | `discord.ts` (379)                               | Gateway WS v10                     | bot token                                                        | per channel/thread                       | buffer, split 2000               | audio → STT                  | interactions                                  | Partial                              |
| WhatsApp    | `whatsapp.ts` (277)                              | Webhook Meta + Graph API           | `X-Hub-Signature-256` (wajib kecuali `ANVIO_API_ALLOW_INSECURE`) | per nomor                                | buffer, split 4096               | (tidak diverifikasi)         | tombol interaktif approve                     | Implemented                          |
| Teams       | `teams.ts` (278)                                 | Bot Framework webhook              | JWT Bot Framework (JWKS)                                         | conversation                             | buffer                           | Adaptive card                | —                                             | Implemented                          |
| Matrix      | `matrix.ts` (118)                                | Client-Server API / AS transaction | `as_token`                                                       | room                                     | buffer                           | —                            | —                                             | Partial (in-memory store untuk test) |
| Mattermost  | `mattermost.ts` (239)                            | WebSocket + REST                   | bot token                                                        | channel/root                             | buffer, split 16 383             | —                            | —                                             | Partial                              |
| Email       | `email.ts` + `imap-client.ts` + `smtp-client.ts` | IMAP polling + SMTP                | kredensial IMAP                                                  | thread email                             | —                                | —                            | —                                             | Implemented                          |
| Signal      | `signal.ts`                                      | signal-cli REST                    | (bridge lokal)                                                   | nomor                                    | —                                | —                            | —                                             | Partial (outbound)                   |
| Google Chat | `google-chat.ts`                                 | webhook / service account REST     | **tidak terlihat verifikasi inbound**                            | space                                    | —                                | —                            | —                                             | Partial                              |
| Feishu      | `feishu-channel.ts`                              | bot webhook                        | **tidak terlihat verifikasi**                                    | —                                        | —                                | —                            | —                                             | Partial                              |
| SMS         | `sms-channel.ts`                                 | Twilio REST                        | **tidak terlihat verifikasi signature Twilio**                   | nomor                                    | —                                | —                            | —                                             | Partial (outbound)                   |
| Simulated   | `simulated-channel.ts`                           | in-memory                          | —                                                                | —                                        | —                                | —                            | —                                             | Test only                            |

"Tidak terlihat verifikasi" = tidak ditemukan pemanggilan verifikasi di `webhook-auth.ts`/controller untuk channel tersebut pada audit ini; endpoint inbound-nya sendiri tidak ditelusuri penuh → **Unverified**.

Tool integration: semua channel memakai jalur agent yang sama (worker → runtime → tool port); tool `anvio_channel__*` dari harness tersedia lintas channel.

## 3. Rincian per channel

### Telegram

- **Koneksi:** long polling 25 s; error poll → `sleep(3000)` tetap, tanpa backoff; **401/token dicabut** berulang selamanya tiap 3 s.
- **Inbound:** `offset` hanya di memori → restart memproses ulang batch terakhir yang belum dikonfirmasi (duplikat mungkin). Error per update di-log, update dibuang, user tidak diberi tahu.
- **Outbound:** Markdown → fallback plain text pada `can't parse entities` (`telegram.ts:144-160`); split 4096; retry via `fetchWithRetry` menghormati `retry_after`.
- **Concurrency:** serial (P2-CH-01).

### Slack

- **Koneksi:** `new WebSocket('wss://wss-primary.slack.com/link/?app_token=…')` (`slack.ts:189`). Slack Socket Mode yang terdokumentasi mewajibkan `apps.connections.open` untuk mendapat URL WSS; URL statis ini **Unverified** dapat terhubung, dan menaruh app token di URL (terekam di log/proxy).
- **Reconnect:** `onclose` → `start()` setelah 5 s tetap; **`stop()` memicu `onclose` → reconnect lagi** (handler tidak dilepas) → shutdown tidak bersih.
- **Inbound:** ack envelope segera (bagus). Tidak memeriksa `retry_attempt`/`client_msg_id` → event yang di-retry Slack diproses ulang. `JSON.parse` tanpa try/catch dan `void this.handleSocketMessage(...)` → frame rusak atau error di `handleMessage` (mis. session store) menjadi **unhandled rejection → proses Node berhenti**, membawa semua channel.
- **Outbound:** `chat.postMessage` via retry; `msg_too_long` dicegah split 40k.

### Discord

- **Koneksi:** Gateway WS; heartbeat `op 1` periodik; **tanpa pelacakan heartbeat ACK** (zombie connection tidak terdeteksi); reconnect selalu **identify** (`op 2`), tidak **resume** (`op 6`) → event selama putus hilang; reconnect 5 s tetap (identify dibatasi 1000/hari).
- `stop()` → `onclose` → reconnect (sama seperti Slack). `void this.handleGatewayMessage` → risiko unhandled rejection.
- **Outbound:** `!res.ok` → throw dengan body; retry 429 menghormati `retry_after`.

### WhatsApp

- **Inbound:** signature HMAC wajib (fail-closed) — baik. Ack setelah turn selesai (P2-CH-01) + tanpa dedup `message.id` → duplikat saat Meta retry.
- **Outbound:** Graph API; error → throw; split 4096.

### Teams

- JWT Bot Framework diverifikasi. Ack setelah `handleActivity` → risiko timeout Bot Framework. Token bot di-fetch per kirim (tidak di-cache, `teams.ts:130,207,231`).

### Mattermost

- WS + reconnect 5 s tetap; `stop()` problem sama; `void` handler.

### Email

- IMAP polling dengan `seenImapUids` (in-memory) + flag IMAP; error poll di-log. Restart bergantung flag `\Seen` server.

### Matrix / Signal / Google Chat / Feishu / SMS

- Adapter tipis berbasis `WebhookChannelAdapter`; outbound HTTP dengan retry untuk sebagian (Matrix, Google Chat, Feishu, SMS menyebut retry). Verifikasi inbound selain Matrix: Unverified.

### CLI / Web chat / REST

- Web chat: `sendMessage` ke sesi tanpa klien terdaftar → **diam-diam dibuang** (`web-chat.ts` `if (!client) return`); tidak ada buffer untuk reconnect.

## 4. Lifecycle channel & titik kegagalan

```mermaid
flowchart TB
  S[Channel startup<br/>startAll Promise.all] -->|reject| BOOT[(boot gagal ⚠ Q5)]
  S --> C[Connect/auth]
  C -->|WS close| RC[reconnect 5s tetap<br/>tanpa backoff/jitter; juga setelah stop ⚠]
  C --> R[Receive event]
  R -->|JSON.parse/handler throw di onmessage| CRASH[(unhandled rejection → proses mati ⚠)]
  R --> V[Validate & dedup<br/>Telegram offset, IMAP uid; lainnya tidak ada ⚠]
  V --> SR[Resolve session<br/>channel-session-bridge]
  SR --> HG[Slash / harness gate]
  HG --> D[publish AGENT_RUN_REQUESTED<br/>await seluruh turn ⚠ P2-CH-01]
  D --> AO[Agent output chunks]
  AO --> T[Transform: buffer, split, markdown fallback]
  T --> SEND[Send: fetchWithRetry 3x, tanpa timeout ⚠]
  SEND -->|gagal| LOG[deliver(): console.error saja<br/>tanpa DLQ / retry lanjutan]
  SEND --> REC[Record delivery: tidak ada]
```

| Tahap                   | Ditangkap                 | Diteruskan                    | Di-retry        | Di-log   | Diam-diam diabaikan               |
| ----------------------- | ------------------------- | ----------------------------- | --------------- | -------- | --------------------------------- |
| Startup                 | —                         | ya (reject)                   | —               | —        | —                                 |
| Connect                 | sebagian                  | —                             | reconnect tetap | ya       | —                                 |
| Receive (polling)       | ya                        | —                             | poll ulang      | ya       | update gagal dibuang              |
| Receive (WS)            | **tidak**                 | crash                         | —               | —        | —                                 |
| Receive (webhook)       | ya (HTTP 4xx/5xx)         | ke platform (retry dari luar) | oleh platform   | sebagian | —                                 |
| Dispatch                | event bus isolasi handler | —                             | —               | ya       | —                                 |
| Agent error             | ya → `task_failed`        | ke user (teks mentah)         | tidak           | —        | —                                 |
| Send                    | `deliver()`               | —                             | 3×              | ya       | **ya, setelah log**               |
| Channel tidak terdaftar | —                         | —                             | —               | —        | **ya** (`ChannelHub.sendMessage`) |

## 5. Matriks reliabilitas lintas channel

| Kontrol                    | Telegram                                                                                | Slack         | Discord          | WhatsApp    | Teams       | Mattermost | Email        | Lainnya  |
| -------------------------- | --------------------------------------------------------------------------------------- | ------------- | ---------------- | ----------- | ----------- | ---------- | ------------ | -------- |
| Retry + backoff            | ✓ (tanpa jitter)                                                                        | ✓             | ✓                | ✓           | ✓           | ✓          | —            | sebagian |
| Rate-limit (`Retry-After`) | ✓                                                                                       | ✓             | ✓                | ?           | ?           | ✓          | —            | ?        |
| Reconnect strategy         | poll 3 s tetap                                                                          | 5 s tetap     | 5 s tetap        | n/a         | n/a         | 5 s tetap  | poll         | n/a      |
| Heartbeat / liveness       | —                                                                                       | —             | kirim, tanpa ACK | n/a         | n/a         | —          | —            | —        |
| Health check               | modul `channel-health.ts` ada (probe per channel); wiring ke runtime tidak diverifikasi |               |                  |             |             |            |              |          |
| Dedup event                | offset (memori)                                                                         | ✗             | ✗                | ✗           | ✗           | ✗          | uid (memori) | ✗        |
| Idempotency outbound       | ✗                                                                                       | ✗             | ✗                | ✗           | ✗           | ✗          | ✗            | ✗        |
| Ordering                   | serial global                                                                           | per frame     | per frame        | per request | per request | per frame  | serial       | —        |
| Backpressure               | serial (HOL)                                                                            | tidak ada     | tidak ada        | tidak ada   | tidak ada   | tidak ada  | serial       | —        |
| Dead-letter                | ✗                                                                                       | ✗             | ✗                | ✗           | ✗           | ✗          | ✗            | ✗        |
| Delivery ack/record        | ✗                                                                                       | ✗             | ✗                | ✗           | ✗           | ✗          | ✗            | ✗        |
| Graceful shutdown          | ✓                                                                                       | ✗ (reconnect) | ✗ (reconnect)    | n/a         | n/a         | ✗          | ✓            | —        |
| Isolasi channel            | ✗ (startAll, crash proses)                                                              |               |                  |             |             |            |              |          |

Exactly-once **tidak** dapat dicapai lintas platform pesan eksternal; target realistis: at-least-once inbound + dedup berbasis id platform, at-most-once outbound untuk operasi non-idempoten kecuali platform mendukung idempotency key.

## 6. Pengalaman user saat gagal

| Situasi                                        | Yang dialami user                                                                                       | Bukti                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------- |
| Pesan tidak bisa diproses (handler throw)      | Telegram: diam (di-log). Slack/Discord WS: **proses mati**, semua channel diam. Webhook: platform retry | §3                          |
| Agent sementara tidak tersedia (provider down) | "Task Failed" + teks error mentah                                                                       | `gateway-worker.ts:376-385` |
| Tool gagal                                     | Model menerima error; user melihat jawaban model                                                        | runtime                     |
| Respons lambat                                 | Typing indicator (keepalive) di channel yang mendukung; chat lain di Telegram ikut tertunda             | P2-CH-01                    |
| Timeout                                        | Tidak ada timeout turn; tidak ada pesan                                                                 | G-20, P2-CH-04              |
| Koneksi terputus                               | Reconnect 5 s; pesan selama putus: Discord hilang (tanpa resume), Slack bergantung retry Slack          | §3                          |
| Pengiriman balasan gagal setelah retry         | Diam; hanya log server                                                                                  | `deliver()`                 |

## 7. Registri temuan channel

| ID       | Temuan                                                                                                                         | Severity           | Verifikasi                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------ | --------------------------------------------- |
| P2-CH-01 | Turn agent berjalan di jalur inbound (HOL blocking, deadlock approval, ack webhook lambat)                                     | Critical (Level 1) | Probe Q4 + code-read                          |
| P2-CH-02 | `startAll` gagal total bila satu adapter gagal                                                                                 | High               | Probe Q5                                      |
| P2-CH-03 | Retry POST non-idempoten → pesan ganda                                                                                         | Medium             | Probe Q6                                      |
| P2-CH-04 | Tanpa timeout HTTP outbound                                                                                                    | Medium             | code-read                                     |
| P2-CH-05 | Error mentah ke user                                                                                                           | Low–Medium         | code-read                                     |
| P2-CH-06 | Unhandled rejection di handler WS (Slack/Discord/Mattermost) mematikan proses                                                  | High               | code-read; tidak ada handler global (grep)    |
| P2-CH-07 | `stop()` memicu reconnect; backoff tetap; Discord tanpa resume/heartbeat ACK; URL Socket Mode Slack tidak standar              | Medium             | code-read                                     |
| P2-CH-08 | Tanpa dedup event inbound (kecuali Telegram offset & IMAP uid di memori)                                                       | Medium             | code-read                                     |
| P2-CH-09 | Tanpa outbox/DLQ/status delivery; `ChannelHub.sendMessage` ke channel tak terdaftar dan web-chat tanpa klien dibuang diam-diam | Medium             | Probe Q5 (bagian unknown channel) + code-read |
| P2-CH-10 | Verifikasi inbound Google Chat/Feishu/SMS tidak ditemukan                                                                      | Unverified         | code-read parsial                             |

## 8. Rekomendasi channel (ringkas; detail di backlog)

1. **Lepaskan turn dari jalur inbound**: worker menjalankan run lewat antrean per-sesi (`SessionRunQueue`, G-09) dan handler `AGENT_RUN_REQUESTED` me-_enqueue_ lalu kembali. Webhook di-ack segera.
2. **Guard proses**: `process.on('unhandledRejection')` yang log + metrik; bungkus semua `onmessage` dengan try/catch.
3. **`startAll` → `Promise.allSettled`** + status per channel (health).
4. **Reconnect**: backoff eksponensial + jitter + flag `stopping`; Discord resume (`session_id` + `seq`) dan heartbeat ACK; Slack via `apps.connections.open`.
5. **Dedup inbound**: LRU per channel atas id platform (Slack `event_id`, Discord message id, WhatsApp `message.id`, Telegram `update_id` persisten).
6. **Outbound**: `AbortSignal.timeout`, jitter, jangan retry POST pada 5xx kecuali ada idempotency key; outbox persisten (`sessions/<id>/outbox.jsonl`) + DLQ + catatan status delivery.
7. **Pesan error user-friendly** dengan correlation id; detail hanya di log.
