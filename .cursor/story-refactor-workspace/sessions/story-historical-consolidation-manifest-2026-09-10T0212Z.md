# Session story-historical-consolidation-manifest-2026-09-10T0212Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `manifest.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 280 (through `historical-consolidation-planner.md`)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `manifest.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-manifest.md`
- operations named: replay reviewed decisions without changing the plan (only quarantine or preserve-live-scalar); stamp operation ids, sort, refuse a collision, then ask leftover schema validation; stamp decision_supplied, grow quarantine, mint identity and hashes; open sealed bytes and prove hash / version / canonical JSON
- remaining in this service: `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `apply.ts`

## Messages posted

- 2026-09-10T0212Z next

## Ideas parked

- none

## Contradictions

- July spec `BuildHistoricalManifest(snapshot, rules, decisions)` is the planner; this file is Stage F only
- Replay refuses select_candidate / field_decision even when the case allowed them
- parse does not re-run decisions or leftover schema validation; leftover apply never asks parse
- Folder test files leftover targetGuard and leftover migrationContext
- Caller `decision_bundle_hash` is ignored
- Quarantine does not strip operations
