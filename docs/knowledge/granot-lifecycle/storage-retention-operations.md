# Granot storage retention

## Releasing a production archive generation

The bucket deletes Granot objects under `history/granot/v1/vantagemovers/` and `history/granot/released/vantagemovers/` after 30 days measured from the object's release marker (`customTime`). Unmarked generations stay available. Bucket soft deletion adds seven days of recovery after lifecycle deletion.

For a content-addressed production archive, first establish that its last reader, replay and backup obligations have ended. Include historical catalog exports, standalone rollback packs and daily and weekly backups. Check that every external publisher has finished or uses the release-aware writer. A missing current MongoDB pointer alone cannot establish this.

Record the exact `hash` and string `generation` in a JSON file with evidence references in `reader_clearance`, `backup_clearance`, `rollback_clearance` and `external_writer_clearance`. Run the following from the server root against the verified production deployment.

```sh
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts begin evidence.json
# Allow at least 800 seconds for any publication already in flight to drain.
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts release evidence.json
```

Both commands check live MongoDB references. The release checks the original evidence digest and review hold before updating the exact GCS generation and metageneration. Reuse invalidates the review or holds a released generation before publishing a new pointer. A later review starts a fresh recovery window once those obligations end.

The main server owns retention. A completed scheduled Estimates run is due for archive review at completion. Any other scheduled run is reviewed at its original action deadline and stays hot. Fulfilled inbound `lead_created` and `priority_updated` receipts, and fulfilled Lead Observations and Decisions, move to Cloud Storage through their own passes. Superseded completed Lead snapshots enter archive review after one day. Historical cleanup uses a separate operator-reviewed manifest.

## Online processing

The authenticated `/api/cron/granot-storage-retention` job runs every two minutes ([`vercel.json`](../../../vercel.json), [route](../../../src/routes/granot-retention-cron.routes.ts)). Four passes run together in one invocation:

| Pass | Code | Budget per invocation |
| --- | --- | --- |
| Receipt shadow/future retention | [`futureRetention.ts`](../../../src/services/granotHistory/futureRetention.ts) | 64 due receipts |
| Fulfilled scheduled runs | [`scheduledRunArchive.ts`](../../../src/services/granotHistory/scheduledRunArchive.ts) | 16 runs, four at a time |
| Fulfilled inbound Lead webhooks | [`completedWebhooks.ts`](../../../src/services/granotHistory/completedWebhooks.ts) | 8 receipts per route (`lead_created`, `priority_updated`) |
| Fulfilled Lead Observations and Decisions | [`retireLeadEvidence.ts`](../../../src/services/granotHistory/retireLeadEvidence.ts) | one page of 192 Observations, GCS object at most 7 MiB |

The route returns HTTP 503 when the run or webhook pass records a failure. Receipt review requires completion, capture and decision times all older than 24 hours. Only receipts both created and captured on or after the original policy cutover enter automatic expiry. Active leases, pending matches, dead letters, booking actions, unresolved or ambiguous outcomes, Priority 5 and invalid priorities remain available to their operators. Each declined candidate has another review date.

The reviewer requires a valid Lead snapshot, one live terminal decision, a newer accepted winner, no protected holders and exact historical reconstruction. A stale result must identify an older temporal winner. An HTTP action also needs a matching closed-run replay record. A true webhook must have the transactional day-count acknowledgment and a materialized or finalized Daily Operations day. A browser extension operation must have the exact terminal result for its unique operation key. The publication transaction rereads current sources, holders, day evidence and the newer winner. Future mode stamps the established routine HTTP cohort for TTL. It retires qualifying webhook and effect-bearing detail within the transaction. Extension receipts keep a compact unique key, kind, payload hash, original result and archive pointer for redelivery and conflict detection. Daily counters separately report verified chains, direct retirements and TTL stamps.

Cloud Storage holds checksummed BSON under `history/granot/v1` in the private Mongo backup bucket. This prefix lies outside the daily and weekly backup expiry rules. Month catalog rows point at immutable verified objects and use compare-and-swap when more history arrives. Diagnostic readers verify stored contents against their hash and use the recorded generation when present. Closed-run lookup rows preserve operation ID, kind, payload hash and original result after the hot run is deleted.

