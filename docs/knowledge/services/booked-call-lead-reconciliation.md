---
type: Service
title: Booked Call Lead Reconciliation
description: Refresh Call Leads and bookings from Granot Booked Jobs CSV ingest. Extension and HTTP automation final-apply no longer call this path.
tags: [call-lead, booking, enrichment]
status: draft
stale_after: 2026-11-19
resource: src/services/reconciliation/bookedCallLeadReconciliation.service.ts
applies_to:
  - src/services/reconciliation/bookedCallLeadReconciliation.service.ts
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
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/reconciliation/bookedCallLeadReconciliation.service.ts`  
**Domain terms used:** [Call Lead Enrichment](../../../../CONTEXT.md), [Booking Chain](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Granot CRM](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md)

# Booked Call Lead Reconciliation

**Role:** Apply Granot **Booked Jobs** CRM row data to existing Vantage **Call Leads** and **Bookings** — refresh fields from CRM without creating Bookings or re-linking leads. Distinct from **Call Lead Enrichment** (Follow Up Estimates path).

**System of Record:** MongoDB `call_leads` and `booked_leads`. Granot CRM rows are an enrichment/reconciliation input, not authoritative for linkage. This service does **not** create Bookings; booking creation stays in [`bookings.service.md`](./bookings.md).

**Facade:** `src/services/bookedCallLeadReconciliation.service.ts` re-exports this folder for routes. New code should import from `src/services/reconciliation/`.

## HTTP entry points

| Route | Function | Persists? |
|-------|----------|-----------|
| `POST /api/v1/call-leads/booked-reconciliation/preview` | `previewBookedCallLeadReconciliation` | No — dry-run per row |
| `POST /api/v1/call-leads/booked-reconciliation/sync` | Owner extension receipt apply (`extensionApply.ts`) | Receipt capture only in Unit 16; Booking/Lead writes stay off |

`syncBookedCallLeadReconciliation` remains for Granot CSV Booked Jobs ingest. Extension and HTTP automation final-apply URLs no longer call it. Preview is unchanged.

Batch schema: `bookedCallLeadReconciliationBatchSchema` (1–100 rows). Row shape mirrors Granot Booked Jobs columns (`job_no`, `source`, `customer`, `phone`, `email`, `from_zip`, `to_zip`, `est_cf`, optional `section`, `prior`, `book_date`).

## Automated caller

`granotCrmCsv/sync.service.ts` routes **call** rows from `csv_kind: "booked"` through this service (`processBookedCallRow`). Form rows (`ref_no` is Mongo ObjectId) use the form-lead path instead. `apply: false` → preview; `apply: true` → sync.

Follow-Up Estimates CSV rows use **Call Lead Enrichment** (`callLeadEnrichment.service.ts`), not this service — unless a row is passed here with `prior: "5"` (see row eligibility below).

## Row parsing (`bookedCallLeadRows.ts`)

Reconciliation-specific parsing lives beside the service:

1. Clean placeholders (`na`, `n/a`, `-`, etc.) from string cells.
2. Map `source` label → `source_company` via `resolveSourceCompanyFromLabel`; unknown labels warn and fail validation.
3. Resolve states from 5-digit zips; `local` via shared `deriveLocal` (same as leads).
4. Normalize phone for matching (`normalizePhoneNumberForMatch`).
5. Optional `est_cf`, `book_date` (MM/DD/YYYY UTC), email validation.

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

1. Match `BookedLead` by `job_no`.
2. **Conflict** if `lead_model !== "CallLead"` or `lead_ref` call lead missing.
3. **Conflict** if matched call lead has an assigned `source_company` incompatible with CRM row (see source rules).
4. Diff fields → `updateable` / `unchanged`.
5. On sync: update call lead (+ CPL snapshot via `resolveLeadCplSnapshot`), patch booking (`source`, `local`, `book_date`), upsert `Customer` by phone when name+phone present and booking customer differs/missing. May set `receiver_agent` from Granot CRM username and enqueue `booked_call_lead.call_lead_only.sync` / `booked_call_lead.receiver_agent_crm_username.sync`.
6. Sheet sync: `scheduleBookingChainSheetSync` (`booked_call_lead.reconciliation.sync`).

### Path B — no booking yet (`job_no_only` / `phone_only`)

Used when CRM has a booked job but Vantage has not created `booked_leads` yet (common timing gap).

1. **Job-no candidates:** eligible call leads with same `job_no`.
2. Else **phone candidates:** normalized phone match (regex sieve + in-memory exact verify).
3. Eligible call lead = **not** `created_on_unmatched`, **not** `booked`, **not** `cancelled` (max 25, newest first).
4. Source compatibility filter; tie-break by recency; warnings when multiple matches or claiming `not_provided` source.
5. **Job-no conflict on phone match:** if lead already has a different `job_no`, warn and **skip updating `job_no`** (other fields still update).
6. Prefer phone/source candidates whose `job_no` is empty or matches CRM row.
7. On sync: call lead update only; sheet sync via `scheduleCallLeadSheetSync` (`booked_call_lead.call_lead_only.sync`).

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
| `unchanged` | All fields match | No writes; sync still idempotent |
| `invalid` | Row failed parse/validation | Skipped |
| `conflict` | Booking wrong type, missing lead, or assigned source mismatch on booking path | Skipped |
| `no_match` | No booking and no eligible call lead | Skipped |
| `failed` | — | Uncaught error on sync row |

`booking_missing` is in the type union for CRM status mapping but is **not** emitted by this service today (no-match covers missing booking + no call lead).

## Fields updated

**Call lead:** `job_no` (unless phone-path job conflict), `name`, `phone_number`, `email`, zips/states, `cubic_feet`, `source_company`, `local` (preserved with warning if states unresolved). `cpl` recomputed on save.

**Booking (path A only):** `source`, `local`, `book_date`.

**Customer (path A only):** upsert by `phone_number` when CRM provides customer name + phone.

Changes array uses `lead.*`, `booking.*`, `booking.customer` keys for operator visibility.

## Source company rules

- **Compatible:** `lead.source_company === parsed.source_company` **or** lead is unassigned (`null` / `not_provided`).
- **Unassigned claim:** sync may set `source_company` from CRM; preview warns (`Claiming unassigned call lead source_company as …`).
- **Assigned mismatch on booking path:** `conflict` — do not overwrite another source’s lead.
- **Assigned mismatch on phone path:** `no_match` when no compatible candidate (does not phone-match across sources).

## Invariants

- Never creates `BookedLead` or changes `lead_ref` / `lead_model`.
- Never updates call leads that are `booked`, `cancelled`, or `created_on_unmatched` (booking from-source unmatched creates are out of scope).
- Phone matching always re-verifies normalized digits after Mongo regex sieve.
- Preview and sync share `resolveReconciliationRow` — preview is authoritative for what sync will do.
- Do not bypass `parseBookedCallLeadRow`, source-label resolution, `deriveLocal`, or sheet-sync schedulers.

## Related modules

| Module | Relationship |
|--------|----------------|
| `bookedCallLeadRows.ts` | Row parse/validate/clean |
| `granotCrmCsv/sync.service.ts` | Booked CSV batch driver |
| `enrichment/callLeadEnrichment.service.ts` | Follow-Up Estimates call rows (non-booked / non-prior-5) |
| `bookings/` | Booking creation, mirror, `booking_chain` sync |
| `call-lead.service.md` | Call lead create/update semantics |
| `googleSheets.service.md` | Projections behind sheet sync jobs |
| `rules/granot-crm-csv-s3-sync.mdc` | CSV ingest + sync orchestration |

## Tests

`bookedCallLeadReconciliation.service.test.ts` — phone/source matching, cross-source rejection, job_no conflict warnings, preference for non-conflicting job_no on phone match.
