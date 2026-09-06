# Session story-reporting-queue-2026-09-06T1710Z

- Date (UTC): 2026-09-06
- Service / module: `reporting` / `queue.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/203

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 1 / 10
- Recommendations on disk: 202 (through `reporting-execution-stream.md`)
- Current service / next module (TRAVERSAL): `reporting` / `queue.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/reporting/queue.ts` → [recommendations/reporting-queue.md](../recommendations/reporting-queue.md)
- operations named: wake the reporting worker for this run — never throw, never provider-deduplicate; first confirm publishes, confirm replay does not; cancel already_requested still publishes; heartbeat publishes and never drains
- remaining in this service: `reportingRunRepository.ts` first, then leftover persist / leftover promotion / leftover google adapters / leftover live harness

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` / `reportingRunRepository.ts`

## Messages posted

- 2026-09-06T1710Z next-run

## Ideas parked

- none

## Contradictions

- none