## Scheduled run closure and recovery

New scheduled runs carry `purge_at: null` and an `archive_review_at` equal to their original action expiry. Completion moves `archive_review_at` to the completion time. The reviewer compares every approvable action, sealed checksum, committed result, payload hash and downstream refresh marker. A direct scheduled result (`scheduled_direct: true`) has no receipt; it must carry a permitted outcome, its Outreach completion marker and, for `applied`, its Observation and Decision IDs. A pre-cutover action must match its receipt replay. The worker also verifies an empty operation namespace for a zero-action plan. It restores and compares the exact original run BSON and the replay object from pinned GCS generations, then rereads the source and operation set inside a transaction. That transaction inserts the closed-run lookup row in `granot_closed_automation_runs`, inserts the coverage row in `granot_completed_estimate_windows` and deletes the run. The coverage row keeps slot coverage, collection completeness, held rows and unapplied counts until `purge_at`: the latest of run creation plus nine days, slot purge plus one day, and archival plus one day. The closed-run lookup has no expiry in code and continues to fence deterministic child creation ([`createGranotRun`](../../../src/services/granotHttpCollector/runWorkflow.ts)).

The cron returns `scheduled_runs.oldest_due_at`, held and failure counts. A held run records its status, reason, last check and next review time. A run that is not `completed` is held as `actionable_run`. Storage or verification failures retry in 30 minutes. Held runs retry after a day. Archive retries do not reclaim or apply a business operation.

On November 19 release `7c5a0490` retired all 862 scheduled runs present at 12:54 New York and 130 later arrivals, with zero holds and zero failures. Per-run archive time was 0.89 s median and 1.42 s p95. The original cohort fell from 78,843,420 logical bytes to 270,668 lookup bytes and 482,458 coverage bytes ([roadmap entry](../../operations/SERVICE-OPTIMIZATION-ROADMAP.md)).

Install the sparse scheduled-review index with the idempotent `ops/granot-retention-install.ts --install-shadow`. For an existing completed scheduled run with a legacy TTL, use `ops/granot-enroll-scheduled-archives.ts --preview <past UTC cutoff> [page size]`, then `--apply` with the same arguments. Enrollment schedules review and clears the legacy TTL on one bounded page. The worker still checks each run before compaction. With the server environment loaded, execute these commands with `node --import tsx`.

For an on-demand restore, run `ops/granot-read-archived-evidence.ts --run <run ID> <new private BSON file>` for the original run. Use `--receipt <receipt ID> <new private BSON file>` for a retired webhook, extension operation or effect-bearing HTTP receipt. Routine HTTP history is indexed by job and month. Its original operation result is indexed by run/action.

Enroll the legacy tail with `ops/granot-enroll-scheduled-archives.ts --migrate <production alias cutover UTC> [pages] [page size]`. Each invocation processes at most 128 pages of 500 IDs. The migration checkpoints examined and enrolled totals transactionally at each page. Scheduled system runs in all statuses keep their original action deadline. One fixed-range pass can begin immediately. A final pass catches old invocations that overlapped the cutover, once the server's 800-second maximum invocation lifetime has elapsed. A first invocation after that interval can finish in a single pass. Repeat with the same cutover until `--migration-status` reports `complete`. Later calls return the existing checkpoint.

## Rollout and historical review

Run ops/granot-retention-install.ts --install-shadow using the main server environment. It first proves the sparse purge indexes have no pre-existing date to activate before converting them to TTL. Reinstallation preserves the original cutoff and mode. Shadow archives eligible future chains and records observations without issuing purge dates. Future mode stamps eligible new chains. Require archive restoration, replay/freshness parity, protected-record exclusions and shadow evidence before promotion. Keep the original cutoff fixed.

