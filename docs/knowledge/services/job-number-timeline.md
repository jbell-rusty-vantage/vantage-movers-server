---
type: Service
title: Job Number timeline
description: Owner-only typed Job Number chain from the production module. Not the Granot lifecycle forensic timeline.
tags: [job-number, admin]
status: draft
stale_after: 2026-11-27
resource: src/services/jobNumberTimeline/module.ts
applies_to:
  - src/services/jobNumberTimeline/**
  - src/routes/job-number-timeline-admin.routes.ts
  - scripts/prototypes/job-number-timeline/src/cli.ts
  - scripts/prototypes/job-number-timeline/src/discover.ts
  - scripts/prototypes/job-number-timeline/src/live-proof.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/jobNumberTimeline/module.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-28T00:25:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/jobNumberTimeline/` (`createJobNumberTimelineModule`)  
**CLI / proof adapter:** [`scripts/prototypes/job-number-timeline/`](../../../scripts/prototypes/job-number-timeline/README.md)  
**Enhancement workspace:** [`../../job-number-timeline/README.md`](../../job-number-timeline/README.md) — JTE-01 extract, JTE-02 v2 projection, JTE-03 evaluators, JTE-04 Admin UI, JTE-05 (live proof, deep links), JTE-06 (cancellation correlation snapshots), and JTE-07 (WordPress Form Submission Receipt capture) shipped.  
**Domain terms used:** [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md)

# Job Number timeline

**Role:** Typed [Job Number](../../../../CONTEXT.md) retrieval for the Owner. Assembles one owner-facing chain — including events that happened before the Lead had a Job Number — plus the [Sheet Sync](../../../../CONTEXT.md) jobs those writes requested. There is no Job Number catalog.

This is not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`. That forensic page is [`projections.md`](../granot-lifecycle/projections.md) (`GranotTimelineEntry`). This path does not call `projections.ts`.

Runtime code lives in `src/services/jobNumberTimeline/`. Callers use `createJobNumberTimelineModule({ loader }).read(...)`. The HTTP route and the CLI `render` / `discover` / `proof` modes call that same interface. Tests use a memory loader; production uses a Mongo loader. No file under `src/` imports `scripts/prototypes/job-number-timeline`.

Internal v2 files: `projector.ts`, `evidence.ts`, `clocks.ts`, `outcome.ts`, `attention.ts`. Golden pages: `golden-pages.ts`.

## HTTP

`GET /api/v1/admin/job-number-timeline` on `job-number-timeline-admin.routes.ts`, mounted after the `/api/v1` guard next to Granot lifecycle admin.

| Query | Required | Notes |
| --- | --- | --- |
| `job_no` | yes | Trimmed, min length 1. Zod miss → `400` `{ ok: false, error: "invalid_job_number" }` |
| `source_granularity_id` | no | Optional filter |
| `source_company_id` | no | Loads company granularities; a granularity that is not in that company → `filtered_out` |

Owner-only (`requireRegistryOwnerActor`). Admin `403`. Success envelope is always `{ ok: true, data: JobTimelineAssembleResult }` (HTTP `200`), including assembler `not_found` / `filtered_out` / `invalid_job_number`.

The route stays authorize → validate → `module.read` → respond. Redaction of `page` happens inside the module on `status: "ok"`.

The HTTP read uses the server's connected Mongo (`connectMongo` / `TEST_MODE`). It does not apply the CLI production-confirm flag.

## Module

`createJobNumberTimelineModule({ loader }).read({ job_no, source_granularity_id?, source_company_id?, now? })`.

The seam is unchanged from JTE-01. Callers do not know collection names, walk-back order, sort priorities, or redaction rules. The module passes `input.now ?? new Date()` into assemble as `assembled_at` and `freshness.mongo_read_at`.

`assembleJobNumberTimeline` remains a pure function over injected rows. It builds the v1 chain, then `projectEnhancedPage` wraps an `ok` page. The module normalizes the typed Job Number, loads company granularities when a company filter is present, loads rows through the loader, assembles, and redacts.

`JobTimelineAssembleResult`:

| `status` | When |
| --- | --- |
| `ok` | First hop found a job-scoped row and optional source filters matched; `page` is `EnhancedJobTimelinePage` with `schema_version: "job_timeline.v2"` |
| `invalid_job_number` | Typed value does not normalize |
| `not_found` | No observation, record link, booking, booking/release case, or discrepancy on the first hop |
| `filtered_out` | Job exists, but no resolved scope matches the requested granularity/company |

Every v1 page and event field remains (`event_at`, `clock_field`, `coverage`, `headline`, safe `data`).

`page.events` kinds (type priority 5–110): `source_received` (5), `lead_created` (10), `lead_message` (20), `job_number_acquired` (30), `lead_updated` (40), `granot_observation` (50), `synchronization_decision` (60), `booking_intake` (70), `cancellation_intake` (80), `official_booking` (90), `official_cancellation` (100), `sheet_sync` (110).

`source_received` is emitted only when a durable ingress fact was loaded:

- Granot: observation has a `receipt_id` and that [Granot Observation Receipt](../../../../CONTEXT.md) is in the loaded rows.
- RingCentral: resolved [Call Lead](../../../../CONTEXT.md) plus a processed-call ledger row whose `callLeadId` matches and whose status is `lead_created`, `lead_created_duplicate`, `lead_adopted`, or `lead_adopted_duplicate`.
- WordPress: a [WordPress Form Submission Receipt](../../../../CONTEXT.md) row is loaded and its `lead_ref` matches the Form Lead. `assemble.ts` then emits `source_received` with `ingress: "wordpress"`. No receipt row → no invented WordPress receipt event; `lead_created` stays the origin row.

Each event has dual clocks (`time.occurred_at` / `time.recorded_at`). Default order is still `occurred_at` ASC, then type priority, then id. Events also carry `evidence_level`, `stage`, `correlation`, and `causality.activity_id`. `activities` group related rows; grouping does not delete events. Official Booking and official Cancellation keep independent activity ids.

Cap is 250 (`JOB_TIMELINE_EVENT_CAP`). Overflow is a named `TIMELINE_TRUNCATED` limitation with `counts_by_stage` of the omitted events. Never a silent drop.

### Evaluators (JTE-03 shipped)

The module evaluates page-level v2 fields after events and activities are finalized. `projector.ts` calls the evaluators. The external seam is unchanged: `createJobNumberTimelineModule({ loader }).read`. The HTTP route still only authorize → validate → `module.read` → respond. Tests call that same interface.

JTE-03 evaluators shipped. JTE-04 Admin UI shipped — it displays these arrays; it does not recompute them.

`outcome.ts` owns current outcome and stage assessments:

- `evaluateCurrentOutcome` uses specification §4.2 precedence, not last-event-wins. Intake is never the official outcome.
- `assessStages` emits one assessment per §4.1 stage. Labels follow §9.2. States are expectation-aware (`complete`, `active`, `not_started`, `not_applicable`, `attention`, `unverifiable`).
- `outcomeHeadline` fills `summary.headline` from the decided outcome.

On `ok`, `page` stays `EnhancedJobTimelinePage` with `schema_version: "job_timeline.v2"`. Every v1 field and every JTE-02 event field remains.

`current_outcome` values: `lead_active` | `booking_intake_open` | `booked` | `cancellation_intake_open` | `cancelled` | `contradictory` | `unknown`.

`attention.ts` owns one evaluator per specification §8 attention and limitation code, plus freshness:

- `evaluateAttention` / `evaluateLimitations` / `evaluateFreshness`
- `SHEET_SYNC_PENDING_TOO_LONG_MS` default is 1 hour (module constant, not `process.env`)

Always emit limitations: `MULTI_QUERY_READ`, `MOVE_COMPLETION_UNAVAILABLE`, `GOOGLE_DESTINATION_UNVERIFIED`. Keep `TIMELINE_TRUNCATED` when the 250 cap hits. Do not invent extra §8 codes.

WordPress-born pages emit `WORDPRESS_RECEIPT_UNAVAILABLE` until a **WordPress** `source_received` exists (`ingress: "wordpress"`). A later Granot receipt does not clear that limitation. `goldenWordpressRows` / `wordpressRows()` job `9001001` stays the no-receipt WordPress golden. RingCentral-born pages emit `RINGCENTRAL_CURSOR_BOUNDED` and fill `freshness.ringcentral_covered_through` plus `ringcentral_cursor_lag_seconds`. `freshness.google_destination_readback` stays `"not_performed"`. `freshness.consistency` stays `"multi_query_best_effort"`.

Sheet `synced` means outbox completion, not Google equality. Delivery stage is `unverifiable` even when every outbox job is synced. Move completion is a limitation, never a stage or event.

Golden pages for Admin fixtures live in `golden-pages.ts` (`GOLDEN_EXPECTATIONS`, `ALWAYS_LIMITATION_CODES`, plus extra builders for policy skip, resolved-without-fact, contradictory chronology, and open cancellation intake). Admin displays those arrays; it must not recompute them.

### Residuals

- JTE-01: CLI company/granularity mismatch prints `filtered_out` (exit 0).
- JTE-02: the module stamps `assembled_at` with `input.now ?? new Date()`. RingCentral `source_received` is qualified ledger statuses only (`lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`).
- JTE-07 shipped: WordPress `source_received` only when a [WordPress Form Submission Receipt](../../../../CONTEXT.md) is loaded. Capture writes live on the authorized test path in Form Lead create — see [`form-lead.md`](./form-lead.md). `/daily` does not exist.

### Loader

Mongo loader reads observations, latest decisions, record links, bookings, cancellations, booking/release cases, discrepancies, leads, entity changes, lead messages, sheet sync jobs, Granot CRM sources, and granularities. It also reads:

- `granot_webhook_receipts` (safe projection: `captured_at`, `createdAt`, `route_event_class`, `observation_channel`, `channel_operation_kind`, `processing.state`)
- `wordpress_form_submission_receipts` by indexed `lead_ref.id` when the resolved lead is a Form Lead (safe projection: `received_at`, `createdAt`, `processing_status`, `lead_ref.id`). No collection scan.
- processed-call ledger via `getRingCentralCollectionName("processedCalls")` (`ringcentral_processed_calls`: `status`, `qualificationReason`, `firstProcessedAt`, `updatedAt`, `ingestionSource`, `duplicate`, `callLeadId`)
- call-log cursor via `getRingCentralCollectionName("callLogSyncState")` (`ringcentral_call_log_sync_state`, `{ key: "account" }`)

Safe projections only: no payload, headers, phone, transcript, recording, `last_error`, or `spreadsheet_id`.

Cancellations load by Booking id (`booked_lead` in the loaded bookings), merged with an indexed hop on `cancelled_leads.normalized_job_no_snapshot` via `equivalentNormalizedJobSnapshotFilter` when that snapshot is present. No collection scan. Assemble still refuses orphans without a durable job snapshot (named tests `orphan cancellation is not attached without durable job snapshot` and `cancellation snapshot restores exact job correlation`).

## CLI

```text
pnpm prototype:job-number-timeline -- render --job-no <raw>
pnpm prototype:job-number-timeline -- discover
pnpm prototype:job-number-timeline -- proof --max-jobs 200 --warm-runs 12
pnpm test:prototype:job-number-timeline
```

Modes are `render`, `discover`, and `proof`. There is no list mode. Optional `--source-granularity-id`, `--source-company-id`; discover also `--limit` and `--min-score`; proof also `--max-jobs` and `--warm-runs`. Default live target is `testvantagemovers`. Production reads require `--confirm-production-db=vantagemovers` plus explicit user approval. No Mongo, Sheet, or CRM writes. Local gitignored reports may land under `scripts/output/job-number-timeline/`.

`render`, `discover`, and `proof` call `createJobNumberTimelineModule`. `discover.ts` remains a CLI-only ranking helper. It is not an HTTP catalog. `proof` (`live-proof.ts`) is read-only, count-stable, and masks Job Numbers as `JOB-n`. JTE-05 named test `serialized v2 page contains no forbidden fields or contact` serializes all 10 v2 goldens via `assertPageSafe`. No evaluator or projection semantics changed.

A company/granularity mismatch prints `filtered_out` and exits 0 (JTE-01 residual).

## Related

- Prototype README: [`scripts/prototypes/job-number-timeline/README.md`](../../../scripts/prototypes/job-number-timeline/README.md)
- Forensic Granot job/lead reads: [`projections.md`](../granot-lifecycle/projections.md)
- Admin tab `/job-timeline` and `lib/api/jobNumberTimeline.ts` live in `vantage-admin` (Owner-only page and proxy path). JTE-04 shipped: Admin consumes the server v2 page and copies DTO types additively. Admin types are never the semantic authority. JTE-05 shipped: CLI `proof` mode; Owner deep links via `JobTimelineDeepLink` / `buildJobTimelineHref({ job })` on Lead / Booking / Cancellation / intake surfaces. JTE-06 shipped: official Cancellation create stamps four immutable correlation snapshots; Mongo hops by indexed `normalized_job_no_snapshot`. JTE-07 shipped: WordPress `source_received` when a receipt row is loaded; Admin still renders the no-receipt golden / `WORDPRESS_RECEIPT_UNAVAILABLE` until that ingress exists. `/daily` does not exist.
