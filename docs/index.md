---
okf_version: "0.2"
title: Vantage main server knowledge
description: Type-grouped entrypoint for agent-readable concepts.
---

# Vantage main server knowledge

Query stamped rows with `pnpm okf:query` (`--type Service`, `--tag`, `--status`, `--stale`). Paths below are current on disk. Pass 2–3 moves retarget Service rows to `docs/knowledge/`.

Glossary stays in workspace-root [`CONTEXT.md`](../CONTEXT.md) (absent in this standalone checkout). Do not redefine terms here.

## Service

Current bodies still live under `.cursor/businesslogic/` until Pass 2–3.

| Path | Description |
| --- | --- |
| [ringcentral-call-lead-qualification.md](knowledge/services/ringcentral-call-lead-qualification.md) | Qualify inbound RingCentral calls (120s) and promote them through shared ingest. |
| [operations-registry.md](knowledge/services/operations-registry.md) | Catalog, source, CPL, inbound-route, and Granot CRM source system of record. |
| [form-lead.service.md](../.cursor/businesslogic/form-lead.service.md) | Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync. |
| [call-lead.service.md](../.cursor/businesslogic/call-lead.service.md) | Create and update Call Leads (manual and RingCentral), duplicates, CPL, and sheet tabs. |
| [enrichment.service.md](../.cursor/businesslogic/enrichment.service.md) | Preview and sync Granot Follow Up rows onto Call Leads. |
| [bookings.service.md](../.cursor/businesslogic/bookings.service.md) | Booked Lead create/update/delete, from-source, referral, leadless, and booking-chain sync. |
| [bookedCallLeadReconciliation.service.md](../.cursor/businesslogic/bookedCallLeadReconciliation.service.md) | Refresh Call Leads and bookings from Granot Booked Jobs rows. |
| [cancelledLead.service.md](../.cursor/businesslogic/cancelledLead.service.md) | Cancelled Lead CRUD, booking resolve, snapshots, and cancellation-chain sync. |
| [cancellationMirror.service.md](../.cursor/businesslogic/cancellationMirror.service.md) | Stamp or clear `cancelled` on the source lead after a cancellation. |
| [customer.service.md](../.cursor/businesslogic/customer.service.md) | Customer CRUD and booking-time upsert from lead or contact. |
| [agentAllocation.service.md](../.cursor/businesslogic/agentAllocation.service.md) | Binder splits, catalog resolve, primary agent, and cancellation snapshot. |
| [sheetSync.service.md](../.cursor/businesslogic/sheetSync.service.md) | Write-behind outbox, queue wake-up, drainer, and sheet-sync modes. |
| [googleSheets.service.md](../.cursor/businesslogic/googleSheets.service.md) | Tab routing, projections, upsert/delete, and master vs source writes. |
| [domainCommands.service.md](../.cursor/businesslogic/domainCommands.service.md) | Transaction-owning command executor, adapters, and append-only EntityChange. |
| [formLeadSearch.service.md](../.cursor/businesslogic/formLeadSearch.service.md) | Scored Form Lead identity search, ambiguity, and duplicate quarantine. |
| [callLeadSearch.service.md](../.cursor/businesslogic/callLeadSearch.service.md) | OR-based Call Lead lookup and summaries. |
| [leadBrowse.service.md](../.cursor/businesslogic/leadBrowse.service.md) | Extension GET browse, pagination, and attachment chips. |
| [adminSearch.service.md](../.cursor/businesslogic/adminSearch.service.md) | Global admin free-text search across scoped resources. |
| [analytics.service.md](../.cursor/businesslogic/analytics.service.md) | Admin analytics reports, scopes, and overview/agent-sales siblings. |
| [catalog.service.md](../.cursor/businesslogic/catalog.service.md) | Agents/merchants read facade; mutations go through Operations Registry. |
| [testimonial.service.md](../.cursor/businesslogic/testimonial.service.md) | Read-only testimonials for the marketing site. |
| [granotHttpCollector.service.md](../.cursor/businesslogic/granotHttpCollector.service.md) | HTTP session collector; approved apply captures automation receipts. |
| [granotLifecycle.capture.md](../.cursor/businesslogic/granotLifecycle.capture.md) | Webhook and channel-neutral receipt capture; `{ receipt_id }` wake-up. |
| [granotLifecycle.extensionApply.md](../.cursor/businesslogic/granotLifecycle.extensionApply.md) | Owner extension apply items, receipt capture, and claim/process. |
| [granotLifecycle.automationApply.md](../.cursor/businesslogic/granotLifecycle.automationApply.md) | Owner-approved HTTP automation receipt apply. |
| [granotLifecycle.normalization.md](../.cursor/businesslogic/granotLifecycle.normalization.md) | One Observation per receipt; exact vocabulary; no matching or effects. |
| [granotLifecycle.sourcePolicy.md](../.cursor/businesslogic/granotLifecycle.sourcePolicy.md) | Fail-closed Registry policy and effect-gate snapshot; no effects. |
| [granotLifecycle.identity.md](../.cursor/businesslogic/granotLifecycle.identity.md) | Source-scoped Form/Call identity; read-only; consumed by the processor. |
| [granotLifecycle.desiredState.md](../.cursor/businesslogic/granotLifecycle.desiredState.md) | Desired-state planner and temporal compare; plans only, no writes. |
| [granotLifecycle.processor.md](../.cursor/businesslogic/granotLifecycle.processor.md) | Channel-neutral orchestration; no official Booking/Cancellation writes. |
| [granotLifecycle.drainer.md](../.cursor/businesslogic/granotLifecycle.drainer.md) | Fenced claim/lease, queue/cron drain, dead letter, Owner requeue. |
| [granotLifecycle.revisions.md](../.cursor/businesslogic/granotLifecycle.revisions.md) | Aggregate revision CAS and Lead provenance storage fields. |
| [granotLifecycle.bookingReconciliation.md](../.cursor/businesslogic/granotLifecycle.bookingReconciliation.md) | Booking-case open/refresh and gated Owner booking commands. |
| [granotLifecycle.releaseReconciliation.md](../.cursor/businesslogic/granotLifecycle.releaseReconciliation.md) | Separate Release cases and gated Owner cancellation/update commands. |
| [granotLifecycle.projections.md](../.cursor/businesslogic/granotLifecycle.projections.md) | Masked Admin case/job/lead reads; reads never invoke mutations. |
| [granotLifecycle.observability.md](../.cursor/businesslogic/granotLifecycle.observability.md) | Lifecycle events, closed metric labels, and health projection. |

