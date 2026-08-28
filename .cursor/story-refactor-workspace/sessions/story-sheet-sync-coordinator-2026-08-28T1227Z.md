# Session story-sheet-sync-coordinator-2026-08-28T1227Z

- Date (UTC): 2026-08-28T12:27Z
- Service / module: `sheetSync` / `sheetSyncCoordinator.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/92

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 0 / 22
- Recommendations on disk: 88
- Current service / next module (TRAVERSAL): `sheetSync` (unvisited) / enumerate first

## This pass

- opened new service?: yes — enumerated 15 service modules; skipped `sheetSyncJobs.ts` (type-only), `index.ts` (barrel), `drainer/leases.ts` (lease adapter), `drainer/types.ts` (type-only), `drainer/index.ts` (barrel)
- path or skip: recommended → `recommendations/sheet-sync-coordinator.md`
- operations named: hold the domain write so the outbox can ride along; remember the sheet-sync intent; after commit, tell the sheets; after a delete tombstone commits, wake the drain; schedule the unmigrated path; refresh the sheets now
- remaining in this service: `sheetSyncOutbox.service.ts`, `sheetSyncQueue.service.ts`, `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `sheetSyncOutbox.service.ts`

## Messages posted

- 2026-08-28T1227Z next-run

## Ideas parked

- none

## Contradictions

- Two enqueue paths: persist inside the caller session vs queued `schedule*` `waitUntil` enqueue+publish (not in the domain txn)
- Granot / RingCentral call `enqueueSheetSyncJob` then finalize (mode-blind); knowledge already labels the gap
- Legacy finalize is a double hop through `schedule*`
- `forceTransaction` is Form Lead messaging / WordPress receipt, not a Sheet Sync flag
- No coordinator-owned test; persist mode gate lives on the outbox test
- This checkout’s `CONTEXT.md` does not define Sheet Sync; `docs/adr/` is absent
