# Ingestion and Sheet Sync capacity review

Review date: November 16, 2026, America/New_York. Status: **code and contract review; proposed changes only**. Production reads and storage totals are owned by the capacity mission's central evidence inventory. No production writes, tests, index changes, deletes or deployment were performed by this review.

The owner's goal is to stop avoidable daily MongoDB growth while keeping Leads, official financial outcomes and Reporting Sheets correct. This review identifies a secondary, indefinitely accumulating outbox history and several concrete write/read amplification paths. It does **not** establish that Sheet Sync is the dominant current disk producer; the measured Granot chain rate must remain the priority until the live inventory proves otherwise.

## Live evidence incorporated

The central read-only [inventory](evidence/inventory.json), captured November 16 at 8:13 p.m. New York (`2026-11-17T01:13:38.244Z`), confirms the following. MB below is decimal; allocated collection storage plus indexes is not the same as immediate reclaimable filesystem bytes.

| Collection | Documents | Allocated storage + indexes | Implication |
| --- | ---: | ---: | --- |
| `sheet_sync_jobs` | 163,408 | 28.66 MB | Indefinite history exists, but deleting all of it would be a small lever even if allowed. |
| `sheet_sync_attempts` | 457,136 | 51.29 MB | Live 90-day TTL is present. Most bytes are indexes (32.19 MB). |
| `sheet_sync_runs` | 107,523 | 12.52 MB | Live 90-day TTL is present. Empty-run frequency still needs measurement. |
| `domain_command_executions` | 167,128 | 62.18 MB | Durable replay authority; preserve. |
| `entity_changes` | 177,373 | 63.04 MB | Domain history; preserve. |
| `ingestion_runs` | 61 | 7.31 MB | Large individual snapshots, small overall footprint; not an urgent cleanup target. |
| `source_row_receipts` / `source_row_states` | 1,185 / 1,175 | 1.19 / 0.96 MB | Preserve final admission and reconciliation evidence. |
| `form_fill_work` | 0 | 0.11 MB | No backlog at the measurement instant. |
| `wordpress_form_submission_receipts` | 0 | 0.008 MB | Consistent with test-only writer; no current production growth. |

The jobs status/operation probe contains **163,401 synced, 3 cancelled and 4 pending**, with no processing/retrying/failed cohort at that instant. 144,265 of the synced jobs are `call_lead.update`; this is a historical inventory, not a measured daily no-op rate. The hard-kill/admin-retry findings below are **code-level recovery risks**, not an assertion that a production queue is presently stuck. Live job indexes match the four secondary schema indexes and include no unique active-coalescing constraint or TTL. Live quota/throttle TTL indexes also match their declarations.

Jobs, attempts and runs together occupy only **92.47 MB** of allocated storage/indexes in this snapshot. Even deleting all three would not offset one day at the brief's approximately 250 MB/day growth, and doing so would destroy useful/active evidence. Therefore prioritize the Granot producer/retention fix for storage cost; schedule Sheet correctness and efficiency improvements independently, and terminal Sheet history compaction later.

## Scope and source identity

Both `vantage-main-server` and the explicitly supplied `vantage-call-review` are checkouts of **the same** `jbell-rusty-vantage/vantage-movers-server` repository. Local `git worktree list`, remotes and HEADs were checked:

| Checkout | Revision inspected | Meaning |
| --- | --- | --- |
| `vantage-main-server` | `b926311ee9b8ceb16be57dad9435624f1ad8beac` (`agent/site-preview-api`) | Main code basis for findings below; not proof of production revision |
| `vantage-call-review` | `190be6fae483a6d5ffb1a48660fd539041916068` (`fix/pre-efficiency-call-review`) | Earlier review worktree; not a second deployed ingestion/Sheet Sync producer |

The main checkout includes subsequent guarded structural-delivery recovery changes absent from the supplied older worktree, including `drainer/deliveryRequests.ts`. Do not implement the capacity work by copying the older drainer over these changes. Deployment provenance remains a central mission check.

