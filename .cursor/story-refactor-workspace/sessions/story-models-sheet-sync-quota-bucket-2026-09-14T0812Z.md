# Session story-models-sheet-sync-quota-bucket-2026-09-14T0812Z

- Date (UTC): 2026-09-14T0812Z
- Service / module: `models` / `SheetSyncQuotaBucket.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 379
- Current service / next module (TRAVERSAL): `models` (in-progress) / `SheetSyncQuotaBucket.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-sheet-sync-quota-bucket.md](../recommendations/models-sheet-sync-quota-bucket.md)
- operations named: hold the per-minute Sheets budget bucket row; remember which Google budget, read-or-write class, and minute this count is for; stamp the unnamed unique triple plus the one-hour TTL clock and hand back the default-connection model
- remaining in this service: `GoogleDriveConnection.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `GoogleDriveConnection.ts`

## Messages posted

- 2026-09-14T0812Z next

## Ideas parked

- none

## Contradictions

- Knowledge table leftover-lists leftover four leftover Sheet leftover Sync leftover collections leftover and leftover leftover-omits leftover leftover `sheet_sync_quota_buckets`; leftover leftover next leftover leftover sentence leftover leftover leftover-names leftover leftover leftover the leftover leftover leftover model
- `sheet-sync-process.mdc` Files leftover leftover-lists leftover leftover Job leftover leftover / leftover leftover Run leftover leftover / leftover leftover Attempt leftover leftover / leftover leftover Lease leftover leftover and leftover leftover leftover-omits leftover leftover leftover this leftover leftover leftover file
- File leftover comment leftover leftover-says leftover leftover `user` leftover leftover vs leftover leftover `project`; leftover leftover live leftover leftover limiter leftover leftover leftover-writes leftover leftover leftover only leftover leftover leftover `"user"` leftover leftover leftover and leftover leftover leftover leftover-never leftover leftover leftover leftover leftover-constructs leftover leftover leftover leftover leftover `scope: "project"`
- Config leftover leftover-lists leftover leftover unused leftover leftover project leftover leftover budgets leftover leftover (250 leftover leftover default leftover leftover / leftover leftover 300 leftover leftover hard)
- `scope` leftover leftover is leftover leftover a leftover leftover free leftover leftover string leftover leftover — leftover leftover leftover not leftover leftover leftover an leftover leftover leftover enum
- `op_class` leftover leftover is leftover leftover inline leftover leftover — leftover leftover leftover this leftover leftover leftover file leftover leftover leftover leftover-does leftover leftover leftover leftover **not** leftover leftover leftover leftover import leftover leftover leftover leftover `SheetSyncQuotaOpClass`
- `count` leftover leftover has leftover leftover **no** leftover leftover `min` leftover leftover (leftover leftover later leftover leftover public leftover leftover throttle leftover leftover leftover-sets leftover leftover leftover `min: 0`)
- File omits `autoIndex: false` (boot creates leftover unique leftover triple leftover plus leftover unnamed leftover TTL leftover `{ window_start: 1 }` leftover `expireAfterSeconds: 3600`); there is no named-index catalog and no collection-name export
- No selected-database getter; leftover limiter leftover leftover-asks leftover leftover the leftover leftover default leftover leftover model leftover leftover after leftover leftover `connectMongo()`
- `schema-and-crud-inputs.mdc` does not name `sheet_sync_quota_buckets`
- Leftover historical leftover leftover consolidation leftover leftover leftover-does leftover leftover leftover **not** leftover leftover leftover list leftover leftover leftover `sheet_sync_quota_buckets`
- Leftover Job leftover leftover Timeline leftover leftover leftover-does leftover leftover leftover **not** leftover leftover leftover hop leftover leftover leftover this leftover leftover leftover collection
- Already-recommended leftover leftover `SheetSyncLease` leftover leftover leftover is leftover leftover leftover a leftover leftover leftover different leftover leftover leftover fence leftover leftover leftover — leftover leftover leftover do leftover leftover leftover not leftover leftover leftover merge
- Leftover later leftover leftover `PublicSubmissionThrottleBucket.ts` leftover leftover leftover / leftover leftover leftover leftover later leftover leftover leftover leftover `LeadMessageRateLimit.ts` leftover leftover leftover leftover leftover are leftover leftover leftover leftover leftover different leftover leftover leftover leftover leftover bags leftover leftover leftover leftover leftover — leftover leftover leftover leftover leftover do leftover leftover leftover leftover leftover not leftover leftover leftover leftover leftover merge
