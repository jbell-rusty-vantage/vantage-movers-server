**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**ADRs:** [`../../../docs/adr/`](../../../docs/adr/) — [0001 Mongo SoR](../../../docs/adr/0001-mongodb-system-of-record.md), [0002 CRM post survives failures](../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md), [0003 Lead ID / leadno / ref_no](../../../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md)  
**Primary code:** `api/services/leads/formLead.service.ts`  
**Domain terms used:** Form Lead Ingestion, Form Lead, Duplicate Lead, CRM Posting, Sheet Sync, Tracking Reference, Lead ID, Form Fill, Move Type, CPL

# Form Lead Service

**System of Record:** MongoDB `form_leads`. Owner reporting via **Sheet Sync** → **Master Sheets** (Source Company Sheets derive via import queries).

**Triggers:** `POST /api/v1/form-leads` → `createFormLead`; `PATCH /api/v1/form-leads/:id` → `updateFormLead`.

## Form Lead Ingestion — create (`createFormLead`)

| Step | What happens |
|------|----------------|
| 1. Normalize | Name, phone, **Source Company** (`parseSourceCompany`), required location |
| 2. Derive | **Move Type** (`local` from pickup/delivery states), **CPL** (`getCplForSource`), Florida `timestamp`, **Tracking Reference** (`ref_no`, default `"not provided"`), `move_date` |
| 3. **Duplicate Lead** check | `findDuplicateFormLeadMatch(source, phone, email)` — same Source Company, existing non-duplicate Form Lead with same normalized phone **or** email; no time window |
| 4. Persist + Sheet Sync intent | Atomic in queued mode via `runSheetSyncWrite`: save Form Lead with `duplicate` flag; `post_to_granot = post_to_granot && !duplicate` |
| 4b. Form Fill (non-duplicates only) | `markMatchingCallLeadsWithFormFill` — same source + phone Call Leads → `form_fill=true`; enqueues `call_lead.form_fill.update` jobs in same txn |
| 4c. Enqueue | `source_lead` / `form_lead.create` Sheet Sync job |
| 5. Post-commit | See **Post-save order** below |

### Post-save order (current code vs ADR intent)

| Order | ADR-0002 intent | Current code |
|-------|-------------------|--------------|
| 1 | Mongo persist | ✓ (in txn) |
| 2 | **CRM Posting** (Lead ID as `leadno`) | Runs **after** Sheet Sync finalization |
| 3 | **Sheet Sync** (`finalizeSheetSync`) | Runs **before** CRM Posting |
| 4 | **Operational Events** | After CRM |

**Known gap (deferred):** `finalizeSheetSync` runs before `submitFormLeadToCrm`. A Sheet Sync failure can block CRM Posting; order is reversed from ADR happy path. CRM Posting should still be best-effort when enabled and lead is not a Duplicate Lead ([ADR-0002](../../../docs/adr/0002-granot-crm-post-despite-downstream-failures.md)).

### CRM Posting

- When `post_to_granot` and not Duplicate Lead → `submitFormLeadToCrm`
- Granot source label: `getCrmFormLeadSourceCompanyLabel(source, local)`
- Payload `leadno` = **Lead ID** (Mongo `_id`); Granot stores as **CRM Lead Reference** in `ref_no` ([ADR-0003](../../../docs/adr/0003-lead-id-granot-leadno-ref-no-contract.md))
- Duplicate Form Leads and caller-disabled posting → skip; emit `crm.form_lead.submit.skipped`

### CPL config lag

Glossary: CPL by Source Company + **Lead Channel** + **Move Type**. `getCplForSource` in `cpl.ts` keys mainly on source (Best Relocation has local/LD split only). Stored CPL at ingestion may not match full channel granularity.

## Sheet Sync tab routing (Form Lead)

| Condition | Master Leads tab |
|-----------|------------------|
| Not Duplicate Lead | `Forms` |
| Duplicate Lead | `Duplicates` |
| `bad_lead` set | primary tab **+** `Bad Leads` |

Job: `resource: source_lead`, `operation: form_lead.create` | `form_lead.update`. Delete: tombstone `delete_source_lead` / `delete_form_lead`.

## Update (`updateFormLead`)

- Re-normalizes provided fields; recomputes Move Type + CPL.
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
| `sms_consent` | Logged only; not stored on document |

## Operational Events (create)

- `lead.form.created`
- `lead.form.duplicate_detected` (warn, when Duplicate Lead)
- `lead.form.call_leads_marked_form_fill` (when Call Leads flipped)
- `crm.form_lead.submit.skipped` (when CRM Posting skipped)

## Related businesslogic

- [`call-lead.service.md`](call-lead.service.md) — Form Fill on Call Lead create; Call Lead Ingestion
- [`sheetSync.service.md`](sheetSync.service.md) — outbox, drainer, job shapes
- [`googleSheets.service.md`](googleSheets.service.md) — tab routing, Master vs Source Company Sheet writes

## Related rules

- [`form-lead-granot-crm.mdc`](../rules/form-lead-granot-crm.mdc) — CRM Posting payload and posting flow
- [`sheet-sync-process.mdc`](../rules/sheet-sync-process.mdc) — outbox modes, drainer, quotas
- [`observability-service.mdc`](../rules/observability-service.mdc) — Operational Events
