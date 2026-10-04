# SLIM-01 production inventory (read-only)

Observed **2026-10-04T03:07:09Z** (UTC; 2026-10-03 23:07 America/New_York) by `ops/slimming/inventory.ts`, against the production Atlas cluster (fingerprint `a88bf1acb403fe0b` = first 16 hex of sha256 of the host list; replica set `atlas-khw1wz-shard-0`). The server and Admin `.env` files point at the same cluster. Source at observation: server `6a374fab` on `slim/server-admin`, Admin `adda9e18`. The deployed server commit recorded in `sales_intelligence_sync_state` scope `deployment` is `becf8de0` (pre-slimming).

Redacted machine-readable output: [`inventory.json`](inventory.json). It holds counts, sizes, UUIDs, index definitions, field-path names, scope identifiers and `_id`-derived dates only. No document values, phone numbers, names, transcripts or credentials (scanned: zero phone/e-mail patterns, no URI).

## How it was read

- Every Mongo call went through `ReadOnlyCluster` (`ops/slimming/lib/guarded-mongo.ts`). Its `commandStarted` guard exits the process (code 97) before any command outside `find/aggregate/count/distinct/list*/dbStats/collStats/getMore/hello/...` is written to the wire, and `aggregate` refuses `$out`/`$merge` at any depth. The unit suite proves both, including a child process that is killed by a synthetic `insert`/`drop` start event (`ops/slimming/lib/slimming.test.ts`).
- Full scans, run once: `$group` over `sales_intelligence_jobs` (180 MB) and `sales_intelligence_audit_events` (424 MB). Field paths came from `$sample` of at most 400 documents per collection, followed by `$exists` and non-null counts. Everything else used catalog commands, `_id`-ordered `limit 1` reads, or small collections.
- Blob: `@vercel/blob` 2.8.0 is installed. Only `list` was called.
- Runtime database name: `getMongoDatabaseName()` in `src/config/domain/runtime.ts` returns `vantagemovers` when `TEST_MODE` is not `true`. The server `.env` has `TEST_MODE=false`. The Admin auth DB is `ADMIN_AUTH_DB_NAME=vantageadmin`.
- OperationalEvents names: `src/config/domain/observability.ts` (`PRODUCTION_COLLECTION_NAMES`, `TEST_COLLECTION_NAMES`, prefix/custom modes) with `observabilityModelFactory.ts` (main runtime DB). The server `.env` sets neither `OBSERVABILITY_COLLECTION_MODE`, `OBSERVABILITY_COLLECTION_PREFIX` nor a custom name. No `test_operational_*` or prefixed alias exists in any database. `operational_report_runs` is **absent** in production; the manifest asserts it stays absent.

## Databases

| Database | Size on disk | Scope |
| --- | ---: | --- |
| `vantagemovers` | 847.0 MB | Main runtime DB: 118 collections, classified below |
| `vantagemovershistorical` | 14.1 MB | **Drop the whole database** (SPEC §3) |
| `vantageadmin` | 1.4 MB | Admin auth DB: drop `admin_audit_logs` only (SPEC §6) |
| `testvantagemovers` | 1.0 MB | Unknown / out of scope: 48 empty collections, not a target |
| `testvantagemovers_dlc01` | 2.2 MB | Unknown / out of scope: 38 collections, 33 documents, not a target |
| `admin`, `config`, `local` | — | System; never touched (`local` = 5.6 GB oplog) |

Main DB totals: 2,591.5 MB logical data, 691.5 MB storage, 155.5 MB indexes. Classification: 84 keep, 10 migrate (mixed, targeted cleanup), 19 drop, 5 unknown.

## Drop targets (measured)

