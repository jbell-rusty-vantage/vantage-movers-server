---
type: Service
title: Google Sheets Service
description: Tab routing, projections, upsert/delete, and master versus source writes.
tags: [sheet-sync, google-sheets]
status: draft
stale_after: 2026-09-21
resource: src/services/googleSheets/googleSheets.service.ts
applies_to:
  - src/services/googleSheets/googleSheets.service.ts
  - src/services/googleSheets.service.ts
  - src/services/googleSheets/targets.ts
  - src/services/googleSheets/syncRows.ts
  - src/services/googleSheets/deleteRows.ts
  - src/services/googleSheets/projections/formLeadRow.ts
  - src/services/googleSheets/projections/callLeadRow.ts
  - src/services/googleSheets/expectedSheetTabs.ts
  - src/services/googleSheets/sheetContains.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/googleSheets/googleSheets.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-08-22T03:54:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/googleSheets/googleSheets.service.ts` (facade: `src/services/googleSheets.service.ts`)  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md), [Source Company Sheet](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Bad Lead](../../../../CONTEXT.md), [No-Sync Lead](../../../../CONTEXT.md), [Unmatched Call Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md)

# Google Sheets Service

**Role:** Projects Mongo Form Lead, Call Lead, Booking, and Cancellation documents into **Reporting Sheets**. **System of Record** is MongoDB; sheets are eventually consistent reporting only — never authoritative for lead state, CPL, or CRM.

**Facade:** `src/services/googleSheets.service.ts` re-exports this module. Legacy sheet sync (`sheetSyncSourceLookup` → `runFullSheetSyncProcess`) calls these functions. The queued drainer (`jobPlanner.ts`) **mirrors the same tab routing** and writes through `batchWriter` instead of this facade.

## Public API

| Function | Entity | Spreadsheet(s) |
|----------|--------|----------------|
| `syncFormLeadToSheets` | Form Lead | **Master Leads** (+ optional Source Company Sheet) |
| `syncCallLeadToSheets` | Call Lead | **Master Leads** (+ optional Source Company Sheet) |
| `syncBookedLeadToSheets` | Booking | **Master Booked** / `Booked Deals` |
| `syncCancelledLeadToSheets` | Cancellation | **Master Booked** / `Cancelled Deals` |
| `deleteFormLeadFromSheets` | Form lead | Current primary tab(s) + `master_bad_leads` in the delete-target list |
| `deleteCallLeadFromSheets` | Call lead | Duplicate-aware **current** primary tab(s) only (Calls **or** Duplicate Calls) |
| `deleteBookedLeadFromSheets` | Booking | `Booked Deals` |
| `deleteCancelledLeadFromSheets` | Cancellation | `Cancelled Deals` |
| `ensureAllConfiguredSheetTabs` | — | Provisions Master Leads, Master Booked, and every source container that has an env id |

All sync functions return `SheetSyncEntry[]` (per-target row number, status, errors). Deletes are void on the facade; queued mode prefers tombstones in the outbox. Per-target failures are captured; other targets still attempt.

## Tab routing (legacy facade **and** `jobPlanner.ts`)

### Form leads

| Duplicate Lead? | Bad Lead? | Writes |
|-----------------|-----------|--------|
| no | no | `Forms` |
| yes | no | `Duplicates` |
| either | yes | primary tab **+** Master `Bad Leads` |

When `bad_lead` is cleared:

- **Legacy** `syncFormLeadToSheets` always calls `deleteRowsFromTargets` on Master `Bad Leads`.
- **Queued** `planSourceLead` deletes Master `Bad Leads` only when `sheet_sync[]` already has `master_bad_leads`.

### Call leads (`callLeadTargetBase`)

| Duplicate Lead? | Tab |
|-----------------|-----|
| no | `Calls` |
| yes | `Duplicate Calls` |

Same `CALL_SHEET_HEADERS` for both. On every call sync, the **stale** opposite tab is deleted (legacy and queued), even when `sheet_sync[]` is empty — lookup is by Mongo ID. Master Leads also provisions **`Duplicate Calls`**.

**`Bad Calls`** exists in `SHEET_TAB_NAMES` and is added to source tab sets when `hasBadTabs` is true. **No sync write path targets it.**

`created_on_unmatched` Call Leads are skipped **before** this module (`syncSourceLead` / `planSourceLead`). This facade will write a Calls row if invoked directly. Ordinary [No-Sync Lead](../../../../CONTEXT.md) skip/delete is the same callers (`noSyncAppliesToNormalTabs`); this facade does not own it. The Bad dual-write and Call stale-delete tables above are unchanged — `no_sync` does not delete or skip those tabs.

### Bookings / cancellations

- Bookings → Master Booked / `Booked Deals` only (no source booked sheet).
- Cancellations → Master Booked / `Cancelled Deals` only.
- A **Booking Chain** job writes the booked row, then the linked source lead (if `lead_ref` + `lead_model` exist). Referral / leadless use `booked_lead` (booked row only).
- A **Cancellation Chain** job writes the booking chain first, then the cancellation row.

Header constants live in `src/config/domain/sheets.ts`. Row shape is built by `projections/*Row.ts`.

## Write targets (`getLeadTargets` in `targets.ts`)

Every lead sync **always** writes **Master Sheets** first.

**Source Company Sheets** are appended **only** when `shouldWriteSourceLeadSheets()` is true. That helper is true only for `WRITE_SOURCE_LEAD_SHEETS` trimmed/lowercased to the literal `"true"` (`"1"` / `"false"` stay off). Default is **master-only**. Target plumbing stays in code either way.

`not_provided` and `paid_overflow` have no source container env. `main_site` has `hasBadTabs: false`. Source env names include `GETMOVERS_LEADS_SHEET_ID` for `get_movers_leads`.

`getSourceLeadTabs`: base set is the Master Leads tabs (Forms, Calls, Duplicates, Duplicate Calls, Bad Leads). When `hasBadTabs` is true, the helper also appends `Bad Leads` and `Bad Calls`.

## Upsert mechanics (`syncRows.ts` + `rowLookup.ts`)

For each target:

1. Ensure the **single tab being written** exists with correct headers (not full sibling tab provisioning — that is `ensureAllConfiguredSheetTabs`).
2. **Upsert by Lead ID:** lookup `Mongo ID` column; update row if found, else append.
3. Use `document.sheet_sync[].row_number` when it still contains that Mongo ID.
4. Per-target failures stay on that result; other targets still attempt.

Returns updated `sheet_sync` entries stored on the Mongo document by `syncAndStore` (legacy) or the drainer's `updateOne` (queued).

## Delete mechanics (`deleteRows.ts`)

1. Resolve targets from fallback list + historical `sheet_sync` entries (`getDeleteTargets`).
2. Find row by Mongo ID (prefer cached `row_number` when it still matches).
3. Delete via `batchUpdate.deleteDimension`. Missing tab or missing row is a no-op (idempotent).

Form delete also lists `master_bad_leads` in `syncedTargets`. Call delete uses the current duplicate-aware primary targets only (it does not also delete the stale opposite tab — that happens on **sync**). Queued deletes use the tombstone `previous_targets` snapshot.

## Projections (do not inline live cell values elsewhere)

| Helper | Columns driven by |
|--------|-------------------|
| `formLeadToRow` | Timestamp, name, zips/states (empty state → `FORM_LEAD_UNKNOWN_STATE`), local, move date, contact, quoted/cubic feet, booking mirrors, Mongo ID, `ref_no` or `"not provided"`, source label (`crm_source_label_snapshot` → `source_granularity_label_snapshot` → `getFormLeadSourceCompanyLabel`), `formatFormLeadBadLeadReason(bad_lead)`, `Sales Rep` = `receiver_agent_name_snapshot` |
| `callLeadToRow` | Timestamp, job no, phone, duration, booking mirrors, local, cubic feet, Mongo ID, inbound source label (same snapshot fallback → `getCallLeadSourceCompanyLabel`), `FormFill`, `Sales Rep` from snapshot |
| `bookedLeadToRow` | Agent / SplitAgent from `agent_allocations[0..1].agent_name_snapshot`, binder/deposit, book date, job, customer `full_name` else `customer_name`, merchant, resolved source, Mongo ID, lead Mongo ID, local, cancelled |
| `cancelledLeadToRow` | Agent, cancel date, job, `customer_name` snapshot, refund, source, Mongo ID, lead Mongo ID |

**No CPL column** on sheets. Use projection `cells.ts` helpers for booked/quoted/cancelled/threshold formatting. `Move Size`, `Lead ID`, and `Source Company Site` were removed from form projections; Mongo fields may remain.

## Bootstrap

`ensureAllConfiguredSheetTabs()` — Master Leads tabs, Master Booked tabs, and every configured source lead container (skips missing env / no `leadSheetEnvVar`). Used at startup/scripts, not on every row sync.

## Owner contains check

`POST /api/v1/admin/sheet-sync/contains` is an Owner-only **read** of Master Sheets. It does not write, retry, or trust `sheet_sync[]`.

`checkSheetContains` in `src/services/googleSheets/sheetContains.ts` loads the selected Mongo documents, uses `planExpectedSheetTabs` (`expectedSheetTabs.ts`) for the live tab map, reads each needed tab once, and returns Found / Missing / Wrong tab / Not expected plus row evidence.

| Entity | Master workbook | Expected tab |
|--------|-----------------|--------------|
| Form Lead (not duplicate) | Master Leads | `Forms` |
| Form Lead (duplicate) | Master Leads | `Duplicates` |
| Form Lead + Bad Lead | Master Leads | primary tab **and** `Bad Leads` |
| Call Lead (not duplicate) | Master Leads | `Calls` |
| Call Lead (duplicate) | Master Leads | `Duplicate Calls` |
| Call Lead `created_on_unmatched` | — | not written (`skipReason: "created_on_unmatched"` → Not expected; no tab reads) |
| Ordinary [No-Sync Lead](../../../../CONTEXT.md) (`noSyncAppliesToNormalTabs`) | — | not written (`skipReason: "no_sync"` → Not expected; no tab reads) |
| Booking | Master Booked | `Booked Deals` |
| Cancellation | Master Booked | `Cancelled Deals` |

Sibling tabs on the same workbook are scanned so a leftover row is **Wrong tab**, not a silent miss. Source Company Sheets are not queried. Cap: 25 ids.

Contains `skipReason: "no_sync"` fires only when `noSyncAppliesToNormalTabs`. Bad Lead + `no_sync` and Duplicate + `no_sync` use today's expected tabs (reads run). Unmatched Call Lead `skipReason` stays `created_on_unmatched`.

## Invariants

- Tab choice follows **current** document flags (`duplicate`, `bad_lead`) at sync time. Keep `googleSheets.service.ts` and `jobPlanner.ts` aligned.
- Do not treat sheet rows as source of truth for lead state, CPL, or CRM.
- Do not bypass projections when adding columns; update `sheets.ts` headers + matching `*Row.ts` + drainer/tests.
- `Sales Rep` is the persisted `receiver_agent_name_snapshot`. Do not live-join Agent at sync time. Empty snapshot stays blank even when `receiver_agent` is set.
- External Google calls belong here or submodules (`auth`, `tabs`, `retry`) — not in lead/booking services.

## Related services

- [`sheet-sync.md`](./sheet-sync.md) — scheduling, outbox, drainer
- [`form-lead.md`](./form-lead.md), [`call-lead.md`](./call-lead.md) — when those services enqueue work

## Related rules

- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — env, `TEST_` prefixes, quotas, modes

## When to read this vs sheet-sync docs

- **This file:** what gets written where, and sync/delete entry points.
- **`sheet-sync.md` + `sheet-sync-process.mdc`:** scheduling and software-layer process.
