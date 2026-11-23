# Granot storage retention

## Releasing a production archive generation

The bucket deletes Granot objects under `history/granot/v1/vantagemovers/` and `history/granot/released/vantagemovers/` after 90 days measured from the object's release marker (`customTime`) (Owner decision 1, 2026-11-23; 30 days before). Retired objects normally reach that marker through [end of life](#end-of-life). The manual procedure below remains for anything else. Unmarked generations stay available. Bucket soft deletion adds seven days of recovery after lifecycle deletion.

For a content-addressed production archive, first establish that its last reader, replay and backup obligations have ended. Include historical catalog exports, standalone rollback packs and daily and weekly backups. Check that every external publisher has finished or uses the release-aware writer. A missing current MongoDB pointer alone cannot establish this.

Record the exact `hash` and string `generation` in a JSON file with evidence references in `reader_clearance`, `backup_clearance`, `rollback_clearance` and `external_writer_clearance`. Run the following from the server root against the verified production deployment.

```sh
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts begin evidence.json
# Allow at least 800 seconds for any publication already in flight to drain.
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts release evidence.json
```

Both commands check live MongoDB references. The release checks the original evidence digest and review hold before updating the exact GCS generation and metageneration. Reuse invalidates the review or holds a released generation before publishing a new pointer. A later review starts a fresh recovery window once those obligations end.

