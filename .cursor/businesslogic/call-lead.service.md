# Call Lead Service (`callLead.service.ts`)

**Source of truth:** Mongo `call_leads`. Owner reporting via sheet sync (Master Leads + optional source sheets).

**Two create paths** — same collection, different origin and duplicate rules:

| Function | Caller | Duplicate flag | CPL |
|----------|--------|----------------|-----|
| `createCallLead` | `POST /api/v1/call-leads` (manual, Invoca, tests) | always `false` (schema default) | `getCplForSource(source, local)` |
| `createRingCentralCallLead` | RingCentral ingest only | passed in by ingest | `0` when duplicate, else source CPL |

RingCentral qualification + ingest live in `ringcentral-call-lead-qualification.service.md`. Duplicate classification is in `ringcentral-duplicate-guard.ts`; promotion gate is `ringcentral-call-lead-ingest.service.ts`. Ingest calls `createRingCentralCallLead` with `duplicate: true/false`.

## Create — manual/API (`createCallLead`)

1. Normalize name, parse source company, optional location (`resolveOptionalLocation`).
2. **Form-fill check** — `hasFormFillForCallLead(source, phone)`: true when a non-duplicate form lead exists with same source + normalized phone.
3. Save with `form_fill`, Florida `timestamp`, `cpl`; enqueue `call_lead.create` sheet-sync job; finalize sync.
4. No RingCentral metadata; no call duplicate window logic.

## Create — RingCentral (`createRingCentralCallLead`)

1. Caller supplies `duplicate` (from ingest duplicate guard).
2. Same form-fill check as manual path.
3. Save with `ringcentral.*` provenance (session id, call log id, ingestion source, qualification, timestamps).
4. **`cpl = 0` when `duplicate: true`** — owner not charged twice for same caller/source within window.
5. Unique sparse index on `ringcentral.telephony_session_id` prevents the **same call** from inserting twice (webhook vs cron idempotency — separate from business duplicate).

### RingCentral duplicate rule (upstream of this service)

- Same **normalized caller phone** + **source company** as an existing **non-duplicate** call lead within `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` (default 24h).
- Excludes the current `telephony_session_id`.
- Duplicate call leads still persist and sync; they do not block future “first” calls after window expires.

## Sheet routing

| Condition | Master Leads tab | Headers |
|-----------|------------------|---------|
| `duplicate: false` | `Calls` | `CALL_SHEET_HEADERS` |
| `duplicate: true` | `Duplicate Calls` | same as Calls |

Delete/tombstone uses `lead.duplicate` to target the correct tab. `FormFill` column reflects `form_fill` on the row.

## Form-fill linkage

- **At call create:** `hasFormFillForCallLead` reads existing non-duplicate form leads (same source + phone).
- **At form create:** non-duplicate forms call `markMatchingCallLeadsWithFormFill` to flip existing calls (see `form-lead.service.md`).
- Form-fill is attribution only; does not set `duplicate` on call leads.

## Update (`updateCallLead`)

- Optional location fields; recomputes `local` + `cpl` via `getCplForSource`.
- **Note:** update recalculates CPL from source/local — it does not re-run duplicate logic; a RingCentral duplicate stays `cpl: 0` only if `duplicate` remains true and local unchanged, but changing local on a duplicate could overwrite CPL (edge case — duplicates rarely updated via API).
- Saves + refreshes attached booking chain (`call_lead.update`).

## Delete (`deleteCallLead`)

- Same cascade rules as form leads (`cascade=true` when booked).
- Queued mode: tombstone with `duplicate` for correct tab; legacy: `deleteCallLeadFromSheets` then Mongo delete.

## Read

- `findAllCallLeads` — last 200 by `createdAt`.
- No “hide duplicate” read helper (unlike form leads’ `findFormLead`).

## Invariants

- Manual/API creates never set `duplicate: true`; only RingCentral ingest does.
- Business duplicate (caller window) ≠ idempotency (same telephony session).
- Do not bypass phone normalization, form-fill helpers, source parsing, or sheet-sync scheduling.
- Call leads do not post to Granot at create; enrichment is a separate flow (`callLeadEnrichment.service.ts`).

## Related modules

- Form-fill / cross-lead matching: `duplicateLead.service.ts`
- RingCentral qualification + ingest: `ringcentral-call-lead-qualification.service.md`
- Sheets: `syncCallLeadToSheets` → `Calls` / `Duplicate Calls`

## Operational events

| Path | Events |
|------|--------|
| Manual create | `lead.call.created`, `lead.call.form_fill_detected` when applicable |
| RingCentral create | ingest emits `ringcentral.call_lead.created` or `ringcentral.call_lead.duplicate_created`; form-fill event from this service when `form_fill` |
