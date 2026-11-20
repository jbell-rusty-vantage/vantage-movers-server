# Index and read baseline, November 19

This record starts the collection-wide index and read phase. It is a read-only inventory. No index, TTL, retention or data change was made.

## Measurement window

At 21:01:57 New York on November 19 (02:01:57 UTC November 20), a read-only script ran `$collStats` and `$indexStats` on every collection in `vantagemovers`. It read primary `ac-9mmcj05-shard-00-01`, which had been up for 29.2 hours. Index usage counters on that member began on November 18 at 15:50 New York. Five indexes were created later on November 19, and each counter starts at its own `since` time. The counters count reads on the primary only. Secondary reads, unique-constraint checks on writes and TTL deletions do not count. MiB is 1,048,576 bytes. [Raw inventory](evidence/index-read-baseline-2026-11-19.json)

Production was serving `d5a1d33c`. The production workflow aliased that build at 19:34 New York and `/health` returned `ok`. Earlier service releases on November 19 are recorded in their own release records.

## Totals

| Measure | Value |
|---|---:|
| Collections | 111 |
| Indexes | 532 |
| Logical BSON | 1,518.4 MiB |
| Allocated collection storage | 2,491.5 MiB |
| Of which reusable free space | 2,147.8 MiB |
| Index storage | 827.4 MiB |
| Indexes with zero reads in the window | 262 |

The 262 zero-read indexes comprise 35 `_id`, 44 unique, 8 TTL and 175 other indexes. The 175 other indexes occupy 272.0 MiB. Each one had at least a 24-hour window.

## Largest collections

| Collection | Documents | Logical MiB | Allocated MiB | Reusable MiB | Index MiB |
|---|---:|---:|---:|---:|---:|
| granot_webhook_receipts | 13,032 | 28.6 | 1,127.3 | 1,119.6 | 24.7 |
| granot_observations | 6,206 | 6.4 | 517.1 | 515.3 | 170.7 |
| sales_intelligence_jobs | 347,000 | 233.1 | 311.8 | 238.5 | 220.7 |
| daily_operations_events | 276,650 | 175.6 | 83.1 | 44.1 | 147.5 |
| sales_intelligence_audit_events | 23,535 | 17.9 | 128.8 | 118.7 | 70.2 |
| domain_command_executions | 168,389 | 193.8 | 75.4 | 31.9 | 13.8 |
| entity_changes | 178,784 | 215.7 | 33.8 | 1.2 | 35.2 |
| ringcentral_webhook_events | 34,693 | 87.2 | 56.0 | 37.3 | 5.9 |
| sheet_sync_attempts | 459,912 | 121.3 | 27.0 | 9.4 | 30.9 |
| sheet_sync_jobs | 164,283 | 66.9 | 24.5 | 10.5 | 21.7 |

## What this means for the next phase

**Physical space has not followed logical removal.** The November 18–19 archive and cleanup releases removed most Granot evidence. On this member, 1,634.9 MiB of the two Granot collections' 1,644.4 MiB allocation is reusable free space. Their indexes keep 195.4 MiB for 19,238 documents. WiredTiger reuses this space for new writes in the same collection. It does not return it to the filesystem. Disk relief needs a separately approved per-member `compact` or an index rebuild. Measure and approve it per member. Do not draw conclusions from the primary alone.

**Large indexes with zero reads.** These are the largest non-unique, non-TTL indexes with zero reads in the window.

| Collection | Index | Keys | MiB |
|---|---|---|---:|
| granot_observations | granot_observation_normalized_phone_captured | `contact.normalized_phone, captured_at` | 66.04 |
| granot_observations | granot_observation_normalized_job_no_captured | `identity.normalized_job_no, captured_at` | 50.75 |
| granot_observations | granot_observation_normalized_form_ref_captured | `identity.normalized_form_ref, captured_at` | 27.61 |
| granot_observations | granot_observation_source_route_captured | `normalized_source_label, route_event_class, captured_at` | 22.77 |
| daily_operations_events | parent_receipt_id_1_occurred_at_1 | `parent_receipt_id, occurred_at` | 19.04 |
| daily_operations_events | entity_type_1_entity_id_1 | `entity_type, entity_id` | 14.96 |
| sales_intelligence_audit_events | csi_audit_stream | `recorded_at, _id` | 14.41 |
| sales_intelligence_audit_events | csi_audit_subject | `subject_key, happened_at` | 12.98 |
| entity_changes | entity_change_changed_paths_applied | `changed_paths, applied_at` | 9.45 |
| sheet_sync_attempts | status_1_createdAt_-1 | `status, createdAt` | 6.45 |
| sheet_sync_attempts | run_id_1_createdAt_1 | `run_id, createdAt` | 4.28 |

