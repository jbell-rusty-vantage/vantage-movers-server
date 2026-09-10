# Session story-historical-consolidation-apply-2026-09-10T0310Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `apply.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 281 (through `historical-consolidation-manifest.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `apply.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-apply.md`
- operations named: prove the live cluster / checksums / indexes still match (skip checksums on resume); take leftover authorization + leftover migration context + leftover lock and journal start plus outbound baseline; insert or compare-and-swap each sealed write and remember it in the registry; journal complete or failed and release — never recalculate, never call live Form/Booking services, never enable Sheet Sync or CRM, never verify or rollback
- remaining in this service: `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `verify.ts`

## Messages posted

- 2026-09-10T0310Z next

## Ideas parked

- none

## Contradictions

- Spec says apply uses application services; code writes raw Mongo
- July type plants migrationContext as an argument; code **asks** leftover ALS require
- `dry_run` on the result card is always false
- Update `before` is required and unused; insert has no planned-match fallback
- No `apply.test.ts`; leftover auth/runner proofs sit on `manifest.test.ts`
