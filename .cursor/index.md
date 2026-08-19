# Vantage Main Server — `.cursor` Directory

Cursor agent context for `vantage-main-server`: rules, compact business-logic docs, dev scripts, and review notes. This folder is **not** deployed with the API; it guides humans and AI when working in the repo.

Production API: https://vantage-movers-main-server.vercel.app

---

## Directory layout

```
.cursor/
├── index.md                 ← this file
├── index.txt                ← one-line pointer (legacy)
├── agents/                  ← Cursor subagents (docs-keeper, spec extractor)
├── businesslogic/           ← per-service compact domain docs (see below)
├── rules/                   ← Cursor rule files (*.mdc), scoped by glob
├── scripts/                 ← local dev helpers (Mongo, API)
├── environment.json         ← Cursor cloud agent environment config
├── Dockerfile               ← Cursor cloud agent image
└── ringcentral_cron_review.md  ← ad-hoc RingCentral cron review notes
```

---

## `businesslogic/` — service-level domain docs

**Purpose:** Short, accurate descriptions of *what a service does* in business terms: source of truth, invariants, routing, edge cases, and related modules. Optimized for onboarding and for keeping AI changes aligned with owner workflows.

**When to update:** Any behavior change in the documented service (see also `rules/business-logic.mdc` drift policy).

**Naming:** `{service-or-area}.service.md` mirroring primary code under `src/services/<domain>/`.

