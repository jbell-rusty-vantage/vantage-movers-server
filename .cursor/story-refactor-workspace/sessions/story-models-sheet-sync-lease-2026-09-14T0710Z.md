# Session story-models-sheet-sync-lease-2026-09-14T0710Z

- Date (UTC): 2026-09-14T0710Z
- Service / module: `models` / `SheetSyncLease.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 378
- Current service / next module (TRAVERSAL): `models` (in-progress) / `SheetSyncLease.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-sheet-sync-lease.md](../recommendations/models-sheet-sync-lease.md)
- operations named: hold the named-scope fence row; remember which named scope this fence is for; stamp the unnamed expiry clock and hand back the default-connection model
- remaining in this service: `SheetSyncQuotaBucket.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `SheetSyncQuotaBucket.ts`

## Messages posted

- 2026-09-14T0710Z next

## Ideas parked

- none

## Contradictions

- Knowledge table leftover-says leftover “Global drain mutex.” File leftover comment leftover leftover-says leftover leftover per-tab leftover leftover write leftover leftover fence. Live leftover writers leftover leftover-share leftover leftover `sheet_sync_leases` leftover leftover for leftover leftover four leftover leftover account leftover leftover scopes leftover leftover and leftover leftover never leftover leftover mint leftover leftover a leftover leftover tab leftover leftover scope
- Already-recommended leftover `fencedLeaseFields()` leftover-hands leftover the leftover same leftover four leftover columns leftover and leftover has leftover **no** leftover caller; this leftover file leftover leftover-copies leftover leftover them leftover leftover by leftover leftover hand
- File omits `autoIndex: false` (boot creates leftover unique leftover scope leftover plus leftover unnamed leftover `{ leased_until: 1 }`); there is no named-index catalog and no collection-name export
- No selected-database getter; leftover wrapper leftover / leftover BR leftover / leftover Granot leftover leftover-ask leftover leftover the leftover leftover default leftover leftover model leftover leftover after leftover leftover `connectMongo()`
- `schema-and-crud-inputs.mdc` does not name `sheet_sync_leases`
- Leftover historical leftover leftover consolidation leftover leftover-does leftover leftover **not** leftover leftover list leftover leftover `sheet_sync_leases`
- Leftover Job Timeline leftover leftover-does leftover leftover **not** leftover leftover hop leftover leftover this leftover leftover collection
- Already-recommended leftover `SheetSyncJob` leftover leftover-holds leftover leftover a leftover leftover different leftover leftover job leftover leftover lease leftover leftover on leftover leftover `sheet_sync_jobs` leftover leftover — leftover leftover do leftover leftover not leftover leftover merge
- Leftover later leftover `SheetSyncQuotaBucket.ts` leftover leftover is leftover leftover the leftover leftover leftover quota leftover leftover leftover bucket leftover leftover leftover — leftover leftover leftover do leftover leftover leftover not leftover leftover leftover merge this leftover leftover leftover fence leftover leftover leftover into leftover leftover leftover that leftover leftover leftover file