After the live deployment, backfills, history restoration and Pool comparison have been verified, the operator can arm future-only retention with `ops/granot-retention-install.ts --arm-future <existing new_data_from ISO timestamp>`. Arming preserves shadow mode. Promotion requires seven consecutive complete UTC days after both arming and working-set maturity. Each day must include at least 100 chains that passed the final reference/replay checks, three live comparisons of certified and historical Pool reads, no mismatches or failed batches, and zero TTL stamps. Every subsequent future-mode chain still passes the individual transactional checks. Missing evidence keeps the policy in shadow. The cutoff excludes the historical deletion manifest throughout. To disarm before promotion, remove only the armed_at field while mode is shadow.

The historical pilot is prepared with ops/granot-history-archive.ts, ops/granot-archive-run-closure.ts and ops/granot-targeted-deletion-dry-run.ts. The last command requires a new private JSON output file. It compares hot evidence with its archive, verifies closed-run replay, fresh production deployment ancestry, current winning Lead and references, and reports logical bytes and per-chain exclusions. A manifest represents a point in time. Recheck it immediately before any separately authorized deletion. These commands do not delete historical records.

Use ops/verify-granot-future-retention.ts with a disposable loopback replica on port 27961 to exercise shadow, future, archive, replay, TTL selection and historical cutoff behavior. This verifier also writes synthetic test archive objects. The four-year runway requires the future working set and durable growth to be measured over time. Compare daily capacity snapshots, review throughput, unresolved backlog and archive catalog growth.

### Routine HTTP replay and archive publication

A completed effect-free HTTP automation result for an already-current or stale Form Lead or Call Lead stores the decision, observation and target IDs as BSON ObjectIds in its replay cache. The reader expands either cache format into the original result, including the empty effects array, and falls back to the latest Synchronization Decision when the cache belongs to an earlier decision. Other outcomes retain the full result. Reverting the writer should preserve the mixed-format reader so a compact receipt can still replay during a TTL deletion interval. Archived history and closed runs use their existing format. New history pages and run closures decode the same Cloud Storage bytes that passed checksum verification before publishing a Mongo pointer.

## Storage, indexes and read paths

This section is the Granot baseline for the collection-wide index and read phase. Index names and keys below are copied from code. "Model" means a Mongoose schema declaration. "Ops" means [`ops/granot-retention-install.ts`](../../../ops/granot-retention-install.ts) or another operator script creates it, so a fresh environment lacks it until that script runs. Measured figures come from the read-only November 19 inventory taken at 21:01 New York on the primary, with index counters covering about 29.2 hours ([baseline record](../../operations/INDEX-READ-BASELINE-2026-11-19.md), [raw inventory](../../operations/evidence/index-read-baseline-2026-11-19.json)). Read counts are primary-only. They exclude unique checks on writes and TTL deletions. Anything not in that inventory is unmeasured.

### `granot_webhook_receipts` (Granot Observation Receipts)

Model: [`GranotObservationReceipt.ts`](../../../src/models/GranotObservationReceipt.ts).

| Index | Keys and options | Source | Reads in window |
| --- | --- | --- | ---: |
| `_id_` | `_id` | default | 477,221 |
| `granot_observation_receipt_channel_operation_id_unique` | `observation_channel, channel_operation_id`; unique; partial `channel_operation_id: {$type: "string"}` | model | 7,507 |
| `granot_observation_receipt_processing_due` | `processing.state, processing.next_attempt_at, captured_at` | model | 396 |
| `granot_observation_receipt_leased_until` | `processing.leased_until` | model | 362 |
| `granot_observation_receipt_route_event_captured` | `route_event_class, captured_at: -1` | model | 602 |
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0 after `collMod` | ops | 1 |
| `granot_retention_review_v1` | `processing.retention_review_at`; sparse | ops | 1,029 |

`granot_observation_receipt_payload_sha256_diag` (`payload_sha256, captured_at: -1`) was removed from the model in `0b2ac446` and dropped in production on November 19 ([next-session record](../../operations/NEXT-SESSION.md)).

Query shapes:

