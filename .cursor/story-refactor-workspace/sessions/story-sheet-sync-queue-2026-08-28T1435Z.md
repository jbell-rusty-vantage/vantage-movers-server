# Session story-sheet-sync-queue-2026-08-28T1435Z

- Date (UTC): 2026-08-28T14:35Z
- Service / module: `sheetSync` / `sheetSyncQueue.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/94

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 16 / 1 / 21
- Recommendations on disk: 90
- Current service / next module (TRAVERSAL): `sheetSync` (in-progress) / `sheetSyncQueue.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/sheet-sync-queue.md`
- operations named: wake the drain for due sheet-sync jobs
- remaining in this service: `sheetSyncPersistence.ts`, `sheetSyncSourceLookup.ts`, `drainer/runSheetSyncDrain.ts`, `drainer/jobPlanner.ts`, `drainer/batchWriter.ts`, `drainer/tabRowMap.ts`, `drainer/quotaLimiter.ts`

## Stock at end

- Visited / in-progress / unvisited: 16 / 1 / 21
- Current service / next module: `sheetSync` (in-progress) / `sheetSyncPersistence.ts`

## Messages posted

- 2026-08-28T1435Z next-run

## Ideas parked

- none

## Contradictions

- Consumer ignores `{ kind, reason, run_hint }`; drain is a scan
- `cron` / `admin_retry` / `manual` are on the union and never published
- Skip logs; Lead Messaging does not
- Fail writes an operational event (`notificationCandidate: false`); Lead Messaging does not
- `idempotencyKey` / `runHint` unused; `run_hint` is always null on the wire
- Publish gate does not refuse `TEST_MODE` (Lead Messaging and Granot do)
- `SHEET_SYNC_QUEUE_LOCAL_PUBLISH` is a documented no-op
- Barrel re-exports this file; Lead Messaging barrel does not
- This checkout’s `CONTEXT.md` does not define queue wake-up / outbox drain
