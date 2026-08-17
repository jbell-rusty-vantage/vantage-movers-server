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

**Naming:** `{service-or-area}.service.md` mirroring the primary file under `api/services/`.

| File | Covers |
|------|--------|
| [form-lead.service.md](businesslogic/form-lead.service.md) | `formLead.service.ts` — create/update/delete, duplicates, Granot, form-fill → call leads, sheet tabs |
| [call-lead.service.md](businesslogic/call-lead.service.md) | `callLead.service.ts` — manual vs RingCentral create, duplicate calls, form-fill, CPL, sheet tabs |
| [googleSheets.service.md](businesslogic/googleSheets.service.md) | `googleSheets/googleSheets.service.ts` — tab routing, upsert/delete, projections, master vs source writes |
| [adminSearch.service.md](businesslogic/adminSearch.service.md) | `admin/adminSearch.service.ts` — global admin search, scopes, resources, vs browse |
| [agentAllocation.service.md](businesslogic/agentAllocation.service.md) | `agents/agentAllocation.service.ts` — binder splits, catalog resolve, patch/replace, primary agent, cancellation snapshot |
| [analytics.service.md](businesslogic/analytics.service.md) | `analytics/analytics.service.ts` — admin report router, scopes, filters, merge, overview/agent-sales siblings |
| [bookings.service.md](businesslogic/bookings.service.md) | `bookings/` — create/update/delete, from-source, mirror, referral, sheet `booking_chain`, idempotency |
| [bookedCallLeadReconciliation.service.md](businesslogic/bookedCallLeadReconciliation.service.md) | `reconciliation/bookedCallLeadReconciliation.service.ts` — Granot Booked Jobs → call lead/booking field refresh, match paths, source rules, sheet sync |
| [ringcentral-call-lead-qualification.service.md](businesslogic/ringcentral-call-lead-qualification.service.md) | `ringcentral/` — 120s qualification (evaluator + vetting), webhook session aggregation, Call Log cron, shared ingest (idempotency, duplicate, write mode) |
| [cancelledLead.service.md](businesslogic/cancelledLead.service.md) | `cancellations/cancelledLead.service.ts` + `cancellationResolver.ts` — create/update/delete, booking resolve, snapshot fields, sheet `cancellation_chain`, referral guard |
| [cancellationMirror.service.md](businesslogic/cancellationMirror.service.md) | `cancellations/cancellationMirror.service.ts` — stamp/clear `cancelled` on source lead, syncAfterClear batching |
| [formLeadSearch.service.md](businesslogic/formLeadSearch.service.md) | `search/formLeadSearch.service.ts` — scored form identity search, ambiguity, duplicate quarantine, Granot CSV fallback |
| [callLeadSearch.service.md](businesslogic/callLeadSearch.service.md) | `search/callLeadSearch.service.ts` — OR-based call lookup, summaries |
| [leadBrowse.service.md](businesslogic/leadBrowse.service.md) | `search/*Browse.service.ts` + `leadBrowseShared.ts` — extension GET browse, pagination, attachment chips |
| [catalog.service.md](businesslogic/catalog.service.md) | `catalog/catalog.service.ts` — agents/merchants CRUD, name normalization, active resolve for bookings |
| [customer.service.md](businesslogic/customer.service.md) | `customers/` — CRUD, cascade delete, booking-time upsert from lead/contact |
| [testimonial.service.md](businesslogic/testimonial.service.md) | `testimonials/testimonial.service.ts` — read-only list for marketing site, ingest helpers |
| [sheetSync.service.md](businesslogic/sheetSync.service.md) | `sheetSync/` — modes, outbox (`sheet_sync_jobs`), Vercel Queue wake-up, drainer, coordinator API, tombstones, cron/admin |
| [granotLifecycle.capture.md](businesslogic/granotLifecycle.capture.md) | `granotLifecycle/` — webhook auth, v2 receipt capture, `{ receipt_id }` wake-up; no processing |

**Not duplicated here (yet):** call lead enrichment — still lives in `rules/*.mdc` and `docs/`.

**Relationship to platform docs and `rules/`:**

| Layer | Location | Contains |
|-------|----------|----------|
| **Domain language** | [`../CONTEXT.md`](../CONTEXT.md) + [`../docs/adr/`](../docs/adr/) | Platform glossary — Form Lead, Sheet Sync, CRM Posting, etc. Canonical terms for all repos. |
| **Business logic** | `businesslogic/*.service.md` | How owner rules manifest in each service. **Uses glossary terms from root `CONTEXT.md`; links — does not redefine.** |
| **Software logic** | `rules/*.mdc` | Folder ownership, thin routes, TEST_MODE, outbox/drainer, TypeScript/testing. |
| **Long-form human docs** | `docs/` | Owner specs, showcase, implementation plans |

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
| `owner-lead-workflow.mdc` | Website → form lead → CRM → extension → booking → cancellation |
| `sheet-sync-process.mdc` | Outbox, drainer, quotas, headers, sync modes |
| `project-organization.mdc` | Folder ownership (RingCentral, leads, sheet sync, etc.) |
| `ringcentral-integration.mdc` | RingCentral env, webhooks, cron |
| `ringcentral-call-lead-candidates.mdc` | Candidate aggregation + ingest boundaries |
| `form-lead-granot-crm.mdc` | Granot CRM form-lead posting |
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
   - **Primary code** → actual `api/services/...` path
   - **Domain terms used** → 2–5 bullets from glossary (link, don't define)
   - Then: triggers, invariants, Sheet Sync job types, cross-links, related rules
3. Add a row to the table in this file.
4. If the change affects cross-cutting invariants, patch [`rules/business-logic.mdc`](rules/business-logic.mdc) or the relevant workflow rule.

Keep each doc **compact** (roughly one screen to a few screens). Link to `rules/` for process details already documented there.
