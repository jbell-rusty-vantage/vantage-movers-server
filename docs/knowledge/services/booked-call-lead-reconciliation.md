---
type: Service
title: Booked Call Lead Reconciliation
description: Refresh Call Leads and bookings from Granot Booked Jobs CSV ingest. Extension and HTTP automation final-apply no longer call this path.
tags: [call-lead, booking, enrichment]
status: draft
stale_after: 2026-11-20
resource: src/services/reconciliation/bookedCallLeadReconciliation.service.ts
applies_to:
  - src/services/reconciliation/bookedCallLeadReconciliation.service.ts
  - src/services/reconciliation/bookedCallLeadRows.ts
  - src/services/granotCrmCsv/sync.service.ts
  - src/routes/v1.routes.ts
  - src/routes/extension-granot-apply.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/reconciliation/bookedCallLeadReconciliation.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T02:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`  
**Domain terms used:** [Call Lead Enrichment](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Granot CRM](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Booked Call Lead Reconciliation

**Role:** Apply Granot **Booked Jobs** CRM row data to existing Vantage **Call Leads** and **Bookings** — refresh fields from CRM without creating Bookings or re-linking leads. Distinct from **Call Lead Enrichment** (Follow Up Estimates path).

**System of Record:** MongoDB `call_leads` and `booked_leads`. Granot CRM rows are an enrichment/reconciliation input, not authoritative for linkage. This service does **not** create Bookings; booking creation stays in [`bookings.md`](./bookings.md).

**Facade:** `src/services/bookedCallLeadReconciliation.service.ts` re-exports this folder for routes. New code should import from `src/services/reconciliation/`.

## HTTP entry points

| Route | Function | Persists? |
|-------|----------|-----------|
| `POST /api/v1/call-leads/booked-reconciliation/preview` | `previewBookedCallLeadReconciliation` | No — dry-run per row |
| `POST /api/v1/call-leads/booked-reconciliation/sync` | Owner extension receipt apply (`extensionApply.ts`) | Receipt capture only; Booking/Lead writes stay off unless later gates allow `booking_action_apply` |

`syncBookedCallLeadReconciliation` remains for Granot CSV Booked Jobs ingest. Extension and HTTP automation final-apply URLs no longer call it. Preview is unchanged. Extension `/sync` accepts only `operation_kind: booking_action_apply` (`extension-granot-apply.routes.ts`).

Batch schema: `bookedCallLeadReconciliationBatchSchema` (1–100 rows). Row shape mirrors Granot Booked Jobs columns (`job_no`, `source`, `customer`, `phone`, `email`, `from`/`to` city-state, `from_zip`, `to_zip`, `est_cf`, optional `section`, `prior`, `book_date`, `granot_crm_username`).

## Automated caller

`granotCrmCsv/sync.service.ts` routes **call** rows from `csv_kind: "booked"` through this service (`processBookedCallRow`). Form rows (`ref_no` is Mongo ObjectId) use the form-lead path instead. `apply: false` → preview; `apply: true` → sync.

Follow-Up Estimates CSV rows use **Call Lead Enrichment** (`callLeadEnrichment.service.ts`), not this service — unless a row is passed here with `prior: "5"`.

Booked CSV rows without `job_no` stay `invalid`. Do not guess from phone-only data ([`granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc)).

## Row parsing (`bookedCallLeadRows.ts`)

1. Clean placeholders (`na`, `n/a`, `-`, etc.) from string cells.
2. Parse Granot `from`/`to` city-state plus 5-digit zips; `local` via shared `deriveLocal` only when both states resolve.
3. Map `source` label → catalog assignment via `resolveLeadSourceAssignment` (skipped when `VANTAGE_TEST_RUNNER=true`) with `resolveSourceCompanyFromLabel` as fallback. Unknown labels warn and fail validation.
4. Normalize phone for matching (`normalizePhoneNumberForMatch`).
5. Optional `est_cf`; `book_date` as `MM/DD/YYYY` through `parseFloridaCalendarDate` (Eastern calendar date, not a UTC midnight guess); email validation.

### Row eligibility (`validateParsedRow`)

| Rule | Effect |
|------|--------|
| `job_no` required | `invalid` if missing |
| `source` required and must resolve | `invalid` if missing/unknown |
| `section === "bookedJobs"` **or** `prior === "5"` | Otherwise `invalid` |

Granot CSV sync always sends `section: "bookedJobs"` for booked exports.

## Resolution flow (per row)

```
parse + validate
      │
      ▼
BookedLead.findOne({ job_no })
      │
      ├─ found ──► lead_model must be CallLead; load call lead by lead_ref
      │            └─► booking_chain path (lead + booking + optional customer)
      │
      └─ missing ──► call-lead-only match (job_no → phone fallback)
                     └─► call_lead path (lead only)
```

### Path A — booking exists (`job_no_with_booking`)