- **Drainer claim.** Due `pending` or `retry_scheduled` work and expired claims, by `processing.state`, `processing.next_attempt_at` and `processing.leased_until` ([`drainer.ts`](../../../src/services/granotLifecycle/drainer.ts)).
- **Per-item `_id` reads.** Drainer receipt load, requeue, case statements and every retention pass.
- **Receipt retention review.** `processing.retention_review_at <= now`, `createdAt >= cutoff`, `captured_at >= cutoff`. Hint `granot_retention_review_v1`, sorted by review date, limit 64. The drainer sets the review date to completion plus 24 hours and one minute for accepted Form Lead and Call Lead outcomes.
- **Completed webhook scan.** Per route: `route_event_class`, `observation_channel: "granot_webhook"`, `webhook_day_counted: true`, `processing.state: "completed"` and a due or absent `processing.webhook_archive_review_at`. Hint `granot_observation_receipt_route_event_captured`, newest first, limit 8. Only the route class and capture time bound the index scan. The other predicates are filtered per document.
- **Closed-run replay.** `observation_channel: "granot_http_automation"`, `channel_operation_id: {$type: "string", $gte: "<run>:", $lt: "<run>;"}`. Hint on the unique operation index, limit 5,001 ([`prepareClosedRun.ts`](../../../src/services/granotHistory/prepareClosedRun.ts)).
- **Replay by channel and operation ID.** `{observation_channel, channel_operation_id}` equality with no `$type` predicate and no hint. Two callers remain. The duplicate-key reload in `captureChannelOperationReceipt` ([`capture.ts`](../../../src/services/granotLifecycle/capture.ts)) serves extension and pre-cutover automation capture. `resumeCapturedAutomationAction` ([`automationApply.ts`](../../../src/services/granotLifecycle/automationApply.ts)) serves actions of runs below schema version 3 that have no saved receipt ID. New scheduled actions no longer reach this lookup.

Hot copy required by: every unfinished receipt (pending, retry, claimed, dead letter), every `booking_status_changed` receipt, extension receipts (compacted in place to the unique key, kind, payload hash, result and archive pointer), and inbound Lead webhooks until their retirement checks pass. Retired webhooks leave this collection. See `granot_archived_receipts`.

Baseline: 13,032 documents, 28.6 MiB logical, 1,127.3 MiB allocated, of which 1,119.6 MiB is reusable, and 24.7 MiB of indexes. The unique operation index is 20.37 MiB of that.

### `granot_archived_receipts` (retired receipt locators)

Only `_id_` exists (790 reads). [`completedWebhooks.ts`](../../../src/services/granotHistory/completedWebhooks.ts) writes webhook locators: format `completed-webhook-bson-v1`, hash, generation, route, capture time, `processing.latest_decision_id` and `certified_lead`. The Lead evidence and receipt retention passes write `evidence_archive` or month-archive locators. Readers use `_id` or `{_id: {$in}, format}`. `readRetiredLifecycleReceipt` serves the drainer, Owner requeue and case statement readers by original receipt ID. There is no TTL. Each row requires its pinned GCS object. Baseline: 22,864 documents, 6.07 MiB logical.

### `granot_observations` (Granot Observations)

Model: [`GranotObservation.ts`](../../../src/models/GranotObservation.ts). No partial filters are declared.

| Index | Keys and options | Source | Reads | MiB |
| --- | --- | --- | ---: | ---: |
| `_id_` | `_id` | default | 568,230 | 1.16 |
| `granot_observation_receipt_id_unique` | `receipt_id`; unique | model | 57,387 | 1.44 |
| `granot_observation_kind_captured` | `kind, captured_at: -1` | model | 1 | 0.90 |
| `granot_observation_normalized_job_no_captured` | `identity.normalized_job_no, captured_at: -1` | model | 0 | 50.75 |
| `granot_observation_source_route_captured` | `normalized_source_label, route_event_class, captured_at: -1` | model | 0 | 22.77 |
| `granot_observation_normalized_form_ref_captured` | `identity.normalized_form_ref, captured_at: -1` | model | 0 | 27.61 |
| `granot_observation_normalized_phone_captured` | `contact.normalized_phone, captured_at: -1` | model | 0 | 66.04 |
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0 | ops | 1 | 0.01 |

