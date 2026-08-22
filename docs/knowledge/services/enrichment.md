---
type: Service
title: Call Lead Enrichment
description: Preview and sync Granot Follow Up rows onto Call Leads. Extension and HTTP automation final-apply no longer call this path.
tags: [call-lead, enrichment]
status: draft
stale_after: 2026-09-21
resource: src/services/enrichment/callLeadEnrichment.service.ts
applies_to:
  - src/services/enrichment/callLeadEnrichment.service.ts
  - src/services/enrichment/callLeadEnrichmentRows.ts
  - src/routes/v1.routes.ts
  - src/routes/extension-granot-apply.routes.ts
  - src/services/granotCrmCsv/sync.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/enrichment/callLeadEnrichment.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T01:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)
**Primary code:** `src/services/enrichment/callLeadEnrichment.service.ts`, `src/services/enrichment/callLeadEnrichmentRows.ts`
**Domain terms used:** [Call Lead Enrichment](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Call Lead Enrichment

**Role:** Preview/sync Granot **Follow Up** row batches onto existing Call Leads. Does not create Call Leads or Bookings. Distinct from booked-jobs reconciliation ([`booked-call-lead-reconciliation.md`](./booked-call-lead-reconciliation.md)).

**System of Record:** MongoDB `call_leads`. Granot rows are an input, not linkage authority.

## HTTP

| Route | Function | Persists Call Lead? |
|-------|----------|---------------------|
| `POST /api/v1/call-leads/enrichment/preview` (`v1.routes.ts`) | `previewCallLeadEnrichment` | No |
| `POST /api/v1/call-leads/enrichment/sync` (`extension-granot-apply.routes.ts`) | `applyExtensionGranotItem` — Owner only; body is `lead_snapshot_apply` items | Receipt capture + shared processor. Does **not** call `syncCallLeadEnrichment`. Checked-in Lead-write flags stay false. |

`syncCallLeadEnrichment` remains the write helper for Granot CSV Follow Up ingest (`granotCrmCsv/sync.service.ts`). HTTP automation final-apply also does not call it.

## Preview / match (`resolveEnrichmentRow`)

Statuses: `invalid` | `no_match` | `conflict` | `updateable` | `unchanged` (preview). Sync may then emit `updated` or `failed`.

1. Parse the CRM row (`parseEnrichmentRow`). `invalid` when neither a normalized phone nor `job_no` remains.
2. Phone first (up to 25 candidates, newest `timestamp`/`createdAt`). Prefer not booked and not cancelled; if that pool is empty, use the booked/cancelled candidates. Keep only source-compatible or unassigned leads. None compatible → `conflict` (assigned source mismatch). Several compatible → newest + warning. Unassigned match warns that sync will claim the CRM source.
3. If phone found no compatible lead, try `job_no` (up to 5). Same source pool rules.
4. Match method is `phone_and_job_no`, `phone_only`, `job_no_only`, or `none`.
5. Existing stored `job_no` that differs from the CRM row → warning; sync will **not** overwrite `job_no`.
6. Booked Call Leads can still be `updateable` (field refresh) or `unchanged` (idempotent). This path never creates a Call Lead or Booking.

Happy path: source-compatible phone match, new `job_no` / contact / location fields → `updateable`. Skip/fail: no phone and no job → `invalid`; phone exists only on a different assigned Source Company → `conflict` (no write); unknown identifiers → `no_match`.

## Sync (`syncCallLeadEnrichment` — CSV / tests)

Per row, inside a Mongo transaction after re-reading the Call Lead:

- Optional identity guards: `expectedCallLeadId`, `expectedUpdatedAt`, `expectedReceiverAgent` / `targetReceiverAgent`. Drift throws and becomes `failed`.
- Writes only when preview status is `updateable` or `unchanged` **and** there is a field update or a receiver-agent change. `conflict` / `no_match` / `invalid` do not write (tests cover the assigned-source conflict).
- Receiver agent uses `applyGranotCrmUsernameReceiverMatch`. `already_linked` warns and does not overwrite. `not_found` warns. `matched` copies the approved snapshots onto the re-read lead.
- `resolveLeadCplSnapshot` runs only when the update includes `local` or `source_company`.
- Persist `resource: source_lead`, `operation: call_lead.enrichment.sync`, then `finalizeSheetSync`.
- Does not write phone or `move_date`. Unknown CRM source labels are skipped with a warning during parse (unless `VANTAGE_TEST_RUNNER=true`, which skips catalog resolve).

## Related

- [`call-lead.md`](./call-lead.md), [`sheet-sync.md`](./sheet-sync.md)
- [`extension-apply.md`](../granot-lifecycle/extension-apply.md) — `/enrichment/sync` URL
- [`granot-http-collector.md`](./granot-http-collector.md)
- [`granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc)