1. Match `BookedLead` by raw `job_no`.
2. **Conflict** if `lead_model !== "CallLead"` or `lead_ref` call lead missing.
3. **Conflict** if matched call lead has an assigned source incompatible with the CRM row.
4. Diff fields → `updateable` / `unchanged`.
5. On sync (Mongo session): apply lead patch + CPL snapshot whenever `leadUpdate` is present; optional receiver-agent CRM username match; patch booking (`source` display label, `local`, `book_date`); customer `findOneAndUpdate` by phone with **`$setOnInsert` only** (existing customer fields are not overwritten). May enqueue `booked_call_lead.reconciliation.sync` and, if the receiver changed, `booked_call_lead.receiver_agent_crm_username.sync`.
6. Approved CSV/automation sync may pass expected lead/booking ids + `updatedAt` + receiver ids; drift throws and the row becomes `failed`.

### Path B — no booking yet (`job_no_only` / `phone_only`)

Used when CRM has a booked job but Vantage has not created `booked_leads` yet.

1. **Job-no candidates:** eligible call leads with same `job_no`. Assigned-source miss here is **`conflict`**.
2. Else **phone candidates:** regex sieve + in-memory exact verify. Assigned-source miss here is **`no_match`**.
3. Eligible = **not** `created_on_unmatched`, **not** booked, **not** cancelled (max 25, newest by `timestamp` then `createdAt`).
4. Source compatibility: unassigned (`null` / `not_provided`), or same `lead_source_company`, or same `source_granularity_key`, or same `source_company`. Tie-break by recency; warn on multiple matches or claiming an unassigned source.
5. **Job-no conflict on phone match:** if the lead already has a different `job_no`, warn and **skip updating `job_no`** (other lead fields still update).
6. Prefer phone/source candidates whose `job_no` is empty or matches the CRM row.
7. On sync: call lead update only; `scheduleCallLeadSheetSync` (`booked_call_lead.call_lead_only.sync`). If preview expected no booking (`expectedBookingId === null`) and a booking appears before apply, throw.

## Match methods

| `match_method` | Meaning |
|----------------|---------|
| `job_no_with_booking` | `BookedLead` found by `job_no` + linked `CallLead` |
| `job_no_only` | No booking; call lead matched by `job_no` |
| `phone_only` | No booking; call lead matched by phone (and source rules) |
| `none` | No match |

## Result statuses

| Status | Preview | Sync behavior |
|--------|---------|---------------|
| `updateable` | Would change N field(s) | Applies updates → becomes `updated` |
| `updated` | — | Sync completed |
| `unchanged` | All fields match | No field writes; receiver match may still warn; sync still idempotent |
| `invalid` | Row failed parse/validation | Skipped |
| `conflict` | Booking wrong type, missing lead, assigned source mismatch on booking or job-no-only path | Skipped |
| `no_match` | No booking and no eligible call lead (or phone-path source miss) | Skipped |
| `failed` | — | Uncaught error or preview-drift on sync row |

`booking_missing` is in the type union for CRM status mapping but is **not** emitted by this service today (no-match covers missing booking + no call lead).

## Fields updated

**Call lead:** `job_no` (unless phone-path job conflict), `name`, `email`, cities/zips/states, `cubic_feet`, source assignment or `source_company`, `local` (preserved with warning if states unresolved). **`phone_number` is not written** by `buildLeadUpdate`. CPL snapshot runs whenever a lead patch is applied (not only when `local` / source changes). Receiver agent may be set from Granot CRM username when the lead has none (`already_linked` / `not_found` become warnings).

**Booking (path A only):** `source` (display label), `local`, `book_date`.

**Customer (path A only):** insert-or-link by `phone_number` when CRM provides customer name + phone. Existing customer documents are not field-updated (`$setOnInsert`). Change keys: `booking.customer`, `customer.create_or_link`.

Lead change keys use `lead.*`. Booking keys use `booking.*`.

## Source company rules

- **Compatible:** unassigned, or same `lead_source_company`, or same `source_granularity_key`, or same `source_company`.
- **Unassigned claim:** sync may set source from CRM; preview warns (`Claiming unassigned call lead source as …`).
- **Assigned mismatch on booking path or job-no-only path:** `conflict`.
- **Assigned mismatch on phone path:** `no_match`.

## Invariants

- Never creates `BookedLead` or changes `lead_ref` / `lead_model`.
- Never updates call leads that are `booked`, `cancelled`, or `created_on_unmatched` on the no-booking path (booking from-source unmatched creates are out of scope).
- Phone matching always re-verifies normalized digits after the Mongo regex sieve.
- Preview and sync share `resolveReconciliationRow` — preview is authoritative for what sync will do, subject to the expected-id/`updatedAt` CAS options.
- Do not bypass `parseBookedCallLeadRow`, source-label resolution, `deriveLocal`, or sheet-sync schedulers.

## Tests

`bookedCallLeadReconciliation.service.test.ts` — phone/source matching, cross-source rejection, job_no conflict warnings, preference for non-conflicting job_no on phone match.

## Related modules

| Module | Relationship |
|--------|----------------|
| `bookedCallLeadRows.ts` | Row parse/validate/clean |
| `granotCrmCsv/sync.service.ts` | Booked CSV batch driver |
| `enrichment/callLeadEnrichment.service.ts` | Follow-Up Estimates call rows |
| `bookings/` | Booking creation, mirror, `booking_chain` sync |
| [`call-lead.md`](./call-lead.md) | Call lead create/update semantics |
| [`google-sheets.md`](./google-sheets.md) | Projections behind sheet sync jobs |
| [`granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) | CSV ingest + sync orchestration |
