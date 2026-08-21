---
type: Service
title: Google Sheets Service
description: Tab routing, projections, upsert/delete, and master versus source writes.
tags: [sheet-sync, google-sheets]
status: draft
stale_after: 2026-09-20
resource: src/services/googleSheets/googleSheets.service.ts
applies_to:
  - src/services/googleSheets/googleSheets.service.ts
  - src/services/googleSheets.service.ts
  - src/services/googleSheets/projections/formLeadRow.ts
  - src/services/googleSheets/projections/callLeadRow.ts
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
  by: process:okf-docs-conversion
  at: 2026-08-21T02:20:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**ADRs:** [`../../../../docs/adr/`](../../../../docs/adr/) — [0001 Mongo SoR](../../../../docs/adr/0001-mongodb-system-of-record.md)  
**Primary code:** `src/services/googleSheets/googleSheets.service.ts` (facade: `src/services/googleSheets.service.ts`)  
**Domain terms used:** [Sheet Sync](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md), [Master Sheets](../../../../CONTEXT.md), [Source Company Sheet](../../../../CONTEXT.md), [Duplicate Lead](../../../../CONTEXT.md), [Bad Lead](../../../../CONTEXT.md), [Lead ID](../../../../CONTEXT.md)

# Google Sheets Service

**Role:** Projects Mongo Form Lead, Call Lead, Booking, and Cancellation documents into **Reporting Sheets**. **System of Record** is MongoDB; sheets are eventually consistent reporting only — never authoritative for lead state, CPL, or CRM.

**Facade:** `src/services/googleSheets.service.ts` re-exports this module. Callers include legacy sheet sync (`sheetSyncSourceLookup`) and the queued drainer (`jobPlanner` mirrors the same tab routing).

## Public API

| Function | Entity | Spreadsheet(s) |
|----------|--------|----------------|
| `syncFormLeadToSheets` | Form Lead | **Master Leads** (+ optional Source Company Sheet) |
| `syncCallLeadToSheets` | Call Lead | **Master Leads** (+ optional Source Company Sheet) |
| `syncBookedLeadToSheets` | Booking | **Master Booked** |
| `syncCancelledLeadToSheets` | Cancellation | **Master Booked** |
| `deleteFormLeadFromSheets` | Form lead | Primary tab + `Bad Leads` if present |
| `deleteCallLeadFromSheets` | Call lead | Primary tab only |
| `deleteBookedLeadFromSheets` | Booking | `Booked Deals` |
| `deleteCancelledLeadFromSheets` | Cancellation | `Cancelled Deals` |
| `ensureAllConfiguredSheetTabs` | — | Provisions all tabs/headers at bootstrap |

All sync functions return `SheetSyncEntry[]` (per-target row number, status, errors). Deletes are void; legacy delete path uses these directly; queued mode prefers tombstones in the outbox.

## Tab routing (this file’s decisions)

### Form leads (`syncFormLeadToSheets` / `deleteFormLeadFromSheets`)

| Duplicate Lead? | Bad Lead? | Primary tab(s) |
|-----------------|-----------|----------------|
| no | no | `Forms` |
| yes | no | `Duplicates` |
| either | yes | primary tab **+** `Bad Leads` |

When `bad_lead` is cleared on sync, explicitly deletes the row from `Bad Leads` (master only).

### Call leads (`callLeadTargetBase`)

| Duplicate Lead? | Tab |
|-----------------|-----|
| no | `Calls` |
| yes | `Duplicate Calls` |

Same `CALL_SHEET_HEADERS` for both; routing keeps Duplicate Lead spend out of the main Calls tab. **Bad Call** workflow is planned only — tab name exists in config; no mark-bad API yet.

### Bookings / cancellations

- Bookings → Master Booked / `Booked Deals`
- Cancellations → Master Booked / `Cancelled Deals`

Header constants live in `src/config/domain/sheets.ts`. Row shape built by `projections/*Row.ts`.

## Write targets (`getLeadTargets` in `targets.ts`)

Every lead sync **always** writes **Master Sheets** first.