A zero count over 29 hours does not justify a drop. Some of these indexes may serve infrequent readers: Owner lookups, job timelines, repair commands and weekly or monthly jobs. Before proposing a drop, identify each code query that the index supports. Cover a full week, including the scheduled jobs. Check every member. Then show which query plan changes. The Service docs under `docs/knowledge/` now list declared indexes and query shapes for each service.

**Collections with many indexes.** `form_leads` has 31 indexes, 16 with zero reads. `call_leads` has 31, with 14 at zero. `booking_lead_reconciliation_cases` has 15, with 12 at zero. `lead_messages` has 13, with 8 at zero. `booked_leads` has 13, with 7 at zero. These indexes are small. Each one still adds write work to every Lead insert and update. Review them by query before shrinking them.

**Hottest reads.** These are `form_leads._id` (593,965), `granot_observations._id` (568,230), `granot_record_links.granot_record_link_active_job_unique` (477,920), `granot_webhook_receipts._id` (477,221) and `sales_intelligence_jobs._id` (300,257). `sheet_sync_leases.scope_1` received 264,062 and `granot_automation_runs.granot_run_recovery` received 258,558. Next, attribute these to query shapes. Repeated `_id` reads on Granot collections with 6,000–13,000 documents suggest per-item reads inside workers. Batching those reads could cut round trips.

## Code review findings

On November 19, every Service doc for these services gained a "Storage, indexes and read paths" section. The review compared each declared index with the code that queries it. These findings are inputs for the phase. Confirm each with `explain` and the seven-day series before acting.

**Indexes in production but not declared in code.** A database built from code would lack these indexes.
- `entity_changes.entity_change_applied_scan` `{applied_at: 1, _id: 1}`. It serves the Outreach Lead-change tail and Number Activity lead-link recovery, with 6,991 reads in the window.
- The three sparse `entity_changes.provenance.*_ref_v1` reference indexes, created by the November 18 ops scripts.
- Several Granot retention, archive and window indexes that exist only after their ops scripts run.

Declare these indexes in code, or record why they are operator-managed. [Commands](../knowledge/services/domain-commands.md) · [Granot storage](../knowledge/granot-lifecycle/storage-retention-operations.md)

**Indexes no code query uses.** Most of these also show zero reads in the live window.
- Granot Observation indexes on phone, form reference and source route: 116.42 MiB. The job-number index (50.75 MiB) serves only operator verifiers.
- `daily_operations_events.parent_receipt_id_1_occurred_at_1` and `entity_type_1_entity_id_1`.
- `entity_changes.entity_change_changed_paths_applied`.
- `sheet_sync_attempts.status_1_createdAt_-1`, `sheet_sync_jobs.leased_until_1` and `sheet_sync_leases.leased_until_1`. `sheet_sync_runs.started_at_-1` duplicates the TTL key `started_at_1` in reverse.
- `sales_outreach_subjects` job-number, phone and Lead-revision indexes. Queue search reads the projection instead.
- `csi_job_due` on `sales_intelligence_jobs`.
- Receipt `telephonySessionId_1` and `sessionId_1`.
- `call_interactions` session, extension-started and recording indexes.

**Reads with no matching index.**
- Granot receipt lookup by channel and operation ID omits the partial-filter predicate (`$type: "string"`). This probably explains the collection scan recorded on November 19.
- The Granot retention reference check scans Lead, case and Outreach reference paths up to four times per two-minute tick.
- The Sheet Sync due-job claim sorts in memory after its due-time range. Admin health groups all jobs on each call.
- The All Numbers page counts `{purged_at: null}` over every Number.
- The four team overdue counts on `sales_outreach_projections` scan the collection.
- Job timeline lookups on `granot_record_links` and the discrepancy collections have no fitting index, because the existing indexes are partial on state.

