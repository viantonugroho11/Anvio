# 04 — Automatic Skill Creation & Update Lifecycle

## 1. Arsitektur skill saat ini

| Aspek             | Status              | Bukti                                                                                                                                                                  |
| ----------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry          | Implemented         | `SkillRegistry` (workspace loader) + `createSkillCatalogResolver` (bundled/community/team/private)                                                                     |
| Format & metadata | Implemented         | `core/src/schemas/skill.schema.ts`: `version`, `catalog`, `permissions`, `toolRequirements`, `routing`, `triggers`; SKILL.md agentskills.io/Hermes (`skill-import.ts`) |
| Discovery         | Implemented         | catalog resolver, `skills_list` (default on), `SkillTriggerCache` (mtime)                                                                                              |
| Loading           | Implemented         | `agent.spec.skills` + skill goal aktif + trigger match (`agents/src/runtime.ts` `assembleSystemPrompt`)                                                                |
| Activation        | Implemented         | Instruksi prosa disuntik ke system prompt; skill komposabel → tool `skill__<slug>`                                                                                     |
| Execution         | Implemented         | `executeSkill` (`skills/src/executor.ts`) untuk skill berlangkah; `param-validator.ts`                                                                                 |
| Dependensi        | Partial             | Skill memanggil `skill:<slug>` via composable registry; tanpa resolusi versi                                                                                           |
| Persistensi       | Implemented (file)  | `workspace/skills/`                                                                                                                                                    |
| Versioning        | Partial             | Field `version`; installer menyimpan versi di manifest; **promote/upgrade overwrite tanpa riwayat** (`skill-installer.ts:71`, `skill-evolution.ts:241`)                |
| Ownership/scope   | Partial             | `catalog` + lineage draft (`sourceSessionId`, `sourceUserId`, `sourceChannel`)                                                                                         |
| Permissions       | **Configured Only** | `permissions` & `toolRequirements` tidak dibaca executor/registry (grep 0 di `executor.ts`, `composable-registry.ts`)                                                  |
| Rollback          | Missing             | —                                                                                                                                                                      |

## 2. Pembuatan skill otomatis — 10 langkah

| #   | Langkah                   | Status               | Bukti                                                                                                                                                 |
| --- | ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Deteksi workflow reusable | Partial              | LLM `shouldCreate`; tanpa LLM selalu "ya" untuk output ≥20 char                                                                                       |
| 2   | Generate kandidat         | Implemented          | `SkillEvolutionSummarizer.fromSession/fromToolUse`                                                                                                    |
| 3   | Generate instruksi        | Implemented          | LLM / fallback rules (salinan teks mentah)                                                                                                            |
| 4   | Generate metadata         | Partial              | name, description, tags; **tanpa triggers**, permissions `[]`                                                                                         |
| 5   | Deteksi duplikat          | Partial              | `replaceForSession` untuk draft sesi; draft tool-use tidak; promote menolak overwrite isi berbeda (diff)                                              |
| 6   | Validasi & test           | **Missing**          | `SkillTestRunner` hanya CLI manual                                                                                                                    |
| 7   | Approval                  | Partial              | Draft sesi: manual (`/promote`, `skill_manage promote`). Tool-use: **auto-promote** bila `requireApproval` ≠ `true` (`learning/src/index.ts:188-191`) |
| 8   | Penyimpanan               | Implemented          | `_drafts/` → `skills/`                                                                                                                                |
| 9   | Update registry           | Implemented implisit | file baru terbaca loader; trigger cache berbasis mtime                                                                                                |
| 10  | Discovery sesi berikut    | Partial              | Skill auto tidak punya triggers dan tidak masuk `agent.spec.skills`; ditemukan hanya via `skills_list`/`skill_view` atau bila nama dipanggil          |

**Kesimpulan:** Anvio _dapat_ membuat file skill otomatis dan _dapat_ menerbitkannya; yang tidak ada adalah validasi, keamanan, dan bukti bahwa skill tersebut dipakai.

Jalur agent-authored: tool `skill_manage` (default off) — `create` menulis draft, `promote` menerbitkan (`platform/src/index.ts:810-834`). Agent dapat mempromosikan draft buatannya sendiri tanpa manusia.

## 3. Update skill otomatis

| Aspek                     | Status  | Bukti                                                                                                                                        |
| ------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Deteksi kegagalan skill   | Missing | Hasil `executeSkill` tidak dicatat per skill                                                                                                 |
| Pencocokan skill existing | Partial | Berdasarkan slug `<agent>-<tool>`, bukan semantik                                                                                            |
| Usulan perubahan          | Partial | Draft baru (bukan patch)                                                                                                                     |
| Validasi kompatibilitas   | Missing | —                                                                                                                                            |
| Regression test           | Missing | —                                                                                                                                            |
| Riwayat versi             | Missing | —                                                                                                                                            |
| Rollback                  | Missing | —                                                                                                                                            |
| Approval perubahan        | Partial | `promoteDraft` menolak overwrite tanpa `force`, mengembalikan unified diff (`skill-evolution.ts:225-240`) — ini satu-satunya pengaman update |
| Update atomik             | Missing | `fs.writeFile` langsung ke tujuan                                                                                                            |
| Update konkuren           | Missing | Tidak ada lock; dua promote bersamaan last-writer-wins                                                                                       |

