---
type: Service
title: "Sheet Sync (`sheetSync/`)"
description: Write-behind outbox, queue wake-up, drainer, and sheet-sync modes.
tags: [sheet-sync, outbox]
status: draft
stale_after: 2026-12-19
resource: src/services/sheetSync/sheetSyncCoordinator.ts
applies_to:
  - src/services/sheetSync/sheetSyncCoordinator.ts
  - src/services/sheetSync/sheetSyncOutbox.service.ts
  - src/services/sheetSync/sheetSyncQueue.service.ts
  - src/services/sheetSync/drainer/runSheetSyncDrain.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
  - src/services/sheetSync/drainer/batchWriter.ts
  - src/services/sheetSync/drainer/deliveryRequests.ts
  - src/services/sheetSync/drainer/tabRowMap.ts
  - src/services/sheetSync/drainer/leases.ts
  - src/services/sheetSync/drainer/quotaLimiter.ts
  - src/models/SheetSyncJob.ts
  - src/models/SheetSyncRun.ts
  - src/models/SheetSyncAttempt.ts
  - src/models/SheetSyncLease.ts
  - src/models/SheetSyncQuotaBucket.ts
  - src/services/sheetSync/noSyncLead.ts
  - src/services/sheetSync/writerFence.ts
  - src/config/domain/sheetSync.ts
  - src/routes/sheet-sync-cron.routes.ts
  - api/queues/sheet-sync-consumer.ts
  - src/services/admin/adminSheetSync.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/sheetSync/sheetSyncCoordinator.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
  - id: release-2026-11-19
    resource: docs/operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md
    title: Daily commands and Master Sheets release record
generated:
  by: process:docs-keeper
  at: 2026-11-19T23:30:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/sheetSync/`  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Cancellation Chain](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md)

# Sheet Sync (`sheetSync/`)

**Role:** Mode-aware scheduling layer between Mongo domain writes and **Reporting Sheets**. **System of Record** is MongoDB; **Sheet Sync** writes **Master Sheets** only — **Source Company Sheets** derive via import queries unless `WRITE_SOURCE_LEAD_SHEETS` is the literal `"true"`. Sheets update *after* API responses; a successful response does not mean sheets are updated yet.

**Stack:** Domain services persist intent → optional Vercel Queue wake-up → drainer → `googleSheets/` writes. Legacy mode skips the outbox and runs sync inline via `waitUntil`.

**Best Relocation final reconciliation is complete:** the exact-checksum Owner-return run applied the approved exception cohort and verified official Bookings. Recurring ingestion and Granot creation remain retired. This recovery work does not authorize another import. Keep the Source Company active; the Owner deactivates it separately. See the [final reconciliation](../../lead-reporting-retirement/FINAL-RECONCILIATION-2026-11-03.md).

**Public barrel:** `src/services/sheetSync/index.ts` re-exports coordinator, outbox, queue, drainer, persistence, and source-lookup helpers.

**HTTP / queue entry**

| Path | Caller |
|------|--------|
| `GET/ALL /api/cron/sheet-sync-drain` | Every 5 minutes (`vercel.json`). Runs `drainFormFillWork()` first, then `runSheetSyncDrain("cron")`. Bearer or `x-cron-secret` = `CRON_SECRET`; no-op unless `SHEET_SYNC_MODE=queued` |
| `api/queues/sheet-sync-consumer.ts` | `runSheetSyncDrain("queue")` — dedicated function; payload ignored |
| `GET /api/v1/admin/sheet-sync/{health,jobs,runs,runs/:id}` | read-only admin |
| `POST /api/v1/admin/sheet-sync/retry` | `retrySheetSyncJobs` then `runSheetSyncDrain("admin")` via `waitUntil` |
| `POST /api/v1/admin/sheet-sync/contains` | Owner-only live Master Sheet membership check (`checkSheetContains`). Read only; does not enqueue or drain. |

## Execution modes (`SHEET_SYNC_MODE`)

| Mode | Default? | Domain write | Sheet execution |
|------|----------|--------------|-----------------|
| `legacy` | yes (unknown values fall back here) | No outbox from `persistSheetSyncIntent` | `finalizeSheetSync` → `waitUntil(runFullSheetSyncProcess)` |
| `queued` | opt-in | Outbox row in the same Mongo txn | Wake-up or cron → `runSheetSyncDrain` |
| `disabled` | — | `persistSheetSyncIntent` no-op | `finalizeSheetSync` logs only |

Config lives in `src/config/domain/sheetSync.ts` (priorities, guardrails, queue topic, coalescing keys). Runtime override: `getRuntimeDomainOverrides().sheetSyncMode`.

`runSheetSyncWrite(fn)` opens a Mongo transaction when `queued` or `forceTransaction` is true; otherwise it connects and calls `fn(undefined)`. Keep Google Sheets, queue publish, CRM, and email **outside** the callback.

## End-to-end flow (queued mode)

```
Domain service / canonical adapter
  │
  ├─ persistSheetSyncIntent(job, session)   ← enqueueSheetSyncJob (queued only)
  ├─ commit
  └─ finalizeSheetSync(job)                 ← publish wake-up (queued) or legacy waitUntil