**Collections with no expiry.** Their growth is unmeasured. Confirm each before proposing retention.
- `sheet_sync_jobs` has no expiry by design.
- `sales_outreach_refresh_requests` rows never expire.
- `daily_operations_read_views` gains three documents a day, up to 512 KiB each.
- The Granot closed-run, archived-receipt and archive-catalog collections have no expiry.
- The review found no retirement path in code for Observations and Decisions from scheduled direct apply.

## November 20 actions (Owner-approved)

**Redundant Lead indexes hidden.** Atlas Performance Advisor flagged 14 single-field indexes as prefixes of compound indexes. Thirteen were hidden at 03:04 UTC on November 20 with `ops/capacity/retire-redundant-indexes-2026-11-20.cjs --hide`. Each target was non-unique, non-sparse and non-partial. Each had a visible compound index starting with the same key.

`call_leads.source_granularity_id_1` stays, because `ops/best-relocation-retirement/callBackfillScan.ts` requires a single-field index.

After hiding, `explain` on ten busy query shapes chose the covering compounds, with keys examined equal to documents returned. Examples are `form_leads` by `ref_no`, `source_granularity_id` and `normalized_phone_number`, and `booked_leads` by `lead_ref`. Unhide (`--unhide`) is the rollback. The model declarations are removed in PR #235. A read-only check at about 04:10 UTC on November 20 found all 13 still hidden, no new slow query shape and no Advisor suggestion. Details are in the [review](SERVICE-REVIEW-2026-11-20.md#redundant-index-drop). The drop is scheduled for 22:17 New York on November 20, and `--drop` refuses any target that is no longer hidden. The total size is about 1.6 MB, so the gain is lower write cost on Lead inserts and updates. [Before](evidence/redundant-indexes-before-2026-11-20T03-04-35-157Z.json) · [After](evidence/redundant-indexes-after-2026-11-20T03-04-35-157Z.json) · [Plans](evidence/redundant-indexes-hidden-plans-2026-11-20.json)

**Compact trial on secondary 00.** At about 03:20 UTC on November 20, `scripts/storage-compact.ts --apply` compacted seven collections on `ac-9mmcj05-shard-00-00`, a secondary. The script's guards passed: healthy set, lag under 30 s, no other compact running. Each collection finished in 1–3 seconds. Afterwards, all members reported healthy and the API `/health` returned `ok`.

| Collection | File before MB | Freed MB | File after MB |
|---|---:|---:|---:|
| granot_webhook_receipts | 1,059.3 | 1,018.3 | 40.9 |
| granot_observations | 629.0 | 591.3 | 37.7 |
| sales_intelligence_jobs | 530.2 | 349.6 | 180.7 |
| sales_intelligence_audit_events | 233.0 | 177.5 | 55.6 |
| daily_operations_events | 228.8 | 41.4 | 187.4 |
| domain_command_executions | 87.3 | 26.7 | 60.7 |
| ringcentral_webhook_events | 64.5 | 37.4 | 27.1 |

Node disk use fell from 8,471.5 MB to 6,229.5 MB, freeing 2,242 MB. The `compact` dry run had estimated about 127 MB for the same node. Treat the WiredTiger reusable-bytes figure as the better predictor on this cluster, and confirm it with a real run on a secondary.

**All members and the oplog, November 20 (Owner-approved).** The project service account in `MONGO.env` holds Project Database Access Admin and Cluster Manager. `ops/capacity/compact-operator-2026-11-20.cjs create` added a temporary database user, `vantage_compact_operator`. It carried a custom role inheriting `dbAdmin@local`, plus `dbAdminAnyDatabase` and `clusterMonitor`. The user was cluster-scoped and set to expire after 24 hours. The application user `jbell_db_user` was not changed. The run used the same guarded `scripts/storage-compact.ts`:

1. Secondary 02: the seven collections and `local.oplog.rs`.
2. Secondary 00: `local.oplog.rs` only.
3. Atlas Test Failover at 03:26:39 UTC. Member 02 became primary by 03:29:19, and the cluster returned to IDLE at 03:31:35.
4. Former primary 01, now a secondary: the seven collections and `local.oplog.rs`.

After the run, `delete` removed the user and the role, and both lookups returned 404. The local credentials file was deleted. Every compact finished in 1–3 seconds.

| Member (role after) | Disk before MB | Disk after MB | Used after | Oplog freed MB |
|---|---:|---:|---:|---:|
| 00 (secondary) | 8,478.1 | 4,189.7 | 24.2% | 2,052.7 |
| 01 (secondary, former primary) | 10,201.7 | 4,092.4 | 23.6% | 3,737.5 |
| 02 (primary) | 9,242.2 | 4,245.4 | 24.5% | 3,640.2 |

