# Form Lead Service (`formLead.service.ts`)

**Source of truth:** Mongo `form_leads`. Owner reporting via sheet sync (Master Leads + optional source sheets).

**Entry:** `POST /api/v1/form-leads` → `createFormLead`. Updates via `PATCH /api/v1/form-leads/:id`.

## Create (`createFormLead`)

1. **Normalize input** — name fields, phone (`normalizePhoneNumberForStorage`), source company (`parseSourceCompany`), required location (`resolveRequiredLocation`).
2. **Derive business fields**
   - `local` from pickup/delivery states (`deriveFormLeadLocal`)
   - `cpl` from source + local (`getCplForSource`)
   - `timestamp` as Florida time (`toFloridaTimestamp`)
   - `ref_no` defaults to `"not provided"` when blank
   - `move_date` defaults to now when omitted
3. **Duplicate check** — `findDuplicateFormLeadMatch(source, phone, email)` in `duplicateLead.service.ts`:
   - Match scope: same `source_company`, existing lead with `duplicate != true`
   - Match on normalized email and/or normalized phone (phone uses regex sieve + in-memory verify)
   - No time window — any prior non-duplicate form lead with same phone or email counts
4. **Persist + sheet-sync intent** (atomic in queued mode via `runSheetSyncWrite`):
   - Always saves the form lead with `duplicate` flag
   - `post_to_granot = post_to_granot && !duplicate`
   - **Non-duplicates only:** `markMatchingCallLeadsWithFormFill` — flips matching call leads (`same source + phone`) to `form_fill=true` and enqueues `call_lead.form_fill.update` sheet jobs in the same transaction
   - Enqueues `form_lead.create` sheet-sync job
5. **After commit (outside transaction):**
   - `finalizeSheetSync` for all jobs
   - CRM: `submitFormLeadToCrm` when `post_to_granot`; otherwise skip (duplicate or caller disabled)
   - CRM label: `getCrmFormLeadSourceCompanyLabel(source, local)`; payload `leadno` = Mongo `_id`

## Sheet routing

| Condition | Master Leads tab | Notes |
|-----------|------------------|-------|
| `duplicate: false` | `Forms` | Normal lead row |
| `duplicate: true` | `Duplicates` | Same form headers; excluded from Granot |
| `bad_lead` set | also `Bad Leads` | Update path adds/removes bad tab |

## Update (`updateFormLead`)

- Re-normalizes name, phone, timestamp, source, location when provided; recomputes `local` + `cpl`.
- **Blocked:** `quoted` / `cubic_feet` on duplicate leads; `bad_lead` on duplicate, booked, or cancelled leads.
- Saves lead + enqueues attached booking chain refresh (`form_lead.update`).

## Read / delete

- `findFormLead` — returns lead for extension lookup; **404 if duplicate** (duplicates are not extension targets).
- `findAllFormLeads` — last 200 by `createdAt`.
- `deleteFormLead` — requires `cascade=true` when booked; queued mode uses sheet tombstone (`duplicate` preserved for correct tab delete), legacy mode deletes sheet rows then Mongo doc.

## Invariants

- Duplicate form leads **always save** (visibility + sheet `Duplicates` tab) but **never post to Granot**.
- Form-fill linkage is one-way at create: new non-duplicate form → marks existing call leads; creating a form does not run on duplicate forms.
- Do not bypass `parseSourceCompany`, location helpers, duplicate helpers, or sheet-sync scheduling.
- `sms_consent` is logged only; not stored on the lead document.

## Related modules

- Duplicate + form-fill: `duplicateLead.service.ts`
- CRM: `crm/` (`submitFormLeadToCrm`)
- Sheets: `syncFormLeadToSheets` → `Forms` / `Duplicates` / `Bad Leads`

## Operational events (create)

- `lead.form.created`
- `lead.form.duplicate_detected` (warn, when duplicate)
- `lead.form.call_leads_marked_form_fill` (when call leads flipped)
- `crm.form_lead.submit.skipped` (when Granot skipped)
