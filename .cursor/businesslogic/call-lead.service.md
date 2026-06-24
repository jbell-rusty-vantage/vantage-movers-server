**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `api/services/leads/callLead.service.ts`  
**Domain terms used:** Call Lead, Call Lead Ingestion, Duplicate Lead, Form Fill, CPL, Sheet Sync, Caller Match Key, Lead ID

# Call Lead Service

**System of Record:** MongoDB `call_leads`. Owner reporting via **Sheet Sync** → **Master Sheets**.

**Two create paths** — same collection, different origin and Duplicate Lead rules:

| Function | Caller | Duplicate Lead | CPL |
|----------|--------|----------------|-----|
| `createCallLead` | `POST /api/v1/call-leads` (manual, Invoca, tests) | always `false` (schema default) | `getCplForSource(source, local)` |
| `createRingCentralCallLead` | **Call Lead Ingestion** (Ring Central) only | passed in by ingest | `0` when Duplicate Lead, else source CPL |

**Call Qualification** + ingest: [`ringcentral-call-lead-qualification.service.md`](ringcentral-call-lead-qualification.service.md). Duplicate classification: `ringcentral-duplicate-guard.ts`; promotion gate: `ringcentral-call-lead-ingest.service.ts`.

## Create — manual/API (`createCallLead`)

1. Normalize name, parse **Source Company**, optional location.
2. **Form Fill** check — `hasFormFillForCallLead(source, phone)`: true when a non-duplicate Form Lead exists with same source + normalized phone.
3. Save with `form_fill`, Florida `timestamp`, **CPL**; enqueue `call_lead.create` Sheet Sync job; finalize sync.
4. No Ring Central metadata; no Call Lead duplicate window logic.

## Create — Ring Central (`createRingCentralCallLead`)

1. Caller supplies `duplicate` (from ingest duplicate guard).
2. Same Form Fill check as manual path.
3. Save with `ringcentral.*` provenance (session id, call log id, ingestion source, **Call Qualification**, timestamps).
4. **`cpl = 0` when Duplicate Lead** — owner not charged twice for same caller/source within window.
5. Unique sparse index on `ringcentral.telephony_session_id` prevents the **same call** from inserting twice (webhook vs cron idempotency — separate from business Duplicate Lead).

### Duplicate Lead rule (upstream of this service)

Per glossary and `ringcentral-duplicate-guard.ts`:

- Same **Caller Match Key** (Source Company + normalized phone) as an existing **non-duplicate** Call Lead whose timestamp falls within **±90 days** of the incoming call's timestamp.
- Excludes the current `telephony_session_id`.
- Duplicate Call Leads still persist and **Sheet Sync**; they are **never CRM-posted** (Call Lead Enrichment is separate).

**Config note:** `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` in `ringcentral-config.ts` is exposed for debug display only; the guard uses hardcoded `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90`.

### CPL config lag

Glossary: CPL by Source Company + **Lead Channel** + **Move Type**. `getCplForSource` is source-centric (Best Relocation local/LD split only). Move Type on Call Leads may be unknown until **Call Lead Enrichment**.

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
| At Form Lead create | Non-duplicate Form Leads call `markMatchingCallLeadsWithFormFill` ([`form-lead.service.md`](form-lead.service.md)) |

Form Fill is attribution only; does not set Duplicate Lead on Call Leads.

## Update (`updateCallLead`)

- Optional location; recomputes Move Type + CPL via `getCplForSource`.
- **Edge case:** update recalculates CPL from source/local — does not re-run Duplicate Lead logic; changing local on a duplicate could overwrite CPL (duplicates rarely updated via API).
- Saves + refreshes attached **Booking Chain** (`call_lead.update`).

## Delete (`deleteCallLead`)

- Same cascade rules as Form Leads (`cascade=true` when Booked).
- Queued mode: tombstone with `duplicate` for correct tab; legacy: `deleteCallLeadFromSheets` then Mongo delete.

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

## Related businesslogic

- [`form-lead.service.md`](form-lead.service.md) — Form Fill side effects on Form Lead Ingestion
- [`ringcentral-call-lead-qualification.service.md`](ringcentral-call-lead-qualification.service.md) — **Call Qualification**, ingest gate
- [`googleSheets.service.md`](googleSheets.service.md) — Calls / Duplicate Calls tabs

## Related rules

- [`ringcentral-integration.mdc`](../rules/ringcentral-integration.mdc) — env, webhooks, cron wiring
- [`ringcentral-call-lead-candidates.mdc`](../rules/ringcentral-call-lead-candidates.mdc) — pipeline boundaries
