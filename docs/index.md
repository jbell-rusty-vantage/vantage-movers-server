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
| [extension-users.md](knowledge/services/extension-users.md) | Owner-only Admin Dashboard create, list, edit, and delete for Extension User email, password, and roles[]. Leftover Employee dual-reads as Sales plus Customer Service; credential or roles change increments access-token token_version. |
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
| [admin-search.md](knowledge/services/admin-search.md) | Global admin free-text search across scoped resources. Browse sibling: Agents list/detail/export enrich distinct-booking metrics (`agentBrowseMetrics.service.ts`). |
| [analytics.md](knowledge/services/analytics.md) | Admin analytics reports, scopes, and overview/agent-sales siblings. |
| [catalog.md](knowledge/services/catalog.md) | Agents/merchants read facade; mutations go through Operations Registry. |
| [testimonial.md](knowledge/services/testimonial.md) | Read-only public and admin testimonials; ingest stays in helpers and ops scripts. |
| [granot-http-collector.md](knowledge/services/granot-http-collector.md) | HTTP session collector; approved apply captures automation receipts. |
| [job-number-timeline.md](knowledge/services/job-number-timeline.md) | Owner-only typed Job Number chain; production module `src/services/jobNumberTimeline/`, not Granot lifecycle projections. |
| [lead-messaging.md](knowledge/services/lead-messaging.md) | Persist and dispatch outbound confirmation SMS for public Form Leads and Granot create-if-missing Leads. |
| [employee-bookings.md](knowledge/services/employee-bookings.md) | Public employee booking submit with auto-match, plus Owner booking-lead reconciliation cases. |
| [reporting.md](knowledge/services/reporting.md) | Owner-gated report definitions, immutable revisions, confirmed runs, and Google destination delivery. |
| [tariff.md](knowledge/services/tariff.md) | Append-only tariff adjustment rows to TARIFF_SHEET_ID / Master. Carrier is the resolved Moving Carrier name and DOT. |
| [ingestion.md](knowledge/services/ingestion.md) | Fenced Best Relocation sheet inspect/preview/adopt/apply through canonical domain commands. |
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
| [live-receipts.md](knowledge/granot-lifecycle/live-receipts.md) | Owner-only live SSE of Granot webhook receipts plus sibling historical list GET (unmasked contact + credential-redacted `granot_statement`; pack spec §6 masked list is superseded); Mongo watermark poll, not in-process emit. |
| [observability.md](knowledge/granot-lifecycle/observability.md) | Lifecycle events, closed metric labels, and health projection. |
| [mongodb-backup.md](knowledge/services/mongodb-backup.md) | Daily logical mongodump of `vantagemovers` to GCS in project `vantage-sheets-496816`. |

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
| [daily-operations/daily-operations-pre-specification.md](daily-operations/daily-operations-pre-specification.md) | Pre-spec: Owner Daily Operations workspace. Mongo day projection + Daily Operations Events, Upstash Redis doorbell, SSE, hook points, Admin `/daily`. Not Analytics, Live Events, or Observational. |
| [daily-operations/daily-operations-workspace.md](daily-operations/daily-operations-workspace.md) | Orientation memo that preceded the pre-spec. The pre-spec is the working contract. |
| [form-lead-contact-snapshots-display-and-search-specification.md](form-lead-contact-snapshots-display-and-search-specification.md) | Show Form submitted vs Granot contact on Admin Form Leads, and search both plus the ingested snapshot. |
| [call-lead-contact-provenance/call-lead-contact-provenance-specification.md](call-lead-contact-provenance/call-lead-contact-provenance-specification.md) | Lock Call Lead operational phone to the ingested caller; store Granot contact only on `granot_contact_snapshot` coalesced by Job Number. HTTP Automation and extension apply share that processor. Owner desk search finds any known contact. |
| [lead-no-sync/lead-no-sync-specification.md](lead-no-sync/lead-no-sync-specification.md) | No-Sync Lead (`no_sync`): default on Manual create; skip and delete Master Leads rows; Owner mark; desk filter; contains is Not expected. Distinct from Unmatched Call Lead. |
| [granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md](granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md) | Superseded. BILA-01 shipped intake any-known-contact search and Form submitted vs Granot display. Remaining slices live in the robustness pack. |
| [admin-filter-catalog-and-analytics-specification.md](admin-filter-catalog-and-analytics-specification.md) | Implementation-ready Filter Catalog: one Source Company dropdown of Form/Call Source Granularities (`owner_label`) for lead search, duplicates, and catalog-complete Analytics. |
| [operations-registry-source-connections-owner-ui-specification.md](operations-registry-source-connections-owner-ui-specification.md) | Final proposed connection and Owner-facing contract for Lead Sources, Feeds, sheet labels, Granot names, RingCentral inbound numbers, and texting. |
| [job-timeline-enhancement-specification.md](job-number-timeline/job-timeline-enhancement-specification.md) | Enhancement plan for a precise, evidence-aware Owner Job timeline; keeps window-wide assurance and notifications as a later module. |
| [granot-lifecycle/spec-hub.md](knowledge/granot-lifecycle/spec-hub.md) | Links to the locked FINAL SPEC, Booked-only delta, Release-into-intake spec, owner booking-intake spec, and owner runbooks. No copied spec rules. |
| [granot-lead-lifecycle/release-into-booking-intake-specification.md](granot-lead-lifecycle/release-into-booking-intake-specification.md) | Implementation-ready: Releas / Release upsert onto the booking intake; cancellation intakes retired; Live Events → booking intake link. |
| [granot-lifecycle/owner-booking-intake.md](knowledge/granot-lifecycle/owner-booking-intake.md) | Pointer to the owner booking-intake contract. Does not copy spec rules. |
| [granot-lifecycle/release-into-booking-intake.md](knowledge/granot-lifecycle/release-into-booking-intake.md) | Pointer to the Release-into-intake contract. Does not copy spec rules. |
| [granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md](granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) | Owner booking intake. §5 even Binder, BILA-01 search/display, BILA-02 optional Lead on Confirm, and BILA-03 Connect Booking to Lead from `/bookings` are current; unmasking is not implemented. Prerequisite for Owner Daily. |
| [operational-surfaces-specification.md](operational-surfaces/operational-surfaces-specification.md) | Shipped (OSE-01–05). Admin presentation: tabbed operational detail panel, row action cluster, grouped filters. Shared `OperationalResourcePage` shell. No main-server invariant changes. |
| [lead-costs-owner-editing-specification.md](lead-costs-owner-editing/lead-costs-owner-editing-specification.md) | Operations Registry Lead Costs: Owner From / Through / Amount on one Feed. New `set_range` command. Schedule edits still never rewrite stamped Lead CPL. |
| [granot-lifecycle-surfaces-specification.md](granot-lifecycle-surfaces/granot-lifecycle-surfaces-specification.md) | Ingestion cleanup, Granot Lifecycle System tab (Health + searchable webhook-channel Granot Observation Receipts). Job Timeline stays Records. Live Events SSE unchanged. |
| [mongodb-backup-automation/README.md](mongodb-backup-automation/README.md) | Operator playbook: list, trigger, inspect, and restore-drill GCS backups. Invariants stay in the Service. |

