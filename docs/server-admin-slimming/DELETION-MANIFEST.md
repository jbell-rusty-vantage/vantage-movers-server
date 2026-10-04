# Deletion manifest (SLIM-10)

Status: **prepared, not executed.** The Owner and the user authorized the physical deletion. It runs once, after the slim server and Admin are deployed and quiesced (LEDGER, IMPLEMENTATION-PLAN §3 steps 4–5). If it ran before the deploy, the old code would recreate the collections.

The executable manifest is [`ops/slimming/deletion-manifest.json`](../../ops/slimming/deletion-manifest.json), with Blob keys in [`ops/slimming/conversation-blob-keys.json`](../../ops/slimming/conversation-blob-keys.json). `ops/slimming/inventory.ts --write-manifest` generates both from [`ops/slimming/policy.ts`](../../ops/slimming/policy.ts) plus a live read-only observation. [`ops/slimming/purge.ts`](../../ops/slimming/purge.ts) executes them. This document describes the manifest; when they differ, the JSON (and its hash) is what runs.

Current manifest: generated **2026-10-04T03:07:09Z**, hash **`948420886cf908482fb4e4325d1c16724759705b36471dd6d5de7e3114497143`**. It will be regenerated after quiescence, so that hash is for review only and is never the one to apply.

## 1. Drop targets

Exact namespaces. UUIDs and counts are asserted at step (a) and again immediately before each drop. Live count must equal the manifest count; for a target with a TTL index it may only be lower. Any growth means a writer is still active, and the purge aborts.

| Namespace | UUID | Docs | Storage + index MB | Spec | Gate (must be deployed and quiesced) |
| --- | --- | ---: | ---: | --- | --- |
| `vantagemovers.operational_events` | `6c05b1bb9263471180bb9824ee030e35` | 13,800 | 7.6 | §4 | SLIM-04: Health replaced; every OperationalEvents writer removed |
| `vantagemovers.operational_incidents` | `231e82663e57480db8dbd7b45607f6be` | 26 | 0.4 | §4 | SLIM-04 |
| `vantagemovers.notification_deliveries` | `db1fa7f7519643ef98482d7d592c28ec` | 118 | 0.3 | §4 | SLIM-04: digest cron and notification writers removed |
| `vantagemovers.lead_conversations` | `0797c498e6a04209baff424ead9f8f11` | 4,088 | 10.1 | §7.2 | SLIM-06: no transcript/media/STT reader or worker |
| `vantagemovers.intelligence_runs` | `9ee9718d898449b1b852647249efcaa1` | 10,523 | 96.5 | §7.2 | SLIM-06: run tokens/submissions fenced |
| `vantagemovers.intelligence_evidence_snapshots` | `c54e97dd81e34c42818737a8aa22c8c9` | 53,161 | 240.1 | §7.2 | SLIM-06 |
| `vantagemovers.intelligence_submissions` | `ea6caa6a2e244a66a981acf7063ce9e9` | 9,183 | 43.6 | §7.2 | SLIM-06 |
| `vantagemovers.intelligence_findings` | `c0b7f415c247407ab4905518920cd69f` | 74,971 | 30.1 | §7.2 | SLIM-06 + HUMAN-FACTS (restriction sources backed up) |
| `vantagemovers.intelligence_effects` | `2e6d4f6ad9854d199cdd723bef2da2a1` | 17,176 | 4.3 | §7.2 | SLIM-06 |
| `vantagemovers.intelligence_owner_assessments` | `d7395e19654944958d21851d2c43c400` | 12 | 0.1 | §7.2 | SLIM-06 |
| `vantagemovers.move_assessment_artifacts` | `cea0ea3098c749cf94483e06d42fc7b4` | 2,490 | 9.2 | §7.2 | SLIM-06: assessment producers removed |
| `vantagemovers.sales_intelligence_ai_budget` | `69fa7435d261421c8613d0958848904e` | 2 | 0.1 | §7.2 | SLIM-06: reservations settled |
| `vantagemovers.sales_intelligence_ai_reservations` | `85f79a3b432d4889a5e0a03c4a607a76` | 33,409 | 9.3 | §7.2 | SLIM-06 |
| `vantagemovers.sales_intelligence_attention_snapshots` | `5d51df3ed24349ada47771144ea97f10` | 5 (TTL) | 1.0 | §7.2 | SLIM-07: Attention publishers/readers retired |
| `vantagemovers.sales_intelligence_attention_artifacts` | `b7d968b2bccd4215854e2e3ece907c4c` | 1,025 | 18.7 | §7.2 | SLIM-07 |
| `vantagemovers.outreach_records` | `f216214c855442cba465c4a187be52b1` | 8,696 | 5.5 | §7.2 | SLIM-07 + HUMAN-FACTS disposition |
| `vantagemovers.outreach_followups` | `4ec544009a224a9ea575eecfe5799e91` | 585 | 0.6 | §7.2 | SLIM-07 + HUMAN-FACTS (backup handoff, never replayed) |
| `vantagemovers.outreach_band_transitions` | `c9a06fb28462431fa46f002eb733fd86` | 7,110 | 1.6 | §7.2 | SLIM-07 |
| `vantagemovers.outreach_rep_days` | `52ce7182ef384a81aaeada10be456e29` | 72 | 0.1 | §7.2 | SLIM-07 |
| `vantageadmin.admin_audit_logs` | `9009883807f44730b8fe4099fc2c4671` | 2,537 | 1.2 | §6 | SLIM-08: Admin page/API/auth/proxy writers removed and Admin deployed |

