---
type: Service
title: Job Number timeline
description: Owner-only typed Job Number chain from the prototype assembler. Not the Granot lifecycle forensic timeline.
tags: [job-number, admin]
status: draft
stale_after: 2026-11-24
resource: scripts/prototypes/job-number-timeline/src/assemble.ts
applies_to:
  - scripts/prototypes/job-number-timeline/src/assemble.ts
  - scripts/prototypes/job-number-timeline/src/load.ts
  - scripts/prototypes/job-number-timeline/src/masking.ts
  - scripts/prototypes/job-number-timeline/src/cli.ts
  - src/routes/job-number-timeline-admin.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: scripts/prototypes/job-number-timeline/src/assemble.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-26T19:14:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `scripts/prototypes/job-number-timeline/src/assemble.ts`, `src/routes/job-number-timeline-admin.routes.ts`  
**Enhancement workspace (not shipped):** [`../../job-number-timeline/README.md`](../../job-number-timeline/README.md) — JTE-01 moves primary code to `src/services/jobNumberTimeline/`.  
**Domain terms used:** [Job Number](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md)

# Job Number timeline

**Role:** Typed [Job Number](../../../../CONTEXT.md) retrieval for the Owner. Assembles one owner-facing chain — including events that happened before the Lead had a Job Number — plus the [Sheet Sync](../../../../CONTEXT.md) jobs those writes requested. There is no Job Number catalog.

This is not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`. That forensic page is [`projections.md`](../granot-lifecycle/projections.md) (`GranotTimelineEntry`). This path does not call `projections.ts`.

## HTTP

`GET /api/v1/admin/job-number-timeline` on `job-number-timeline-admin.routes.ts`, mounted after the `/api/v1` guard next to Granot lifecycle admin.

| Query | Required | Notes |
| --- | --- | --- |
| `job_no` | yes | Trimmed, min length 1. Zod miss → `400` `{ ok: false, error: "invalid_job_number" }` |
| `source_granularity_id` | no | Optional filter |
| `source_company_id` | no | Loads company granularities; a granularity that is not in that company → `filtered_out` |

Owner-only (`requireRegistryOwnerActor`). Admin `403`. Success envelope is always `{ ok: true, data: JobTimelineAssembleResult }` (HTTP `200`), including assembler `not_found` / `filtered_out` / `invalid_job_number`. On `status: "ok"`, the route redacts `page` with `redactTimelineValue` before transport.

The HTTP read uses the server's connected Mongo (`connectMongo` / `TEST_MODE`). It does not apply the CLI production-confirm flag.

## Assembler

`assembleJobNumberTimeline` is a pure function over injected rows (`rawJobNo`, optional filters, `rows`). Tests inject fixtures; the route and CLI load via `loadJobNumberTimelineRows`.

`JobTimelineAssembleResult`:

| `status` | When |
| --- | --- |
| `ok` | First hop found a job-scoped row and optional source filters matched; `page` is `JobTimelinePage` |
| `invalid_job_number` | Typed value does not normalize |
| `not_found` | No observation, record link, booking, booking/release case, or discrepancy on the first hop |
| `filtered_out` | Job exists, but no resolved scope matches the requested granularity/company |

`page.events` kinds (type priority 10–110): `lead_created`, `lead_message`, `job_number_acquired`, `lead_updated`, `granot_observation`, `synchronization_decision`, `booking_intake`, `cancellation_intake`, `official_booking`, `official_cancellation`, `sheet_sync`.

## CLI

```text
pnpm prototype:job-number-timeline -- render --job-no <raw>
pnpm prototype:job-number-timeline -- discover
pnpm test:prototype:job-number-timeline
```

Modes are only `render` and `discover`. There is no list mode. Optional `--source-granularity-id`, `--source-company-id`; discover also `--limit` and `--min-score`. Default live target is `testvantagemovers`. Production reads require `--confirm-production-db=vantagemovers`. No Mongo, Sheet, or CRM writes. Local gitignored reports may land under `scripts/output/job-number-timeline/`.

## Related

- Prototype README: [`scripts/prototypes/job-number-timeline/README.md`](../../../scripts/prototypes/job-number-timeline/README.md)
- Forensic Granot job/lead reads: [`projections.md`](../granot-lifecycle/projections.md)
- Admin tab `/job-timeline` and `lib/api/jobNumberTimeline.ts` live in `vantage-admin` (Owner-only page and proxy path)
