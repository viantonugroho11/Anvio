# 03 — Soul & Persona Comparison

## 1. Arsitektur dua lapis Slaude

| Lapis                | Sumber                                                                   | Bukti                                                                 | Bisa diubah operator?                                 |
| -------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------- |
| **Runtime baseline** | Konstanta `RUNTIME_BASELINE` (`<runtime-baseline>…`)                     | `src/soul/loader.ts:6-167`                                            | Tidak (hard-coded; hanya varian KB on/off `:353-355`) |
| **Persona**          | `$SLAUDE_HOME/SOUL.md` (atau persona dari DB/git di gateway)             | `loadSoul()` `loader.ts:294-305`; starter persona di-seed bila kosong | Ya                                                    |
| Komposisi            | `soulSystemBlock()` → `${baseline}\n\n<persona>\n${persona}\n</persona>` | `loader.ts:311-314`                                                   | —                                                     |
| Override per channel | `## Channel <#C…>` → `effectiveSoulForChannel` (replace semantics)       | `extract.ts:349`; field note 2026-06-20                               | Ya                                                    |
| Override runtime     | `/soul` + `soul_override` (ACL manager-editable)                         | field note 2026-06-11 (Unverified di kode audit ini)                  | Manager                                               |

### Data terstruktur (SoulData)

`extractSoulData` (`extract.ts:229-275`):

1. Cache hit pada `sha256(SOUL.md)` → pakai (cache **wajib bertanda HMAC** bila `SLAUDE_MASTER_KEY` ada; entri tak bertanda ditolak — `:58-88`).
2. Miss → panggilan LLM tanpa tool (`callExtractor`, `:130-176`) → `parseJsonLoose` → **validasi zod** → **`assertIdsGroundedInPersona`**: setiap Slack id (manager, backup, channel, blocked, approver) yang tidak muncul verbatim di persona → **ditolak** (`:190-210`).
3. Fallback regex bila LLM gagal.

Approver dipakai oleh `ApprovalGate.#resolveApprovers` (`approval-gate.ts:255-282`): SoulData approvers → parser scope regex → legacy kategori → env → kosong (**kosong = siapa pun boleh klik**).

## 2. Anvio (status setelah PR #112)

| Lapis                     | Sumber                                                                                                                                   | Bukti                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Baseline hard-coded       | **Tidak ada** setara `RUNTIME_BASELINE`; instruksi tool/harness ditambahkan sebagai teks tool (`harness/src/runtime-tool-port.ts:43-63`) | —                                 |
| Persona                   | `workspace/personas/*.md`                                                                                                                | `PersonaService`                  |
| Soul identitas            | `workspace/souls/<slug>/SOUL.md`                                                                                                         | `packages/souls`                  |
| Soul policy               | Bagian `## Approvers`, `## Mandate` di SOUL.md yang sama                                                                                 | `soul-gate/src/soul-md-parser.ts` |
| Ekstraksi LLM + grounding | `soul-policy-llm.ts` + `verifyPolicyIds` — **memfilter** id yang tidak verbatim (bukan menolak seluruh hasil)                            | `soul-gate/src/verifier.ts:4-27`  |
| Cache policy              | `policy-cache.ts` (tanpa tanda tangan; Unverified detail)                                                                                | `soul-gate/src/policy-cache.ts`   |
| Simpan lossless           | ✅ sejak T-003                                                                                                                           | PR #112                           |
| Facts sebagai identitas   | Diberi label "unverified notes" sejak T-002                                                                                              | PR #112                           |

## 3. Perbandingan

| Aspek                                    | Anvio                                                          | Slaude                                                                    | Lebih baik                                                                                                        |
| ---------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Baseline yang tidak bisa ditimpa persona | ✗                                                              | ✔ `RUNTIME_BASELINE`                                                      | Slaude                                                                                                            |
| Struktur identitas tertipe               | ✔ zod `soulSpecSchema` (values, personality, style, evolution) | Prosa + SoulData (manager, channels, approvers)                           | Anvio untuk identitas; Slaude untuk policy                                                                        |
| Grounding id hasil LLM                   | Filter per id                                                  | Tolak seluruh ekstraksi bila ada id karangan                              | Slaude lebih ketat (hasil sebagian bisa menyesatkan), Anvio lebih toleran — keduanya mencegah perluasan allowlist |
| Integritas cache                         | ?                                                              | HMAC terikat master key                                                   | Slaude                                                                                                            |
| Override per channel                     | ✗                                                              | ✔                                                                         | Slaude                                                                                                            |
| Versi soul                               | ✗ (T-034)                                                      | Git (personas-as-code, field note 2026-10-01; tidak diverifikasi di kode) | Slaude (bila dipakai)                                                                                             |
| Hot reload                               | Soul dimuat tiap turn (efektif hot)                            | Reload sesi tertunda sampai input habis (field note)                      | Setara                                                                                                            |
| Identitas per agent                      | Soul per agent                                                 | Satu persona per deploy / per persona gateway                             | Anvio lebih fleksibel                                                                                             |
| Pemisahan soul vs memory                 | Facts dirender terpisah berlabel (T-002)                       | `<memory-context>` terpisah dari `<persona>`                              | Setara setelah T-002                                                                                              |
| Default approver kosong                  | Harness: bergantung policy                                     | **Siapa pun boleh klik** (`approval-gate.ts:259`)                         | Keduanya berisiko; Anvio harus fail-closed                                                                        |

### Batas kepercayaan model vs aplikasi

Di kedua sistem, **LLM menafsirkan SOUL.md menjadi daftar approver**, lalu aplikasi menegakkannya. Pengaman yang benar: id dari LLM hanya boleh menyempitkan, tidak memperluas, dan harus ter-ground ke teks. Keduanya sudah melakukan grounding. Yang Anvio belum punya: tanda tangan cache dan kebijakan "kosong = tolak" (Slaude juga tidak — **jangan ditiru**).

## 4. Kebutuhan Anvio

| Kebutuhan                       | Perlu?        | Alasan                                                                                                                                                                                               |
| ------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Validasi soul lebih kuat        | Ya (kecil)    | Tolak-penuh ala Slaude sebagai mode `strict`                                                                                                                                                         |
| Konfigurasi soul tertipe        | Sudah ada     | —                                                                                                                                                                                                    |
| Versi soul                      | Ya            | T-034                                                                                                                                                                                                |
| Hot reload                      | Sudah efektif | —                                                                                                                                                                                                    |
| Identitas per agent             | Sudah ada     | —                                                                                                                                                                                                    |
| Pemisahan soul–memory           | Sudah (T-002) | —                                                                                                                                                                                                    |
| **Batas instruksi terlindungi** | **Ya**        | Adopsi `RUNTIME_BASELINE`: blok system immutable (aturan approval, larangan mengikuti instruksi dari tool output, format channel) yang selalu dirender pertama dan tidak berasal dari file workspace |
