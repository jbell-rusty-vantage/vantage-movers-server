**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/sheetSync/`  
**Domain terms used:** Sheet Sync, Booking Chain, Cancellation Chain, System of Record, Reporting Sheets, Master Sheets, Operational Event

# Sheet Sync (`sheetSync/`)

**Role:** Mode-aware scheduling layer between Mongo domain writes and **Reporting Sheets**. **System of Record** is MongoDB; **Sheet Sync** writes **Master Sheets** only — **Source Company Sheets** derive via import queries. Sheets update *after* API responses; a successful response does not mean sheets are updated yet.

**Stack:** Domain services → coordinator/outbox → Vercel Queue wake-up (optional) → drainer → `googleSheets/` writes. Legacy mode skips the outbox and runs sync inline via `waitUntil`.

**Public barrel:** `src/services/sheetSync/index.ts` re-exports coordinator, outbox, queue, drainer, persistence, and source-lookup helpers.

## Execution modes (`SHEET_SYNC_MODE`)

| Mode | Default? | Domain write | Sheet execution |
|------|----------|--------------|-----------------|
| `legacy` | yes (until prod sets `queued`) | No outbox txn | `waitUntil(runFullSheetSyncProcess)` after response |
| `queued` | opt-in | Outbox row in same Mongo txn as domain doc | Queue wake-up → `runSheetSyncDrain` |
| `disabled` | — | Log intent only | No Sheets calls |

Config lives in `src/config/domain/sheetSync.ts` (priorities, guardrails, queue topic, coalescing keys).

## End-to-end flow (queued mode)

```
Domain service (form/call/booking/cancel)
  │
  ├─ runSheetSyncWrite(fn)          ← opens Mongo txn when queued
  │     └─ persistSheetSyncIntent   ← upsert SheetSyncJob in txn
  │
  ├─ commit
  │
  └─ finalizeSheetSync / finalizeSheetSyncDelete
        └─ publishSheetSyncWakeup  ← best-effort; never throws

Vercel Queue topic (prod only)
  └─ api/queues/sheet-sync-consumer.ts
        └─ runSheetSyncDrain("queue")

Cron safety net (every 5 min, queued only)
  └─ GET /api/cron/sheet-sync-drain → runSheetSyncDrain("cron")