Contracts read first: `AGENTS.md`, `docs/index.md`, `docs/knowledge/services/{sheet-sync,google-sheets,ingestion,form-lead,call-lead,domain-commands}.md`, the worktree's `AGENTS.md`/`CONTEXT.md`, and Sheet Sync/documentation rules. The authoritative recovery handoff is `docs/efficiency/sheet-sync-recovery-handoff-2026-11-04.md`.

## What is already bounded or retired

1. **External Best Relocation recurring ingestion is retired**, rather than an active source of current daily import churn. `src/services/ingestion/worker.ts:4` returns `retired`; the Service records the completed exact-checksum final reconciliation and removed publisher/cron/trigger. Frozen plans, source receipts, protected admission and final-run evidence remain business evidence; their existence is not permission to import again or erase them. Keep Source Company active.
2. **Canonical semantic no-ops already skip aggregate changes and Sheet work.** `src/services/domainCommands/existingWrites.ts:256` collects field changes; the command contract omits Change/outbox/finalize when the diff is empty. Exact idempotent replay does not invoke the operation. A new no-op canonical command can still persist its command execution; that row is replay authority, not disposable logging (`idempotency.ts:151`, `models/DomainCommandExecution.ts`).
3. **WordPress submission receipt capture is test gated.** `src/services/leads/wordpressFormSubmissionReceipt.ts:55` requires WordPress origin, test mode and the permitted test database. Production Lead creation proceeds without these receipt writes. Do not attribute production growth to a similarly named model merely because it exists. Its explicit unique submission-key idempotency must survive any future production rollout.
4. **Form Fill continuation is bounded work.** `src/services/leads/drainFormFillWork.ts:14` processes at most 20 pages of 25 Calls per tick, commits effects/outbox/cursor together, deletes completed work, and rechecks generation on failure. `models/FormFillWork.ts` has one keyed task per scheduled entity and a due index. Never TTL unfinished tasks to make the count smaller.
5. **Embedded `sheet_sync` is a current-state map, not an append-only time series.** `models/schemaHelpers.ts` merges by target and removes deleted targets. It is rewritten frequently, but ordinary successful sync does not append a new historical entry forever.
6. Queued delivery already coalesces identical **physical** Google writes while preserving each logical job's retry outcomes. Destination delivery is confirmed before stale membership deletion; uncertain append/delete delivery stops further requests and is reconciled from fresh identity evidence on the next drain. Preserve this mechanism.

## Collection contract and proposed retention

The central inventory confirms the Sheet, Form Fill and throttle index declarations noted above. Recheck live definitions and eligibility at apply time; an index's presence alone does not prove healthy expiration or safe deletion.

