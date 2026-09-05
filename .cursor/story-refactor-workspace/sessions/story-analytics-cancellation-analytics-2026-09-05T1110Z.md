# Session story-analytics-cancellation-analytics-2026-09-05T1110Z

- Date (UTC): 2026-09-05T11:10Z
- Service / module: `analytics` / `cancellationAnalytics.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / pending (open after #178 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 174
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `cancellationAnalytics.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-9ced` with a stale seed (NOW pointed at `agentPerformance.service.ts` / 173 recs / PR #177). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-agent-performance.md`, lock none, `analytics` in-progress, next `cancellationAnalytics.service.ts`, PR #178 already merged.

Stayed on `analytics`. Next unchecked module: `cancellationAnalytics.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `cancellationAnalytics.service.ts` → [recommendations/analytics-cancellation-analytics.md](../recommendations/analytics-cancellation-analytics.md)
- operations named: rate cancelled Bookings against matching Bookings (booked `is_cancelled` only — overall card plus leftover-nested by Source Company; inverse `booked_to_cancelled_ratio` on overall only); group matching Cancellations by reason (cancel date, blank → unknown, hard top 50, join Booking for refunds / affected money). This file does not pick live versus historical, does not add the two collections, does not count Cancellation rows on the ratio card, does not paint the home Overview, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `geographicAnalytics.service.ts`

## Messages posted

- 2026-09-05T1110Z next-run

## Ideas parked

- none

## Contradictions

- `booked_leads` / `cancelled_leads` name Bookings; knowledge says booked `is_cancelled` only
- leftover combined `deriveRates` drops `booked_to_cancelled_ratio`, invents `booking_rate: 0`, adds `active_bookings`
- overall `active_booked_leads` is `$subtract` without `max`; by-source uses `max`
- reasons use `cancel_date` and `$limit` 50; leftover merge does not re-slice
- knowledge “tested” flatten for ratio is leftover source-company / funnel, not this interface
- no `cancellationAnalytics.service.test.ts`; leftover dispatcher tests never call these two exports
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