| Namespace | UUID | Docs | Data MB | Storage MB | Index MB | TTL | Spec | `_id` dates |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `vantagemovers.operational_events` | `6c05b1bb9263471180bb9824ee030e35` | 13800 | 12.2 | 2.4 | 5.2 | no | §4 | 2026-09-29 – 2026-10-04 |
| `vantagemovers.operational_incidents` | `231e82663e57480db8dbd7b45607f6be` | 26 | 0.0 | 0.0 | 0.4 | no | §4 | 2026-09-29 – 2026-10-03 |
| `vantagemovers.notification_deliveries` | `db1fa7f7519643ef98482d7d592c28ec` | 118 | 0.2 | 0.1 | 0.3 | no | §4 | 2026-09-29 – 2026-10-04 |
| `vantagemovers.lead_conversations` | `0797c498e6a04209baff424ead9f8f11` | 4088 | 22.9 | 8.4 | 1.6 | no | §7.2 | 2026-08-27 – 2026-10-04 |
| `vantagemovers.intelligence_runs` | `9ee9718d898449b1b852647249efcaa1` | 10523 | 327.5 | 95.6 | 0.9 | no | §7.2 | 2026-09-20 – 2026-10-03 |
| `vantagemovers.intelligence_evidence_snapshots` | `c54e97dd81e34c42818737a8aa22c8c9` | 53161 | 798.8 | 233.4 | 6.7 | no | §7.2 | 2026-09-20 – 2026-10-01 |
| `vantagemovers.intelligence_submissions` | `ea6caa6a2e244a66a981acf7063ce9e9` | 9183 | 169.5 | 43.2 | 0.4 | no | §7.2 | 2026-09-20 – 2026-09-29 |
| `vantagemovers.intelligence_findings` | `c0b7f415c247407ab4905518920cd69f` | 74971 | 105.5 | 24.7 | 5.4 | no | §7.2 | 2026-09-20 – 2026-09-29 |
| `vantagemovers.intelligence_effects` | `2e6d4f6ad9854d199cdd723bef2da2a1` | 17176 | 11.1 | 2.3 | 2.0 | no | §7.2 | 2026-09-20 – 2026-09-29 |
| `vantagemovers.intelligence_owner_assessments` | `d7395e19654944958d21851d2c43c400` | 12 | 0.0 | 0.0 | 0.1 | no | §7.2 | 2026-09-22 – 2026-09-26 |
| `vantagemovers.move_assessment_artifacts` | `cea0ea3098c749cf94483e06d42fc7b4` | 2490 | 32.8 | 8.5 | 0.8 | no | §7.2 | 2026-09-23 – 2026-10-04 |
| `vantagemovers.sales_intelligence_ai_budget` | `69fa7435d261421c8613d0958848904e` | 2 | 0.0 | 0.0 | 0.1 | no | §7.2 | 2026-09-20 – 2026-10-01 |
| `vantagemovers.sales_intelligence_ai_reservations` | `85f79a3b432d4889a5e0a03c4a607a76` | 33409 | 22.5 | 4.8 | 4.6 | no | §7.2 | 2026-09-20 – 2026-10-04 |
| `vantagemovers.sales_intelligence_attention_snapshots` | `5d51df3ed24349ada47771144ea97f10` | 5 | 0.4 | 0.8 | 0.2 | yes | §7.2 | 2026-10-04 |
| `vantagemovers.sales_intelligence_attention_artifacts` | `b7d968b2bccd4215854e2e3ece907c4c` | 1025 | 7.3 | 18.5 | 0.3 | no | §7.2 | 2026-09-29 – 2026-10-04 |
| `vantagemovers.outreach_records` | `f216214c855442cba465c4a187be52b1` | 8696 | 14.4 | 3.5 | 2.0 | no | §7.2 | 2026-09-19 – 2026-10-04 |
| `vantagemovers.outreach_followups` | `4ec544009a224a9ea575eecfe5799e91` | 585 | 0.6 | 0.2 | 0.4 | no | §7.2 | 2026-09-20 – 2026-10-04 |
| `vantagemovers.outreach_band_transitions` | `c9a06fb28462431fa46f002eb733fd86` | 7110 | 2.8 | 0.8 | 0.8 | no | §7.2 | 2026-09-25 – 2026-10-04 |
| `vantagemovers.outreach_rep_days` | `52ce7182ef384a81aaeada10be456e29` | 72 | 0.0 | 0.0 | 0.1 | no | §7.2 | non-ObjectId `_id` |
| `vantageadmin.admin_audit_logs` | `9009883807f44730b8fe4099fc2c4671` | 2537 | 1.6 | 0.7 | 0.5 | no | §6 | 2026-06-01 – 2026-10-04 |
| **Total (20 collections)** | | **238,989** | **1,530.1** | **448.1** | **32.5** | | | |

`vantagemovershistorical` (SPEC §3, whole database, 6 collections, 23,294 documents, 18.7 MB data, 8.4 MB storage, 5.7 MB indexes):

| Collection | UUID | Docs | Data MB | Storage MB | Index MB | `_id` dates |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `agents` | `804c379ce9ef4c3ca396c7095bf43206` | 48 | 0.0 | 0.0 | 0.1 | 2026-05-22 – 2026-05-26 |
| `booked_leads` | `ba063665fd754beebdb320d63bfdcef3` | 4769 | 4.7 | 2.1 | 1.2 | 2026-05-22 |
| `call_leads` | `9ee48843970f459b9ee137d7d6651bf1` | 3354 | 2.0 | 0.7 | 0.7 | 2026-05-22 – 2026-06-16 |
| `cancelled_leads` | `8b2ce1b885fa49ce9d93f448f43999af` | 365 | 0.3 | 0.2 | 0.3 | 2026-05-22 |
| `customers` | `dce3f9297b17404c95cfab3152cf1402` | 4535 | 0.6 | 0.5 | 0.4 | 2026-05-22 |
| `form_leads` | `7382f73305d449cab8917cd8c145e370` | 10223 | 11.1 | 4.8 | 3.0 | 2026-05-22 |

Admin auth DB `vantageadmin`: `admin_audit_logs` (drop; 7 indexes `_id_, ok_1, timestamp_-1, admin_user_id_1_timestamp_-1, action_1_timestamp_-1, timestamp_1, action_1`), `admin_users` (keep, 9), `admin_user_invites` (keep, 0).

**Expected reclaim from the drops.** Measured allocated storage released by dropping the 20 collections and the historical database: 448.1 + 32.5 + 8.4 + 5.7 ≈ **494.7 MB** of WiredTiger storage+index, out of about 847 MB for the main DB plus 14 MB historical. That is the measured allocation, not a billing promise: dropping a collection or database frees its files at once, but Atlas billing tiers do not shrink automatically. In-place cleanups (below) free space *inside* retained collection files, which WiredTiger reuses but does not return without `compact`.

## Every main-DB collection, classified

Decision legend: **drop** = exact target; **migrate** = retained mixed collection with a targeted, manifested cleanup; **unknown** = no reader or writer anywhere in the workspace source (server, Admin, MCP, extension, clients), so it is protected and never a target until someone classifies it; **keep** = retained.