Bandingkan Hermes: `skill_manage` dengan `create`/`patch`(old_string/new_string)/`delete`, approval opsional (`skills.write_approval`, default off) dengan staging `~/.hermes/pending/skills/` + `/skills diff|approve|reject`, linter advisory, scanner keamanan untuk install hub, dan curator untuk konsolidasi. Hermes juga tidak mendokumentasikan riwayat versi untuk edit agent — Anvio tidak tertinggal di aspek itu, tetapi tertinggal di staging/approval dan scanning.

## 4. Temuan

| ID        | Temuan                                                                                                                                                                          | Severity             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| P2-SKL-01 | Auto-promote skill dari output tool (= P2-LRN-01)                                                                                                                               | Critical             |
| P2-SKL-02 | `permissions`/`toolRequirements` skill tidak ditegakkan; skill `skill_call` memanggil `toolGateway` langsung, **melewati** harness & MCP gate (`platform/src/index.ts:911-918`) | High                 |
| P2-SKL-03 | Draft tool-use menumpuk tanpa batas (1 file per tool call)                                                                                                                      | Medium               |
| P2-SKL-04 | Tidak ada validasi/test sebelum publish                                                                                                                                         | High                 |
| P2-SKL-05 | Tidak ada versi/rollback saat promote atau upgrade                                                                                                                              | Medium               |
| P2-SKL-06 | Agent dapat mem-promote draft sendiri via `skill_manage`                                                                                                                        | Medium (default off) |

## 5. Evaluasi arsitektur kandidat

Kandidat di brief cocok **dengan modifikasi**: langkah "Pattern Detection" tidak perlu ML; cukup frekuensi (tool sequence yang sama ≥ N kali sukses di sesi berbeda). "Validation and Sandbox Tests" untuk skill **prosa** = scan + lint; untuk skill **berlangkah** = `SkillTestRunner` dengan `MockToolPort` yang sudah ada.

```mermaid
flowchart TB
  EX[Run/tool events] --> COL[Experience collector<br/>learning/experience.jsonl]
  COL --> PAT[Pattern detector<br/>tool-sequence frequency ≥ N sukses]
  PAT --> GEN[Candidate generator<br/>LLM; input diberi label untrusted]
  GEN --> DUP{Ada skill serupa?}
  DUP -->|ya| PATCH[Proposal patch + diff]
  DUP -->|tidak| NEW[Proposal skill baru]
  PATCH --> VAL
  NEW --> VAL[Validation<br/>schema, injection scan, size cap, SkillTestRunner]
  VAL -->|gagal| REJ[Rejected + alasan]
  VAL -->|lulus| POL{Policy}
  POL -->|prosa, scope private, tanpa tool| AUTO[Auto-publish (opsional, opt-in)]
  POL -->|berlangkah / tool berisiko / skill shared| HUM[Human approval]
  AUTO --> REG[(Versioned registry<br/>skills/slug/vN.md + current)]
  HUM --> REG
  REG --> DISC[Discovery: triggers + metrics]
  DISC --> MET[Metrics: reuse, failure, regression]
  MET --> PAT
```

Kebijakan:

- Pengetahuan berisiko rendah (preferensi, catatan) → memory user, auto, dengan scan & cap.
- Skill baru → selalu draft; publish otomatis hanya bila opt-in eksplisit **dan** lulus validasi **dan** non-executable.
- Skill berlangkah / yang menyentuh tool mutasi → approval manusia.
- Validasi gagal → tidak pernah publish.
- Versi sebelumnya selalu dapat dipulihkan (`skills/<slug>/.history/`).

## 6. Metrik evaluasi

| Metrik                  | Definisi                                                 | Sumber                                         |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| Generation success rate | draft valid / proposal                                   | learning log                                   |
| Validation pass rate    | lulus / divalidasi                                       | validator                                      |
| Reuse frequency         | pemakaian per skill per 7 hari                           | `skill_call`, trigger activation, `skill_view` |
| Failure rate            | eksekusi gagal / eksekusi                                | executor                                       |
| Update regression rate  | update yang di-rollback / update                         | registry history                               |
| Task improvement        | token & tool call per task sejenis sebelum/sesudah skill | token audit                                    |

## 7. Rencana bertahap

| Fase        | Isi                                                                                                                                                | Prasyarat    |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| S0 (hotfix) | Default `requireApproval: true` untuk tool-use learning; tidak ada auto-promote bila soul tidak ada; label untrusted + cap pada instruksi fallback | —            |
| S1          | Dedup draft per (agent, tool); batas jumlah draft; prune otomatis                                                                                  | S0           |
| S2          | Versioned registry + rollback; promote atomik (tmp + rename)                                                                                       | —            |
| S3          | Validator (schema, scan, lint) + `SkillTestRunner` di jalur promote                                                                                | S2           |
| S4          | Tegakkan `permissions`/`toolRequirements`; `skill_call` lewat rantai tool port penuh                                                               | P0-5 Phase 1 |
| S5          | Pattern detector + metrik; auto-publish opt-in untuk skill prosa private                                                                           | S1–S4        |
