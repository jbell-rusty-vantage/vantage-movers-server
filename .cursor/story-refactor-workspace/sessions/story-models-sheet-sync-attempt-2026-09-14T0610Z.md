# Session story-models-sheet-sync-attempt-2026-09-14T0610Z

- Date (UTC): 2026-09-14T0610Z
- Service / module: `models` / `SheetSyncAttempt.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 377
- Current service / next module (TRAVERSAL): `models` (in-progress) / `SheetSyncAttempt.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-sheet-sync-attempt.md](../recommendations/models-sheet-sync-attempt.md)
- operations named: hold the per-target write outcome; remember which drain and optional job, what we tried, and how this write closed; stamp the three unnamed clocks and hand back the default-connection model
- remaining in this service: `SheetSyncLease.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `SheetSyncLease.ts`

## Messages posted

- 2026-09-14T0610Z next

## Ideas parked

- none

## Contradictions

- No selected-database getter; leftover drain / leftover admin leftover-ask the default model after leftover `connectMongo()`
- File omits `autoIndex: false` (boot creates leftover unnamed leftover clocks); there is no named-index catalog and no collection-name export
- Five Google / quota-estimate fields (`google_operation`, `google_status`, `google_reasons`, `request_count_estimate`, `payload_bytes_estimate`) have no runtime writer; leftover batch `readsUsed` / `writesUsed` stay `0` and are not persisted here
- A clean header pass plants no `ensure_headers` row; header throw stamps `ensure_headers` on every planned write in that tab
- Empty outcomes / locked skip / empty plans / plan throws plant no attempt
- Persist is best-effort (`insertMany` ordered:false + warn) and happens after `sheet_sync[]` remember so flipped-to-failed outcomes are what get planted
- Two of three clocks have no runtime reader (`job_id+createdAt`, `status+createdAt`); admin leftover-asks only `{ run_id }` sorted `createdAt` asc
- `job_id` is optional on the schema and always set by the drain from `write.jobId` string
- No unique index — retries plant a new row
- `schema-and-crud-inputs.mdc` does not name `sheet_sync_attempts`
- Leftover historical leftover consolidation leftover-lists leftover `sheet_sync_jobs` leftover — leftover not leftover `sheet_sync_attempts`
- Leftover Job Timeline leftover-hops leftover `sheet_sync_jobs` leftover — leftover not leftover this leftover collection
- Knowledge table leftover-says leftover later `SheetSyncLease` leftover is leftover “Global drain mutex”; live leftover later leftover file leftover leftover-says leftover per-tab leftover write leftover fence — leftover park leftover that leftover fight leftover for leftover later leftover `SheetSyncLease.ts`
- Leftover later `SheetSyncLease.ts` is the leftover lease leftover — do not merge this leftover attempt into that leftover file