Query shapes: `_id` and `_id: {$in}` reads from case evidence, Pool admission, Call Lead move-date repair and closed-run preparation. `receipt_id` reads come from receipt evidence. The Lead evidence pass reads `_id > cursor`, sorted by `_id`, 192 per page, and keeps its cursor in `granot_retention_control` (`_id: "lead-evidence-v1"`). `identity.normalized_job_no` is read only by the job timeline loader when `includeTransportEvidence` is set, by the read-fact fallback before its backfill completes ([`observationReadFacts.ts`](../../../src/services/granotLifecycle/observationReadFacts.ts)) and by `ops/pool-production/inspect.ts`. Only [`ops/verify-granot-history-archive.ts`](../../../ops/verify-granot-history-archive.ts) sets `includeTransportEvidence`. `kind` is read only by the same pre-backfill fallback.

A scheduled direct change inserts its Observation with a deterministic `_id`, `scheduled_run_id` and a synthetic `receipt_id` that has no receipt document ([`scheduledLeadChange.ts`](../../../src/services/granotHttpCollector/scheduledLeadChange.ts)). Pool admission recognizes it by `scheduled_run_id`.

Baseline: 6,206 documents, 6.4 MiB logical, 517.1 MiB allocated, 515.3 MiB reusable and 170.7 MiB of indexes.

### `synchronization_decisions` (Synchronization Decisions)

Model: [`SynchronizationDecision.ts`](../../../src/models/SynchronizationDecision.ts). The schema sets `autoIndex: false`, so Mongoose does not build these indexes on startup.

| Index | Keys and options | Source | Reads |
| --- | --- | --- | ---: |
| `_id_` | `_id` | default | 66,233 |
| `synchronization_decision_observation_attempt_unique` | `observation_id, attempt`; unique | model | 143,668 |
| `synchronization_decision_outcome_decided` | `outcome, decided_at: -1` | model | 41 |
| `synchronization_decision_target_decided` | `target.model, target.id, decided_at: -1` | model | 20 |
| `synchronization_decision_source_decided` | `source_scope.granot_crm_source_id, decided_at: -1` | model | 0 |
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0 | ops | 1 |

Query shapes: `observation_id` (`$in`, sorted by `attempt`) from Pool admission, the job timeline loader, receipt evidence and retention. `_id` reads come from drainer replay and case readers. The Operations Health 24-hour groups match `outcome` and `decided_at` ([`projections.ts`](../../../src/services/granotLifecycle/projections.ts)). Baseline: 6,218 documents, 7.33 MiB logical, 3.77 MiB of indexes.

### Case-owned evidence and read facts

`granot_case_observations`, `granot_case_statements` and `granot_case_decisions` hold copies pinned by Booking and Release case transactions ([`caseEvidence.ts`](../../../src/services/granotLifecycle/caseEvidence.ts)). Readers try the case copy, then the hot collection, then the archive by original ID. `granot_case_observations` has `case_observation_job_captured` (`identity.normalized_job_no, captured_at: -1`). [`ops/granot-read-facts-backfill.ts`](../../../ops/granot-read-facts-backfill.ts) creates it; no model declares it. Booking Priority Pairing reads it by job. The other two collections have only `_id`. `granot_observation_read_facts` (7 rows, `_id` only) holds the latest capture time, invalid-priority watermarks and the backfill cursor. Baseline: 1,482, 912 and 912 documents.

### `granot_history_archive_chunks` (GCS archive catalog)

| Index | Keys and options | Source | Reads |
| --- | --- | --- | ---: |
| `_id_` | `_id` | default | 5,883 |
| `granot_archive_job_newest` | `job_key, newest: -1` | ops | 0 |
| `granot_archived_evidence_id` | `evidence_ids`; sparse | ops | 569 |

Rows point at checksummed GCS objects by hash and generation. Month catalog rows use compare-and-swap on `_id`. Lead evidence pages add `evidence_ids`. `readEvidenceIds` finds them by `{format, evidence_ids: {$in}}` ([`evidencePage.ts`](../../../src/services/granotHistory/evidencePage.ts)) for case readers and drainer Decision replay by original ID. `job_key` reads happen only with `includeTransportEvidence` and in operator verifiers. There is no TTL. Baseline: 46,769 documents, 14.91 MiB logical.

### Scheduled run collections

