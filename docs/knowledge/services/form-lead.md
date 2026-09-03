---
type: Service
title: Form Lead Service
description: Create, update, and delete Form Leads, including duplicates, CRM Posting, and Sheet Sync tab routing.
tags: [form-lead, ingestion, crm-posting]
status: draft
stale_after: 2026-11-27
resource: src/services/leads/formLead.service.ts
applies_to:
  - src/services/leads/formLead.service.ts
  - src/services/leads/wordpressFormSubmissionReceipt.ts
  - src/models/WordpressFormSubmissionReceipt.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/leads/leadCplResolution.ts
  - src/services/leads/duplicateLead.service.ts
  - src/services/crm/crm.service.ts
  - src/services/crm/formLeadPayload.ts
  - src/routes/v1.routes.ts
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
  by: process:docs-keeper
  at: 2026-08-28T01:50:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) for Granot identity; [`../../../../docs/adr/`](../../../../docs/adr/) for [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md) and [0002 CRM post survives failures](../../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md)
**Primary code:** `src/services/leads/formLead.service.ts`, `src/services/leads/wordpressFormSubmissionReceipt.ts`, `src/services/leads/leadIngestionProvenance.ts`, `src/services/leads/leadCplResolution.ts`, `src/services/crm/crm.service.ts`, `src/services/crm/formLeadPayload.ts`  
**Domain terms used:** [Form Lead Ingestion](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [CRM Posting](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Tracking Reference](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md), [Move Type](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md)

# Form Lead Service

**System of Record:** MongoDB `form_leads`. Owner reporting via **Sheet Sync** → **Master Sheets** (Source Company Sheets derive via import queries).

**Triggers:** `POST /api/v1/form-leads` via `runExistingCreateFormLead` + `deriveFormLeadIngestionOrigin` ([`domain-commands.md`](./domain-commands.md)); leftover public `ingestFormLead` (alias `createFormLead`) is not the HTTP path. `PATCH /api/v1/form-leads/:id` → `correctFormLead` (legacy alias `updateFormLead`). Canonical ingest/admin wrappers call `beginFormLeadIngestion` / `correctFormLead` with the executor `{ session, now }` and `completeFormLeadIngestion` only after commit. Public routes still own `runSheetSyncWrite`. Admin Dashboard Manual tab posts this same create route with an owner actor so [Ingestion Origin](../../../../CONTEXT.md) is Vantage Admin.

Public `ingestFormLead` always assigns `ingestion_origin: "wordpress_form"` and forces a Mongo transaction when `sms_consent === true` and messaging is allowed in this runtime (`!TEST_MODE` or the test-mode allow flag). Canonical wrappers pass `deriveFormLeadIngestionOrigin`: Best Relocation sheet → `best_relocation_sheet`; Granot lifecycle → `granot_lead_created`; `vantage_admin` + owner/admin actor → `vantage_admin`; `vantage_admin` + system/undefined actor → `wordpress_form`. Unproven command origins throw.

## Form Lead Ingestion — ingest (`ingestFormLead`)

| Step | What happens |
|------|----------------|
| 1. Normalize | Name, phone, **Source Company** (`resolveLeadSourceAssignment`), required location |
| 2. Derive | **Move Type** (`deriveFormLeadLocal` from pickup/delivery states; trusted Best Relocation create may pass `local` through when `ingestion_source === "best_relocation_sheet"`), **CPL** snapshot (`resolveLeadCplSnapshot` → `operationsRegistry.resolveCpl`), Florida `timestamp`, **Tracking Reference** (`ref_no`, default `"not provided"`), `lid` (`generateLeadId` when omitted), `move_date` (`input.move_date ?? tx.now` on this create path), trusted `ingestion_origin`, immutable `ingested_contact_snapshot` / `ingested_move_snapshot` (`captured_at_ingestion`, same trusted `now`) |
| 3. **Duplicate Lead** check | `findDuplicateFormLeadMatch` — throws if Source Granularity is missing; same exact `source_granularity_id`; earlier non-duplicate Form Lead; same cohort around `2026-04-30T04:00:00.000Z` (pre-cutoff looks only before the event timestamp; on/after cutoff looks `[cutoff, event)`); normalized phone **or** email |
| 3b. [WordPress Form Submission Receipt](../../../../CONTEXT.md) | Authorized test path only — see **WordPress Form Submission Receipt** below. Capture runs **before** `FormLead.save`. Unauthorized / missing key / production DB: no receipt write; Lead create continues. |
| 4. Persist + Sheet Sync intent | Atomic in queued mode via `runSheetSyncWrite`: save Form Lead with `duplicate` flag; `post_to_granot = post_to_granot && !duplicate`. `wordpress_submission_key` is stripped before persist. |
| 4b. Form Fill (non-duplicates only) | `markMatchingCallLeadsWithFormFill` — same source + phone Call Leads → `form_fill=true`; enqueues `call_lead.form_fill.update` jobs in same txn |
| 4c. Enqueue | `source_lead` / `form_lead.create` Sheet Sync job |
| 5. Post-commit | See **Post-save order** below |

### Post-save order (current code vs ADR intent)

| Order | ADR-0002 intent | Current code (`completeFormLeadIngestion`) |
|-------|-------------------|--------------|
| 1 | Mongo persist | ✓ (in txn) |
| 2 | (not in ADR) | `dispatchOrQueuePersistedLeadMessage` — awaited, isolated; never throws out of finalize |
| 3 | **CRM Posting** (Tracking Reference as `leadno`) | Runs **after** Sheet Sync finalization |
| 4 | **Sheet Sync** (`finalizeSheetSync`) | Runs **before** CRM Posting |
| 5 | **Operational Events** | After CRM |

**Known gap (deferred):** `finalizeSheetSync` runs before `submitFormLeadToCrm`. A Sheet Sync failure can block CRM Posting; order is reversed from ADR happy path. CRM Posting should still be best-effort when enabled and lead is not a Duplicate Lead ([ADR-0002](../../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md)).

### WordPress Form Submission Receipt

`beginFormLeadIngestion` calls `captureWordpressReceiptThenCreateLead` before `FormLead.save`. This is Job Timeline source-assurance, not Granot lifecycle delivery. Collection `wordpress_form_submission_receipts` (`autoIndex: false`).

Write only when **all** of these hold:

- `ingestion_origin === "wordpress_form"`
- `TEST_MODE` and the connected database matches `^testvantagemovers(?:_[a-z0-9]+)?$`
- request supplied `wordpress_submission_key` (8–128). Never inferred from the Lead, `lid`, phone, email, payload, or **Tracking Reference**.

Fail closed: capture failure aborts Lead create. Attach after Lead persist is also fail-closed: attach failure throws and does not leave a retry that can create a second Form Lead. Same key + existing unattached receipt (`lead_ref` null): refuse another Lead create. Same key + existing `lead_ref` whose Lead still exists: reuse that Lead. No second receipt, Lead, Sheet Sync job, CRM Post, or EntityChange. Authorized capture with a submission key forces the Form Lead write onto the same Mongo transaction so insert + Lead + attach abort together. Unauthorized / missing key / production DB: no receipt write; Lead create continues; Job Number timeline stays on `WORDPRESS_RECEIPT_UNAVAILABLE` ([`job-number-timeline.md`](./job-number-timeline.md)).

Indexes are report-first: `pnpm migration:wordpress-form-submission-receipts`. Applied on `testvantagemovers` only. Production apply is refused in the CLI.

CRM Posting and Sheet Sync tables below are unchanged.

### CRM Posting

- When `post_to_granot` and not Duplicate Lead → `submitFormLeadToCrm`
- Granot payload `label` comes from Operations Registry `crm_label_snapshot` on the resolved source assignment. Request `crm_company_label` is logged as `requestedCompanyLabel` only; it is not persisted and does not set CRM `label`.
- Payload `leadno` = persisted **Tracking Reference** (`FormLead.ref_no`); Granot exposes it as the **Granot Form Reference** in `ref_no`. Exact `FormLead.ref_no` lookup is primary; a valid Mongo `_id`-shaped Granot `ref_no` is compatibility fallback only after the exact lookup misses. CRM wire names live in `formLeadPayload.ts` + `crm/types.ts`.
- Duplicate Form Leads and caller-disabled posting → skip; emit `crm.form_lead.submit.skipped`

### CPL snapshot

Create/update store `cpl`, `cpl_rate_period`, `cpl_resolution_status` (`resolved` / `duplicate_zero` / `missing_rate` / `not_applicable`), `cpl_resolved_at`, and `cpl_resolution_version` via `leads/leadCplResolution.ts`. Authority is Operations Registry periods, not `cpl.ts` / `getCplForSource`. Missing coverage emits `lead.cpl.missing_rate`.

### Granot lifecycle boundary

CRM Posting is independent of webhook capture. Capture remains receipt-only ([`capture.md`](../granot-lifecycle/capture.md)). Authorized live `create_if_missing` Form creation is owned by `createLeadFromGranot` through the processor, not by `ingestFormLead` or public Zod ([`processor.md`](../granot-lifecycle/processor.md)). That command uses trusted Granot create validators (`post_to_granot=false`) and never CRM-posts. It derives `local` only from accepted origin/destination state facts and leaves `move_date` absent when the Observation has none; the model does not invent either fact. WordPress-created Form Leads that later match a Granot `lead_created` Observation stay on `synchronizeLeadFromGranot` and never mint a second Lead. Approved HTTP automation apply captures a `granot_http_automation` receipt and does not call `correctFormLead` ([`granot-http-collector.md`](./granot-http-collector.md), [`automation-apply.md`](../granot-lifecycle/automation-apply.md)). Ordinary Form Edit Lead still uses `PATCH /api/v1/form-leads/:id`.

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

## Correction (`correctFormLead`)

- Re-normalizes provided fields. Strips forbidden lifecycle fields (`omitForbiddenLeadLifecycleFields`).
- Re-derives **Move Type** only when pickup/delivery zip or state is in the patch. Recomputes the **CPL** snapshot only when source-affecting fields change, `lead_source_company` is missing, or `timestamp` is patched.
- Optional `receiver_agent` (+ `receiver_agent_source` / snapshots) via Operations Registry agent lookup. Missing agent → 404. The source enum includes `granot_username_match`; existing extension writes still store `extension_crm_username_match`, which remains readable.
- **Blocked:** `quoted` / `cubic_feet` / `receiver_agent_source === "extension_crm_username_match"` on Duplicate Leads (one ConflictError); **Bad Lead** on duplicate, Booked, or Cancelled leads.
- `options.expected` miss or Mongoose `VersionError` → ConflictError `preview_drift` ("reload before applying").
- No field changes → return the lead and skip Sheet Sync.
- Otherwise saves + enqueues attached **Booking Chain** refresh (`form_lead.update`). Missing CPL after save emits `lead.cpl.missing_rate`.

## Read / delete

| Function | Behavior |
|----------|----------|
| `findFormLeadForEnrichment` | Extension lookup; projected identity/quote/location/receiver fields only; **404 if missing or Duplicate Lead** (not an enrichment target) |
| `listRecentFormLeads` | Last 200 by `createdAt` |
| `removeFormLead` | `cascade=true` required when Booked; queued mode uses Sheet Sync tombstone (`duplicate` preserved for correct tab delete) |

## Invariants

| Rule | Detail |
|------|--------|
| Duplicate Form Leads | Always saved + Sheet Sync'd to `Duplicates`; **never CRM-posted** |
| Form Fill | One-way at create: new non-duplicate Form Lead marks existing Call Leads; not run for duplicates |
| Helpers | Do not bypass Source Company, location, duplicate, or Sheet Sync scheduling |
| `sms_consent` | Boolean or `"true"`/`"false"` at the route; only parsed `true` creates a Lead Message. Duplicate leads record a skipped message; false/missing creates no message. |
| Lifecycle revision | `domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision metadata. Canonical create/update/delete routes persist an append-only `EntityChange` and stamp `last_change_*` in the executor transaction. |
| Ingestion Origin | Server-assigned and immutable. Public `ingestFormLead` always stores `wordpress_form`. Canonical `deriveFormLeadIngestionOrigin`: Best Relocation sheet → `best_relocation_sheet`; Granot lifecycle → `granot_lead_created`; `vantage_admin` + owner/admin actor → `vantage_admin`; `vantage_admin` + system/undefined actor → `wordpress_form`. Unproven origins throw. `createLeadFromGranot` assigns `granot_lead_created` and forces `post_to_granot=false`. Clients cannot set `ingestion_origin`. Historical rows without durable proof receive `legacy_unknown` from the Lead provenance migration only; labels and `ref_no` never decide origin. |
| Immutable creation evidence | New Form Leads persist `ingested_contact_snapshot` and `ingested_move_snapshot` in the create transaction. Later Granot evidence cannot overwrite them. Missing historical snapshots may be labeled `legacy_baseline` from current fields only; `captured_at_ingestion` is never rewritten. `granot_contact_snapshot` is a separate field. |
| Admin display and any-known-contact search | Admin `/form-leads` and `/duplicate-form-leads` keep Name / Phone as Form submitted and show a Granot contact chip when `granot_contact_snapshot` exists (`Changed in Granot` when `differs_from_ingested === true`). That flag is stamped with the planner's semantic contact compare (US phone digits, email case, name capitalization/whitespace, and name-only vs the same first/last peel). Detail adds a Contacts section (Form submitted live fields + Granot card). Admin browse, Admin typeahead, and extension `GET /form-leads` match name / email / phone across live + ingested + Granot contact paths. Writes, edit DTOs, and scored `POST /form-leads/search` are unchanged. |
| WordPress Form Submission Receipt | Independent ingress fact, not a Lead and not a Granot Observation Receipt. Capture-before-create on the authorized test path only. Capture and attach after persist are fail-closed. Same key + unattached receipt (`lead_ref` null) refuses a second Lead; same key + existing `lead_ref` reuses that Lead. Authorized capture with a submission key forces `runSheetSyncWrite({ forceTransaction: true })`. Field stripped before persist. |
| Form Job Number / sparse move facts | Additive `job_no` / `normalized_job_no` via existing `normalizeJobNo`. This is not **Tracking Reference**. CRM Posting still sends `FormLead.ref_no` as `leadno`. The model allows absent `move_size` / `move_date` so trusted Granot creation can preserve absence. This service's `beginFormLeadIngestion` still writes `move_date: input.move_date ?? tx.now`. A legacy CRM payload built from an absent stored date emits an empty `movedte` instead of inventing today. |

Lead Messaging owner invariants live in [`lead-messaging.md`](./lead-messaging.md).
Form create persists intent only when `sms_consent` is parsed `true`; duplicates
record a skipped row; dispatch runs after commit and cannot fail the 201.

## Operational Events (create)

- `lead.form.created`
- `lead.form.duplicate_detected` (warn, when Duplicate Lead)
- `lead.form.call_leads_marked_form_fill` (when Call Leads flipped)
- `crm.form_lead.submit.skipped` (when CRM Posting skipped)

## Related services

- [`call-lead.md`](./call-lead.md) — Form Fill on Call Lead create; Call Lead Ingestion
- [`operations-registry.md`](./operations-registry.md) — CPL periods + agent lookup
- [`sheet-sync.md`](./sheet-sync.md) — outbox, drainer, job shapes
- [`google-sheets.md`](./google-sheets.md) — tab routing, Master vs Source Company Sheet writes
- [`job-number-timeline.md`](./job-number-timeline.md) — WordPress `source_received` when a receipt row is loaded; `WORDPRESS_RECEIPT_UNAVAILABLE` until WordPress ingress
- [`capture.md`](../granot-lifecycle/capture.md) — webhook receipts (no Form Lead writes)
- [`processor.md`](../granot-lifecycle/processor.md) — authorized Granot Form create and matched-Lead sync
- [`identity.md`](../granot-lifecycle/identity.md) — source-scoped Form ladder reads `ref_no`, snapshots, Duplicate/Bad eligibility; no Form Lead writes
- [`automation-apply.md`](../granot-lifecycle/automation-apply.md) — HTTP automation apply captures receipts; does not call `correctFormLead`

## Related rules

- [`form-lead-granot-crm.mdc`](../../../.cursor/rules/form-lead-granot-crm.mdc) — CRM Posting payload and posting flow
- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — outbox modes, drainer, quotas
- [`observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) — Operational Events
