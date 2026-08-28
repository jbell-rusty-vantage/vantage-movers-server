# Session story-sheet-sync-job-planner-2026-08-28T1824Z

- Date (UTC): 2026-08-28T18:24Z
- Service / module: `sheetSync` / `drainer/jobPlanner.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR after #97 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 1 / 21
- Recommendations on disk: 94
- Current service / next module (TRAVERSAL): `sheetSync` (in-progress) / `drainer/jobPlanner.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/sheet-sync-job-planner.md`
- operations named: plan the sheet writes for this claimed job — unmatched Call stub is an empty plan, vanished Booking is an empty plan, vanished source Lead still throws
- remaining in this service: `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `drainer/batchWriter.ts`

## Messages posted

- 2026-08-28T1824Z next-run

## Ideas parked

- none

## Contradictions

- Empty plan is two shapes: `[]` (unmatched / missing Booking / missing Cancellation / missing tombstone) vs `[{ writes: [] }]` (tombstone with no previous_targets); drain treats both as synced
- Missing Booking / Cancellation is quiet empty; missing source Lead is `getLinkedLead` 404 and fails the whole chain plan (booked writes built in memory are discarded)
- Cancellation Chain with a vanished Booking still plans Cancelled Deals
- Queued Bad Leads delete only when `sheet_sync[]` already has that target; legacy always deletes
- Call stale opposite is always planned; Form does not delete stale Forms / Duplicates
- Booked / Cancelled `ensureTabs` is `[]` here; the googleSheets facade uses `getMasterBookedTabs()`
- Previous drain pass said planner tests lock unmatched skip / missing Booking; disk has neither
- This checkout’s `CONTEXT.md` does not define Sheet Sync / Reporting Sheets
