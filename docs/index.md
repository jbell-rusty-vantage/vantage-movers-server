---
okf_version: "0.2"
title: Vantage main server knowledge
description: Type-grouped entrypoint for agent-readable concepts.
---

# Vantage main server knowledge

Query stamped rows with `pnpm okf:query` (`--type Service`, `--tag`, `--status`, `--stale`). The `docs/knowledge/` rows are current on disk. Many long-form specification and delivery-pack links below point to folders that were dropped from the tracked tree (`259b8b72`, 2026-09-10, and `b67f740f`, 2026-10-03) and now resolve only in git history or in checkouts that keep them locally.

Glossary stays in workspace-root [`CONTEXT.md`](../CONTEXT.md) (absent in this standalone checkout). Do not redefine terms here.

Server/admin slimming (October 2026): the historical database, OperationalEvents, Lead Conversations and the server AI/media pipeline, the Admin Audit Log and the legacy Outreach intelligence were removed. Shipped and purged 2026-10-04 (server `6123f85e`); recreation checks at +30 min, +2 h and +1 day are still owed (see the ledger). Workspace: [server-admin-slimming/README.md](server-admin-slimming/README.md), [specification](server-admin-slimming/SPECIFICATION.md), [ledger](server-admin-slimming/LEDGER.md). Their Service docs stay in this catalog with `status: retired` (`pnpm okf:query --status retired`). Environment inventory: [knowledge/environment.md](knowledge/environment.md).

All Numbers + Accounts (October 2026): the Owner's Numbers surface became **All Numbers** (who a number is and who is **Waiting on us**) and **Accounts** (RingCentral Users and their Agent). The Number model v2, the lead link and the endpoints are in [number-activity-reads.md](knowledge/services/number-activity-reads.md); the call summary in [number-activity-capture.md](knowledge/services/number-activity-capture.md). The Number↔Lead attachment and the classification/eligibility analysis are retired. Build contract: workspace `all-numbers/CONTRACT.md` (outside this repo). Operator order: deploy phase A → `pnpm numbers:migrate --apply` → verify → deploy phase B → `pnpm numbers:desk-resync --apply` → verify → `pnpm numbers:cleanup --apply`.

Sales Outreach Desk (October 2026): start at the Reference [knowledge/sales-outreach-lifecycle.md](knowledge/sales-outreach-lifecycle.md) — how a Lead enters and leaves the desk, the cadence clock, how calls and SMS become progress, crons and jobs, the daily operator checks, repairs, the Owner PATCH procedure and rollback, as deployed after the Outreach lifecycle repair (2026-10-06, server `6b585f5b`, configuration revision 10). Per-module detail: [sales-outreach-desk.md](knowledge/services/sales-outreach-desk.md). Build contract: [sales-outreach-desk/](sales-outreach-desk/README.md).

CSI-16 certification (historical, pre-slimming): packet, checks, execution matrix. Removed from the tree in `b67f740f` before the slimming (git history only).

## Service

Canonical bodies live under `docs/knowledge/`.

