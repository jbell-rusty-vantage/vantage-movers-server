# Session story-durable-work-checksum-2026-09-09T1610Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `checksum.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 270 (through `durable-work-leases.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `checksum.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-checksum.md`
- operations named: fold this bag into one stable string; stamp this sealed envelope; prove this sealed envelope has not moved
- remaining in this service: `actors.ts`, `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `actors.ts`

## Messages posted

- 2026-09-09T1610Z next

## Ideas parked

- none

## Contradictions

- This fold refuses `undefined`; Domain Command `stableJson` omits it
- Granot HTTP / BR identity / missing-source stamps use `artifact_kind: "ingestion_plan"`
- Reporting revision prove does not ask `assertChecksum`
