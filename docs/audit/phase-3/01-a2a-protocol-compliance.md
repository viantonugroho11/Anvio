# 01 — A2A Protocol Compliance

## 1. Referensi & versi

| Item                         | Nilai                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spesifikasi                  | A2A **1.0.0** (`a2a-protocol.org/latest`), repo `a2aproject/A2A@98279d623163`                                                                                                                                     |
| Extensions                   | `a2a-protocol.org/latest/topics/extensions/`                                                                                                                                                                      |
| SDK dipakai Anvio            | `@a2a-js/sdk@1.3.0` (= versi npm terbaru saat audit), repo `a2aproject/a2a-js@b9402fdbda93`                                                                                                                       |
| `A2A_PROTOCOL_VERSION` (SDK) | `1.0` (terbukti dari Agent Card & error negosiasi versi)                                                                                                                                                          |
| Kode Anvio                   | `packages/a2a/src/*` (server, client, mapping), `packages/platform/src/a2a-bootstrap.ts`, routing `packages/platform/src/gateway-http.ts:308-316`, config `packages/core/src/schemas/workspace.schema.ts:160-196` |

Poin spec yang dipakai sebagai acuan: header `A2A-Version` (kosong = 0.3), `A2A-Extensions`; operasi `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, push-config, `GetExtendedAgentCard`; state `SUBMITTED, WORKING, COMPLETED, FAILED, CANCELED, REJECTED, INPUT_REQUIRED, AUTH_REQUIRED`; `contextId` mengelompokkan task/pesan, server boleh menerima `contextId` klien atau wajib menolak; `CancelTask` tidak dijamin berhasil, error `TaskNotCancelableError`.

## 2. Arsitektur

```mermaid
flowchart LR
  subgraph Gateway["gateway-http (port gateway)"]
    R["/a2a, /.well-known/agent.json, /agent-card.json, /agents.json"]
  end
  R --> EX[A2AServer.handleRequest → express app]
  EX --> CARD[agentCardHandler]
  EX --> RPC[jsonRpcHandler]
  EX --> REST[restHandler]
  RPC --> DRH[DefaultRequestHandler<br/>InMemoryTaskStore<br/>InMemoryPushNotificationStore]
  REST --> DRH
  DRH --> EXE[AnvioAgentExecutor]
  EXE --> ON[bootstrapA2A.onMessage]
  ON --> SS[sessions.create userId='a2a-remote']
  ON --> RT[runtime.run(defaultAgent) — non-streaming]
