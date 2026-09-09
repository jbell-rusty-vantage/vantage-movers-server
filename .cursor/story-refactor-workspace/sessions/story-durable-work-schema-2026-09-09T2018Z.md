# Session story-durable-work-schema-2026-09-09T2018Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `schema.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 274 (through `durable-work-capability.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `schema.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-schema.md`
- operations named: hand the nest that lets a run remember its fence, cursor, clocks, and failure; hand the four columns that let a named scope remember its fence
- remaining in this service: `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `providerRetry.ts`

## Messages posted

- 2026-09-09T2018Z next

## Ideas parked

- none

## Contradictions

- ReportingRun strips typed `failure` and keeps Mixed `{ code, summary, retryable, metadata }`
- `fencedLeaseFields` unused; SheetSyncLease copies the four columns
- `checkpoint.cursor` is Mixed here, primitive record on skipped `types.ts`
- Folder test never asks this file — it inspects SheetSyncLease
