# Session story-historical-consolidation-planner-2026-09-10T0112Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `planner.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 279 (through `historical-consolidation-classification.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `planner.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-planner.md`
- operations named: refuse a broken planning seat and flatten the frozen sheets; extend the catalog inactive in the plan; parse historical Form Lead candidates including Bad Leads; parse historical Call Lead candidates; ask the sibling classifier then stamp duplicate / Form Fill / zero CPL and plan insert or fill; plan historical Bookings (Job Number, Job-scoped Customer, referral or leadless); plan historical Cancellations; refuse an unclassified row then seal
- remaining in this service: `manifest.ts`, `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `manifest.ts`

## Messages posted

- 2026-09-10T0112Z next

## Ideas parked

- none

## Contradictions

- July spec wanted injected application-owned classifiers; planner asks the in-memory classification walk
- Spec Stages B–F are one function; order is kept
- Form parse quarantines; Call parse blocks
- Live Call identity uses a ±60s window; classification Call window is 90 days
- `input.decisions` is hashed by leftover manifest; this file never applies select_candidate
- Planned email is always null
- `sheet_sync: []` and `post_to_granot: false` are the outbound fence
- `pnpm historical:plan` script folder is absent from this checkout
- Expected index name `normalized_job_no_1` may differ from the live unique index name