| Collection | Present code | Proposed disposition |
| --- | --- | --- |
| `sheet_sync_jobs` | No TTL; 4 secondary indexes. Pending/retrying coalesce; processing never coalesces. Jobs survive success/cancellation indefinitely. | Separate live work from terminal delivery evidence. Introduce explicit `terminal_at`, versioned terminal summary/archive and `purge_at` only after eligibility is proved. Proposed initial hot horizon: 90 days after terminalization, not creation. No expiration for pending/retrying/processing/failed or unresolved tombstones. |
| `sheet_sync_attempts` | `createdAt` TTL 90 days; indexes by run/time, job/time, status/time (`models/SheetSyncAttempt.ts:45`). | Initially keep existing 90 days. Verify index and overdue row count. An unresolved incident may outlive attempts already; if business requires permanent incident evidence, pin/archive that detail before future expiration. Do not shorten blindly. |
| `sheet_sync_runs` | `started_at` TTL 90 days; run history indexes (`models/SheetSyncRun.ts:48`). | Keep 90 days initially. Avoid creating one record for every empty wake-up; aggregate empty drain heartbeat/counters separately. Preserve nonempty and failed runs. |
| `sheet_sync_quota_buckets` | Unique scope/class/minute; window TTL 1 hour (`models/SheetSyncQuotaBucket.ts:34`). | Keep. These documents bound provider concurrency; deleting current buckets could reset quota and exceed provider limits. |
| `sheet_sync_leases` | Small keyed ownership state with fencing (`drainer/leases.ts`). | Keep; no generic TTL/deletion of live ownership. |
| `form_fill_work` | Due index, keyed generation and cursor; successful task removed. | Keep until processed; alert on age. No TTL. |
| `public_submission_throttle_buckets` | Unique key/window; absolute `expires_at` TTL (`models/PublicSubmissionThrottleBucket.ts:21`). | Verify live TTL; retain policy. No deletion of current buckets. |
| `domain_command_executions` | Unique origin/idempotency and command ID; no TTL. | Keep replay authority. A later compact permanent result/tombstone design may remove redundant payload metadata only with unchanged conflict/replay behavior. No age-only purge. |
| `entity_changes` | Append-only domain audit and revision evidence. | Keep; do not confuse with worker attempts. Archive only through a separately specified history-read/replay contract. |
| `wordpress_form_submission_receipts` | Unique submission key; no TTL; production writer gated off. | No capacity action inferred. Verify actual live namespace before classifying. |
| `ingestion_runs`, conflicts and source-row receipts | Retired importer history; run has large mixed source/plan snapshots (`models/IngestionRun.ts:65`). | Measure largest documents and actual total size. Preserve approved final checksum/admission/replay evidence. Archival is optional lower-priority work if measurable; no blanket drop. |
| `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads` | Canonical business state, qualification, provenance and official outcomes. | No capacity purge. Optimize derivative work instead. |

### Immediate removal scope

The existing `ops/lib/disk-trim.ts:41` allowlist already supports Sheet attempts older than 90 days and runs older than 90 days. An immediate proposal can therefore count and remove only those expired diagnostic cohorts after confirming the approved retention/index policy, checking any incidents that require preserved detail, and recording before/after counts. If live TTL is healthy there may be almost nothing to reclaim. Do not promise space savings without the live inventory.

`sheet_sync_jobs` is explicitly protected in that older trim contract (`ops/lib/disk-trim.ts:100`). Completed jobs are **not** an immediate deletion candidate under that contract. They are read by Owner Job Timeline (`jobNumberTimeline/mongo-evidence-loader.ts:541`), Admin job history and live sheet membership diagnosis. Removing them changes the evidence returned to the owner. A new terminal-history policy/read path must precede deletion. In particular, never delete failed/retrying/processing rows, delete tombstones whose delivery is not proved, or cancelled rows merely because the status sounds terminal.

## Concrete server behavior findings

### S1 — Coalescing is not enforced under concurrent first insert

`sheetSyncOutbox.service.ts:93` uses `findOneAndUpdate` with an upsert on coalescing key and pending/retrying status. `models/SheetSyncJob.ts:92` declares a **nonunique** compound index. Two concurrent callers finding no active row can insert separate active jobs. The drainer explicitly tolerates duplicate keys and fans outcomes back; this avoids losing logical work but increases claims, plans, attempts and finalization writes.

Specification: enforce at most one coalescible job per key while allowing a processing job plus a newer pending job. Prefer a single partial unique index on the key covering the coalescible-state predicate, after validating the exact MongoDB-supported expression and existing duplicates on the replica. An equivalent explicit active-key field is acceptable if all status transitions set/unset it atomically. Do **not** use a unique key across all historical rows, or unique `(key,status)` that still permits one pending and one retrying for the same key. Requeue/defer transitions need a defined merge path when a newer pending job exists; keep retry hints and tombstone intent. A duplicate-key transaction failure must retry the containing canonical transaction, not retry illegally inside an aborted transaction.

Acceptance: simultaneous first inserts, update during processing, processing failure while a newer pending job exists, tombstone supersession, two resource keys for the same entity, transaction rollback, and retry replay. Retire existing duplicates only through a proved merge, not a bulk status reset. Live duplicate frequency is unmeasured.

### S2 — Google write coalescing still leaves repeated Mongo metadata writes

