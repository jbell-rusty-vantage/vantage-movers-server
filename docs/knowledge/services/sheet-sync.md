---
type: Service
title: "Sheet Sync (`sheetSync/`)"
description: Write-behind outbox, queue wake-up, drainer, and sheet-sync modes.
tags: [sheet-sync, outbox]
status: draft
stale_after: 2026-11-20
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
generated:
  by: process:docs-keeper
  at: 2026-11-05T02:30:00Z
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
| `GET/ALL /api/cron/sheet-sync-drain` | `runSheetSyncDrain("cron")` — Bearer or `x-cron-secret` = `CRON_SECRET`; no-op unless `SHEET_SYNC_MODE=queued` |
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

**Gap (labeled):** Some Granot / RingCentral callers call `enqueueSheetSyncJob` directly (mode-blind) instead of `persistSheetSyncIntent`. Checked-in Granot effect flags still keep those HTTP/processor paths off.

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
   - `$set target_hints: []` on every coalesce.
   - Upserts if no active row exists.

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
2. **Create** `SheetSyncRun` (`running`). Heartbeat renews the drain lease and claimed job leases; lease loss throws.
3. **Claim** due jobs (`pending`/`retrying`, `due_at ≤ now`, unleased) up to `maxJobsPerDrain` (500), sorted `priority desc, createdAt asc`.
4. **Plan** each logical job via `jobPlanner.ts` — reload current Mongo (or tombstone), preserving its retry hints/targets even when claimed keys overlap. Physical writes are coalesced after planning; no subscriber is marked synced merely because a representative was processed.
5. **Recheck topology fence**, then **batch write** destinations before stale deletes via `batchWriter.ts` + `QuotaLimiter`. Failed/deferred destination upserts prevent stale deletes. Identical per-ID writes from overlapping jobs are coalesced without losing per-job outcomes; conflicting payloads fail. Duplicate physical IDs are repaired and logged.
6. **Persist** `sheet_sync[]` with direct `updateOne` (must not abort the run). Metadata persist failure flips those outcomes to `failed`.
7. **Finalize** jobs: empty plan (doc gone / unmatched skip) → `synced`; all writes ok → `synced`; any `failed` → `retrying` with exponential backoff (30s × 2^(attempts-1), cap 15 min) until `maxAttempts` (8) then `failed`; unconfirmed structural delivery, quota or request-guard `deferred` → `retrying` in 60s **without** burning an attempt. `target_hints` = failed/deferred targets only. Attempts retain per-job/target outcomes and reasons; duplicate claimed keys keep representative-only Daily Operations emission within that drain, and completion facts remain deduped by job ID.
8. Run timeout releases **unplanned** remaining claims back to `pending`. Run-level exception releases that run's still-`processing` jobs to `retrying` and logs `sheet_sync.drain.failed`.

Planner skip/fail paths (also true on the legacy `syncSourceLead` path):

- Ordinary `no_sync` suppresses upserts. Ordinary Forms clean all three Form destinations and old/new Form titles; ordinary Calls clean all three Call destinations. Effective duplicate/bad Call exceptions and canonical/trusted imported bad Forms still project. Official Booking/Cancellation chain rows retain their own writes.
- Unmatched Calls and Calls lacking either saved RingCentral qualification or protected final Best Relocation admission produce no sheet upsert, including through the direct facade. `getCallLeadReportingDecision` owns admission-aware disposition across planner, legacy, contains and retries. Syncing an excluded Call does not itself remove a preexisting row; an explicit delete/reprojection repair owns that cleanup.
- Forms with canonical `bad_lead` or a fully trusted `external_sheet_review.kind === "bad_form"` write **Bad Form Leads only**. Bad projection wins over duplicate routing without changing canonical duplicate, Booking or Cancellation facts. `formLeadTargets` selects the destination; `staleFormTargets`/`staleFormTargetKeys` plan cleanup of Forms and both old/new Duplicate Forms titles by Mongo ID, even with empty metadata. The batch writer confirms the bad destination before any stale delete, so interrupted delivery remains pending and replay repairs it. Clearing the bad fact restores the ordinary primary destination and deletes both old/new bad-Form titles. Other Forms retain their ordinary Forms/Duplicate Forms routing.
- Calls upsert exactly one of Calls / Duplicate Calls / Bad Call Leads, then delete the same Mongo ID from the other two tabs. Form Fill and trusted duplicate review are reporting duplicates without rewriting `duplicate`. Duplicate disposition takes precedence over bad. All Call tabs retain the same headers/projection.
- Form and Call retries always replan the current destination and required cleanup; old `target_hints` cannot delete the new desired row or skip an updated destination. Tombstones enumerate all possible Lead targets and historical locations, including old/new Form titles. Unknown target headers are dropped; source-lead tombstones are not restricted by old target hints.
- Missing Booking/Cancellation documents produce an empty plan. Official outcomes remain reportable when their Lead becomes nonbillable.

