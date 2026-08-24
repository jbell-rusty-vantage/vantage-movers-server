---
type: Service
title: Call Lead Service
description: Create and update Call Leads from manual and RingCentral ingest, including duplicates and CPL snapshots.
tags: [call-lead, ingestion]
status: draft
stale_after: 2026-11-20
resource: src/services/leads/callLead.service.ts
applies_to:
  - src/services/leads/callLead.service.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/leads/leadCplResolution.ts
  - src/services/leads/duplicateLead.service.ts
  - src/routes/v1.routes.ts
  - src/services/ringcentral/ringcentral-call-lead-ingest.service.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/leads/callLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T01:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/leads/callLead.service.ts`, `src/services/leads/leadIngestionProvenance.ts`, `src/services/leads/leadCplResolution.ts`  
**Domain terms used:** [Call Lead](../../../../CONTEXT.md), [Call Lead Ingestion](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md)

# Call Lead Service

**System of Record:** MongoDB `call_leads`. Owner reporting via **Sheet Sync** → **Master Sheets**.

**Three create paths** — same collection, different origin and Duplicate Lead rules:

| Function | Caller | Duplicate Lead | CPL |
|----------|--------|----------------|-----|
| `createCallLead` | `POST /api/v1/call-leads` (manual, Invoca, tests). Hardcodes `ingestion_origin: "vantage_admin"`. Canonical wrappers use `createCallLeadInTransaction` + `deriveCallLeadIngestionOrigin` ([`domain-commands.md`](./domain-commands.md)). | never passed; stays false | `resolveLeadCplSnapshot` (no `duplicate` flag) |
| `createRingCentralCallLead` | **Call Lead Ingestion** (Ring Central) only | passed in by ingest | `resolveLeadCplSnapshot({ duplicate })` → `duplicate_zero` / `cpl = 0` when Duplicate Lead, else registry snapshot |
| `createLeadFromGranot` | Granot lifecycle processor only, after live `create_if_missing` authorization and no eligible match ([`processor.md`](../granot-lifecycle/processor.md)) | `false`; sparse Job-only creation is allowed | exact active Source Granularity rate snapshot |

**Call Qualification** + ingest: [`ringcentral-call-lead-qualification.md`](./ringcentral-call-lead-qualification.md). Duplicate classification: `ringcentral-duplicate-guard.ts`; promotion gate: `ringcentral-call-lead-ingest.service.ts`.

## Create — manual/API (`createCallLead`)

1. Normalize name, parse **Source Company** (`resolveLeadSourceAssignment`, channel `call`), optional location (`resolveOptionalLocation`).
2. **Form Fill** check — `hasFormFillForCallLead(source, phone)`: true when a non-duplicate Form Lead exists with same source + normalized phone. Missing/unparseable phone → `false`.
3. Save via `callLeadCreationProvenanceFields`: `quoted=false`, trusted `ingestion_origin`, immutable `ingested_contact_snapshot`. Public `createCallLead` origin is `vantage_admin`. Canonical `deriveCallLeadIngestionOrigin`: undefined/`vantage_admin` → `vantage_admin`; `ringcentral` → `ringcentral`; sheet ingest → `best_relocation_sheet`; Granot lifecycle → `granot_lead_created`. Unproven origins throw.
4. Enqueue `call_lead.create`; `finalizeCallLeadCreateAfterCommit` runs Sheet Sync, then `lead.cpl.missing_rate` if needed, then `lead.call.created`, then `lead.call.form_fill_detected` when `form_fill`.
5. No Ring Central metadata; no Call Lead duplicate window logic.

## Create — Ring Central (`createRingCentralCallLead`)

1. Caller supplies `duplicate` (from ingest duplicate guard) and a resolved source assignment.
2. Same Form Fill check as manual path.
3. Save with `ringcentral.*` transport provenance (session id, call log id, nested `ingestion_source`, **Call Qualification**, timestamps) plus `callLeadCreationProvenanceFields({ origin: "ringcentral" })` (`quoted=false`, immutable contact snapshot).
4. **`cpl = 0` when Duplicate Lead** — `resolveLeadCplSnapshot` is called with `duplicate`; status `duplicate_zero` keeps `base_period_id` when present.
5. After commit: `finalizeSheetSync`, then `lead.cpl.missing_rate` if needed, then `lead.call.form_fill_detected` when `form_fill`. This function does **not** emit `lead.call.created` (ingest emits `ringcentral.call_lead.created` / `ringcentral.call_lead.duplicate_created`).
6. Unique sparse index on `ringcentral.telephony_session_id` prevents the **same call** from inserting twice (webhook vs cron idempotency — separate from business Duplicate Lead).

### Duplicate Lead rule (upstream of this service)

Per glossary and `ringcentral-duplicate-guard.ts`:

- Same exact **Source Granularity** + normalized phone as an earlier existing **non-duplicate** Call Lead in the inclusive prior 90-day window.
- Excludes the current `telephony_session_id`.
- Duplicate Call Leads still persist and **Sheet Sync**; they are **never CRM-posted** (Call Lead Enrichment is separate).

**Config note:** `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` in `ringcentral-config.ts` is exposed for debug display only; the guard uses hardcoded `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90`.

### CPL snapshot

Create/update use `resolveLeadCplSnapshot` (Operations Registry periods). Duplicate Ring Central creates store `cpl = 0` with status `duplicate_zero`. Move Type / location may still be unknown until **Call Lead Enrichment**.

## Sheet Sync tab routing

| Condition | Master Leads tab |
|-----------|------------------|
| Not Duplicate Lead | `Calls` |
| Duplicate Lead | `Duplicate Calls` |

Delete/tombstone uses `lead.duplicate` for correct tab. `FormFill` column reflects `form_fill`.

## Form Fill linkage

| Direction | Behavior |
|-----------|----------|
| At Call Lead create | `hasFormFillForCallLead` reads existing non-duplicate Form Leads (same source + phone) |
| At Form Lead create | Non-duplicate Form Leads call `markMatchingCallLeadsWithFormFill` ([`form-lead.md`](./form-lead.md)) |

Form Fill is attribution only; does not set Duplicate Lead on Call Leads.

## Update (`updateCallLead`)

- Strips forbidden lifecycle fields. Optional location (including explicit `local`); re-derives states/local only when zip/state/`local` is in the patch. Optional `receiver_agent` via Operations Registry (missing agent → 404). The source enum includes `granot_username_match`; existing extension writes still store `extension_crm_username_match`, which remains readable.
- **Blocked:** `duplicate === true` when the Call Lead is already Booked (ConflictError). Does not re-run the 90-day Duplicate Lead guard.
- Recomputes the **CPL** snapshot only when source-affecting fields change, `lead_source_company` is missing, `timestamp` is patched, or `duplicate` is patched (`resolveLeadCplSnapshot` receives current `lead.duplicate`).
- No field changes → return the lead and skip Sheet Sync. Otherwise saves + refreshes attached **Booking Chain** (`call_lead.update`). Missing CPL after save emits `lead.cpl.missing_rate`.

## Delete (`deleteCallLead`)

- Same cascade rules as Form Leads (`cascade=true` when Booked).
- Queued mode: tombstone `delete_source_lead` / `delete_call_lead` with `duplicate` plus `buildCallLeadDeletePreviousTargets`. That helper always adds Master **Calls** and **Duplicate Calls** fallbacks even when `sheet_sync` is empty, and keeps known row numbers from existing `sheet_sync` entries.
- Legacy: `deleteCallLeadFromSheets` then Mongo delete.

## Read

- `findAllCallLeads` — last 200 by `createdAt`.
- No “hide duplicate” read helper (unlike Form Lead `findFormLead`).

## Invariants

| Rule | Detail |
|------|--------|
| Manual/API creates | Never set `duplicate: true`; only Ring Central ingest does |
| Idempotency vs Duplicate Lead | Same telephony session ≠ business duplicate (different calls, same caller within ±90 days) |
| CRM | Call leads not CRM-posted at create; **Call Lead Enrichment** is separate |
| Helpers | Do not bypass phone normalization, Form Fill, Source Company parsing, or Sheet Sync scheduling |

## Operational Events

| Path | Events |
|------|--------|
| Manual create | `lead.call.created`, `lead.call.form_fill_detected` when applicable |
| Ring Central create | ingest emits `ringcentral.call_lead.created` or `ringcentral.call_lead.duplicate_created`; form-fill event from this service when `form_fill` |

## Lifecycle revision

`domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision, origin, snapshot, Priority provenance, temporal-winner, contact-summary, or `ringcentral_convergence` metadata. Canonical create/update/delete routes persist an append-only `EntityChange` and stamp `last_change_*` in the executor transaction. Lead Job Number remains non-unique. `quoted` is required and defaults to `false`. `post_to_granot` defaults to `false`; explicit `true` fails validation only for `granot_lead_created` rows. The field remains non-required, and ordinary legacy rows with either an absent field or a historical `true` remain saveable. Nested `ringcentral.ingestion_source` remains transport provenance and is not Ingestion Origin. Historical rows without durable proof receive `legacy_unknown` / `legacy_baseline` from the Lead provenance migration only; later RingCentral adoption never rewrites `granot_lead_created`. `createLeadFromGranot` assigns `granot_lead_created`, forces `post_to_granot=false`, and may create a Job-only Call Lead: `ringcentral_convergence.state` is `pending` with a normalized phone and `not_applicable` when Job-only. It fabricates no `local`, duration, session, qualification, or RingCentral metadata. Shared provenance/temporal/convergence fields stay storage-only except that trusted Granot create path.

## Related services

- [`form-lead.md`](./form-lead.md) — Form Fill side effects on Form Lead Ingestion
- [`processor.md`](../granot-lifecycle/processor.md) — authorized Granot Call create (sparse Job-only / phone `pending`) and matched-Lead sync
- [`identity.md`](../granot-lifecycle/identity.md) — source-scoped Call ladder reads Job/phone/ingested phone; Duplicate Call Leads remain readable
- [`enrichment.md`](./enrichment.md) — Follow Up preview/sync
- [`ringcentral-call-lead-qualification.md`](./ringcentral-call-lead-qualification.md) — **Call Qualification**, ingest gate
- [`google-sheets.md`](./google-sheets.md) — Calls / Duplicate Calls tabs

## Related rules

- [`ringcentral-integration.mdc`](../../../.cursor/rules/ringcentral-integration.mdc) — env, webhooks, cron wiring
- [`ringcentral-call-lead-candidates.mdc`](../../../.cursor/rules/ringcentral-call-lead-candidates.mdc) — pipeline boundaries
