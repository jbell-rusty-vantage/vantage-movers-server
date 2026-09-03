---
type: Service
title: Call Lead Service
description: Ingest, correct, list, and remove Call Leads from Admin/sheet and RingCentral paths, including duplicates and CPL snapshots.
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
  at: 2026-09-02T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/leads/callLead.service.ts`, `src/services/leads/leadIngestionProvenance.ts`, `src/services/leads/leadCplResolution.ts`  
**Domain terms used:** [Call Lead](../../../../CONTEXT.md), [Call Lead Ingestion](../../../../CONTEXT.md), [Call Qualification](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Source Granularity](../../../../CONTEXT.md), [RingCentral Call Adoption](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md)

# Call Lead Service

**System of Record:** MongoDB `call_leads`. Owner reporting via **Sheet Sync** → **Master Sheets**.

**Three ingest origins** — same collection, different Duplicate Lead rules. Story names are the real implementations; old `create*` / `update*` / `delete*` exports are aliases.

| Function | Caller | Duplicate Lead | CPL |
|----------|--------|----------------|-----|
| `ingestCallLead` (alias `createCallLead`) | Leftover public / `v1.service` path. Hardcodes `ingestion_origin: "vantage_admin"`. **Not** the HTTP path. | never passed; stays false | `resolveLeadCplSnapshot` (no `duplicate` flag) |
| `beginCallLeadIngestion` / `completeCallLeadIngestion` | Canonical `POST /api/v1/call-leads` via `runExistingCreateCallLead` + `deriveCallLeadIngestionOrigin` ([`domain-commands.md`](./domain-commands.md)). Default RingCentral ingest also calls `completeCallLeadIngestion` after `beginRingCentralCallLeadIngestion`. | Admin/sheet never passed | Admin/sheet: no `duplicate` flag. After commit: sheets, missing CPL, **`lead.call.created`**, Form Fill event |
| `ingestRingCentralCallLead` (alias `createRingCentralCallLead`) | Injectable ingest adapter only (`dependencies.createLead`). Default ingest does **not** call this. | passed in by ingest | `resolveLeadCplSnapshot({ duplicate })` → `duplicate_zero` / `cpl = 0` when Duplicate Lead. After commit: sheets, missing CPL, Form Fill — **not** `lead.call.created` |
| `beginRingCentralCallLeadIngestion` | Default RingCentral ingest write + replica tests | passed in by ingest | same snapshot as the injectable adapter |
| `createLeadFromGranot` | Granot lifecycle processor only, after live `create_if_missing` authorization and no eligible match ([`processor.md`](../granot-lifecycle/processor.md)). Call may mint on `lead_created` only. Not this file. | `false`; sparse Job-only creation is allowed | exact active Source Granularity rate snapshot |

**Call Qualification** + ingest: [`ringcentral-call-lead-qualification.md`](./ringcentral-call-lead-qualification.md). Duplicate classification: `ringcentral-duplicate-guard.ts`; promotion gate: `ringcentral-call-lead-ingest.service.ts`.

## Inbound Granot create and fences

[Call Qualification](../../../../CONTEXT.md) remains the Call Lead qualifier for mapped inbound streams. Best Relocation Forms and Inbounds keep `create_if_missing`. Main Site / 10best / TBM Prime / Top10 Inbounds stay `link_only` after the 2026-09-03 revert. If an Owner later puts `create_if_missing` on one of those companies, mapped qualifying calls stay RingCentral-created or adopted via [RingCentral Call Adoption](../../../../CONTEXT.md), and a later Granot Observation **synchronizes** onto an existing RingCentral Call Lead.

Owner language uses [Caller Match Key](../../../../CONTEXT.md). The locked implementation key is exact Source Granularity + normalized phone — never Source Company alone.

When `createLeadFromGranot` mints a Call Lead and the Observation has a normalized phone, both Granot lock sites always run (`ensureRingCentralConvergenceScopeLock` before the transaction; `acquire` + pre-creation candidate check inside it). The adoption flag does not gate that Granot fence. A later inbound Observation for the same Job or the same exact Source Granularity + phone **synchronizes**; it does not mint a second Lead. Job-only create (no Observation phone) remains legal and skips both sites — a residual hole; do not invent a phone. The ingest-side lock stays flagged; it is not always on.

`assertSingleActiveRingCentralAssignment` allows 0 assignment rows (Granot-only, Best Relocation Inbounds) or exactly one active valid route. Create stays `lead_created` only. `priority_updated` never mints, including Call + `create_if_missing`. Best Relocation Inbounds keeps `create_if_missing` and its existing `sendGranotCreatedLeadConfirmation` finalize when messaging gates are on. Other inbound families stay silent until a separate `outbound_sms` command.

## Call Lead Ingestion — Admin / sheet (`ingestCallLead` / `begin` / `complete`)

1. Normalize name, parse **Source Company** (`resolveLeadSourceAssignment`, channel `call`), optional location (`resolveOptionalLocation`).
2. **Form Fill** check — `hasFormFillForCallLead(source, phone)`: true when a non-duplicate Form Lead exists with same source + normalized phone. Missing/unparseable phone → `false`.
3. Save via `callLeadCreationProvenanceFields`: `quoted=false`, trusted `ingestion_origin`, immutable `ingested_contact_snapshot`. Public `ingestCallLead` origin is `vantage_admin`. Canonical `deriveCallLeadIngestionOrigin`: undefined/`vantage_admin` → `vantage_admin`; `ringcentral` → `ringcentral`; sheet ingest → `best_relocation_sheet`; Granot lifecycle → `granot_lead_created`. Unproven origins throw.
4. Before commit: remember Sheet Sync intent (`call_lead.create`). After commit `completeCallLeadIngestion` projects onto sheets, then `lead.cpl.missing_rate` if needed, then `lead.call.created`, then `lead.call.form_fill_detected` when `form_fill`.
5. No Ring Central metadata; no Call Lead duplicate window logic; no CRM Posting.

## Call Lead Ingestion — Ring Central (`ingestRingCentralCallLead` / `beginRingCentralCallLeadIngestion`)

1. Caller supplies `duplicate` (from ingest duplicate guard) and a resolved source assignment.
2. Same Form Fill check as Admin path.
3. Save with `ringcentral.*` transport provenance (session id, call log id, nested `ingestion_source`, **Call Qualification**, timestamps) plus `callLeadCreationProvenanceFields({ origin: "ringcentral" })` (`quoted=false`, immutable contact snapshot). Nested `ingestion_source` stays transport, not Ingestion Origin.
4. **`cpl = 0` when Duplicate Lead** — `resolveLeadCplSnapshot` is called with `duplicate`; status `duplicate_zero` keeps `base_period_id` when present.
5. `ingestRingCentralCallLead` after commit: sheets, then `lead.cpl.missing_rate` if needed, then `lead.call.form_fill_detected` when `form_fill`. This adapter does **not** emit `lead.call.created` (ingest emits `ringcentral.call_lead.created` / `ringcentral.call_lead.duplicate_created`).
6. Default ingest (`beginRingCentralCallLeadIngestion` + `completeCallLeadIngestion`) currently **does** emit `lead.call.created` in addition to the ingest `ringcentral.call_lead.*` event. Do not silently drop or add that event to make the two completes agree.
7. Unique sparse index on `ringcentral.telephony_session_id` prevents the **same call** from inserting twice (webhook vs cron idempotency — separate from business Duplicate Lead).

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

## Correction (`correctCallLead`)

- Strips forbidden lifecycle fields. Optional location (including explicit `local`); re-derives states/local only when zip/state/`local` is in the patch. Optional `receiver_agent` via Operations Registry (missing agent → 404). The source enum includes `granot_username_match`; existing extension writes still store `extension_crm_username_match`, which remains readable.
- **Blocked:** `duplicate === true` when the Call Lead is already Booked (ConflictError). Does not re-run the 90-day Duplicate Lead guard.
- Recomputes the **CPL** snapshot only when source-affecting fields change, `lead_source_company` is missing, `timestamp` is patched, or `duplicate` is patched (`resolveLeadCplSnapshot` receives current `lead.duplicate`).
- No field changes → return the lead and skip Sheet Sync. Otherwise `persistTheCorrectionAndRefreshTheBookingChain` saves + refreshes attached **Booking Chain** (`call_lead.update`). Missing CPL after save emits `lead.cpl.missing_rate` even on the in-transaction command path (before command commit). Move that report only as a separate, tested change.
- Canonical PATCH uses `correctCallLead(..., { transaction })`. Persisted `command_name` remains `updateSourceOwnedLead`.

## Removal (`removeCallLead` / `beginCallLeadRemoval`)

- Same cascade rules as Form Leads (`cascade=true` when Booked).
- Queued mode: tombstone `delete_source_lead` / `delete_call_lead` with `duplicate` plus `rememberBothCallSheetTabsForTombstone` (alias `buildCallLeadDeletePreviousTargets`). That helper always adds Master **Calls** and **Duplicate Calls** fallbacks even when `sheet_sync` is empty, and keeps known row numbers from existing `sheet_sync` entries.
- Legacy: `deleteCallLeadFromSheets` then Mongo delete.
- Standalone cascade still goes through `v1.service.deleteBookedLead`; the command path dynamically imports `bookings/bookedLead.service`. Persisted `command_name` remains `deleteCallLead`.

## List

- `listRecentCallLeads` (alias `findAllCallLeads`) — last 200 by `createdAt`. Duplicate Leads stay visible.
- `GET /api/v1/call-leads` uses browse, not this leftover last-200.

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
| Admin/sheet complete | `lead.call.created`, `lead.call.form_fill_detected` when applicable |
| `ingestRingCentralCallLead` | form-fill event from this service when `form_fill`; **no** `lead.call.created` |
| Default RingCentral ingest (`begin` + `complete`) | `lead.call.created` from complete, plus ingest `ringcentral.call_lead.created` / `duplicate_created` |

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
