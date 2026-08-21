---
type: Service
title: Form Lead Service
description: Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync tab routing.
tags: [form-lead, ingestion, crm-posting]
status: draft
stale_after: 2026-11-19
resource: src/services/leads/formLead.service.ts
applies_to:
  - src/services/leads/formLead.service.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/leads/leadCplResolution.ts
  - src/services/crm/crm.service.ts
  - src/services/crm/formLeadPayload.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/leads/formLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
  - id: adr-0002
    resource: ../docs/adr/0002-granot-crm-post-despite-downstream-failures.md
generated:
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) for Granot identity; [`../../../../docs/adr/`](../../../../docs/adr/) for [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md) and [0002 CRM post survives failures](../../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md)
**Primary code:** `src/services/leads/formLead.service.ts`, `src/services/leads/leadIngestionProvenance.ts`, `src/services/leads/leadCplResolution.ts`, `src/services/crm/crm.service.ts`, `src/services/crm/formLeadPayload.ts`  
**Domain terms used:** [Form Lead Ingestion](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [CRM Posting](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md), [Move Type](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md)

# Form Lead Service

**System of Record:** MongoDB `form_leads`. Owner reporting via **Sheet Sync** → **Master Sheets** (Source Company Sheets derive via import queries).

**Triggers:** `POST /api/v1/form-leads` → `createFormLead`; `PATCH /api/v1/form-leads/:id` → `updateFormLead`. Canonical ingest/admin wrappers call `createFormLeadInTransaction` / `updateFormLeadInTransaction` with the executor `{ session, now }` and finalize only after commit ([`domainCommands.service.md`](./domain-commands.md)). Public routes still own `runSheetSyncWrite`.

## Form Lead Ingestion — create (`createFormLead`)

| Step | What happens |
|------|----------------|
| 1. Normalize | Name, phone, **Source Company** (`parseSourceCompany`), required location |
| 2. Derive | **Move Type** (`local` from pickup/delivery states), **CPL** snapshot (`resolveLeadCplSnapshot` → `operationsRegistry.resolveCpl`), Florida `timestamp`, **Tracking Reference** (`ref_no`, default `"not provided"`), `move_date`, trusted `ingestion_origin`, immutable `ingested_contact_snapshot` / `ingested_move_snapshot` (`captured_at_ingestion`, same trusted `now`) |
| 3. **Duplicate Lead** check | `findDuplicateFormLeadMatch(source, phone, email, timestamp)` — exact Source Granularity, same cohort around the 2026-04-30 Eastern cutoff, earlier non-duplicate Form Lead with same normalized phone **or** email |
| 4. Persist + Sheet Sync intent | Atomic in queued mode via `runSheetSyncWrite`: save Form Lead with `duplicate` flag; `post_to_granot = post_to_granot && !duplicate` |
| 4b. Form Fill (non-duplicates only) | `markMatchingCallLeadsWithFormFill` — same source + phone Call Leads → `form_fill=true`; enqueues `call_lead.form_fill.update` jobs in same txn |
| 4c. Enqueue | `source_lead` / `form_lead.create` Sheet Sync job |
| 5. Post-commit | See **Post-save order** below |

### Post-save order (current code vs ADR intent)

| Order | ADR-0002 intent | Current code |
|-------|-------------------|--------------|
| 1 | Mongo persist | ✓ (in txn) |
| 2 | **CRM Posting** (Tracking Reference as `leadno`) | Runs **after** Sheet Sync finalization |
| 3 | **Sheet Sync** (`finalizeSheetSync`) | Runs **before** CRM Posting |
| 4 | **Operational Events** | After CRM |

**Known gap (deferred):** `finalizeSheetSync` runs before `submitFormLeadToCrm`. A Sheet Sync failure can block CRM Posting; order is reversed from ADR happy path. CRM Posting should still be best-effort when enabled and lead is not a Duplicate Lead ([ADR-0002](../../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md)).

### CRM Posting

- When `post_to_granot` and not Duplicate Lead → `submitFormLeadToCrm`
- Granot source label: `getCrmFormLeadSourceCompanyLabel(source, local)`
- Payload `leadno` = persisted **Tracking Reference** (`FormLead.ref_no`); Granot exposes it as the **Granot Form Reference** in `ref_no`. Exact `FormLead.ref_no` lookup is primary; a valid Mongo `_id`-shaped Granot `ref_no` is compatibility fallback only after the exact lookup misses.
- Duplicate Form Leads and caller-disabled posting → skip; emit `crm.form_lead.submit.skipped`

### CPL snapshot

Create/update store `cpl`, `cpl_rate_period`, `cpl_resolution_status` (`resolved` / `duplicate_zero` / `missing_rate` / `not_applicable`), `cpl_resolved_at`, and `cpl_resolution_version` via `leads/leadCplResolution.ts`. Authority is Operations Registry periods, not `cpl.ts` / `getCplForSource`. Missing coverage emits `lead.cpl.missing_rate`.

### Granot lifecycle boundary

CRM Posting is independent of webhook capture. Capture remains receipt-only ([`granotLifecycle.capture.md`](../granot-lifecycle/capture.md)). Authorized live `create_if_missing` Form creation is owned by `createLeadFromGranot` through the processor, not by `createFormLead` or public Zod ([`granotLifecycle.processor.md`](../granot-lifecycle/processor.md)). That command uses trusted Granot create validators (`post_to_granot=false`) and never CRM-posts. It derives `local` only from accepted origin/destination state facts and leaves `move_date` absent when the Observation has none; the model does not invent either fact. WordPress-created Form Leads that later match a Granot `lead_created` Observation stay on `synchronizeLeadFromGranot` and never mint a second Lead. Approved HTTP automation apply captures a `granot_http_automation` receipt and does not call `updateFormLead` ([`granotHttpCollector.service.md`](./granot-http-collector.md), [`granotLifecycle.automationApply.md`](../granot-lifecycle/automation-apply.md)). Ordinary Form Edit Lead still uses `PATCH /api/v1/form-leads/:id`.

## Sheet Sync tab routing (Form Lead)

| Condition | Master Leads tab |
|-----------|------------------|
| Not Duplicate Lead | `Forms` |
| Duplicate Lead | `Duplicates` |
| `bad_lead` set | primary tab **+** `Bad Leads` |

`legacy_bad_tab` is the lossless migration-only reason for a row observed on a
legacy bad-lead surface when no trustworthy specific reason exists. It is not
derived from cell color. Duplicate, Booked, and Cancelled state keeps
precedence; the migration records the legacy disposition as provenance.

Job: `resource: source_lead`, `operation: form_lead.create` | `form_lead.update`. Delete: tombstone `delete_source_lead` / `delete_form_lead`.

## Update (`updateFormLead`)

- Re-normalizes provided fields; recomputes Move Type + CPL snapshot.
- Optional `receiver_agent` (+ `receiver_agent_source` / snapshots) via Operations Registry agent lookup. The source enum includes `granot_username_match`; existing extension writes still store `extension_crm_username_match`, which remains readable.
- **Blocked:** `quoted` / `cubic_feet` on Duplicate Leads; **Bad Lead** on duplicate, Booked, or Cancelled leads.
- Saves + enqueues attached **Booking Chain** refresh (`form_lead.update`).

## Read / delete

| Function | Behavior |
|----------|----------|
| `findFormLead` | Extension lookup; **404 if Duplicate Lead** (not an enrichment target) |
| `findAllFormLeads` | Last 200 by `createdAt` |
| `deleteFormLead` | `cascade=true` required when Booked; queued mode uses Sheet Sync tombstone (`duplicate` preserved for correct tab delete) |

## Invariants

| Rule | Detail |
|------|--------|
| Duplicate Form Leads | Always saved + Sheet Sync'd to `Duplicates`; **never CRM-posted** |
| Form Fill | One-way at create: new non-duplicate Form Lead marks existing Call Leads; not run for duplicates |
| Helpers | Do not bypass Source Company, location, duplicate, or Sheet Sync scheduling |
| `sms_consent` | Boolean or `"true"`/`"false"` at the route; only parsed `true` creates a Lead Message. Duplicate leads record a skipped message; false/missing creates no message. |
| Lifecycle revision | `domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical create/update/delete routes persist an append-only `EntityChange` and stamp `last_change_*` in the executor transaction. |
| Ingestion Origin | Server-assigned and immutable. Ordinary WordPress/`createFormLead` → `wordpress_form`; authenticated Admin actor → `vantage_admin`; trusted Best Relocation command → `best_relocation_sheet`. `createLeadFromGranot` assigns `granot_lead_created` and forces `post_to_granot=false`. Clients cannot set `ingestion_origin`. Historical rows without durable proof receive `legacy_unknown` from the Lead provenance migration only; labels and `ref_no` never decide origin. |
| Immutable creation evidence | New Form Leads persist `ingested_contact_snapshot` and `ingested_move_snapshot` in the create transaction. Later Granot evidence cannot overwrite them. Missing historical snapshots may be labeled `legacy_baseline` from current fields only; `captured_at_ingestion` is never rewritten. `granot_contact_snapshot` is a separate field. |
| Form Job Number / sparse move facts | Additive `job_no` / `normalized_job_no` via existing `normalizeJobNo`. This is not **Tracking Reference**. CRM Posting still sends `FormLead.ref_no` as `leadno`. Persisted `move_size` and `move_date` are optional so trusted Granot creation can preserve absence; ordinary WordPress/Admin validation remains the authority for those callers. A legacy CRM payload built from an absent date emits an empty `movedte` instead of inventing today. |

Lead Messaging defaults to disabled. Active sends require an E.164 destination
matching `LEAD_MESSAGING_ALLOWED_COUNTRY_PREFIXES` (default `+1`), respect the
per-destination cooldown and hourly capacity, and dispatch only after the
Form Lead plus Lead Message transaction commits.

Overnight deferral is off unless `LEAD_MESSAGING_QUIET_HOURS_ENABLED=true`.
When that flag is off (the default), confirmation SMS still send immediately
24/7 via `TWILIO_FROM_NUMBER`. When it is on, send-time uses the
America/New_York wall clock (not a fixed EST offset). If the current Eastern
hour is before 7 (12:00 AM inclusive through 6:59:59 AM), the Twilio API call
still happens immediately; Twilio Message Scheduling holds the SMS until 8:00
AM that same Eastern calendar day (`scheduleType=fixed`, `sendAt`,
`TWILIO_MESSAGING_SERVICE_SID`). This is not a cron or `next_attempt_at`
drain delay. 7:00 AM Eastern and later still send immediately. If the flag is
on, the quiet-hours window is active, and the Messaging Service SID is
missing, dispatch fails closed (does not send overnight). Post-commit
dispatch is awaited and isolated: a quiet-hours / Twilio scheduling error
marks the Lead Message `failed` and returns that status on the create
response. It does not throw out of `finalizeFormLeadCreateAfterCommit`, so
Sheet Sync, CRM Posting, and the 201 create response still complete.

## Operational Events (create)

- `lead.form.created`
- `lead.form.duplicate_detected` (warn, when Duplicate Lead)
- `lead.form.call_leads_marked_form_fill` (when Call Leads flipped)
- `crm.form_lead.submit.skipped` (when CRM Posting skipped)

## Related businesslogic

- [`call-lead.service.md`](./call-lead.md) — Form Fill on Call Lead create; Call Lead Ingestion
- [`operations-registry.md`](./operations-registry.md) — CPL periods + agent lookup
- [`sheetSync.service.md`](./sheet-sync.md) — outbox, drainer, job shapes
- [`googleSheets.service.md`](./google-sheets.md) — tab routing, Master vs Source Company Sheet writes
- [`granotLifecycle.capture.md`](../granot-lifecycle/capture.md) — webhook receipts (no Form Lead writes)
- [`granotLifecycle.processor.md`](../granot-lifecycle/processor.md) — authorized Granot Form create and matched-Lead sync
- [`granotLifecycle.identity.md`](../granot-lifecycle/identity.md) — source-scoped Form ladder reads `ref_no`, snapshots, Duplicate/Bad eligibility; no Form Lead writes
- [`granotLifecycle.automationApply.md`](../granot-lifecycle/automation-apply.md) — HTTP automation apply captures receipts; does not call `updateFormLead`

## Related rules

- [`form-lead-granot-crm.mdc`](../../../.cursor/rules/form-lead-granot-crm.mdc) — CRM Posting payload and posting flow
- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — outbox modes, drainer, quotas
- [`observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) — Operational Events
