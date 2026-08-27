# Session story-granot-lifecycle-metrics-2026-08-27T1709Z

- Date (UTC): 2026-08-27T1709Z
- Service / module: `granotLifecycle` / `metrics.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / new PR after #72 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 11 / 1 / 26
- Recommendations on disk: 69
- Current service / next module (TRAVERSAL): `granotLifecycle` / `metrics.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotLifecycle/metrics.ts` → [recommendations/granot-lifecycle-metrics.md](../recommendations/granot-lifecycle-metrics.md)
- operations named: count what this process just finished using only closed labels; replace the current pile (due / open cases / open fights); show this process's memory or forget it
- remaining in this service: `alerts.ts`

## Stock at end

- Visited / in-progress / unvisited: 11 / 1 / 26
- Current service / next module: `granotLifecycle` / `alerts.ts`

## Messages posted

- 2026-08-27T1709Z next

## Ideas parked

- none

## Contradictions

- Knowledge `observability.md` lists this file plus `observability.ts`, `alerts.ts`, and `projectGranotLifecycleHealth` as Primary code
- Section 33 name list includes three RingCentral metrics implemented in `ringcentral-metrics.ts`
- Capture-failure / queue-publish-failure / activation totals are process-local but not on the Section 33 name list
- Health writes these gauges from Mongo and does not read the getters
- Due gauges are written from health via `drainer.applyDueGauges`, not from the drain pass
- Booking persist refreshes Booking-case piles; Release persist and discrepancy persist do not
- This checkout’s `CONTEXT.md` does not define Section 33 metrics