**Source Company Sheets** (TBM, Top10, etc.) are appended **only** when `WRITE_SOURCE_LEAD_SHEETS=true` (`shouldWriteSourceLeadSheets()`). Default is **master-only** — Source Company Sheets derive rows from Master via sheet import queries per glossary. Target plumbing stays in code either way.

`not_provided` has no source container. `main_site` has no bad tabs on source sheets.

## Upsert mechanics (`syncRows.ts` + `rowLookup.ts`)

For each target:

1. Ensure the **single tab being written** exists with correct headers (not full sibling tab provisioning — that is `ensureAllConfiguredSheetTabs`).
2. **Upsert by Lead ID:** lookup `Mongo ID` column; update row if found, else append.
3. Use `document.sheet_sync[].row_number` when still valid (verified before update).
4. Per-target failures are captured in results; other targets still attempt.

Returns updated `sheet_sync` entries stored on the Mongo document by `syncAndStore`.

## Delete mechanics (`deleteRows.ts`)

1. Resolve targets from fallback list + historical `sheet_sync` entries (`getDeleteTargets`).
2. Find row by Mongo ID (prefer cached `row_number` when it still matches).
3. Delete sheet row via `batchUpdate.deleteDimension`.

Form delete also attempts `master_bad_leads`. Call delete uses duplicate-aware primary targets only.

## Projections (not in this file — do not inline row values here)

| Helper | Columns driven by |
|--------|-------------------|
| `formLeadToRow` | Timestamp, location, move date, contact, quoted/cubic feet, booking mirrors, Mongo ID, ref_no, source label, bad-lead label, `Sales Rep` from `receiver_agent_name_snapshot` |
| `callLeadToRow` | Timestamp, job no, phone, duration, booking mirrors, local, cubic feet, Mongo ID, inbound source label, `FormFill`, `Sales Rep` from `receiver_agent_name_snapshot` |
| `bookedLeadToRow` / `cancelledLeadToRow` | Booking/cancellation owner fields |

**No CPL column** on sheets. Use projection `cells.ts` helpers for booked/quoted/cancelled/threshold formatting.

## Bootstrap

`ensureAllConfiguredSheetTabs()` — ensures Master Leads tabs, Master Booked tabs, and every configured source lead container (skips `not_provided` / missing env). Used at startup/scripts, not on every row sync.

## Invariants

- Tab choice follows **current** document flags (`duplicate`, `bad_lead`) at sync time — routing logic is duplicated in `jobPlanner.ts` for queued mode; keep both in sync when changing rules.
- Do not treat sheet rows as source of truth for lead state, CPL, or CRM.
- Do not bypass projections when adding columns; update `sheets.ts` headers + matching `*Row.ts` + drainer/tests.
- `Sales Rep` is the persisted `receiver_agent_name_snapshot`. Do not live-join Agent at sync time. Empty snapshot stays blank even when `receiver_agent` is set.
- External Google calls belong here or submodules (`auth`, `tabs`, `retry`) — not in lead/booking services.

## Related modules

| Module | Responsibility |
|--------|----------------|
| `targets.ts` | Target resolution, header lookup, tab sets |
| `syncRows.ts` | Multi-target upsert loop |
| `deleteRows.ts` | Row deletion |
| `projections/` | Mongo → string[] row mapping |
| `sheetSync/` | Scheduling (legacy / queued outbox + drainer) |
| `config/domain/sheets.ts` | Tab names and header arrays |

## Related businesslogic

- [`sheetSync.service.md`](./sheet-sync.md) — scheduling, outbox, drainer (invokes this module)
- [`form-lead.service.md`](./form-lead.md), [`call-lead.service.md`](./call-lead.md) — lead tab routing invariants

## Related rules

- [`sheet-sync-process.mdc`](../../../.cursor/rules/sheet-sync-process.mdc) — outbox modes, drainer, quotas, coalescing, tombstones

## When to read this vs sheet-sync docs

- **This file:** what gets written where, and sync/delete entry points.
- **`sheetSync.service.md` + `sheet-sync-process.mdc`:** scheduling and software-layer process.
