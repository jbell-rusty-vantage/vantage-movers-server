# Session story-durable-work-run-transitions-2026-09-09T2212Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `runTransitions.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 276 (through `durable-work-provider-retry.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `runTransitions.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-run-transitions.md`
- operations named: write this run's next status only while this owner still holds the fence; refuse a hop the graph does not allow; after a missed write, say whether the run vanished, the status moved, or the lease is gone
- remaining in this service: `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `testing.ts`

## Messages posted

- 2026-09-09T2212Z next

## Ideas parked

- none

## Contradictions

- `MongoDurableRunStore` has no runtime constructor; live workers write status themselves
- After a missed write, cursor / leftover-counter CAS miss is named `lease_lost`
- In-memory fence requires `instanceof Date`; Mongo `$gt` does not
- This filter disagrees with unused `buildCheckpointCompareAndSet` (`$or` missing vs `version $in [null, 0]`)
- Persist never stamps `started_at` / `completed_at` / `attempt_count`