**Database drop (§3):** `vantagemovershistorical`, 14.1 MB on disk, exactly these 6 collections and UUIDs: `agents` `804c379c…3206` (48), `booked_leads` `ba063665…cdef3` (4,769), `call_leads` `9ee48843…6bf1` (3,354), `cancelled_leads` `8b2ce1b8…99af` (365), `customers` `dce3f929…1402` (4,535), `form_leads` `7382f733…e370` (10,223). Full UUIDs are in the JSON. Gate: SLIM-03 deployed, with zero `useDb('vantagemovershistorical')` readers or writers. An added, removed or re-created collection aborts the drop.

**Absent targets** (asserted still absent): `vantagemovers.operational_report_runs` (§4; never created in production).

**Not targets:** the five `unknown` main-DB collections (`data_migration_runs`, `granot_backfill_deliveries`, `historical_api_backfill_checkpoints`, `historical_backfill_checkpoints`, `historical_backfill_runs`; no reader or writer in the workspace) and the `testvantagemovers*` databases. Both are excluded until someone classifies them explicitly.

Measured reclaim from the drops: about 448 MB storage + 33 MB indexes (20 collections) + 14 MB (historical DB), plus 1.69 GiB of Blob.

## 2. Targeted cleanups in retained collections

They run in `_id` order, in bounded batches (default 500, maximum 2,000). The selection filter is re-checked at write time, a checkpoint is written after every page, and each cleanup is idempotent. After each one, the purge verifies that zero documents still match. Every touched document is backed up first.

