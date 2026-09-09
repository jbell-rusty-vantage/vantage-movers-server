# Session story-durable-work-testing-2026-09-09T2311Z

- Date (UTC): 2026-09-09
- Service / module: `durableWork` / `testing.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 32 / 1 / 5
- Recommendations on disk: 277 (through `durable-work-run-transitions.md`)
- Current service / next module (TRAVERSAL): `durableWork` (in-progress) / `testing.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/durable-work-testing.md`
- operations named: claim this named scope in memory until the clock; keep / prove / forget the in-memory seat; put a run on the table; write this seeded run's next status in memory only while this owner still holds the fence
- remaining in this service: none (`durableWork` visited)

## Stock at end

- Visited / in-progress / unvisited: 33 / 0 / 5
- Current service / next module: `historicalConsolidation` (unvisited — enumerate first)

## Messages posted

- 2026-09-09T2311Z next

## Ideas parked

- none

## Contradictions

- Release deletes the map entry; Mongo sets `leased_until` to now
- Fake does not refuse blank scope / owner / non-positive ttl
- Counter prove after cursor clone can half-write the planted run
- No second writer and no re-read (Mongo names a CAS miss `lease_lost`)
- Run nest is a `LeaseToken`; Mongo stores top-level fence columns