```

**Key design:** The queue message is only a wake-up (`kind: "sheet_sync_wakeup"`). Payload is ignored. Mongo owns due time, coalescing, priority, leases, and Google quota — so duplicate wake-ups and cron never double-process the same logical work.

## Job shapes (`sheetSyncJobs.ts`)

`FullSheetSyncJob` is the legacy scheduler shape domain code already builds:

| `resource` | Entity id field | Typical `operation` examples |
|------------|-----------------|------------------------------|
| `source_lead` | `leadId` + `leadModel` (`FormLead` / `CallLead`) | `form_lead.create`, `call_lead.update`, `call_lead.form_fill.update` |
| `booked_lead` | `bookingId` | `referral_booking.create` (Referral Booking — no source lead) |
| `booking_chain` | `bookingId` | **Booking Chain** — `booking_chain.create`, `booking.upsert` |
| `cancellation_chain` | `cancellationId` | **Cancellation Chain** — `cancellation.create` |

Delete tombstones use separate resources: `delete_source_lead`, `delete_booked_lead`, `delete_cancelled_lead` (enqueued via `enqueueSheetSyncTombstone`, not `FullSheetSyncJob`).

`sheetSyncLogContext(job)` standardizes structured log fields per resource.

## Coordinator (`sheetSyncCoordinator.ts`)

Mode-aware boundary for all domain callers.

| Export | When to use |
|--------|-------------|
| `runSheetSyncWrite(fn)` | Wrap Mongo mutation; passes `ClientSession` in `queued` mode |
| `persistSheetSyncIntent(job, session)` | Inside txn: write outbox row (no-op in legacy/disabled) |
| `finalizeSheetSync(job)` | After commit: publish wake-up (queued) or schedule legacy sync |
| `finalizeSheetSyncDelete()` | After delete txn commits: publish `domain_delete` wake-up |
| `scheduleFullSheetSyncProcess(job)` | Compatibility path for unmigrated callers / enrichment |
| `scheduleCallLeadSheetSync` / `scheduleBookingChainSheetSync` / `scheduleBookedLeadSheetSync` | Thin wrappers for reconciliation/enrichment |
| `runFullSheetSyncProcess(job)` | Synchronous legacy execution (tests, scripts) |

**Transaction rule:** Keep Google Sheets, queue publish, CRM, and email **outside** `runSheetSyncWrite` callback. Only Mongo + outbox belong in the txn.

**Canonical commands:** `executeIdempotentCanonicalCommand` owns the Mongo transaction and `DomainCommandExecution` persist. `runSheetSyncWrite` no longer completes commands (ALS / `persistActiveCanonicalCommandExecution` are gone). Canonical adapters persist Sheet Sync intent inside the executor session and call `finalizeSheetSync` only after a successful non-replay commit. Public legacy services may still wrap their own writes with `runSheetSyncWrite`. `EntityChange` and complete outbox atomicity remain Unit 11.

**Legacy path:** `scheduleFullSheetSyncProcess` → `waitUntil` → `runFullSheetSyncProcess` → `sheetSyncSourceLookup` → `googleSheets.service` + `syncAndStore`.

## Outbox (`sheetSyncOutbox.service.ts`)

Writes durable intent to `sheet_sync_jobs` (`SheetSyncJob` model).

### Upsert (`enqueueSheetSyncJob`)

1. Maps `FullSheetSyncJob` → `{ resource, entityModel, entityId }`.
2. `buildCoalescingKey` collapses repeated work for the same entity.
3. `findOneAndUpdate` on `{ coalescing_key, status ∈ [pending, retrying] }`:
   - `$min due_at` — pulls earlier, never pushes later (debounce window, default 3s).
   - `$max priority` — highest wins.
   - Upserts if no active row exists.

**Coalesce rule:** Only `pending` and `retrying`. Never coalesce onto `processing` — a write during drain creates a fresh `pending` job so the drainer reloads latest Mongo state (at most one extra idempotent sync).

### Tombstone (`enqueueSheetSyncTombstone`)

For hard deletes before Mongo document removal:

1. `buildTombstonePreviousTargets(sheet_sync[])` snapshots known sheet rows.
2. Cancels pending/retrying **upsert** for same entity (`superseded_by_delete_tombstone`).
3. Enqueues delete job with `due_at = now` (no debounce — stale upsert could re-add deleted row).

`SheetSyncTombstoneInput` carries `mongo_id`, routing hints (`source_company`, `duplicate`), linked entity ids, and `previous_targets`.

## Queue publisher (`sheetSyncQueue.service.ts`)

`publishSheetSyncWakeup({ reason, idempotencyKey?, runHint? })`:

- Sends to env-scoped topic: prod `sheet-sync-events`, else `sheet-sync-events-dev` (override `SHEET_SYNC_QUEUE_TOPIC`).
- **Only publishes** when `VERCEL=1` **and** `VERCEL_ENV=production` (`shouldPublishSheetSyncQueue`). Preview/local/tests use cron or direct `runSheetSyncDrain`.
- **Never throws** — failed publish is logged + operational event; domain write already committed.
- `idempotencyKey` optional for burst dedup within debounce window.

Reasons: `domain_write`, `domain_delete`, `cron`, `admin_retry`, `manual`.

## Vercel Queue consumer (`api/queues/sheet-sync-consumer.ts`)

Dedicated function — **not** mounted on Express (`vercel.json` `experimentalTriggers` on `sheet-sync-events*`). Mixing with the `"/(.*)" → "/api"` rewrite would shadow the consumer.

Handler: `connectMongo` → `runSheetSyncDrain("queue")` → log summary.

Global drain lease (`sheet-sync:drain`) ensures queue wake-ups and cron never drain concurrently.

## Mongo collections

| Collection | Model | Purpose |
|------------|-------|---------|
| `sheet_sync_jobs` | `SheetSyncJob` | Durable outbox — domain-level sync intent |
| `sheet_sync_runs` | `SheetSyncRun` | Per-drain audit (`trigger`, counts, status) |
| `sheet_sync_attempts` | `SheetSyncAttempt` | Per-target write outcomes within a run |
| `sheet_sync_leases` | `SheetSyncLease` | Global drain mutex |

### `SheetSyncJob` fields (operational)

- `status`: `pending` → `processing` → `synced` | `retrying` | `failed` | `cancelled`
- `resource`, `operation`, `entity_model`, `entity_id` — reload key at drain time
- `coalescing_key`, `priority`, `due_at`
- `leased_until`, `lease_owner`, `run_id` — in-flight claim
- `target_hints` — retry only failed/deferred targets
- `tombstone` — delete metadata when document is gone
- `attempts`, `last_error`, `created_by` (`api` | `cron` | `admin` | `script`)

Domain documents also store `sheet_sync[]` (per-target row cache: spreadsheet, tab, `row_number`, status). Drainer updates this after successful writes; legacy path uses `syncAndStore`.

## Drainer (`drainer/runSheetSyncDrain.ts`)

`runSheetSyncDrain(trigger, options?)` — the worker both queue and cron invoke.

1. **Acquire** global lease; skip if another drain holds it.
2. **Create** `SheetSyncRun` (`running`).
3. **Claim** due jobs (`pending`/`retrying`, `due_at ≤ now`, unleased) up to `maxJobsPerDrain` (500), sorted `priority desc, createdAt asc`.
4. **Plan** each representative via `jobPlanner.ts` — reload current Mongo (or tombstone), mirror tab routing from `googleSheets.service.md`.
5. **Batch write** per tab via `batchWriter.ts` + `QuotaLimiter` (conservative budgets under Google 60/min user cap).
6. **Persist** `sheet_sync[]` on domain docs; record `SheetSyncAttempt` rows.
7. **Finalize** jobs: `synced`, `retrying` (exponential backoff, max 8 attempts), or `failed`. Quota deferral → `retrying` in 60s without burning attempt.
8. **Release** lease; update run status (`completed` | `partial_failure` | `failed`).

Duplicate claims sharing a `coalescing_key` are marked `synced` with `coalesced_into_representative`.

Run-level crash releases `processing` jobs for that `run_id` back to `retrying`.

## Domain service integration

Standard write pattern (form/call/booking/cancel services):

```ts
const outcome = await runSheetSyncWrite(async (session) => {
  // ... mutate Mongo document ...
  await persistSheetSyncIntent(job, session);
  return { doc, job };
});
await finalizeSheetSync(outcome.job);
```

Delete pattern:

```ts
await runSheetSyncWrite(async (session) => {
  await enqueueSheetSyncTombstone({ resource, entityModel, entityId, operation, tombstone }, { session });
  // ... hard-delete domain document ...
});
await finalizeSheetSyncDelete();
```

Some callers still use `scheduleCallLeadSheetSync` / `scheduleBookingChainSheetSync`. Enrichment and several reconciliation writes now use `persistSheetSyncIntent` + `finalizeSheetSync` with dedicated operations.

| Caller | Jobs enqueued |
|--------|---------------|
| `formLead.service.ts` | `source_lead`; tombstone on delete |
| `callLead.service.ts` | `source_lead`; tombstone on delete |
| `bookedLead.service.ts` | `booking_chain` or `booked_lead`; tombstone on delete |
| `referralBooking.service.ts` | `booked_lead` / `referral_booking.create` |
| `leadlessBooking.service.ts` | `booked_lead` / `leadless_booking.create` |
| `cancelledLead.service.ts` | `cancellation_chain`; tombstone on delete |
| `bookedCallLeadReconciliation.service.ts` | `booked_call_lead.call_lead_only.sync`, `booked_call_lead.receiver_agent_crm_username.sync`, plus schedule helpers |
| `callLeadEnrichment.service.ts` | `call_lead.enrichment.sync` via persist + finalize |

`jobPlanner.ts` skips a Calls-tab sheet row for `created_on_unmatched` call stubs so unmatched booking stubs do not invent a misleading lead row.

## Cron safety net

`GET /api/cron/sheet-sync-drain` — auth `CRON_SECRET` (Bearer or `x-cron-secret`). No-op unless `SHEET_SYNC_MODE=queued`. Recovers jobs when queue publish failed. Schedule: every 5 minutes (`vercel.json`).

## Admin surface (`admin/adminSheetSync.service.ts`)

Read-only health + bounded retry:

- `getSheetSyncHealth` — mode, counts by status, backlog age, last run
- `listSheetSyncJobs` / `listSheetSyncRuns` / `getSheetSyncRunDetail`
- `retrySheetSyncJobs` — re-queue `failed`/`cancelled` (or explicit ids) to `pending` with `due_at=now`, then `publishSheetSyncWakeup({ reason: "admin_retry" })`

No destructive "heal" that could fight the drainer for the same rows.

## Invariants

- Do not bypass coordinator helpers for sheet scheduling from domain services.
- Outbox + domain doc must commit atomically in `queued` mode (`persistSheetSyncIntent` inside txn).
- Queue publish is best-effort; never fail an API response because publish failed.
- Sheet row identity is always **Lead ID** (`Mongo ID` column); `sheet_sync[].row_number` is a hint only.
- Delete tombstone must precede hard Mongo delete; tombstone cancels pending upserts for same entity.
- Tab routing in `jobPlanner.ts` must stay aligned with `googleSheets.service.md` when rules change.
- Do not reset stuck `processing` jobs to `pending` without fixing root cause — use admin retry or operational runbook (`rules/sheet-sync-process.mdc`).

## Related modules

| Module | Responsibility |
|--------|----------------|
| `googleSheets.service.md` | What gets written where (tabs, projections) |
| `rules/sheet-sync-process.mdc` | Cross-cutting architecture, headers, operational safety |
| `sheetSyncSourceLookup.ts` | Legacy sync orchestration (chain: booking → source lead) |
| `sheetSyncPersistence.ts` | `syncAndStore` for legacy inline sync |
| `config/domain/sheetSync.ts` | Mode, topic, priorities, guardrails, coalescing |
| `models/SheetSync*.ts` | Outbox, run, attempt, lease schemas |

## Related businesslogic

- [`form-lead.service.md`](form-lead.service.md) — Form Lead Ingestion post-save Sheet Sync + ADR-0002 order gap with CRM Posting
- [`call-lead.service.md`](call-lead.service.md) — Call Lead Ingestion jobs
- [`bookings.service.md`](bookings.service.md) — Booking Chain jobs
- [`cancelledLead.service.md`](cancelledLead.service.md) — Cancellation Chain jobs
- [`googleSheets.service.md`](googleSheets.service.md) — tab routing, projections, Master vs Source Company Sheet writes

## Related rules

- [`sheet-sync-process.mdc`](../rules/sheet-sync-process.mdc) — outbox architecture, headers, backfill runbooks, failure semantics

## When to read this vs other docs

- **This file:** scheduling modes, outbox/queue/collections, coordinator API, drainer lifecycle, domain integration.
- **`googleSheets.service.md`:** row content, tab routing, upsert/delete mechanics.
- **`rules/sheet-sync-process.mdc`:** software-layer process details in depth.
