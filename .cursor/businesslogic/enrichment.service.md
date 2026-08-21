---
type: Service
title: Call Lead Enrichment
description: Preview and sync Granot Follow Up rows onto Call Leads. Extension and HTTP automation final-apply no longer call this path.
tags: [call-lead, enrichment]
status: draft
stale_after: 2026-09-20
resource: src/services/enrichment/callLeadEnrichment.service.ts
applies_to:
  - src/services/enrichment/callLeadEnrichment.service.ts
  - src/services/enrichment/callLeadEnrichmentRows.ts
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
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)
**Primary code:** `src/services/enrichment/callLeadEnrichment.service.ts`, `src/services/enrichment/callLeadEnrichmentRows.ts`
**Domain terms used:** [Call Lead Enrichment](../../../CONTEXT.md), [Call Lead](../../../CONTEXT.md), [Job Number](../../../CONTEXT.md), [Sheet Sync](../../../CONTEXT.md), [System of Record](../../../CONTEXT.md)

# Call Lead Enrichment

**Role:** Preview/sync Granot **Follow Up** row batches onto existing Call Leads. Does not create Call Leads or Bookings. Distinct from booked-jobs reconciliation ([`bookedCallLeadReconciliation.service.md`](bookedCallLeadReconciliation.service.md)).

**System of Record:** MongoDB `call_leads`. Granot rows are an input, not linkage authority.

## HTTP

| Route | Function | Persists? |
|-------|----------|-----------|
| `POST /api/v1/call-leads/enrichment/preview` | `previewCallLeadEnrichment` | No |
| `POST /api/v1/call-leads/enrichment/sync` | Owner extension receipt apply (`extensionApply.ts`) | Receipt capture only in Unit 16; Lead writes stay off |

`syncCallLeadEnrichment` remains for Granot CSV Follow Up ingest. Extension and HTTP automation final-apply URLs no longer call it. Preview is unchanged.

## Invariants

- Row must have phone and/or `job_no` after parsing; otherwise `invalid`.
- Match prefers phone, then job number. `conflict` when candidates exist but none are source-compatible with the CRM row.
- Prefer candidates that are not booked/cancelled; booked leads can still refresh fields.
- Existing **job_no mismatch** → warn and **skip job_no overwrite** on sync.
- Sync writes only when preview identity guards pass (`expectedCallLeadId`, `expectedUpdatedAt`, `expectedReceiverAgent` when supplied).
- Successful sync may set `receiver_agent` via Granot CRM username match and stores a CPL snapshot through `resolveLeadCplSnapshot`.
- Successful sync enqueues Sheet Sync `resource: source_lead`, `operation: call_lead.enrichment.sync` via `persistSheetSyncIntent` + `finalizeSheetSync` (not only `scheduleCallLeadSheetSync`).

## Related

- [`call-lead.service.md`](call-lead.service.md), [`sheetSync.service.md`](sheetSync.service.md)
- [`granotHttpCollector.service.md`](granotHttpCollector.service.md)
- [`granot-crm-csv-s3-sync.mdc`](../rules/granot-crm-csv-s3-sync.mdc)
