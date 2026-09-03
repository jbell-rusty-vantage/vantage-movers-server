---
type: Service
title: Best Relocation Ingestion
description: Fenced Best Relocation sheet inspect/preview/adopt/apply through canonical domain commands.
tags: [ingestion, best-relocation]
status: draft
stale_after: 2026-09-21
resource: src/services/ingestion/applyPlan.ts
applies_to:
  - src/services/ingestion/applyPlan.ts
  - src/services/ingestion/worker.ts
  - src/services/ingestion/repository.ts
  - src/services/ingestion/health.ts
  - src/services/bestRelocationSheetIngest/
  - scripts/best-relocation-sheet-ingest.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/ingestion/applyPlan.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-09-03T18:43:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/ingestion/`, `src/services/bestRelocationSheetIngest/` (`canonicalLeadAdoption.ts`, `sheets.ts`, `dryRunReports.ts`)  
**CLI:** `scripts/best-relocation-sheet-ingest.ts` (`pnpm ingest:best-relocation -- --dry-run`)  
**Domain terms used:** [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Source Company](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Best Relocation Ingestion

**System of Record:** MongoDB domain documents written only through canonical commands ([`domain-commands.md`](./domain-commands.md)). Best Relocation workbooks are the external evidence source. Ingestion runs, receipts, and conflicts (`IngestionRun`, `SourceRowReceipt`, `IngestionConflict`, `ExternalDataConnection` key `best_relocation`) are operational evidence, not a second Lead authority.

**Role:** Inspect Best Relocation sheets, plan create/update/adopt/conflict actions after the 2026-04-30 Eastern cutoff, and apply a checksum-bound plan under a single lease. This is not Sheet Sync and not Granot HTTP automation.

## HTTP / queue / cron

| Surface | Path | Notes |
|---------|------|-------|
| Connection | `GET/PATCH /api/v1/admin/ingestion/connections/best-relocation` | Read actor / Owner actor |
| Inspect | `POST .../inspect` | Read-only. `repair_identity=true` is Owner-gated and still 409 — repair runs only inside a fenced bootstrap/apply |
| Preview / queue | `POST .../preview` | Owner. `bootstrap` / `dry_run` / default `manual` → `createQueuedIngestionRun` + 202 |
| Approve apply | `POST .../run` | Owner. `{ run_id, plan_checksum }` while `awaiting_approval` |
| Retry | `POST .../runs/:runId/retry` | Owner + env gate |
| Conflicts | `GET .../conflicts`, `POST .../conflicts/:id/resolve` | Resolve delegates Booking attach to a canonical command |
| Queue | Best Relocation ingestion consumer | `runBestRelocationIngestionWorker` |
| Cron | Best Relocation ingest heartbeat | skips before source reads when gates are off |
| CLI dry-run | `pnpm ingest:best-relocation -- --dry-run` | Inspects Forms / Local Forms / Calls / Booked Deals / Refunds. Applies receipt skip when the connection exists, then `applyCanonicalAdoptionPolicy`. Writes sanitized `DRY-RUN-REPORT.md` / `dry-run-report.json` (no names, phones, or emails). `ingest-plan.json` stays restricted. CLI live apply is retired. |

`BEST_RELOCATION_INGEST_ENABLED` must be true before `application_enabled=true`, non-bootstrap apply, or retry. `application_enabled` also requires a completed bootstrap (`bootstrap_completed_at`). Cadence is 24 or 48 hours.

## Happy path

1. Owner queues a run (`preview` is mutation-free after planning; `manual` / `bootstrap` require later approval).
2. Worker claims `ingestion:best_relocation:apply` (5-minute lease). Approved applying runs are claimed first, then queued.
3. Planner reads sheets (readonly scope): Forms, Local Forms, Calls, Booked Deals, Refunds. Rows at or after `BEST_RELOCATION_CUTOFF` (`2026-04-30T04:00:00.000Z`, America/New_York midnight) may enter the plan. Pre-cutoff observations never become actions. `LID_BestRelo` is matching evidence only — never an action.
4. Owner approves with the exact `plan_checksum`. Altered plans fail before mutation. Open `blocking` / `critical` conflicts must be dispositioned first.
5. `applyBestRelocationPlan` walks actions under the held lease. `unchanged` counts as completed. Domain mutations go through `canonicalDomainCommands` with origin `external_sheet_ingestion` and a deterministic idempotency key. `adopt_existing` writes a receipt only and puts the adopted entity id on the dependency map so a later Booking can bind that Form Lead or Call Lead without minting a second Lead. `record_conflict` opens a conflict unless already dispositioned.
6. Checkpoint after each action. Resume uses `start_action_index` and does not replay successful actions.

Bootstrap remaps creates to receipt-only `adopt_existing` and does not run canonical adoption. Recurring preview / manual / schedule planning then applies receipt skip (`applySourceChangePolicy`) and **adopt-before-create** (`applyCanonicalAdoptionPolicy`). Receipt-skip and already-adopted actions stay as-is. A remaining Form Lead create becomes `adopt_existing` when exactly one Best Relocation Form Lead matches sheet `ref_no` / `lid` (Tracking Reference / LID), or — when that misses — unique phone + name + same America/New_York day on or after the cutoff (contact match skips Duplicate Leads). Two matches are `ambiguous_lead_match`. Zero matches stay a create. Call Leads adopt on phone + persisted timestamp (same two-match conflict). Bookings adopt on unique `normalized_job_no`. Refunds adopt an existing Cancellation for the Booking already on the dependency map. Adopt is receipt-only: no field upsert. Granot-minted Form Leads keep [Ingestion Origin](../../../../CONTEXT.md) `granot_lead_created`.

## Skip / fail paths

| Condition | Outcome |
|-----------|---------|
| Lease busy | `{ claimed: false, status: "lease_busy" }` — one owner only |
| Env or `application_enabled` off on applying / schedule / retry (not bootstrap) | run `skipped` / `DEPLOYMENT_GATE_DISABLED` |
| Failed dependency | dependent actions increment `skipped_dependencies` and continue |
| Row-scoped Zod / Conflict / NotFound / invalid Google request | row `failures`, run continues |
| Other errors or lost lease | throw; do not keep applying |
| Unmatched Booking | leadless Booking **plus** one reconciliation conflict |
| Unmatched refund | blocking conflict; never invent a Cancellation. Below-threshold / review-only refunds do not cancel |
| Missing source on a later plan | preserve canonical refs; **never delete** |
| Copied / malformed managed identities | block inspect/repair; preview never writes identity cells |

## Health alerts

`shouldAlertIngestionSignal` always alerts on structural failure, schema/formula drift, duplicate source identity, lease contention, and completed-with-errors. `zero_parsed_counts` alerts when `read_count === 0`. `unmatched_refunds`, `leadless_booking_growth`, and `conflict_growth` alert at count ≥ 5. Route errors never expose provider or source details.

## Related services

- [`domain-commands.md`](./domain-commands.md) — only mutation path
- [`bookings.md`](./bookings.md) / [`employee-bookings.md`](./employee-bookings.md) — leadless Booking + Owner case when a sheet Booking has no Lead
- [`form-lead.md`](./form-lead.md) — trusted `ingestion_origin=best_relocation_sheet` on sheet-minted creates; adopt does not rewrite Granot-minted `granot_lead_created`
- [`cancelled-lead.md`](./cancelled-lead.md) — Refunds become a Cancellation only when a Booking is already resolved