| Path | Description |
| --- | --- |
| [ringcentral-call-lead-qualification.md](knowledge/services/ringcentral-call-lead-qualification.md) | Qualify inbound RingCentral calls (120s) and promote them through shared ingest. |
| [operations-registry.md](knowledge/services/operations-registry.md) | Catalog, source, CPL, inbound-route, and Granot CRM source system of record. |
| [form-lead.md](knowledge/services/form-lead.md) | Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync. |
| [call-lead.md](knowledge/services/call-lead.md) | Create and update Call Leads (manual and RingCentral), duplicates, CPL, and sheet tabs. |
| [sales-outreach-desk.md](knowledge/services/sales-outreach-desk.md) | Sales Outreach Desk (sod-v1), per module: roles and `requireOutreachActor`, persisted versioned `sales_outreach_configuration` (GET/PATCH, fail closed, R0 evolution rule), subjects, Lead-change feed, intake and automatic expansion admission, enrollment, evaluator and engine v2, commands, queue/team/live reads, RingCentral capture, contact events and rep-days, operator scripts. Known limits and decisions. Lifecycle overview: [sales-outreach-lifecycle.md](knowledge/sales-outreach-lifecycle.md). |
| [sales-intelligence-live.md](knowledge/services/sales-intelligence-live.md) | Owner-only SSE of committed Numbers and RingCentral Accounts changes from a Mongo change stream; topic slugs only. |
| [sales-intelligence-nudges.md](knowledge/services/sales-intelligence-nudges.md) | RingCentral Accounts messages: the Owner's own `review_context` text to one directory User by Team Messaging or pager; single attempt, receipt-only repair, unknown delivery never resent. |
| [sales-intelligence-rep-identity.md](knowledge/services/sales-intelligence-rep-identity.md) | Rep Identity Links: directory proposals, temporal account-scoped resolution, and the Owner's Accounts connect/change/disconnect (reviewed at once; successor intervals). |
| [sales-intelligence-foundation.md](knowledge/services/sales-intelligence-foundation.md) | Shared CSI contracts, Owner boundary, durable jobs with the retired-stage fence, policy/settings, Call activity retention, crons and queue for the retained Numbers and RingCentral Accounts surface. |
| [number-activity-capture.md](knowledge/services/number-activity-capture.md) | CSI-02 all-direction Call Interaction projection from webhook parties and Detailed Call Log, account-scoped identity, reconcile cursor/lease, quarantine, Call Log Sync, nightly sweep, and the All Numbers call summary (calls, last call, Waiting on us) recomputed from the calls; only downstream job is the number's `lead_link` recompute. |
| [sales-intelligence-webhook-fanout.md](knowledge/services/sales-intelligence-webhook-fanout.md) | CSI-03 durable webhook fan-out: deduplicated capture-projection job per stored receipt, receipt watermark recovery, capture worker, queue consumer (retired stages terminalized), Call Log refresh on hang-up and the all-direction subscription lifecycle. |
| [number-activity-reads.md](knowledge/services/number-activity-reads.md) | **Start here for All Numbers + Accounts.** Owner-only All Numbers list/detail/lead search and pin/unlink, the number's lead link (candidates, newest wins, Owner pin, exclusions, triggers), Accounts, Owner coverage, directory snapshot sync, the MCP history reads and the v2 migrate/cleanup scripts. |
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
| [admin-search.md](knowledge/services/admin-search.md) | Global admin free-text search across the four Lead/Booking/Cancellation resources (production only). |
| [analytics.md](knowledge/services/analytics.md) | Admin analytics reports and the Overview sibling, production database only. |
| [catalog.md](knowledge/services/catalog.md) | Agents/merchants read facade; mutations go through Operations Registry. |
| [testimonial.md](knowledge/services/testimonial.md) | Read-only public and admin testimonials; ingest stays in helpers and ops scripts. |
| [granot-http-collector.md](knowledge/services/granot-http-collector.md) | HTTP session collector; approved apply captures automation receipts. |
| [job-number-timeline.md](knowledge/services/job-number-timeline.md) | Owner-only typed Job Number chain; production module `src/services/jobNumberTimeline/`, not Granot lifecycle projections. |
| [lead-messaging.md](knowledge/services/lead-messaging.md) | Persist and dispatch outbound confirmation SMS for public Form Leads and Granot create-if-missing Leads. |
| [daily-operations.md](knowledge/services/daily-operations.md) | Pointer only. Owner Daily Operations: category panels (focus expands in place) plus Arrivals as a live rail on `/daily`; snapshot carries today / yesterday / day before; trend % vs yesterday-by-now; kind colour tones. Not Daily View. Not Live Events. Contract is the formal spec, not this file. |
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
| [observability.md](knowledge/granot-lifecycle/observability.md) | Lifecycle events as structured logs, closed metric labels, bounded `granot_lifecycle_health_state` counters and the health projection. |
| [mongodb-backup.md](knowledge/services/mongodb-backup.md) | Daily logical mongodump of `vantagemovers` to GCS in project `vantage-sheets-496816`. |

## Retired Service

Kept as stubs with `status: retired`. Each names what was removed, what remains and where the last live body is in git history. Do not build on them.