| Collection | Decision | Docs | Data MB | Storage MB | Index MB | Indexes | Owner / reason |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `intelligence_effects` | drop | 17176 | 11.1 | 2.3 | 2.0 | 3 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `intelligence_evidence_snapshots` | drop | 53161 | 798.8 | 233.4 | 6.7 | 6 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `intelligence_findings` | drop | 74971 | 105.5 | 24.7 | 5.4 | 5 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `intelligence_owner_assessments` | drop | 12 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `intelligence_runs` | drop | 10523 | 327.5 | 95.6 | 0.9 | 4 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `intelligence_submissions` | drop | 9183 | 169.5 | 43.2 | 0.4 | 2 | src/models/salesIntelligence/intelligence.ts: SPEC §7.2 exclusive target |
| `lead_conversations` | drop | 4088 | 22.9 | 8.4 | 1.6 | 11 | src/models/LeadConversation.ts: SPEC §7.2 exclusive target |
| `move_assessment_artifacts` | drop | 2490 | 32.8 | 8.5 | 0.8 | 5 | src/models/salesIntelligence/assessment.ts: SPEC §7.2 exclusive target |
| `notification_deliveries` | drop | 118 | 0.2 | 0.1 | 0.3 | 7 | src/models/NotificationDelivery.ts: SPEC §4 exclusive target |
| `operational_events` | drop | 13800 | 12.2 | 2.4 | 5.2 | 15 | src/models/OperationalEvent.ts: SPEC §4 exclusive target |
| `operational_incidents` | drop | 26 | 0.0 | 0.0 | 0.4 | 10 | src/models/OperationalIncident.ts: SPEC §4 exclusive target |
| `outreach_band_transitions` | drop | 7110 | 2.8 | 0.8 | 0.8 | 3 | src/models/salesIntelligence/outreach.ts: SPEC §7.2 exclusive target |
| `outreach_followups` | drop | 585 | 0.6 | 0.2 | 0.4 | 8 | src/models/salesIntelligence/outreach.ts: SPEC §7.2 exclusive target |
| `outreach_records` | drop | 8696 | 14.4 | 3.5 | 2.0 | 8 | src/models/salesIntelligence/outreach.ts: SPEC §7.2 exclusive target |
| `outreach_rep_days` | drop | 72 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/overview.ts: SPEC §7.2 exclusive target |
| `sales_intelligence_ai_budget` | drop | 2 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/infrastructure.ts: SPEC §7.2 exclusive target |
| `sales_intelligence_ai_reservations` | drop | 33409 | 22.5 | 4.8 | 4.6 | 4 | src/models/salesIntelligence/infrastructure.ts: SPEC §7.2 exclusive target |
| `sales_intelligence_attention_artifacts` | drop | 1025 | 7.3 | 18.5 | 0.3 | 3 | src/models/salesIntelligence/attentionArtifact.ts: SPEC §7.2 exclusive target |
| `sales_intelligence_attention_snapshots` | drop | 5 | 0.4 | 0.8 | 0.2 | 5 (TTL) | src/models/salesIntelligence/infrastructure.ts: SPEC §7.2 exclusive target |
| `contact_numbers` | migrate | 7028 | 9.3 | 3.8 | 3.6 | 11 | src/models/ContactNumber.ts: Kept; dead summary/schedule/AI/outreach fields are unset (SPEC §7.4, DATA §1.3) |
| `owner_rep_nudges` | migrate | 12 | 0.0 | 0.1 | 0.2 | 6 | src/models/OwnerRepNudge.ts: Kept: Accounts review_context sends and delivery uncertainty (SPEC §7.3) |
| `sales_intelligence_audit_events` | migrate | 273199 | 423.8 | 80.9 | 35.5 | 5 | src/models/salesIntelligence/infrastructure.ts: Mixed append-only audit; retired-feature kinds proposed for deletion (SPEC §6, §7.3) |
| `sales_intelligence_command_executions` | migrate | 813 | 0.6 | 0.4 | 0.2 | 2 | src/models/salesIntelligence/infrastructure.ts: Mixed command replay; retired commands proposed for deletion |
| `sales_intelligence_contact_restrictions` | migrate | 16 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/intelligence.ts: Kept restriction authority (HUMAN-FACTS.md) |
| `sales_intelligence_jobs` | migrate | 235093 | 179.9 | 50.8 | 27.9 | 6 (TTL) | src/models/salesIntelligence/infrastructure.ts: Mixed; legacy-stage rows terminalized then deleted (SPEC §7.3, DATA §1.3) |
| `sales_intelligence_owner_instructions` | migrate | 4 | 0.0 | 0.0 | 0.1 | 3 | src/models/salesIntelligence/intelligence.ts: Kept minimal human facts (HUMAN-FACTS.md) |
| `sales_intelligence_policy_versions` | migrate | 4 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/infrastructure.ts: Kept: the active version and versions referenced by kept jobs/commands |
| `sales_intelligence_review_items` | migrate | 12202 | 3.9 | 0.9 | 1.1 | 2 | src/models/salesIntelligence/intelligence.ts: Kept minimal human facts (HUMAN-FACTS.md) |
| `sales_intelligence_sync_state` | migrate | 45 | 0.0 | 0.0 | 0.1 | 2 | src/models/salesIntelligence/capture.ts: Mixed; exact Attention fence rows deleted (CODE-MAP §7.1) |
| `data_migration_runs` | unknown | 1 | 0.0 | 0.1 | 0.0 | 1 | no reader/writer found in workspace source: Protected until classified (DATA §1.2) |
| `granot_backfill_deliveries` | unknown | 12 | 0.0 | 0.0 | 0.0 | 1 | no reader/writer found in workspace source: Protected until classified (DATA §1.2) |
| `historical_api_backfill_checkpoints` | unknown | 0 | 0.0 | 0.0 | 0.0 | 4 | no reader/writer found in workspace source: Protected until classified (DATA §1.2) |
| `historical_backfill_checkpoints` | unknown | 1174 | 0.5 | 0.2 | 0.2 | 4 | no reader/writer found in workspace source: Protected until classified (DATA §1.2) |
| `historical_backfill_runs` | unknown | 2 | 0.0 | 0.0 | 0.1 | 2 | no reader/writer found in workspace source: Protected until classified (DATA §1.2) |
| `agents` | keep | 20 | 0.0 | 0.0 | 0.1 | 4 | src/models/Agent.ts: Registry, allocation, receiver attribution, extension catalog (SPEC §2) |
| `booked_leads` | keep | 859 | 0.7 | 0.3 | 0.6 | 13 | src/models/BookedLead.ts: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `booking_lead_reconciliation_cases` | keep | 0 | 0.0 | 0.0 | 0.1 | 15 | Booking reconciliation: Booking reconciliation (DATA §1.2) |
| `call_interaction_aliases` | keep | 25840 | 6.4 | 1.7 | 1.4 | 3 | Number activity: Canonical call aliases (SPEC §7.3) |
| `call_interactions` | keep | 8613 | 27.3 | 5.6 | 3.2 | 12 | Number activity: Canonical provider call metadata (SPEC §7.3) |
| `call_leads` | keep | 1773 | 3.1 | 1.3 | 2.0 | 31 | src/models/CallLead.ts: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `cancelled_leads` | keep | 48 | 0.0 | 0.0 | 0.2 | 6 | src/models/CancelledLead.ts: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `cpl_correction_jobs` | keep | 0 | 0.0 | 0.0 | 0.0 | 7 | CPL: Pricing (DATA §1.2) |
| `cpl_rate_periods` | keep | 14 | 0.0 | 0.0 | 0.1 | 4 | CPL: Pricing (DATA §1.2) |
| `cpl_rates` | keep | 13 | 0.0 | 0.0 | 0.1 | 3 | CPL: Pricing (DATA §1.2) |
| `customers` | keep | 851 | 0.1 | 0.1 | 0.2 | 4 | src/models/Customer.ts: Booking linkage and Customer upserts (SPEC §2) |
| `daily_operations_days` | keep | 26 | 0.1 | 0.1 | 0.1 | 3 | Daily Operations: Protected byte-for-byte (SPEC §4.1) |
| `daily_operations_events` | keep | 18565 | 12.3 | 3.0 | 3.2 | 6 | Daily Operations: Protected byte-for-byte (SPEC §4.1) |
| `domain_command_executions` | keep | 7481 | 9.5 | 3.0 | 1.1 | 5 | domain commands: Command replay (SPEC §6) |
| `entity_changes` | keep | 11058 | 22.4 | 4.4 | 4.0 | 6 | src/models/EntityChange.ts: Job Timeline + attachment wakeups (SPEC §6) |
| `extension_users` | keep | 6 | 0.0 | 0.0 | 0.1 | 3 | Extension: Extension auth (SPEC §2) |
| `external_data_connections` | keep | 1 | 0.0 | 0.0 | 0.1 | 4 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `form_leads` | keep | 6758 | 13.6 | 5.3 | 4.7 | 30 | src/models/FormLead.ts: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `google_drive_connections` | keep | 1 | 0.0 | 0.0 | 0.1 | 2 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `google_oauth_states` | keep | 0 | 0.0 | 0.0 | 0.0 | 3 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `google_picker_nonces` | keep | 0 | 0.0 | 0.0 | 0.0 | 3 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `google_picker_selections` | keep | 0 | 0.0 | 0.0 | 0.0 | 3 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `granot_automation_runs` | keep | 0 | 0.0 | 0.0 | 0.0 | 9 (TTL) | Granot HTTP Automation: Ingestion (SPEC §2) |
| `granot_automation_sources` | keep | 9 | 0.0 | 0.0 | 0.1 | 6 | Granot HTTP Automation: Ingestion (SPEC §2) |
| `granot_booking_discrepancies` | keep | 3 | 0.0 | 0.0 | 0.1 | 3 | src/models/GranotBookingDiscrepancy.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_booking_reconciliation_cases` | keep | 356 | 0.6 | 0.3 | 0.3 | 7 | src/models/GranotBookingReconciliationCase.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_crm_csv_ingestions` | keep | 4 | 0.0 | 0.0 | 0.2 | 9 | src/models/GranotCrmCsvIngestion.ts: Granot CSV state (DATA §1.2) |
| `granot_crm_sources` | keep | 12 | 0.0 | 0.0 | 0.3 | 11 | src/models/GranotCrmSource.ts: Granot CRM sources (DATA §1.2) |
| `granot_crm_sync_runs` | keep | 8 | 0.0 | 0.0 | 0.1 | 6 | src/models/GranotCrmSyncRun.ts: Ingestion state (DATA §1.2) |
| `granot_lifecycle_activations` | keep | 1 | 0.0 | 0.0 | 0.1 | 2 | src/models/GranotLifecycleActivation.ts: Activation provenance (SPEC §4.1) |
| `granot_observations` | keep | 7372 | 8.5 | 3.0 | 1.5 | 7 | src/models/GranotObservation.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_record_links` | keep | 3030 | 1.4 | 0.5 | 0.4 | 4 | src/models/GranotRecordLink.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_release_discrepancies` | keep | 11 | 0.0 | 0.0 | 0.1 | 3 | src/models/GranotReleaseDiscrepancy.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_release_reconciliation_cases` | keep | 6 | 0.0 | 0.0 | 0.1 | 6 | src/models/GranotReleaseReconciliationCase.ts: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `granot_webhook_receipts` | keep | 7372 | 8.9 | 3.9 | 1.8 | 6 | src/models/GranotObservationReceipt.ts: Observation Receipts, channel-neutral (SPEC §5) |
| `ingestion_conflicts` | keep | 165 | 0.1 | 0.1 | 0.1 | 6 | Ingestion: Ingestion conflicts (DATA §1.2) |
| `ingestion_runs` | keep | 33 | 10.4 | 3.2 | 0.3 | 7 | Ingestion: Ingestion runs (DATA §1.2) |
| `integration_tokens` | keep | 1 | 0.0 | 0.0 | 0.1 | 3 (TTL) | Integrations: Provider credentials (DATA §1.2) |
| `lead_message_rate_limits` | keep | 0 | 0.0 | 0.0 | 0.1 | 2 (TTL) | Lead messaging: Lead Message rate limit (DATA §1.2) |
| `lead_messages` | keep | 3500 | 5.5 | 1.6 | 1.6 | 13 | src/models/LeadMessage.ts: Lead Message delivery (DATA §1.2) |
| `lead_source_companies` | keep | 7 | 0.0 | 0.0 | 0.2 | 7 | Registry: Source attribution (DATA §1.2) |
| `lead_source_granularities` | keep | 14 | 0.0 | 0.0 | 0.3 | 8 | Registry: Source attribution (DATA §1.2) |
| `lead_source_label_mappings` | keep | 0 | 0.0 | 0.0 | 0.0 | 5 | Registry: Source attribution (DATA §1.2) |
| `merchants` | keep | 7 | 0.0 | 0.0 | 0.1 | 3 | Registry: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `moving_carriers` | keep | 24 | 0.0 | 0.0 | 0.2 | 8 | Registry: Official record / Registry linkage (SPEC §1, DATA §1.2) |
| `number_lead_attachments` | keep | 6736 | 8.4 | 1.8 | 1.6 | 5 | src/models/NumberLeadAttachment.ts: Reviewed Number↔Lead attachments (SPEC §7.3) |
| `operations_registry_changes` | keep | 71 | 0.1 | 0.1 | 0.2 | 8 | Registry: Registry history (SPEC §6) |
| `public_submission_throttle_buckets` | keep | 0 | 0.0 | 0.0 | 0.0 | 3 (TTL) | WordPress throttle: Ingress throttle (DATA §1.2) |
| `rep_identity_links` | keep | 12 | 0.0 | 0.0 | 0.1 | 4 | Rep identity: Reviewed Rep identity (SPEC §7.3) |
| `reporting_definition_revisions` | keep | 7 | 0.0 | 0.0 | 0.1 | 4 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_definitions` | keep | 7 | 0.0 | 0.0 | 0.1 | 3 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_deliveries` | keep | 4 | 0.0 | 0.0 | 0.1 | 6 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_destinations` | keep | 2 | 0.0 | 0.0 | 0.1 | 3 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_previews` | keep | 0 | 0.0 | 0.0 | 0.0 | 3 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_run_confirmations` | keep | 0 | 0.0 | 0.0 | 0.0 | 4 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_run_manifests` | keep | 0 | 0.0 | 0.0 | 0.0 | 4 (TTL) | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `reporting_runs` | keep | 4 | 0.1 | 0.1 | 0.2 | 10 | Reporting: Retained Reporting (SPEC §2, DATA §1.2) |
| `ringcentral_analytics_snapshots` | keep | 122 | 0.7 | 0.1 | 0.0 | 1 | ringcentral-config: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_call_candidate_decisions_test` | keep | 4020 | 1.3 | 0.4 | 0.4 | 5 | ringcentral-config `_test` runtime alias: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_call_candidates_test` | keep | 1273 | 1.6 | 0.6 | 0.3 | 6 | ringcentral-config `_test` runtime alias: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_call_log_sync_state` | keep | 1 | 0.0 | 0.0 | 0.1 | 2 | ringcentral-config: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_call_sessions` | keep | 0 | 0.0 | 0.0 | 0.0 | 5 | ringcentral-config: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_convergence_locks` | keep | 405 | 0.1 | 0.1 | 0.1 | 1 | ringcentral-config: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_directory_snapshots` | keep | 2 | 0.0 | 0.0 | 0.1 | 3 | Directory: RingCentral Accounts (SPEC §7.3) |
| `ringcentral_inbound_route_assignments` | keep | 5 | 0.0 | 0.0 | 0.3 | 8 | Inbound routes: Inbound-source assignments (SPEC §7.3) |
| `ringcentral_inbound_routes` | keep | 5 | 0.0 | 0.0 | 0.2 | 8 | Inbound routes: Inbound-source assignments (SPEC §7.3) |
| `ringcentral_processed_calls` | keep | 1490 | 0.8 | 0.4 | 0.4 | 5 | ringcentral-config: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_rate_limit_gates` | keep | 2 | 0.0 | 0.0 | 0.0 | 1 | RingCentral rate gate: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_webhook_events` | keep | 58084 | 253.1 | 48.6 | 6.6 | 6 | src/services/ringcentral/ringcentral-config.ts: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_webhook_events_test` | keep | 5134 | 13.2 | 4.0 | 0.6 | 5 | ringcentral-config `_test` runtime alias: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `ringcentral_webhook_subscriptions` | keep | 1 | 0.0 | 0.0 | 0.1 | 4 | RingCentral subscriptions: RingCentral Call Lead ingest/capture state (DATA §1.2) |
| `sales_intelligence_coverage_projections` | keep | 1 | 0.0 | 0.0 | 0.1 | 2 | src/services/numberActivity/coverage.ts: Numbers coverage/freshness |
| `sales_intelligence_policy_pointers` | keep | 1 | 0.0 | 0.0 | 0.1 | 2 | CSI policy: Active policy pointer (SPEC §7.3) |
| `sales_intelligence_sync_windows` | keep | 0 | 0.0 | 0.0 | 0.0 | 2 | CSI capture: Capture completeness windows (SPEC §7.3) |
| `sheet_sync_attempts` | keep | 7921 | 2.2 | 1.7 | 3.0 | 4 | Sheet Sync: Retained Sheet Sync durable state (DATA §1.2) |
| `sheet_sync_jobs` | keep | 6687 | 2.8 | 2.4 | 4.1 | 5 | Sheet Sync: Retained Sheet Sync durable state (DATA §1.2) |
| `sheet_sync_leases` | keep | 4 | 0.0 | 0.0 | 0.1 | 3 | Sheet Sync: Retained Sheet Sync durable state (DATA §1.2) |
| `sheet_sync_quota_buckets` | keep | 0 | 0.0 | 0.0 | 0.1 | 3 (TTL) | Sheet Sync: Retained Sheet Sync durable state (DATA §1.2) |
| `sheet_sync_runs` | keep | 51207 | 11.8 | 4.4 | 3.6 | 3 | Sheet Sync: Retained Sheet Sync durable state (DATA §1.2) |
| `source_row_receipts` | keep | 231 | 0.3 | 0.2 | 0.2 | 6 | Best Relocation ingestion: Ingress fencing (SPEC §2) |
| `source_row_states` | keep | 231 | 0.3 | 0.2 | 0.1 | 3 | Best Relocation ingestion: Ingress fencing (SPEC §2) |
| `synchronization_decisions` | keep | 13236 | 16.6 | 3.4 | 1.6 | 5 | Synchronization Decisions: Granot lifecycle evidence, Health, intakes, timeline (SPEC §5, DATA §1.2) |
| `testimonials` | keep | 339 | 0.3 | 0.3 | 0.2 | 8 | src/models/Testimonial.ts: Testimonials destination (SPEC §2) |
| `wordpress_form_submission_receipts` | keep | 0 | 0.0 | 0.0 | 0.0 | 1 | src/models/WordpressFormSubmissionReceipt.ts: WordPress ingress + Job Timeline |