Vercel Queue topic (live hosted function only)
  └─ api/queues/sheet-sync-consumer.ts → runSheetSyncDrain("queue")

Cron safety net (every 5 min, queued only)
  └─ /api/cron/sheet-sync-drain → runSheetSyncDrain("cron")

Admin retry
  └─ re-queue terminal jobs → runSheetSyncDrain("admin")  (does not publish a wake-up)
```

The queue message is only a wake-up (`kind: "sheet_sync_wakeup"`). Payload is ignored. Mongo owns due time, coalescing, priority, leases, and Google quota.

## Coordinator (`sheetSyncCoordinator.ts`)

| Export | When to use |
|--------|-------------|
| `runSheetSyncWrite(fn)` | Public/legacy services that still own their own txn |
| `persistSheetSyncIntent(job, session)` | Inside txn: write outbox row (**queued only**; no-op in legacy/disabled) |
| `finalizeSheetSync(job)` | After commit: publish wake-up (queued) or `scheduleFullSheetSyncProcess` (legacy) |
| `finalizeSheetSyncDelete()` | After delete txn commits in **queued** only; legacy/disabled delete sheets inline |
| `scheduleFullSheetSyncProcess(job)` | Unmigrated callers: queued → `waitUntil(enqueueAndPublish)` (outbox + wake-up, not inside the domain txn); legacy → `waitUntil(runFullSheetSyncProcess)` |
| `scheduleCallLeadSheetSync` / `scheduleBookingChainSheetSync` / `scheduleBookedLeadSheetSync` | Thin wrappers around `scheduleFullSheetSyncProcess` |
| `runFullSheetSyncProcess(job)` | Synchronous legacy execution (tests, scripts) |

**Canonical commands:** The executor owns the Mongo transaction and `DomainCommandExecution`. Adapters persist Sheet Sync intent (or a tombstone) inside `*InTransaction` helpers / `persistSheetSyncIntent`, then call `finalizeSheetSync` / `finalizeSheetSyncDelete` only after a successful non-replay commit. A no-op or replay writes no outbox row and does not finalize. See [`domain-commands.md`](./domain-commands.md).

**Gap (labeled):** Granot lifecycle commands (`createLeadFromGranot`, `synchronizeLeadFromGranot`, `callLeadFormSibling`) and `leads/receiverAgentWrite.ts` call `enqueueSheetSyncJob` inside their transaction with no mode check. In `legacy` or `disabled` mode their outbox rows wait for a queued drain. Booking and Cancellation delete paths call it inside their own queued-mode branches.

## Job shapes (`sheetSyncJobs.ts`)

`FullSheetSyncJob` is the in-memory scheduler shape:

| `resource` | Entity id field | Typical `operation` examples |
|------------|-----------------|------------------------------|
| `source_lead` | `leadId` + `leadModel` (`FormLead` / `CallLead`) | `form_lead.create`, `call_lead.update`, `call_lead.enrichment.sync` |
| `booked_lead` | `bookingId` | `referral_booking.create`, `leadless_booking.create` |
| `booking_chain` | `bookingId` | `booking_chain.create`, `booked_lead.update` |
| `cancellation_chain` | `cancellationId` | `cancellation.create` |

Delete tombstones use `delete_source_lead` / `delete_booked_lead` / `delete_cancelled_lead` via `enqueueSheetSyncTombstone`, not `FullSheetSyncJob`.

**Priority** (higher drains first): delete `100` > booking chain `80` > cancellation chain `70` > booked lead `65` > source create (`operation` contains `"create"`) `60` > source update `50`.

## Outbox (`sheetSyncOutbox.service.ts`)

Writes durable intent to `sheet_sync_jobs`.

### Upsert (`enqueueSheetSyncJob`)

1. Maps `FullSheetSyncJob` → `{ resource, entityModel, entityId }`.
2. `buildCoalescingKey` collapses repeated work for the same entity.
3. `findOneAndUpdate` on `{ coalescing_key, status ∈ [pending, retrying] }`:
   - `$min due_at` — pulls earlier, never later (debounce default 3s).
   - `$max priority` — highest wins.
   - `$set` refreshes `operation` and sets `target_hints: []` on every coalesce.
   - Upserts if no active row exists. `coalescing_key` is not unique, so the filter, not an index constraint, keeps one active row per key.

**Coalesce rule:** Only `pending` and `retrying`. Never coalesce onto `processing` — a write during drain creates a fresh `pending` job so the drainer reloads latest Mongo (at most one extra idempotent sync).

### Tombstone (`enqueueSheetSyncTombstone`)

1. `buildTombstonePreviousTargets(sheet_sync[])` snapshots known sheet rows.
2. Cancels pending/retrying **matching upsert** (`superseded_by_delete_tombstone`).
3. Enqueues delete job with `due_at = now` (no debounce).

Supersede keys (not “any job for the same Mongo id”):

| Tombstone | Cancels coalescing key |
|-----------|------------------------|
| `delete_source_lead` | `source_lead:{entityModel}:{entityId}` |
| `delete_booked_lead` | `booked_lead:{entityId}` only — **does not** cancel `booking_chain:{id}` |
| `delete_cancelled_lead` | `cancellation_chain:{entityId}` |

## Queue publisher (`sheetSyncQueue.service.ts`)

`publishSheetSyncWakeup({ reason, idempotencyKey?, runHint? })`:

- Topic: prod `sheet-sync-events`, else `sheet-sync-events-dev` (`SHEET_SYNC_QUEUE_TOPIC` override).
- **Publishes only** when `shouldPublishSheetSyncQueue()` is true: not a Vantage test runner, hosted function runtime (`VERCEL=1` **and** `VERCEL_REGION`), **and** non-preview `VERCEL_ENV` (`shouldPublishSheetSyncQueue`). Preview/local/tests never publish. `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` does **not** enable publish.
- **Never throws** — failed publish is logged as `sheet_sync.queue.publish_failed`; domain write already committed.

Reasons: `domain_write`, `domain_delete`, `cron`, `admin_retry`, `manual`. Admin retry does not use this path.

## Drainer (`drainer/runSheetSyncDrain.ts`)

`runSheetSyncDrain(trigger, options?)` — queue, cron, and admin retry all enter here.

1. **Check topology fence** `lead-reporting:tab-migration`; return `skipped: true` before acquiring/claiming anything while held. **Acquire** global lease `sheet-sync:drain`; skip (`skipped: true`) if another drain holds it.
2. **Create** `SheetSyncRun` (`running`). Heartbeat (every lease duration / 3, default 40 s) renews the drain lease and claimed job leases; lease loss throws. A run that claimed at least one job records `deployment_commit` on its final update.
3. **Claim** due jobs. Discovery returns only IDs of `pending`/`retrying` jobs due by the selection time with absent or expired leases, up to `maxJobsPerDrain` (default 500), in descending priority and ascending creation order. Each atomic claim rechecks status and job lease by ID and returns the full current document for planning. A lost claim contributes no work to this run. [Measured discovery and delivery costs](../../efficiency/sheet-discovery-2026-11-17.md).
4. **Plan** each logical job via `jobPlanner.ts` — reload current Mongo (or tombstone), preserving its retry hints/targets even when claimed keys overlap. Physical writes are coalesced after planning; no subscriber is marked synced merely because a representative was processed.
5. **Recheck topology fence**, then **batch write** destinations before stale deletes via `batchWriter.ts` + `QuotaLimiter`. Failed/deferred destination upserts prevent stale deletes. Identical per-ID writes from overlapping jobs are coalesced without losing per-job outcomes; conflicting payloads fail. Duplicate physical IDs are repaired and logged.
6. **Persist** `sheet_sync[]` with one direct `updateOne` per surviving physical document (must not abort the run). Overlapping plans contribute all outcomes; the final surviving snapshot and final-document order determine the combined metadata write. Metadata persist failure flips every confirmed subscriber outcome for that document to `failed`, while existing failed/deferred outcomes remain unchanged. [Local command-cost and recovery proof](../../efficiency/sheet-metadata-2026-11-17.md).
7. **Finalize** jobs: empty plan (doc gone / unmatched skip) → `synced`; all writes ok → `synced`. A `synced` job unsets `leased_until`; deferred, failed and released jobs set it to the epoch (`new Date(0)`). Any `failed` → `retrying` with exponential backoff (30s × 2^(attempts-1), cap 15 min) until `maxAttempts` (8) then `failed`; unconfirmed structural delivery, quota or request-guard `deferred` → `retrying` in 60s **without** burning an attempt. `target_hints` = failed/deferred targets only. Attempts are one unordered `insertMany` per drain and retain per-job/target `action`, `status`, `row_number` and `error`; the drainer writes no `google_*` fields. An attempt insert failure is logged and does not fail the run; duplicate claimed keys keep representative-only Daily Operations emission within that drain, and completion facts remain deduped by job ID.
8. Run timeout releases **unplanned** remaining claims back to `pending`. Run-level exception releases that run's still-`processing` jobs to `retrying` and logs `sheet_sync.drain.failed`.

Planner skip/fail paths (also true on the legacy `syncSourceLead` path):

- Ordinary `no_sync` suppresses upserts. Ordinary Forms clean all three Form destinations and old/new Form titles; ordinary Calls clean all three Call destinations. Effective duplicate/bad Call exceptions and canonical/trusted imported bad Forms still project. Official Booking/Cancellation chain rows retain their own writes.
- Unmatched Calls and Calls lacking either saved RingCentral qualification or protected final Best Relocation admission produce no sheet upsert, including through the direct facade. `getCallLeadReportingDecision` owns admission-aware disposition across planner, legacy, contains and retries. Syncing an excluded Call does not itself remove a preexisting row; an explicit delete/reprojection repair owns that cleanup.
- Forms with canonical `bad_lead` or a fully trusted `external_sheet_review.kind === "bad_form"` write **Bad Form Leads only**. Bad projection wins over duplicate routing without changing canonical duplicate, Booking or Cancellation facts. `formLeadTargets` selects the destination; `staleFormTargets`/`staleFormTargetKeys` plan cleanup of Forms and both old/new Duplicate Forms titles by Mongo ID, even with empty metadata. The batch writer confirms the bad destination before any stale delete, so interrupted delivery remains pending and replay repairs it. Clearing the bad fact restores the ordinary primary destination and deletes both old/new bad-Form titles. Other Forms retain their ordinary Forms/Duplicate Forms routing.
- Calls upsert exactly one of Calls / Duplicate Calls / Bad Call Leads, then delete the same Mongo ID from the other two tabs. Form Fill and trusted duplicate review are reporting duplicates without rewriting `duplicate`. Duplicate disposition takes precedence over bad. All Call tabs retain the same headers/projection.
- Form and Call retries always replan the current destination and required cleanup; old `target_hints` cannot delete the new desired row or skip an updated destination. Tombstones enumerate all possible Lead targets and historical locations, including old/new Form titles. Unknown target headers are dropped; source-lead tombstones are not restricted by old target hints.
- A missing Lead produces an empty plan, so an older upsert completes with zero writes; its tombstone owns row removal. Missing Booking/Cancellation documents also produce an empty plan. Official outcomes remain reportable when their Lead becomes nonbillable.

## Uncertain structural delivery (queued only)

`deliveryRequests.ts` wraps every Sheets request used by queued delivery, including header/tab helpers. Each request reserves quota and checks the deadline, current drain lease and topology fence before sending; safe explicit read/update retries re-enter those checks. Google transport retries are disabled through both `retry` and `retryConfig`. Legacy/direct callers keep their existing retry behavior.

Each append, positional delete or in-place managed-value clear has one provider attempt for its current plan. A missing/malformed append range, backend error, lost response or unconfirmed delete stops **all further provider requests in that writer invocation**. Affected writes become deferred, old row maps are abandoned, unconfirmed upsert metadata row hints are cleared, and stale membership cannot be deleted on the strength of an uncertain destination. Confirmed earlier outcomes remain accounted for. Explicit HTTP 400/401/403/404/429 rejections use ordinary failed-attempt handling and are never reissued inline; structural uncertainty does not burn an attempt.

The existing next queue/cron/admin drain reloads current Mongo plans and fresh per-tab identity evidence. An existing destination is updated rather than appended again; an ID reliably absent from the current map is an idempotent delete success. Reads require exactly one actual `Mongo ID` header; missing/ambiguous headers, malformed topology/row responses and failed reads never prove absence.

`tabRowMap.ts` reads the header row and the expected `Mongo ID` column in one guarded `values.batchGet`. A shifted identity column needs a second read that revalidates the header. Shifted legacy identity lookup remains supported for deletes. Upserts compare the full managed header prefix, including with a warm header cache. A matching prefix skips the header clear and rewrite (`headers_current`). Any mismatch refuses the upsert for operator correction (`sheet_identity_header_rewrite_unsafe` or `sheet_identity_projection_layout_unsafe`). Only a confirmed newly created empty tab initializes its header. The identity read made during a cold header check is reused for the row map. Updates write `A` through the last managed column only. Because updates are positional, each update chunk first rereads the identity column; a write whose Mongo ID is no longer on its mapped row fails with `sheet_update_identity_changed` (fencing that Lead's stale deletes) instead of overwriting another Lead's row, and the retry replans from fresh identities.

### Row removal and operator cells

Before removing a physical row, the writer rereads each row in the chunk with one `spreadsheets.get` for its identity, notes, rich text, validation, formulas and protected ranges. A changed identity fails with `sheet_delete_identity_changed`. A protected row fails with `sheet_delete_protected_row` and needs operator resolution before the intent can complete. Plain rows are deleted in descending order. A row with operator values, notes, formulas or validation stays in place: the writer clears the reporting `Mongo ID` and eligible managed values with `repeatCell` and keeps operator-owned cells and annotated managed cells. An ID absent from the identity map costs no row inspection.

Duplicate-row repair uses the same guarded single-attempt removals. No new scheduler is introduced. Google success followed by Mongo metadata failure keeps the jobs retryable; fresh identity reads recover both append and stale-delete effects without repeating a positional delete.

Automatic recovery runs on the existing drain schedule after due time and while ownership, quota and topology permit. Invalid headers/topology or exhausted ordinary failures need operator correction and the existing Admin retry; never reset processing jobs or delete historical rows as a shortcut. Lease/fence checks cannot cancel an already in-flight request or promise exactly-once network delivery. Operators must still acquire both leases and wait out older writers before topology changes. Rollback uses the previous application revision, retains outbox/attempt/metadata evidence, and reintroduces the unsafe structural retry behavior; it is not a reason to clear pending work. [Qualification and release handoff](../../efficiency/sheet-sync-recovery-handoff-2026-11-04.md).

The [local Sheet Sync trace](../../operations/sheet-sync.md#stalled-retrying-or-uncertain-work) joins one job to bounded attempt and run history. It classifies the stored deferred-attempt reason inside Mongo and separately samples the two named leases and current user quota window. The trace cannot establish Google membership, the effective worker budget, or scheduler execution.

## Temporary topology writer fence

`writerFence.ts` reads the durable `SheetSyncLease` scope `lead-reporting:tab-migration` on each write boundary. A future `leased_until` blocks legacy/direct Form/Call upserts, deletes and provisioning before any Google write with retryable `lead_sheet_tab_migration_in_progress`; a failed lookup also fails closed. No permanent flag is added. Direct Booked/Cancelled targets do not depend on this lead-topology lease.

A queued drain checks before claiming and rechecks immediately before batch delivery. A held lease at entry leaves every outbox row untouched. A fence acquired while planning releases claims to retrying without incrementing attempts; work resumes after release/expiry using current Mongo. Domain transactions continue persisting outbox intent while delivery is fenced.

The operator must deploy compatible writers, acquire both the topology fence and existing `sheet-sync:drain` lease, renew them, and wait for older invocations to finish before physical renames or derivative formula updates. Migration uses explicit operator Google APIs, not a bypass in the facade. Clear title/header caches, verify renamed numeric IDs, headers, derivative formulas and live membership, then release leases. A lease check does not cancel a Google request already in flight. Legacy Form aliases are never cached: warm isolates re-resolve them after the numeric-ID rename. See [Google Sheets](./google-sheets.md) for compatibility mapping and the checksummed idempotent migration helper.

## Domain service integration

Standard public write (form/call/booking/cancel `*InTransaction` helpers persist intent themselves):

```ts
const outcome = await runSheetSyncWrite(async (session) => {
  // mutate Mongo; persistSheetSyncIntent(job, session) inside *InTransaction
  return { doc, job };
});
await finalizeSheetSync(outcome.job);
```

Delete: tombstone **before** hard Mongo delete, then `finalizeSheetSyncDelete()` after commit (queued). Legacy delete calls `delete*FromSheets` inline.

| Caller | Jobs |
|--------|------|
| `formLead.service.ts` / `callLead.service.ts` | `source_lead`; tombstone on delete |
| `bookedLead.service.ts` | `booking_chain` or `booked_lead`; tombstone on delete |
| `referralBooking.service.ts` / `leadlessBooking.service.ts` | `booked_lead` |
| `cancelledLead.service.ts` | `cancellation_chain`; tombstone on delete |
| `callLeadEnrichment.service.ts` | `call_lead.enrichment.sync` via persist + finalize |
| `employeeBookings/` | persist + finalize on submit / rematch / attach |
| Canonical adapters | persist inside `*InTransaction`; finalize after non-replay commit |

## Admin retry (`adminSheetSync.service.ts`)

- `getSheetSyncHealth` — mode, counts by status, backlog age (`pending`+`retrying`), last run.
- `listSheetSyncJobs` / `listSheetSyncRuns` / `getSheetSyncRunDetail`.
- `retrySheetSyncJobs` — default filter is **`failed` only**. Optional `statuses` (may include `cancelled`) or explicit `job_ids` (any status). Sets `pending`, `due_at=now`, `attempts=0`, `created_by=admin`, clears lease/`last_error`. Then starts `runSheetSyncDrain("admin")` via `waitUntil`. **Does not** `publishSheetSyncWakeup`.

No destructive "heal" that could fight the drainer for the same rows.

## Storage, indexes and read paths

MongoDB holds all Sheet Sync state. Google Sheets holds only reporting rows. Domain documents (Form Leads, Call Leads, Bookings, Cancellations) carry `sheet_sync[]` entries with `target`, `spreadsheet_id`, `tab_name`, a `row_number` hint, `status`, `last_synced_at`, `last_error` and `updated_since_last_sync`. The drainer updates that array outside the domain transaction.

The five Sheet Sync models leave Mongoose `autoIndex` at its default. `pnpm disk:trim` (`ops/lib/disk-trim.ts`) also applies the two 90-day TTL indexes. Indexes below are exactly as declared in `src/models/`; unnamed indexes carry MongoDB's generated name.

### `sheet_sync_jobs` (`SheetSyncJob`) — durable outbox, no TTL

| Index | Keys | Options | Code query that uses it |
|---|---|---|---|
| `status_1_due_at_1_priority_-1_createdAt_1` | `{ status: 1, due_at: 1, priority: -1, createdAt: 1 }` | — | Claim discovery; Admin oldest open job; Admin job list filtered by status; Systems sync line; run-scoped lease renewal and release (status prefix) |
| `coalescing_key_1_status_1` | `{ coalescing_key: 1, status: 1 }` | not unique | Outbox upsert; tombstone supersede `updateMany` |
| `leased_until_1` | `{ leased_until: 1 }` | — | None. The schema comment names a lease reclamation sweep; no such query exists |
| `entity_model_1_entity_id_1_status_1` | `{ entity_model: 1, entity_id: 1, status: 1 }` | — | Sheet Contains open-job lookup |

Query shapes:

- **Coalescing upsert** (`sheetSyncOutbox.service.ts`): `findOneAndUpdate({ coalescing_key, status: { $in: ["pending", "retrying"] } }, …, { upsert: true, session })`. Tombstones first run `updateMany` on the superseded key with the same status filter.
- **Discovery** (`claimDueJobs`): `find({ status: { $in: ["pending", "retrying"] }, due_at: { $lte: now }, $or: [{ leased_until: { $exists: false } }, { leased_until: { $lte: now } }] }).sort({ priority: -1, createdAt: 1 }).limit(500).select({ _id: 1 })`.
- **Claim and finalization:** `findOneAndUpdate` by `_id`. Finalization also matches `status: "processing"`, `lease_owner`, `run_id` and an unexpired `leased_until`.
- **Heartbeat and run failure:** `updateMany({ run_id, lease_owner, status: "processing", … })`.
- **Admin** (`adminSheetSync.service.ts`): health runs `$group` by `status` over the whole collection, plus `findOne({ status: { $in: ["pending", "retrying"] } }).sort({ due_at: 1 })`. The job list filters optionally by `status`, `resource`, `entity_id` or `_id`, sorts `{ due_at: 1, priority: -1, createdAt: 1 }` with skip/limit, and runs `countDocuments` on the same filter. Retry selects IDs by `_id` or `status`, then `updateMany` by `_id`.
- **Systems** (`systems/readers.ts`): `$match` on the four open/failed statuses, then `$group` by resource, status and stuck.
- **Sheet Contains** (`googleSheets/sheetContains.ts`): `find({ entity_model, entity_id: { $in }, status: { $in: active } }).sort({ due_at: 1, createdAt: 1 })`.
- **Job Number Timeline** full-evidence loader: `find({ entity_id: { $in } })`. The Admin route sets `milestonesOnly: true` and skips this read.
- **Operator trace** (`ops/vantage/sheet-sync.ts`): jobs by `_id`, hinted to `_id_`.

### `sheet_sync_attempts` (`SheetSyncAttempt`) — per-target outcomes, 90-day TTL

| Index | Keys | Options | Code query that uses it |
|---|---|---|---|
| `run_id_1_createdAt_1` | `{ run_id: 1, createdAt: 1 }` | — | Admin run detail: `find({ run_id }).sort({ createdAt: 1 })`, all attempts of the run |
| `job_id_1_createdAt_1` | `{ job_id: 1, createdAt: 1 }` | — | Operator trace: attempts by `job_id`, newest first |
| `status_1_createdAt_-1` | `{ status: 1, createdAt: -1 }` | — | None in `src/` or `ops/` |
| `sheet_sync_attempt_created_ttl` | `{ createdAt: 1 }` | `expireAfterSeconds: 7776000` (90 days) | TTL monitor |

Writes: one unordered `insertMany` per nonempty drain. Admin run detail returns `google_reasons: []` when a stored attempt omits the field. The schema default is `undefined`, so new attempts do not store an empty array.

### `sheet_sync_runs` (`SheetSyncRun`) — per-drain history, 90-day TTL

| Index | Keys | Options | Code query that uses it |
|---|---|---|---|
| `started_at_-1` | `{ started_at: -1 }` | — | Admin health latest run; unfiltered Admin run list |
| `status_1_started_at_-1` | `{ status: 1, started_at: -1 }` | — | Admin run list filtered by status; Systems last write (`status ∈ completed/partial_failure`, `synced_job_count > 0`, newest first) |
| `sheet_sync_run_started_ttl` | `{ started_at: 1 }` | `expireAfterSeconds: 7776000` (90 days) | TTL monitor |

Writes: one insert and one `findByIdAndUpdate` per drain, including idle drains.

### `sheet_sync_leases` (`SheetSyncLease`) — named leases

| Index | Keys | Options | Code query that uses it |
|---|---|---|---|
| `scope_1` | `{ scope: 1 }` | unique | `MongoLeaseStore` acquire, renew, assert and release; writer fence `findOne({ scope, leased_until: { $gt: now } })` |
| `leased_until_1` | `{ leased_until: 1 }` | — | None |

Scopes include `sheet-sync:drain`, `lead-reporting:tab-migration` and Granot HTTP collector leases (`granotHttpCollector/`). The model comment still describes per-tab `<spreadsheetId>:<tabName>` leases; no code uses that shape.

### `sheet_sync_quota_buckets` (`SheetSyncQuotaBucket`) — per-minute Google quota

| Index | Keys | Options | Code query that uses it |
|---|---|---|---|
| `scope_1_op_class_1_window_start_1` | `{ scope: 1, op_class: 1, window_start: 1 }` | unique | `QuotaLimiter.reserve`: upsert `$inc`, and an `updateOne` rollback when over budget |
| `window_start_1` | `{ window_start: 1 }` | `expireAfterSeconds: 3600` | TTL monitor |

The limiter reserves only the `user` scope. Defaults are 45 reads and 45 writes per minute against Google's 60 per user. The `project` budgets are configured in `config/domain/sheetSync.ts` but no limiter reserves them.

### Mongo commands per drain

- Every drain: fence read, lease acquire, run insert, discovery find, run update, lease release. An idle drain measured 12 commands on a local replica on November 17.
- Per claimed job: one claim, planner reads of its canonical documents (a Booking Chain adds the Lead; a Cancellation Chain adds the Booking and Lead), one finalization.
- Per surviving physical document: one `sheet_sync[]` `updateOne`.
- Per Google request: two guard checks, each reading the fence and the drain lease, plus one quota upsert. The mixed five-job local drain issued 160 commands, including 130 lease and fence reads, for 29 workbook requests. [Measured costs](../../efficiency/sheet-discovery-2026-11-17.md)

### Google requests per tab group (queued)

- **Upsert group, warm isolate:** one identity `values.batchGet` (two when the identity column has shifted), then per update chunk one identity recheck `values.batchGet` and one `values.batchUpdate`, then chunked `values.append`. A renamed Form title adds one `spreadsheets.get` until the new title is cached.
- **Upsert group, cold isolate:** `spreadsheets.get` for tab properties, the identity read, an optional column expansion and the timestamp number-format `batchUpdate`. Matching headers skip the clear and header update. A new tab adds `addSheet` and its header write.
- **Delete group:** one `spreadsheets.get` to resolve the tab (uncached). A missing tab ends the group as an idempotent success. Otherwise one identity read, then per chunk of present IDs one row-inspection `spreadsheets.get` and one `spreadsheets.batchUpdate`.
- **Chunks** hold at most `min(500 rows, 100 subrequests)` and 1,500,000 payload bytes. Every request reserves one quota token.

### Retention and what stays in MongoDB

Attempts and runs expire 90 days after `createdAt` and `started_at`. Quota buckets expire one hour after their window. Jobs, tombstones, active leases, `last_error` and historical job IDs stay in MongoDB with no TTL. Admin retry, Sheet Contains, the operator trace and attempt `job_id` references depend on them. Deleting attempts or jobs on acknowledgement alone would lose Admin evidence or recovery context. Synced jobs omit the spent lease. The November 19 maintenance removed `leased_until: new Date(0)` from historical synced jobs and empty `google_reasons` from historical attempts (`ops/capacity/compact-service-fields.cjs`). [Release record](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md#master-leads-and-master-booked)

### Measured baselines

From the [November 19 release record](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md):

- **November 18 workload:** 452 drain runs, 156 nonempty. 173 jobs completed with 520 target outcomes. The largest drain completed five jobs in 1.955 s. Enqueue to MongoDB-recorded success had a median of 102.313 s and a p95 of 260.152 s.
- **Stock after the November 19 cleanup:** `sheet_sync_jobs` 164,269 documents, 66.89 logical MiB, 24.47 allocated MiB, 21.70 index MiB. `sheet_sync_attempts` 459,876 documents, 121.24 logical MiB, 27.02 allocated MiB, 30.89 index MiB. Allocated data and index size rose during the cleanup window. Runs, leases and quota buckets: unmeasured.
- **Plans, November 19:** coalescing used `coalescing_key_1_status_1` (1 key examined). Due-job selection used `status_1_due_at_1_priority_-1_createdAt_1` on an empty queue, so it shows the chosen plan only. Attempts for one job used `job_id_1_createdAt_1` (3 keys, 3 documents).
- **Index access counters, 2026-11-18 20:50 UTC to 2026-11-19 23:13 UTC, one primary:** jobs `_id_` 986, due-job 963, coalescing 152, entity 19, `leased_until_1` 3. Attempts `_id_` 1,856, `job_id` 86, `run_id` 0, `status` 0, TTL 3. Counters reset at restart. [Counters](../../operations/evidence/operations-command-sheets-final-stock.json)

### Observations for the index and read phase

These are observations, not changes.

- Declared without a matching code query: `sheet_sync_jobs.leased_until_1`, `sheet_sync_attempts.status_1_createdAt_-1`, `sheet_sync_leases.leased_until_1`. `sheet_sync_runs.started_at_-1` repeats the TTL key `started_at_1` in reverse order.
- Discovery puts the `due_at` range before the `priority`/`createdAt` sort keys, so MongoDB sorts every due candidate in memory before the limit. This is cheap while the queue is near empty and grows with backlog.
- Admin health groups the whole jobs collection on every call. The Admin job list without a status filter sorts the whole collection, and `resource` or `entity_id` filters alone have no leading index. Call frequency: unmeasured.
- The full-evidence Job Number Timeline read filters `entity_id` without `entity_model`, so no index leads with it. No production route uses that path today.
- Each Google request costs about five Mongo commands for guards and quota.
- `sheet_sync_jobs` grows by every new intent with no TTL.

## Invariants

- Do not bypass coordinator helpers for sheet scheduling from domain services (`persistSheetSyncIntent` / tombstone + finalize).
- Outbox + domain doc must commit atomically in `queued` mode.
- Queue publish is best-effort and live-hosted-only; never fail an API response because publish failed.
- Sheet row identity is always **Lead ID** (`Mongo ID` column); `sheet_sync[].row_number` is a hint only.
- Delete tombstone must precede hard Mongo delete. A booked-lead tombstone does not cancel a live `booking_chain` job.
- Tab routing in `jobPlanner.ts` must stay aligned with [`google-sheets.md`](./google-sheets.md).
- Do not reset stuck `processing` jobs to `pending` without fixing root cause — admin retry or the operational notes in [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc). The drainer may release leftover claims to `pending` on run timeout by design.

## Related services

- [`form-lead.md`](./form-lead.md) / [`call-lead.md`](./call-lead.md) — lead jobs
- [`bookings.md`](./bookings.md) / [`cancelled-lead.md`](./cancelled-lead.md) — chain jobs
- [`google-sheets.md`](./google-sheets.md) — tab routing and projections
- [`domain-commands.md`](./domain-commands.md) — executor owns the txn; finalize after commit

## Related rules

- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — env, `TEST_` prefixes, quotas, mounts

**November 4 Call parity review:** [canonical billing policy](../../call-lead-billing.md#form-fill-convergence-and-final-evidence-ordering) owns company-scoped Form Fill, bounded transactional follow-up and final-result ordering. Reporting exclusions remain separate from Booking/Cancellation reporting and Desk eligibility. [Evidence and release limits](../../call-billing-review-2026-11-04.md).
