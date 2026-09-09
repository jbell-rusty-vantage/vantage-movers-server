# Session story-durable-work-actors-2026-09-09T1710Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `actors.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 271 (through `durable-work-checksum.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `actors.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-actors.md`
- operations named: name this already-judged Registry human as a Vantage Admin speaker; name the fixed system speaker or starter; wrap speaker and starter into the audit envelope; redact secret-shaped keys from leftover metadata
- remaining in this service: `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `checkpoints.ts`

## Messages posted

- 2026-09-09T1710Z next

## Ideas parked

- none

## Contradictions

- Fixed speaker ids are copied here and in `domainCommands/types.ts` / `commandContext.ts`
- `createReportingProjectionActor`, `createDurableAuditEnvelope`, and `sanitizeDurableMetadata` have no runtime callers
- Live reporting harness invents `HARNESS_ACTOR` instead of asking the reporting factory
- This redact regex disagrees with leftover Registry snapshot sanitizer
