---
type: Service
title: Job Number timeline
description: Owner-only typed Job Number read. The HTTP route serves milestones only (Lead arrival, first Job Number link, each official Booking and Cancellation). The detailed evidence assembly remains for scoped callers and tests. Not the Granot lifecycle forensic timeline.
tags: [job-number, admin]
status: draft
stale_after: 2026-12-19
resource: src/services/jobNumberTimeline/module.ts
applies_to:
  - src/services/jobNumberTimeline/**
  - src/routes/job-number-timeline-admin.routes.ts
  - ops/verify-granot-history-archive.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/jobNumberTimeline/module.ts
  - id: release-2026-11-19
    resource: docs/operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md
    title: Daily Operations, canonical commands and Master Sheets release (2026-11-19)
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-28T01:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/jobNumberTimeline/` (`createJobNumberTimelineModule`)  
**Latest release record:** [2026-11-19 release, "Daily Operations and job number timeline"](../../operations/DAILY-COMMANDS-MASTER-SHEETS-RELEASE-2026-11-19.md)  
**Domain terms used:** [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Granot Record Link](../../../../CONTEXT.md), [Entity Change](../../../../CONTEXT.md)

# Job Number timeline

The Owner route reads one Job Number on demand and returns its major milestones. It stores nothing. It is not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`; that forensic page is [`projections.md`](../granot-lifecycle/projections.md). This module does not call `projections.ts`.

Callers use `createJobNumberTimelineModule({ loader, milestonesOnly? }).read(...)`. Tests use the memory loader; production uses `createMongoEvidenceLoader`. No file under `src/` imports a CLI.

## HTTP

`GET /api/v1/admin/job-number-timeline` on [`job-number-timeline-admin.routes.ts`](../../../src/routes/job-number-timeline-admin.routes.ts), mounted after the `/api/v1` guard.

| Query | Required | Notes |
| --- | --- | --- |
| `job_no` | yes | Trimmed, min length 1. Zod miss → `400` `{ ok: false, error: "invalid_job_number" }` |
| `source_granularity_id` | no | Optional filter |
| `source_company_id` | no | Loads company granularities; a granularity outside that company → `filtered_out` |

Owner-only (`requireRegistryOwnerActor`). Admin gets 403. Success is always HTTP 200 `{ ok: true, data: JobTimelineAssembleResult }`, including `not_found`, `filtered_out` and `invalid_job_number`. Unhandled failures return HTTP 500 `{ ok: false, error: "Internal error" }` and log the real message with `request_id`.

The route builds the module with `createMongoEvidenceLoader({ db, milestonesOnly: true })` and `milestonesOnly: true`. It reads through the server's Mongo connection.

`GET /api/v1/admin/job-number-timeline/recent-official-bookings` is a separate Owner-only sample, registered first ([`recent-official-bookings.ts`](../../../src/services/jobNumberTimeline/recent-official-bookings.ts)). It returns at most three `{ job_no, booked_at }` from `booked_leads`, newest `book_date` first. Projection: `job_no`, `normalized_job_no`, `book_date`, `createdAt`, `timestamp`. No contact. It is not a catalog or a list.

## Milestones (Owner HTTP read)

Since 49f9d8d5 and 3f01cfd3 (2026-11-19), `milestonesOnly` pages contain only these event kinds (`milestoneEvents` in [`assemble.ts`](../../../src/services/jobNumberTimeline/assemble.ts)):

| Kind | Clock | Rule |
| --- | --- | --- |
| `lead_created` | Lead arrival instant (`leadArrivalInstant` from `dailyOperations/leadDay.ts`), reported as `lead.timestamp`; else `lead.createdAt` | Only when a Lead resolves. Coverage `official_fact_only` |
| `job_number_acquired` | Earliest of `record_link.established_at` and Lead `entity_change.applied_at` where a stored `job_no`/`normalized_job_no` after-value matches | At most one. Coverage `evidence_only`. Headline "First recorded Job Number link" |
| `official_booking` | `booking.createdAt` (recorded), else `booking.book_date` | One per loaded Booking. The headline names the business book date |
| `official_booking` (restored) | `cancellation.booking_created_at_snapshot`, else `cancellation.book_date` | When a Cancellation references a Booking that is no longer loaded |
| `official_cancellation` | `cancellation.createdAt` (recorded), else `cancellation.cancel_date` | Every Cancellation linked to a loaded Booking or attached by `normalized_job_no_snapshot`. The headline names the business cancel date |

Recorded instants and business dates are distinct. The event clock is the recording instant; `book_date` and `cancel_date` appear only in headlines.

A Granot transport observation supplies no link date. A leadless official Booking or Cancellation stands alone. When no Record Link, Booking, Decision or Cancellation names a Lead, the loader takes a Lead only if exactly one Form or Call Lead matches the Job Number (`findUniqueJobLead`). In milestone mode that match does not require an accepted Granot observation.

Milestone pages also:

- skip the 250-event cap;
- keep only the `origin`, `qualification`, `booking` and `cancellation` stage assessments;
- keep only the `MULTI_QUERY_READ` limitation;
- keep attention and freshness as computed.

Measured on four production jobs (release record, 2026-11-19): milestone reads took 11–12 MongoDB read commands versus 14–17 for the detailed read, and 6,308–15,762 BSON reply bytes versus 9,346–36,469. Events fell from 5–19 to 1–4. Milestone queries took 193–461 ms from the measurement client. The change saves zero event writes and zero retained bytes; the timeline never stored events.

## Detailed assembly

Without `milestonesOnly`, `assembleJobNumberTimeline` builds the full v1 chain and `projectEnhancedPage` wraps it as `schema_version: "job_timeline.v2"`. The memory-loader tests, golden pages (`golden-pages.ts`) and [`ops/verify-granot-history-archive.ts`](../../../ops/verify-granot-history-archive.ts) use it. No production route uses it.

`page.events` kinds (type priority 5–110): `source_received` (5), `lead_created` (10), `lead_message` (20), `job_number_acquired` (30), `lead_updated` (40), `granot_observation` (50), `synchronization_decision` (60), `booking_intake` (70), `cancellation_intake` (80), `official_booking` (90), `official_cancellation` (100), `sheet_sync` (110). The cap is 250 (`JOB_TIMELINE_EVENT_CAP`); overflow is a named `TIMELINE_TRUNCATED` limitation.

`source_received` needs a durable ingress row: a loaded Granot Observation Receipt, a qualified RingCentral processed-call row (`lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`), or a loaded WordPress Form Submission Receipt.

Evaluators: `outcome.ts` (`evaluateCurrentOutcome`, `assessStages`, `outcomeHeadline`) and `attention.ts` (`evaluateAttention`, `evaluateLimitations`, `evaluateFreshness`). Always-on detailed limitations: `MULTI_QUERY_READ`, `MOVE_COMPLETION_UNAVAILABLE`, `GOOGLE_DESTINATION_UNVERIFIED`. A snapshot-recovered Cancellation without a live Booking is `cancelled` plus `OFFICIAL_BOOKING_UNAVAILABLE`, not `contradictory`. Sheet `synced` means outbox completion, not Google equality.

Loader options (`JobTimelineMongoReadBounds` in [`mongo-evidence-loader.ts`](../../../src/services/jobNumberTimeline/mongo-evidence-loader.ts)):

- `includeTransportEvidence`: loads `granot_observations`, their Synchronization Decisions and receipts (hot `granot_webhook_receipts`, then `granot_archived_receipts`), and the Granot history archive. Without it (since c55f61a7) no observation, decision or receipt is read, so no Granot `source_received` is emitted.
- `maxRowsPerQuery` (1–2,000): every cursor fetches one sentinel row over the bound with a five-second limit; overflow throws `JobTimelineEvidenceLimitError` (`EVIDENCE_LIMIT_REACHED`). Only `ops/verify-granot-history-archive.ts` passes it today.
- `milestonesOnly`: skips Lead Messages, processed calls, WordPress receipts, Booking and Cancellation Entity Changes and Sheet Sync jobs, and filters Lead Entity Changes to `changed_paths` `job_no` / `normalized_job_no`.

Safe projections only: no payload, headers, phone, transcript, recording, `last_error` or `spreadsheet_id`. Redaction happens inside the module on `status: "ok"`.

## Result statuses

| `status` | When |
| --- | --- |
| `ok` | A first-hop row or a unique Lead match exists and source filters matched |
| `invalid_job_number` | The typed value does not normalize |
| `not_found` | No Record Link, Booking, booking/release case, discrepancy, observation, snapshot Cancellation or unique Lead |
| `filtered_out` | The job exists but no resolved scope matches the requested granularity/company |

## Storage, indexes and read paths

The timeline owns no collection and writes nothing. It reads other services' collections per request. Job Number matching uses `equivalentNormalizedJobFilter` (`bookings/bookingIdentity.ts`): an exact `normalized_job_no`, its digit core, and the anchored regex `^[A-Z]+<core>$`.

Milestone-mode reads, in order, with the declared index that fits (code declarations; production plans for this route are unmeasured except the release record's read counts):

| Collection | Query | Declared index |
| --- | --- | --- |
| `granot_record_links` | job filter | None fits. `granot_record_link_active_job_unique` is `{ provider, normalized_job_no }`, partial `state: "active"`; the query has neither field |
| `booked_leads` | job filter | `booked_lead_normalized_job_no_unique`, partial `normalized_job_no: { $type: "string" }` |
| `granot_booking_reconciliation_cases` | job filter | `granot_booking_case_job_kind_sequence_unique` prefix |
| `granot_release_reconciliation_cases` | job filter | `granot_release_case_job_kind_sequence_unique` prefix |
| `granot_booking_discrepancies` | job filter | None fits. `granot_booking_discrepancy_open_fingerprint_unique` is partial `state: "open"` |
| `granot_release_discrepancies` | job filter | None fits. `granot_release_discrepancy_open_fingerprint_unique` is partial `state: "open"` |
| `ringcentral_call_log_sync_state` | `findOne({ key: "account" })` | Single-document lookup; feeds freshness only |
| `cancelled_leads` | `{ booked_lead: { $in } }` and the snapshot job filter | `booked_lead` field index; `cancelled_lead_normalized_job_no_snapshot` (partial `$type: "string"`) |
| `form_leads`, `call_leads` | job filter, `limit(2)`, only when no Lead ref resolved | `form_lead_normalized_job_no`; `{ normalized_job_no: 1 }` |
| `form_leads` or `call_leads` | `findOne({ _id })` | `_id` |
| `entity_changes` | `{ entity.model, entity.id, changed_paths: { $in: ["job_no", "normalized_job_no"] } }` | `entity_change_entity_applied` or `entity_change_entity_revision_unique` prefix |
| `lead_source_granularities` | `{ _id: { $in } }` | `_id` |

`recent-official-bookings` reads `booked_leads` with `$or` on non-empty `job_no` / `normalized_job_no`, sorted `{ book_date: -1, createdAt: -1 }`, limit 3. No declared `booked_leads` index leads with `book_date`.

Retention: none owned. The milestones depend on Record Links, official Bookings and Cancellations (including their immutable `*_snapshot` fields) and Lead Entity Changes staying in MongoDB. See [`domain-commands.md`](./domain-commands.md) for why `entity_changes` has no expiry.

### Observations for the index phase

- Record Link and discrepancy job lookups have no fitting declared index. Each Owner timeline read issues them.
- The regex arm of the job filter is anchored but starts with a character class, so its index bounds span every key that begins with a letter. Its cost is unmeasured.
- `recent-official-bookings` sorts `booked_leads` by `book_date` with no supporting index. Its cost is unmeasured.
- The call-log cursor read runs on every milestone read although milestone pages drop the `RINGCENTRAL_CURSOR_BOUNDED` limitation; it still feeds `freshness.ringcentral_covered_through`.

## CLI

`package.json` still defines `prototype:job-number-timeline` and `test:prototype:job-number-timeline` under `scripts/prototypes/job-number-timeline/`. `scripts/` has been local-only since ce5f856c (2026-09-24), so the CLI is not in a clean checkout. It is not a supported path.

## Related

- Forensic Granot job/lead reads: [`projections.md`](../granot-lifecycle/projections.md)
- Lead arrival rule: [`daily-operations.md`](./daily-operations.md) (`leadDay.ts`)
- Cancellation snapshots: [`cancelled-lead.md`](./cancelled-lead.md)
- Admin page `/leads/timeline` (`JOB_TIMELINE_HREF`) and `lib/api/jobNumberTimeline.ts` live in `vantage-admin` (Owner-only). Admin copies DTO types; they are never the semantic authority. Deep links use `buildJobTimelineHref({ job })`.
