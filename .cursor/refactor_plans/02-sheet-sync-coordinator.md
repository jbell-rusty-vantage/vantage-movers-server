# 02 Sheet Sync Coordinator Refactor

## Purpose

Extract background sheet sync scheduling and persistence from `api/services/v1.service.ts` into a focused `api/services/sheetSync/` folder.

This task should happen after the Google Sheets facade exists, because every domain service will depend on sheet sync but should not own its implementation.

## Read First

- `api/services/v1.service.ts`
- `api/services/googleSheets.service.ts`
- `api/models/schemaHelpers.ts`
- `api/models/FormLead.ts`
- `api/models/CallLead.ts`
- `api/models/BookedLead.ts`
- `api/models/CancelledLead.ts`

## Current Functions To Extract

From `api/services/v1.service.ts`:

- `FullSheetSyncJob`
- `scheduleUpdatedSourceLeadSync`
- `syncBookingAndSource`
- `scheduleFullSheetSyncProcess`
- `scheduleCallLeadSheetSync`
- `scheduleBookingChainSheetSync`
- `runFullSheetSyncProcess`
- `syncSourceLeadById`
- `syncBookingChainById`
- `syncCancellationChainById`
- `sheetSyncLogContext`
- `syncSourceLead`
- `syncAndStore`

## Target Files

```text
api/services/sheetSync/
  sheetSyncJobs.ts
  sheetSyncCoordinator.ts
  sheetSyncPersistence.ts
  sheetSyncSourceLookup.ts
  index.ts
```

Suggested ownership:

- `sheetSyncJobs.ts`: job types, constructors, operation names.
- `sheetSyncCoordinator.ts`: scheduling and `runFullSheetSyncProcess`.
- `sheetSyncPersistence.ts`: `syncAndStore` and `sheet_sync` entry merge behavior.
- `sheetSyncSourceLookup.ts`: `syncSourceLeadById`, `syncBookingChainById`, `syncCancellationChainById`, and source/booking chain sync helpers if they cannot live cleanly in coordinator.
- `index.ts`: narrow exports used by lead, booking, cancellation, enrichment, and reconciliation services.

## Compatibility Exports

Keep these available from `api/services/v1.service.ts` during migration:

- `scheduleCallLeadSheetSync`
- `scheduleBookingChainSheetSync`
- `refreshAttachedBookingFromLead` if still owned by booking mirror code at this stage.

Do not require routes or other services to import from `sheetSync/` until the compatibility layer is stable.

## Agent Instructions

1. Create `api/services/sheetSync/` and move only sheet-sync code in the first pass.
2. Avoid importing broad domain service facades from `sheetSync/`; import models and the Google Sheets facade directly.
3. Keep the current `waitUntil` behavior and logging shape.
4. Preserve `sheet_sync` merge behavior exactly: synced entries should update row metadata, failed entries should retain failure state, and existing entries not touched by the sync should remain.
5. Do not change when lead, booking, or cancellation services schedule syncs.
6. Re-export the moved functions from `api/services/v1.service.ts`.
7. Run `pnpm typecheck` and `pnpm test`.

## Behavioral Invariants

- Mongo remains source of truth.
- Sheets sync remains a side effect.
- The refactor must not introduce a persistent job queue.
- `waitUntil` usage must remain Vercel-compatible.
- Existing enrichment and reconciliation services must still be able to trigger call lead or booking chain syncs.

## Suggested Tests

If adding or improving tests, mock the Google Sheets facade and verify:

- Call lead jobs sync only the requested call lead.
- Booking chain jobs sync booking and linked source lead.
- Cancellation chain jobs sync cancellation, booking, and source lead where present.
- `syncAndStore` merges `sheet_sync` results without dropping unrelated target entries.

## Handoff To Next Agent

Report:

- Which functions remain re-exported from `v1.service.ts`.
- Whether any circular import pressure appeared.
- Whether `sheetSyncSourceLookup.ts` still duplicates source lead lookup logic that should later move to `services/leads/sourceLeadLookup.service.ts`.

The next agent should use this folder when extracting lead services.
