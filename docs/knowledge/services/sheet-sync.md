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
  - src/services/sheetSync/noSyncLead.ts
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
  by: process:okf-docs-optimization
  at: 2026-08-22T03:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/sheetSync/`  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Cancellation Chain](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md), [Operational Event](../../../../CONTEXT.md)

# Sheet Sync (`sheetSync/`)

**Role:** Mode-aware scheduling layer between Mongo domain writes and **Reporting Sheets**. **System of Record** is MongoDB; **Sheet Sync** writes **Master Sheets** only — **Source Company Sheets** derive via import queries unless `WRITE_SOURCE_LEAD_SHEETS` is the literal `"true"`. Sheets update *after* API responses; a successful response does not mean sheets are updated yet.

**Stack:** Domain services persist intent → optional Vercel Queue wake-up → drainer → `googleSheets/` writes. Legacy mode skips the outbox and runs sync inline via `waitUntil`.

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
- **Never throws** — failed publish is logged + operational event `sheet_sync.queue.publish_failed`; domain write already committed.

Reasons: `domain_write`, `domain_delete`, `cron`, `admin_retry`, `manual`. Admin retry does not use this path.

## Drainer (`drainer/runSheetSyncDrain.ts`)

`runSheetSyncDrain(trigger, options?)` — queue, cron, and admin retry all enter here.

1. **Acquire** global lease `sheet-sync:drain`; skip (`skipped: true`) if another drain holds it.
2. **Create** `SheetSyncRun` (`running`). Heartbeat renews the drain lease and claimed job leases; lease loss throws.
3. **Claim** due jobs (`pending`/`retrying`, `due_at ≤ now`, unleased) up to `maxJobsPerDrain` (500), sorted `priority desc, createdAt asc`.
4. **Plan** each representative via `jobPlanner.ts` — reload current Mongo (or tombstone). Duplicate claimed keys are later marked `synced` with `coalesced_into_representative`.
5. **Batch write** per tab via `batchWriter.ts` + `QuotaLimiter`.
6. **Persist** `sheet_sync[]` with direct `updateOne` (must not abort the run). Metadata persist failure flips those outcomes to `failed`.
7. **Finalize** jobs: empty plan (doc gone / unmatched skip) → `synced`; all writes ok → `synced`; any `failed` → `retrying` with exponential backoff (30s × 2^(attempts-1), cap 15 min) until `maxAttempts` (8) then `failed`; quota `deferred` → `retrying` in 60s **without** burning an attempt, `target_hints` = failed/deferred targets only.
8. Run timeout releases **unplanned** remaining claims back to `pending`. Run-level exception releases that run's still-`processing` jobs to `retrying` and records `sheet_sync.drain.failed` (notification candidate).

Planner skip/fail paths (also true on the legacy `syncSourceLead` path):

- Ordinary [No-Sync Lead](../../../../CONTEXT.md) (`noSyncAppliesToNormalTabs` in `src/services/sheetSync/noSyncLead.ts`): `planSourceLead` / `syncSourceLead` skip Forms/Calls upserts and delete living Forms or Calls rows only. Duplicate Lead and Bad Lead still run today's planner — `no_sync` does not delete or skip Duplicates, Duplicate Calls, or Bad Leads. [Booking Chain](../../../../CONTEXT.md) still writes Booked Deals (Mongo Lead ID stays); the linked ordinary source Lead uses the same predicate and must not upsert Forms or Calls. Do not gate only `persistSheetSyncIntent`. Create with `no_sync: true` does not enqueue `form_lead.create` / `call_lead.create`.
- [Unmatched Call Lead](../../../../CONTEXT.md) (`CallLead.created_on_unmatched === true`) → empty plan / no Calls row (do not invent a lead row). Distinct from No-Sync; unmatched is not a living-lead delete.
- Missing booking or cancellation → empty plan, job marked `synced`.
- Form `bad_lead` set → primary tab **plus** Master `Bad Leads` upsert. Cleared `bad_lead` deletes Master `Bad Leads` only when `sheet_sync[]` already has that target (queued). Legacy `syncFormLeadToSheets` always attempts the Bad Leads delete when `bad_lead` is falsy.
- Call duplicate flip → upsert current tab and **delete** the stale Calls / Duplicate Calls tab even when `sheet_sync[]` is empty (Mongo-id lookup).
- Tombstone targets with unknown headers or outside `target_hints` are dropped.

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
| `sheet_sync_runs` | `SheetSyncRun` | Per-drain audit |
| `sheet_sync_attempts` | `SheetSyncAttempt` | Per-target write outcomes |
| `sheet_sync_leases` | `SheetSyncLease` | Global drain mutex |

`QuotaLimiter` uses `SheetSyncQuotaBucket` for per-minute budgets. Domain documents store `sheet_sync[]` (spreadsheet, tab, `row_number` hint, status).

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