The five `unknown` collections hold 1,189 documents (about 0.5 MB). `historical_backfill_*` look like the June 2026 historical import's checkpoints (`_id` dates 2026-06-12). SPEC §3 requires reader proof before that ledger can be removed, so they stay excluded. Purging them needs an explicit Owner call and a manifest addition.

## Shared `sales_intelligence_jobs` (235,093 rows, 179.9 MB)

Legacy stages (SPEC §7.4: `analysis`, `application`, `transcription`, `media`, `media_fetch`, `recording_discovery`, `move_assessment`, `outreach_ensure`, `outreach_derive`) total **124,381 rows / 84.9 MB**: 122,386 completed, 1,112 dead_letter, 548 paused, 334 retry, 1 pending. At observation there were **0 live leases** and 0 expired leases on legacy stages. 883 rows were runnable (pending/retry/paused). `owner_reanalysis` is non-null on 765 rows. Every completed row has a `completed_at`, so the 14-day TTL (`csi_job_completed_ttl`) applies. Legacy rows were still being written at observation (`outreach_ensure` last `_id` 2026-10-04): the old server is still deployed.

| Stage | Status | Rows | Bytes MB | First _id | Last _id | Class |
| --- | --- | ---: | ---: | --- | --- | --- |
| analysis | completed | 4657 | 3.8 | 2026-09-20 | 2026-09-29 | legacy (C2) |
| analysis | dead_letter | 63 | 0.0 | 2026-09-20 | 2026-09-29 | legacy (C2) |
| analysis | paused | 23 | 0.0 | 2026-09-20 | 2026-09-26 | legacy (C2) |
| application | completed | 8800 | 6.0 | 2026-09-20 | 2026-09-29 | legacy (C2) |
| application | paused | 383 | 0.3 | 2026-09-22 | 2026-09-22 | legacy (C2) |
| attachment_refresh | completed | 26384 | 17.8 | 2026-09-20 | 2026-10-04 | retained |
| call_log_refresh | completed | 6102 | 5.3 | 2026-09-24 | 2026-10-04 | retained |
| capture_projection | completed | 58081 | 57.2 | 2026-09-24 | 2026-10-04 | retained |
| media_fetch | completed | 3182 | 2.5 | 2026-09-20 | 2026-10-04 | legacy (C2) |
| media_fetch | paused | 141 | 0.1 | 2026-09-20 | 2026-09-24 | legacy (C2) |
| media_fetch | retry | 321 | 0.2 | 2026-09-20 | 2026-10-04 | legacy (C2) |
| move_assessment | completed | 3919 | 2.9 | 2026-09-23 | 2026-10-03 | legacy (C2) |
| move_assessment | dead_letter | 339 | 0.3 | 2026-09-23 | 2026-10-04 | legacy (C2) |
| move_assessment | pending | 1 | 0.0 | 2026-09-23 | 2026-09-23 | legacy (C2) |
| move_assessment | retry | 1 | 0.0 | 2026-10-04 | 2026-10-04 | legacy (C2) |
| nudge_repair | completed | 12 | 0.0 | 2026-09-21 | 2026-09-28 | retained |
| number_refresh | completed | 18140 | 12.1 | 2026-09-19 | 2026-10-04 | split (wave 3) |
| number_refresh | dead_letter | 524 | 0.3 | 2026-09-20 | 2026-10-03 | split (wave 3) |
| number_refresh | paused | 23 | 0.0 | 2026-09-21 | 2026-10-01 | split (wave 3) |
| outreach_ensure | completed | 91411 | 60.2 | 2026-09-20 | 2026-10-04 | legacy (C2) |
| rebuild | completed | 1414 | 2.2 | 2026-09-23 | 2026-09-29 | split (wave 3) |
| recording_discovery | completed | 8119 | 6.1 | 2026-09-20 | 2026-10-04 | legacy (C2) |
| recording_discovery | paused | 1 | 0.0 | 2026-09-24 | 2026-09-24 | legacy (C2) |
| recording_discovery | retry | 4 | 0.0 | 2026-10-01 | 2026-10-03 | legacy (C2) |
| rep_identity_reevaluate | completed | 32 | 0.0 | 2026-09-23 | 2026-09-25 | retained |
| transcription | completed | 2298 | 2.0 | 2026-09-20 | 2026-09-29 | legacy (C2) |
| transcription | dead_letter | 710 | 0.5 | 2026-09-20 | 2026-10-04 | legacy (C2) |
| transcription | retry | 8 | 0.0 | 2026-10-04 | 2026-10-04 | legacy (C2) |

