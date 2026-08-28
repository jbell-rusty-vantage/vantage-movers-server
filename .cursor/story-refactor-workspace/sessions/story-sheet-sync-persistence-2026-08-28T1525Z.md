# Session story-sheet-sync-persistence-2026-08-28T1525Z

- Date (UTC): 2026-08-28T15:25Z
- Service / module: `sheetSync` / `sheetSyncPersistence.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/95

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 1 / 21
- Recommendations on disk: 91
- Current service / next module (TRAVERSAL): `sheetSync` (in-progress) / `sheetSyncPersistence.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/sheet-sync-persistence.md`
- operations named: after the live sheet write, remember the row hints on the document
- remaining in this service: `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `sheetSyncSourceLookup.ts`

## Messages posted

- 2026-08-28T1525Z next-run

## Ideas parked

- none

## Contradictions

- Legacy `document.save()` vs queued drain `updateOne`
- Save throw aborts legacy refresh; drain persist failure does not abort the run
- Delete-markers never stored; drain only drops synced deletes
- Failed writes still save
- `SheetSyncFn` uses `any` on purpose
- Barrel re-exports; no domain service imports it
- This checkout’s `CONTEXT.md` does not define `sheet_sync[]` / row hint