`runSheetSyncDrain.ts:164` plans every logical job; `persistDocSheetSync` at line 409 groups outcomes by `docKey` but still loops **every** `plannedDocs` entry. When a source-lead job and booking-chain job include the same Lead, both entries write the same merged `sheet_sync` metadata through `updateOne` at line 478. Fresh `last_synced_at` values further ensure repeated writes. This is a concrete path to redundant Lead updates and oplog traffic even though Google receives one physical write.

Specification: reduce to one metadata persistence operation per distinct document after collecting all logical outcomes, preserving the failure fan-out to all subscribers. Reconcile entries against a single canonical current snapshot, refuse contradictory target outcomes and retain unaffected targets. Preserve separate per-job attempts/statuses; duplicate physical work must not mark an unrelated failed logical job synced. Batch independent metadata writes only after the single-document behavior is qualified. Do not suppress the real last-success timestamp globally.

Acceptance: overlapping source/booking/cancellation jobs produce exactly one metadata write per distinct document; partial destination failure retains stale membership; metadata failure makes every affected success retryable; concurrent domain correction is not overwritten; lease loss stops later writes.

### S3 — A hard-killed drain can leave permanent processing work

`claimDueJobs` at `runSheetSyncDrain.ts:354` selects only pending/retrying. It excludes expired processing rows. The normal error handler releases the current run's claims (`releaseClaimedJobsForRun`, line 648), but cannot execute after process death/hard timeout. No separate production expired-processing reclamation was found in `src/` or `api/`. The model's leased-until index comment mentions reclamation, but a comment is not an implemented recovery path.

This is a correctness prerequisite to history compaction: stale processing rows must remain visible and recoverable, not be classified as junk. Production prevalence is unverified.

Specification: after acquiring the global drain lease, reclaim a bounded set of expired processing claims using compare-and-set on prior run/owner/expiry; account for any still in-flight provider request. Replan from current Mongo and fresh Sheet identity; never repeat a saved positional deletion. Preserve retry hints, tombstones and history, and expose a recovered count. The lease only stops new requests from the old worker; it cannot cancel an already-sent Google request. Reuse the existing uncertain-delivery contract and establish a safe handoff/quiescence rule before reclaim.

Related defect: `adminSheetSync.service.ts:126` filters explicit `job_ids` without a terminal-status constraint and line 140 updates selected IDs without rechecking status. This permits resetting a processing job despite the method comment promising failed/cancelled-only retries. Restrict selection **and mutation** to allowed terminal statuses and compare state/version; never use this path as a processing-recovery shortcut.

Acceptance: kill after claim, after Google append commit with lost response, after metadata persist and before finalization; expire ownership and resume once without duplicate row or wrong delete. Race admin retry against normal worker transition and prove live claims are untouched.

### S4 — Wake-up and empty-run write amplification

`sheetSyncCoordinator.ts:141` publishes on each finalize; the publisher supports an optional idempotency key (`sheetSyncQueue.service.ts:29`), but coordinator calls do not supply it. `runSheetSyncDrain.ts:77` creates a run after acquiring the global lease and **before** proving there is due work. A queue wake-up can arrive during the 3-second debounce, create/finish an empty run and leave work for a later wake-up/cron. Repeated coalesced mutations can therefore create extra provider queue invocations, lease writes and run records.

Specification: measure empty runs first; if material, collapse wake-ups within a bounded due window and schedule them for actual eligibility where supported. Treat the queue as a wake-up, retaining transactional Mongo intent and cron safety net. Under global ownership, perform the due-work check before persistent run creation; emit empty-check telemetry to a bounded counter/heartbeat rather than a new row. Any pending work arriving after the check must still be recovered within the declared delivery SLO. Do not add a Mongo write per wake-up merely to save one empty-run write.

Acceptance: burst writes, queue loss, early arrival, delayed due time, zero jobs, and job arrival immediately after empty check; no work lost and maximum delay documented.

### S5 — Read/index mismatches and history growth

