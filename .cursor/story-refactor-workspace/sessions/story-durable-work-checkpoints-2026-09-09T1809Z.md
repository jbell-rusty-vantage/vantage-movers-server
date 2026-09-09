# Session story-durable-work-checkpoints-2026-09-09T1809Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `checkpoints.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 272 (through `durable-work-actors.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `checkpoints.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-checkpoints.md`
- operations named: prove this cursor only moves forward; hand the compare-and-set that writes the next cursor only while this owner still holds the run; prove leftover counters only stay or climb
- remaining in this service: `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `capability.ts`

## Messages posted

- 2026-09-09T1809Z next

## Ideas parked

- none

## Contradictions

- Granot HTTP helper always writes `version: 1`; this prove requires a climb
- `buildCheckpointCompareAndSet` has no caller and disagrees with later `runTransitions` filter
- Folder test never imports this interface; later `MongoDurableRunStore` is never constructed
