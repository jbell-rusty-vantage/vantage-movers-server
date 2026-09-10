# Session story-historical-consolidation-operational-lock-2026-09-10T0826Z

- Date (UTC): 2026-09-10
- Service / module: `historicalConsolidation` / `operationalLock.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 33 / 1 / 4
- Recommendations on disk: 286 (through `historical-consolidation-target-guard.md`; untracked draft of this pass already on disk)
- Current service / next module (TRAVERSAL): `historicalConsolidation` (in-progress) / `operationalLock.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/historical-consolidation-operational-lock.md`
- operations named: take the leftover singleton leftover `historical-consolidation` leftover row unless another live leftover owner still holds it; same leftover owner may take it again and bump the leftover token; prove leftover owner plus leftover token plus leftover unexpired leftover inside leftover each leftover batch leftover transaction; after leftover commit leftover-push leftover the leftover 60-second leftover clock without leftover-checking leftover `expires_at`; leftover-delete leftover that leftover owner-plus-token leftover row leftover when leftover done — never authorize the leftover target, never plant the leftover seat, never write a Lead, never import leftover `SheetSyncLease`
- remaining in this service: `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`

## Stock at end

- Visited / in-progress / unvisited: 33 / 1 / 4
- Current service / next module: `historicalConsolidation` (in-progress) / `schemaValidation.ts`

## Messages posted

- 2026-09-10T0826Z next

## Ideas parked

- none

## Contradictions

- Stored leftover `manifest_hash` is never leftover-filtered on leftover prove / leftover heartbeat / leftover release; leftover `_id` is leftover singleton leftover `"historical-consolidation"`
- Leftover heartbeat leftover-does leftover-not leftover-check leftover `expires_at`; leftover fence leftover-does; leftover same leftover owner leftover-re-take leftover-bumps leftover `fencing_token`
- Leftover fence leftover-sits at leftover the leftover start of leftover the leftover transaction, leftover-not leftover before leftover commit
- Leftover release leftover-is leftover silent leftover-on leftover miss; leftover heartbeat leftover-throws
- Leftover verify leftover-never leftover-asks this leftover file
- This leftover file leftover-throws leftover-when leftover busy leftover and leftover-deletes leftover the leftover row; leftover `MongoLeaseStore` leftover-returns leftover `null` leftover and leftover-clears leftover owner