The main server owns retention. A completed scheduled Estimates run is due for archive review at completion. Any other scheduled run is reviewed at its original action deadline and stays hot. Receipts in every channel retire on use: once used, each one moves to Cloud Storage and leaves a compact locator ([retire on use](#retire-on-use)). Their Observations and Decisions follow through the Lead evidence pass once nothing references them. The older backlog goes through the [backlog command](#backlog-command).

## Online processing

The authenticated `/api/cron/granot-storage-retention` job runs every two minutes ([`vercel.json`](../../../vercel.json), [route](../../../src/routes/granot-retention-cron.routes.ts)). Four passes run together in one invocation:

| Pass | Code | Budget per invocation |
| --- | --- | --- |
| Retire on use (all channels) | [`retireOnUse.ts`](../../../src/services/granotHistory/retireOnUse.ts) | 32 due receipts, only once enabled |
| Fulfilled scheduled runs | [`scheduledRunArchive.ts`](../../../src/services/granotHistory/scheduledRunArchive.ts) | 16 runs, four at a time |
| Fulfilled inbound Lead webhooks | [`completedWebhooks.ts`](../../../src/services/granotHistory/completedWebhooks.ts) | 8 receipts per route (`lead_created`, `priority_updated`) |
| Fulfilled Lead Observations and Decisions | [`retireLeadEvidence.ts`](../../../src/services/granotHistory/retireLeadEvidence.ts) | one page of 192 Observations, GCS object at most 7 MiB |

The route returns HTTP 503 when the run, webhook or retire-on-use pass records a failure.

## Retire on use

Owner direction, November 21: once a receipt, Observation or Decision has done its job, it leaves MongoDB for verified GCS and can be read back by original ID. Keeping storage low is a priority.

### What "used" means per channel

At completion, the drainer stamps `processing.retention_review_at` only on a candidate: an inbound `lead_created` or `priority_updated` webhook, or a `lead_snapshot_apply` channel operation (`isRetirementCandidate`). The pass reads the index range from `enabled_from` to now, so the older backlog is never scanned, and it reviews due receipts oldest first. It claims each one for 30 minutes before any network I/O. A receipt that is not yet used gets another review a day later, and `processing.retention_reason` records why. A permanent reason, such as a booking route, removes the receipt from the queue. Code: `usedReason` in [`retireOnUse.ts`](../../../src/services/granotHistory/retireOnUse.ts).

| Channel | Used when | Kept in MongoDB |
| --- | --- | --- |
| Inbound webhook, `lead_created` / `priority_updated` | All of these hold:<br>• it is completed;<br>• it is counted in its Daily Operations day (`webhook_day_counted`, and the day carries `webhook_counts_version: 1`, so a rebuild never recounts receipts);<br>• its Observation and one live Decision exist.<br>The outcome must also be one of:<br>• a committed Lead effect: `applied` with `lead_updated`, or `created` with `lead_created` on a Form Lead whose origin is `granot_lead_created`, and the Lead exists;<br>• a terminal no-change: `already_current` (`desired_state_already_current`), `linked` (`record_link_established`) or `stale` (`older_than_temporal_winner`);<br>• creation-policy-final: `policy_blocked` or `unmatched` with `creation_policy_observation_only` or `match_window_expired`, checked against the source's policy version. | Pending matches, retries, dead letters, conflicts, ambiguous and deferred outcomes, and any day without transactional counts. |
| Inbound webhook, `booking_status_changed` | Never. Owner decision pending (see the PR). | All of them. Booking and Release cases pin their own copies. |
| Browser extension | All of these hold:<br>• it is completed;<br>• its latest Decision is live and found by ID, hot or archived;<br>• the Observation belongs to this receipt;<br>• the saved replay agrees with the Decision.<br>The outcome must be a committed Lead effect or terminal no-change (as above), or policy-final: `unmatched`, `policy_blocked`, `invalid`, `unsupported` or `insufficient_creation_data`. | Pending matches, conflicts, ambiguous and deferred outcomes, a missing Lead or a replay that differs. |
| Browser extension or HTTP `booking_action_apply` (any other kind) | Never (Owner decision pending), like the Lead evidence pass. | All of them. |
| HTTP automation (legacy, pre-cutover) | As for the extension. Its exact row must also be in the run's verified closed-run replay: operation, receipt, payload hash, kind, Decision, Observation and outcome. The pass publishes a missing closed run when `prepareClosedRun` allows it: the run is gone and every action completed more than seven days ago. | Every receipt of a run that cannot close yet. |

Downstream handoffs are durable before completion:
- The Sheet Sync intent is written in the Lead command's transaction.
- The lead-link wake-up and the Form sibling update run before the receipt completes, and their own scans back them up.
- Outreach reads the Lead's certified proof or the current winning Observation, and reference holds keep that Observation hot.

### How a receipt leaves

`retireReceipt` works in two steps:
1. It gzips the receipt's exact BSON, minus the review bookkeeping (`retention_review_at`, `retention_reason`, `webhook_archive_review_at`), so a retry after a claim uploads the same content-addressed object, and writes it as a create-only, content-addressed object through the [Cloud Storage module](../services/cloud-storage.md). It reads the object back from the pinned generation, checks the SHA-256, then restores the BSON and compares it byte for byte.
2. One snapshot transaction rereads the receipt and the "used" proof, inserts the locator and deletes the receipt.

If the work is interrupted before the transaction, the receipt stays hot. A retry finds the same content-addressed generation, so nothing is duplicated. If the receipt changed in between, the call returns `changed` and the receipt stays hot. The locator formats and the duplicate-delivery rule are in [capture](./capture.md#retirement-of-completed-receipts-retire-on-use).

Observations and Decisions leave through the [Lead evidence pass](./capture.md#retirement-of-lead-observations-and-decisions). That happens once their receipt has a locator (any channel) and the reference and newer-winner checks pass. A current winner stays hot. So does anything referenced from a Lead, case, Record Link, Pool work, Outreach subject, message or EntityChange.

### Reader inventory

| Reader | Needs after use | How it reads now |
| --- | --- | --- |
| Drainer `defaultLoadReceipt`, poll and replay (`drainer.ts`) | Receipt by ID and its latest Decision | The receipt: hot, else `readRetiredReceipt`. The Decision: `readCaseDecision`, which tries the case copy, then `readGranotDecision`. |
| Owner requeue `defaultFindReceipt` (`operations.ts`) | Receipt by ID | Hot, else `readRetiredReceipt`. A retired receipt is completed, so requeue refuses it as before. |
| Case evidence (`caseEvidence.ts`) | Observation, statement and Decision by ID | The case copy, else `readGranotObservation`, `readRetiredReceipt` or `readGranotDecision`. |
| Decision repointing (`receiptDecisionPointer.ts`) | Receipt pointer and certified Lead | Hot, else the locator. Both formats carry the pointer. |
| Channel capture (`capture.ts`) and `resumeCapturedAutomationAction` | Operation identity | The hot unique key, else `readRetiredOperation` on the locator's unique key. |
| `applyAutomationPlanAction` | Operation result | The closed-run replay (unchanged). |
| Pool admission (`admission.ts`) | Whether the accepted Observation's receipt completed | Hot receipt, else a `completed-webhook-bson-v1` or `channel-receipt-bson-v1` locator (before this change: the webhook format only; the channel format is new, so existing data reads the same). Reference holds keep the accepted Observation and Decision hot, because they are current winners. |
| Job timeline (`mongo-evidence-loader.ts`) | Receipt capture facts | Hot, else the locator projection (both formats). |
| Lead evidence pass (`retireLeadEvidence.ts`) | Retired receipt body | `readRetiredReceipt`. |
| Closed-run preparation (`prepareClosedRun.ts`) | Every receipt of the run | Hot only. An HTTP receipt leaves only after its run has closed. |
| Processing path (`processor.ts`, `normalization.ts`, `createLeadFromGranot.ts`, `acceptedLeadEvidence.ts`) | Receipt, Observation and Decision while processing | Hot only. These run before completion, and nothing incomplete retires. |
| Daily Operations backfill (`dailyOperations/rebuild.ts`) | Webhook receipts by capture day | Hot only. It runs only for a day without `webhook_counts_version: 1`, and no webhook of such a day retires. |
| Call move-date repair, Estimates sibling catch-up, Operations Health groups | Observations or Decisions by field | Hot only. They read current winners or the last 24 hours. Older rows already left through the evidence pass before this change. |
| Diagnostics (`ops/granot-read-archived-evidence.ts`) | Full chain | `readGranotChain`. |

### Enabling, rollback and recovery

- **Merge alone is inert.** Until `--install` creates `granot_archived_receipt_operation_unique`, no channel operation can retire (`locator_operation_index_missing`, also enforced inside `retireReceipt`), so channel capture keeps its plain insert with no transaction and no locator read. Until `--enable`, the online pass returns `not_configured`. The live webhook and evidence passes run as before.
- **Install.** Idempotent; adds `granot_archived_receipt_operation_unique` and records its first install time in `granot_retention_control` `{ _id: "receipts-on-use-index", installed_at }`: `node --env-file=.env --import tsx ops/granot-retention-install.ts --install`. From then on, channel capture checks the retired operation key in a transaction.
- **Settle window.** A process may still hold a cached "no index" answer for up to 60 seconds after install, and would capture without the retired-key check. So no channel operation retires until `installed_at + 2 minutes` (`INDEX_SETTLE_MS`), in the online pass and backlog `--apply` alike: they hold with `locator_operation_index_settling`. `--enable` may run straight after `--install`. The index check fails closed: only a missing collection (NamespaceNotFound) reads as "no index", and any other `listIndexes` error fails the capture, which the caller retries.
- **Enable (Owner).** `ops/granot-retention-install.ts --enable <ISO instant>` writes `granot_retention_control` `{ _id: "receipts-on-use-v1", enabled_from }`. Only receipts completed (stamped) at or after `enabled_from` are reviewed online. Deploying alone changes nothing.
- **Rollback.** `--disable` deletes the control document, and the pass returns `not_configured`. Retired records stay readable by ID, and duplicates keep replaying from their locators. To return one receipt to MongoDB:
  1. Restore it with the diagnostics command below.
  2. In a reviewed transaction, insert it unchanged and delete its locator.
  No tool does this automatically.
- **Fetch a retired record by ID.** `node --env-file=.env --import tsx ops/granot-read-archived-evidence.ts --receipt <receipt ID> <new private BSON file>` writes the receipt, Observation and Decisions as one BSON document. In code, use `readGranotReceipt`, `readGranotObservation` or `readGranotDecision` from [`retiredRecords.ts`](../../../src/services/granotHistory/retiredRecords.ts).

### Backlog command

`ops/granot-retire-used-receipts.ts` reviews every completed receipt still in MongoDB through the same `retireReceipt` path.

- **Dry run** (the default): `node --env-file=.env --import tsx ops/granot-retire-used-receipts.ts <new private JSON file>`. It reads MongoDB only and makes no GCS request. A check that needs a verified archive read is reported as `pending_gcs_verification`. The report gives, per channel:
  - the receipts that can retire now;
  - the bytes that leave MongoDB, and the locator bytes;
  - each hold reason, with its count;
  - the hot Observations and Decisions that would follow through the evidence pass.
- **Apply** (needs Owner approval): add `--apply --limit N`; the limit is required (start with 200). It refuses until `--install` has created the operation index. It runs one receipt per transaction, eight at a time, and publishes the closed runs that can close. To resume, rerun with a new output file. A held receipt is left untouched.

## End of life

Owner decision 2 (2026-11-23): each retired Granot object starts its 90-day GCS clock once it is retired, and the MongoDB rows that point at it expire one day earlier. Code: [`endOfLife.ts`](../../../src/services/granotHistory/endOfLife.ts). Operator: [`ops/granot-history-end-of-life.ts`](../../../ops/granot-history-end-of-life.ts).

**Rule.** A row never outlives an object it points at. The pass marks every row first (`expires_at` = now + 89 days, and it only moves earlier), then starts the object's clock. If the clock does not start, the object outlives its rows, never the reverse. Readers treat a row past `expires_at` as absent (`liveRow`): `readRetiredReceipt`, `readGranotChain`, `readEvidenceIds` and `archivedChains` return nothing instead of reading GCS. Two TTL indexes remove the rows.

**What gets an end of life.**

| Kind | Object | Rows that expire with it | Kept while |
| --- | --- | --- | --- |
| `receipt` | One retired receipt (`completed-webhook-bson-v1`, `channel-receipt-bson-v1`) | Its `granot_archived_receipts` locator | Its Observation is still hot. Pool admission and the timeline prove completion from the locator, and reference holds keep current winners hot (decision 2 review). |
| `evidence` | One Lead evidence page | Its `granot_history_archive_chunks` catalog rows, and every locator whose `evidence_archive` names it | A hot receipt still points at it (`evidence_archive`). |
| `history` | One November 18–19 job/month chunk | Its catalog row | — |
| — | Closed scheduled runs and their replays | — | Always. The closed-run row fences deterministic run creation (`createGranotRun`) and serves same-key replay to `applyAutomationPlanAction`, and no Owner-defined bound exists. |

**Duplicate fence.** A channel locator carries the extension's unique operation key (`granot_archived_receipt_operation_unique`). The extension retries a pending operation ID for at most 7 days (`PENDING_OPERATION_MAX_AGE_MS` in the extension's `src/lifecycle/ledger.ts`). So a channel locator is never set to expire before `captured_at` plus 7 days (`operation_fence_window`). In practice it lives at least 89 days after retirement. Closed runs, which are kept, fence HTTP automation IDs.

**Release.** It follows the namespace review:
1. The pass places the review hold under the constant token `end-of-life-v1`, replacing any publisher hold, and records the object in `granot_history_end_of_life`.
2. At least 800 seconds later, measured from the hold's provider `updated` time, it marks the rows.
3. It calls `startRecoveryClock`, whose guard refuses while any row that would outlive the object still points at it.

A re-put of identical bytes during the review cancels it (`rehold`), and the object is reviewed again on a later lap. When a release marks a row that also points at another object, that object is queued, so it is never left in GCS without rows.

**Switch and passes.** End of life is off on merge. `granot_retention_control` `{ _id: "end-of-life-v1", enabled_at, kinds }` turns on the online pass in `/api/cron/granot-storage-retention`. Each step handles up to 12 objects: drained reviews first, then queued objects, then a wrapping scan of each enabled kind. The pass opens a release store only while the bucket rule deletes `history/granot/v1/<db>/` after 90 days. Otherwise it reports `failed` and the route returns 503.

**Rollout (Owner).**
1. Change the bucket rule for `history/granot/v1/vantagemovers/` and `history/granot/released/vantagemovers/` to `daysSinceCustomTime: 90`. Do the same for the November 19 packs' `history/sales-intelligence/v1/vantagemovers/` rule. [`lifecycle.json`](../../../ops/cloud/mongodb-backup/lifecycle.json) mirrors the target. No Granot object is on its clock today, so this shortens nothing.
2. Deploy this release. Release stores now expect 90 days.
3. Run `node --env-file=.env --import tsx ops/granot-history-end-of-life.ts dry-run <new private JSON file>`, then `install`, then `enable --kinds receipt,evidence`. Add `history` for the November 18–19 chunks.
4. `run --passes N` drains the backlog. `status` reports reviews, queued objects, expiring rows and the bucket-rule check.

**Rollback.** Run `disable`. Rows already marked keep their `expires_at`. Objects already on their clock keep it, and a re-put re-holds an object.

**Measured (2026-11-23, read-only).**
- **GCS:** 291,348 objects (1.96 GB) under the Granot prefix, none on a clock. MongoDB rows name 23,717 of them, plus 19,970 closed-run objects.
- **Eligible now:**
  - 109 receipts (0.14 MB);
  - 243 evidence pages (10.8 MB);
  - 17,049 history chunks (117.6 MB).
- **Kept:**
  - 6,279 receipts whose Observation is hot (6.8 MB);
  - 37 pages a hot receipt points at (3.1 MB).
- **Rows that would expire:** 62,656 (19.4 MB of BSON).
- **Out of reach:** no MongoDB row names the other 247,661 objects (1.75 GB). They are earlier per-chain archives that only operator manifests reference, so this pass cannot reach them. Their end of life is a separate Owner decision.

## Scheduled run closure and recovery

New scheduled runs carry `purge_at: null` and an `archive_review_at` equal to their original action expiry. Completion moves `archive_review_at` to the completion time. The reviewer compares every approvable action, sealed checksum, committed result, payload hash and downstream refresh marker. A direct scheduled result (`scheduled_direct: true`) has no receipt; it must carry a permitted outcome, its Outreach completion marker and, for `applied`, its Observation and Decision IDs. A pre-cutover action must match its receipt replay. The worker also verifies an empty operation namespace for a zero-action plan. It restores and compares the exact original run BSON and the replay object from pinned GCS generations, then rereads the source and operation set inside a transaction. That transaction inserts the closed-run lookup row in `granot_closed_automation_runs`, inserts the coverage row in `granot_completed_estimate_windows` and deletes the run. The coverage row keeps slot coverage, collection completeness, held rows and unapplied counts until `purge_at`: the latest of run creation plus nine days, slot purge plus one day, and archival plus one day. The closed-run lookup has no expiry in code and continues to fence deterministic child creation ([`createGranotRun`](../../../src/services/granotHttpCollector/runWorkflow.ts)).

The cron returns `scheduled_runs.oldest_due_at`, held and failure counts. A held run records its status, reason, last check and next review time. A run that is not `completed` is held as `actionable_run`. Storage or verification failures retry in 30 minutes. Held runs retry after a day. Archive retries do not reclaim or apply a business operation.

On November 19 release `7c5a0490` retired all 862 scheduled runs present at 12:54 New York and 130 later arrivals, with zero holds and zero failures. Per-run archive time was 0.89 s median and 1.42 s p95. The original cohort fell from 78,843,420 logical bytes to 270,668 lookup bytes and 482,458 coverage bytes ([roadmap entry](../../operations/SERVICE-OPTIMIZATION-ROADMAP.md)).

Install the sparse scheduled-review index with the idempotent `ops/granot-retention-install.ts --install`. For an existing completed scheduled run with a legacy TTL, use `ops/granot-enroll-scheduled-archives.ts --preview <past UTC cutoff> [page size]`, then `--apply` with the same arguments. Enrollment schedules review and clears the legacy TTL on one bounded page. The worker still checks each run before compaction. With the server environment loaded, execute these commands with `node --import tsx`.

For an on-demand restore, run `ops/granot-read-archived-evidence.ts --run <run ID> <new private BSON file>` for the original run. Use `--receipt <receipt ID> <new private BSON file>` for a retired webhook, extension operation or effect-bearing HTTP receipt. Routine HTTP history is indexed by job and month. Its original operation result is indexed by run/action.

Enroll the legacy tail with `ops/granot-enroll-scheduled-archives.ts --migrate <production alias cutover UTC> [pages] [page size]`. Each invocation processes at most 128 pages of 500 IDs. The migration checkpoints examined and enrolled totals transactionally at each page. Scheduled system runs in all statuses keep their original action deadline. One fixed-range pass can begin immediately. A final pass catches old invocations that overlapped the cutover, once the server's 800-second maximum invocation lifetime has elapsed. A first invocation after that interval can finish in a single pass. Repeat with the same cutover until `--migration-status` reports `complete`. Later calls return the existing checkpoint.

## Rollout and historical review

On November 21, retire on use replaced four mechanisms: shadow mode, the seven-day promotion, TTL stamping of routine HTTP receipts and the 24-hour review delay. Nothing writes `retention_purge_at` now. The three `granot_retention_purge_v1` TTL indexes in production are inert. Dropping them is an index change that needs Owner approval. `granot_retention_control` `v1` and `granot_retention_days` are no longer read.

The historical pilot is prepared with ops/granot-history-archive.ts, ops/granot-archive-run-closure.ts and ops/granot-targeted-deletion-dry-run.ts. The last command requires a new private JSON output file. It compares hot evidence with its archive, verifies closed-run replay, fresh production deployment ancestry, current winning Lead and references, and reports logical bytes and per-chain exclusions. A manifest represents a point in time. Recheck it immediately before any separately authorized deletion. These commands do not delete historical records.

The four-year runway requires the working set and durable growth to be measured over time. Compare daily capacity snapshots, review throughput, unresolved backlog, locator growth and archive catalog growth.

### Routine HTTP replay and archive publication

A completed effect-free HTTP automation result for an already-current or stale Form Lead or Call Lead stores the decision, observation and target IDs as BSON ObjectIds in its replay cache. The reader expands either cache format into the original result, including the empty effects array, and falls back to the latest Synchronization Decision when the cache belongs to an earlier decision. Other outcomes retain the full result. Reverting the writer should preserve the mixed-format reader so a retired receipt can still replay. Archived history and closed runs use their existing format. New history pages and run closures decode the same Cloud Storage bytes that passed checksum verification before publishing a Mongo pointer.

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
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0 after `collMod`. No writer since November 21; drop pending Owner approval | ops (historical) | 1 |
| `granot_retention_review_v1` | `processing.retention_review_at`; sparse | ops | 1,029 |

`granot_observation_receipt_payload_sha256_diag` (`payload_sha256, captured_at: -1`) was removed from the model in `0b2ac446` and dropped in production on November 19 ([next-session record](../../operations/NEXT-SESSION.md)).

Query shapes:

- **Drainer claim.** Due `pending` or `retry_scheduled` work and expired claims, by `processing.state`, `processing.next_attempt_at` and `processing.leased_until` ([`drainer.ts`](../../../src/services/granotLifecycle/drainer.ts)).
- **Per-item `_id` reads.** Drainer receipt load, requeue, case statements and every retention pass.
- **Retire-on-use review.** `processing.retention_review_at` between `enabled_from` and now. Hint `granot_retention_review_v1`, sorted by review date, limit 32. The drainer sets the review date to the completion time for retirement candidates only.
- **Completed webhook scan.** Per route: `route_event_class`, `observation_channel: "granot_webhook"`, `webhook_day_counted: true`, `processing.state: "completed"` and a due or absent `processing.webhook_archive_review_at`. Hint `granot_observation_receipt_route_event_captured`, newest first, limit 8. Only the route class and capture time bound the index scan. The other predicates are filtered per document.
- **Closed-run replay.** `observation_channel: "granot_http_automation"`, `channel_operation_id: {$type: "string", $gte: "<run>:", $lt: "<run>;"}`. Hint on the unique operation index, limit 5,001 ([`prepareClosedRun.ts`](../../../src/services/granotHistory/prepareClosedRun.ts)).
- **Replay by channel and operation ID.** `{observation_channel, channel_operation_id}` equality with no `$type` predicate and no hint. Two callers remain. The duplicate-key reload in `captureChannelOperationReceipt` ([`capture.ts`](../../../src/services/granotLifecycle/capture.ts)) serves extension and pre-cutover automation capture. `resumeCapturedAutomationAction` ([`automationApply.ts`](../../../src/services/granotLifecycle/automationApply.ts)) serves actions of runs below schema version 3 that have no saved receipt ID. New scheduled actions no longer reach this lookup.

Hot copy required by: every unfinished receipt (pending, retry, claimed, dead letter), every `booking_status_changed` receipt, and every completed receipt until it is [used](#what-used-means-per-channel). Used receipts in all three channels leave this collection; see `granot_archived_receipts`.

Baseline: 13,032 documents, 28.6 MiB logical, 1,127.3 MiB allocated, of which 1,119.6 MiB is reusable, and 24.7 MiB of indexes. The unique operation index is 20.37 MiB of that.

### `granot_archived_receipts` (retired receipt locators)

`_id_` (790 reads) and, from November 21, `granot_archived_receipt_operation_unique` (`observation_channel, channel_operation_id`; unique; partial `channel_operation_id: {$type: "string"}`; ops). [`retireOnUse.ts`](../../../src/services/granotHistory/retireOnUse.ts) writes `completed-webhook-bson-v1` locators (hash, generation, route, capture time, `processing.latest_decision_id`, `certified_lead`) and `channel-receipt-bson-v1` locators (which add the operation key, kind, payload hash, completion time and saved replay). The Lead evidence pass adds `evidence_archive`. The November 19 cleanup wrote `{ _id, evidence_archive }` rows, and the month-archive path wrote `{ job, hash, generation }` rows; both are still read. Readers use `_id`, `{_id: {$in}}`, `{_id: {$in}, format}` or the operation key. `readRetiredReceipt` serves every original-ID reader ([reader inventory](#reader-inventory)). There is no TTL. Each row requires its pinned GCS object. Baseline: 22,864 documents, 6.07 MiB logical.

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
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0; no writer since November 21 | ops (historical) | 1 | 0.01 |

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
| `granot_retention_purge_v1` | `retention_purge_at`; sparse; TTL 0; no writer since November 21 | ops (historical) | 1 |

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

`granot_retention_control` holds the `receipts-on-use-v1` switch and the `lead-evidence-v1` cursor and lease. Its old `v1` policy document and `granot_retention_days` (daily shadow counters) are no longer read. Both are `_id`-only. `granot_record_links` keeps `granot_record_link_active_job_unique` (`provider, normalized_job_no`; unique; partial `state: "active"`; 477,920 reads), `granot_record_link_lead_state` and `granot_record_link_booking_state` (0 reads) ([`GranotRecordLink.ts`](../../../src/models/GranotRecordLink.ts)). `granot_lifecycle_health_state` is described in [observability](./observability.md).

### GCS obligations

Archive objects live under `history/granot/v1/vantagemovers/` in the private backup bucket. Every locator, catalog row and closed-run row names a hash and generation. Readers verify the checksum and identity before use. Bucket lifecycle deletes only objects with a release marker, 90 days after `customTime`. A publisher that reuses a generation under review or release first sets a temporary hold ([`archiveObjects.ts`](../../../src/services/granotHistory/archiveObjects.ts), over the [Cloud Storage module](../services/cloud-storage.md)). The reference set for any release is `archiveObjectReferenced` ([`archiveReferences.ts`](../../../src/services/granotHistory/archiveReferences.ts)). Releasing a generation follows the procedure at the top of this page.

### Observations for the index and read phase

- **Channel and operation ID lookup.** The production planner chose a collection scan for receipt lookup by channel and operation ID, in samples before and after the diagnostic index drop ([next-session record](../../operations/NEXT-SESSION.md)). Both remaining equality callers omit the partial filter predicate `channel_operation_id: {$type: "string"}`. MongoDB uses a partial index only when the query implies its filter. Confirm with `explain` before adding the predicate or a hint.
- **Declared indexes with no code read.** `granot_observation_normalized_phone_captured`, `granot_observation_normalized_form_ref_captured` and `granot_observation_source_route_captured` have no query in `src/` or `ops/`. Together they hold 116.42 MiB. `granot_observation_normalized_job_no_captured` (50.75 MiB) and `granot_observation_kind_captured` serve only operator verifiers and the pre-backfill fallback. `synchronization_decision_source_decided`, `granot_run_plan_identity`, `expires_at_1`, `lease_owner_1` and `granot_record_link_booking_state` recorded zero reads. No standalone query was found for the last three. `granot_run_retention_ttl` has no writer that sets a date, because new runs store `purge_at: null`.
- **Hot queries without a matching index.** The reference check in [`retentionReferences.ts`](../../../src/services/granotHistory/retentionReferences.ts) runs an `$or` of `$in` lists across Lead provenance paths in `call_leads`, Record Link `established_by_decision_id` and `last_observation_id`, case and discrepancy evidence paths, Pool work, Outreach subjects, `lead_messages` and `entity_changes`. Only `entity_changes.provenance.*` (production-only indexes, below), `granot_booking_reconciliation_cases.evidence.observation_id` and the partial `lead_messages` `observation_id` index cover a branch. The `lead_messages` index requires `$type: "objectId"`, and the check also passes string IDs. `form_leads` is read by `_id` only for the plainest chain: exactly one Decision, whose target is a Form Lead with a canonical lowercase 24-hex id. Every other chain keeps the six-path scan, restricted to its own IDs. That includes a chain with no Decision left (older `lead_created` Observations), several Decisions, an untargeted Decision, a Call target, or a target id in any other form. Every current Form writer is a command whose EntityChange cites the Observation, and `entity_changes.provenance.*` is checked for every chain. On November 20, 34 production batches of 192 hot Observations returned identical holds both ways: 5,819 references, none missing or extra. Of those 34 batches, 29 still needed the scan, mostly because of Call-target chains. Where the probe applies, it examined 2,818 documents in 11 ms; the scan examines all 9,049 in 164 ms. Each two-minute tick can run the reference check four times: twice in the receipt pass and twice in the Lead evidence pass. On `granot_automation_runs`, the claim sort `last_attempt_at, createdAt` and the freshness `slotKey` match have no matching index.
- **Production indexes not declared in code.** `entity_change_granot_observation_ref_v1`, `entity_change_granot_decision_ref_v1` and `entity_change_granot_receipt_ref_v1` (sparse, on `entity_changes.provenance.*`) were built on November 18. With all three, the reference probe examined 34 documents instead of 178,390 ([hot storage record](../../operations/GRANOT-HOT-STORAGE-2026-11-18.md)). No model or ops script declares them. The ops-installed retention, archive and window indexes also exist only after their scripts run.
- **Per-item `_id` reads.** `granot_observations._id` (568,230) and `granot_webhook_receipts._id` (477,221) are among the hottest reads, on collections of 6,000–13,000 documents.
- **Retention gaps.** Direct scheduled Observations and Decisions have no receipt. The Lead evidence pass skips rows without a receipt or locator, so no code path retires them. `granot_closed_automation_runs`, `granot_archived_receipts` and `granot_history_archive_chunks` have no expiry. Their daily growth is unmeasured.
- **Physical space.** The two largest Granot collections hold 1,634.9 MiB of reusable space after the November 18–19 removals. Reclaim needs a separately approved per-member `compact` ([baseline record](../../operations/INDEX-READ-BASELINE-2026-11-19.md)).