## ADR

Workspace ADRs are outside this repo. This standalone checkout does not contain them (`skipped-absent`). Do not invent copies.

| Path | Description |
| --- | --- |
| [`../docs/adr/0001-mongodb-system-of-record.md`](../docs/adr/0001-mongodb-system-of-record.md) | MongoDB as system of record. |
| [`../docs/adr/0002-granot-crm-post-despite-downstream-failures.md`](../docs/adr/0002-granot-crm-post-despite-downstream-failures.md) | CRM Posting survives downstream failures. |
| [`../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md`](../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md) | Lead ID as Granot leadno. |

## Reference

| Path | Description |
| --- | --- |
| [granot-lifecycle/spec-hub.md](knowledge/granot-lifecycle/spec-hub.md) | Links to the locked FINAL SPEC and owner runbooks. No copied spec rules. |

## Archives

Unstamped. Index links only.

- [Owner daily operations / ODV issues](owner-daily-operations/README.md)
- [Showcase](showcase/owner-workflow.md)
- [Historical production DB staged merge plans](historical_[REDACTED]_db_staged_merge_ingestion_plans/historical-database-consolidation-plan.md) // pragma: allowlist secret
- [MongoDB backup automation](mongodb-backup-automation/cloud-run-job-implementation-plan.md)
- [Agent documentation maintenance strategy](agent-documentation-maintenance-strategy.md) (draft; not a live runbook)