| Path | Description |
| --- | --- |
| [sales-intelligence-attachment.md](knowledge/services/sales-intelligence-attachment.md) | Number↔Lead attachment edges, refresh job, sole-match automatic attach and Owner attach/reject/detach. **Retired 2026-10** by All Numbers phase B (replaced by the number's own lead link). |
| [sales-intelligence-analysis-steps.md](knowledge/services/sales-intelligence-analysis-steps.md) | The three model steps (call summary, findings, Move assessment) and their inputs. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [sales-intelligence-analysis.md](knowledge/services/sales-intelligence-analysis.md) | Scoped MCP evidence, bounded agent runs, application and Owner reanalysis. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [lead-conversation.md](knowledge/services/lead-conversation.md) | Lead Conversation evidence: transcript, summary, private audio. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [sales-intelligence-recording-media.md](knowledge/services/sales-intelligence-recording-media.md) | CSI-11 recording discovery and private media. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [sales-intelligence-transcription.md](knowledge/services/sales-intelligence-transcription.md) | CSI-12 speech-to-text and transcript versions. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [sales-intelligence-outreach.md](knowledge/services/sales-intelligence-outreach.md) | CSI-06 Outreach, follow-ups, Attention, Closed, Overview, Case File. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |
| [sales-intelligence-move-assessment.md](knowledge/services/sales-intelligence-move-assessment.md) | Move assessment step, reads and presentation. **Retired 2026-10** by the [server/admin slimming](server-admin-slimming/SPECIFICATION.md). |

## Reference (environment)

| Path | Description |
| --- | --- |
| [environment.md](knowledge/environment.md) | Every environment variable the server reads, by owning module, plus the names retired by the slimming that the operator deletes from Vercel after the deploy. Values are never stored. |

## Reference (Sales Outreach Desk)

| Path | Description |
| --- | --- |
| [sales-outreach-lifecycle.md](knowledge/sales-outreach-lifecycle.md) | How the outreach lifecycle works as deployed 2026-10-06: Lead sources, eligibility, policy decision, the four kinds of review, intake / automatic expansion admission / dated runs; the cadence clock and status ladder (`due` + unverified, narrowed `pending`, `coverage_wait`); call and SMS hops with latencies, association reasons, count scopes, coverage and freshness tolerances, the RingCentral subscription token rule; vocabulary; crons and job dedupe keys; daily `desk-state` checks, commands, Owner PATCH, rollback (R0); decisions and limits. |

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
| 20 — Sales Intelligence walkthrough (pre-slimming) | September 21 source walkthrough from RingCentral capture through attachment, Outreach, Attention, transcription, scoped analysis, application and Owner views; failure catalogue and documentation drift. Historical: describes the pipeline removed by the 2026-10 slimming. Removed from the tree in `b67f740f` before the slimming (git history only). |
| 24 — Workflows and MongoDB recommendation | Proposed Mongo read improvements, MCP authority/transport boundary and phased WorkflowAgent migration, including timeout, lease, budget, retention and rollback requirements. Historical: superseded by the 2026-10 slimming. Removed from the tree in `b67f740f` before the slimming (git history only). |
| call-sales-intelligence-new/18-efficiency-implementation-2026-09-21.md | September 21, 2026 implementation of the 17 efficiency handoff: semantic Outreach repair keys and wait-expiry nominations, coalesced attachment fan-out, Lead identity fingerprints, explicit analysis admission with a distinct per-recording pause, drain loop, runtime defaults, Owner admission read; before/after evidence and remaining work. Historical: most of the pipeline it tuned was removed in the 2026-10 slimming. Removed from the tree in `b67f740f` before the slimming (git history only). |
| call-sales-intelligence-new/23-duration-queue-and-token-implementation-2026-09-21.md | September 21, 2026 implementation of the 22 task: 800 s function limit with the runtime cap and lease renewed against it, recovery for reservations stranded by a killed invocation, queue-first analysis with the extract cron as recovery, per-run tool allowlist, cacheable prompt prefix, `$ref`-compacted envelope schema with a versioned digest, and recorded submit-rejection paths. Measured before/after byte counts and what 22 §4.4 still needs data for. Historical: the analysis pipeline it tuned was removed in the 2026-10 slimming. Removed from the tree in `b67f740f` before the slimming (git history only). |
| call-sales-intelligence/README.md | **Build contract.** Call & Sales Intelligence: Contact Numbers, Call Interactions, Number Activity, Number↔Lead attachment, Outreach, Findings, Rep Identity Links, Owner Rep Nudge, Owner `/sales-intelligence`. Revised Sept 17 build contract (spec, models, pipeline, routes, UX, delivery, AI SDK + scoped Vantage MCP envelope) with an agent-team workspace. Supersedes the two sales-intelligence docs below for implementation. Its Outreach, Findings, media and analysis parts were retired by the 2026-10 slimming; Contact Numbers, Call Interactions, Number Activity, attachment, Rep Identity Links and Owner Rep Nudge remain. Removed from the tree in `b67f740f` before the slimming (git history only). |
| sales-intelligence/recommendation-specification.md | Evidence base (Sept 11 prototype) for Call & Sales Intelligence. Build from the pack above, not this file. Removed from the tree in `b67f740f` before the slimming (git history only). |
| sales-intelligence/number-activity-consolidation.md | Sept 14 product cut (Number Activity first, no Sales Opportunity). Folded into the pack above. Removed from the tree in `b67f740f` before the slimming (git history only). |
| [daily-operations/daily-operations-specification.md](daily-operations/daily-operations-specification.md) | **Working contract.** Owner Daily Operations: category panels plus complementary Arrivals on `/daily`, Mongo day projection, Redis doorbell, SSE, hooks. Not Analytics, Live Events, Observational, or Daily View. |
| [daily-operations/daily-operations-pre-specification.md](daily-operations/daily-operations-pre-specification.md) | Superseded pre-spec (one mixed feed). Formal spec wins. |
| [daily-operations/daily-operations-workspace.md](daily-operations/daily-operations-workspace.md) | Orientation memo that preceded the pre-spec. Background only. |
| [form-lead-contact-snapshots-display-and-search-specification.md](form-lead-contact-snapshots-display-and-search-specification.md) | Show Form submitted vs Granot contact on Admin Form Leads, and search both plus the ingested snapshot. |
| [call-lead-contact-provenance/call-lead-contact-provenance-specification.md](call-lead-contact-provenance/call-lead-contact-provenance-specification.md) | Lock Call Lead operational phone to the ingested caller; store Granot contact only on `granot_contact_snapshot` coalesced by Job Number. HTTP Automation and extension apply share that processor. Owner desk search finds any known contact. |
| [lead-no-sync/lead-no-sync-specification.md](lead-no-sync/lead-no-sync-specification.md) | No-Sync Lead (`no_sync`): default on Manual create; skip and delete Master Leads rows; Owner mark; desk filter; contains is Not expected. Distinct from Unmatched Call Lead. |
| [exact-job-booking-attach/exact-job-booking-attach-specification.md](exact-job-booking-attach/exact-job-booking-attach-specification.md) | Exact Job Booking Attach: Employee submit and Precise Booking Form attach only on unique Job Number; otherwise Leadless Booking + Booking Lead Reconciliation Case. Not Confirm Granot Booking. |
| [granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md](granot-lead-lifecycle/booking-intake-form-lead-contact-snapshots-specification.md) | Superseded. BILA-01 shipped intake any-known-contact search and Form submitted vs Granot display. Remaining slices live in the robustness pack. |
| [admin-filter-catalog-and-analytics-specification.md](admin-filter-catalog-and-analytics-specification.md) | Implementation-ready Filter Catalog: one Source Company dropdown of Form/Call Source Granularities (`owner_label`) for lead search, duplicates, and catalog-complete Analytics. |
| [operations-registry-source-connections-owner-ui-specification.md](operations-registry-source-connections-owner-ui-specification.md) | Final proposed connection and Owner-facing contract for Lead Sources, Feeds, sheet labels, Granot names, RingCentral inbound numbers, and texting. |
| [job-timeline-enhancement-specification.md](job-number-timeline/job-timeline-enhancement-specification.md) | Enhancement plan for a precise, evidence-aware Owner Job timeline; keeps window-wide assurance and notifications as a later module. |
| [granot-lifecycle/spec-hub.md](knowledge/granot-lifecycle/spec-hub.md) | Links to the locked FINAL SPEC, Booked-only delta, Release-into-intake spec, owner booking-intake spec, Referral review Release-first spec, and owner runbooks. No copied spec rules. |
| [referral-review-release-first/referral-review-release-first-specification.md](referral-review-release-first/referral-review-release-first-specification.md) | Implementation-ready: Referral `review_existing_booking` first evidence may be Release; owner commands revalidate live Referral policy, not Booked-on-`evidence[0]`. Create Referral Booking minting stays Booked-only. |
| [dashboard-delete-live-claims/dashboard-delete-live-claims-specification.md](dashboard-delete-live-claims/dashboard-delete-live-claims-specification.md) | Implementation-ready: dashboard Booking delete releases the active Granot Record Link `booking_ref` and an open booking case `deterministic_booking_id`. Cancellation delete keeps its current unwind. Confirm identity check stays strict. |
| [granot-lifecycle/referral-review-release-first.md](knowledge/granot-lifecycle/referral-review-release-first.md) | Pointer to the Referral review Release-first contract. Does not copy spec rules. |
| [granot-lead-lifecycle/release-into-booking-intake-specification.md](granot-lead-lifecycle/release-into-booking-intake-specification.md) | Implementation-ready: Releas / Release upsert onto the booking intake; cancellation intakes retired; Live Events → booking intake link (the Live Events page was retired in the 2026-10 slimming). |
| [granot-lifecycle/owner-booking-intake.md](knowledge/granot-lifecycle/owner-booking-intake.md) | Pointer to the owner booking-intake contract. Does not copy spec rules. |
| [owner-booking-intake-presentation/owner-booking-intake-presentation-specification.md](owner-booking-intake-presentation/owner-booking-intake-presentation-specification.md) | Implementation-ready: Owner `/intakes` Finalize / Possibly Fix copy, list-level No Action, no Confirm Granot Cancellation on that desk. |
| [granot-lifecycle/release-into-booking-intake.md](knowledge/granot-lifecycle/release-into-booking-intake.md) | Pointer to the Release-into-intake contract. Does not copy spec rules. |
| [granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md](granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md) | Owner booking intake. §5 even Binder, BILA-01 search/display, BILA-02 optional Lead on Confirm, and BILA-03 Connect Booking to Lead from `/bookings` are current; unmasking is not implemented. Prerequisite for Owner Daily. |
| [operational-surfaces-specification.md](operational-surfaces/operational-surfaces-specification.md) | Shipped (OSE-01–05). Admin presentation: tabbed operational detail panel, row action cluster, grouped filters. Shared `OperationalResourcePage` shell. No main-server invariant changes. |
| [lead-costs-owner-editing-specification.md](lead-costs-owner-editing/lead-costs-owner-editing-specification.md) | Operations Registry Lead Costs: Owner From / Through / Amount on one Feed. New `set_range` command. Schedule edits still never rewrite stamped Lead CPL. |
| [granot-lifecycle-surfaces-specification.md](granot-lifecycle-surfaces/granot-lifecycle-surfaces-specification.md) | Ingestion cleanup, Granot Lifecycle System tab (Health + searchable webhook-channel Granot Observation Receipts). Job Timeline stays Records. The receipt search/list, Receipts tab and Live Events SSE were retired in the 2026-10 slimming; Health remains. |
| [mongodb-backup-automation/README.md](mongodb-backup-automation/README.md) | Operator playbook: list, trigger, inspect, and restore-drill GCS backups. Invariants stay in the Service. |
| [quality-checkpoints.md](quality-checkpoints.md) | Local quality checkpoints for Claude Code, Cursor and Codex: turn-end hooks, git gate, model triage, clean-code/docs passes, auto-apply, retention. Operator rule: `.cursor/rules/quality-inspect-and-run.mdc`. |

## Delivery packs

Active work packs. The ledger inside each is a navigation aid; the repository is authoritative.

| Path | Description |
| --- | --- |
| [operations-registry-source-connections/README.md](operations-registry-source-connections/README.md) | Four-pass delivery of the Operations Registry source-connection spec: typed label mappings, the Granot name Owner command, the aggregate Lead Source projection, and the Owner UI. |
| [job-number-timeline/README.md](job-number-timeline/README.md) | Four-session enhancement of the Owner Job Number timeline (JTE-01–05). Daily Assurance and notifications stay out of pack. |
| [booking-intake-lead-attachment/README.md](booking-intake-lead-attachment/README.md) | Three-issue pack. BILA-01–BILA-03 shipped (intake search/display, optional Lead on Confirm, Connect from `/bookings`). |
| [operational-surfaces/README.md](operational-surfaces/README.md) | Five-issue pack. OSE-01–05 shipped (extract, tabbed detail, row cluster, grouped filters, browser walk). Admin presentation only; no main-server invariant changes. |
| [granot-lifecycle-surfaces/README.md](granot-lifecycle-surfaces/README.md) | Three-issue pack. GLS-01 Ingestion IA + Health home shipped; GLS-02 receipt search API shipped, then retired in the 2026-10 slimming; GLS-03 Receipts tab retired (Admin `/granot-lifecycle/receipts` redirects to Health). Job Timeline stays `/job-timeline`. |
| [lead-costs-owner-editing/README.md](lead-costs-owner-editing/README.md) | Five-issue pack. LCE-01 server `set_range`; LCE-02 By date form; LCE-03 copy/URL/handoff; LCE-04 structured rebuild; LCE-05 browser proof. Simple construction and CPL Correction workers stay. |
| [daily-operations/README.md](daily-operations/README.md) | Ten-issue pack. DOP-01–10 shipped (DOP-10: expand-in-place focus, trend % with the day before, full-fact cards, kind colours, Arrivals live rail, Live Events rows; the Live Events page was retired in the 2026-10 slimming). Category panels plus complementary Arrivals on `/daily`. Not Daily View. Not Live Events. Not the 2026-08-19 tabbed layout. |
| call-sales-intelligence/workspace/README.md | Agent-team execution workspace for CSI-01–18: contracts, capture, Outreach, scoped MCP intelligence, Owner UI, integration and acceptance. Runtime status and issue-specific evidence are recorded in the workspace ledger and owning Services. Historical for the retired parts (see the slimming ledger). Removed from the tree in `b67f740f` before the slimming (git history only). |
| [call-lead-contact-provenance/README.md](call-lead-contact-provenance/README.md) | Five required issues (CLCP-01–05). Lock Call operational phone; Granot snapshot coalesce by Job; Job-wins identity; shared HTTP/extension preview; Owner desk any-known-contact. |
| [lead-no-sync/README.md](lead-no-sync/README.md) | Four-issue pack (LNS-01–04). Persist `no_sync`, default it on Manual create, delete Master Leads rows when marked, filter it on the desks, contains Not expected. |
| [exact-job-booking-attach/README.md](exact-job-booking-attach/README.md) | Four-issue pack (EJBA-01–04). Job-only auto-attach on Employee submit and Precise Booking Form; pending Owner creates open a Booking Lead Reconciliation Case. |
| [referral-review-release-first/README.md](referral-review-release-first/README.md) | Three-issue pack (RRF-01–03). Referral review Release-first owner commands. RRF-01 server helper; RRF-02 Admin 409 copy; RRF-03 knowledge restamp. |
| [dashboard-delete-live-claims/README.md](dashboard-delete-live-claims/README.md) | One issue (DLC-01). Booking delete releases the active Record Link `booking_ref` and an open booking case `deterministic_booking_id`. |
| [owner-booking-intake-presentation/README.md](owner-booking-intake-presentation/README.md) | Presentation spec only (no issue pack yet). Owner `/intakes` Finalize / Possibly Fix, list-level No Action, no Confirm Granot Cancellation on that desk. |
| [extension-user-management](../../granot_sync_extensions_and_services/docs/extension-user-management/README.md) | Four-issue pack. EUM-01–04 shipped. Extension User `roles[]`; leftover Employee → Sales + Customer Service; Owner edit/delete; session invalidation. |

## Archives

Unstamped. Index links only.

- [Owner daily operations / ODV issues](owner-daily-operations/README.md)
- [Showcase](showcase/owner-workflow.md)
- Historical production DB staged merge plans: removed from the tree in `b67f740f` (git history only); the historical database itself was dropped by the 2026-10-04 slimming purge // pragma: allowlist secret
- [MongoDB backup implementation plan](mongodb-backup-automation/cloud-run-job-implementation-plan.md) (historical; live Service is [mongodb-backup.md](knowledge/services/mongodb-backup.md))
- [MongoDB backup deployment record](mongodb-backup-automation/deployment-record.md)
- [Agent documentation maintenance strategy](agent-documentation-maintenance-strategy.md) (draft; not a live runbook)