| Id | Collection | Operation (exact) | Expected at observation | Status |
| --- | --- | --- | ---: | --- |
| C2 | `sales_intelligence_jobs` | Stages `outreach_ensure, outreach_derive, recording_discovery, media, media_fetch, transcription, analysis, application, move_assessment`: abort if any row holds a live lease. Then set `pending/retry/paused` and expired-lease `leased` rows to `dead_letter`, with `reason: "slimming_retired_stage"`, lease cleared and `lease_epoch` +1. Then delete every `completed/dead_letter` row of those stages. Afterwards 0 rows of those stages remain | 124,381 (122,386 completed, 1,112 dead_letter, 548 paused, 334 retry, 1 pending; 84.9 MB) | **final** |
| C3 | `sales_intelligence_sync_state` | Delete `scope ∈ {attention_artifacts:csi-production:vantagemovers, attention_publish, attention_publish_fence:csi-production:vantagemovers, intelligence_source_scan, overview_refresh, outreach_repair:OutreachRecord}` | 6 | **final** |
| C6 | `sales_intelligence_sync_state` | Delete `scope ∈ {outreach_ensure, outreach_entity_changes, outreach_repair:FormLead, outreach_repair:CallLead, outreach_repair:CallInteraction}` | 5 | **to be finalized in wave 3**: only if S-NUM's independent nomination path does not reuse these cursors (SPEC §7.4 watermark backstop) |
| C1 | `contact_numbers` | `$unset running_summary, intelligence_schedule, rollups.open_outreach_count, rollups.conversations_analyzed_total, rollups.last_analyzed_at, rollups.outreach_records_total` | 7,028 docs (`running_summary` text on 898) | **to be finalized in wave 3**: the field list must equal the ContactNumber schema cut (S-NUM/S-OUT) |
| C5 | `contact_numbers` | `$unset content_purge_pending, retention_epoch, evidence_fence, purged_at` | 7,028 | **to be finalized in wave 3**: only if the slim schema drops conversation-content retention bookkeeping. Otherwise remove the entry, or the purge aborts on growth |
| C4 | `sales_intelligence_audit_events` | Delete `event_kind ∈ {37 retired kinds}` AND `actor.kind ∈ {worker, intelligence}` (exact list in `policy.ts` `RETIRED_AUDIT_EVENT_KINDS`). Owner/Rep rows and retained kinds stay | 107,435 rows (246.6 MB of 423.8 MB) | **to be finalized in wave 3**: confirm no retained reader (S-AI/S-OUT; e.g. `lead_progress_updated` is read by the retiring Overview) |

Cleanups considered and **not** manifested: `sales_intelligence_command_executions` (`reanalyze` 765 rows, Owner replay authority, 0.5 MB); `sales_intelligence_review_items` (kept by the HUMAN-FACTS default); `sales_intelligence_policy_versions` (all kept; the active pointer and history); split-stage jobs (`number_refresh`, `rebuild`, `backfill`, `retention`: their completed rows expire through the 14-day TTL, and the 524 `number_refresh` dead letters and 23 paused rows wait for the S-AI stage decision); and `sales_intelligence_jobs.owner_reanalysis`, which is non-null on 765 legacy `analysis` rows that C2 deletes anyway.

`purge.ts --apply` **refuses to run while any cleanup is `pending_wave3`.** To finalize, the coordinator edits `CLEANUP_STATUS` and the lists in `policy.ts` (setting an entry to `final`, changing its list, or deleting it), then regenerates the manifest. Lanes' `data_manifest_needs` merge in the same way.

## 3. Blob objects

Store prefix `conversations/` (private Vercel Blob, conversation audio): **3,017 keys, 1,813,126,869 bytes**, uploaded 2026-08-27 → 2026-10-04. Every key is referenced by a `lead_conversations.media.blob_pathname`, and no retained collection references any key. Unreferenced keys under the prefix: 0. The exact key list is `conversation-blob-keys.json`; its sha256 (canonical JSON) `a0b6f4b19d10e47e107538d9a3873487fbafb284592e7262dce339705ece8322` is inside the hashed targets. Only listed keys are deleted, in batches of 100, and the prefix is listed again to prove they are gone. Unlisted keys under the prefix are reported and never deleted. `dev-ops/` and anything outside `conversations/` are never touched. RingCentral's own provider recordings are not in this store.

## 4. Protected (never dropped, checked present before and after)

