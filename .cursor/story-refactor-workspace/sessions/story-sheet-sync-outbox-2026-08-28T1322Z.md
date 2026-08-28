# Session story-sheet-sync-outbox-2026-08-28T1322Z

- Date (UTC): 2026-08-28T13:22Z
- Service / module: `sheetSync` / `sheetSyncOutbox.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/93

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 1 / 21
- Recommendations on disk: 89
- Current service / next module (TRAVERSAL): `sheetSync` (in-progress) / `sheetSyncOutbox.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/sheet-sync-outbox.md`
- operations named: remember (or fold) a durable upsert; snapshot the known sheet rows; remember a durable delete tombstone and cancel the matching upsert
- remaining in this service: `sheetSyncQueue.service.ts`, `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `sheetSyncQueue.service.ts`

## Messages posted

- 2026-08-28T1322Z next-run

## Ideas parked

- none

## Contradictions

- Mode-blind on purpose; Granot / RingCentral skip persist
- Booked-lead tombstone does not cancel booking_chain
- Never coalesce onto processing
- `$set target_hints: []` on every upsert coalesce
- `dueAt` unused; admin retry mutates the job row
- Persist mode-gate test lives in this file
- Call Lead snapshot adds fallback tabs
- This checkout’s `CONTEXT.md` does not define outbox / coalescing / tombstone