## Delivery packs

Active work packs. The ledger inside each is a navigation aid; the repository is authoritative.

| Path | Description |
| --- | --- |
| [operations-registry-source-connections/README.md](operations-registry-source-connections/README.md) | Four-pass delivery of the Operations Registry source-connection spec: typed label mappings, the Granot name Owner command, the aggregate Lead Source projection, and the Owner UI. |
| [job-number-timeline/README.md](job-number-timeline/README.md) | Four-session enhancement of the Owner Job Number timeline (JTE-01–05). Daily Assurance and notifications stay out of pack. |
| [booking-intake-lead-attachment/README.md](booking-intake-lead-attachment/README.md) | Three-issue pack. BILA-01–BILA-03 shipped (intake search/display, optional Lead on Confirm, Connect from `/bookings`). |
| [operational-surfaces/README.md](operational-surfaces/README.md) | Five-issue pack. OSE-01–05 shipped (extract, tabbed detail, row cluster, grouped filters, browser walk). Admin presentation only; no main-server invariant changes. |
| [granot-lifecycle-surfaces/README.md](granot-lifecycle-surfaces/README.md) | Three-issue pack. GLS-01 Ingestion IA + Health home shipped; GLS-02 receipt search API shipped; GLS-03 Receipts tab not shipped. Job Timeline stays `/job-timeline`. |
| [lead-costs-owner-editing/README.md](lead-costs-owner-editing/README.md) | Five-issue pack. LCE-01 server `set_range`; LCE-02 By date form; LCE-03 copy/URL/handoff; LCE-04 structured rebuild; LCE-05 browser proof. Simple construction and CPL Correction workers stay. |
| [call-lead-contact-provenance/README.md](call-lead-contact-provenance/README.md) | Five required issues (CLCP-01–05). Lock Call operational phone; Granot snapshot coalesce by Job; Job-wins identity; shared HTTP/extension preview; Owner desk any-known-contact. |
| [lead-no-sync/README.md](lead-no-sync/README.md) | Four-issue pack (LNS-01–04). Persist `no_sync`, default it on Manual create, delete Master Leads rows when marked, filter it on the desks, contains Not expected. |
| [extension-user-management](../../granot_sync_extensions_and_services/docs/extension-user-management/README.md) | Four-issue pack. EUM-01–04 shipped. Extension User `roles[]`; leftover Employee → Sales + Customer Service; Owner edit/delete; session invalidation. |

## Archives

Unstamped. Index links only.

- [Owner daily operations / ODV issues](owner-daily-operations/README.md)
- [Showcase](showcase/owner-workflow.md)
- [Historical production DB staged merge plans](historical_[REDACTED]_db_staged_merge_ingestion_plans/historical-database-consolidation-plan.md) // pragma: allowlist secret
- [MongoDB backup implementation plan](mongodb-backup-automation/cloud-run-job-implementation-plan.md) (historical; live Service is [mongodb-backup.md](knowledge/services/mongodb-backup.md))
- [MongoDB backup deployment record](mongodb-backup-automation/deployment-record.md)
- [Agent documentation maintenance strategy](agent-documentation-maintenance-strategy.md) (draft; not a live runbook)
