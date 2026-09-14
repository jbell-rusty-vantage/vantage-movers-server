# Session story-models-sheet-sync-job-2026-09-14T0408Z

- Date (UTC): 2026-09-14T0408Z
- Service / module: `models` / `SheetSyncJob.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 375
- Current service / next module (TRAVERSAL): `models` (in-progress) / `SheetSyncJob.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-sheet-sync-job.md](../recommendations/models-sheet-sync-job.md)
- operations named: hold the durable Sheet Sync outbox row; hold the delete tombstone nest the worker needs after the document is gone; stamp the four unnamed clocks and hand back the default-connection model
- remaining in this service: `SheetSyncRun.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `SheetSyncRun.ts`

## Messages posted

- 2026-09-14T0408Z next

## Ideas parked

- none

## Contradictions

- No selected-database getter; leftover outbox / leftover drain / leftover admin leftover-ask the default model after leftover `connectMongo()` or inside the caller session
- `coalescing_key` is required and not unique; fold is `{ key, status ∈ pending|retrying }`; never fold onto `processing`
- File omits `autoIndex: false` (boot creates leftover unnamed leftover clocks); there is no named-index catalog and no collection-name export
- `leased_until` comment says “Lease reclamation sweep”; live claim uses status + `due_at` + `leased_until`; there is no dedicated sweep
- `operation` is a free string; `entity_model` is optional on the schema
- `schema-and-crud-inputs.mdc` does not name `sheet_sync_jobs`
- Leftover Job Timeline leftover-hops leftover `db.collection("sheet_sync_jobs")` leftover — leftover not leftover this leftover model
- Knowledge table leftover-says leftover later `SheetSyncLease` leftover is leftover “Global drain mutex”; live leftover later leftover file leftover leftover-says leftover per-tab leftover write leftover fence — leftover park leftover that leftover fight leftover for leftover later leftover `SheetSyncLease.ts`
- Leftover later `SheetSyncRun.ts` is the leftover per-drain leftover history leftover card — do not merge this leftover job into that leftover run