| File | Covers |
|------|--------|
| [form-lead.service.md](businesslogic/form-lead.service.md) | `src/services/leads/formLead.service.ts` — create/update/delete, duplicates, Granot CRM post, form-fill → call leads, receiver agent, trusted Ingestion Origin + ingested snapshots, sheet tabs |
| [call-lead.service.md](businesslogic/call-lead.service.md) | `src/services/leads/callLead.service.ts` — manual vs RingCentral create, duplicate calls, form-fill, CPL snapshot, receiver agent, trusted Ingestion Origin + ingested snapshot, sheet tabs |
| [googleSheets.service.md](businesslogic/googleSheets.service.md) | `src/services/googleSheets/googleSheets.service.ts` — tab routing, upsert/delete, projections, master vs source writes |
| [adminSearch.service.md](businesslogic/adminSearch.service.md) | `src/services/admin/adminSearch.service.ts` — global admin search, scopes, resources, vs browse |
| [agentAllocation.service.md](businesslogic/agentAllocation.service.md) | `src/services/agents/agentAllocation.service.ts` — binder splits, catalog resolve, patch/replace, primary agent, cancellation snapshot |
| [analytics.service.md](businesslogic/analytics.service.md) | `src/services/analytics/` — admin report router, scopes, filters, merge, overview/agent-sales/receiver-agent siblings |
| [bookings.service.md](businesslogic/bookings.service.md) | `src/services/bookings/` — create/update/delete, from-source, mirror, referral, leadless, sheet `booking_chain`, idempotency |
| [bookedCallLeadReconciliation.service.md](businesslogic/bookedCallLeadReconciliation.service.md) | `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` — Granot Booked Jobs → call lead/booking field refresh, match paths, source rules, sheet sync |
| [enrichment.service.md](businesslogic/enrichment.service.md) | `src/services/enrichment/callLeadEnrichment.service.ts` — Follow Up preview/sync, match/conflict, receiver-agent username match, sheet `call_lead.enrichment.sync` |
| [ringcentral-call-lead-qualification.service.md](businesslogic/ringcentral-call-lead-qualification.service.md) | `src/services/ringcentral/` — 120s qualification (evaluator + vetting), webhook session aggregation, Call Log cron, shared ingest (idempotency, duplicate, write mode) |
| [cancelledLead.service.md](businesslogic/cancelledLead.service.md) | `src/services/cancellations/cancelledLead.service.ts` + `cancellationResolver.ts` — create/update/delete, booking resolve, snapshot fields, sheet `cancellation_chain`, referral guard |
| [cancellationMirror.service.md](businesslogic/cancellationMirror.service.md) | `src/services/cancellations/cancellationMirror.service.ts` — stamp/clear `cancelled` on source lead, syncAfterClear batching |
| [formLeadSearch.service.md](businesslogic/formLeadSearch.service.md) | `src/services/search/formLeadSearch.service.ts` — scored form identity search, ambiguity, duplicate quarantine, Granot CSV fallback |
| [callLeadSearch.service.md](businesslogic/callLeadSearch.service.md) | `src/services/search/callLeadSearch.service.ts` — OR-based call lookup, summaries |
| [leadBrowse.service.md](businesslogic/leadBrowse.service.md) | `src/services/search/*Browse.service.ts` + `leadBrowseShared.ts` — extension GET browse, pagination, attachment chips |
| [catalog.service.md](businesslogic/catalog.service.md) | `src/services/catalog/catalog.service.ts` — agents/merchants facade; mutations go through Operations Registry |
| [customer.service.md](businesslogic/customer.service.md) | `src/services/customers/` — CRUD, cascade delete, booking-time upsert from lead/contact |
| [testimonial.service.md](businesslogic/testimonial.service.md) | `src/services/testimonials/testimonial.service.ts` — read-only list for marketing site, ingest helpers |
| [domainCommands.service.md](businesslogic/domainCommands.service.md) | `src/services/domainCommands/` — transaction-owning executor, existing-write adapters, append-only `EntityChange`, queued outbox atomicity, post-commit finalize; Granot Lead commands plus `confirmGranotBooking`, exact `updateBooking`, and `resolveGranotBookingCaseNoAction` are registered; Release/Referral remain unavailable; checked-in effect flags stay false |
| [sheetSync.service.md](businesslogic/sheetSync.service.md) | `src/services/sheetSync/` — modes, outbox (`sheet_sync_jobs`), Vercel Queue wake-up, drainer, coordinator API, tombstones, cron/admin |
| [operationsRegistry.service.md](businesslogic/operationsRegistry.service.md) | `src/services/operationsRegistry/` — catalog/source/CPL/RC inbound-route/Granot CRM source SoR, signed owner mutations, `resolveCpl` |
| [granotLifecycle.capture.md](businesslogic/granotLifecycle.capture.md) | `src/services/granotLifecycle/capture.ts` — webhook auth, v2 receipt capture, channel-neutral operation-ID capture, `{ receipt_id }` wake-up. Program map: `rules/granot-lifecycle-capture.mdc` |
| [granotLifecycle.extensionApply.md](businesslogic/granotLifecycle.extensionApply.md) | `src/services/granotLifecycle/extensionApply.ts` — Owner extension apply items, receipt capture, `claimAndProcessOrPoll`, safe compatibility result |
| [granotLifecycle.automationApply.md](businesslogic/granotLifecycle.automationApply.md) | `src/services/granotLifecycle/automationApply.ts` — Owner-approved HTTP automation receipt apply, resumable `accepted_for_processing` |
| [granotLifecycle.normalization.md](businesslogic/granotLifecycle.normalization.md) | `src/services/granotLifecycle/normalization.ts` — one Observation per receipt, exact Section 10 vocabulary; **no matching/effects** |
| [granotLifecycle.sourcePolicy.md](businesslogic/granotLifecycle.sourcePolicy.md) | `src/services/granotLifecycle/sourcePolicy.ts` — fail-closed Registry policy resolution and eight-name effect-gate snapshot with real enabled/active facts; **no effects** |
| [granotLifecycle.identity.md](businesslogic/granotLifecycle.identity.md) | `src/services/granotLifecycle/identity.ts` — source-scoped Form/Call ladders, Agent assertion, Booking delegation context; **read-only, consumed by the processor** |
| [granotLifecycle.desiredState.md](businesslogic/granotLifecycle.desiredState.md) | `src/services/granotLifecycle/leadDesiredState.ts` + `granotTemporal.ts` + `authorizedDesiredState.ts` + `leadContactProjection.ts` — origin authority matrix, allowlisted command conversion, immediate `create_if_missing` / insufficient-data plans, role-safe contact projection; **plans only, no writes** |
| [granotLifecycle.processor.md](businesslogic/granotLifecycle.processor.md) | `src/services/granotLifecycle/processor.ts` + `createLeadFromGranot.ts` — channel-neutral orchestration, identity + planner + gates, historical job Record Link, live Booking-case open/refresh, live matched-Lead writes through `synchronizeLeadFromGranot`, live authorized create-if-missing through `createLeadFromGranot`; **no official Booking/Cancellation writes** |
| [granotLifecycle.drainer.md](businesslogic/granotLifecycle.drainer.md) | `src/services/granotLifecycle/drainer.ts` — fenced claim/lease, queue/cron drain, technical vs pending-match clocks, dead letter, Owner requeue; **no Lead/Booking effects** |
| [granotLifecycle.revisions.md](businesslogic/granotLifecycle.revisions.md) | `src/models/granotLifecycleSchemas.ts` + `aggregateRevision.ts` — `domain_revision` / history-boundary fields, Unit 12 Lead provenance storage, CAS primitive; existing adapters stamp `last_change_*` from append-only `EntityChange` |
| [granotLifecycle.bookingReconciliation.md](businesslogic/granotLifecycle.bookingReconciliation.md) | Booking case open/refresh/sequence plus strict standard confirm, deterministic existing-Booking full update, and zero-effect No Action; checked-in command gate remains false |
| [granotLifecycle.projections.md](businesslogic/granotLifecycle.projections.md) | `src/services/granotLifecycle/projections.ts` + protected Admin routes — masked case/candidate DTOs and stable Job/Lead timelines; advertises `commands` when the Booking-command flag is true; **reads never invoke mutations** |
| [granotHttpCollector.service.md](businesslogic/granotHttpCollector.service.md) | `src/services/granotHttpCollector/` — HTTP session collector, preview/approve/apply runs; apply captures `granot_http_automation` receipts |

**Not duplicated here (yet):** `employeeBookings/`, `leadMessaging/`, `reporting/`, `ingestion/` — mapped in `rules/project-organization.mdc`.

**Relationship to platform docs and `rules/`:**

