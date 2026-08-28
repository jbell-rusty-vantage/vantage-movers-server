# Session story-sheet-sync-run-sheet-sync-drain-2026-08-28T1718Z

- Date (UTC): 2026-08-28T17:18Z
- Service / module: `sheetSync` / `drainer/runSheetSyncDrain.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #96 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 1 / 21
- Recommendations on disk: 93
- Current service / next module (TRAVERSAL): `sheetSync` (in-progress) / `drainer/runSheetSyncDrain.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/sheet-sync-run-sheet-sync-drain.md`
- operations named: drain due sheet-sync jobs — one drain at a time, Mongo still owns who is due — timeout goes back to pending, a crash goes back to retrying
- remaining in this service: `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `drainer/jobPlanner.ts`

## Messages posted

- 2026-08-28T1718Z next-run

## Ideas parked

- none

## Contradictions

- Timeout leftover unplanned claims → `pending`; run-level throw leftover `processing` → `retrying`
- Empty plan (gone / unmatched / missing Booking or Cancellation) is `synced`, not `failed`
- Quota defer retries in 60s without burning an attempt; write fail burns attempts
- Legacy remember `save()` can abort; drain `updateOne` persist failure flips outcomes and does not abort
- Duplicate claimed keys marked `synced` even when the representative failed
- `maxCoalescedEntitiesPerDrain` is configured and unused here
- This file does not check `SHEET_SYNC_MODE`; cron does
- Cron returns 200 when `summary.ok === false`
- Trigger `"script"` has no runtime caller
- This checkout’s `CONTEXT.md` does not define Sheet Sync / Reporting Sheets