* Due-job query filters `due_at <= now` then sorts priority/creation (`runSheetSyncDrain.ts:354`); the declared compound index puts due time before priority. It may bound due work but cannot generally supply that trailing sort across a due-time range. Benchmark query planner/execution statistics on representative due/backlog distributions. Compare a partial active-work index with priority/creation before due time versus the current index; do not buy another index without showing lower reads/latency and acceptable write cost.
* Lease renew/release queries filter run/owner/status/expiry (`runSheetSyncDrain.ts:394`, `:648`), with no matching run-first job index declared. Measure keys/documents examined during a nontrivial drain before adding one; the status index might be adequate when active work is tiny.
* Job Timeline filters only `entity_id` (`jobNumberTimeline/mongo-evidence-loader.ts:541`) while the per-entity index starts with `entity_model` (`models/SheetSyncJob.ts:96`). Admin filtering can do the same. Prefer rewriting known model/ID queries into model-scoped branches to reuse the existing index, then confirm explain. Add an entity-first replacement only if the broader query workload justifies it.
* Admin health groups **all** historical jobs on every call (`adminSheetSync.service.ts:27`). Requesting active backlog should not require rescanning years of synced history. Restrict operational health to active statuses, obtain historical totals from versioned bounded summaries, and separate hot-job pagination from archived history. Avoid a high-contention global counter update per job unless measurement justifies it.
* Owner Job Timeline has no default row/time limit; optional bounds apply only when supplied (`mongo-evidence-loader.ts:38`). A long-lived job can load unbounded sheet/audit history. Introduce explicit paginated history/coverage semantics, not silent truncation that reads as “nothing happened.” Keep canonical history consumers honest about archive failures and omitted evidence.
* `tabRowMap.ts:32` reads `A:ZZ` to prove identity from the actual header. This saves requests compared with one scan per Lead but transfers all those cells per tab batch. If bandwidth becomes material, compare a guarded header+identity-column strategy; it adds requests and must not regress shifted identity columns, malformed header rejection or uncertain-delivery safety. Lower priority than Mongo chain growth.

### S6 — Form matching can use normalized fields and smaller reads

`duplicateLead.service.ts:111` reads all matching hydrated Form documents, sorted by timestamp, to collect matched IDs and classify email/phone matches. Phone matching uses a compatibility regex even though normalized phone fields/indexes exist (`models/FormLead.ts:137`, `:178`). `hasFormFillForCallLead` at line 191 pages 100 documents but still hydrates full Leads. The bounded Call update path correctly limits work to 25 and changes only unmarked eligible Calls.

Specification: project only IDs and comparison fields for read-only matching; use `.lean()` where mutation is unnecessary. Use canonical normalized phone equality on normalized records with an explicit legacy-missing-field fallback, retaining exact Source Granularity/cohort and canonical-company fallback rules. Do not cap away a true match or silently change the returned matched-ID evidence. For large duplicate matches, specify whether the API needs complete IDs; if so, stream/project rather than loading full documents. Measure normalization coverage before choosing migration/index work. No new Call qualification, contact-based Call creation, or changes to official Booking/Cancellation reporting are permitted.

## Terminal Sheet history compaction specification

1. Define a versioned terminal summary containing original job identity, resource/entity, operation, created/terminal clocks, terminal disposition, last successful target identities, tombstone completion and evidence coverage. Keep the original job ID available to Timeline and incident links.
2. Eligibility is state based: successful terminal work with no active lease, no unresolved target, no unresolved external-delivery uncertainty and no incident/legal hold. Cancelled work must additionally prove the superseding tombstone or replacement intent is durable and terminal. Failed jobs remain actionable until explicit resolution; they are not eligible merely by age.
3. Publish immutable checksummed archive/summary before setting `purge_at`. Verify readback, exact counts, representative restoration and Timeline parity. An archive failure pins hot evidence. Reader returns unavailable/archived coverage explicitly, never “never synced.”
4. Start with 90 terminal days hot, matching current attempts/runs. Use sparse absolute `purge_at` TTL only after a guarded eligibility worker stamps it; policy/config belongs in Mongo, with version/audit and rollback. Avoid TTL on `createdAt` for work because an old job can still be active or newly resolved.
5. Backfill in ID-bounded batches with fresh state recheck and an apply manifest; count candidate logical bytes and physical allocation separately. Throttle deletes so retention itself does not saturate replication/oplog. A TTL index is asynchronous, not a controlled purge-speed mechanism; stamp gradually.
6. Rollback pauses eligibility stamping and archive publication. It does not undo deletion. Keep immutable archive/object versions, retain lookup manifests and provide verified restore tooling before first purge. Never rehydrate completed work as pending or resend a historical delete.

