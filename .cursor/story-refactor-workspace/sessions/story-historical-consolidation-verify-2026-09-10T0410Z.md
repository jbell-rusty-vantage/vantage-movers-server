# Session story-historical-consolidation-verify-2026-09-10T0410Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `verify.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 282 (through `historical-consolidation-apply.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `verify.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-verify.md`
- operations named: prove every sealed index still exists (accumulate, include registry); prove each sealed write still has an applied/verified registry row and leftover `matchesPlanned` the live document; prove sealed after-counts, global duplicate Job Numbers, planned references, and binder cents; prove leftover `apply_start` and leftover outbound collections did not grow, then stamp leftover `verified` and always journal the card — never recalculate, never take the fence, never authorize, never rollback
- remaining in this service: `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `rollback.ts`

## Messages posted

- 2026-09-10T0410Z next

## Ideas parked

- none

## Contradictions

- Verify writes (stamp + journal) without leftover lock / leftover authorization / leftover migration context
- Missing `apply_start` zeros the outbound subtract
- Duplicate Job Number is a global live-book scan
- No `verify.test.ts`