## `sales_intelligence_sync_state` (45 rows)

| Class | Scopes |
| --- | --- |
| retired (C3, final) | `attention_artifacts:csi-production:vantagemovers`, `attention_publish`, `attention_publish_fence:csi-production:vantagemovers`, `intelligence_source_scan`, `overview_refresh`, `outreach_repair:OutreachRecord` |
| outreach cursors (C6, pending wave 3) | `outreach_ensure`, `outreach_entity_changes`, `outreach_repair:FormLead`, `outreach_repair:CallLead`, `outreach_repair:CallInteraction` |
| keep | `deployment`, `directory`, `webhook_receipts`, `call_log_all_directions`, `call_log_sweep`, `attachment_suggest`, `attachment_watermark:{FormLead,CallLead,ContactNumber}`, `retention`, and 24 `rep_identity:<sha256>` rows |

No sync-state row held a live lease at observation. The scope owners are in `ops/slimming/policy.ts`. C6 is pending because SPEC §7.4 keeps a watermark backstop for the independent Lead-Number/attachment nomination path, and S-NUM may keep using those cursors.

## `contact_numbers` (7,028 documents): AI/outreach field paths actually present

Paths sampled (400 docs): `classification*`, `contact_eligibility.{state,reason,until,set_by,set_at,evidence_ref}`, `content_purge_pending`, `country`, `created_via`, `digits_reversed`, `e164`, `evidence_fence`, `first_observed_at`, `intelligence_schedule.{fingerprint,generation,job_id}`, `kind`, `last_activity_at`, `national_ten`, `provider_names`, `purged_at`, `retention_epoch`, `revision`, `rollups.{attached_lead_count,candidate_lead_count,conversations_analyzed_total,human_conversations_total,inbound_total,interactions_total,last_analyzed_at,last_human_conversation_at,last_inbound_at,last_meaningful_contact_at,last_outbound_at,open_outreach_count,outbound_total,outreach_records_total,recordings_total}`, `running_summary.{text,run_id,evidence_digest,computed_at}`, `search_terms`, timestamps.

