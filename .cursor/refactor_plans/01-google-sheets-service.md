# 01 Google Sheets Service Refactor

## Purpose

Split `api/services/googleSheets.service.ts` into a Google Sheets integration folder while preserving the current public exports and sheet behavior.

This is the first code refactor because most pieces are adapter, projection, target, and row I/O code that can be moved without changing business workflows.

## Read First

- `api/services/googleSheets.service.ts`
- `api/utils/googleSheetsRanges.ts`
- `api/utils/googleSheetsDiagnostics.ts`
- `api/config/domain.ts`
- `docs/service-file-refactor-proposal.md`

## Current Responsibilities

`api/services/googleSheets.service.ts` currently owns:

- Google auth client creation and auth config logging.
- Public sync and delete functions for form leads, call leads, booked leads, and cancelled leads.
- Master/source/booked/cancelled target resolution.
- Tab creation, header updates, and legacy trailing-cell cleanup.
- Row upsert, row lookup by `Mongo ID`, known-row verification, and row delete.
- Row projection and cell formatting.
- Google API error diagnostics via utils.

## Target Files

Create this folder:

```text
api/services/googleSheets/
  googleSheets.service.ts
  auth.ts
  targets.ts
  syncRows.ts
  deleteRows.ts
  rowLookup.ts
  tabs.ts
  types.ts
  projections/
    cells.ts
    formLeadRow.ts
    callLeadRow.ts
    bookedLeadRow.ts
    cancelledLeadRow.ts
```

Keep this compatibility file:

```text
api/services/googleSheets.service.ts
```

It should re-export from `api/services/googleSheets/googleSheets.service.ts` until all imports are migrated.

## Extraction Map

- Move `getSheetsClient`, `getServiceAccountCredentials`, `getServiceAccountFile`, and `logAuthConfigOnce` to `auth.ts`.
- Move `SyncTarget`, `SheetTabConfig`, `SyncableDocument`, and sheet source types to `types.ts`.
- Move `getLeadTargets`, `getDeleteTargets`, `deleteTargetKey`, `getHeadersForSyncTarget`, `getEnsureTabsForSyncTarget`, `getMasterLeadsTabs`, `getMasterBookedTabs`, and `getSourceLeadTabs` to `targets.ts`.
- Move `syncRowToTargets` and target-level result logging to `syncRows.ts`.
- Move `deleteRowsFromTargets` and `deleteSheetRow` to `deleteRows.ts`.
- Move `upsertRow`, `findRowNumberByMongoId`, `rowNumberContainsMongoId`, and `columnLetter` to `rowLookup.ts` unless `columnLetter` is only needed by `tabs.ts`; then export it narrowly or duplicate after discussion.
- Move `ensureTabsAndHeaders`, `clearLegacyTrailingCells`, `getLegacyHeaderLength`, `clearSheetValues`, `ensureTab`, `getExistingSheetId`, and `isGoogleSheetAlreadyExistsError` to `tabs.ts`.
- Move `formLeadToRow`, `callLeadToRow`, `bookedLeadToRow`, and `cancelledLeadToRow` to projection files.
- Move `formatDateOnly`, `formatTimestamp`, `booleanCell`, `localCell`, `optionalLocalCell`, `bookedCell`, `bookedDateCell`, `overThresholdCell`, `cancelledCell`, `quotedCell`, `formatNumber`, `primaryBookingAgent`, and `splitCell` to `projections/cells.ts` where appropriate.

## Public API To Preserve

The facade must continue exporting:

- `syncFormLeadToSheets`
- `syncCallLeadToSheets`
- `syncBookedLeadToSheets`
- `syncCancelledLeadToSheets`
- `deleteFormLeadFromSheets`
- `deleteCallLeadFromSheets`
- `deleteBookedLeadFromSheets`
- `deleteCancelledLeadFromSheets`
- `ensureAllConfiguredSheetTabs`

Do not change parameter shapes or return types during this task.

## Agent Instructions

1. Add projection tests before moving row projection code if practical. Use plain sample objects; do not call Google APIs.
2. Move the row projection functions first because they are the easiest to isolate.
3. Move target resolution second.
4. Move row lookup, tabs, sync, and delete code after types and targets are stable.
5. Keep `api/services/googleSheets.service.ts` as a compatibility re-export.
6. Update imports only inside the new `services/googleSheets/` folder and the compatibility file unless the task explicitly includes import migration.
7. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- `SERVICE_ACCOUNT_LOCAL_FILE` must still be ignored when `TEST_MODE=true`.
- Sheet IDs must still resolve through mode-aware config functions.
- Headers and tab names must not change.
- Existing `sheet_sync` row numbers must still be trusted only after verifying the row contains the same `Mongo ID`.
- Failed target syncs should still return failed `SheetSyncEntry` records rather than failing the whole sync.

## Handoff To Next Agent

After this task, hand off:

- The new `api/services/googleSheets/` folder.
- The compatibility status of `api/services/googleSheets.service.ts`.
- Any projection tests added.
- Any unresolved question about `googleSheetsDiagnostics.ts` placement.

The next agent should use this as the adapter boundary for `02-sheet-sync-coordinator.md`.
