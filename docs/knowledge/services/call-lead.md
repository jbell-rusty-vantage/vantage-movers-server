---
type: Service
title: Call Lead Service
description: Create Call Leads only from qualified RingCentral queue calls; manage corrections, duplicates, billing and Master Leads projection.
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
  by: process:docs-keeper
  at: 2026-09-04T20:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/leads/callLead.service.ts`, `src/services/leads/leadIngestionProvenance.ts`, `src/services/leads/leadCplResolution.ts`  
**Domain terms used:** [Call Lead](../../../../CONTEXT.md), [Call Lead Ingestion](../../../../CONTEXT.md), [Call Qualification](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [Form Fill](../../../../CONTEXT.md), [CPL](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Caller Match Key](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md), [Source Granularity](../../../../CONTEXT.md), [RingCentral Call Adoption](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md)

# Call Lead Service

**Owner amendment, October 15, 2026:** optional `CallLead.move_date` now persists the date supplied by full accepted Granot synchronization, and the Outreach Desk displays/sorts it. A valid full Call Lead match may update this one date at any valid priority; broad contact/quote enrichment still follows its existing 1/5 policy. Priority-only identities and stale/invalid observations do not gain move-write authority. Missing dates retain any stored date. Legacy CSV Follow Up enrichment is unchanged. Historical missing dates on open desk Call Leads are recovered only from their own stamped accepted Granot observations through the audited [Outreach date repair](sales-outreach-desk.md#queue-loading-performance--october-15-2026); this adds no manual API field, Sheet column, provider call, receiver/source/money change or new index.

**System of Record:** MongoDB `call_leads`. Owner reporting via **Sheet Sync** → **Master Sheets**.

**Owner billing rule, November 3, 2026:** Only a finished inbound RingCentral call to a mapped queue can create a Call Lead. Webhook and cron both use final Detailed Call Log qualification: total elapsed time of at least 120 seconds, with answer optional. See [qualification](ringcentral-call-lead-qualification.md) and [billing eligibility and release checks](../../call-lead-billing.md).

Manual/API creation, external sheet creation, Granot Call creation, booking placeholders and reconciliation creation of Call Leads are retired. Granot may synchronize an existing Call Lead. Form Fill and Form sibling pairing may enrich an already-qualified Call Lead. Historical origins remain intact; saved RingCentral evidence decides billing and projection.

## Call Lead Ingestion — Ring Central (`ingestRingCentralCallLead` / `beginRingCentralCallLeadIngestion`)

1. Caller supplies `duplicate` (from ingest duplicate guard) and a resolved source assignment.
2. Detect Form Fill by matching a non-duplicate Form Lead with the same caller in the source scope.
3. Save with `ringcentral.*` transport provenance (session id, call log id, nested `ingestion_source`, **Call Qualification**, timestamps) plus `callLeadCreationProvenanceFields({ origin: "ringcentral" })` (`quoted=false`, immutable contact snapshot). Nested `ingestion_source` stays transport, not Ingestion Origin.
4. **`cpl = 0` when Duplicate Lead** — `resolveLeadCplSnapshot` is called with `duplicate`; status `duplicate_zero` keeps `base_period_id` when present.
5. `ingestRingCentralCallLead` after commit: sheets, then `lead.cpl.missing_rate` if needed, then `lead.call.form_fill_detected` when `form_fill`. This adapter does **not** emit `lead.call.created` (ingest emits `ringcentral.call_lead.created` / `ringcentral.call_lead.duplicate_created`).
6. Default ingest (`beginRingCentralCallLeadIngestion` + `completeCallLeadIngestion`) currently **does** emit `lead.call.created` in addition to the ingest `ringcentral.call_lead.*` event. Do not silently drop or add that event to make the two completes agree.
7. Unique sparse index on `ringcentral.telephony_session_id` prevents the **same call** from inserting twice (webhook vs cron idempotency — separate from business Duplicate Lead).

### Duplicate Lead rule (upstream of this service)

Per glossary and `ringcentral-duplicate-guard.ts`:

- Same exact **Source Granularity** + normalized phone as an earlier qualified **non-duplicate** Call Lead in the inclusive prior 90-day window.
- Excludes the current `telephony_session_id`.
- Call Log sync ingests one run oldest-first so same-batch callbacks classify against the earlier call. The window itself stays earlier-only.
- Duplicate Call Leads still persist and **Sheet Sync**; they are **never CRM-posted** (Call Lead Enrichment is separate).

**Config note:** `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` in `ringcentral-config.ts` is exposed for debug display only; the guard uses hardcoded `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90`.

### CPL snapshot

Create/update use `resolveLeadCplSnapshot` (Operations Registry periods). Duplicate Ring Central creates store `cpl = 0` with status `duplicate_zero`. Move Type / location may still be unknown until **Call Lead Enrichment**.

## Sheet Sync tab routing

| Condition | Master Leads tab |
|-----------|------------------|
| Saved qualified, matched, billable | `Calls` |
| Effective duplicate (repeat call, Form Fill or trusted duplicate review) | `Duplicate Calls` |
| Trusted bad review or confirmed overnight Missed result, without duplicate precedence | `Bad Call Leads` |

Missing qualification and unmatched Calls are excluded from every Call tab. Booking/Cancellation rows remain independent. Delivery upserts the desired row by Mongo ID before deleting every stale membership from the other Call destinations; deletes/tombstones enumerate all destinations even with missing metadata. The `FormFill` column retains canonical `form_fill` and may be false for an annotation-only duplicate.

Ordinary No-Sync suppresses normal Calls delivery only. Effective duplicate/bad exceptions still project; No-Sync alone does not change billing. Owner UI copy is Hide / Show / Hidden from Master Leads and does not expose internal flag names.

## Form Fill linkage

| Direction | Behavior |
|-----------|----------|
| At Call Lead create | `hasFormFillForCallLead` reads existing non-duplicate Form Leads in the source scope (company, or company `$or` Lead Source Company) with the normalized phone |
| At Form Lead create | Non-duplicate Form Leads call `markMatchingCallLeadsWithFormFill`, which reads qualified Call Leads and excludes ones already marked `form_fill` ([`form-lead.md`](./form-lead.md)) |

Form Fill excludes Call Lead billing and routes to Duplicate Calls. It does not rewrite the canonical repeat-call `duplicate` field or invent a sibling.

## Correction (`correctCallLead`)

- Strips forbidden lifecycle fields. Optional location (including explicit `local`); re-derives states/local only when zip/state/`local` is in the patch. Optional `receiver_agent` via Operations Registry (missing agent → 404). The source enum includes `granot_username_match`; existing extension writes still store `extension_crm_username_match`, which remains readable. S6-AGENT adds `ringcentral_answered` (the one reviewed rep who answered the Call Lead's creating call, written only into an empty field; the API schema does not accept it). `ringcentral_rep_call` is the Sales Outreach Desk's answered-inbound receiver (the reviewed rep who answered an inbound on an unassigned desk Lead with an empty receiver; an outbound attempt does not write it, [desk](./sales-outreach-desk.md)); also never accepted from the API, and replaced by any matching Granot rep.
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
| Manual/API creates | No public Call Lead creation route; only qualified RingCentral calls may mint. |
| Idempotency vs Duplicate Lead | Same telephony session ≠ business duplicate (different calls, same caller within ±90 days) |
| CRM | Call leads not CRM-posted at create; **Call Lead Enrichment** is separate |
| Helpers | Do not bypass phone normalization, Form Fill, Source Company parsing, or Sheet Sync scheduling |
| Granot synchronize | Operational phone stays the ingested caller; snapshot coalesces by Job. Not a live-contact upsert |

## Structured log events

Logger `msg` keys only; nothing is persisted (the Operational Events ledger was retired in the 2026-10 server/admin slimming).

| Path | Events |
|------|--------|
| `ingestRingCentralCallLead` | form-fill event from this service when `form_fill`; **no** `lead.call.created` |
| Default RingCentral ingest (`begin` + `complete`) | `lead.call.created` from complete, plus ingest `ringcentral.call_lead.created` / `duplicate_created` |

## Lifecycle revision

`domain_revision` defaults to `0`. `change_history_started_at` is a write-once server boundary. Public/admin DTOs cannot set revision, origin, snapshot, Priority provenance, temporal-winner, contact-summary, or `ringcentral_convergence` metadata. Canonical create/update/delete routes persist an append-only `EntityChange` and stamp `last_change_*` in the executor transaction. Lead Job Number remains non-unique. `quoted` is required and defaults to `false`. `post_to_granot` defaults to `false`; explicit `true` fails validation only for `granot_lead_created` rows. The field remains non-required, and ordinary legacy rows with either an absent field or a historical `true` remain saveable. Nested `ringcentral.ingestion_source` remains transport provenance and is not Ingestion Origin. Historical rows without durable proof receive `legacy_unknown` / `legacy_baseline` from the Lead provenance migration only; later RingCentral adoption never rewrites `granot_lead_created`. `createLeadFromGranot` cannot create new Call Leads.

## Related services

- [`form-lead.md`](./form-lead.md) — Form Fill side effects on Form Lead Ingestion
- [`processor.md`](../granot-lifecycle/processor.md) — Granot Form creation and matched-Lead synchronization
- [`identity.md`](../granot-lifecycle/identity.md) — unique Call Job/link skips competing phone; phone rung is live + ingested only (no snapshot phone)
- [`enrichment.md`](./enrichment.md) — Follow Up preview/sync
- [`ringcentral-call-lead-qualification.md`](./ringcentral-call-lead-qualification.md) — **Call Qualification**, ingest gate
- [`google-sheets.md`](./google-sheets.md) — Calls / Duplicate Calls / Bad Call Leads tabs

## Related rules

- [`ringcentral-integration.mdc`](../../../.cursor/rules/ringcentral-integration.mdc) — env, webhooks, cron wiring
- [`ringcentral-call-lead-candidates.mdc`](../../../.cursor/rules/ringcentral-call-lead-candidates.mdc) — pipeline boundaries


## Reporting and billing disposition

`leads/callLeadReportingDisposition.ts` owns effective Call classification. Saved qualification and unmatched gates come first. Canonical repeat-call duplicate, Form Fill and trusted duplicate reviews route to Duplicate Calls at zero billable cost. Trusted bad-call reviews and confirmed final caller-side Missed results arriving in [01:00,07:00) America/New_York route to Bad Call Leads at zero billable cost. Duplicate wins while retaining both reasons. Unknown results and answered-leg conflicts are not inferred missed calls. The canonical repeat-call `duplicate` field, price provenance and preferred Form Booking anchor are preserved. No-Sync alone changes delivery, not billing; exception tabs still project. All sheet paths use the same decision and 15-column Call projection. See [billing contract](../../call-lead-billing.md) and [operator/release evidence](../../lead-reporting-retirement/README.md).
