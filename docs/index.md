---
okf_version: "0.2"
title: Vantage main server knowledge
description: Type-grouped entrypoint for agent-readable concepts.
---

# Vantage main server knowledge

Query stamped rows with `pnpm okf:query` (`--type Service`, `--tag`, `--status`, `--stale`). Paths below are current on disk.

Glossary stays in workspace-root [`CONTEXT.md`](../CONTEXT.md) (absent in this standalone checkout). Do not redefine terms here.

## Service

Canonical bodies live under `docs/knowledge/`.

| Path | Description |
| --- | --- |
| [ringcentral-call-lead-qualification.md](knowledge/services/ringcentral-call-lead-qualification.md) | Qualify inbound RingCentral calls (120s) and promote them through shared ingest. |
| [operations-registry.md](knowledge/services/operations-registry.md) | Catalog, source, CPL, inbound-route, and Granot CRM source system of record. |
| [form-lead.md](knowledge/services/form-lead.md) | Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync. |
| [call-lead.md](knowledge/services/call-lead.md) | Create and update Call Leads (manual and RingCentral), duplicates, CPL, and sheet tabs. |
| [lead-conversation.md](knowledge/services/lead-conversation.md) | Seeded Lead Conversation evidence: redacted transcript, sectioned summary, private audio. |
| [enrichment.md](knowledge/services/enrichment.md) | Preview and sync Granot Follow Up rows onto Call Leads. |
| [bookings.md](knowledge/services/bookings.md) | Booked Lead create/update/delete, from-source, referral, leadless, and booking-chain sync. |
| [booked-call-lead-reconciliation.md](knowledge/services/booked-call-lead-reconciliation.md) | Refresh Call Leads and bookings from Granot Booked Jobs rows. |
| [cancelled-lead.md](knowledge/services/cancelled-lead.md) | Cancelled Lead CRUD, booking resolve, snapshots, and cancellation-chain sync. |
| [cancellation-mirror.md](knowledge/services/cancellation-mirror.md) | Stamp or clear `cancelled` on the source lead after a cancellation. |
| [customer.md](knowledge/services/customer.md) | Customer CRUD and booking-time upsert from lead or contact. |
| [agent-allocation.md](knowledge/services/agent-allocation.md) | Binder splits, catalog resolve, primary agent, and cancellation snapshot. |
| [sheet-sync.md](knowledge/services/sheet-sync.md) | Write-behind outbox, queue wake-up, drainer, and sheet-sync modes. |
| [google-sheets.md](knowledge/services/google-sheets.md) | Tab routing, projections, upsert/delete, and master vs source writes. |
| [domain-commands.md](knowledge/services/domain-commands.md) | Transaction-owning command executor, adapters, and append-only EntityChange. |
| [form-lead-search.md](knowledge/services/form-lead-search.md) | Scored Form Lead identity search, ambiguity, and duplicate quarantine. |
| [call-lead-search.md](knowledge/services/call-lead-search.md) | OR-based Call Lead lookup and summaries. |
| [lead-browse.md](knowledge/services/lead-browse.md) | Extension GET browse, pagination, and attachment chips. |
| [admin-search.md](knowledge/services/admin-search.md) | Global admin free-text search across scoped resources. |
| [analytics.md](knowledge/services/analytics.md) | Admin analytics reports, scopes, and overview/agent-sales siblings. |
| [catalog.md](knowledge/services/catalog.md) | Agents/merchants read facade; mutations go through Operations Registry. |
| [testimonial.md](knowledge/services/testimonial.md) | Read-only public and admin testimonials; ingest stays in helpers and ops scripts. |
| [granot-http-collector.md](knowledge/services/granot-http-collector.md) | HTTP session collector; approved apply captures automation receipts. |
| [job-number-timeline.md](knowledge/services/job-number-timeline.md) | Owner-only typed Job Number chain; prototype assembler, not Granot lifecycle projections. |
| [lead-messaging.md](knowledge/services/lead-messaging.md) | Persist and dispatch outbound confirmation SMS for public Form Leads and Granot create-if-missing Leads. |
| [employee-bookings.md](knowledge/services/employee-bookings.md) | Public employee booking submit with auto-match, plus Owner booking-lead reconciliation cases. |
| [reporting.md](knowledge/services/reporting.md) | Owner-gated report definitions, immutable revisions, confirmed runs, and Google destination delivery. |
| [ingestion.md](knowledge/services/ingestion.md) | Fenced Best Relocation sheet inspect/preview/apply through canonical domain commands. |
| [capture.md](knowledge/granot-lifecycle/capture.md) | Webhook and channel-neutral receipt capture; `{ receipt_id }` wake-up. |
| [extension-apply.md](knowledge/granot-lifecycle/extension-apply.md) | Owner extension apply items, receipt capture, and claim/process. |
| [automation-apply.md](knowledge/granot-lifecycle/automation-apply.md) | Owner-approved HTTP automation receipt apply. |
| [normalization.md](knowledge/granot-lifecycle/normalization.md) | One Observation per receipt; exact vocabulary; no matching or effects. |
| [source-policy.md](knowledge/granot-lifecycle/source-policy.md) | Fail-closed Registry policy and effect-gate snapshot; no effects. |
| [identity.md](knowledge/granot-lifecycle/identity.md) | Source-scoped Form/Call identity; read-only; consumed by the processor. |
| [desired-state.md](knowledge/granot-lifecycle/desired-state.md) | Desired-state planner and temporal compare; plans only, no writes. |
| [processor.md](knowledge/granot-lifecycle/processor.md) | Channel-neutral orchestration; no official Booking/Cancellation writes. |
| [drainer.md](knowledge/granot-lifecycle/drainer.md) | Fenced claim/lease, queue/cron drain, dead letter, Owner requeue. |
| [revisions.md](knowledge/granot-lifecycle/revisions.md) | Aggregate revision CAS and Lead provenance storage fields. |
| [booking-reconciliation.md](knowledge/granot-lifecycle/booking-reconciliation.md) | Booking-case open/refresh and gated Owner booking commands. |
| [release-reconciliation.md](knowledge/granot-lifecycle/release-reconciliation.md) | Separate Release cases and gated Owner cancellation/update commands. |
| [projections.md](knowledge/granot-lifecycle/projections.md) | Masked Admin case/job/lead reads plus Owner-only creating-observation; reads never invoke mutations. |
| [observability.md](knowledge/granot-lifecycle/observability.md) | Lifecycle events, closed metric labels, and health projection. |

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
| [admin-filter-catalog-and-analytics-specification.md](admin-filter-catalog-and-analytics-specification.md) | Implementation-ready Filter Catalog: one Source Company dropdown of Form/Call Source Granularities (`owner_label`) for lead search, duplicates, and catalog-complete Analytics. |
| [operations-registry-source-connections-owner-ui-specification.md](operations-registry-source-connections-owner-ui-specification.md) | Final proposed connection and Owner-facing contract for Lead Sources, Feeds, sheet labels, Granot names, RingCentral inbound numbers, and texting. |
| [granot-lifecycle/spec-hub.md](knowledge/granot-lifecycle/spec-hub.md) | Links to the locked FINAL SPEC, Booked-only delta, owner booking-intake spec, and owner runbooks. No copied spec rules. |
| [granot-lifecycle/owner-booking-intake.md](knowledge/granot-lifecycle/owner-booking-intake.md) | Pointer to the owner booking-intake contract. Does not copy spec rules. |
| [granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md](granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) | Owner booking intake. §5 even Binder is current; optional Lead, Connect Booking to Lead, and unmasking are not implemented. Prerequisite for Owner Daily. |

## Delivery packs

Active work packs. The ledger inside each is a navigation aid; the repository is authoritative.

| Path | Description |
| --- | --- |
| [operations-registry-source-connections/README.md](operations-registry-source-connections/README.md) | Four-pass delivery of the Operations Registry source-connection spec: typed label mappings, the Granot name Owner command, the aggregate Lead Source projection, and the Owner UI. |

## Archives

Unstamped. Index links only.

- [Owner daily operations / ODV issues](owner-daily-operations/README.md)
- [Showcase](showcase/owner-workflow.md)
- [Historical production DB staged merge plans](historical_[REDACTED]_db_staged_merge_ingestion_plans/historical-database-consolidation-plan.md) // pragma: allowlist secret
- [MongoDB backup automation](mongodb-backup-automation/cloud-run-job-implementation-plan.md)
- [Agent documentation maintenance strategy](agent-documentation-maintenance-strategy.md) (draft; not a live runbook)