Main DB (`NEVER_DROP`): `granot_webhook_receipts`, `entity_changes`, `daily_operations_events`, `daily_operations_days`, `sales_intelligence_jobs`, `sales_intelligence_sync_state`, `sales_intelligence_sync_windows`, `sales_intelligence_audit_events`, `sales_intelligence_command_executions`, `sales_intelligence_policy_versions`, `sales_intelligence_policy_pointers`, `sales_intelligence_contact_restrictions`, `sales_intelligence_owner_instructions`, `sales_intelligence_review_items`, `owner_rep_nudges`, `contact_numbers`, `call_interactions`, `call_interaction_aliases`, `number_lead_attachments`, `rep_identity_links`, `ringcentral_directory_snapshots`, the 8 `reporting_*` collections, `customers`, `agents`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `granot_observations`, `synchronization_decisions`, `granot_record_links`, `granot_lifecycle_activations`, `domain_command_executions`, `operations_registry_changes`. Admin DB: `admin_users`, `admin_user_invites`. Every other `keep`/`unknown` namespace in [INVENTORY.md](evidence/INVENTORY.md) is protected by omission: the purge only touches what the manifest names.

Databases that can never be a database-drop target, whatever the JSON says: `vantagemovers`, `vantageadmin`, `admin`, `local`, `config`. `assertManifestInvariants` (in `ops/slimming/lib/manifest.ts`) also refuses any database drop other than `vantagemovershistorical`, any collection drop outside the main or Admin DB, any `NEVER_DROP` name, any target without a UUID, any cleanup on a dropped collection, and any Blob prefix other than `conversations/`.

## 5. Manifest hash procedure

1. `manifest_hash = sha256(canonicalJson(targets))`. `canonicalJson` sorts object keys and has no whitespace; `targets` holds the cluster fingerprint and replica set, DB names, every drop target with UUID/count/sizes/TTL, absent targets, cleanups with their exact lists and expected counts, the Blob key-list sha256, and the protected namespaces with UUIDs and counts. `generated_at` and `source` are outside the hash.
2. Recompute independently: `node --import tsx -e "console.log(require('./ops/slimming/lib/manifest').loadManifest().computedHash)"` from `vantage-main-server`. `loadManifest` also refuses a file whose stored `manifest_hash` does not match its `targets`.
3. The operator passes the reviewed hash as `--manifest-hash=`. Any edit to the JSON, to the key list, or a regeneration changes the hash, so the purge cannot run a plan nobody reviewed.

## 6. Execution sequence (for the coordinator)

1. Deploy the slim server and Admin. Confirm that `sales_intelligence_sync_state` scope `deployment` records the slim server commit. `purge.ts` refuses a deployed commit that does not descend from `6a374fab` or that still contains `src/models/{historical/index.ts, OperationalEvent.ts, LeadConversation.ts, salesIntelligence/attentionArtifact.ts, salesIntelligence/assessment.ts}`.
2. Quiesce and observe (≥ 48 h, IMPLEMENTATION-PLAN §3.4). Finalize the wave-3 entries in `policy.ts`.
3. `node --import tsx ops/slimming/inventory.ts --write-manifest`. Review the diff of `deletion-manifest.json` and record the printed hash.
4. `node --import tsx ops/slimming/purge.ts` (dry run). It must print `no problems`.
5. `node --import tsx ops/slimming/purge.ts --apply --manifest-hash=<hash> --backup-dir=<absolute dir outside the workspace> --i-confirm-slim-deployed`. The run directory `slimming-purge-<timestamp>/` receives `purge-log.json`, a copy of the manifest, one `.ejson.gz` per namespace or cleanup selection (count, sha256 and indexes recorded, each file read back before any mutation), and `blob/<key>` audio copies (`--skip-blob-backup` opts out explicitly and is logged). An interrupted run resumes with `--resume=<run dir>` and the same hash.
6. Steps (a) assert → (b) backup → (c) cleanups → (d) Blob delete → (e) collection drops → (f) historical DB drop → (g) verify (targets absent, protected present with counts, before/after `dbStats` and database sizes). Every step aborts on the first mismatch.
7. Keep the backup directory for the agreed recovery window (DATA-AND-STORAGE §3: proposed 30 days), then expire it. Record the run directory and final hashes in the ledger.