```

Server A2A tidak listen sendiri; ia dipasang di HTTP gateway (`gateway-http.ts:308-316`), di belakang autentikasi gateway apa pun yang berlaku untuk path tersebut (tidak ditelusuri lebih lanjut).

## 3. Kepatuhan server

| Kapabilitas                | Status                           | Bukti                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent Card endpoint        | Implemented                      | `/.well-known/agent-card.json` & `/.well-known/agent.json` (`a2a-server.ts:71-73`); probe A1                                                                                                                                                                                                                                                               |
| Discovery multi-agent      | **Partial**                      | `config.agents: '*'` memuat semua agent, tetapi kartu & eksekusi hanya untuk `agents[0]` (`a2a-server.ts:49`, `a2a-bootstrap.ts:36`). Probe A1: card `alpha`, agent `beta` tak terjangkau. `/.well-known/agents.json` di-route gateway tapi **404**                                                                                                        |
| Capabilities & skills      | Partial                          | `skills` = id skill agent (tanpa deskripsi, tag, contoh — `agent-card-builder.ts:48-57`); `streaming: true`, `pushNotifications: true` diiklankan                                                                                                                                                                                                          |
| Protocol bindings          | Implemented                      | JSON-RPC + HTTP+JSON @1.0 (probe A1)                                                                                                                                                                                                                                                                                                                       |
| Message handling           | Implemented                      | `SendMessage` via SDK resmi berhasil (probe A2, A3)                                                                                                                                                                                                                                                                                                        |
| Task lifecycle             | Partial                          | `SUBMITTED → WORKING → COMPLETED/FAILED` dipublikasikan; approval runtime (`awaiting_approval`) **dipetakan menjadi COMPLETED** karena `runtime.run` tidak throw dan `onMessage` selalu mem-publish COMPLETED (`a2a-bootstrap.ts:57-82`). `INPUT_REQUIRED`/`AUTH_REQUIRED` tidak pernah dipakai. Mapper `agentStreamEventToA2A` ada tapi **tidak dipakai** |
| Persistensi task           | **Missing**                      | `InMemoryTaskStore` (`a2a-server.ts:51`) — hilang saat restart                                                                                                                                                                                                                                                                                             |
| Streaming                  | **Configured Only**              | Card mengiklankan `streaming: true`, tetapi `onMessage` memanggil `runtime.run` (bukan `stream`) dan hanya mem-publish status akhir; tidak ada delta/artifact bertahap                                                                                                                                                                                     |
| Artifacts                  | **Missing**                      | Jawaban diletakkan di `status.message`, `artifacts: []` (probe A2: `artifacts: 0`)                                                                                                                                                                                                                                                                         |
| Cancellation               | **Partial (palsu)**              | `cancelTask` hanya menandai set lokal dan mem-publish `CANCELED` (`anvio-agent-executor.ts:96-109`); `isCancelled` tidak dibaca siapa pun; `runtime.stop` tidak dipanggil → run tetap jalan                                                                                                                                                                |
| `contextId` / multi-turn   | **Partial**                      | `contextId` diterima dan dikembalikan (probe A2 `sameContext: true`), tetapi setiap pesan membuat **sesi baru** (`a2a-bootstrap.ts:45-51`) → riwayat percakapan tidak tersambung                                                                                                                                                                           |
| AuthN                      | Partial                          | `X-API-Key` / `Bearer` dicocokkan constant-time (`anvio-user-builder.ts`); **default off** (`a2aAuthConfigSchema.enabled: false`); `jwt` & `scopes` di schema **Configured Only**                                                                                                                                                                          |
| AuthZ                      | Missing                          | Semua pemanggil terautentikasi = user `a2a-remote` yang sama; `scopes` tidak dicek                                                                                                                                                                                                                                                                         |
| Card mengiklankan security | **Missing**                      | `securitySchemes: {}` bahkan saat auth aktif (probe A1) → klien patuh spec tidak tahu harus mengirim kredensial                                                                                                                                                                                                                                            |
| Error protokol             | Partial                          | Negosiasi versi benar (`-32009 VersionNotSupported`, probe A3). **Gagal auth → HTTP 500 + "Authentication required"** (probe A4) alih-alih 401/error autentikasi; SDK mencetak "Unhandled error in JSON-RPC POST handler"                                                                                                                                  |
| Extensions                 | Missing                          | `capabilities.extensions: []` hard-coded; header `A2A-Extensions` tidak dibalas (probe A3 `ext: null`) — sah menurut spec (tidak ada extension diaktifkan), tetapi tidak ada mekanisme untuk mendaftarkan extension                                                                                                                                        |
| Push notifications         | Implemented (SDK) — **berisiko** | Default `pushNotifications: true` (`workspace.schema.ts:196`); `DefaultPushNotificationSender` mengirim ke URL yang diberikan klien → SSRF ke jaringan internal bila auth off (code-read, tidak dieksekusi)                                                                                                                                                |
| Boot failure               | Silent                           | `catch {}` tanpa log (`platform/src/index.ts:1012-1014`)                                                                                                                                                                                                                                                                                                   |

## 4. Kepatuhan klien

| Kapabilitas                 | Status               | Bukti                                                                                                                                                                                                                                                      |
| --------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote Agent Card discovery | Implemented          | `ClientFactory.createFromUrl` (SDK)                                                                                                                                                                                                                        |
| Capability matching         | Missing              | Tidak membaca `capabilities`/`skills` untuk memilih remote                                                                                                                                                                                                 |
| Delegasi task               | Implemented          | Tool `a2a_delegate` → `A2ATool.invoke` → `sendMessage` (default tool **off**)                                                                                                                                                                              |
| Tracking status             | Partial              | `getTask` ada di kelas, tidak dipakai tool; tool mengembalikan status mentah enum angka (`String(task.status?.state)`)                                                                                                                                     |
| Streaming                   | Partial              | `sendStreamingMessage` ada, tidak dipakai tool                                                                                                                                                                                                             |
| Artifact retrieval          | Partial              | Teks/data dari artifacts digabung (`a2a-tool.ts:51-75`); file part diabaikan                                                                                                                                                                               |
| Cancellation                | Partial              | `cancelTask` ada, tidak terhubung ke stop Anvio                                                                                                                                                                                                            |
| **Authentication**          | **Broken**           | `apiKey`/`bearerToken` disimpan di opsi tetapi **tidak pernah dipasang** ke `ClientFactory` (`a2a-client.ts:79-91`). Probe A4: klien dengan `apiKey` benar ditolak "Authentication required", sementara `fetch` mentah dengan `X-API-Key` yang sama sukses |
| Retry & timeout             | Missing              | `a2aRemoteSchema.timeoutMs` (default 120 s) **tidak diteruskan** ke `A2ATool` (`platform/src/index.ts:1021-1027`)                                                                                                                                          |
| Failure recovery            | Missing              | Tidak ada retry/circuit breaker/health check remote                                                                                                                                                                                                        |
| Remote 0.3 agents           | **Tidak kompatibel** | SDK 1.3.0 mengirim/menerima 1.0; server Anvio menolak klien 0.3 (probe A3 `-32009`). Kompatibilitas ke agent 0.3 eksternal Unverified tetapi diperkirakan gagal                                                                                            |

## 5. Temuan

| ID        | Temuan                                                                        | Severity                                |
| --------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| P3-A2A-01 | Klien tidak mengirim kredensial yang dikonfigurasi                            | High                                    |
| P3-A2A-02 | Hanya agent pertama yang diekspos; `agents.json` 404                          | Medium                                  |
| P3-A2A-03 | Approval runtime dilaporkan sebagai COMPLETED                                 | High                                    |
| P3-A2A-04 | Cancel tidak menghentikan run                                                 | Medium                                  |
| P3-A2A-05 | Tiap pesan = sesi baru, semua pemanggil = `a2a-remote` (berbagi memory/facts) | High                                    |
| P3-A2A-06 | Auth default off; push notification default on → agen + tool terekspos & SSRF | High (bila gateway terjangkau jaringan) |
| P3-A2A-07 | Card tidak mengiklankan `securitySchemes`                                     | Medium                                  |
| P3-A2A-08 | Streaming diiklankan tetapi tidak diimplementasi; tanpa artifacts             | Medium                                  |
| P3-A2A-09 | Task store in-memory                                                          | Medium                                  |
| P3-A2A-10 | Gagal auth → HTTP 500                                                         | Low                                     |
| P3-A2A-11 | `timeoutMs`, `jwt`, `scopes` Configured Only; boot failure ditelan            | Medium                                  |
| P3-A2A-12 | Tidak ada registrasi A2A extension                                            | Low (fitur)                             |

## 6. Klasifikasi

- **Kepatuhan wire 1.0:** baik — memakai SDK resmi; negosiasi versi benar; SDK resmi dapat menyelesaikan round-trip (probe A2).
- **Kebenaran semantik:** lemah — sesi, approval, cancel, streaming, artifact, identitas.
- **Production readiness:** belum — auth default off, push SSRF, in-memory store, klien tanpa auth/timeout.