`granot_automation_runs` ([`GranotAutomationRun.ts`](../../../src/models/GranotAutomationRun.ts)):

| Index | Keys and options | Source | Reads |
| --- | --- | --- | ---: |
| `_id_` | `_id` | default | 228,214 |
| `granot_run_queue_claim` | `status, createdAt` | model | 11,751 |
| `granot_run_recovery` | `status, leased_until` | model | 258,558 |
| `granot_scheduled_archive_due` | `archive_review_at`; sparse | model and ops | 940 |
| `granot_run_retention_ttl` | `purge_at`; TTL 0 | model | 1 |
| `granot_run_plan_identity` | `_id, plan_checksum`; unique; partial `plan_checksum: {$type: "string"}` | model | 0 |
| `run_group_id_1` | `run_group_id` | model field `index: true` | 50 |
| `expires_at_1` | `expires_at` | model field `index: true` | 0 |
| `lease_owner_1`, `leased_until_1` | single fields | [`durableWork/schema.ts`](../../../src/services/durableWork/schema.ts) `index: true` | 0, 1 |

Query shapes: the worker claim matches the scheduled-run filter (operation, workflow, cron actor, `auto_apply`, `scheduled_slot_key` type), `waiting_for_all != true` and an `$or` over `queued`, lease-free `planning` and ready `applying`. It sorts by `last_attempt_at, createdAt` ([`runWorkflow.ts`](../../../src/services/granotHttpCollector/runWorkflow.ts)). Every fenced write adds `_id`, status, lease owner, epoch and `leased_until`. The archive pass reads `archive_review_at <= now` with its hint. Freshness and the ALL-to-Pool dependency aggregate on `request_snapshot.scheduled_coverage.slotKey` or `request_snapshot.after_all_coverage.slotKey`, with `$unionWith` over `granot_completed_estimate_windows`. Baseline at 21:01: 0 documents, because fulfilled runs are deleted. The collection measured 2.225 GB logical on November 18 before archival ([hot storage record](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)).

`granot_closed_automation_runs` has only `_id` (56,122 reads). Each row holds the run ID, replay object hash and generation, operation count, closure time and the original run archive locator ([`closedAutomationRun.ts`](../../../src/services/granotHistory/closedAutomationRun.ts)). Run creation, the worker, receipt retention and legacy replay read it by `_id`. It has no expiry. Baseline: 6,950 documents, 1.32 MiB.

`granot_completed_estimate_windows` has ops indexes `granot_completed_window_ttl` (`purge_at`, TTL 0) and `granot_completed_window_slot` (`request_snapshot.scheduled_coverage.slotKey`, 64 reads). Baseline: 1,902 documents, 1.01 MiB.

`granot_estimates_schedule_slots` ([model](../../../src/models/GranotEstimatesScheduleSlot.ts)) has `granot_estimates_schedule_retention` (`purge_at`, TTL 0). `purge_at` is creation plus eight days. Recovery reads undispatched or Pool-pending slots with `purge_at > now`, sorted by `createdAt`, limit 10. Freshness reads `{lane}` sorted by `createdAt: -1`, limit 100. Neither has a matching index. The collection held 280 documents. `granot_estimates_open_dates` (350 documents) has only `_id`.

### Retention control and other Granot collections

`granot_retention_control` holds the `v1` policy and lease and the `lead-evidence-v1` cursor and lease. `granot_retention_days` holds daily shadow counters. Both are `_id`-only. `granot_record_links` keeps `granot_record_link_active_job_unique` (`provider, normalized_job_no`; unique; partial `state: "active"`; 477,920 reads), `granot_record_link_lead_state` and `granot_record_link_booking_state` (0 reads) ([`GranotRecordLink.ts`](../../../src/models/GranotRecordLink.ts)). `granot_lifecycle_health_state` is described in [observability](./observability.md).

### GCS obligations

Archive objects live under `history/granot/v1/vantagemovers/` in the private backup bucket. Every locator, catalog row and closed-run row names a hash and generation. Readers verify the checksum and identity before use. Bucket lifecycle deletes only objects with a release marker, 30 days after `customTime`. A publisher that reuses a generation under review or release first sets a temporary hold ([`archiveObjects.ts`](../../../src/services/granotHistory/archiveObjects.ts)). Releasing a generation follows the procedure at the top of this page.

