# 02 — A2A Client/Server Interoperability (wire-level)

## 1. Metode

Probe dijalankan di scratchpad audit (di luar repo), tanpa LLM dan tanpa jaringan eksternal:

- **Server:** `bootstrapA2A` asli (Anvio) dengan workspace & runtime palsu (runtime menggema input), dipasang di `A2AServer.start()` pada port lokal.
- **Klien 1 (SDK resmi):** `A2AClient` Anvio, yang merupakan pembungkus tipis `ClientFactory` + `JsonRpcTransportFactory`/`RestTransportFactory` dari `@a2a-js/sdk@1.3.0`.
- **Klien 2 (independen):** `fetch` mentah dengan JSON-RPC sesuai spec 1.0 — tidak memakai kode Anvio maupun SDK.

Interop dengan implementasi bahasa lain (Python `a2a-sdk`, server referensi) **tidak dijalankan**: memerlukan instalasi paket tambahan. Rencana di §4.

## 2. Hasil

```text
[A1] {"name":"alpha","interfaces":["JSONRPC@1.0","HTTP+JSON@1.0"],
      "capabilities":{"streaming":true,"pushNotifications":true,"extensions":[],"extendedAgentCard":false},
      "securitySchemes":{},"skills":["research"],"agentsJsonStatus":404}
[A2] {"t1":{"state":3,"text":"echo:first","artifacts":0},"sameContext":true,
      "runs":["alpha/sess-1/a2a-remote","alpha/sess-2/a2a-remote"],
      "getTaskStatus":"3","cancelCompleted":"error:Task not cancelable: 2122…"}
[A3] {"v1_SendMessage":{"http":200,"ext":null,"ok":true},
      "v03_message_send":{"http":200,"ok":false,"err":-32009,"errMsg":"The requested A2A protocol version '0.3' is not supported…"},
      "unsupportedVersion":{"http":200,"ok":false,"err":-32009}}
[A4] {"clientWithApiKey":"error:Authentication required: provide X-API-Key header or Bearer token",
      "rawWithHeader":{"http":200,"ok":true},
      "rawWithoutKey":{"http":500,"err":"Authentication required: …"}}
```

| #   | Skenario                       | Expected                                                                                  | Actual                                                                                                                                                                 | Result                                        |
| --- | ------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| A1  | Ambil Agent Card               | Card valid 1.0, semua agent yang dikonfigurasi dapat ditemukan, skema keamanan diiklankan | Card valid 1.0 untuk agent pertama saja; `agents.json` 404; `securitySchemes` kosong walau auth aktif                                                                  | **PARTIAL**                                   |
| A2  | SDK resmi: send → get → cancel | Task selesai; konteks sama ⇒ percakapan bersambung; cancel task selesai ditolak           | Task `COMPLETED` (3) dengan teks benar; `contextId` dipertahankan tetapi **dua sesi berbeda**; `GetTask` OK; cancel task selesai → `Task not cancelable` (sesuai spec) | **PASS (wire)** / **FAIL (semantik konteks)** |
| A3  | JSON-RPC mentah 1.0            | `SendMessage` + `A2A-Version: 1.0` diterima                                               | Diterima. Tanpa header (0.3) dan `9.9` ditolak `-32009` — perilaku spec                                                                                                | **PASS**                                      |
| A4  | Autentikasi                    | Klien yang dikonfigurasi `apiKey` berhasil; tanpa kunci ditolak dengan error auth         | Klien Anvio **gagal** (kunci tidak dikirim); kunci via header mentah berhasil; tanpa kunci → **HTTP 500**                                                              | **FAIL**                                      |
| A5  | Streaming                      | Delta/artifact bertahap                                                                   | Tidak diprobe dengan klien; code-read: hanya status akhir                                                                                                              | **UNVERIFIED** (diperkirakan FAIL semantik)   |
| A6  | Cancel run berjalan            | Run dihentikan, state CANCELED                                                            | Code-read: run tidak dihentikan                                                                                                                                        | **FAIL (code-read)**                          |

## 3. Jawaban interoperabilitas

| Arah                                          | Status                                                                                                         | Penjelasan                               |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Klien A2A eksternal (1.0, tanpa auth) → Anvio | **Berfungsi**                                                                                                  | Card + SendMessage + GetTask sesuai spec |
| Klien eksternal (1.0, auth) → Anvio           | Berfungsi bila klien membaca dokumentasi out-of-band (card tidak mengiklankan skema); error 500 pada kegagalan |
| Klien eksternal 0.3 → Anvio                   | Tidak kompatibel (`-32009`) — sesuai SDK; tidak ada jalur kompatibilitas                                       |
| Anvio → agent eksternal 1.0 tanpa auth        | Berfungsi (wire diuji terhadap server Anvio sendiri yang memakai SDK resmi)                                    |
| Anvio → agent eksternal dengan auth           | **Tidak berfungsi** (P3-A2A-01)                                                                                |
| Anvio → agent eksternal 0.3                   | Diperkirakan gagal; Unverified                                                                                 |

## 4. Rencana test interop lanjutan (memerlukan persetujuan instalasi)

| Test | Implementasi lawan                                      | Kriteria                                          |
| ---- | ------------------------------------------------------- | ------------------------------------------------- |
| I1   | Python `a2a-sdk` HelloWorld server                      | `a2a_delegate` mengembalikan teks                 |
| I2   | Python `a2a-sdk` client → Anvio                         | Card, SendMessage, GetTask, CancelTask            |
| I3   | Streaming via `SendStreamingMessage` dari Python client | ≥2 `TaskStatusUpdateEvent` + artifact update      |
| I4   | Auth bearer di kedua arah                               | 200 dengan token, 401 tanpa token                 |
| I5   | Remote 0.3 (versi SDK lama)                             | Pesan error yang jelas di tool, bukan stack trace |
