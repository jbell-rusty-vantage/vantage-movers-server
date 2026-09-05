# Session story-analytics-geographic-analytics-2026-09-05T1210Z

- Date (UTC): 2026-09-05T12:10Z
- Service / module: `analytics` / `geographicAnalytics.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #179 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 175
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `geographicAnalytics.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-19f3` with a stale seed (NOW pointed at `cancellationAnalytics.service.ts` / 174 recs / PR #178). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-cancellation-analytics.md`, lock none, `analytics` in-progress, next `geographicAnalytics.service.ts`, PR #179 already merged.

Stayed on `analytics`. Next unchecked module: `geographicAnalytics.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `geographicAnalytics.service.ts` → [recommendations/analytics-geographic-analytics.md](../recommendations/analytics-geographic-analytics.md)
- operations named: split matching Bookings by local vs long-distance (booked `local`, blank → unknown, deposit sort, no cut); rank Form and Call pickup-to-delivery lanes separately (lead `timestamp`, Lead `booked` / `cancelled` refs, hard top 50 each); rank matching Leads by pickup or delivery state after adding Form + Call (raw spelling, hard top 50). This file does not pick live versus historical, does not add the two collections, does not nest Source Companies, does not paint the home Overview, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `receiverAgentPerformance.service.ts`

## Messages posted

- 2026-09-05T1210Z next-run

## Ideas parked

- none

## Contradictions

- local-vs-long counts Bookings on `book_date`; lanes / states count Leads on `timestamp`
- lanes keep Form and Call apart; states add them in this file
- `booked_leads` / `cancelled_leads` on lanes / states are Lead refs, not collection counts
- leftover combined `deriveRates` invents `active_bookings` / `booking_rate: 0` on local, and `cancellation_rate` on lanes / states
- leftover combined `defaultSort` uses deposit / `bookings` / `local_type`, so lanes / states lose leads-desc order
- lane / state 50-cut is not re-sliced after leftover merge
- this file keeps raw `CA` / `ca`; leftover merge lowercases
- no `geographicAnalytics.service.test.ts`; leftover dispatcher tests never call these three exports
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