This design should follow the main Granot retention work rather than compete with it: Sheet history savings are currently unquantified and its delivery correctness is more valuable than a speculative quick purge.

## Implementation order and qualification

| Stage | Deliverable | Required evidence before proceeding |
| --- | --- | --- |
| 0 | Central live inventory + deployed revision/mode | Collection bytes/indexes, status/age/operation cohorts, empty-run rate, stale claims, protected outcome counts |
| 1 | Safe behavior fixes S2/S3 and admin retry guards | Local replica and stateful Google fake fault tests; unchanged reporting membership and logical job outcomes |
| 2 | S1 concurrent coalescing and S4 wake-up/empty-run changes | Contention tests, active-key transition proof, no lost intents, delivery latency compared to baseline |
| 3 | Targeted S5/S6 query improvements | Before/after explain and read counts on a representative replica; one useful index replaces rather than accumulates where possible |
| 4 | Terminal-history read/archive contract and dry-run eligibility | Owner-approved retention policy, archive restore and Timeline parity, zero active/uncertain rows eligible |
| 5 | Canary release, then bounded terminal-history purge | Measured writes per useful Sheet delivery, backlog/delivery SLO, protected record reconciliation, archive verification and delete throttle |

Use the current main-server checkout/appropriate integration branch; do not push during planning. Rehearse database writes only on the designated local replica with production destinations disabled. Keep uncertain-delivery recovery fixtures; required scenarios include late/lost responses, shifted headers, duplicates, destination-before-delete, partial failures, replay, concurrent correction and lease loss. Run relevant existing tests when implementing; this review has not run them and makes no new qualification claim.

Success is **less Mongo write and index/oplog work per useful, confirmed reporting change**, with unchanged official outcome counts, preserved Call admission and no worse unresolved-delivery age. Report the actual job/attempt/metadata operation reduction and measured bytes; do not convert model-level savings into guaranteed Atlas bill reduction.

## Measurements requested from central inventory

Use existing indexes, bounded windows and `maxTimeMS`; keep PII and payloads out of report artifacts:

* Collection `count`, logical bytes, allocated/compressed bytes, free reusable bytes, index bytes and live index definitions for every collection in the table.
* `sheet_sync_jobs`: status counts/oldest ages; top operations/resources; successful terminal age cohorts; pending/retrying duplicate coalescing keys; expired processing count; tombstone counts by status. No deletion based only on this report.
* Seven complete New York days of jobs/attempts/runs inserted, nonempty/empty runs, successful jobs per nonempty run and failed/deferred rate. Match the date field to actual available indexes; do not run an unbounded collection scan merely to build a pretty daily chart.
* Live mode and deployed server revision; declared queued code alone does not prove production queued behavior.
* Bounded explain for due-claim, run-lease renewal, entity history and Form phone-match query shapes. Live profiler/slow-query evidence is preferable to enabling a new intrusive profiling regime.
* Sizes of retired ingestion snapshots and final source evidence; identify source systems before proposing archive/drop.

Remaining unknowns: daily production growth and operation distribution, current deployed mode/revision, production concurrency duplicate rate, stale-processing prevalence across time (zero at this snapshot), overdue TTL eligibility, historical owner retention expectation for Sheet delivery, and measured latency/write cost of each proposed optimization.