### Observations for the index and read phase

- **Channel and operation ID lookup.** The production planner chose a collection scan for receipt lookup by channel and operation ID, in samples before and after the diagnostic index drop ([next-session record](../../operations/NEXT-SESSION.md)). Both remaining equality callers omit the partial filter predicate `channel_operation_id: {$type: "string"}`. MongoDB uses a partial index only when the query implies its filter. Confirm with `explain` before adding the predicate or a hint.
- **Declared indexes with no code read.** `granot_observation_normalized_phone_captured`, `granot_observation_normalized_form_ref_captured` and `granot_observation_source_route_captured` have no query in `src/` or `ops/`. Together they hold 116.42 MiB. `granot_observation_normalized_job_no_captured` (50.75 MiB) and `granot_observation_kind_captured` serve only operator verifiers and the pre-backfill fallback. `synchronization_decision_source_decided`, `granot_run_plan_identity`, `expires_at_1`, `lease_owner_1` and `granot_record_link_booking_state` recorded zero reads. No standalone query was found for the last three. `granot_run_retention_ttl` has no writer that sets a date, because new runs store `purge_at: null`.
- **Hot queries without a matching index.** The reference check in [`retentionReferences.ts`](../../../src/services/granotHistory/retentionReferences.ts) runs an `$or` of `$in` lists across Lead provenance paths in `call_leads`, Record Link `established_by_decision_id` and `last_observation_id`, case and discrepancy evidence paths, Pool work, Outreach subjects, `lead_messages` and `entity_changes`. Only `entity_changes.provenance.*` (production-only indexes, below), `granot_booking_reconciliation_cases.evidence.observation_id` and the partial `lead_messages` `observation_id` index cover a branch. The `lead_messages` index requires `$type: "objectId"`, and the check also passes string IDs. `form_leads` is read by `_id` only for the plainest chain: exactly one Decision, whose target is a Form Lead with a canonical lowercase 24-hex id. Every other chain keeps the six-path scan, restricted to its own IDs. That includes a chain with no Decision left (older `lead_created` Observations), several Decisions, an untargeted Decision, a Call target, or a target id in any other form. Every current Form writer is a command whose EntityChange cites the Observation, and `entity_changes.provenance.*` is checked for every chain. On November 20, 34 production batches of 192 hot Observations returned identical holds both ways: 5,819 references, none missing or extra. Of those 34 batches, 29 still needed the scan, mostly because of Call-target chains. Where the probe applies, it examined 2,818 documents in 11 ms; the scan examines all 9,049 in 164 ms. Each two-minute tick can run the reference check four times: twice in the receipt pass and twice in the Lead evidence pass. On `granot_automation_runs`, the claim sort `last_attempt_at, createdAt` and the freshness `slotKey` match have no matching index.
- **Production indexes not declared in code.** `entity_change_granot_observation_ref_v1`, `entity_change_granot_decision_ref_v1` and `entity_change_granot_receipt_ref_v1` (sparse, on `entity_changes.provenance.*`) were built on November 18. With all three, the reference probe examined 34 documents instead of 178,390 ([hot storage record](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)). No model or ops script declares them. The ops-installed retention, archive and window indexes also exist only after their scripts run.
- **Per-item `_id` reads.** `granot_observations._id` (568,230) and `granot_webhook_receipts._id` (477,221) are among the hottest reads, on collections of 6,000–13,000 documents.
- **Retention gaps.** Direct scheduled Observations and Decisions have no receipt. The Lead evidence pass skips rows without a receipt or locator, so no code path retires them. `granot_closed_automation_runs`, `granot_archived_receipts` and `granot_history_archive_chunks` have no expiry. Their daily growth is unmeasured.
- **Physical space.** The two largest Granot collections hold 1,634.9 MiB of reusable space after the November 18–19 removals. Reclaim needs a separately approved per-member `compact` ([baseline record](../../operations/INDEX-READ-BASELINE-2026-11-19.md)).