| Path | Present (`$exists`) | Non-null | Manifest entry |
| --- | ---: | ---: | --- |
| `running_summary` | 7028 | **898** (text + run_id) | C1 |
| `intelligence_schedule` (+ `.job_id`) | 7028 | 7028 | C1 |
| `rollups.open_outreach_count` | 7028 | 7028 | C1 |
| `rollups.outreach_records_total` | 7028 | 7028 | C1 |
| `rollups.conversations_analyzed_total` | 7028 | 7028 | C1 |
| `rollups.last_analyzed_at` | 7028 | 899 | C1 |
| `content_purge_pending`, `retention_epoch`, `evidence_fence` | 7028 | 7028 | C5 (wave 3 decides) |
| `purged_at` | 7028 | 0 | C5 |
| `contact_eligibility.evidence_ref` | 7028 | 0 | keep (restriction authority) |
| `rollups.human_conversations_total`, `rollups.last_human_conversation_at` (469), `rollups.recordings_total` | 7028 | — | keep: provider call metadata (SPEC §7.4) |

AI-marked paths elsewhere: `call_interactions.capture_recovery.run_id` (55, a capture-repair run id, not AI; keep) and `call_interactions.purged_at` (0 non-null). `sales_intelligence_jobs.result.*` carries `findings`, `run_id` (17,983), `transcript_version` (2,252), `conversations`, and old `rollups_before/after.*` names, on legacy and split-stage rows only. `number_lead_attachments` and `rep_identity_links` have no AI paths. Official records (`form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `customers`, `agents`) have no AI/outreach paths; the regex hits there are `*_snapshot.evidence_status` and `lead_model`, which are ingestion fields.

## Mixed audit, command and policy collections

`sales_intelligence_audit_events`: 273,199 rows, 423.8 MB logical. 37 `event_kind`s are written only by retired producers. Their `worker`/`intelligence`-actor rows total **107,435 rows / 246.6 MB** (C4, pending wave 3). Owner/Rep-actor rows of those kinds stay as minimal human history: 765 `analysis.reanalysis_requested`, 39 `media_played`. So do the retained kinds: `interaction.*`, `capture_projection.completed`, `call_log_refresh.completed`, `attachment_*`, `contact_number_created_from_form_lead`, `number.rebuilt`, `rep_identity.reevaluated`, `review_*`, `channel_paused`, `nudge*`, `rep.*`, `policy_*`, `attach_lead`, and the Owner's `assign`/`start_call`/`end_call` on outreach records. Top-level `run_id` is never set. The full per-kind table is in `inventory.json` → `audit_events.by_kind`.

`sales_intelligence_command_executions`: 813 rows, all Owner commands: `reanalyze` 765 (retired command, 0.5 MB), `review_rep` 12, `send_nudge` 12, `backfill_rep_team_messaging` 10, `create_rep` 3, `update_settings` 3, `attach_lead` 2, `assign` 2, `start_call` 1, `end_call` 1, `propose_reps` 1, `initialize_settings` 1. No cleanup is manifested: this is replay authority for human commands and it is negligible in size.

`sales_intelligence_policy_versions`: 4 versions, all Owner-authored (`csi-policy-v1`, `…0edc7da8…`, `…0e18a977…`, `…bfcdf38d…`). The active pointer is `csi-policy-bfcdf38dbe19c538021e6b9e`. Kept. Each embeds a `retention.{audio_days,audit_days,redacted_days}` block that becomes inert with the AI pipeline gone. That is a schema/reader concern for S-AI, not a purge.

## Human and provider facts

See [HUMAN-FACTS.md](HUMAN-FACTS.md). In short: 16 contact restrictions (all `origin: intelligence`, 15 active and unexpired), 4 Owner instructions, 12,202 review items, 12 Rep nudges (all `sent`, none `unknown_delivery`), 585 follow-ups (none Owner-originated), 8,696 outreach records (2 Owner assignments, 1 rep-promise assignment), and 6,736 Number↔Lead attachments (2 `owner_confirmed`).

## Blob store (`conversations/`)

| Measure | Value |
| --- | ---: |
| Top-level folders in the store | `conversations/`, `dev-ops/` (no root objects) |
| Objects under `conversations/` | **3,017** |
| Bytes under `conversations/` | **1,813,126,869 (1.69 GiB)** |
| Uploaded | 2026-08-27 – 2026-10-04 |
| `lead_conversations` rows with `media.blob_pathname` | 3,017 of 4,088 (0 with `media.purged_at`) |
| Referenced and present (deletion candidates) | 3,017 / 1,813,126,869 bytes |
| Referenced but missing | 0 |
| Present under the prefix but unreferenced | 0 |
| Referenced pathnames outside `conversations/` | 0 |

The only writers are `src/services/conversations/media.ts` and `src/services/salesIntelligence/conversations/media.ts`. Both are retired, both write private objects under `conversations/`, and no retained collection stores a Blob pathname. Every key is therefore exclusive to the retired feature, and all 3,017 are in `ops/slimming/conversation-blob-keys.json`. Two key shapes exist: `conversations/<recordingId>.mp3` and `conversations/<account>/<id>/<sha256>.mp3`. `dev-ops/` is unrelated and untouched. RingCentral's own provider recordings are not in this store and are not touched.

## Purge dry run (read-only)

`node --import tsx ops/slimming/purge.ts` with no `--apply`, under the same read guard. Run 1 was taken about 15 minutes after an earlier manifest refresh (hash `2fc0ac4a…`). Run 2 came immediately after the final refresh (hash `948420886cf908482fb4e4325d1c16724759705b36471dd6d5de7e3114497143`, generated 2026-10-04T03:07:09Z).

Run 2 output (abridged to the plan and the problems):

```
[purge] mode=dry-run manifest_hash=948420886cf908482fb4e4325d1c16724759705b36471dd6d5de7e3114497143 generated_at=2026-10-04T03:07:09.343Z
[purge] deployed server commit: becf8de02ed46aa6a4625e8188c299af6caa98ba
  (b) back up 26 namespaces, 6 cleanup selections, 3017 Blob objects
  (c) C1-contact-numbers-dead-fields [pending_wave3] contact_numbers: live 7028 / manifest 7028
  (c) C2-legacy-stage-jobs [final] sales_intelligence_jobs: live 124381 / manifest 124381; to terminalize 883; live leases 0
  (c) C3-retired-sync-scopes [final] sales_intelligence_sync_state: live 6 / manifest 6
  (c) C6-outreach-cursor-sync-scopes [pending_wave3] sales_intelligence_sync_state: live 5 / manifest 5
  (c) C4-retired-audit-events [pending_wave3] sales_intelligence_audit_events: live 107435 / manifest 107435
  (c) C5-contact-numbers-retention-fields [pending_wave3] contact_numbers: live 7028 / manifest 7028
  (d) delete 3017 Blob keys (1729.1 MB) under conversations/; present 3017, unlisted under prefix 0
  (e) 20 collection drops, every live count = manifest count
  (f) drop database vantagemovershistorical: 6 collections, 14.1 MB
  (g) verify 43 protected namespaces present and every target absent
[purge] 10 problem(s); an --apply run would abort at step (a):
  - deployed commit becf8de0… does not descend from the slimming baseline 6a374fab
  - deployed commit becf8de0… still contains src/models/{historical/index.ts, OperationalEvent.ts, LeadConversation.ts,
    salesIntelligence/attentionArtifact.ts, salesIntelligence/assessment.ts}: the slim server is not deployed   (5 problems)
  - cleanup C1, C6, C4, C5 are pending wave 3                                                                   (4 problems)
```

In run 1, the guards also caught the still-active legacy writers: `operational_events` 13,796 vs 13,776, `sales_intelligence_ai_reservations` 33,408 vs 33,395, C2 legacy jobs 124,381 vs 124,377, C4 audit rows 107,435 vs 107,421. A Blob object uploaded after that manifest also showed up as `unlisted_under_prefix: 1` (reported, never deleted). This is the intended behavior: an apply must be preceded by quiescence and a fresh manifest, and any growth aborts it.

## Limits of this inventory

- Counts drift until the slim server is deployed and quiesced. The manifest must be regenerated (`inventory.ts --write-manifest`) after quiescence, and its new hash is the one passed to `purge.ts`.
- Field-path discovery is sample-based (400 docs). The `$exists`/non-null counts are exact for every path that was found or listed in the policy.
- The local Docker replica `csi01` (127.0.0.1:27189) accepted TCP but did not answer the handshake (`docker exec` also hung), so no replica rehearsal of `purge.ts --apply` was run. It was not restarted, because other lanes own it. SLIM-09 requires that rehearsal on an isolated restored dataset.
