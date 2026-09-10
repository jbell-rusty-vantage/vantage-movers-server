# Session story-historical-consolidation-classification-2026-09-10T0010Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `classification.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 0 / 5
- Recommendations on disk: 278 (through `durable-work-testing.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (unvisited) / enumerate first

## This pass

- opened new service?: yes — modules enumerated
- path or skip: recommended → `recommendations/historical-consolidation-classification.md`
- operations named: classify historical Form Leads inside the April 30 cohort and exact granularity; keep a matched modern live Form Lead flag; classify historical Call Leads in the earlier-only 90-day window; stamp Form Fill at Source Company scope after Form judgment
- remaining in this service: `planner.ts`, `manifest.ts`, `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `planner.ts`

## Messages posted

- 2026-09-10T0010Z next

## Ideas parked

- none

## Contradictions

- July spec still says live classifiers allow company matching; `findDuplicateFormLeadMatch` already requires exact granularity
- Spec wanted injected application-owned rule functions; planner asks this in-memory walk
- Spec sort includes workbook / row; this file sorts timestamp then id
- `FORM_DUPLICATE_CUTOFF` is copied in live `duplicateLead.service.ts`
- `CALL_DUPLICATE_WINDOW_MS` is exported and unused by leftover planner
- Leftover planner always plants `normalized_email: null`
