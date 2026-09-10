# Session story-historical-consolidation-migration-context-2026-09-10T0631Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `migrationContext.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 284 (through `historical-consolidation-rollback.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `migrationContext.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-migration-context.md`
- operations named: refuse a runner unless the path is the missing staged-merge script folder, then plant leftover `manifest_hash` / leftover `apply_timestamp` / six leftover `suppress_*: true`; refuse leftover apply / leftover rollback when the seat is missing — never authorize the target, never take the fence, never write Mongo, never turn those flags into live service reads
- remaining in this service: `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `targetGuard.ts`

## Messages posted

- 2026-09-10T0631Z next

## Ideas parked

- none

## Contradictions

- Planted leftover `suppress_*` / leftover `apply_timestamp` are unread; leftover apply / leftover rollback discard leftover `require`
- Path fence is a substring, not the process entrypoint; leftover `token !== capability` cannot fail
- leftover `manifest.test.ts` leftover-runner proof is this **interface**, not the sealer
