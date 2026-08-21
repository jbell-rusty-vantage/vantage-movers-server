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
├── businesslogic/           ← stubs that redirect to docs/knowledge/ (one release)
├── rules/                   ← Cursor rule files (*.mdc), scoped by glob
├── skills/                  ← project Agent Skills (hit-vantage-api, okf-docs-conversion)
├── okf-workspace/           ← conversion agent board (NOW, messages, ideas). Not knowledge
├── scripts/                 ← Cloud helpers (ensure-cloud-runtime, start-mongo, start-api)
├── environment.json         ← Cursor cloud agent environment config
├── Dockerfile               ← Cursor cloud agent image
└── ringcentral_cron_review.md  ← ad-hoc RingCentral cron review notes
```

---

## `businesslogic/` — service-level domain docs

**Purpose:** Short, accurate descriptions of *what a service does* in business terms: source of truth, invariants, routing, edge cases, and related modules. Canonical files now live under [`docs/knowledge/`](../docs/knowledge/). `.cursor/businesslogic/` holds stubs for one release.

**When to update:** Any behavior change in the documented service (see also `rules/business-logic.mdc` drift policy). Start from [`docs/index.md`](../docs/index.md).

**Naming:** `docs/knowledge/services/<name>.md` and `docs/knowledge/granot-lifecycle/<name>.md`. Old `.service.md` / `granotLifecycle.*` paths are stubs.

| File | Covers |
|------|--------|
| [form-lead.md](../docs/knowledge/services/form-lead.md) | `src/services/leads/formLead.service.ts` — create/update/delete, duplicates, Granot CRM post, form-fill → call leads, receiver agent, trusted Ingestion Origin + ingested snapshots, sheet tabs. Stub at [businesslogic/form-lead.service.md](businesslogic/form-lead.service.md). |
| [call-lead.md](../docs/knowledge/services/call-lead.md) | `src/services/leads/callLead.service.ts` — manual vs RingCentral create, duplicate calls, form-fill, CPL snapshot, receiver agent, trusted Ingestion Origin + ingested snapshot, sheet tabs. Stub at [businesslogic/call-lead.service.md](businesslogic/call-lead.service.md). |
| [google-sheets.md](../docs/knowledge/services/google-sheets.md) | `src/services/googleSheets/googleSheets.service.ts` — tab routing, upsert/delete, projections, master vs source writes. Stub at [businesslogic/googleSheets.service.md](businesslogic/googleSheets.service.md). |
| [admin-search.md](../docs/knowledge/services/admin-search.md) | `src/services/admin/adminSearch.service.ts` — global admin search, scopes, resources, vs browse. Stub at [businesslogic/adminSearch.service.md](businesslogic/adminSearch.service.md). |
| [agent-allocation.md](../docs/knowledge/services/agent-allocation.md) | `src/services/agents/agentAllocation.service.ts` — binder splits, catalog resolve, patch/replace, primary agent, cancellation snapshot. Stub at [businesslogic/agentAllocation.service.md](businesslogic/agentAllocation.service.md). |
| [analytics.md](../docs/knowledge/services/analytics.md) | `src/services/analytics/` — admin report router, scopes, filters, merge, overview/agent-sales/receiver-agent siblings. Stub at [businesslogic/analytics.service.md](businesslogic/analytics.service.md). |
| [bookings.md](../docs/knowledge/services/bookings.md) | `src/services/bookings/` — create/update/delete, from-source, mirror, referral, leadless, sheet `booking_chain`, idempotency. Stub at [businesslogic/bookings.service.md](businesslogic/bookings.service.md). |
| [booked-call-lead-reconciliation.md](../docs/knowledge/services/booked-call-lead-reconciliation.md) | `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` — Granot Booked Jobs → call lead/booking field refresh, match paths, source rules, sheet sync. Stub at [businesslogic/bookedCallLeadReconciliation.service.md](businesslogic/bookedCallLeadReconciliation.service.md). |
| [enrichment.md](../docs/knowledge/services/enrichment.md) | `src/services/enrichment/callLeadEnrichment.service.ts` — Follow Up preview/sync, match/conflict, receiver-agent username match, sheet `call_lead.enrichment.sync`. Stub at [businesslogic/enrichment.service.md](businesslogic/enrichment.service.md). |
| [ringcentral-call-lead-qualification.md](../docs/knowledge/services/ringcentral-call-lead-qualification.md) | `src/services/ringcentral/` — 120s qualification (evaluator + vetting), webhook session aggregation, Call Log cron, shared ingest (idempotency, duplicate, write mode). Stub at [businesslogic/ringcentral-call-lead-qualification.service.md](businesslogic/ringcentral-call-lead-qualification.service.md). |
| [cancelled-lead.md](../docs/knowledge/services/cancelled-lead.md) | `src/services/cancellations/cancelledLead.service.ts` + `cancellationResolver.ts` — create/update/delete, booking resolve, snapshot fields, sheet `cancellation_chain`, referral guard. Stub at [businesslogic/cancelledLead.service.md](businesslogic/cancelledLead.service.md). |
| [cancellation-mirror.md](../docs/knowledge/services/cancellation-mirror.md) | `src/services/cancellations/cancellationMirror.service.ts` — stamp/clear `cancelled` on source lead, syncAfterClear batching. Stub at [businesslogic/cancellationMirror.service.md](businesslogic/cancellationMirror.service.md). |
| [form-lead-search.md](../docs/knowledge/services/form-lead-search.md) | `src/services/search/formLeadSearch.service.ts` — scored form identity search, ambiguity, duplicate quarantine, Granot CSV fallback. Stub at [businesslogic/formLeadSearch.service.md](businesslogic/formLeadSearch.service.md). |
| [call-lead-search.md](../docs/knowledge/services/call-lead-search.md) | `src/services/search/callLeadSearch.service.ts` — OR-based call lookup, summaries. Stub at [businesslogic/callLeadSearch.service.md](businesslogic/callLeadSearch.service.md). |
| [lead-browse.md](../docs/knowledge/services/lead-browse.md) | `src/services/search/*Browse.service.ts` + `leadBrowseShared.ts` — extension GET browse, pagination, attachment chips. Stub at [businesslogic/leadBrowse.service.md](businesslogic/leadBrowse.service.md). |
| [catalog.md](../docs/knowledge/services/catalog.md) | `src/services/catalog/catalog.service.ts` — agents/merchants facade; mutations go through Operations Registry. Stub at [businesslogic/catalog.service.md](businesslogic/catalog.service.md). |
| [customer.md](../docs/knowledge/services/customer.md) | `src/services/customers/` — CRUD, cascade delete, booking-time upsert from lead/contact. Stub at [businesslogic/customer.service.md](businesslogic/customer.service.md). |
| [testimonial.md](../docs/knowledge/services/testimonial.md) | `src/services/testimonials/testimonial.service.ts` — read-only list for marketing site, ingest helpers. Stub at [businesslogic/testimonial.service.md](businesslogic/testimonial.service.md). |
| [domain-commands.md](../docs/knowledge/services/domain-commands.md) | `src/services/domainCommands/` — transaction-owning executor, existing-write adapters, append-only `EntityChange`, queued outbox atomicity, post-commit finalize; Granot Lead, Booking, Release, and leadless Referral Booking commands are registered; checked-in effect flags stay false. Stub at [businesslogic/domainCommands.service.md](businesslogic/domainCommands.service.md). |
| [sheet-sync.md](../docs/knowledge/services/sheet-sync.md) | `src/services/sheetSync/` — modes, outbox (`sheet_sync_jobs`), Vercel Queue wake-up, drainer, coordinator API, tombstones, cron/admin. Stub at [businesslogic/sheetSync.service.md](businesslogic/sheetSync.service.md). |
| [operations-registry.md](../docs/knowledge/services/operations-registry.md) | `src/services/operationsRegistry/` — catalog/source/CPL/RC inbound-route/Granot CRM source SoR, signed owner mutations, `resolveCpl`. Stub at [businesslogic/operationsRegistry.service.md](businesslogic/operationsRegistry.service.md). |
| [capture.md](../docs/knowledge/granot-lifecycle/capture.md) | `src/services/granotLifecycle/capture.ts` — webhook auth, v2 receipt capture, channel-neutral operation-ID capture, `{ receipt_id }` wake-up. Program map: `rules/granot-lifecycle-capture.mdc`. Stub at [businesslogic/granotLifecycle.capture.md](businesslogic/granotLifecycle.capture.md). |
| [extension-apply.md](../docs/knowledge/granot-lifecycle/extension-apply.md) | `src/services/granotLifecycle/extensionApply.ts` — Owner extension apply items, receipt capture, `claimAndProcessOrPoll`, safe compatibility result. Stub at [businesslogic/granotLifecycle.extensionApply.md](businesslogic/granotLifecycle.extensionApply.md). |
| [automation-apply.md](../docs/knowledge/granot-lifecycle/automation-apply.md) | `src/services/granotLifecycle/automationApply.ts` — Owner-approved HTTP automation receipt apply, resumable `accepted_for_processing`. Stub at [businesslogic/granotLifecycle.automationApply.md](businesslogic/granotLifecycle.automationApply.md). |
| [normalization.md](../docs/knowledge/granot-lifecycle/normalization.md) | `src/services/granotLifecycle/normalization.ts` — one Observation per receipt, exact Section 10 vocabulary; **no matching/effects**. Stub at [businesslogic/granotLifecycle.normalization.md](businesslogic/granotLifecycle.normalization.md). |
| [source-policy.md](../docs/knowledge/granot-lifecycle/source-policy.md) | `src/services/granotLifecycle/sourcePolicy.ts` — fail-closed Registry policy resolution and eight-name effect-gate snapshot with real enabled/active facts; **no effects**. Stub at [businesslogic/granotLifecycle.sourcePolicy.md](businesslogic/granotLifecycle.sourcePolicy.md). |
| [identity.md](../docs/knowledge/granot-lifecycle/identity.md) | `src/services/granotLifecycle/identity.ts` — source-scoped Form/Call ladders, Agent assertion, Booking delegation context; **read-only, consumed by the processor**. Stub at [businesslogic/granotLifecycle.identity.md](businesslogic/granotLifecycle.identity.md). |
| [desired-state.md](../docs/knowledge/granot-lifecycle/desired-state.md) | `src/services/granotLifecycle/leadDesiredState.ts` + `granotTemporal.ts` + `authorizedDesiredState.ts` + `leadContactProjection.ts` — origin authority matrix, allowlisted command conversion, immediate `create_if_missing` / insufficient-data plans, role-safe contact projection; **plans only, no writes**. Stub at [businesslogic/granotLifecycle.desiredState.md](businesslogic/granotLifecycle.desiredState.md). |
| [processor.md](../docs/knowledge/granot-lifecycle/processor.md) | `src/services/granotLifecycle/processor.ts` + `createLeadFromGranot.ts` — channel-neutral orchestration, identity + planner + gates, historical job Record Link, live Booking-case open/refresh, live matched-Lead writes through `synchronizeLeadFromGranot`, live authorized create-if-missing through `createLeadFromGranot`; **no official Booking/Cancellation writes**. Stub at [businesslogic/granotLifecycle.processor.md](businesslogic/granotLifecycle.processor.md). |
| [drainer.md](../docs/knowledge/granot-lifecycle/drainer.md) | `src/services/granotLifecycle/drainer.ts` — fenced claim/lease, queue/cron drain, technical vs pending-match clocks, dead letter, Owner requeue; **no Lead/Booking effects**. Stub at [businesslogic/granotLifecycle.drainer.md](businesslogic/granotLifecycle.drainer.md). |
| [revisions.md](../docs/knowledge/granot-lifecycle/revisions.md) | `src/models/granotLifecycleSchemas.ts` + `aggregateRevision.ts` — `domain_revision` / history-boundary fields, Unit 12 Lead provenance storage, CAS primitive; existing adapters stamp `last_change_*` from append-only `EntityChange`. Stub at [businesslogic/granotLifecycle.revisions.md](businesslogic/granotLifecycle.revisions.md). |
| [booking-reconciliation.md](../docs/knowledge/granot-lifecycle/booking-reconciliation.md) | Booking case open/refresh/sequence plus strict standard confirm, leadless Referral create, deterministic existing-Booking full update, and zero-effect No Action; checked-in command and Referral gates remain false. Stub at [businesslogic/granotLifecycle.bookingReconciliation.md](businesslogic/granotLifecycle.bookingReconciliation.md). |
| [release-reconciliation.md](../docs/knowledge/granot-lifecycle/release-reconciliation.md) | Separate Release cases plus explicit Owner create-Cancellation, full Booking replacement, and No Action commands; checked-in Release flags remain false. Stub at [businesslogic/granotLifecycle.releaseReconciliation.md](businesslogic/granotLifecycle.releaseReconciliation.md). |
| [projections.md](../docs/knowledge/granot-lifecycle/projections.md) | `src/services/granotLifecycle/projections.ts` + protected Admin routes — masked merged Booking/Release case DTOs, stable Job/Lead timelines, and Mongo-backed operations health; Referral and Release expose no Lead candidates and commands only behind their gates; **reads never invoke mutations**. Stub at [businesslogic/granotLifecycle.projections.md](businesslogic/granotLifecycle.projections.md). |
| [observability.md](../docs/knowledge/granot-lifecycle/observability.md) | `observability.ts` + `metrics.ts` + `alerts.ts` — Section 33 event catalog, closed metric labels, seven rollout alerts, and Owner/Admin health projection; instrumentation is not business authority. Stub at [businesslogic/granotLifecycle.observability.md](businesslogic/granotLifecycle.observability.md). |
| [granot-http-collector.md](../docs/knowledge/services/granot-http-collector.md) | `src/services/granotHttpCollector/` — HTTP session collector, preview/approve/apply runs; apply captures `granot_http_automation` receipts. Stub at [businesslogic/granotHttpCollector.service.md](businesslogic/granotHttpCollector.service.md). |

**Not duplicated here (yet):** `employeeBookings/`, `leadMessaging/`, `reporting/`, `ingestion/` — mapped in `rules/project-organization.mdc`.

**Relationship to platform docs and `rules/`:**

| Layer | Location | Contains |
|-------|----------|----------|
| **Domain language** | [`../CONTEXT.md`](../CONTEXT.md) + [`../docs/adr/`](../docs/adr/) | Platform glossary — Form Lead, Sheet Sync, CRM Posting, etc. Canonical terms for all repos. |
| **Business logic** | [`docs/knowledge/`](../docs/knowledge/) (stubs in `businesslogic/`) | How owner rules manifest in each service. **Uses glossary terms from root `CONTEXT.md`; links — does not redefine.** |
| **Software logic** | `rules/*.mdc` | Folder ownership, thin routes, TEST_MODE, outbox/drainer, TypeScript/testing. |
| **Long-form human docs** | `docs/` | Owner specs, showcase, implementation plans |

Granot lead-lifecycle long-form:
- Units 01–25 fulfillment review (code-complete, not production-live): [`docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md`](../docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md) // pragma: allowlist secret
- Owner-facing flags, activation, and reviewed source policies: [`docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md`](../docs/granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md)

Older `docs/to_review/` webhook notes describe the pre-processor world.

Prefer updating the matching Service under [`docs/knowledge/`](../docs/knowledge/) when changing a single service; update [`rules/business-logic.mdc`](rules/business-logic.mdc) or workflow rules when invariants span many modules. Terminology changes belong in root [`CONTEXT.md`](../CONTEXT.md), not duplicated here.

---

## `okf-workspace/` — conversion agent board

Message passing and progress for the scheduled OKF conversion Cloud Agent. **Not** an OKF bundle and **not** a Service catalog.

| File | Role |
|------|------|
| [okf-workspace/README.md](okf-workspace/README.md) | Resume protocol, lock, authority |
| [okf-workspace/NOW.md](okf-workspace/NOW.md) | Current pass + next unit + lock |
| [okf-workspace/MESSAGES.md](okf-workspace/MESSAGES.md) | Open / resolved messages |
| [okf-workspace/IDEAS.md](okf-workspace/IDEAS.md) | Parked ideas (not this-run work) |
| [okf-workspace/CONTRADICTIONS.md](okf-workspace/CONTRADICTIONS.md) | Standing source fights |
| [okf-workspace/PROGRESS.md](okf-workspace/PROGRESS.md) | Generated by `pnpm okf:progress --write` |
| [okf-workspace/sessions/](okf-workspace/sessions/) | Append-only run logs |

`docs/index.md` (after Pass 0) lists concepts. This folder says what the last agent finished and what the next one must do. Disk wins: `pnpm okf:progress`.

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
| `business-logic.mdc` | Domain invariants, drift policy, links to `docs/knowledge/` |
| `owner-lead-workflow.mdc` | Website → form lead → CRM → extension → booking → cancellation; webhook receipt path is separate from form/CRM writes |
| `sheet-sync-process.mdc` | Outbox, drainer, quotas, headers, sync modes |
| `project-organization.mdc` | Folder ownership (RingCentral, leads, sheet sync, Granot, etc.) |
| `ringcentral-integration.mdc` | RingCentral env, webhooks, cron |
| `ringcentral-call-lead-candidates.mdc` | Candidate aggregation + ingest boundaries |
| `form-lead-granot-crm.mdc` | Granot CRM form-lead posting |
| `granot-lifecycle-capture.mdc` | Granot lead-lifecycle software map: webhook capture, extension/automation receipt apply, processor, matched-Lead sync/create, Booking/Referral/Release owner commands, protected reads, Section 33 events/metrics, and Mongo-backed health/alerts; effect flags remain false |
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
| `production-url.mdc` | Production host `vantage-movers-main-server.vercel.app` + v1/admin route catalog | // pragma: allowlist secret

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

## Adding a new Service doc

1. Read the target service and its direct helpers (duplicate, scope, sheet sync, etc.).
2. Create `docs/knowledge/services/{name}.md` (stamp YAML per `.cursor/skills/okf-docs-conversion/FRONTMATTER.md`) with the standard header block:
   - **Platform glossary** → [`../CONTEXT.md`](../CONTEXT.md)
   - **ADRs** → [`../docs/adr/`](../docs/adr/) (link relevant ADRs)
   - **Primary code** → actual `src/services/...` path
   - **Domain terms used** → 2–5 bullets from glossary (link, don't define)
   - Then: triggers, invariants, Sheet Sync job types, cross-links, related rules
3. Add a row to [`docs/index.md`](../docs/index.md) and the table in this file.
4. If the change affects cross-cutting invariants, patch [`rules/business-logic.mdc`](rules/business-logic.mdc) or the relevant workflow rule.

Keep each doc **compact** (roughly one screen to a few screens). Link to `rules/` for process details already documented there.
