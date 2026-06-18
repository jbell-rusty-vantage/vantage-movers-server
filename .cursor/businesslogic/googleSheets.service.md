# Google Sheets Service (`googleSheets/googleSheets.service.ts`)

**Role:** Projects Mongo lead/booking/cancellation documents into owner-facing Google Sheets. Mongo is authoritative; sheets are reporting only.

**Facade:** `api/services/googleSheets.service.ts` re-exports this module. Callers include legacy sheet sync (`sheetSyncSourceLookup`) and the queued drainer (`jobPlanner` mirrors the same tab routing).

## Public API

| Function | Entity | Spreadsheet(s) |
|----------|--------|----------------|
| `syncFormLeadToSheets` | Form lead | Master Leads (+ optional source sheet) |
| `syncCallLeadToSheets` | Call lead | Master Leads (+ optional source sheet) |
| `syncBookedLeadToSheets` | Booked lead | Master Booked |
| `syncCancelledLeadToSheets` | Cancellation | Master Booked |
| `deleteFormLeadFromSheets` | Form lead | Primary tab + `Bad Leads` if present |
| `deleteCallLeadFromSheets` | Call lead | Primary tab only |
| `deleteBookedLeadFromSheets` | Booking | `Booked Deals` |
| `deleteCancelledLeadFromSheets` | Cancellation | `Cancelled Deals` |
| `ensureAllConfiguredSheetTabs` | — | Provisions all tabs/headers at bootstrap |

All sync functions return `SheetSyncEntry[]` (per-target row number, status, errors). Deletes are void; legacy delete path uses these directly; queued mode prefers tombstones in the outbox.

## Tab routing (this file’s decisions)

### Form leads (`syncFormLeadToSheets` / `deleteFormLeadFromSheets`)

| `duplicate` | `bad_lead` | Primary tab(s) |
|-------------|------------|----------------|
| `false` | unset | `Forms` |
| `true` | unset | `Duplicates` |
| either | set | primary tab **+** `Bad Leads` |

When `bad_lead` is cleared on sync, explicitly deletes the row from `Bad Leads` (master only).

### Call leads (`callLeadTargetBase`)

| `duplicate` | Tab |
|-------------|-----|
| `false` | `Calls` |
| `true` | `Duplicate Calls` |

Same `CALL_SHEET_HEADERS` for both; routing keeps duplicate spend out of the main Calls tab.

### Bookings / cancellations

- Bookings → Master Booked / `Booked Deals`
- Cancellations → Master Booked / `Cancelled Deals`

Header constants live in `api/config/domain/sheets.ts`. Row shape built by `projections/*Row.ts`.

## Write targets (`getLeadTargets` in `targets.ts`)

Every lead sync **always** writes Master Leads first.

Source-company spreadsheets (TBM, Top10, etc.) are appended **only** when `WRITE_SOURCE_LEAD_SHEETS=true` (`shouldWriteSourceLeadSheets()`). Default is **master-only** — per-source sheets are formula derivatives of master. Target plumbing (source target keys, tabs, delete fallback) stays in code either way.

`not_provided` has no source container. `main_site` has no bad tabs on source sheets.

## Upsert mechanics (`syncRows.ts` + `rowLookup.ts`)

For each target:

1. Ensure the **single tab being written** exists with correct headers (not full sibling tab provisioning — that is `ensureAllConfiguredSheetTabs`).
2. **Upsert by Mongo ID:** lookup `Mongo ID` column; update row if found, else append.
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
| `formLeadToRow` | Timestamp, location, move date, contact, quoted/cubic feet, booking mirrors, Mongo ID, ref_no, source label, bad-lead label |
| `callLeadToRow` | Timestamp, job no, phone, duration, booking mirrors, local, cubic feet, Mongo ID, inbound source label, `FormFill` |
| `bookedLeadToRow` / `cancelledLeadToRow` | Booking/cancellation owner fields |

**No CPL column** on sheets. Use projection `cells.ts` helpers for booked/quoted/cancelled/threshold formatting.

## Bootstrap

`ensureAllConfiguredSheetTabs()` — ensures Master Leads tabs, Master Booked tabs, and every configured source lead container (skips `not_provided` / missing env). Used at startup/scripts, not on every row sync.

## Invariants

- Tab choice follows **current** document flags (`duplicate`, `bad_lead`) at sync time — routing logic is duplicated in `jobPlanner.ts` for queued mode; keep both in sync when changing rules.
- Do not treat sheet rows as source of truth for lead state, CPL, or CRM.
- Do not bypass projections when adding columns; update `sheets.ts` headers + matching `*Row.ts` + drainer/tests.
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

## When to read this vs sheet-sync docs

- **This file:** what gets written where, and sync/delete entry points.
- **`.cursor/rules/sheet-sync-process.mdc`:** outbox modes, drainer, quotas, coalescing, tombstones.
