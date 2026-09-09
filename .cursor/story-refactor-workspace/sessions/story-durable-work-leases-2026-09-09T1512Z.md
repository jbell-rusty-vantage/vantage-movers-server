# Session story-durable-work-leases-2026-09-09T1512Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `leases.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 0 / 6
- Recommendations on disk: 269 (through `domain-commands-bookings.md`)
- Current service / next module (TRAVERSAL): `durableWork` (unvisited — enumerate first)

## This pass

- opened new service?: yes — enumerated `leases.ts`, `checksum.ts`, `actors.ts`, `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`; skipped `types.ts` (types) and `index.ts` (barrel)
- path or skip: recommended → `recommendations/durable-work-leases.md`
- operations named: claim this named scope until the clock; keep this named scope alive only while this owner still holds it; give this named scope back; prove this owner still holds this named scope
- remaining in this service: `checksum.ts`, `actors.ts`, `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`

## Stock at end

- Visited / in-progress / unvisited: 32 / 1 / 5
- Current service / next module: `durableWork` (in-progress) / `checksum.ts`

## Messages posted

- 2026-09-09T1512Z next

## Ideas parked

- none

## Contradictions

- SheetSyncLease comment says per-tab; live scopes are account-level and share `sheet_sync_leases`
- Folder test never constructs `MongoLeaseStore`