| Layer | Location | Contains |
|-------|----------|----------|
| **Domain language** | [`../CONTEXT.md`](../CONTEXT.md) + [`../docs/adr/`](../docs/adr/) | Platform glossary — Form Lead, Sheet Sync, CRM Posting, etc. Canonical terms for all repos. |
| **Business logic** | `businesslogic/*.service.md` | How owner rules manifest in each service. **Uses glossary terms from root `CONTEXT.md`; links — does not redefine.** |
| **Software logic** | `rules/*.mdc` | Folder ownership, thin routes, TEST_MODE, outbox/drainer, TypeScript/testing. |
| **Long-form human docs** | `docs/` | Owner specs, showcase, implementation plans |

Granot lead-lifecycle long-form (Units 01–25 fulfillment review; code-complete, not production-live): [`docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md`](../docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md). Older `docs/to_review/` webhook notes describe the pre-processor world.

Prefer updating the relevant `businesslogic` file when changing a single service; update [`rules/business-logic.mdc`](rules/business-logic.mdc) or workflow rules when invariants span many modules. Terminology changes belong in root [`CONTEXT.md`](../CONTEXT.md), not duplicated here.

---

## `agents/` — Cursor subagents

| Agent | Use for |
|-------|---------|
| [docs-keeper](agents/docs-keeper.md) | After code or workflow changes: update the matching documentation layer and the glob-scoped rule that already owns those paths. Covers this server (primary), `vantage-admin`, the Granot extension, and `vantage-movers-clients`. |
| [lead-lifecycle-spec-extractor](agents/lead-lifecycle-spec-extractor.md) | Extract locked Granot lead-lifecycle contracts before implementing a unit. Not a docs rewriter. |

Invoke with: `Use the docs-keeper subagent to [area or files].`

---

## `rules/` — Cursor rules (`.mdc`)

Rule files apply when editing matching paths (`globs` in each file frontmatter). Highlights:

| Rule | Focus |
|------|--------|
| `documentation-maintenance.mdc` | Layer + glob hygiene; routes drift fixes to `docs-keeper` |
| `business-logic.mdc` | Domain invariants, drift policy, links to `businesslogic/` |
| `owner-lead-workflow.mdc` | Website → form lead → CRM → extension → booking → cancellation; webhook receipt path is separate from form/CRM writes |
| `sheet-sync-process.mdc` | Outbox, drainer, quotas, headers, sync modes |
| `project-organization.mdc` | Folder ownership (RingCentral, leads, sheet sync, Granot, etc.) |
| `ringcentral-integration.mdc` | RingCentral env, webhooks, cron |
| `ringcentral-call-lead-candidates.mdc` | Candidate aggregation + ingest boundaries |
| `form-lead-granot-crm.mdc` | Granot CRM form-lead posting |
| `granot-lifecycle-capture.mdc` | Granot lead-lifecycle software map: webhook capture, extension/automation receipt apply, processor, matched-Lead sync, authorized create-if-missing; Booking/Release Reconciliation is not live |
| `granot-http-automation.mdc` | HTTP collector / automation runs; approved apply captures `granot_http_automation` receipts |
| `lead-lifecycle-delivery.mdc` | Branch plan for Granot lead-lifecycle units (server / admin / extension) |
| `granot-crm-csv-s3-sync.mdc` | CSV/S3 CRM sync |
| `observability-service.mdc` | Operational events and alerts |
| `schema-and-crud-inputs.mdc` | Models and validation patterns |
| `backend-safety.mdc` | Safe change practices |
| `testing.mdc` | Test conventions |
| `typescript.mdc` | TS style |
| `codebase.mdc` | General codebase notes |
| `branch-test-vercel-workflow.mdc` | Branch deploy / test workflow |

---

## `scripts/`

| Script | Purpose |
|--------|---------|
| `start-mongo.sh` | Local Mongo for dev |
| `start-api.sh` | Run API locally |

Used by Cursor cloud agent / local agent environments (`environment.json`).

---

## Other files

| File | Purpose |
|------|---------|
| `ringcentral_cron_review.md` | Internal review of Call Log cron, duplicate guard, analytics limits |
| `environment.json` | Cursor agent: install/start commands, terminals |
| `Dockerfile` | Agent container build |

---

## Adding a new `businesslogic` doc

1. Read the target service and its direct helpers (duplicate, scope, sheet sync, etc.).
2. Create `businesslogic/{name}.service.md` with the standard header block:
   - **Platform glossary** → [`../CONTEXT.md`](../CONTEXT.md)
   - **ADRs** → [`../docs/adr/`](../docs/adr/) (link relevant ADRs)
   - **Primary code** → actual `src/services/...` path
   - **Domain terms used** → 2–5 bullets from glossary (link, don't define)
   - Then: triggers, invariants, Sheet Sync job types, cross-links, related rules
3. Add a row to the table in this file.
4. If the change affects cross-cutting invariants, patch [`rules/business-logic.mdc`](rules/business-logic.mdc) or the relevant workflow rule.

Keep each doc **compact** (roughly one screen to a few screens). Link to `rules/` for process details already documented there.
