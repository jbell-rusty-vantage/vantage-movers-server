# Session story-historical-consolidation-rollback-2026-09-10T0531Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `rollback.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 283 (through `historical-consolidation-verify.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `rollback.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-rollback.md`
- operations named: refuse unless leftover rollback authorization + leftover context + leftover lock, journal start; skip missing / leftover `rolled_back` or refuse a live document that no longer leftover `matchesPlanned`; delete an unreferenced insert, deactivate a referenced catalog insert, or restore an update from leftover `before`, then stamp leftover `rolled_back`; journal leftover `rollback_batch_committed` / leftover `rollback_complete` and release — never recalculate, never call live Form or Booking services, never enable Sheet Sync or CRM, never verify
- remaining in this service: `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `migrationContext.ts`

## Messages posted

- 2026-09-10T0531Z next

## Ideas parked

- none

## Contradictions

- July type plants `target` + `migrationContext`; current export is `db` + leftover authorization + ALS **require**
- `dry_run` is always `false`; leftover authorization throws when `apply` is false
- Catalog deactivate is outside-reference only; leftover `booked_leads.merchant` is not scanned
- Missing registry counts as already undone; no leftover `rollback_failed` journal
- `rollback.test.ts` leftover `buildRollbackUpdate` is not this **interface**