## Uncertain structural delivery (queued only)

`deliveryRequests.ts` wraps every Sheets request used by queued delivery, including header/tab helpers. Each request reserves quota and checks the deadline, current drain lease and topology fence before sending; safe explicit read/update retries re-enter those checks. Google transport retries are disabled through both `retry` and `retryConfig`. Legacy/direct callers keep their existing retry behavior.

Each append or positional delete has one provider attempt for its current plan. A missing/malformed append range, backend error, lost response or unconfirmed delete stops **all further provider requests in that writer invocation**. Affected writes become deferred, old row maps are abandoned, unconfirmed upsert metadata row hints are cleared, and stale membership cannot be deleted on the strength of an uncertain destination. Confirmed earlier outcomes remain accounted for. Explicit HTTP 400/401/403/404/429 rejections use ordinary failed-attempt handling and are never reissued inline; structural uncertainty does not burn an attempt.

The existing next queue/cron/admin drain reloads current Mongo plans and fresh per-tab identity evidence. An existing destination is updated rather than appended again; an ID reliably absent from the current map is an idempotent delete success. Reads require exactly one actual `Mongo ID` header; missing/ambiguous headers, malformed topology/row responses and failed reads never prove absence. Shifted legacy identity lookup remains supported for deletes. Upserts or cold header rewrites that would move the identity column are refused for operator correction, including with a warm header cache. Only a confirmed newly created empty tab can initialize without a prior identity header. The identity read happens before a cold header rewrite and is reused, preserving one identity read per successful tab batch.

Duplicate-row repair uses the same guarded single-attempt deletions. No per-row provider reads or new scheduler are introduced. Google success followed by Mongo metadata failure keeps the jobs retryable; fresh identity reads recover both append and stale-delete effects without repeating a positional delete.

Automatic recovery runs on the existing drain schedule after due time and while ownership, quota and topology permit. Invalid headers/topology or exhausted ordinary failures need operator correction and the existing Admin retry; never reset processing jobs or delete historical rows as a shortcut. Lease/fence checks cannot cancel an already in-flight request or promise exactly-once network delivery. Operators must still acquire both leases and wait out older writers before topology changes. Rollback uses the previous application revision, retains outbox/attempt/metadata evidence, and reintroduces the unsafe structural retry behavior; it is not a reason to clear pending work. [Qualification and release handoff](../../efficiency/sheet-sync-recovery-handoff-2026-11-04.md).

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

## Mongo collections

| Collection | Model | Purpose |
|------------|-------|---------|
| `sheet_sync_jobs` | `SheetSyncJob` | Durable outbox |
| `sheet_sync_runs` | `SheetSyncRun` | Per-drain audit; expires 90 days after `started_at` (`sheet_sync_run_started_ttl`, disk trim 2026-10-07) |
| `sheet_sync_attempts` | `SheetSyncAttempt` | Per-target write outcomes; expires 90 days after `createdAt` (`sheet_sync_attempt_created_ttl`) |
| `sheet_sync_leases` | `SheetSyncLease` | Global drain mutex and short-lived topology writer fence |

`sheet_sync_jobs` (the outbox) has no TTL; the admin run list reads the newest page only, so nothing selects a run older than 90 days. `QuotaLimiter` uses `SheetSyncQuotaBucket` for per-minute budgets. Domain documents store `sheet_sync[]` (spreadsheet, tab, `row_number` hint, status).

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
