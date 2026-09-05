# Session story-analytics-source-performance-2026-09-05T0908Z

- Date (UTC): 2026-09-05T09:08Z
- Service / module: `analytics` / `sourcePerformance.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/176

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 25 / 1 / 12
- Recommendations on disk: 172
- Current service / next module (TRAVERSAL): `analytics` (in-progress) / `sourcePerformance.service.ts`

This checkout booted on `cursor/vantage-server-story-refactor-586f` with a stale seed (NOW pointed at `summary.service.ts` / 170 recs / PR #174). Checked out `docs/story-refactor` before choosing the module. Disk already had `analytics-revenue-trend.md`, lock none, `analytics` in-progress, next `sourcePerformance.service.ts`, PR #176 already open.

Stayed on `analytics`. Next unchecked module: `sourcePerformance.service.ts`.

## This pass

- opened new service?: no
- path or skip: recommended `sourcePerformance.service.ts` → [recommendations/analytics-source-performance.md](../recommendations/analytics-source-performance.md)
- operations named: score each Source Company on matching Bookings (Lead Source Performance is the same booked scorecard under a second HTTP name); walk matching Form / Call Leads through to those Bookings. Historical stays company-only. Live leftover nest seeds catalog zeros. Funnel `sheet_booked_leads` (Lead `booked` ref) can disagree with `reconciled_bookings` (BookedLead rows). This file does not pick live versus historical, does not add the two collections, does not paint the home Overview, does not flatten leftover CSV, does not reconcile RingCentral call counts.
- remaining in this service: `agentPerformance.service.ts`, `cancellationAnalytics.service.ts`, `geographicAnalytics.service.ts`, `receiverAgentPerformance.service.ts`, `smsConversion.service.ts`, `agentSalesReport.service.ts`, `leadCost.service.ts`, `analyticsExport.service.ts`, `analyticsFilters.ts`, `analyticsMerge.ts`, `sourceHierarchy.ts`

## Stock at end

- Visited / in-progress / unvisited: 25 / 1 / 12
- Current service / next module: `analytics` (in-progress) / `agentPerformance.service.ts`

## Messages posted

- 2026-09-05T0908Z next-run

## Ideas parked

- none

## Contradictions

- `getSourceCompanyPerformance` and `getLeadSourcePerformance` are the same function; knowledge describes Lead Source as grouping by `source_granularity_key`, but leftover nest already does that for both
- booked scorecard `booking_rate` is always `null`; leftover `source-company-performance` CSV still emits the column; leftover `lead-source-performance` CSV omits `booking_rate` and `active_bookings`
- funnel `sheet_booked_leads` (Lead `booked` ref) vs `reconciled_bookings` (BookedLead rows) can disagree; `booking_rate` uses reconciled over leads
- historical is fenced twice (this file’s `$group` flag, then leftover nest company-only)
- funnel re-sorts by deposit after leftover nest already sorted (equal-deposit order can change)
- `over_2000_leads` / `over_4000_leads` are JSON-only; leftover funnel CSV omits them
- no `getLeadSourcePerformance` test; leftover `analytics.service.test.ts` never calls these three exports
- knowledge ADR-0001 link is absent in this checkout (`docs/adr/` missing)