The three members returned 15,394.5 MB to disk in total. Each disk is 17,308 MB. Before the run they were at 49.0%, 58.9% and 53.4% used. Each member's oplog kept its full 25.6-hour window, its 990 MB configured maximum and about 980 MB of entries. Its file fell to about 206–209 MB, because the oplog compresses its stored entries. All members reported health 1 and zero lag at the end. The API `/health` returned `ok` throughout.

The reusable space left inside files is now 323–331 MB per member. The `compact` dry-run estimates were about 17× too low on this cluster: 127 MB estimated against 2,242 MB freed on member 00, and 101.7 MB estimated against 3,640.2 MB for the oplog on member 02. Use the WiredTiger reusable-bytes figure to predict a compact.

Large deletions inflate the oplog file again. Atlas keeps at least about 24 hours of oplog even beyond its configured size, so each removed document adds an entry to it. Spread future cleanups over time, and recheck the oplog file afterwards. [Space report](../../scripts/output/storage-reclaim-report-2026-11-20.json) is local and untracked.

## November 20 index-phase measurements (read-only)

These measurements cover the four slow shapes in the [review](SERVICE-REVIEW-2026-11-20.md#index-phase-targets-found-during-the-review). No index, TTL or data was changed.

**How they were measured.**
- **Plans:** `explain("executionStats")` on a secondary, with realistic production inputs, at about 14:40 New York on November 20.
- **Sizes and use:** `$collStats` and `$indexStats` on member 01, a secondary. Its counters have only run since 03:29 UTC.
- **Not covered:** the seven-day, all-member `$indexStats` series has not started. The Atlas slow-query log could not be read through the Admin API, because the service account's API access list does not include this workstation's address. Each shape below is therefore attributed by reproducing its code path, not from the log.

| Collection | Documents | Data | Indexes |
|---|---:|---:|---:|
| `booked_leads` | 1,075 | 0.9 MB | 0.7 MB |
| `call_leads` | 2,119 | 4.6 MB | 2.3 MB |
| `form_leads` | 9,045 | 24.0 MB | 7.3 MB |

### 1. `form_leads` contact match: about 3,000 keys for 0 returned

- **Owner:** the Granot identity ladder, `createMongoLeadIdentityStore().findFormLeadsByScopedContact` in `granotLifecycle/identity.ts`. It runs on webhooks and on every scheduled Estimates plan for a Form row without a link or reference match.
- **Cause:** the `$or` has six branches. Four are indexed: `normalized_phone_number`, `ingested_contact_snapshot.normalized_phone_number`, `granot_contact_snapshot.normalized_phone_number` and `email`. Two are not: `ingested_contact_snapshot.email` and `granot_contact_snapshot.email`. With any unindexed branch, the planner cannot use an index union. It scans the whole source scope through `form_lead_source_granularity_normalized_phone_duplicate`.
- **Before:** 3,092 keys and 3,033 documents examined, 0 returned, 187 ms. The scope holds 3,096 Forms.
- **After, measured on the same query without the two unindexed branches:** an index union examined 1 key and 0 documents in 3–7 ms.
- **Proposal:** add two indexes: `{ "ingested_contact_snapshot.email": 1 }` (7,701 Forms hold it) and `{ "granot_contact_snapshot.email": 1 }` (3,077 Forms).
  - **Size:** about 0.35 MB and 0.15 MB, estimated from `email_1` at 0.40 MB for about 9,000 entries.
  - **Write cost:** one extra key at Form creation, because the ingested snapshot never changes. One more key update when a Granot contact snapshot changes email.
  - **Rollback:** hide, then drop.

### 2. `call_leads` (and `form_leads`) by `normalized_job_no`: about 1,335 keys for few returned

- **Owner:** `equivalentNormalizedJobFilter` in `bookings/bookingIdentity.ts`. Its `{ $regex: "^[A-Z]+<core>$" }` branch walks every letter-prefixed key in the index. Callers:
  - `callLeadFormSibling.ts` `loadFormSiblingCandidates`, which runs twice per sibling update;
  - `identity.ts`, at three call sites;
  - `jobNumberTimeline/mongo-evidence-loader.ts`, at two;
  - `bookingIdentity` itself, through `remapNormalizedJobFilter`.
- **Before:**
  - `call_leads`: 1,342 keys for 0 returned. Its job numbers are 869 `P`-prefixed, 468 digits only, and 5 with other prefixes.
  - `form_leads`: 6,636 keys for 1 returned.
- **After, measured with the existing indexed equivalent `normalizedJobCandidates([job])`:** 10 and 5 keys. That function matches the same set: the exact job, its digit core, every single-letter prefix, longer prefixes through disjoint ranges, and the trailing-newline spellings that PCRE `$` also accepts.
- **Proposal:** a code change only, with no index. Use `normalizedJobCandidates` in these callers.
- **Exception:** keep `identity.ts` `findActiveRecordLink`'s `findOne` fallback as it is, unless an explicit sort is added. Its result depends on plan order when two equivalent links name different Leads. Production holds 40 such job groups.
- **Rollback:** revert the PR.

### 3. `booked_leads` COLLSCAN: 508 entries in the log

- **Owner:** Pool admission (`salesOutreach/pool/admission.ts`). The batch read `$or`s three branches: `lead_ref`, `normalizedJobCandidates(jobs, "scan")` and `legacyBookingJobFilter`. The `$expr` in `legacyBookingJobFilter` makes the whole `$or` a collection scan.
- **Measured with a 50-job batch:**

  | Query | Plan | Documents examined | Returned | Time |
  |---|---|---:|---:|---:|
  | Full read | COLLSCAN | 1,075 | 2 | 12 ms |
  | Without the legacy branch | COLLSCAN | 1,075 | 0 | 3 ms |
  | Legacy branch alone | `job_no_1` | 1,075 | 2 | 16 ms |

  The collection is small, so each scan is cheap. The 604 ms maximum in the log probably came from contention inside the transaction, not from data volume.
- **Proposal:** none for indexes, because no index serves `$expr`. Two options:
  - Leave it. It costs about 1,075 documents per Pool batch.
  - Repair the two Bookings whose raw `job_no` disagrees with `normalized_job_no` through the canonical Booking command. That needs Owner approval. Then serve the legacy branch from a small cached list, or remove it.
- **Watch:** the cost grows linearly with `booked_leads`.

### 4. `form_leads` COLLSCAN on `last_accepted_granot_observation.observation_id`: 77 entries

- **Owner:** Granot retention reference holds, `granotHistory/retentionReferences.ts` `referencedChains`, called from `futureRetention.ts` and `retireLeadEvidence.ts`. It `$or`s six Lead provenance paths, and none is indexed.
- **Before:** 9,045 documents examined to return 106, 63 ms. Even the winner path alone scans the collection (12 ms).
- **How often each path is set:**

  | Path | Forms |
  |---|---:|
  | `last_accepted_granot_observation` | 6,858 |
  | `granot_contact_snapshot` | 3,077 |
  | `current_contact_provenance` | 2,084 |
  | `current_move_provenance` | 3,103 |
  | `last_granot_contact_change` | 13 |
  | `ringcentral_convergence` | 0 |

- **Proposal A, preferred:** a code change. The retention job already knows each Observation's Decision target. Probe the target Lead by `_id` and compare the six paths in memory. This needs no index and makes no extra write on Lead updates.
- **Proposal B:** sparse indexes on the four populated paths, on both `form_leads` and `call_leads`.
  - **Size:** about 0.6–0.8 MB.
  - **Write cost:** one to four extra index updates on every accepted Granot change.
  - **Rollback:** hide, then drop.

**Order:** 2, then 1, then 4A, then 3. Items 2 and 4A are code-only. Item 1 adds about 0.5 MB of index and needs Owner approval.

## Recommended scope for the index and read phase

1. Collect a seven-day `$indexStats` series on all three members, at matched hours. Add a profiler or slow-query sample for the hottest collections.
2. For each candidate index, record its query owner from the Service doc, its plan before and after, its write amplification and its bytes. Run drops and hides as separately approved changes. Hide an index first where possible, and keep a rollback.
3. Plan per-member physical reclaim for `granot_webhook_receipts`, `granot_observations`, `sales_intelligence_jobs` and `sales_intelligence_audit_events` under Phase 9 approval. Record the disk use before and after on each member.
4. Attribute the hot `_id` and lease reads to code paths. Batch or project them where the business contract allows.
